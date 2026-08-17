/**
 * Geo match keys (C6 / P-01, spec §2.5): zp/ct/st/country from request.cf,
 * normalised per Meta (lowercase, letters+digits only, US zip → 5 digits),
 * hashed, and NULL-SAFE — an absent cf field must be omitted entirely,
 * never sent as an empty-string hash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sendMetaCapi } from '../../src/lib/meta-capi.ts';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function baseEvent(userOverrides = {}) {
  return {
    eventName: 'Lead',
    eventId: 'evt-geo-1',
    eventSourceUrl: 'https://fixture-spas.test/',
    user: {
      email: 'casey@fixture.test',
      phone: '6195550142',
      firstName: 'Casey',
      lastName: 'Buyer',
      externalId: 'uuid-1',
      fbp: '',
      fbc: '',
      clientIp: '',
      userAgent: '',
      ...userOverrides,
    },
  };
}

async function payloadFor(userOverrides) {
  let captured;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  };
  try {
    await sendMetaCapi({ pixelId: '1', accessToken: 't' }, baseEvent(userOverrides));
  } finally {
    globalThis.fetch = realFetch;
  }
  return captured.data[0].user_data;
}

test('fake cf → all four geo keys present, 64-hex, normalised before hashing', async () => {
  const userData = await payloadFor({
    zip: '48226-1906',
    city: 'San Diego',
    state: 'MI',
    country: 'US',
  });
  const hex64 = /^[0-9a-f]{64}$/;
  for (const key of ['zp', 'ct', 'st', 'country']) {
    assert.ok(userData[key], `${key} missing`);
    assert.match(userData[key][0], hex64, `${key} not 64-hex`);
  }
  // Normalisation is observable through the hash: it must equal the hash of
  // the normalised form, not of the raw input.
  assert.equal(userData.zp[0], sha256('48226')); // 5 digits, punctuation gone
  assert.equal(userData.ct[0], sha256('sandiego')); // lowercase, no space
  assert.equal(userData.st[0], sha256('mi'));
  assert.equal(userData.country[0], sha256('us'));
});

test('empty cf → all four geo keys absent (null-safe, the §2.5 caveat)', async () => {
  const userData = await payloadFor({ zip: '', city: '', state: '', country: '' });
  for (const key of ['zp', 'ct', 'st', 'country']) {
    assert.equal(key in userData, false, `${key} must be omitted when cf is empty`);
  }
});

test('undefined geo fields behave like empty ones', async () => {
  const userData = await payloadFor({});
  for (const key of ['zp', 'ct', 'st', 'country']) {
    assert.equal(key in userData, false);
  }
});
