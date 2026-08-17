/**
 * The theme system (AL-5 landed): 3 bases → 23 tokens, contrast guaranteed,
 * overrides win. These pins are what make "a client config is theme + 3
 * overrides" safe to promise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_BASES,
  THEME_NAMES,
  deriveBrandColors,
  resolveBrandColors,
  contrastRatio,
} from '../../src/config/themes.ts';
import { clientConfigSchema } from '../../src/config/schema.ts';
import { rawClientConfig } from '../../src/config/client.config.ts';

const KEYS = [
  'primary', 'primaryMid', 'deep', 'night', 'abyss',
  'accent', 'accentSoft', 'accentDeep', 'accentDark', 'accentLift', 'accentPress', 'accentGlow',
  'urgent', 'urgentLight', 'urgentDark',
  'surface', 'surfaceAlt', 'ink', 'inkMuted', 'onDark', 'onDarkMuted', 'onDarkStrong', 'inkLift',
];

test('four themes ship, and each derives all 23 tokens as 6-digit hex', () => {
  assert.deepEqual([...THEME_NAMES].sort(), ['aqua', 'luxury', 'mono', 'natural']);
  for (const name of THEME_NAMES) {
    const c = deriveBrandColors(THEME_BASES[name]);
    assert.deepEqual(Object.keys(c).sort(), [...KEYS].sort(), name);
    for (const [k, v] of Object.entries(c)) {
      assert.match(v, /^#[0-9A-F]{6}$/, `${name}.${k} = ${v}`);
    }
  }
});

test('every derived theme passes the AA invariants the sweep relies on', () => {
  for (const name of THEME_NAMES) {
    const c = deriveBrandColors(THEME_BASES[name]);
    const t = (label, r, min) => assert.ok(r >= min, `${name}: ${label} = ${r.toFixed(2)} < ${min}`);
    t('white/urgent', contrastRatio(c.onDarkStrong, c.urgent), 4.5);
    t('white/urgentDark', contrastRatio(c.onDarkStrong, c.urgentDark), 4.5);
    t('accentDark/surface', contrastRatio(c.accentDark, c.surface), 3);
    t('accentDark/abyss', contrastRatio(c.accentDark, c.abyss), 3);
    t('accentDark/accent', contrastRatio(c.accentDark, c.accent), 3);
    t('inkMuted/surface', contrastRatio(c.inkMuted, c.surface), 4.5);
    t('onDark/abyss', contrastRatio(c.onDark, c.abyss), 4.5);
    t('onDarkMuted/abyss', contrastRatio(c.onDarkMuted, c.abyss), 4.5);
  }
});

test('base override re-derives the ramp; leaf override pins one token', () => {
  const rederived = resolveBrandColors('aqua', { primary: '#16469B' });
  assert.equal(rederived.primary, '#16469B');
  assert.notEqual(rederived.deep, deriveBrandColors(THEME_BASES.aqua).deep); // ramp moved
  const pinned = resolveBrandColors('aqua', { accentDark: '#123456' });
  assert.equal(pinned.accentDark, '#123456'); // hand value wins
  assert.equal(pinned.accent, THEME_BASES.aqua.accent.toUpperCase()); // rest untouched
});

test('the template config (full 23-key override) resolves byte-identical — the escape hatch', () => {
  const parsed = clientConfigSchema.parse(structuredClone(rawClientConfig));
  const c = parsed.brand.colors;
  assert.equal(Object.keys(c).length, 23);
  // Spot-pin the hand-tuned values the derivation could never produce.
  assert.equal(c.primary, '#16469B');
  assert.equal(c.accentDark, '#8F6400');
  assert.equal(c.surfaceAlt, '#F8F4EC');
  assert.equal(c.inkLift, '#2A3244');
});

test('a THEME-ONLY config parses to a complete palette — the new default path', () => {
  const cfg = structuredClone(rawClientConfig);
  cfg.brand.theme = 'luxury';
  cfg.brand.colors = {}; // zero hex codes typed
  const parsed = clientConfigSchema.parse(cfg);
  assert.deepEqual(Object.keys(parsed.brand.colors).sort(), [...KEYS].sort());
  assert.equal(parsed.brand.colors.accent, THEME_BASES.luxury.accent.toUpperCase());
});
