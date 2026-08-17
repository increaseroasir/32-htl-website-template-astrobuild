/**
 * CATEGORY CATALOG — template level, not client level.
 *
 * This is the menu of every product category the TEMPLATE knows how to render.
 * It is NOT a list of what any client sells. A client turns categories on in
 * their own config; everything here is OFF until they do.
 *
 * ONE LAW: a category's slug, label, route segment and default copy live here
 * and nowhere else. Nav, footer, sitemap, breadcrumbs, quiz options, the
 * [category] route and the admin dropdown all read from this array. Adding a
 * category is one entry here plus one `enabled: true` in a client config —
 * never a new page file.
 *
 * To add a new category type to the template: append an entry below. Do not
 * create a per-category .astro page. If you find yourself writing
 * `src/pages/saunas.astro`, stop — that is the Sun Pool saunas defect.
 */

export const CATEGORY_SLUGS = [
  'hot-tub',
  'swim-spa',
  'sauna',
  'massage-chair',
  'cold-plunge',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export interface CategoryDefinition {
  /** Stable database + config key. Never rendered to a customer. */
  readonly slug: CategorySlug;
  /** URL segment. The [category] route matches on this. */
  readonly segment: string;
  /** Default nav / heading label. A client may override it. */
  readonly label: string;
  /** Default singular noun for product-detail copy. */
  readonly singular: string;
  /** Default one-line blurb used on category cards until a client overrides. */
  readonly blurb: string;
}

export const CATEGORY_CATALOG: readonly CategoryDefinition[] = [
  {
    slug: 'hot-tub',
    segment: 'hot-tubs',
    label: 'Hot Tubs',
    singular: 'hot tub',
    blurb: 'Premium hot tubs for relaxation and recovery.',
  },
  {
    slug: 'swim-spa',
    segment: 'swim-spas',
    label: 'Swim Spas',
    singular: 'swim spa',
    blurb: 'Swim, exercise, and relax year-round in your own backyard.',
  },
  {
    slug: 'sauna',
    segment: 'saunas',
    label: 'Saunas',
    singular: 'sauna',
    blurb: 'Traditional and infrared saunas for heat therapy at home.',
  },
  {
    slug: 'massage-chair',
    segment: 'massage-chairs',
    label: 'Massage Chairs',
    singular: 'massage chair',
    blurb: 'Full-body massage chairs for daily recovery.',
  },
  {
    slug: 'cold-plunge',
    segment: 'cold-plunges',
    label: 'Cold Plunges',
    singular: 'cold plunge',
    blurb: 'Cold therapy tubs for recovery and resilience.',
  },
] as const;

export const CATEGORY_SEGMENTS: { readonly [K in CategorySlug]: string } = Object.fromEntries(
  CATEGORY_CATALOG.map((c) => [c.slug, c.segment]),
) as { readonly [K in CategorySlug]: string };

/** Lookup by slug. Returns undefined for unknown slugs — callers must handle it. */
export function findCategory(slug: string): CategoryDefinition | undefined {
  return CATEGORY_CATALOG.find((c) => c.slug === slug);
}

/** Lookup by URL segment, for the [category] route. */
export function findCategoryBySegment(segment: string): CategoryDefinition | undefined {
  return CATEGORY_CATALOG.find((c) => c.segment === segment);
}
