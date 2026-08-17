/**
 * The Lead Vault client (Job 1). The two behaviours that already cost a
 * live lead each get a pin:
 *   - the A1 anchor + updatedRange drift assertion (the column-AF bug)
 *   - trim-before-configured (the whitespace-secret opaque-auth-error bug)
 * Plus the full JWT flow against a REAL generated RSA key — fetch stubbed,
 * nothing leaves the process.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  sheetsConfigFromEnv,
  pemToArrayBuffer,
  getAccessToken,
  appendRow,
  upsertRowByLeadUuid,
  updateRowBySubmissionId,
  landedInColumnA,
  _clearTokenCache,
  VAULT_TAB,
} from '../../src/lib/sheets.ts';

/** A real PKCS8 PEM, generated fresh — proves pem→importKey→sign works. */
async function generatePem() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(pkcs8).toString('base64');
  const lines = b64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

function configWith(pem) {
  return { sheetsId: 'sheet-fixture', serviceAccountEmail: 'vault@demo.iam', privateKey: pem };
}

/* ---------------- trim-before-configured ---------------- */

test('whitespace-only secret → NOT configured (the opaque-auth-error bug)', () => {
  assert.equal(
    sheetsConfigFromEnv({
      GOOGLE_SHEETS_ID: '   ',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'a@b.iam',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'key',
    }),
    null,
  );
  assert.equal(sheetsConfigFromEnv({}), null);
});

test('configured env trims values and un-escapes the private key \\n', () => {
  const cfg = sheetsConfigFromEnv({
    GOOGLE_SHEETS_ID: ' sheet-1 ',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: ' vault@demo.iam ',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----',
  });
  assert.equal(cfg.sheetsId, 'sheet-1');
  assert.equal(cfg.serviceAccountEmail, 'vault@demo.iam');
  assert.ok(cfg.privateKey.includes('\nABC\n'));
  assert.ok(!cfg.privateKey.includes('\\n'));
});

/* ---------------- JWT flow (real key, stubbed network) ---------------- */

test('token exchange: real PEM signs an RS256 JWT and the bearer comes back', async () => {
  _clearTokenCache();
  const pem = await generatePem();
  let tokenRequest;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    tokenRequest = { url: String(url), body: String(init.body) };
    return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 });
  };
  try {
    const token = await getAccessToken(configWith(pem));
    assert.equal(token, 'tok-1');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(tokenRequest.url, 'https://oauth2.googleapis.com/token');
  assert.ok(tokenRequest.body.includes('jwt-bearer'));
  // The assertion is a three-part JWT whose header decodes to RS256.
  const jwt = new URLSearchParams(tokenRequest.body).get('assertion');
  const [header] = jwt.split('.');
  const decoded = JSON.parse(Buffer.from(header.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.deepEqual(decoded, { alg: 'RS256', typ: 'JWT' });
});

test('pemToArrayBuffer round-trips: the generated key re-imports', async () => {
  const pem = await generatePem();
  const key = await webcrypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  assert.equal(key.type, 'private');
});

/* ---------------- the A1 anchor + drift assertion ---------------- */

async function stubbedAppend(updatedRange, values = ['lead-1', 'x']) {
  _clearTokenCache();
  const pem = await generatePem();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ updates: { updatedRange } }), { status: 200 });
  };
  try {
    const result = await appendRow(configWith(pem), values);
    return { result, appendCall: calls.find((c) => c.url.includes(':append')) };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("append anchors to 'All Leads'!A1 — never an open column range", async () => {
  const { appendCall } = await stubbedAppend("'All Leads'!A2:B2");
  assert.ok(appendCall, 'append endpoint was called');
  const url = decodeURIComponent(appendCall.url);
  assert.ok(url.includes(`'${VAULT_TAB}'!A1:append`), url);
  assert.ok(!/![A-Z]+:[A-Z]+/.test(url), `open column range found in ${url}`);
  assert.ok(appendCall.url.includes('insertDataOption=INSERT_ROWS'));
});

test('a write landing in column A → ok, not drifted', async () => {
  const { result } = await stubbedAppend("'All Leads'!A7:AR7");
  assert.equal(result.ok, true);
  assert.equal(result.drifted, false);
  assert.equal(result.updatedRange, "'All Leads'!A7:AR7");
});

test('the column-AF drift is detected and screamed about', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  let result;
  try {
    ({ result } = await stubbedAppend("'All Leads'!AF7:AJ7"));
  } finally {
    console.error = realError;
  }
  assert.equal(result.drifted, true, 'drift must be flagged');
  assert.equal(result.ok, true, 'the row DID land — do not pretend it failed');
  assert.ok(errors.some((e) => e.includes('DRIFTED OUT OF COLUMN A')), errors.join('\n'));
});

test('landedInColumnA handles quoted and bare tab names', () => {
  assert.equal(landedInColumnA("'All Leads'!A9:Z9", 'All Leads'), true);
  assert.equal(landedInColumnA('Sheet1!A2', 'Sheet1'), true);
  assert.equal(landedInColumnA("'All Leads'!AF7:AJ7", 'All Leads'), false);
  assert.equal(landedInColumnA("'All Leads'!B2:C2", 'All Leads'), false);
});

/* ---------------- upsert: a projection of D1 ---------------- */

/**
 * A stateful fake sheet: appends push a row, PUTs overwrite one, the
 * column-A read reflects current state. This is what lets the projection
 * property be WATCHED: two submits of one lead identity → one row.
 */
function fakeSheet() {
  const rows = [];
  const counts = { appends: 0, puts: 0, reads: 0 };
  const handler = async (url, init) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes(':append')) {
      counts.appends += 1;
      const values = JSON.parse(String(init.body)).values[0];
      rows.push(values);
      return new Response(
        JSON.stringify({ updates: { updatedRange: `'All Leads'!A${rows.length}:AH${rows.length}` } }),
        { status: 200 },
      );
    }
    if ((init?.method ?? 'GET') === 'GET') {
      counts.reads += 1;
      return new Response(JSON.stringify({ values: [rows.map((r) => String(r[0]))] }), { status: 200 });
    }
    if (init?.method === 'PUT') {
      counts.puts += 1;
      const match = u.match(/!A(\d+)\?/);
      const rowNumber = Number(match?.[1] ?? 0);
      const values = JSON.parse(String(init.body)).values[0];
      rows[rowNumber - 1] = values;
      return new Response(JSON.stringify({ updatedRange: `'All Leads'!A${rowNumber}:AH${rowNumber}` }), {
        status: 200,
      });
    }
    throw new Error(`unexpected request ${u}`);
  };
  return { rows, counts, handler };
}

test('same lead_uuid twice → one append, one update, row count does NOT increase', async () => {
  _clearTokenCache();
  const pem = await generatePem();
  const sheet = fakeSheet();
  const realFetch = globalThis.fetch;
  globalThis.fetch = sheet.handler;
  let first, second;
  try {
    first = await upsertRowByLeadUuid(configWith(pem), 'lead-1', ['lead-1', 'v1']);
    second = await upsertRowByLeadUuid(configWith(pem), 'lead-1', ['lead-1', 'v2']);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(first.ok, true);
  assert.equal(first.action, 'appended');
  assert.equal(second.ok, true);
  assert.equal(second.action, 'updated');
  assert.equal(sheet.counts.appends, 1, 'exactly one append');
  assert.equal(sheet.counts.puts, 1, 'exactly one update');
  assert.equal(sheet.rows.length, 1, 'one lead identity, one row, forever');
  assert.deepEqual(sheet.rows[0], ['lead-1', 'v2'], 'the row holds the LATEST projection');
});

test('upsert resolves by id lookup at write time, never a remembered range', async () => {
  _clearTokenCache();
  const pem = await generatePem();
  const sheet = fakeSheet();
  // Two other leads land first; then someone SORTS the sheet so lead-1
  // moves. The next upsert must find the row where it IS NOW.
  sheet.rows.push(['lead-1', 'old'], ['lead-2', 'x'], ['lead-3', 'y']);
  const moved = [sheet.rows[1], sheet.rows[2], sheet.rows[0]]; // lead-1 now row 3
  sheet.rows.length = 0;
  sheet.rows.push(...moved);
  const realFetch = globalThis.fetch;
  globalThis.fetch = sheet.handler;
  let result;
  try {
    result = await upsertRowByLeadUuid(configWith(pem), 'lead-1', ['lead-1', 'new']);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(result.action, 'updated');
  assert.equal(result.updatedRange, "'All Leads'!A3:AH3", 'wrote where the row IS, not where it was');
  assert.deepEqual(sheet.rows[2], ['lead-1', 'new']);
  assert.deepEqual(sheet.rows[0], ['lead-2', 'x'], 'no other lead was touched');
});

test('upsert refuses a row whose first cell disagrees with the lead_uuid', async () => {
  _clearTokenCache();
  const pem = await generatePem();
  let networkSeen = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkSeen = true;
    return new Response('{}', { status: 200 });
  };
  let result;
  try {
    result = await upsertRowByLeadUuid(configWith(pem), 'lead-1', ['NOT-lead-1', 'v']);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(result.ok, false);
  assert.equal(result.action, 'none');
  assert.equal(networkSeen, false, 'refused before any network call');
});

/* ---------------- update by submission id ---------------- */

test('updateRowBySubmissionId reads ONLY column A, then writes the found row', async () => {
  _clearTokenCache();
  const pem = await generatePem();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    if ((init?.method ?? 'GET') === 'GET') {
      return new Response(
        JSON.stringify({ values: [['submission_id', 'lead-a', 'lead-b']] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ updatedRange: "'All Leads'!I3:K3" }), { status: 200 });
  };
  let result;
  try {
    result = await updateRowBySubmissionId(configWith(pem), 'lead-b', ['SENT', 'c-1', ''], 'I');
  } finally {
    globalThis.fetch = realFetch;
  }
  const readCall = calls.find((c) => (c.init?.method ?? 'GET') === 'GET' && c.url.includes('/values/'));
  assert.ok(decodeURIComponent(readCall.url).includes(`'All Leads'!A:A`), 'must read only column A');
  const writeCall = calls.find((c) => c.init?.method === 'PUT');
  assert.ok(decodeURIComponent(writeCall.url).includes(`'All Leads'!I3`), 'lead-b is row 3');
  assert.equal(result.ok, true);
});

test('unknown submission id → honest 404, no write attempted', async () => {
  _clearTokenCache();
  const pem = await generatePem();
  let putSeen = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    if (init?.method === 'PUT') putSeen = true;
    return new Response(JSON.stringify({ values: [['submission_id']] }), { status: 200 });
  };
  let result;
  try {
    result = await updateRowBySubmissionId(configWith(pem), 'ghost', ['SENT'], 'I');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(putSeen, false);
});
