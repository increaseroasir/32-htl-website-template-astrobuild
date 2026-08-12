/**
 * Schema refusals (C14): two states that are lies must fail at parse —
 * Sentry enabled with no SDK behind it (a false privacy disclosure one
 * flag away), and a nav link to a financing page that does not exist.
 * Plus the two new colour tokens, and the structural showMonthly fence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientConfigSchema } from '../../src/config/schema.ts';
import { rawClientConfig } from '../../src/config/client.config.ts';
import { buildRamp } from '../../src/config/ramp.ts';

const clone = () => structuredClone(rawClientConfig);

test('the shipped template config parses (baseline)', () => {
  const parsed = clientConfigSchema.safeParse(clone());
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues?.[0] ?? ''));
});

test('the two new tokens exist and are hex', () => {
  const parsed = clientConfigSchema.parse(clone());
  const tokens = { ...buildRamp(parsed.brand.colors), ...parsed.brand.colors.overrides };
  assert.match(tokens.onDarkStrong, /^#[0-9A-Fa-f]{6}$/);
  assert.match(tokens.inkLift, /^#[0-9A-Fa-f]{6}$/);
});

test('REFUSED: sentry enabled with no SDK wired', () => {
  const cfg = clone();
  cfg.integrations.sentry.enabled = true;
  const parsed = clientConfigSchema.safeParse(cfg);
  assert.equal(parsed.success, false);
  const messages = parsed.error.issues.map((i) => i.message).join(' ');
  assert.ok(messages.includes('Sentry is not wired'));
});

test('REFUSED: nav link to /financing while financing is null', () => {
  const cfg = clone();
  assert.equal(cfg.financing ?? null, null); // template ships without financing
  cfg.nav.items.push({ type: 'link', label: 'Financing', href: '/financing', inHeader: true, inFooter: false });
  const parsed = clientConfigSchema.safeParse(cfg);
  assert.equal(parsed.success, false);
  const messages = parsed.error.issues.map((i) => i.message).join(' ');
  assert.ok(messages.includes('/financing but financing is null'));
});

test('showMonthly cannot exist outside financing — and the old spot fails loudly', () => {
  // The field MOVED inside financing: with financing null it has nowhere to
  // live. display is strict, so writing it where it used to live — the most
  // likely mistake — is a parse ERROR naming the stray key, not a silent strip.
  const cfg = clone();
  cfg.display = { showPrice: true, showMonthly: true };
  const parsed = clientConfigSchema.safeParse(cfg);
  assert.equal(parsed.success, false);
  const messages = parsed.error.issues.map((i) => i.message).join(' ');
  assert.ok(/unrecognized key/i.test(messages) && messages.includes('showMonthly'), messages);
});
