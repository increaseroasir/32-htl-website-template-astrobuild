import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// THE ONE LAW applies here too: the canonical site URL is not retyped in the
// build config. It is read from the same client config every page reads.
// Importing it here also means an invalid config fails at `astro build`
// startup rather than halfway through rendering.
import { writeFile, mkdir } from 'node:fs/promises';
import { site, derived, enabledCategories } from './src/config';
// Imported HERE on purpose: this file runs at build time, so an invalid
// landing page (missing footnote on a superlative, a category the client does
// not sell, no CTA) fails `npm run build` rather than surfacing as a runtime
// error on the first paid click.
import { landings } from './src/config/landings';
// Operator-only routes, one list (C10). The sitemap filter below reads it,
// the gate enforces that it keeps doing so.
import { INTERNAL_ROUTES } from './src/config/internal-routes';

/**
 * Writes the resolved config to dist/gate-manifest.json at the end of every
 * build.
 *
 * The gate runs in plain Node and cannot import the TypeScript config, so the
 * build hands it the already-validated facts instead. That also means the
 * gate checks what was actually BUILT rather than re-reading source and
 * hoping the two agree.
 */
function gateManifest() {
  return {
    name: 'gate-manifest',
    hooks: {
      'astro:build:done': async ({ dir }: { dir: URL }) => {
        const manifest = {
          generatedAt: new Date().toISOString(),
          deployMode: site.deployMode,
          identity: {
            name: site.identity.name,
            siteUrl: site.identity.siteUrl,
            foundedYear: site.identity.foundedYear,
          },
          contact: { phone: site.contact.phone, email: site.contact.email },
          address: {
            street: site.address.street,
            city: site.address.city,
            postalCode: site.address.postalCode,
            latitude: site.address.latitude,
            longitude: site.address.longitude,
          },
          hoursCount: site.hours.length,
          sameAs: derived.sameAs,
          serviceAreas: site.serviceAreas,
          categories: enabledCategories.map((c) => ({
            slug: c.slug,
            segment: c.segment,
            href: c.href,
            label: c.label,
          })),
          nav: {
            header: derived.headerNav.map((n) => ({ label: n.label, href: n.href })),
            footer: derived.footerNav.map((n) => ({ label: n.label, href: n.href })),
            primaryCta: site.nav.primaryCta,
            legalItems: site.nav.legalItems,
          },
          integrations: site.integrations,
          /**
           * Whether this client has configured financing at all, and what
           * prices are allowed to say. The gate needs both to catch a
           * monthly payment advertised with no terms behind it.
           */
          financingEnabled: site.financing !== null,
          display: site.display,
          logos: site.brand.logos,
          /**
           * Public routes the gate should crawl.
           *
           * The nav hrefs are included because they were NOT before, and a
           * nav link pointing at a page that does not exist passed every
           * check while 404ing in a customer's face. Dedup keeps the crawl
           * from fetching the same page twice.
           */
          routes: [
            ...new Set([
              '/',
              '/inventory',
              '/find-your-match',
              '/thank-you',
              '/404',
              ...enabledCategories.map((c) => c.href),
              ...derived.headerNav.map((n) => n.href),
              ...derived.footerNav.map((n) => n.href),
              site.nav.primaryCta.href,
              ...site.nav.legalItems.map((l) => l.href),
            ]),
          ].filter((href) => href.startsWith('/')),

          /** Paid landing pages — crawled separately, with opposite rules. */
          landingRoutes: landings.map((lp) => `/lp/${lp.slug}`),
          landingLabels: landings.map((lp) => lp.advertorialLabel),
          // The ONE link each page is allowed off itself, or null. The gate
          // permits exactly this href and treats any other internal link as
          // a leak.
          landingExitHrefs: landings.map((lp) => lp.exitLink?.href ?? null),
        };
        // Written to dist/, NOT dist/client/. Anything in the client dir is
        // publicly served — a manifest of the client's configuration sitting
        // at /gate-manifest.json would be an information leak, and exactly
        // the kind of "works fine, shouldn't be there" defect this gate
        // exists to catch.
        const target = new URL('../gate-manifest.json', dir);
        await mkdir(new URL('./', target), { recursive: true });
        await writeFile(target, JSON.stringify(manifest, null, 2));
      },
    },
  };
}

export default defineConfig({
  site: site.identity.siteUrl,
  output: 'server',

  // Adapter v13 wires the Cloudflare Vite plugin itself, so D1/R2 bindings
  // and env vars are available in `astro dev` with no extra options.
  adapter: cloudflare(),

  integrations: [
    // React is loaded but used ONLY for genuinely interactive islands
    // (the quiz, Phase 5). Everything else stays zero-JS static Astro.
    react(),
    gateManifest(),
    sitemap({
      // Admin is never public, never crawled, never linked.
      // /lp/ is paid-only: indexed, a landing page competes with the real
      // site for its own keywords and collects organic traffic the client is
      // already paying to reach.
      // INTERNAL_ROUTES (e.g. /proof) are the operator's own screens: a
      // sitemap entry would advertise a diagnostic page to every crawler on
      // deploy day (L-01).
      filter: (page) =>
        !page.includes('/admin') &&
        !page.includes('/lp/') &&
        !INTERNAL_ROUTES.some((route) => page.includes(route)),
      // In SSR the sitemap only sees prerendered routes, so the dynamic
      // [category] pages have to be declared. They are declared FROM the
      // enabled-categories array, which means a category the client does not
      // sell has no sitemap entry — the same single source that decides its
      // route, its nav link and its database visibility.
      customPages: enabledCategories.map((c) => new URL(c.href, site.identity.siteUrl).href),
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
