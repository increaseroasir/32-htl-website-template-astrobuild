/**
 * Failure alerts (Job 4). Pins: trim-before-configured; the
 * Slack-compatible {text} payload carrying kind + lead + detail; and the
 * no-throw guarantee — an alert failure may never become a lead failure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertConfigFromEnv, sendFailureAlert } from '../../src/lib/alert.ts';

test('whitespace-only webhook URL → NOT configured (trim rule)', () => {
  assert.equal(alertConfigFromEnv({ ALERT_WEBHOOK_URL: '   ' }), null);
  assert.equal(alertConfigFromEnv({}), null);
  assert.deepEqual(alertConfigFromEnv({ ALERT_WEBHOOK_URL: ' https://hooks.test/x ' }), {
    webhookUrl: 'https://hooks.test/x',
  });
});

test('alert POSTs a Slack-compatible {text} naming kind, lead and detail', async () => {
  let seen;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), body: JSON.parse(String(init.body)) };
    return new Response('ok', { status: 200 });
  };
  let result;
  try {
    result = await sendFailureAlert(
      { webhookUrl: 'https://hooks.test/x' },
      { kind: 'ghl', leadUuid: 'lead-9', detail: '502: upstream sad' },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(result.ok, true);
  assert.equal(seen.url, 'https://hooks.test/x');
  assert.ok(typeof seen.body.text === 'string', 'Slack-compatible payload');
  for (const piece of ['[ghl]', 'lead-9', '502: upstream sad']) {
    assert.ok(seen.body.text.includes(piece), `text carries ${piece}`);
  }
});

test('unconfigured → loud console.error that SAYS no channel exists, ok:false, no throw', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  let result;
  try {
    result = await sendFailureAlert(null, { kind: 'vault', leadUuid: 'l', detail: 'd' });
  } finally {
    console.error = realError;
  }
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unconfigured');
  assert.ok(errors.some((e) => e.includes('UNCONFIGURED') && e.includes('no ALERT_WEBHOOK_URL')));
});

test('webhook unreachable or rejecting → ok:false, NEVER a throw', async () => {
  const realFetch = globalThis.fetch;
  const realError = console.error;
  console.error = () => {};
  try {
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const down = await sendFailureAlert(
      { webhookUrl: 'https://hooks.test/x' },
      { kind: 'capi', leadUuid: 'l', detail: 'd' },
    );
    assert.equal(down.ok, false);

    globalThis.fetch = async () => new Response('no', { status: 410 });
    const rejected = await sendFailureAlert(
      { webhookUrl: 'https://hooks.test/x' },
      { kind: 'capi', leadUuid: 'l', detail: 'd' },
    );
    assert.equal(rejected.ok, false);
    assert.equal(rejected.status, 410);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
});
