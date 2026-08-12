/**
 * EXAMPLE CLIENT CONFIG — Sun Pool & Spa Supply.
 *
 * This is a REFERENCE, not the template default. It lives here, outside
 * src/, so no Sun Pool fact can ever be imported by a component. The
 * template itself ships with placeholder facts and zero categories.
 *
 * To build the Sun Pool site from this template:
 *   npm run client:use sun-pool
 * (copies this file to src/config/client.config.ts)
 *
 * It exists to prove one thing: swapping THIS file for the placeholder
 * changes the entire site — name, phone, year, colours, logo, nav,
 * categories, schema.org — with zero edits to any component.
 *
 * ⚠ FIELDS MARKED "CONFIRM" ARE UNVERIFIED. They are left null rather than
 * guessed. Inventing a plausible-looking fact is exactly the class of bug
 * this template exists to prevent — a wrong fact that renders perfectly.
 */

import type { ClientConfigInput } from '../src/config/schema';

export const rawClientConfig: ClientConfigInput = {
  deployMode: 'client',

  identity: {
    name: 'Sun Pool & Spa Supply',
    // The logo says EST. 1978. On the old site, "1979" was typed into 17
    // files and one of them was wrong. Here it is one number.
    foundedYear: 1978,
    tagline: 'The best hot tub and swim spa store in San Diego County. Real units on the floor.',
    siteUrl: 'https://sunpoolandspasupply.com',
  },

  contact: {
    phone: '+16195618587',
    smsPhone: null,
    email: null, // CONFIRM — not published on the current site.
  },

  address: {
    street: '12473 Woodside Ave',
    street2: 'Suite C',
    city: 'Lakeside',
    region: 'CA',
    postalCode: '92040',
    // From TEMPLATE_DEFECTS "still open" list — the geo the old schema lacked.
    latitude: 32.857086,
    longitude: -116.924479,
    googlePlaceId: null, // CONFIRM — optional, improves the directions link.
  },

  hours: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:30', closes: '17:00' },
    { days: ['Saturday'], opens: '09:00', closes: '17:00' },
    { days: ['Sunday'], opens: '10:00', closes: '14:00' },
  ],

  // CONFIRM — the defect list says a Facebook URL existed in the old config
  // and an Instagram URL was added, but neither URL was recorded in the
  // handoff docs. Left null deliberately. Fill these in and BOTH the footer
  // icons and the JSON-LD sameAs populate from this one place.
  social: {
    facebook: null,
    instagram: null,
    youtube: null,
    tiktok: null,
    x: null,
    linkedin: null,
    googleBusiness: null,
  },

  // The navy + gold ramp, lifted from the live site's theme.css.
  brand: {
    // Same palette as before, expressed as its three decisions — the other
    // twenty tokens are derived in ramp.ts (ΔE2000 ≤ 0.18, nothing moved).
    colors: {
      primary: '#16469B', // --navy-royal
      accent: '#FFB81C', // --gold
      urgent: '#D7261E', // --red
    },
    logos: {
      nav: 'https://pub-24055549503540b0b5ff19237b87d146.r2.dev/logos/logo-nav.png',
      footer: 'https://pub-24055549503540b0b5ff19237b87d146.r2.dev/logos/logo-footer.png',
      favicon: '/brand/favicon.svg', // CONFIRM — no R2 favicon recorded.
      ogImage: '/brand/og-default.png', // CONFIRM — no R2 OG image recorded.
    },
  },

  nav: {
    items: [
      // Expands to Hot Tubs, Swim Spas — and nothing else, because nothing
      // else is enabled below. No saunas link can appear here.
      { type: 'categories' },
      { type: 'link', label: 'Find Your Match', href: '/find-your-match', inHeader: true, inFooter: true },
      { type: 'link', label: 'Inventory', href: '/inventory', inHeader: true, inFooter: true },
      // CONFIRM — Sun Pool's live site HAS a financing page, so they clearly
      // offer it. The terms were never recorded in the handoff docs, and a
      // financing rate is not something to guess at. Fill in `financing`
      // below with the real terms, then restore this line:
      //   { type: 'link', label: 'Financing', href: '/financing', inHeader: true, inFooter: true },
      // ONE label for this destination. The old site had five:
      // "Contact" / "Visit Us" / "VISIT US" / "Contact Us" / "Visit".
      { type: 'link', label: 'Visit Us', href: '/visit-us', inHeader: true, inFooter: true },
    ],
    primaryCta: { label: 'Shop Inventory', href: '/inventory' },
  },

  // Sun Pool sells hot tubs and swim spas. Nothing else is enabled, so
  // saunas / massage chairs / cold plunges do not exist on this site —
  // no page, no nav item, no sitemap entry, no admin dropdown option.
  categories: {
    'hot-tub': { enabled: true, sortOrder: 10 },
    'swim-spa': { enabled: true, sortOrder: 20 },
  },

  // Sourced from the live footer: "Serving Lakeside, El Cajon, Santee, and
  // all of East County San Diego." Not guessed.
  serviceAreas: ['Lakeside', 'El Cajon', 'Santee', 'East County San Diego'],

  // CONFIRM — they offer financing (the live site has a page for it) but no
  // terms, lender or disclaimer were recorded. Left null rather than invented:
  // a wrong rate is a Truth-in-Lending problem, not a typo. Filling this in
  // is what makes /financing exist and the nav item above safe to restore.
  financing: null,

  // HOMEPAGE — the live homepage, ported band for band. No fact from above
  // is repeated here: the phone, address, hours and product list are read at
  // render time, and no section states a years-in-business number because
  // that is derived from foundedYear.
  homepage: {
    sections: [
      /* ---------------- announcement bar ---------------- */
      {
        type: 'announcement',
        badge: 'Evergreen Catalog',
        text: 'Shop hot tubs',
        href: '/hot-tubs',
      },

      /* ---------------- hero + lead card ---------------- */
      {
        type: 'hero',
        eyebrow: 'San Diego County',
        headline: 'The Best Hot Tub & Swim Spa Store in San Diego County',
        // Rendered in the accent colour. Matched literally against the headline
        // above, so the two cannot drift apart.
        highlight: ['San Diego County'],
        subhead: 'Real units on the floor. Serving East County since 1978.',
        bullets: [],
        backgroundImage: null, // TODO: showroom photo, R2 URL
        image: null,
        promo: 'Evergreen Catalog: There has never been a better time to buy a hot tub',
        actions: [
          { label: 'Shop Inventory', href: '/inventory', style: 'primary' },
          { label: 'Request Pricing', href: '/find-your-match', style: 'secondary' },
        ],
        leadCard: {
          heading: "Get today's local price",
          subtext: "Tell us what you're looking for and we'll text you current pricing and availability.",
          footnote:
            "What happens next: we'll text you current pricing and availability, then you decide if a showroom visit makes sense. No pressure, no spam.",
        },
      },

      /* ---------------- stats band ---------------- */
      {
        type: 'stats',
        items: [
          { value: '5★', label: 'Highly rated service', claim: null },
          { value: '100%', label: 'Out-the-door pricing', claim: null },
          { value: '0', label: 'Pressure on our floor', claim: null },
          { value: '1', label: 'Visit is all it takes', claim: null },
        ],
      },

      /* ---------------- offer card ---------------- */
      {
        type: 'offercard',
        eyebrow: 'Open year-round in Lakeside',
        heading: 'There has never been a better time to buy a hot tub',
        body: 'Come see real units running on our floor, talk to the same family that has served East County, and get out-the-door pricing with nothing hidden.',
        bullets: [
          { text: 'Working models on the showroom floor — see and feel the jets before you buy', superlative: false, footnote: null },
          { text: 'Out-the-door pricing that includes delivery and professional installation', superlative: false, footnote: null },
          { text: 'Flexible financing available for all credit types', superlative: false, footnote: null },
          { text: 'Local service after the sale from the team that installed it', superlative: false, footnote: null },
        ],
        actions: [
          { label: 'Shop Available Inventory', href: '/inventory', style: 'primary' },
          { label: 'Request Pricing', href: '/find-your-match', style: 'secondary' },
        ],
      },

      /* ---------------- showroom selection (live D1) ---------------- */
      {
        type: 'products',
        eyebrow: 'In stock · no waiting',
        heading: 'Showroom Selection',
        body: 'Explore selected showroom models and ask our team about current availability.',
        limit: 4,
        category: null,
        moreLink: { label: 'See everything in stock', href: '/inventory', style: 'primary' },
        disclaimer:
          'Subject to credit approval. Terms and availability vary — ask in store for current offers.',
      },

      /* ---------------- what are you shopping for ---------------- */
      {
        type: 'imagecards',
        eyebrow: 'Find your fit',
        heading: 'What are you shopping for?',
        items: [
          {
            title: 'Hot Tubs',
            body: 'Premium hot tubs for relaxation and recovery.',
            image: null, // TODO: R2 URL
            href: '/hot-tubs',
          },
          {
            title: 'Swim Spas',
            body: 'Swim, exercise, and relax year-round in your own backyard.',
            image: null, // TODO: R2 URL
            href: '/swim-spas',
          },
          {
            title: 'Find Your Match',
            body: 'Not sure which fits? Take the 60-second quiz.',
            image: null, // TODO: R2 URL
            href: '/find-your-match',
          },
        ],
      },

      /* ---------------- reviews ---------------- */
      {
        type: 'reviews',
        eyebrow: 'Reviews',
        heading: 'Customer Reviews',
        items: [
          {
            name: 'Karen',
            rating: 5,
            quote:
              "I've used this supply store for many years as I service my own pool. I've learned to love this team! Joe, David and Paul are all incredibly knowledgeable and helpful.",
            source: 'Google Review',
            date: 'July 2026',
            location: null,
            detail: null,
          },
          {
            name: 'Andy',
            rating: 5,
            quote:
              "Worked with owner Joe. Great guy and really helped me out with getting the right hot tub. Can't wait for delivery and set up. Glad to keep business local.",
            source: 'Google Review',
            date: 'July 2026',
            location: null,
            detail: null,
          },
          {
            name: 'Meagan',
            rating: 5,
            quote:
              'I have been coming here for about 2 years and have learned so much about pool care! I am never afraid to ask questions and value their expertise!',
            source: 'Google Review',
            date: 'July 2026',
            location: null,
            detail: null,
          },
        ],
        // Feeds the visible line AND schema.org AggregateRating from one place,
        // so the two can never disagree. Re-check before launch — it moves.
        aggregate: { rating: 4.7, count: 48, source: 'Google' },
      },

      /* ---------------- comparison table ---------------- */
      {
        type: 'comparison',
        eyebrow: 'Why buy local',
        heading: 'Why Choose Us',
        body: "We're a family-owned business dedicated to our community.",
        usLabel: null, // falls back to the business name in config
        themLabel: 'Everyone else',
        rows: [
          {
            label: 'Try before you buy',
            us: 'Real units on the floor to see and touch',
            them: 'Photos and specs on a screen',
          },
          {
            label: 'Pricing',
            us: 'Out-the-door price in writing',
            them: 'Freight, crane, and setup surprises later',
          },
          {
            label: 'Delivery & setup',
            us: 'Local crew that knows your area',
            them: 'Curbside drop-off — the rest is on you',
          },
          {
            label: 'After the sale',
            us: 'A local team that answers the phone',
            them: 'A 1-800 number and a ticket queue',
          },
        ],
      },

      /* ---------------- local promise ---------------- */
      {
        type: 'promise',
        badgeValue: '100%',
        badgeLabel: 'Local promise',
        heading: 'Straight answers, no pressure',
        body: "We'd rather earn a neighbor than push a sale. Come in with questions and leave with real numbers — what you do next is up to you.",
        bullets: [
          { text: 'Out-the-door pricing in writing', superlative: false, footnote: null },
          { text: 'No pressure, no hard sell', superlative: false, footnote: null },
          { text: 'Local delivery and setup guidance', superlative: false, footnote: null },
          { text: 'Real people after the sale', superlative: false, footnote: null },
        ],
      },

      /* ---------------- financing band ---------------- */
      {
        type: 'ctaband',
        eyebrow: 'Easy financing',
        heading: 'See Your Financing Options',
        body: "Flexible monthly options can make the right spa fit your budget. Check your options in a couple of minutes — asking won't affect your credit.",
        // Points at the quiz rather than /financing, because `financing` is null
        // in client.config and that route 404s until the real terms are added.
        actions: [{ label: 'Check my options', href: '/find-your-match', style: 'primary' }],
        footnote:
          'Subject to credit approval. Terms and availability vary — ask in store for current offers.',
        tone: 'dark',
      },

      /* ---------------- worth the drive ---------------- */
      {
        type: 'splitcards',
        eyebrow: 'Visit the showroom',
        heading: 'Worth the drive',
        items: [
          {
            image: null, // TODO: storefront photo, R2 URL
            title: 'See them filled and running',
            body: "Photos don't tell you how a shell fits your body or how strong the jets are. Ten minutes in the showroom answers what hours of research can't.",
            // Address and hours are READ from config — not typed here.
            showAddress: true,
            showHours: true,
            actions: [
              { label: 'Shop Inventory', href: '/inventory', style: 'primary' },
              { label: 'Get directions', href: '/visit-us', style: 'secondary' },
            ],
          },
          {
            image: null, // TODO: team photo, R2 URL
            title: 'Talk to people who own them',
            body: 'Our team uses what we sell. Ask about maintenance, water care, and real running costs — you\'ll get straight answers, not a script.',
            showAddress: false,
            showHours: false,
            actions: [{ label: 'Visit us', href: '/visit-us', style: 'secondary' }],
          },
        ],
      },

      /* ---------------- how it works ---------------- */
      {
        type: 'steps',
        eyebrow: 'How it works',
        heading: 'From first visit to first soak',
        items: [
          {
            title: 'Come see them in person',
            body: 'Walk the floor, ask questions, and compare models side by side with someone who knows them.',
          },
          {
            title: 'Get your out-the-door price',
            body: 'One number in writing — unit, delivery, and setup — so you can decide with zero guesswork.',
          },
          {
            title: 'We handle the rest',
            body: 'Delivery, placement, and startup guidance, plus a local team you can actually call afterward.',
          },
        ],
      },

      /* ---------------- faq ---------------- */
      {
        type: 'faq',
        eyebrow: 'Got questions?',
        heading: 'Good questions to ask',
        items: [
          {
            q: 'How much does a hot tub actually cost?',
            a: "It depends on size, seating, and insulation — that's why we quote a single out-the-door number that includes delivery and setup, not a teaser price.",
          },
          {
            q: 'What does delivery involve?',
            a: 'We walk the access route with you first, then our local crew handles placement and startup guidance. If a crane is needed, you hear about it before you buy, not after.',
          },
          {
            q: 'What do I need to run one at home?',
            a: 'A level pad and the right electrical. We tell you exactly what your unit needs before delivery day so there are no surprises.',
          },
          {
            q: 'Can I finance it?',
            a: "Flexible monthly options are available for a range of credit types. Checking your options takes a couple of minutes and won't affect your credit.",
          },
        ],
      },

      /* ---------------- final CTA ---------------- */
      {
        type: 'ctaband',
        eyebrow: null,
        heading: 'Ready when you are',
        body: "Come walk the floor, or start with a quick text — either way you'll get real local pricing without the runaround.",
        actions: [
          { label: 'Request Pricing', href: '/find-your-match', style: 'primary' },
          { label: 'Visit us', href: '/visit-us', style: 'secondary' },
        ],
        footnote: null,
        tone: 'dark',
      },
    ],

    disclosures: [],
  },

  integrations: {
    ghl: { enabled: true },
    meta: { enabled: true },
    zaraz: { enabled: true },
    // Sentry stays OFF until the SDK is actually wired (AL-15) — the
    // schema refuses `true` so the privacy policy cannot claim monitoring
    // that does not exist.
    sentry: { enabled: false },
  },
};
