/**
 * validateLead (C7): the server's single decider. The honeypot drop, the
 * consent gate, the category allowlist, and the field rules — regression-
 * pinned so C8's churn in the same file cannot quietly change a verdict.
 *
 * The category allowlist comes from the real template config (imported by
 * validate-lead.ts). The BLANK template enables zero categories (that is one
 * of the three deliberate gate locks), so these tests use the two verdicts
 * that hold in every mode: empty category is fine, unknown category rejects.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLead, clean, looksLikeEmail, digitsOnly } from '../../src/lib/validate-lead.ts';
import { CONSENT_VERSION } from '../../src/config/consent.ts';

const BUSINESS = 'Fixture Spas';

function goodBody(overrides = {}) {
  return {
    name: 'Casey Buyer',
    email: 'casey@fixture.test',
    phone: '(619) 555-0142',
    message: 'Interested in a 6-person tub',
    category: '',
    productSlug: 'example-tub',
    sourcePage: '/find-your-match',
    eventId: 'evt-1',
    consentVersion: CONSENT_VERSION,
    company: '',
    ...overrides,
  };
}

test('honeypot filled → drop, before anything else is judged', () => {
  const verdict = validateLead(goodBody({ company: 'Totally Real LLC', email: 'not-an-email' }), BUSINESS);
  assert.equal(verdict.kind, 'drop');
  assert.equal(verdict.reason, 'honeypot');
});

test('clean body → ok, fields cleaned and split', () => {
  const verdict = validateLead(goodBody(), BUSINESS);
  assert.equal(verdict.kind, 'ok');
  assert.equal(verdict.lead.firstName, 'Casey');
  assert.equal(verdict.lead.lastName, 'Buyer');
  assert.equal(verdict.lead.phone, '6195550142');
  assert.equal(verdict.lead.consentVersion, CONSENT_VERSION);
  assert.ok(verdict.lead.consentText.includes(BUSINESS));
});

test('category outside the allowlist → 400-class reject', () => {
  const verdict = validateLead(goodBody({ category: 'submarine' }), BUSINESS);
  assert.equal(verdict.kind, 'reject');
  assert.equal(verdict.status, 400);
});

test('empty category is fine — "just browsing"', () => {
  const verdict = validateLead(goodBody({ category: undefined }), BUSINESS);
  assert.equal(verdict.kind, 'ok');
});

test('missing or unknown consentVersion → reject (C4 regression pin)', () => {
  assert.equal(validateLead(goodBody({ consentVersion: undefined }), BUSINESS).kind, 'reject');
  assert.equal(validateLead(goodBody({ consentVersion: '1999-01-01.1' }), BUSINESS).kind, 'reject');
});

test('existing field rules regression-pinned: name, phone, email', () => {
  assert.equal(validateLead(goodBody({ name: 'C' }), BUSINESS).kind, 'reject');
  assert.equal(validateLead(goodBody({ phone: '555-0142' }), BUSINESS).kind, 'reject');
  assert.equal(validateLead(goodBody({ email: 'nope' }), BUSINESS).kind, 'reject');
});

test('helpers: clean strips angle brackets and caps length; digitsOnly; looksLikeEmail', () => {
  assert.equal(clean('<script>hi</script>', 100), 'scripthi/script');
  assert.equal(clean('a'.repeat(300), 10).length, 10);
  assert.equal(clean(42, 10), '');
  assert.equal(digitsOnly('(619) 555-0142'), '6195550142');
  assert.equal(looksLikeEmail('odd+addr@sub.domain.co'), true);
  assert.equal(looksLikeEmail('nope'), false);
});
