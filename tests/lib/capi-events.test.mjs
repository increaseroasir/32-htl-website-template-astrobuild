/**
 * Value resolution (C8 / K-06, K-11-adjacent): the ladder's numbers and,
 * just as important, WHERE each number came from — because "source:
 * 'default'" and "malformedEnvKey" are what the handlers log to make
 * training-Meta-on-template-economics visible in wrangler tail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEventValue } from '../../src/lib/capi-events.ts';

test('env override wins and is reported as env', () => {
  const r = resolveEventValue('QualifiedLead', { META_VALUE_QUALIFIED: '120' });
  assert.deepEqual(r, { ok: true, value: 120, source: 'env' });
});

test('no env → built-in default, reported as default (the K-06 log trigger)', () => {
  const r = resolveEventValue('Schedule', {});
  assert.equal(r.ok, true);
  assert.equal(r.value, 300);
  assert.equal(r.source, 'default');
  assert.equal('malformedEnvKey' in r, false);
});

test('malformed env → default used AND malformedEnvKey names the bad secret', () => {
  for (const bad of ['banana', '-5', ' ']) {
    const r = resolveEventValue('Showed', { META_VALUE_SHOWED: bad });
    assert.equal(r.ok, true, `"${bad}" should fall back`);
    assert.equal(r.value, 600);
    assert.equal(r.source, 'default');
    // ' ' is whitespace-only → absent, not malformed. The others are malformed.
    if (bad.trim() === '') assert.equal(r.malformedEnvKey, undefined);
    else assert.equal(r.malformedEnvKey, 'META_VALUE_SHOWED');
  }
});

test('Purchase refuses to exist without a positive value — no default, ever', () => {
  assert.equal(resolveEventValue('Purchase', {}).ok, false);
  assert.equal(resolveEventValue('Purchase', {}, 0).ok, false);
  assert.equal(resolveEventValue('Purchase', {}, -1).ok, false);
  assert.equal(resolveEventValue('Purchase', {}, 'not-a-number').ok, false);
  const r = resolveEventValue('Purchase', {}, 8450);
  assert.deepEqual(r, { ok: true, value: 8450, source: 'supplied' });
});

test('Lead resolves to 0 by default — the designed bottom rung', () => {
  const r = resolveEventValue('Lead', {});
  assert.equal(r.ok, true);
  assert.equal(r.value, 0);
});

test("Lead's value is immovable — a set META_VALUE_LEAD is ignored (C17/K-11)", () => {
  const r = resolveEventValue('Lead', { META_VALUE_LEAD: '500' });
  assert.equal(r.ok, true);
  assert.equal(r.value, 0);
  assert.equal(r.source, 'default');
});
