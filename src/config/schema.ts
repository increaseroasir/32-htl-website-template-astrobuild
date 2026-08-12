/**
 * CLIENT CONFIG SCHEMA — the contract for THE ONE LAW.
 *
 * Every fact that differs between clients is declared here exactly once.
 * If a fact is not in this schema, it does not belong in a component.
 *
 * This schema is not documentation — it is enforcement. `npm run build`
 * validates the active client config against it and FAILS on:
 *   - a colour that is not a 6-digit hex
 *   - an asset path that is not absolute (the category-hero 404 defect)
 *   - a phone that is not E.164 (so every tel: link is derivable)
 *   - a nav item pointing at a category that is not enabled
 *   - a founding year in the future
 *   - a missing geo coordinate when hours/address are set (schema.org needs it)
 */

import { z } from 'zod';
import { CATEGORY_SLUGS } from './categories';
import { sectionSchema, collectFootnotes } from './sections.schema';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex colour like #16469B');

/**
 * Absolute asset path guardrail.
 * TEMPLATE_DEFECTS: category hero images 404'd because `src="assets/…"`
 * resolved to `/hot-tubs/assets/…` on nested routes. A relative path cannot
 * enter the config, so it cannot reach a component.
 */
const absoluteAsset = z
  .string()
  .min(1)
  .refine(
    (v) => v.startsWith('/') || v.startsWith('https://'),
    'Asset paths must be absolute: start with "/" or "https://". Relative paths 404 on nested routes.',
  );

const httpsUrl = z.url({ protocol: /^https$/, error: 'Must be an https:// URL' });

/** E.164, e.g. +16195618587. One canonical phone; display + tel: are derived. */
const e164Phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164, e.g. +16195618587');

/** 24h "HH:MM" — feeds both the human display string and schema.org. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24h HH:MM, e.g. 09:30');

export const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/* ------------------------------------------------------------------ */
/* Brand — the whole visual identity, one place                        */
/* ------------------------------------------------------------------ */

const brandSchema = z.object({
  /**
   * Colour ramp. These become CSS custom properties at build time.
   * NO component may contain a hex code — it reads var(--brand-*) instead.
   * Client B changes these nine values and gets a different-looking site.
   */
  colors: z.object({
    // --- Primary ramp (Sun Pool: navy) ---
    primary: hexColor, // --navy-royal
    primaryMid: hexColor, // --navy-mid
    deep: hexColor, // --navy-deep
    night: hexColor, // --navy-night
    abyss: hexColor, // --navy-abyss, hero base

    // --- Accent ramp (Sun Pool: gold). The three gradient stops are real
    // tokens, not literals in a stylesheet, so a client with a different
    // accent still gets a correct button gradient from config alone. ---
    accent: hexColor, // --gold, the CTA colour
    accentSoft: hexColor, // --gold-soft, headings on dark
    accentDeep: hexColor, // --gold-deep
    accentDark: hexColor, // --gold-dark, accent text on light (contrast-safe)
    accentLift: hexColor, // top stop of the CTA gradient
    accentPress: hexColor, // bottom stop of the CTA gradient
    accentGlow: hexColor, // lightest stop, gradient accent text

    // --- Urgency ramp ---
    urgent: hexColor,
    urgentLight: hexColor, // top stop of the red gradient
    urgentDark: hexColor, // bottom stop of the red gradient

    // --- Neutrals ---
    surface: hexColor, // page background
    surfaceAlt: hexColor, // alternating band background (--sand)
    ink: hexColor, // body text on light
    inkMuted: hexColor, // secondary text on light (--ink-soft)
    onDark: hexColor, // body text on dark
    onDarkMuted: hexColor, // secondary text on dark
    onDarkStrong: hexColor, // FULL-strength text/icons on dark (C-02): the
    // 25 hand-typed #fff literals existed because this word was missing.
    inkLift: hexColor, // lifted ink — gradient top over `ink` surfaces
    // (sold-pill top stop, C-03). Not a neutral: pairs with `ink`.

    // NOTE: there is no `line` token. Hairline borders are DERIVED from
    // `deep` at 12% alpha, because that is what they are — one colour at an
    // opacity, not a second colour that could drift out of step with it.
  }),

  /** Font families. Loaded once in the base layout, referenced by token. */
  fonts: z.object({
    display: z.string().min(1), // headings, buttons
    body: z.string().min(1), // paragraphs
    mono: z.string().min(1), // eyebrows, labels, pills
    /** Google Fonts href, or null if self-hosting. */
    googleFontsHref: z.url().nullable(),
  }),

  /**
   * Logos. Separate light/dark variants exist because the Sun Pool mobile
   * drawer showed text on a dark background — a missing knockout logo.
   */
  logos: z.object({
    nav: absoluteAsset, // header, light background
    footer: absoluteAsset, // knockout, dark background — also used by mobile drawer
    inventory: absoluteAsset.nullable(), // inventory gate / lead card
    favicon: absoluteAsset,
    ogImage: absoluteAsset,
  }),

  /** Corner radius scale, in px. Sun Pool: cards 20, buttons 14. */
  radius: z.object({
    card: z.number().int().min(0).max(48),
    button: z.number().int().min(0).max(48),
    pill: z.number().int().min(0).max(999),
  }),
});

/* ------------------------------------------------------------------ */
/* Identity, contact, location                                         */
/* ------------------------------------------------------------------ */

const identitySchema = z.object({
  /** Legal / display business name. Appears in nav, footer, schema, titles. */
  name: z.string().min(1),
  /** Short name for tight spaces (mobile nav, footer bottom). */
  shortName: z.string().min(1),
  /**
   * Founding year. TEMPLATE_DEFECTS: "1979" appeared in 17 files while the
   * logo said 1978. Here it exists once; `yearsInBusiness` is derived.
   */
  foundedYear: z
    .number()
    .int()
    .min(1800)
    .max(new Date().getFullYear()),
  /** One-sentence description. Used for meta description fallback + schema. */
  tagline: z.string().min(1),
  /** Production origin, no trailing slash. Drives canonical URLs + sitemap. */
  siteUrl: httpsUrl,
  /**
   * schema.org type for the business. A more specific type than
   * LocalBusiness helps local search understand what the shop is, and it is
   * a client fact — a spa dealer and a pool-supply store are not the same
   * thing. Defaults so existing configs keep working untouched.
   * See https://schema.org/LocalBusiness for the subtypes.
   */
  schemaType: z.string().min(1).default('HomeAndConstructionBusiness'),
});

const contactSchema = z.object({
  /** Canonical phone. tel: href and the display string are both derived. */
  phone: e164Phone,
  /**
   * Only set this for non-US numbers the default formatter cannot render.
   * Leave null and the display string is derived from `phone`.
   */
  phoneDisplayOverride: z.string().min(1).nullable(),
  /** Optional separate SMS number. Falls back to `phone` when null. */
  smsPhone: e164Phone.nullable(),
  /** Null when the client does not publish an email address. */
  email: z.email().nullable(),
});

const addressSchema = z.object({
  street: z.string().min(1),
  street2: z.string().nullable(),
  city: z.string().min(1),
  region: z.string().min(1), // state / province
  postalCode: z.string().min(1),
  country: z.string().length(2), // ISO-3166 alpha-2
  /**
   * Geo is REQUIRED, not optional. TEMPLATE_DEFECTS: LocalBusiness schema
   * shipped with no geo. Making it required means the schema cannot be
   * incomplete — the build fails instead.
   */
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Optional Google Place ID — improves the derived map + directions links. */
  googlePlaceId: z.string().nullable(),
});

const hoursRangeSchema = z.object({
  days: z.array(z.enum(DAYS)).min(1),
  opens: timeOfDay,
  closes: timeOfDay,
});

/* ------------------------------------------------------------------ */
/* Social — one source for footer icons AND schema.org sameAs          */
/* ------------------------------------------------------------------ */

const socialSchema = z.object({
  facebook: httpsUrl.nullable(),
  instagram: httpsUrl.nullable(),
  youtube: httpsUrl.nullable(),
  tiktok: httpsUrl.nullable(),
  x: httpsUrl.nullable(),
  linkedin: httpsUrl.nullable(),
  googleBusiness: httpsUrl.nullable(),
});

/* ------------------------------------------------------------------ */
/* Navigation — ONE list, rendered by header AND footer                */
/* ------------------------------------------------------------------ */

/**
 * TEMPLATE_DEFECTS: /contact.html had FIVE different labels across pages,
 * the quiz link existed only on the homepage, Inventory was missing from
 * category nav, and Shop Inventory pointed at /book/ on one page.
 *
 * All of that came from hand-typing nav per page. Here there is one array.
 * A label exists once. An href exists once.
 *
 * `{ type: 'categories' }` is a placeholder that expands, at that position,
 * into one item per ENABLED category. Enabling a category therefore adds its
 * nav link automatically — there is no second place to update.
 */
const navItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('categories'),
  }),
  z.object({
    type: z.literal('link'),
    label: z.string().min(1),
    href: z.string().min(1).startsWith('/', 'Internal nav hrefs must start with "/"'),
    /** Hide from the header but keep in the footer, or vice versa. */
    inHeader: z.boolean().default(true),
    inFooter: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('external'),
    label: z.string().min(1),
    href: httpsUrl,
    inHeader: z.boolean().default(false),
    inFooter: z.boolean().default(true),
  }),
]);

const ctaSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Categories — OPT-IN. Absent means OFF.                              */
/* ------------------------------------------------------------------ */

/**
 * TEMPLATE_DEFECTS: saunas scaffolding appeared in 26 files for a client who
 * does not sell saunas, because the template shipped every category ON.
 *
 * Here, a category the client has not listed does not exist: no route, no nav
 * item, no footer link, no sitemap entry, no quiz option, no admin dropdown
 * entry, no API category. Turning one on is `enabled: true` on one line.
 */
const categoryOverrideSchema = z.object({
  enabled: z.boolean().default(false),
  /** Override the catalog label if this client calls it something else. */
  label: z.string().min(1).nullable().default(null),
  blurb: z.string().min(1).nullable().default(null),
  /** Category hero image. Absolute path enforced. */
  heroImage: absoluteAsset.nullable().default(null),
  /** Display order in nav and listings. Lower first. */
  sortOrder: z.number().int().default(0),
});

/* ------------------------------------------------------------------ */
/* Financing — optional, and every word of it is a client fact         */
/* ------------------------------------------------------------------ */

/**
 * Financing terms are client-specific AND regulated. A rate, a term length or
 * an "approval" claim typed into a component would be both a duplicated fact
 * and, if wrong, a Truth-in-Lending problem. So it lives here or nowhere.
 *
 * `null` means this client has no financing page. The route then 404s, and
 * because the gate now crawls every nav link, a config that advertises
 * /financing without configuring it FAILS THE GATE rather than shipping a
 * dead nav item.
 *
 * `disclaimer` is required rather than optional on purpose: an offer stated
 * without its qualifying terms is the claim regulators actually care about.
 */
const financingSchema = z.object({
  headline: z.string().min(1),
  blurb: z.string().min(1),
  /** Plain statements. No invented rates — only what the client confirmed. */
  bullets: z.array(z.string().min(1)).min(1),
  /** Who actually underwrites it, if the client names them. */
  lenderName: z.string().min(1).nullable().default(null),
  /** External application link, if there is one. */
  applyUrl: httpsUrl.nullable().default(null),
  /** Qualifying terms. Required — see above. */
  disclaimer: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Display — what a price is ALLOWED to say                             */
/* ------------------------------------------------------------------ */

/**
 * A price and a monthly payment are two different claims.
 *
 * "$8,995" is a fact about a unit. "$149/mo" is a CREDIT OFFER, and an offer
 * stated without its terms is the thing regulators act on — which is why the
 * financing block makes `disclaimer` required. A monthly figure sitting in
 * the product row of a client with no financing block therefore advertises
 * an offer that has no lender, no APR and no disclaimer behind it.
 *
 * These two switches decide it once, here, instead of at every place a price
 * is rendered. `showMonthly` defaults to FALSE: the safe state is silence,
 * and a client who has financing turns it on deliberately.
 */
const displaySchema = z.object({
  /** Cash price. Off shows "Ask for current pricing" instead. */
  showPrice: z.boolean().default(true),
  /** Monthly payment. Requires a financing block — enforced below. */
  showMonthly: z.boolean().default(false),
});

/* ------------------------------------------------------------------ */
/* Homepage — an ordered list of sections, not a file full of markup    */
/* ------------------------------------------------------------------ */

/**
 * The homepage lives HERE, in the one config file, for the same reason
 * everything else does: a second config file is a second place to look, and
 * the whole point of this template is that there is one.
 *
 * A section carries COPY. It must never carry a fact that already exists
 * above it — the phone number, address, opening hours, founding year and
 * category list are read at render time. That is why nothing here states a
 * years-in-business number: `yearsInBusiness` is derived from `foundedYear`
 * and is correct every January without anyone remembering.
 *
 * Sections: announcement, hero, stats, offercard, categories, products,
 * imagecards, benefits, gallery, reviews, comparison, promise, splitcards,
 * steps, faq, ctaband, cta, trust, bignumber.
 */
const homepageSchema = z.object({
  /** Overrides <title>. Null falls back to identity.tagline. */
  title: z.string().min(1).nullable().default(null),
  /** Overrides the meta description. Null falls back to identity.tagline. */
  description: z.string().min(1).nullable().default(null),
  sections: z.array(sectionSchema).default([]),
  /** Footnotes and small print printed at the bottom of the page. */
  disclosures: z.array(z.string().min(1)).default([]),
});

/* ------------------------------------------------------------------ */
/* Integrations — NAMES and FLAGS only. Never secrets.                 */
/* ------------------------------------------------------------------ */

/**
 * Secrets live in `wrangler secret put` / .env, never in config, never in git.
 * This block only records which bindings exist and which integrations are on.
 */
const integrationsSchema = z.object({
  d1BindingName: z.string().min(1),
  r2BindingName: z.string().min(1),
  ghl: z.object({ enabled: z.boolean() }),
  meta: z.object({ enabled: z.boolean() }),
  zaraz: z.object({ enabled: z.boolean() }),
  sentry: z.object({ enabled: z.boolean() }),
});

/* ------------------------------------------------------------------ */
/* The whole config                                                    */
/* ------------------------------------------------------------------ */

export const clientConfigSchema = z
  .object({
    /**
     * 'template' = the un-customised placeholder config. Zero categories is
     * legal, and the Phase 9 deploy gate REFUSES to ship it. This is what
     * stops placeholder facts ("CLIENT NAME", 555 numbers, Lorem) reaching a
     * live site — the leftover-template-text defect, made structural.
     *
     * 'client' = a real client config. Must have at least one category on.
     */
    deployMode: z.enum(['template', 'client']),
    identity: identitySchema,
    contact: contactSchema,
    address: addressSchema,
    hours: z.array(hoursRangeSchema).min(1),
    social: socialSchema,
    brand: brandSchema,
    nav: z.object({
      items: z.array(navItemSchema).min(1),
      /** The one canonical "Shop Inventory" destination. */
      primaryCta: ctaSchema,
      /**
       * Bottom-bar links (privacy, terms, accessibility). Separate from
       * `items` because they belong in the legal strip, not the menu — but
       * still config, so the footer component hard-codes no hrefs.
       */
      legalItems: z.array(ctaSchema).default([]),
    }),
    // partialRecord, not record: an ABSENT key is the normal case and means
    // OFF. A plain z.record would demand every category be listed, which is
    // the opposite of opt-in.
    categories: z.partialRecord(z.enum([...CATEGORY_SLUGS]), categoryOverrideSchema).default({}),
    /** Cities / areas served. Footer pills + schema areaServed. */
    serviceAreas: z.array(z.string().min(1)).default([]),
    /** null = this client has no financing page. The route 404s. */
    financing: financingSchema.nullable().default(null),
    /** What a price is allowed to say. See displaySchema. */
    display: displaySchema.default({ showPrice: true, showMonthly: false }),
    /**
     * The homepage, as an ordered list of sections. An empty default means a
     * config that predates this field still builds — it just has no homepage
     * sections until someone adds them.
     */
    homepage: homepageSchema.default({
      title: null,
      description: null,
      sections: [],
      disclosures: [],
    }),
    integrations: integrationsSchema,
  })
  .superRefine((cfg, ctx) => {
    // Sentry is declared in config but NO SDK is wired in this template
    // version (K-07/K-08). Turning it on would publish a false disclosure
    // in the privacy policy — "we use error monitoring" — about monitoring
    // that does not exist. Refused at build until AL-15 installs or
    // deletes it.
    if (cfg.integrations.sentry.enabled) {
      ctx.addIssue({
        code: 'custom',
        path: ['integrations', 'sentry', 'enabled'],
        message:
          'Sentry is not wired in this template version — keep it false (the privacy policy ' +
          'would publish a false disclosure). Install the SDK or delete the flag (AL-15).',
      });
    }

    // Nav may not link to /financing when there is no financing block —
    // the route 404s (O-17). Same fence as the disabled-category check
    // below, for the same reason.
    if (cfg.financing === null) {
      for (const [i, item] of cfg.nav.items.entries()) {
        if (item.type === 'link' && item.href === '/financing') {
          ctx.addIssue({
            code: 'custom',
            path: ['nav', 'items', i, 'href'],
            message:
              'Nav links to /financing but financing is null, so that page does not exist. ' +
              'Fill in the financing block, or remove the nav link.',
          });
        }
      }
    }

    // A monthly payment is a credit offer. Advertising one with no financing
    // block means advertising terms that do not exist — so the BUILD stops,
    // rather than the site shipping and the gate catching it later.
    if (cfg.display.showMonthly && cfg.financing === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['display', 'showMonthly'],
        message:
          'display.showMonthly is true but financing is null. A monthly payment is a credit offer; ' +
          'without a financing block it has no lender, no terms and no disclaimer. ' +
          'Fill in financing, or set showMonthly to false.',
      });
    }

    // Nav may not link to a category route that is not enabled.
    // (This is what would have caught the saunas nav link.)
    const enabledSegments = new Set(
      Object.entries(cfg.categories)
        .filter(([, v]) => v?.enabled)
        .map(([slug]) => slug),
    );
    for (const [i, item] of cfg.nav.items.entries()) {
      if (item.type !== 'link') continue;
      const match = /^\/([a-z-]+)\/?$/.exec(item.href);
      const seg = match?.[1];
      if (!seg) continue;
      const catalogSlug = CATEGORY_SLUGS.find((s) => `${s}s` === seg || s === seg);
      if (catalogSlug && !enabledSegments.has(catalogSlug)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nav', 'items', i, 'href'],
          message: `Nav links to "${item.href}" but category "${catalogSlug}" is not enabled. Enable it or remove the link.`,
        });
      }
    }

    // The homepage must lead with a hero (an announcement bar may precede
    // it). Anything else means the first thing a visitor sees is a mid-page
    // block with no context above it.
    const hp = cfg.homepage;
    const first = hp.sections[0];
    if (hp.sections.length > 0 && first && first.type !== 'hero' && first.type !== 'announcement') {
      ctx.addIssue({
        code: 'custom',
        path: ['homepage', 'sections', 0],
        message: 'The homepage must start with a hero (an announcement bar may come first).',
      });
    }
    // One announcement bar, at the top, or none.
    const bars = hp.sections.map((s, i) => (s.type === 'announcement' ? i : -1)).filter((i) => i >= 0);
    if (bars.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['homepage', 'sections'],
        message: 'Only one announcement bar is allowed.',
      });
    }
    if (bars.length === 1 && bars[0] !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['homepage', 'sections', bars[0]!],
        message: 'The announcement bar must be the first section.',
      });
    }
    // A superlative needs somewhere for its substantiation to print.
    if (collectFootnotes(hp.sections).length > 0 && hp.disclosures.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['homepage', 'disclosures'],
        message:
          'The homepage makes a superlative claim but has no disclosures block to print the substantiation in.',
      });
    }

    // A CLIENT config must sell something. The bare template legitimately
    // sells nothing — that is the point of shipping categories OFF.
    const anyEnabled = Object.values(cfg.categories).some((v) => v?.enabled);
    if (cfg.deployMode === 'client' && !anyEnabled) {
      ctx.addIssue({
        code: 'custom',
        path: ['categories'],
        message:
          'deployMode is "client" but no categories are enabled. Turn on what this client actually sells.',
      });
    }
  });

export type ClientConfig = z.infer<typeof clientConfigSchema>;
export type ClientConfigInput = z.input<typeof clientConfigSchema>;
export type NavItem = ClientConfig['nav']['items'][number];
export type HoursRange = ClientConfig['hours'][number];
