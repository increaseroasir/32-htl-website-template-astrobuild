/**
 * ACTIVE CLIENT CONFIG — the single source of truth for this site.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  THIS IS THE PLACEHOLDER TEMPLATE CONFIG.                        │
 * │  Every identity fact below is fake on purpose.                   │
 * │  deployMode is 'template', so the deploy gate will REFUSE to     │
 * │  ship it. That is what stops placeholder text reaching a live    │
 * │  client site.                                                    │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * To build a client site:
 *   npm run client:use sun-pool     (copies clients/sun-pool.config.ts here)
 * or copy any file from clients/ over this one and edit it.
 *
 * THE ONE LAW: every fact appears exactly ONCE — right here. No component,
 * page, layout or API route may contain a client fact. If you ever see the
 * same fact in two files, that is the bug. Fix the source, not the copies.
 */

import type { ClientConfigInput } from './schema';

export const rawClientConfig: ClientConfigInput = {
  // 'template' = placeholder, gate blocks deploy. 'client' = real site.
  deployMode: 'template',

  identity: {
    name: 'CLIENT NAME HERE',
    shortName: 'CLIENT',
    foundedYear: 2000,
    tagline: 'Replace this tagline with what this client actually does.',
    siteUrl: 'https://example.com',
  },

  contact: {
    // Canonical phone. tel: href AND the display string are both derived
    // from this one value — there is no second place to type a number.
    // 555-01xx is the reserved fictional range, so it is obviously fake.
    phone: '+15555550100',
    phoneDisplayOverride: null,
    smsPhone: null,
    email: 'hello@example.com',
  },

  address: {
    street: '000 Placeholder Street',
    street2: null,
    city: 'City',
    region: 'ST',
    postalCode: '00000',
    country: 'US',
    // 0,0 is Null Island — valid, and unmistakably a placeholder.
    latitude: 0,
    longitude: 0,
    googlePlaceId: null,
  },

  // One source. Feeds the footer display string AND schema.org
  // openingHoursSpecification. Never typed twice.
  hours: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '17:00' },
    { days: ['Saturday'], opens: '09:00', closes: '17:00' },
  ],

  // One source. Feeds footer icons AND JSON-LD sameAs.
  social: {
    facebook: null,
    instagram: null,
    youtube: null,
    tiktok: null,
    x: null,
    linkedin: null,
    googleBusiness: null,
  },

  /**
   * BRAND — the entire visual identity.
   *
   * THE DEFAULT PATH for a new client is now the THEME SYSTEM: set
   * `theme: 'aqua' | 'luxury' | 'natural'` and, at most, override
   * primary/accent/urgent — all 23 tokens derive with contrast guaranteed
   * (src/config/themes.ts). See clients/lakeside-hot-tubs.config.ts.
   *
   * THIS file deliberately takes the OTHER path: the full 23-key override.
   * The shipped navy+gold ramp is a hand-tuned port of a live premium site
   * (metallic golds resist HSL math), and keeping it pinned key-by-key is
   * exactly what the override door exists for. Every value below wins over
   * the theme's derived one.
   */
  brand: {
    theme: 'aqua', // irrelevant while all 23 keys below override it
    colors: {
      primary: '#16469B',
      primaryMid: '#0F327A',
      deep: '#0B2559',
      night: '#06183D',
      abyss: '#030C20',
      accent: '#FFB81C',
      accentSoft: '#FFCB57',
      accentDeep: '#E8A400',
      accentDark: '#8F6400',
      accentLift: '#FFD46A',
      accentPress: '#F0A400',
      accentGlow: '#FFE29A',
      urgent: '#D7261E',
      urgentLight: '#E8382F',
      urgentDark: '#B71E17',
      surface: '#FFFFFF',
      surfaceAlt: '#F8F4EC',
      ink: '#141927',
      inkMuted: '#4A5268',
      onDark: '#C6D4EF',
      onDarkMuted: '#8FA6D2',
      onDarkStrong: '#FFFFFF',
      inkLift: '#2A3244',
    },
    fonts: {
      display: "'Bricolage Grotesque', system-ui, sans-serif",
      body: "'Instrument Sans', system-ui, sans-serif",
      mono: "'Spline Sans Mono', ui-monospace, monospace",
      googleFontsHref:
        'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Instrument+Sans:wght@400..700&family=Spline+Sans+Mono:wght@400..600&display=swap',
    },
    // Absolute paths enforced by the schema — a relative path here would
    // 404 on nested routes, which is exactly what killed the category heroes.
    logos: {
      nav: '/brand/logo-nav.svg',
      footer: '/brand/logo-footer.svg', // knockout, for dark backgrounds + mobile drawer
      inventory: null,
      favicon: '/brand/favicon.svg',
      ogImage: '/brand/og-default.png',
    },
    radius: {
      card: 20,
      button: 14,
      pill: 999,
    },
  },

  /**
   * NAVIGATION — ONE list. The header and the footer both render from it.
   *
   * `{ type: 'categories' }` expands, at this position, into one link per
   * ENABLED category. Turning a category on therefore adds its nav link
   * automatically; turning it off removes it. There is no second list to
   * keep in sync, so labels and destinations cannot drift.
   */
  nav: {
    items: [
      { type: 'categories' },
      { type: 'link', label: 'Find Your Match', href: '/find-your-match', inHeader: true, inFooter: true },
      { type: 'link', label: 'Inventory', href: '/inventory', inHeader: true, inFooter: true },
      // Financing is NOT here by default, because `financing` below is null
      // and /financing therefore 404s. Fill in the financing block, then add:
      //   { type: 'link', label: 'Financing', href: '/financing', inHeader: true, inFooter: true },
      // The gate crawls every nav link, so advertising a page you have not
      // configured fails the build rather than shipping a dead link.
      { type: 'link', label: 'Visit Us', href: '/visit-us', inHeader: true, inFooter: true },
    ],
    // The ONE canonical "Shop Inventory" destination. On Sun Pool this
    // pointed at /book/ on the homepage and /inventory.html everywhere
    // else. Here there is one value, so it cannot disagree with itself.
    primaryCta: { label: 'Shop Inventory', href: '/inventory' },
    // Bottom-bar legal strip. In config, so the Footer component
    // contains no hard-coded hrefs of its own.
    legalItems: [{ label: 'Privacy Policy', href: '/privacy-policy' }],
  },

  /**
   * CATEGORIES — OPT-IN. The template ships with ALL of them OFF.
   *
   * A category that is not listed here does not exist on this site: no
   * route, no nav link, no footer link, no sitemap entry, no breadcrumb,
   * no quiz option, no admin dropdown entry, no API category.
   *
   * That is the saunas defect made structurally impossible. To enable one:
   *   'hot-tub': { enabled: true },
   *
   * Supported slugs: hot-tub, swim-spa, sauna, massage-chair, cold-plunge
   */
  categories: {},

  serviceAreas: [],

  /**
   * FINANCING — null means this client has no financing page, and /financing
   * returns 404. If your nav links to it, either fill this in or remove the
   * nav item: the gate crawls every nav link and will fail on the dead one.
   *
   * Never invent a rate or a term. Everything here is a client fact, and a
   * wrong one is a Truth-in-Lending problem rather than a typo.
   */
  financing: null,

  /**
   * DISPLAY — what a price is allowed to say.
   *
   * `showMonthly` is FALSE here because `financing` above is null. A monthly
   * payment is a credit offer, and an offer with no lender and no disclaimer
   * behind it is the claim that gets a client in trouble. Turning this on
   * without a financing block FAILS THE BUILD, so the two cannot disagree.
   */
  display: {
    showPrice: true,
    showMonthly: false,
  },

  /**
   * HOMEPAGE — an ordered list of sections. Reorder the list, reorder the
   * page. Delete an entry, delete that section.
   *
   * This default deliberately contains NO copy that needs replacing. The
   * headline falls back to `identity.tagline`; the category row builds itself
   * from the enabled-categories array; the product row reads live inventory.
   * A client site is therefore coherent the moment the facts above are true,
   * and there is no "Replace this headline" left to forget.
   *
   * Add stats, reviews, a comparison table, an FAQ and the rest when the
   * client gives you real material for them. Every section type is listed in
   * the schema.
   */
  homepage: {
    title: null, // falls back to identity.tagline
    description: null, // falls back to identity.tagline
    sections: [
      {
        type: 'hero',
        // null → the tagline. Nothing to replace, nothing to go stale.
        headline: null,
        actions: [{ label: 'Shop Inventory', href: '/inventory', style: 'primary' }],
      },
      // Builds itself from the enabled categories. A category the client does
      // not sell cannot appear here, because this section has no list to hold.
      { type: 'categories', heading: 'What we sell' },
      {
        type: 'products',
        heading: 'On the floor now',
        limit: 4,
        moreLink: { label: 'See everything in stock', href: '/inventory' },
      },
      {
        type: 'cta',
        heading: 'Not sure which one fits?',
        buttonLabel: 'What are you shopping for?',
        subtext: "Tell us what you're shopping for and we'll send current pricing on what's in stock.",
      },
      {
        type: 'splitcards',
        heading: 'Come see them',
        items: [
          {
            title: 'Worth the drive',
            body: "Photos don't tell you how a shell fits or how strong the jets are. Ten minutes in the showroom answers what hours of research cannot.",
            // Address and hours are READ from the config above, never typed.
            showAddress: true,
            showHours: true,
            actions: [{ label: 'Hours and directions', href: '/visit-us', style: 'primary' }],
          },
        ],
      },
    ],
    disclosures: [],
  },

  /**
   * INTEGRATIONS — binding names and on/off flags ONLY.
   * Secrets never live in config and never enter git. They are set with
   * `wrangler secret put` and read from the Worker env at runtime.
   */
  integrations: {
    d1BindingName: 'DB',
    r2BindingName: 'PRODUCT_IMAGES',
    ghl: { enabled: false },
    meta: { enabled: false },
    zaraz: { enabled: false },
    sentry: { enabled: false },
  },
};
