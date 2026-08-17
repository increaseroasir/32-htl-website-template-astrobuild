/**
 * The comparator (C18 / L-03) — the one shape every secret check uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { secretsMatch } from '../../src/lib/secrets.ts';

test('equal secrets match', () => {
  assert.equal(secretsMatch('correct horse battery', 'correct horse battery'), true);
});

test('unequal same-length secrets do not match', () => {
  assert.equal(secretsMatch('aaaaaaaa', 'aaaaaaab'), false);
  assert.equal(secretsMatch('baaaaaaa', 'aaaaaaaa'), false);
});

test('unequal-length secrets do not match (and empty never matches non-empty)', () => {
  assert.equal(secretsMatch('short', 'shorter'), false);
  assert.equal(secretsMatch('', 'x'), false);
  assert.equal(secretsMatch('', ''), true);
});
