/**
 * THE LEAD VAULT — Google Sheets client for Cloudflare Workers (Job 1).
 *
 * Ported from the Sun Pool build's service-account flow
 * (sunpool-port/functions/lib/sheets.js): PEM → ArrayBuffer →
 * crypto.subtle.importKey → RS256-signed JWT → OAuth token exchange.
 * Workers-native, zero dependencies, TypeScript.
 *
 * TWO HARD-WON DETAILS THAT MUST SURVIVE EVERY FUTURE EDIT:
 *
 * 1. THE A1 ANCHOR. Appending to an open column range
 *    ('All Leads'!A:AI) lets Sheets go table-hunting, latch onto a stray
 *    block in the right-hand columns, and write the row starting at
 *    column AF — invisible to every downstream reader. This ALREADY ATE A
 *    LIVE LEAD. Appends anchor to 'All Leads'!A1, and the response's
 *    updates.updatedRange is re-read and console.error'd loudly if the
 *    write did not land in column A.
 *
 * 2. TRIM BEFORE THE CONFIGURED CHECK. A whitespace-only secret is
 *    truthy; untrimmed it reports "configured" and then dies at Google
 *    with an opaque auth error instead of an honest config error.
 *
 * NOT WIRED into any handler here — Job 2 does that, AFTER the D1 write,
 * inside waitUntil, never able to refuse a lead (the Sun Pool 503-when-
 *-unconfigured decision INVERTS on this template: D1 is the durable
 * store; a Google outage is a reporting problem, not a lost customer).
 *
 * THE VAULT IS A PROJECTION OF D1 — one lead identity, one row, forever.
 * Writers use upsertRowByLeadUuid, which resolves the row by id lookup
 * AT WRITE TIME. Never write to a REMEMBERED range (e.g. the
 * updatedRange a previous append returned): it goes stale the moment
 * anyone inserts or sorts a row, and then the write lands on a
 * different lead. updatedRange in results is evidence for the drift
 * assertion, not an address to write back to.
 */

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export interface SheetsConfig {
  sheetsId: string;
  serviceAccountEmail: string;
  /** PKCS8 PEM, real newlines (already un-escaped). */
  privateKey: string;
}

export const VAULT_TAB = 'All Leads';
export const MISSED_TAB = 'Missed Leads';

/**
 * Reads and validates the three Google secrets. TRIMS FIRST — see header
 * note #2. Returns null when any is missing/blank, so callers get one
 * honest "not configured" instead of Google's opaque `invalid_grant`.
 *
 * The private key arrives from `wrangler secret put` with literal \n
 * two-character sequences; they become real newlines here, once.
 */
export function sheetsConfigFromEnv(env: {
  GOOGLE_SHEETS_ID?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}): SheetsConfig | null {
  const sheetsId = (env.GOOGLE_SHEETS_ID ?? '').trim();
  const serviceAccountEmail = (env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim();
  const rawKey = (env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').trim();
  if (!sheetsId || !serviceAccountEmail || !rawKey) return null;
  return {
    sheetsId,
    serviceAccountEmail,
    privateKey: rawKey.replace(/\\n/g, '\n'),
  };
}

/* ------------------------------------------------------------------ */
/* Service-account JWT → access token                                  */
/* ------------------------------------------------------------------ */

/** Strip PEM armour + whitespace, base64-decode to the raw PKCS8 bytes. */
export function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64UrlEncode(data: ArrayBuffer | string): string {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface CachedToken {
  token: string;
  /** Unix ms after which we refuse to reuse it. */
  expiresAt: number;
}

/**
 * Cached per-isolate. Populated inside request handling only — NEVER at
 * module init (Workers freeze the clock at 0 there; see the Astro 7
 * upgrade notes).
 */
let tokenCache: CachedToken | null = null;

/** Exchange a signed service-account JWT for a bearer token. ~1h validity. */
export async function getAccessToken(config: SheetsConfig): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.token;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(config.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const iat = Math.floor(now / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlEncode(
    JSON.stringify({
      iss: config.serviceAccountEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(
      `[sheets] token exchange failed (${res.status}): ${body.error ?? ''} ${body.error_description ?? ''}`.trim(),
    );
  }

  tokenCache = {
    token: body.access_token,
    // Refresh a minute early so a token never expires mid-request.
    expiresAt: now + ((body.expires_in ?? 3600) - 60) * 1000,
  };
  return tokenCache.token;
}

/** Test hook: the cache is per-isolate state; tests need a clean slate. */
export function _clearTokenCache(): void {
  tokenCache = null;
}

/* ------------------------------------------------------------------ */
/* Sheet operations                                                    */
/* ------------------------------------------------------------------ */

export interface SheetWriteResult {
  ok: boolean;
  status: number;
  /** Exactly what Google reported writing, e.g. 'All Leads'!A7:AR7. */
  updatedRange?: string;
  /** True when the append landed OUTSIDE column A — the AF-drift bug. */
  drifted?: boolean;
  error?: string;
}

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * True when `updatedRange` starts in column A of the given tab.
 * Accepts both quoted ('All Leads'!A7:AR7) and bare (Sheet1!A7) forms.
 */
export function landedInColumnA(updatedRange: string, tab: string): boolean {
  const escaped = tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^'?${escaped}'?!A\\d`).test(updatedRange);
}

/**
 * Append one row to the vault tab.
 *
 * THE ANCHOR: the range is `'All Leads'!A1` — a single cell, never an
 * open column range. That pins Sheets' table detection to the real table
 * at A1 instead of letting it latch onto stray content in the right-hand
 * columns (the bug that wrote a live lead starting at column AF).
 * INSERT_ROWS keeps every append a new row rather than an overwrite.
 *
 * The result's updatedRange is verified; a write outside column A is
 * console.error'd LOUDLY and flagged `drifted` — the row exists but every
 * positional reader would miss it, so a human must go look.
 */
export async function appendRow(
  config: SheetsConfig,
  values: (string | number)[],
  tab: string = VAULT_TAB,
): Promise<SheetWriteResult> {
  try {
    const token = await getAccessToken(config);
    const range = encodeURIComponent(`'${tab}'!A1`);
    const res = await fetch(
      `${API}/${config.sheetsId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [values] }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      updates?: { updatedRange?: string };
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body.error?.message ?? `append failed (${res.status})`,
      };
    }

    const updatedRange = body.updates?.updatedRange ?? '';
    if (!landedInColumnA(updatedRange, tab)) {
      // The AF-drift bug, live again. The row landed SOMEWHERE — do not
      // pretend it failed — but nothing positional will ever read it.
      console.error(
        `[sheets] APPEND DRIFTED OUT OF COLUMN A — wrote to "${updatedRange}" on tab "${tab}". ` +
          'A stray block of content is hijacking table detection; this row is invisible to ' +
          'every positional reader. Clean the sheet NOW.',
      );
      return { ok: true, status: res.status, updatedRange, drifted: true };
    }
    return { ok: true, status: res.status, updatedRange, drifted: false };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Read column A of `tab` and return the 1-based row number of `id`, or -1. */
async function findRowNumberById(
  config: SheetsConfig,
  token: string,
  id: string,
  tab: string,
): Promise<{ ok: boolean; status: number; row: number; error?: string }> {
  const colRange = encodeURIComponent(`'${tab}'!A:A`);
  const read = await fetch(`${API}/${config.sheetsId}/values/${colRange}?majorDimension=COLUMNS`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const readBody = (await read.json().catch(() => ({}))) as {
    values?: string[][];
    error?: { message?: string };
  };
  if (!read.ok) {
    return {
      ok: false,
      status: read.status,
      row: -1,
      error: readBody.error?.message ?? `column read failed (${read.status})`,
    };
  }
  const column = readBody.values?.[0] ?? [];
  const index = column.findIndex((cell) => cell === id);
  return { ok: true, status: read.status, row: index === -1 ? -1 : index + 1 };
}

/**
 * UPSERT one lead's row — the ONLY write path the submit and retry paths
 * may use. THE VAULT IS A PROJECTION OF D1: one lead identity, one row,
 * forever. D1 upserts on lead_uuid; the sheet does the same.
 *
 * Resolves the row by looking up `leadUuid` in column A AT WRITE TIME —
 * never by replaying a range remembered from an earlier append, which
 * goes stale the moment anyone inserts or sorts a row and then
 * overwrites a different lead.
 *
 *   found      → PUT the full row at 'tab'!A<row> (an explicit range
 *                cannot drift).
 *   not found  → append, anchored to A1 (the drift assertion applies).
 *
 * DRIFTED ROWS ARE THE CALLER'S GUARD: a drifted row's lead_uuid is not
 * in column A, so a lookup here cannot see it and an upsert would append
 * an orphan twin. Callers must check D1's vault_status and refuse to
 * call this at all when it reads DRIFTED (shouldWriteVaultRow).
 */
export async function upsertRowByLeadUuid(
  config: SheetsConfig,
  leadUuid: string,
  values: (string | number)[],
  tab: string = VAULT_TAB,
): Promise<SheetWriteResult & { action: 'appended' | 'updated' | 'none' }> {
  if (values[0] !== leadUuid) {
    // Column A IS the identity. A row whose first cell disagrees with the
    // id it is filed under would corrupt every future lookup.
    return {
      ok: false,
      status: 0,
      action: 'none',
      error: `row[0] (${String(values[0])}) must equal leadUuid (${leadUuid})`,
    };
  }
  try {
    const token = await getAccessToken(config);
    const found = await findRowNumberById(config, token, leadUuid, tab);
    if (!found.ok) {
      return { ok: false, status: found.status, action: 'none', error: found.error };
    }

    if (found.row === -1) {
      const appended = await appendRow(config, values, tab);
      return { ...appended, action: appended.ok ? 'appended' : 'none' };
    }

    const target = encodeURIComponent(`'${tab}'!A${found.row}`);
    const write = await fetch(`${API}/${config.sheetsId}/values/${target}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
    });
    const writeBody = (await write.json().catch(() => ({}))) as {
      updatedRange?: string;
      error?: { message?: string };
    };
    if (!write.ok) {
      return {
        ok: false,
        status: write.status,
        action: 'none',
        error: writeBody.error?.message ?? `update failed (${write.status})`,
      };
    }
    return {
      ok: true,
      status: write.status,
      updatedRange: writeBody.updatedRange,
      drifted: false,
      action: 'updated',
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      action: 'none',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Update columns of the row whose FIRST cell equals `submissionId`.
 *
 * Reads ONLY column A (never the whole sheet — the read-everything
 * pattern is what made Sun Pool's duplicate check slower forever), finds
 * the row index, then writes `values` starting at that row's column
 * `startColumn`.
 */
export async function updateRowBySubmissionId(
  config: SheetsConfig,
  submissionId: string,
  values: (string | number)[],
  startColumn: string,
  tab: string = VAULT_TAB,
): Promise<SheetWriteResult> {
  try {
    const token = await getAccessToken(config);
    const found = await findRowNumberById(config, token, submissionId, tab);
    if (!found.ok) {
      return { ok: false, status: found.status, error: found.error };
    }
    if (found.row === -1) {
      return { ok: false, status: 404, error: `submission_id ${submissionId} not found in column A` };
    }

    const target = encodeURIComponent(`'${tab}'!${startColumn}${found.row}`);
    const write = await fetch(
      `${API}/${config.sheetsId}/values/${target}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [values] }),
      },
    );
    const writeBody = (await write.json().catch(() => ({}))) as {
      updatedRange?: string;
      error?: { message?: string };
    };
    if (!write.ok) {
      return {
        ok: false,
        status: write.status,
        error: writeBody.error?.message ?? `update failed (${write.status})`,
      };
    }
    return { ok: true, status: write.status, updatedRange: writeBody.updatedRange };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
