/**
 * THE THEME SYSTEM — 3 inputs, 23 outputs (AL-5 landed).
 *
 * A brand is three decisions: the primary, the accent, the urgency colour.
 * Everything else in the 23-token palette is a RELATIONSHIP to those three —
 * "deep is a darker primary", "accentDark is the accent you can read on
 * white" — and a relationship stored as a second hex code is drift waiting
 * to happen (THE ONE LAW, applied to colour).
 *
 * So the config asks for a `theme` name (which picks the three bases) and
 * derives the rest here, programmatically. Two escape hatches, both
 * deliberate (§3's counter-test):
 *
 *   1. Override any of the three BASES — the whole ramp re-derives around
 *      your colour.
 *   2. Override any individual token — hand-tuned values win over derived
 *      ones, key by key. (The template itself uses this: its navy+gold ramp
 *      is a verbatim port of a live premium site, and metallic golds resist
 *      HSL math.)
 *
 * CONTRAST IS GUARANTEED, NOT HOPED FOR. The derivation nudges the stops
 * that carry WCAG duties until they pass:
 *   - urgent: white text ≥ 4.5:1 (the red CTA, N-01)
 *   - accentDark: 3.2–5.3:1 vs white — the band where the focus ring (N-02)
 *     passes on white AND stays ≥3:1 against abyss
 *   - inkMuted ≥ 4.5:1 on white; onDark/onDarkMuted ≥ 4.5:1 on abyss
 * `scripts/contrast-check.mjs` re-proves every theme; the lib harness pins it.
 *
 * Pure module: no Workers imports, so tests reach it without a runtime.
 */

export interface ThemeBases {
  primary: string;
  accent: string;
  urgent: string;
}

export type ThemeName = 'aqua' | 'luxury' | 'natural' | 'mono';

/**
 * The three shipped themes. Bases only — every other value derives.
 *   aqua     cool water blue-teal + warm amber. The "pool store" default.
 *   luxury   near-black indigo + champagne gold. The premium showroom.
 *   natural  deep forest + honey oak. The cedar-and-stone look.
 *   mono     pure black & white; ONLY the CTA carries colour. Override
 *            `accent` to make the CTA any colour a client wants.
 */
export const THEME_BASES: Record<ThemeName, ThemeBases> = {
  // Accents are deliberately BRIGHT (≲1.7:1 against white): the design
  // system's focus ring needs an accentDark that reads ≥3:1 on the accent
  // button AND stays ≥3:1 on abyss — a band that only exists when the
  // accent itself is a light CTA colour, like the ported gold.
  aqua: { primary: '#0E6BA8', accent: '#FFB347', urgent: '#D7261E' },
  luxury: { primary: '#1B1F3B', accent: '#E8C24A', urgent: '#B0201B' },
  natural: { primary: '#2E5D3F', accent: '#F2B347', urgent: '#C0392B' },
  mono: { primary: '#161616', accent: '#FF9F1C', urgent: '#D7261E' },
};

export const THEME_NAMES = Object.keys(THEME_BASES) as ThemeName[];

/* ------------------------------------------------------------------ */
/* Colour math                                                         */
/* ------------------------------------------------------------------ */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = (p: number, q: number, t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Shift lightness by `delta` (−1..1), same hue and saturation. */
export function shiftL(hex: string, delta: number): string {
  const c = hexToHsl(hex);
  return hslToHex({ ...c, l: clamp01(c.l + delta) });
}

/**
 * Rebuild a colour from the base's hue with a chosen s/l — for neutrals.
 * An achromatic base (mono theme) has no meaningful hue, so its tints stay
 * pure grey instead of inheriting hue 0 (red).
 */
function tint(hex: string, s: number, l: number): string {
  const base = hexToHsl(hex);
  return hslToHex({ h: base.h, s: base.s < 0.05 ? 0 : s, l });
}

/** WCAG relative luminance → contrast ratio. Same math as the gate script. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const chan = (i: number) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5);
  };
  const la = lum(a);
  const lb = lum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken until `ratio(colour, against) >= min`. Steps of 2% lightness. */
function darkenUntil(hex: string, against: string, min: number): string {
  let c = hex;
  for (let i = 0; i < 50 && contrastRatio(c, against) < min; i++) c = shiftL(c, -0.02);
  return c;
}

/** Lighten until `ratio(colour, against) >= min`. */
function lightenUntil(hex: string, against: string, min: number): string {
  let c = hex;
  for (let i = 0; i < 50 && contrastRatio(c, against) < min; i++) c = shiftL(c, 0.02);
  return c;
}

/* ------------------------------------------------------------------ */
/* The derivation                                                      */
/* ------------------------------------------------------------------ */

export interface BrandColors {
  primary: string;
  primaryMid: string;
  deep: string;
  night: string;
  abyss: string;
  accent: string;
  accentSoft: string;
  accentDeep: string;
  accentDark: string;
  accentLift: string;
  accentPress: string;
  accentGlow: string;
  urgent: string;
  urgentLight: string;
  urgentDark: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  inkMuted: string;
  onDark: string;
  onDarkMuted: string;
  onDarkStrong: string;
  inkLift: string;
}

/**
 * 3 bases → the full 23-token palette. Step sizes are lifted from the
 * relationships in the hand-tuned navy+gold port, so a derived ramp sits in
 * the same visual rhythm as the shipped one.
 */
export function deriveBrandColors(bases: ThemeBases): BrandColors {
  const surface = '#FFFFFF';

  // Urgency first: the red CTA carries white text (N-01). Nudge the base
  // down until that is true, then build its gradient stops from the result.
  const urgent = darkenUntil(bases.urgent.toUpperCase(), surface, 4.5);

  const primary = bases.primary.toUpperCase();
  const accent = bases.accent.toUpperCase();

  const abyss = shiftL(primary, -Math.min(0.28, Math.max(0.06, hexToHsl(primary).l - 0.07)));

  // accentDark carries three duties at once (N-02's focus ring): ≥3.2:1 on
  // white, ≥3:1 on the accent button itself, and ≥3:1 against abyss.
  // Darken until the first two hold — but never past the point where the
  // abyss side would give way. A too-dark custom accent simply can't
  // satisfy all three (which is why the shipped bases are bright).
  let accentDark = accent;
  for (let i = 0; i < 240; i++) {
    if (contrastRatio(accentDark, surface) >= 3.2 && contrastRatio(accentDark, accent) >= 3) break;
    const next = shiftL(accentDark, -0.005);
    if (contrastRatio(next, abyss) < 3) break; // abyss duty gives way first — stop
    accentDark = next;
  }

  // deep doubles as the interactive-border source: --brand-line-strong is
  // deep at 50% over the surface and must composite to ≥3:1 (N-04).
  let deep = shiftL(primary, -0.15);
  const overWhite = (hex: string): string => {
    const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
    const mix = (i: number) =>
      Math.round(ch(hex, i) * 0.5 + 255 * 0.5)
        .toString(16)
        .padStart(2, '0');
    return `#${mix(1)}${mix(3)}${mix(5)}`.toUpperCase();
  };
  for (let i = 0; i < 40 && contrastRatio(overWhite(deep), surface) < 3; i++) {
    deep = shiftL(deep, -0.02);
  }

  return {
    primary,
    primaryMid: shiftL(primary, -0.08),
    deep,
    night: shiftL(primary, -0.22),
    abyss,

    accent,
    accentSoft: shiftL(accent, 0.11),
    accentDeep: shiftL(accent, -0.1),
    accentDark,
    accentLift: shiftL(accent, 0.14),
    accentPress: shiftL(accent, -0.04),
    accentGlow: shiftL(accent, 0.22),

    urgent,
    urgentLight: shiftL(urgent, 0.05),
    urgentDark: shiftL(urgent, -0.08),

    surface,
    surfaceAlt: tint(accent, 0.35, 0.955), // warm, faintly accent-tinted band
    ink: tint(primary, 0.28, 0.11),
    inkMuted: darkenUntil(tint(primary, 0.16, 0.34), surface, 4.5),
    onDark: lightenUntil(tint(primary, 0.45, 0.86), abyss, 4.5),
    onDarkMuted: lightenUntil(tint(primary, 0.36, 0.69), abyss, 4.5),
    onDarkStrong: '#FFFFFF',
    inkLift: tint(primary, 0.22, 0.21),
  };
}

/**
 * theme + per-key overrides → the final palette (the schema's transform
 * calls this). Base overrides re-derive the ramp; token overrides win last.
 */
export function resolveBrandColors(
  theme: ThemeName,
  overrides: Partial<BrandColors> = {},
): BrandColors {
  const bases = THEME_BASES[theme];
  const derived = deriveBrandColors({
    primary: overrides.primary ?? bases.primary,
    accent: overrides.accent ?? bases.accent,
    urgent: overrides.urgent ?? bases.urgent,
  });
  return { ...derived, ...overrides };
}
