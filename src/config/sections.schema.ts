/**
 * SECTION SCHEMAS — the shared vocabulary for composed pages.
 *
 * A page in this template is not a file full of markup. It is an ORDERED
 * ARRAY of typed sections in config. The homepage and every paid landing page
 * both read from this same vocabulary, which is why a new section type built
 * for one is immediately available to the other.
 *
 * The rule that makes this worth doing: a section carries its own COPY, but
 * never a fact that already exists elsewhere in config. A section does not
 * hold the phone number, the address, the opening hours, the founding year or
 * the category list — it reads those from `site` and `derived` at render
 * time. So "47 years" cannot be typed into a homepage section and go stale
 * while the logo says 1978; the number is computed from `foundedYear` every
 * build.
 *
 * That is the difference between content and facts. Content lives here.
 * Facts live once, in client.config.ts, and are read.
 */

import { z } from 'zod';

const absoluteAsset = z
  .string()
  .min(1)
  .refine(
    (v) => v.startsWith('/') || v.startsWith('https://'),
    'Asset paths must be absolute: start with "/" or "https://".',
  );

const linkSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
  /** 'primary' = the gold button. 'secondary' = the outlined one. */
  style: z.enum(['primary', 'secondary']).default('primary'),
});

/* ------------------------------------------------------------------ */
/* Claims — the part that carries legal weight                         */
/* ------------------------------------------------------------------ */

/**
 * Any statement of fact shown to a customer.
 *
 * `superlative: true` means the copy asserts a best/most/#1/-est claim. The
 * FTC expects those substantiated, so the schema requires a footnote and the
 * build fails without one. This is the one place the template refuses to ship
 * something merely because it renders.
 */
export const claimSchema = z
  .object({
    text: z.string().min(1),
    superlative: z.boolean().default(false),
    footnote: z.string().min(1).nullable().default(null),
  })
  .superRefine((c, ctx) => {
    if (c.superlative && !c.footnote) {
      ctx.addIssue({
        code: 'custom',
        path: ['footnote'],
        message: `Superlative claim "${c.text}" has no substantiation footnote. Add one or set superlative: false.`,
      });
    }
  });

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

/** Thin bar above the header. Promotions, seasonal catalogues. */
const announcementSchema = z.object({
  type: z.literal('announcement'),
  /** Short label pill, e.g. "EVERGREEN CATALOG". */
  badge: z.string().min(1).nullable().default(null),
  text: z.string().min(1),
  href: z.string().min(1).nullable().default(null),
});

const heroSchema = z.object({
  type: z.literal('hero'),
  eyebrow: z.string().min(1).nullable().default(null),
  /**
   * The headline. NULL falls back to `identity.tagline`, which means the
   * default homepage ships with no placeholder copy to remember to replace —
   * it is already saying the true thing about this client.
   * On a paid page, write one: a paid headline names the outcome, not the
   * seller, and the tagline is rarely that.
   */
  headline: z.string().min(1).nullable().default(null),
  /**
   * Words inside `headline` to render in the accent colour. Matched literally,
   * so the highlight cannot drift out of step with the headline text.
   */
  highlight: z.array(z.string().min(1)).default([]),
  subhead: z.string().min(1).nullable().default(null),
  /** Outcome-framed, not feature-framed. */
  bullets: z.array(claimSchema).default([]),
  /** Full-bleed background photo. Text stays readable via an overlay. */
  backgroundImage: absoluteAsset.nullable().default(null),
  image: absoluteAsset.nullable().default(null),
  /** Promo strip under the subhead. */
  promo: z.string().min(1).nullable().default(null),
  actions: z.array(linkSchema).default([]),
  /**
   * Renders the lead form inside the hero as a card. The form itself is the
   * SAME one used everywhere else — same validation, same event_id dedup,
   * same CRM sync. A hero does not get its own form to fall out of step.
   */
  leadCard: z
    .object({
      heading: z.string().min(1),
      subtext: z.string().min(1).nullable().default(null),
      /** Reassurance under the form. Reduces abandonment more than copy above it. */
      footnote: z.string().min(1).nullable().default(null),
    })
    .nullable()
    .default(null),
});

/** The numbers band. Precise figures beat round ones. */
const statsSchema = z.object({
  type: z.literal('stats'),
  items: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().min(1),
        claim: claimSchema.nullable().default(null),
      }),
    )
    .min(1),
});

/** A raised card making one argument, with its own CTAs. */
const offerCardSchema = z.object({
  type: z.literal('offercard'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1),
  body: z.string().min(1).nullable().default(null),
  bullets: z.array(claimSchema).default([]),
  actions: z.array(linkSchema).default([]),
});

/**
 * Live inventory. The section holds the HEADING and how many to show; the
 * products themselves come from D1, filtered by the enabled-categories array.
 * A product for a category the client does not sell cannot appear here,
 * because the query cannot return one.
 */
const productsSchema = z.object({
  type: z.literal('products'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1),
  body: z.string().min(1).nullable().default(null),
  limit: z.number().int().min(1).max(24).default(4),
  /** Restrict to one category, or null for everything enabled. */
  category: z.string().min(1).nullable().default(null),
  moreLink: linkSchema.nullable().default(null),
  /** Financing/pricing small print shown under the grid. */
  disclaimer: z.string().min(1).nullable().default(null),
});

/** Image tiles with overlay text. The "what are you shopping for" row. */
const imageCardsSchema = z.object({
  type: z.literal('imagecards'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1).nullable().default(null),
  items: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1).nullable().default(null),
        image: absoluteAsset.nullable().default(null),
        href: z.string().min(1),
      }),
    )
    .min(1),
});

/**
 * The category row, rendered ENTIRELY from the enabled-categories array.
 *
 * It takes no items, because it must not be possible to list a category here
 * that the client does not sell — that is the saunas defect, and the only way
 * to make it impossible is to give this section nothing to disagree with.
 * Turning a category on adds a card; turning it off removes one.
 */
const categoriesSchema = z.object({
  type: z.literal('categories'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1).default('What we sell'),
  body: z.string().min(1).nullable().default(null),
  /** Show the category hero images from config, when they are set. */
  showImages: z.boolean().default(true),
});

const benefitsSchema = z.object({
  type: z.literal('benefits'),
  heading: z.string().min(1).nullable().default(null),
  items: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        icon: absoluteAsset.nullable().default(null),
      }),
    )
    .min(1),
});

const gallerySchema = z.object({
  type: z.literal('gallery'),
  heading: z.string().min(1).nullable().default(null),
  /** Proof of scale. Real photos, never stock. */
  images: z.array(z.object({ src: absoluteAsset, alt: z.string().min(1) })).min(1),
});

/**
 * Reviews.
 *
 * `aggregate` is separate from the quotes on purpose: it is the number that
 * feeds schema.org AggregateRating, and a rating claimed in prose but absent
 * from structured data (or worse, disagreeing with it) is the drift bug in a
 * place Google reads.
 */
const reviewsSchema = z.object({
  type: z.literal('reviews'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1).nullable().default(null),
  items: z
    .array(
      z.object({
        /** First name + last initial. Never a full name without consent. */
        name: z.string().min(1),
        quote: z.string().min(1),
        rating: z.number().min(1).max(5).default(5),
        source: z.string().min(1).nullable().default(null),
        date: z.string().min(1).nullable().default(null),
        location: z.string().min(1).nullable().default(null),
        detail: z.string().min(1).nullable().default(null),
      }),
    )
    .min(1),
  aggregate: z
    .object({
      rating: z.number().min(1).max(5),
      count: z.number().int().min(1),
      source: z.string().min(1).nullable().default(null),
    })
    .nullable()
    .default(null),
});

/**
 * The comparison table.
 *
 * `them` is deliberately generic ("Everyone else"). Naming a competitor in a
 * comparison invites a false-advertising claim you then have to substantiate
 * row by row, and the schema will not stop you writing a name — but this note
 * is here because it has cost people money.
 */
const comparisonSchema = z.object({
  type: z.literal('comparison'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1),
  body: z.string().min(1).nullable().default(null),
  /** Column header for the client. Defaults to the business name at render. */
  usLabel: z.string().min(1).nullable().default(null),
  themLabel: z.string().min(1).default('Everyone else'),
  rows: z
    .array(
      z.object({
        label: z.string().min(1),
        us: z.string().min(1),
        them: z.string().min(1),
      }),
    )
    .min(1),
});

/** Badge plus a checklist. The "100% local promise" band. */
const promiseSchema = z.object({
  type: z.literal('promise'),
  badgeValue: z.string().min(1).nullable().default(null),
  badgeLabel: z.string().min(1).nullable().default(null),
  heading: z.string().min(1),
  body: z.string().min(1).nullable().default(null),
  bullets: z.array(claimSchema).min(1),
});

/** Two side-by-side photo cards with copy and their own CTAs. */
const splitCardsSchema = z.object({
  type: z.literal('splitcards'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1).nullable().default(null),
  items: z
    .array(
      z.object({
        image: absoluteAsset.nullable().default(null),
        title: z.string().min(1),
        body: z.string().min(1),
        /**
         * Set true to print the address and opening hours under the copy.
         * They are READ from config — this flag decides whether to show them,
         * never what they say.
         */
        showAddress: z.boolean().default(false),
        showHours: z.boolean().default(false),
        actions: z.array(linkSchema).default([]),
      }),
    )
    .min(1),
});

/** Numbered process steps. */
const stepsSchema = z.object({
  type: z.literal('steps'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1),
  items: z.array(z.object({ title: z.string().min(1), body: z.string().min(1) })).min(1),
});

const faqSchema = z.object({
  type: z.literal('faq'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1).nullable().default(null),
  items: z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).min(1),
});

/** Full-width band with a headline and buttons. */
const ctaBandSchema = z.object({
  type: z.literal('ctaband'),
  eyebrow: z.string().min(1).nullable().default(null),
  heading: z.string().min(1),
  body: z.string().min(1).nullable().default(null),
  actions: z.array(linkSchema).min(1),
  footnote: z.string().min(1).nullable().default(null),
  tone: z.enum(['dark', 'light']).default('dark'),
});

/** The lead form as its own section. */
const leadFormSchema = z.object({
  type: z.literal('cta'),
  heading: z.string().min(1),
  buttonLabel: z.string().min(1),
  subtext: z.string().min(1).nullable().default(null),
});

/** Short uppercase strip. Trust signals, badges. */
const trustSchema = z.object({
  type: z.literal('trust'),
  items: z.array(z.string().min(1)).min(1),
  logos: z.array(z.object({ src: absoluteAsset, alt: z.string().min(1) })).default([]),
});

const bigNumberSchema = z.object({
  type: z.literal('bignumber'),
  value: z.string().min(1),
  label: z.string().min(1),
  claim: claimSchema.nullable().default(null),
});

/* ------------------------------------------------------------------ */

export const sectionSchema = z.discriminatedUnion('type', [
  announcementSchema,
  heroSchema,
  statsSchema,
  offerCardSchema,
  categoriesSchema,
  productsSchema,
  imageCardsSchema,
  benefitsSchema,
  gallerySchema,
  reviewsSchema,
  comparisonSchema,
  promiseSchema,
  splitCardsSchema,
  stepsSchema,
  faqSchema,
  ctaBandSchema,
  leadFormSchema,
  trustSchema,
  bigNumberSchema,
]);

export type Section = z.infer<typeof sectionSchema>;
export type SectionInput = z.input<typeof sectionSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type SectionLink = z.infer<typeof linkSchema>;

/** Collects every superlative footnote on a page, in render order. */
export function collectFootnotes(sections: readonly Section[]): string[] {
  const out: string[] = [];
  const add = (c: { superlative: boolean; footnote: string | null } | null | undefined) => {
    if (c?.superlative && c.footnote) out.push(c.footnote);
  };
  for (const s of sections) {
    if (s.type === 'hero' || s.type === 'offercard' || s.type === 'promise') s.bullets.forEach(add);
    else if (s.type === 'stats') s.items.forEach((i) => add(i.claim));
    else if (s.type === 'bignumber') add(s.claim);
  }
  return out;
}
