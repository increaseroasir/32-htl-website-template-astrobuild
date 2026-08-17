#!/usr/bin/env node
/**
 * WCAG contrast proof for EVERY palette the template can produce (C15 + the
 * theme system).
 *
 *   node scripts/contrast-check.mjs
 *
 * Checks the resolved template palette (its hand-tuned overrides) AND each
 * shipped theme's fully derived palette against the invariants the sweep's
 * AA fixes rely on (N-01..N-04, N-07). Numbers are DERIVED from the real
 * config + derivation code — never typed from memory (the O-area lesson).
 * Exit 1 on any failure, so this can sit in CI or a pre-release habit.
 */
import { register } from 'node:module';

register(new URL('../tests/lib/ts-resolver.mjs', import.meta.url));

const { THEME_BASES, deriveBrandColors, resolveBrandColors, contrastRatio } = await import(
  '../src/config/themes.ts'
);
const { rawClientConfig } = await import('../src/config/client.config.ts');

/** The invariant table. `against` names read from the palette itself. */
function rows(c) {
  // Composite an alpha'd white border over a dark base (N-03's ghost border).
  const over = (fg, alpha, bg) => {
    const ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
    const mix = (i) =>
      Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha))
        .toString(16)
        .padStart(2, '0');
    return `#${mix(1)}${mix(3)}${mix(5)}`;
  };
  return [
    ['N-01 white on urgent (red CTA top)', contrastRatio(c.onDarkStrong, c.urgent), 4.5],
    ['N-01 white on urgentDark (red CTA bottom)', contrastRatio(c.onDarkStrong, c.urgentDark), 4.5],
    ['N-02 focus accentDark vs surface', contrastRatio(c.accentDark, c.surface), 3],
    ['N-02 focus accentDark vs abyss', contrastRatio(c.accentDark, c.abyss), 3],
    ['N-02 focus accentDark vs accent (gold btn)', contrastRatio(c.accentDark, c.accent), 3],
    ['N-02 focus white inner ring vs primary', contrastRatio(c.onDarkStrong, c.primary), 3],
    ['N-03 ghost border white@.4 over abyss', contrastRatio(over(c.onDarkStrong, 0.4, c.abyss), c.abyss), 3],
    ['N-04 line-strong deep@.5 over surface', contrastRatio(over(c.deep, 0.5, c.surface), c.surface), 3],
    ['body inkMuted on surface', contrastRatio(c.inkMuted, c.surface), 4.5],
    ['body onDark on abyss', contrastRatio(c.onDark, c.abyss), 4.5],
    ['body onDarkMuted on abyss', contrastRatio(c.onDarkMuted, c.abyss), 4.5],
  ];
}

let bad = 0;
function report(label, palette) {
  console.log(`\n${label}`);
  for (const [name, r, min] of rows(palette)) {
    const ok = r >= min;
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  (needs ${min}:1)  ${name}`);
  }
}

// 1. The template's shipped palette (theme + its overrides, resolved the
//    same way the schema resolves it).
const b = rawClientConfig.brand;
report('template (resolved)', resolveBrandColors(b.theme ?? 'aqua', b.colors ?? {}));

// 2. Every shipped theme, purely derived.
for (const [name, bases] of Object.entries(THEME_BASES)) {
  report(`theme: ${name} (derived)`, deriveBrandColors(bases));
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall palettes pass');
process.exit(bad ? 1 : 0);
