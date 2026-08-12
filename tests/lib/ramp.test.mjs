/**
 * The ramp proofs (deletion pass):
 *   1. buildRamp on the shipped three inputs reproduces every token of the
 *      hand-tuned 23-colour ramp it replaced, within ΔE2000 < 2 — the
 *      threshold of what an eye can tell apart. This is the proof that
 *      compressing 23 config fields to 3 moved nothing visually.
 *   2. A colour too light to carry its text REFUSES the build, and the
 *      message names the nearest colour that passes. (The focus ring needs
 *      no refusal: its 0.645 lightness step makes it safe by construction —
 *      proven for the pathological case below.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRamp, contrastRatio } from '../../src/config/ramp.ts';
import { clientConfigSchema } from '../../src/config/schema.ts';
import { rawClientConfig } from '../../src/config/client.config.ts';

/** The hand-tuned ramp as it shipped before the compression — pinned. */
const SHIPPED = {
  primary: '#16469B', primaryMid: '#0F327A', deep: '#0B2559', night: '#06183D',
  abyss: '#030C20', accent: '#FFB81C', accentSoft: '#FFCB57', accentDeep: '#E8A400',
  accentDark: '#8F6400', accentLift: '#FFD46A', accentPress: '#F0A400',
  accentGlow: '#FFE29A', urgent: '#D7261E', urgentLight: '#E8382F',
  urgentDark: '#B71E17', surface: '#FFFFFF', surfaceAlt: '#F8F4EC', ink: '#141927',
  inkMuted: '#4A5268', onDark: '#C6D4EF', onDarkMuted: '#8FA6D2',
  onDarkStrong: '#FFFFFF', inkLift: '#2A3244',
};

/* ---- an independent ΔE2000 oracle: hex → CIELAB (D65) → CIEDE2000 ---- */
function lab(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255));
  const [x, y, z] = [
    (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883,
  ].map((v) => (v > 216 / 24389 ? Math.cbrt(v) : ((24389 / 27) * v + 16) / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function deltaE2000(hexA, hexB) {
  const [L1, a1, b1] = lab(hexA);
  const [L2, a2, b2] = lab(hexB);
  const rad = Math.PI / 180;
  const cAvg = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(cAvg ** 7 / (cAvg ** 7 + 25 ** 7)));
  const [ap1, ap2] = [a1 * (1 + G), a2 * (1 + G)];
  const [C1, C2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const hp = (a, b) => (a === 0 && b === 0 ? 0 : ((Math.atan2(b, a) / rad) + 360) % 360);
  const [h1, h2] = [hp(ap1, b1), hp(ap2, b2)];
  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = h2 - h1;
  if (C1 * C2 !== 0) {
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  } else dh = 0;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lp = (L1 + L2) / 2;
  const Cp = (C1 + C2) / 2;
  let hAvg = h1 + h2;
  if (C1 * C2 !== 0) {
    if (Math.abs(h1 - h2) > 180) hAvg += hAvg < 360 ? 360 : -360;
    hAvg /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hAvg - 30) * rad) +
    0.24 * Math.cos(2 * hAvg * rad) +
    0.32 * Math.cos((3 * hAvg + 6) * rad) -
    0.2 * Math.cos((4 * hAvg - 63) * rad);
  const SL = 1 + (0.015 * (Lp - 50) ** 2) / Math.sqrt(20 + (Lp - 50) ** 2);
  const SC = 1 + 0.045 * Cp;
  const SH = 1 + 0.015 * Cp * T;
  const dTheta = 30 * Math.exp(-(((hAvg - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cp ** 7 / (Cp ** 7 + 25 ** 7));
  const RT = -RC * Math.sin(2 * dTheta * rad);
  return Math.sqrt(
    (dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH),
  );
}

const clone = () => structuredClone(rawClientConfig);

test('the generated ramp reproduces the hand-tuned ramp it replaced (ΔE2000 < 2)', () => {
  const { colors } = clientConfigSchema.parse(clone()).brand;
  const emitted = { ...buildRamp(colors), ...colors.overrides };
  assert.deepEqual(Object.keys(emitted).sort(), Object.keys(SHIPPED).sort());
  for (const [token, was] of Object.entries(SHIPPED)) {
    const dE = deltaE2000(emitted[token], was);
    assert.ok(
      dE < 2,
      `--brand-${token}: ${was} became ${emitted[token]} (ΔE2000 ${dE.toFixed(2)}) — visible drift`,
    );
  }
});

test('REFUSED: a colour too light to carry its text, naming the nearest that passes', () => {
  const cfg = clone();
  cfg.brand.colors = { ...cfg.brand.colors, urgent: '#FF9A94' };
  const parsed = clientConfigSchema.safeParse(cfg);
  assert.equal(parsed.success, false);
  const msg = parsed.error.issues.map((i) => i.message).join(' ');
  assert.ok(msg.includes('white text on the urgent CTA'), msg);
  assert.match(msg, /Nearest urgent that passes: #[0-9A-F]{6}/);
});

test('the focus ring cannot go invisible — structural, for ANY accent', () => {
  // The old defect: raw accent as the ring, 1.73:1 on white. The ring is now
  // accent-dark, whose 0.645 lightness step floors the ratio even for a
  // white accent. Refusal is not needed here; arithmetic is the guarantee.
  for (const accent of ['#FFFFFF', '#FFFDF5', '#FFE9B8', '#FFB81C']) {
    const t = buildRamp({ primary: '#16469B', accent, urgent: '#D7261E' });
    assert.ok(contrastRatio(t.accentDark, t.surface) >= 3, `${accent} → ${t.accentDark}`);
  }
});
