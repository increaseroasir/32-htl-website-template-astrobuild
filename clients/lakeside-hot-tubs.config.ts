/**
 * DEMO CLIENT CONFIG — Lakeside Hot Tubs (FICTIONAL).
 *
 * This is the template's exercise machine, not a real business. Its job:
 *
 *   1. Prove the THEME PATH — `theme: 'aqua'` + zero hex codes. All 23
 *      colour tokens derive from the theme's three bases (contrast
 *      enforced by src/config/themes.ts). Compare with the shipped
 *      template config, which pins its hand-tuned ramp via overrides.
 *   2. Exercise EVERY homepage section type (all 19), ALL five categories,
 *      the full financing block (so /financing exists, the nav link is
 *      legal and showMonthly is allowed), and every optional schema field.
 *
 * Build it with:  npm run client:use lakeside-hot-tubs
 * Every fact is fictional; every asset is a placeholder under /brand/.
 * Phone numbers use the reserved 555-01XX fiction range.
 */

import type { ClientConfigInput } from '../src/config/schema';

const PHOTO = '/brand/placeholder-photo.svg';

export const rawClientConfig: ClientConfigInput = {
  deployMode: 'client',

  identity: {
    name: 'Lakeside Hot Tubs',
    shortName: 'Lakeside',
    foundedYear: 2004,
    tagline: 'Hot tubs, swim spas and saunas on the shore of Lake Orion — wet-test before you buy.',
    siteUrl: 'https://demo.lakesidehottubs.example-demo.com',
    schemaType: 'HomeAndConstructionBusiness',
  },

  contact: {
    phone: '+12485550142',
    phoneDisplayOverride: null, // exercise the null path — US formatter handles it
    smsPhone: '+12485550143', // separate texting line — exercises the field
    email: 'hello@lakesidehottubs.example-demo.com',
  },

  address: {
    street: '4200 Shoreline Drive',
    street2: 'Building B',
    city: 'Lake Orion',
    region: 'MI',
    postalCode: '48362',
    country: 'US',
    latitude: 42.7845,
    longitude: -83.24,
    googlePlaceId: 'ChIJDemoPlaceIdLakesideHT', // fictional — exercises the field
  },

  hours: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], opens: '10:00', closes: '18:00' },
    { days: ['Friday', 'Saturday'], opens: '09:00', closes: '19:00' },
    { days: ['Sunday'], opens: '11:00', closes: '16:00' },
  ],

  social: {
    facebook: 'https://www.facebook.com/lakesidehottubsdemo',
    instagram: 'https://www.instagram.com/lakesidehottubsdemo',
    youtube: 'https://www.youtube.com/@lakesidehottubsdemo',
    tiktok: 'https://www.tiktok.com/@lakesidehottubsdemo',
    x: 'https://x.com/lakesidehtdemo',
    linkedin: 'https://www.linkedin.com/company/lakeside-hot-tubs-demo',
    googleBusiness: 'https://maps.google.com/?cid=demo-lakeside-hot-tubs',
  },

  /**
   * THE THEME PATH — the whole point of this demo. One word, zero hex.
   * Want a different look? Change the word. Want the client's exact brand
   * colour? `colors: { primary: '#0A7C8A' }` and the ramp re-derives.
   */
  brand: {
    theme: 'aqua',
    colors: {}, // no overrides: pure derived palette
    fonts: {
      display: "'Bricolage Grotesque', system-ui, sans-serif",
      body: "'Instrument Sans', system-ui, sans-serif",
      mono: "'Spline Sans Mono', ui-monospace, monospace",
      googleFontsHref:
        'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Instrument+Sans:wght@400..700&family=Spline+Sans+Mono:wght@400..600&display=swap',
    },
    logos: {
      nav: '/brand/logo-nav.svg',
      footer: '/brand/logo-footer.svg',
      inventory: '/brand/logo-footer.svg', // exercise the non-null path
      favicon: '/brand/favicon.svg',
      ogImage: '/brand/og-default.png',
    },
    radius: { card: 18, button: 12, pill: 999 },
  },

  nav: {
    items: [
      { type: 'categories' }, // expands to all five enabled categories
      { type: 'link', label: 'Find Your Match', href: '/find-your-match', inHeader: true, inFooter: true },
      { type: 'link', label: 'Inventory', href: '/inventory', inHeader: true, inFooter: true },
      // Legal ONLY because the financing block below is filled in — the
      // schema refuses this link when financing is null (O-17 fence).
      { type: 'link', label: 'Financing', href: '/financing', inHeader: true, inFooter: true },
      { type: 'link', label: 'Visit Us', href: '/visit-us', inHeader: true, inFooter: true },
    ],
    primaryCta: { label: 'Shop Inventory', href: '/inventory' },
    legalItems: [{ label: 'Privacy Policy', href: '/privacy-policy' }],
  },

  /** ALL FIVE categories on — with per-category overrides exercised. */
  categories: {
    'hot-tub': {
      enabled: true,
      sortOrder: 10,
      label: null,
      blurb: 'Wet-test any floor model before you buy.',
      heroImage: PHOTO,
    },
    'swim-spa': { enabled: true, sortOrder: 20, heroImage: PHOTO },
    sauna: {
      enabled: true,
      sortOrder: 30,
      label: 'Saunas & Steam', // custom label — exercises the override
      heroImage: PHOTO,
    },
    'massage-chair': { enabled: true, sortOrder: 40, heroImage: PHOTO },
    'cold-plunge': { enabled: true, sortOrder: 50, heroImage: PHOTO },
  },

  serviceAreas: ['Lake Orion', 'Oxford', 'Clarkston', 'Rochester Hills', 'North Oakland County'],

  /** FULL financing block — makes /financing exist, the nav link legal,
   *  and display.showMonthly permissible. All wording fictional. */
  financing: {
    headline: 'Own it from $89 a month',
    blurb:
      'Twelve-month same-as-cash and longer terms through our demo lending partner, decided in minutes in the showroom or online.',
    bullets: [
      '12 months same-as-cash on purchases over $3,000',
      'Terms up to 84 months on approved credit',
      'No prepayment penalty, ever',
    ],
    lenderName: 'Demo Finance Co.',
    applyUrl: 'https://apply.example-demo-lender.com/lakeside',
    disclaimer:
      'DEMO COPY. All financing offers on approved credit through Demo Finance Co. Monthly figures are illustrations, not offers of credit; your rate and term depend on approval. This fictional wording exists to exercise the template.',
  },

  display: {
    showPrice: true,
    showMonthly: true, // legal only because financing above is real
  },

  homepage: {
    title: 'Lakeside Hot Tubs — hot tubs, swim spas & saunas in Lake Orion, MI',
    description:
      'Demo homepage exercising every section type the template ships. Wet-test hot tubs and swim spas on the floor in Lake Orion.',

    sections: [
      /* 1 — announcement (must be first when present) */
      {
        type: 'announcement',
        badge: 'DEMO SITE',
        text: 'Spring open-house pricing on floor models',
        href: '/inventory',
      },

      /* 2 — hero, every option exercised incl. the lead card */
      {
        type: 'hero',
        eyebrow: 'Lake Orion, Michigan',
        headline: 'The Widest Wet-Test Floor in North Oakland County',
        highlight: ['Wet-Test Floor'],
        subhead:
          'Try before you buy in a private test room — hot tubs, swim spas, saunas, cold plunges and massage chairs under one roof.',
        bullets: [
          { text: 'Every floor model filled and running', superlative: false, footnote: null },
          {
            text: 'Widest wet-test selection in the county',
            superlative: true,
            footnote: 'Demo substantiation: count of filled display units among county spa retailers, fictional survey, spring 2026.',
          },
        ],
        backgroundImage: PHOTO,
        image: null,
        promo: 'Open-house weekend: delivery included on floor models',
        actions: [
          { label: 'Shop Inventory', href: '/inventory', style: 'primary' },
          { label: 'Book a wet test', href: '/visit-us', style: 'secondary' },
        ],
        leadCard: {
          heading: 'Get today’s floor-model pricing',
          subtext: 'Tell us what you’re shopping for — we reply during store hours.',
          footnote: 'No spam, no list-selling. One conversation.',
        },
      },

      /* 3 — trust strip */
      {
        type: 'trust',
        items: ['Family-run since 2004', 'Factory-trained installers', 'Wet tests by appointment', 'Trade-ins welcome'],
        logos: [
          { src: PHOTO, alt: 'Demo brand partner one' },
          { src: PHOTO, alt: 'Demo brand partner two' },
        ],
      },

      /* 4 — stats band */
      {
        type: 'stats',
        items: [
          { value: '21', label: 'years on the lake', claim: null },
          { value: '38', label: 'filled display units', claim: null },
          {
            value: '#1',
            label: 'wet-test floor in the county',
            claim: {
              text: '#1 wet-test floor in the county',
              superlative: true,
              footnote: 'Demo substantiation: same fictional survey as above.',
            },
          },
        ],
      },

      /* 5 — categories row (renders from the enabled array — all five) */
      {
        type: 'categories',
        eyebrow: 'Five ways to soak, swim and recover',
        heading: 'What we sell',
        body: 'Turn a category off in config and it vanishes from this row, the nav, the sitemap and the quiz — one switch.',
        showImages: true,
      },

      /* 6 — live products from D1 */
      {
        type: 'products',
        eyebrow: 'On the floor now',
        heading: 'Fresh inventory',
        body: 'Real units, real availability — this grid reads the database.',
        limit: 8,
        category: null,
        moreLink: { label: 'See everything on the floor', href: '/inventory', style: 'secondary' },
        disclaimer: 'Monthly figures illustrate financing on approved credit through Demo Finance Co.',
      },

      /* 7 — offer card */
      {
        type: 'offercard',
        eyebrow: 'Open-house week',
        heading: 'Floor-model clearance, delivery included',
        body: 'Every filled display unit is priced to move before the new container lands.',
        bullets: [
          { text: 'Delivery and setup included within 30 miles', superlative: false, footnote: null },
          { text: 'Water-care starter kit with every tub', superlative: false, footnote: null },
        ],
        actions: [{ label: 'Claim a floor model', href: '/inventory', style: 'primary' }],
      },

      /* 8 — image cards */
      {
        type: 'imagecards',
        eyebrow: 'Not sure where to start?',
        heading: 'Shop by what you want to feel',
        items: [
          { title: 'Unwind nightly', body: 'Jets, lounge seats, silence.', image: PHOTO, href: '/hot-tubs' },
          { title: 'Train at home', body: 'Swim current, all seasons.', image: PHOTO, href: '/swim-spas' },
          { title: 'Recover faster', body: 'Heat, then plunge.', image: PHOTO, href: '/saunas' },
        ],
      },

      /* 9 — benefits */
      {
        type: 'benefits',
        heading: 'Why buy from a showroom instead of a website',
        items: [
          { title: 'Wet-test first', body: 'Sit in it, run the jets, hear it — before any money moves.', icon: PHOTO },
          { title: 'Our own crew delivers', body: 'No third-party freight drop at the curb. We place, fill and teach.', icon: PHOTO },
          { title: 'Water care for life', body: 'Free computerised water testing for as long as you own it.', icon: PHOTO },
        ],
      },

      /* 10 — comparison table */
      {
        type: 'comparison',
        eyebrow: 'The showroom difference',
        heading: 'Us vs. buying a box off the internet',
        body: null,
        usLabel: null, // falls back to the business name at render
        themLabel: 'Big-box websites',
        rows: [
          { label: 'Try before you buy', us: 'Filled wet-test floor', them: 'A photo and a prayer' },
          { label: 'Delivery', us: 'Our crew, placed and filled', them: 'Curbside pallet' },
          { label: 'After the sale', us: 'Local techs, real phone number', them: 'A ticket queue' },
        ],
      },

      /* 11 — promise band */
      {
        type: 'promise',
        badgeValue: '100%',
        badgeLabel: 'local promise',
        heading: 'Bought here, backed here',
        body: 'Every unit we sell is serviced by the crew that delivered it.',
        bullets: [
          { text: 'Local service techs on staff', superlative: false, footnote: null },
          { text: 'Loaner cover while yours is repaired', superlative: false, footnote: null },
          { text: 'Trade-in credit on upgrades', superlative: false, footnote: null },
        ],
      },

      /* 12 — split cards (address + hours flags exercised) */
      {
        type: 'splitcards',
        eyebrow: 'Two ways to start',
        heading: 'Come to the lake, or start online',
        items: [
          {
            image: PHOTO,
            title: 'Visit the showroom',
            body: 'Bring a swimsuit. Private wet-test rooms, kids welcome, towels on us.',
            showAddress: true,
            showHours: true,
            actions: [{ label: 'Get directions', href: '/visit-us', style: 'secondary' }],
          },
          {
            image: PHOTO,
            title: 'Start with the 60-second match',
            body: 'Answer three questions and we’ll shortlist units that fit your space and budget.',
            showAddress: false,
            showHours: false,
            actions: [{ label: 'Find your match', href: '/find-your-match', style: 'primary' }],
          },
        ],
      },

      /* 13 — steps */
      {
        type: 'steps',
        eyebrow: 'How it works',
        heading: 'From first soak to first party in four steps',
        items: [
          { title: 'Wet test', body: 'Try the shortlist in a private room.' },
          { title: 'Site check', body: 'We confirm access, pad and power.' },
          { title: 'Delivery day', body: 'Placed, filled, balanced, explained.' },
          { title: 'First-month check-in', body: 'We come back and retest your water.' },
        ],
      },

      /* 14 — gallery */
      {
        type: 'gallery',
        heading: 'Recent deliveries around the lake',
        images: [
          { src: PHOTO, alt: 'Demo delivery photo one — backyard install' },
          { src: PHOTO, alt: 'Demo delivery photo two — deck install' },
          { src: PHOTO, alt: 'Demo delivery photo three — patio install' },
          { src: PHOTO, alt: 'Demo delivery photo four — winter soak' },
        ],
      },

      /* 15 — reviews with aggregate (feeds schema.org AggregateRating) */
      {
        type: 'reviews',
        eyebrow: 'Neighbours first',
        heading: 'What Lake Orion says',
        items: [
          {
            name: 'Dana K.',
            quote: 'Wet-tested three tubs on a Tuesday, soaking in my own by Friday.',
            rating: 5,
            source: 'Google (demo)',
            date: '2026-04',
            location: 'Lake Orion',
            detail: 'Six-seat lounger, delivered and filled.',
          },
          {
            name: 'Marcus B.',
            quote: 'The swim spa install was cleaner than my kitchen reno. Crew knew their stuff.',
            rating: 5,
            source: 'Facebook (demo)',
            date: '2026-02',
            location: 'Clarkston',
            detail: null,
          },
          {
            name: 'Priya S.',
            quote: 'Sauna-and-plunge combo changed my winters. Free water testing is real, I go monthly.',
            rating: 4.5,
            source: 'Google (demo)',
            date: '2025-12',
            location: 'Oxford',
            detail: null,
          },
        ],
        aggregate: { rating: 4.9, count: 212, source: 'Google (demo)' },
      },

      /* 16 — big number */
      {
        type: 'bignumber',
        value: '3,400+',
        label: 'backyards warmed since 2004',
        claim: null,
      },

      /* 17 — FAQ */
      {
        type: 'faq',
        eyebrow: 'Straight answers',
        heading: 'What everyone asks first',
        items: [
          { q: 'Do I need special wiring?', a: 'Most hot tubs need a 220V GFCI circuit; plug-and-play models run on a standard outlet. The site check confirms it before delivery.' },
          { q: 'Can I really try one filled?', a: 'Yes — book a wet test, bring a swimsuit, and we close the door. Towels are on us.' },
          { q: 'What does delivery include?', a: 'Placement, filling, chemical balance and a walkthrough. Crane lifts are quoted at the site check.' },
          { q: 'Do you take trade-ins?', a: 'Working or not — we quote trade-in credit at the showroom.' },
        ],
      },

      /* 18 — CTA band (dark tone) */
      {
        type: 'ctaband',
        eyebrow: 'Open-house week',
        heading: 'The lake is cold. Your water doesn’t have to be.',
        body: 'Floor-model pricing ends when the container lands.',
        actions: [
          { label: 'Shop floor models', href: '/inventory', style: 'primary' },
          { label: 'Book a wet test', href: '/visit-us', style: 'secondary' },
        ],
        footnote: 'Delivery included within 30 miles on floor models.',
        tone: 'dark',
      },

      /* 19 — the lead form as its own section */
      {
        type: 'cta',
        heading: 'Get floor-model pricing by text',
        buttonLabel: 'Send me the list',
        subtext: 'One reply with current pricing. No drip campaign.',
      },
    ],

    /** Prints the superlative substantiations (required — two superlatives above). */
    disclosures: [
      'Demo substantiation: "widest wet-test selection" and "#1 wet-test floor" refer to a fictional spring 2026 survey of filled display units among North Oakland County spa retailers. This is a demonstration site; every fact on it is invented.',
    ],
  },

  integrations: {
    d1BindingName: 'DB',
    r2BindingName: 'PRODUCT_IMAGES',
    ghl: { enabled: true },
    meta: { enabled: true },
    zaraz: { enabled: true },
    // OFF until the SDK exists — the schema refuses `true` (K-07/AL-15).
    sentry: { enabled: false },
  },
};
