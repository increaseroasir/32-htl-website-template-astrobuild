/**
 * The server-event payload (C5 / verification defect #1): external_id must
 * arrive RAW — the browser pixel sends the raw lead UUID and Meta matches
 * the two values as sent. PII (em/ph) must arrive as 64-char SHA-256 hex.
 * The four passthrough fields must reach user_data untouched.
 *
 * fetch is stubbed to capture the payload; nothing leaves the process.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMetaCapi } from '../../src/lib/meta-capi.ts';

const RAW_UUID = '3f1c9a52-7b0e-4d26-9a51-08a9b1c0d2e3';

function fixtureEvent() {
  return {
    eventName: 'Lead',
    eventId: 'evt-fixture-1',
    eventSourceUrl: 'https://fixture-spas.test/find-your-match',
    user: {
      email: 'Casey.Buyer@Example.com',
      phone: '(619) 555-0142',
      firstName: 'Casey',
      lastName: 'Buyer',
      externalId: RAW_UUID,
      fbp: 'fb.1.1700000000000.123456789',
      fbc: 'fb.1.1700000000000.AbCdEfG',
      clientIp: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (fixture)',
    },
  };
}

async function capturePayload() {
  let captured;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  };
  try {
    const result = await sendMetaCapi(
      { pixelId: '1234567890', accessToken: 'token-fixture' },
      fixtureEvent(),
    );
    return { captured, result };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('external_id is sent raw — hashed, it can never match the browser value', async () => {
  const { captured } = await capturePayload();
  const userData = captured.body.data[0].user_data;
  assert.deepEqual(userData.external_id, [RAW_UUID]);
});

test('em and ph are 64-char SHA-256 hex', async () => {
  const { captured } = await capturePayload();
  const userData = captured.body.data[0].user_data;
  const hex64 = /^[0-9a-f]{64}$/;
  assert.match(userData.em[0], hex64);
  assert.match(userData.ph[0], hex64);
  assert.notEqual(userData.em[0], 'casey.buyer@example.com');
});

test('fbp, fbc, client_ip_address, client_user_agent pass through untouched', async () => {
  const { captured } = await capturePayload();
  const userData = captured.body.data[0].user_data;
  assert.equal(userData.fbp, 'fb.1.1700000000000.123456789');
  assert.equal(userData.fbc, 'fb.1.1700000000000.AbCdEfG');
  assert.equal(userData.client_ip_address, '203.0.113.9');
  assert.equal(userData.client_user_agent, 'Mozilla/5.0 (fixture)');
});

test('empty externalId is omitted, never sent as an empty array', async () => {
  let captured;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  };
  try {
    const event = fixtureEvent();
    event.user.externalId = '';
    await sendMetaCapi({ pixelId: '1234567890', accessToken: 'token-fixture' }, event);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal('external_id' in captured.data[0].user_data, false);
});
