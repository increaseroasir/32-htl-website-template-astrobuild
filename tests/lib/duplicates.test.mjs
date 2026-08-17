/**
 * Cross-session duplicate detection (Lead Vault, Job 3). The pins:
 *   - the normalisation, EXACTLY (it is the identity match);
 *   - the query shape: indexed D1, the exact substr expression the
 *     index was built on, no sheet anywhere near it;
 *   - the 24h window arithmetic;
 *   - the three-way outcome: FAILED → retry, everything else → suppress.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUPLICATE_WINDOW_MS,
  DUPLICATE_QUERY,
  normalizeEmailForDup,
  normalizePhoneForDup,
  findRecentDuplicate,
  duplicateDecision,
} from '../../src/lib/duplicates.ts';

/* ---------------- normalisation ---------------- */

test('email: lowercased and trimmed', () => {
  assert.equal(normalizeEmailForDup('  Ada@Example.COM '), 'ada@example.com');
  assert.equal(normalizeEmailForDup(''), '');
});

test('phone: digits, leading 1 removed, last 10 kept — the Sun Pool identity', () => {
  // The canonical pair from the port doc: these are the same person.
  assert.equal(normalizePhoneForDup('(619) 995-0289'), '6199950289');
  assert.equal(normalizePhoneForDup('6199950289'), '6199950289');
  assert.equal(normalizePhoneForDup('16199950289'), '6199950289');
  assert.equal(normalizePhoneForDup('+1 619 995 0289'), '6199950289');
  assert.equal(normalizePhoneForDup('619.995.0289'), '6199950289');
});

test('phone: converges with the D1 side (substr(phone, -10) on digits-only)', () => {
  // leads.phone is stored digits-only; the query takes its last 10.
  // The JS normalisation of any spelling must equal that.
  const stored = (raw) => raw.replace(/\D/g, '').slice(-10); // what substr(-10) sees
  for (const spelling of ['(619) 995-0289', '16199950289', '+1-619-995-0289']) {
    assert.equal(normalizePhoneForDup(spelling), stored('16199950289'));
  }
});

/* ---------------- the query ---------------- */

test('the query is indexed D1, not a sheet: exact substr expression, window bound, LIMIT 1', () => {
  assert.ok(DUPLICATE_QUERY.includes('FROM leads'), 'reads D1');
  assert.ok(
    DUPLICATE_QUERY.includes('substr(phone, -10) = ?2'),
    'must repeat the EXACT expression the index was built on (migration 0004)',
  );
  assert.ok(DUPLICATE_QUERY.includes('email = ?1'));
  assert.ok(DUPLICATE_QUERY.includes('created_at > ?3'));
  assert.ok(DUPLICATE_QUERY.includes('ORDER BY created_at DESC LIMIT 1'));
  assert.ok(!/sheet/i.test(DUPLICATE_QUERY));
});

function fakeDb(rowsByMatch) {
  const calls = [];
  return {
    calls,
    prepare(query) {
      return {
        bind(...values) {
          calls.push({ query, values });
          return {
            async first() {
              return rowsByMatch(values) ?? null;
            },
          };
        },
      };
    },
  };
}

test('findRecentDuplicate binds normalised keys and the 24h cutoff', async () => {
  const now = 1755000000000;
  const db = fakeDb(() => ({ uuid: 'prior-1', created_at: now - 1000, conversion_status: 'SENT' }));
  const hit = await findRecentDuplicate(db, {
    email: ' Ada@Example.COM ',
    phone: '+1 (619) 995-0289',
    now,
  });
  assert.equal(hit.uuid, 'prior-1');
  const [email, phone10, cutoff] = db.calls[0].values;
  assert.equal(email, 'ada@example.com');
  assert.equal(phone10, '6199950289');
  assert.equal(cutoff, now - DUPLICATE_WINDOW_MS);
  assert.equal(DUPLICATE_WINDOW_MS, 24 * 60 * 60 * 1000, 'the window is exactly 24h');
});

test('no match → null; blank keys → sentinels that match nothing, or no query at all', async () => {
  const empty = fakeDb(() => null);
  assert.equal(await findRecentDuplicate(empty, { email: 'a@b.co', phone: '6199950289', now: 1 }), null);

  const db = fakeDb(() => null);
  await findRecentDuplicate(db, { email: '', phone: '6199950289', now: 1 });
  assert.equal(db.calls[0].values[0], ' ', 'blank email becomes a space sentinel, never matches');

  const none = fakeDb(() => {
    throw new Error('must not query');
  });
  assert.equal(await findRecentDuplicate(none, { email: '  ', phone: 'x', now: 1 }), null);
  assert.equal(none.calls.length, 0);
});

/* ---------------- the three-way outcome ---------------- */

test('prior SENT / DUPLICATE / PENDING / DISABLED / blank → suppress the conversion', () => {
  for (const status of ['SENT', 'DUPLICATE', 'PENDING', 'DISABLED', '']) {
    const decision = duplicateDecision({ uuid: 'p', created_at: 1, conversion_status: status });
    assert.equal(decision.suppress, true, `${status || '(blank)'} must suppress`);
    assert.equal(decision.priorUuid, 'p');
  }
});

test('prior FAILED → RETRY: let it through, the signal was never counted', () => {
  const decision = duplicateDecision({ uuid: 'p', created_at: 1, conversion_status: 'FAILED' });
  assert.equal(decision.suppress, false);
  assert.equal(decision.priorUuid, 'p', 'the prior is still named, for the audit');
});

test('prior NONE (phone-minted) → let through: the website form IS the first Lead', () => {
  const decision = duplicateDecision({ uuid: 'p', created_at: 1, conversion_status: 'NONE' });
  assert.equal(decision.suppress, false);
  assert.equal(decision.priorUuid, 'p');
});

test('no prior → not a duplicate', () => {
  assert.deepEqual(duplicateDecision(null), { suppress: false, priorUuid: '' });
});
