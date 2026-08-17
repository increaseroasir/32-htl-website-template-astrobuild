/**
 * INTERNAL ROUTES — operator-only pages that must NEVER be advertised.
 *
 * Every entry here is (a) filtered out of the sitemap at build time,
 * (b) blocked in public/_headers with noindex + no-store, and (c) covered
 * by the gate check 'Internal routes are delisted', which fails the build
 * if astro.config.ts stops reading this list or the list goes empty.
 *
 * Track B's unlock-bypass route appends itself here later — the fence is
 * built one client early on purpose (D0 rung 1 / L-01).
 *
 * /admin is handled separately (server auth + its own header block);
 * this list is for pages that render without auth but are nobody's
 * business but the operator's.
 */
export const INTERNAL_ROUTES = ['/proof'] as const;
