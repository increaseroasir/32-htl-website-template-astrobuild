/**
 * THE ONE LAW, enforced.
 *
 * This module is the ONLY place a component may get a client fact from.
 * It validates the active config at build time and exposes:
 *
 *   site      — the validated raw config
 *   derived   — everything computed FROM those facts (tel: href, display
 *               phone, formatted address, map + directions URLs, years in
 *               business, sameAs[], resolved categories, expanded nav)
 *
 * Anything in `derived` is deliberately NOT a config field, because a
 * derived value that is also typed by hand is two copies of one fact —
 * which is the bug this whole template exists to prevent.
 *
 * If you are in a component and reaching for a hard-coded string, stop.
 * Either it belongs in the schema, or it belongs in `derived` here.
 */

import { clientConfigSchema, type ClientConfig, type NavItem } from './schema';
import { CATEGORY_CATALOG, type CategoryDefinition, type CategorySlug } from './categories';
import { rawClientConfig } from './client.config';

/* ------------------------------------------------------------------ */
/* Validate once, at build time. A bad config fails the build.         */
/* ------------------------------------------------------------------ */

const parsed = clientConfigSchema.safeParse(rawClientConfig);

if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  throw new Error(
    `\n\nCLIENT CONFIG IS INVALID — build stopped.\n\n${lines.join('\n')}\n\n` +
      `Fix src/config/client.config.ts. Nothing else needs to change.\n`,
  );
}

export const site: ClientConfig = parsed.data;

/* ------------------------------------------------------------------ */
/* Resolved categories                                                 */
/* ------------------------------------------------------------------ */

export interface ResolvedCategory extends CategoryDefinition {
  /** Route path, always absolute and always trailing-slash-free. */
  readonly href: string;
  readonly heroImage: string | null;
  readonly sortOrder: number;
}

/**
 * The enabled categories, in display order. Every surface that lists
 * categories iterates THIS array — nav, footer, sitemap, breadcrumbs, the
 * [category] route, quiz options, admin dropdown, API validation.
 *
 * A category the client did not enable is not in this array, therefore it
 * cannot appear anywhere. That is the saunas defect, made impossible.
 */
export const enabledCategories: readonly ResolvedCategory[] = CATEGORY_CATALOG.filter(
  (def) => site.categories[def.slug]?.enabled === true,
)
  .map((def) => {
    const override = site.categories[def.slug];
    return {
      ...def,
      label: override?.label ?? def.label,
      blurb: override?.blurb ?? def.blurb,
      heroImage: override?.heroImage ?? null,
      sortOrder: override?.sortOrder ?? 0,
      href: `/${def.segment}`,
    };
  })
  .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

export const enabledCategorySlugs: readonly CategorySlug[] = enabledCategories.map((c) => c.slug);

export function isCategoryEnabled(slug: string): boolean {
  return enabledCategorySlugs.some((s) => s === slug);
}

/* ------------------------------------------------------------------ */
/* Phone — one canonical number, two derived forms                     */
/* ------------------------------------------------------------------ */

function formatPhone(e164: string, override: string | null): string {
  if (override) return override;
  // North American +1XXXXXXXXXX → (XXX) XXX-XXXX
  const na = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (na) return `(${na[1]}) ${na[2]}-${na[3]}`;
  return e164;
}

/* ------------------------------------------------------------------ */
/* Address, map, directions — all derived from one address block       */
/* ------------------------------------------------------------------ */

const addressOneLine = [
  site.address.street,
  site.address.street2,
  `${site.address.city}, ${site.address.region} ${site.address.postalCode}`,
]
  .filter((part): part is string => Boolean(part))
  .join(', ');

const encodedAddress = encodeURIComponent(addressOneLine);

/* ------------------------------------------------------------------ */
/* Hours — one source, human string + schema.org shape                 */
/* ------------------------------------------------------------------ */

const DAY_ABBR: Record<string, string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

function formatTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const suffix = h < 12 ? 'a.m.' : 'p.m.';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatDayRange(days: readonly string[]): string {
  if (days.length === 0) return '';
  if (days.length === 1) return DAY_ABBR[days[0] as string] ?? (days[0] as string);
  const first = DAY_ABBR[days[0] as string] ?? days[0];
  const last = DAY_ABBR[days[days.length - 1] as string] ?? days[days.length - 1];
  return `${first}–${last}`;
}

const hoursDisplay = site.hours.map((range) => ({
  days: formatDayRange(range.days),
  time: `${formatTime(range.opens)} – ${formatTime(range.closes)}`,
  label: `${formatDayRange(range.days)} ${formatTime(range.opens)} – ${formatTime(range.closes)}`,
}));

/* ------------------------------------------------------------------ */
/* Social — one source for footer icons AND schema.org sameAs          */
/* ------------------------------------------------------------------ */

/**
 * TEMPLATE_DEFECTS: Facebook was in config but the footer href was "#",
 * Instagram did not exist, and JSON-LD had no sameAs at all. One list now
 * feeds both the footer icons and the structured data.
 */
export interface SocialLink {
  readonly key: string;
  readonly label: string;
  readonly url: string;
}

const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
  googleBusiness: 'Google',
};

const socialLinks: readonly SocialLink[] = Object.entries(site.social)
  .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
  .map(([key, url]) => ({ key, label: SOCIAL_LABELS[key] ?? key, url }));

/* ------------------------------------------------------------------ */
/* Nav — ONE list, expanded for header and footer                      */
/* ------------------------------------------------------------------ */

export interface ResolvedNavItem {
  readonly label: string;
  readonly href: string;
  readonly external: boolean;
}

/**
 * Expands `{ type: 'categories' }` in place into one item per enabled
 * category. This is why enabling a category adds its nav link with no
 * second edit — and why nav labels cannot drift: there is one string.
 */
function expandNav(items: readonly NavItem[], surface: 'header' | 'footer'): ResolvedNavItem[] {
  const out: ResolvedNavItem[] = [];
  for (const item of items) {
    if (item.type === 'categories') {
      for (const cat of enabledCategories) {
        out.push({ label: cat.label, href: cat.href, external: false });
      }
      continue;
    }
    const visible = surface === 'header' ? item.inHeader : item.inFooter;
    if (!visible) continue;
    out.push({ label: item.label, href: item.href, external: item.type === 'external' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The derived surface                                                 */
/* ------------------------------------------------------------------ */

export const derived = {
  /** True while the config is still the un-customised placeholder. */
  isTemplate: site.deployMode === 'template',

  // Phone
  phoneDisplay: formatPhone(site.contact.phone, site.contact.phoneDisplayOverride),
  telHref: `tel:${site.contact.phone}`,
  smsHref: `sms:${site.contact.smsPhone ?? site.contact.phone}`,
  emailHref: site.contact.email ? `mailto:${site.contact.email}` : null,

  // Identity — GETTERS on purpose. This module initialises in the Worker's
  // global scope, where Cloudflare freezes the clock at 0; a plain property
  // would bake in "© 1970" and a negative years-in-business. A getter
  // evaluates when a page reads it — inside a request, where time is real.
  get yearsInBusiness(): number {
    return new Date().getFullYear() - site.identity.foundedYear;
  },
  get copyrightLine(): string {
    return `© ${new Date().getFullYear()} ${site.identity.name}. All rights reserved.`;
  },

  // Address + maps
  addressOneLine,
  addressLines: [
    site.address.street,
    site.address.street2,
    `${site.address.city}, ${site.address.region} ${site.address.postalCode}`,
  ].filter((p): p is string => Boolean(p)),
  /** Keyless Google Maps embed — no API key to leak or forget to set. */
  mapEmbedUrl: `https://www.google.com/maps?q=${encodedAddress}&output=embed`,
  directionsUrl: site.address.googlePlaceId
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}&destination_place_id=${site.address.googlePlaceId}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`,

  // Hours
  hoursDisplay,

  // Social
  socialLinks,
  /** schema.org sameAs — same source as the footer icons, never a second list. */
  sameAs: socialLinks.map((s) => s.url),

  // Nav
  headerNav: expandNav(site.nav.items, 'header'),
  footerNav: expandNav(site.nav.items, 'footer'),

  // Categories
  enabledCategories,
  enabledCategorySlugs,
} as const;

export { CATEGORY_CATALOG, type CategoryDefinition, type CategorySlug } from './categories';
export type { ClientConfig } from './schema';
