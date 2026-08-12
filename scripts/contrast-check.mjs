#!/usr/bin/env node
/**
 * WCAG relative-luminance contrast calculator (C15).
 *
 *   node scripts/contrast-check.mjs
 *
 * Prints the contrast ratios the sweep's AA fixes (N-01..N-04, N-07)
 * depend on, computed from the CURRENT template config — so the numbers
 * in the commit body are derived, never typed from memory (the O-area
 * lesson). Re-run after any palette change.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Pull the hex values straight out of client.config.ts — no second copy.
const config = await readFile(join(ROOT, 'src', 'config', 'client.config.ts'), 'utf8');
const colorOf = (key) => {
  const m = config.match(new RegExp(`${key}:\\s*'(#[0-9a-fA-F]{6})'`));
  if (!m) throw new Error(`token ${key} not found in client.config.ts`);
  return m[1];
};

function luminance(hex) {
  const c = hex.replace('#', '');
  const chan = (i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

export function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Alpha-composite fg over bg (both hex), returns effective hex. */
function over(fgHex, alpha, bgHex) {
  const f = fgHex.replace('#', '');
  const g = bgHex.replace('#', '');
  const mix = (i) =>
    Math.round(
      parseInt(f.slice(i, i + 2), 16) * alpha + parseInt(g.slice(i, i + 2), 16) * (1 - alpha),
    )
      .toString(16)
      .padStart(2, '0');
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}

const white = colorOf('onDarkStrong');
const abyss = colorOf('abyss');
const accent = colorOf('accent');
const accentDark = colorOf('accentDark');
const urgent = colorOf('urgent');
const urgentDark = colorOf('urgentDark');
const surface = colorOf('surface');
const deep = colorOf('deep');

const rows = [
  ['N-01 white on urgent (red CTA top stop)', ratio(white, urgent), 4.5],
  ['N-01 white on urgentDark (red CTA bottom)', ratio(white, urgentDark), 4.5],
  ['N-02 focus accentDark vs surface(white)', ratio(accentDark, surface), 3],
  ['N-02 focus accentDark vs abyss', ratio(accentDark, abyss), 3],
  ['N-02 focus accentDark vs accent (gold btn)', ratio(accentDark, accent), 3],
  ['N-02 focus white inner ring vs primary', ratio(white, colorOf('primary')), 3],
  ['N-03 ghost border white@.4 over abyss', ratio(over(white, 0.4, abyss), abyss), 3],
  ['N-04 line-strong deep@.5 over surface', ratio(over(deep, 0.5, surface), surface), 3],
];

let bad = 0;
for (const [label, r, min] of rows) {
  const ok = r >= min;
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  (needs ${min}:1)  ${label}`);
}
process.exit(bad ? 1 : 0);
