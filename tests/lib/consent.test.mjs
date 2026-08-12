/**
 * The consent record (C4 / D-04): the server must be able to prove exactly
 * which wording a lead agreed to, so version→text resolution is the whole
 * game. Client-supplied text is never stored; an unknown version resolves to
 * null and the API refuses the lead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_VERSION, consentTextFor } from '../../src/config/consent.ts';

test('known version resolves to the exact rendered wording', () => {
  const text = consentTextFor(CONSENT_VERSION, 'Fixture Spas');
  assert.equal(
    text,
    'By submitting, I agree that Fixture Spas may call, text, and email me about my ' +
      'enquiry, including with automated messages. Consent is not a condition of ' +
      'purchase. Reply STOP to opt out.',
  );
});

test('the business name is substituted, never left as a placeholder', () => {
  const text = consentTextFor(CONSENT_VERSION, 'Northline Sauna');
  assert.ok(text?.includes('Northline Sauna'));
  assert.ok(!text?.includes('{business}'));
});

test('unknown version resolves to null — the reject path', () => {
  assert.equal(consentTextFor('9999-01-01.1', 'Fixture Spas'), null);
  assert.equal(consentTextFor('', 'Fixture Spas'), null);
});
