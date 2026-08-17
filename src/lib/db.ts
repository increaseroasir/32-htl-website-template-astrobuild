/**
 * D1 QUERY LAYER.
 *
 * Every read of the products table goes through this file, and every
 * public read filters against `enabledCategorySlugs` — the SAME array the
 * header nav, the footer, the sitemap and the [category] route render from.
 *
 * That is the whole point. On the old site the category list existed in the
 * nav markup, in the footer markup, in the sitemap, in the quiz, in the
 * admin dropdown AND as a hard-coded `new Set(['hot-tub','swim-spa'])`
 * inside the API. Nine copies of one fact. Removing saunas meant editing 26
 * files, and the API copy was the one everybody forgot.
 *
 * Here the API cannot disagree with the nav, because it is reading the same
 * array. Turn a category off in config and its products stop being served —
 * no SQL change, no code change, no migration.
 */

import { env } from 'cloudflare:workers';
import { enabledCategorySlugs, enabledCategories, isCategoryEnabled, site } from '../config';
import type { CategorySlug } from '../config/categories';

/* ------------------------------------------------------------------ */
/* Status vocabulary                                                   */
/* ------------------------------------------------------------------ */

export const PRODUCT_STATUSES = [
  'draft',
  'available',
  'pending',
  'sold',
  'hidden',
  'deleted',
] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * What a customer may see. Deliberately an allow-list, not a deny-list:
 * a status added later is invisible to the public until someone decides
 * otherwise, rather than leaking by default.
 *
 * `sold` IS public — a sold unit is proof the floor moves. It renders in a
 * muted treatment rather than being hidden (that behaviour was documented
 * as intentional on the old site, not a bug).
 */
export const PUBLIC_STATUSES: readonly ProductStatus[] = ['available', 'pending', 'sold'];

/* ------------------------------------------------------------------ */
/* Row shapes                                                          */
/* ------------------------------------------------------------------ */

/** A row exactly as D1 returns it — JSON columns still strings. */
interface ProductRow {
  id: number;
  slug: string;
  category: string;
  inventory_name: string;
  status: string;
  price: number;
  monthly_payment: number;
  quantity: number;
  primary_image: string;
  gallery_images: string;
  quick_facts: string;
  why_bullets: string;
  ghl_tags: string;
  promo_label: string;
  delivery_promise: string;
  headline: string;
  positioning_label: string;
  hero_description: string;
  long_description: string;
  best_for: string;
  featured: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

/** A product as the rest of the app uses it — JSON parsed, booleans real. */
export interface Product {
  id: number;
  slug: string;
  category: string;
  inventoryName: string;
  status: ProductStatus;
  price: number;
  monthlyPayment: number;
  quantity: number;
  primaryImage: string;
  galleryImages: string[];
  quickFacts: string[];
  whyBullets: string[];
  ghlTags: string[];
  promoLabel: string;
  deliveryPromise: string;
  headline: string;
  positioningLabel: string;
  heroDescription: string;
  longDescription: string;
  bestFor: string;
  featured: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  /** Resolved from the config catalog — never stored twice. */
  categoryLabel: string;
  categoryHref: string;
}

export function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function isProductStatus(value: string): value is ProductStatus {
  return (PRODUCT_STATUSES as readonly string[]).includes(value);
}

function normalizeProduct(row: ProductRow): Product {
  // The label and URL are NOT read from the database. They come from the
  // config catalog, so renaming "Hot Tubs" to "Spas" for a client changes
  // one config line rather than every product row.
  const category = enabledCategories.find((c) => c.slug === row.category);

  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    inventoryName: row.inventory_name,
    status: isProductStatus(row.status) ? row.status : 'hidden',
    price: row.price,
    monthlyPayment: row.monthly_payment,
    quantity: row.quantity,
    primaryImage: row.primary_image,
    galleryImages: parseJsonArray(row.gallery_images),
    quickFacts: parseJsonArray(row.quick_facts),
    whyBullets: parseJsonArray(row.why_bullets),
    ghlTags: parseJsonArray(row.ghl_tags),
    promoLabel: row.promo_label,
    deliveryPromise: row.delivery_promise,
    headline: row.headline,
    positioningLabel: row.positioning_label,
    heroDescription: row.hero_description,
    longDescription: row.long_description,
    bestFor: row.best_for,
    featured: row.featured === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    categoryLabel: category?.label ?? row.category,
    categoryHref: category?.href ?? '/inventory',
  };
}

/* ------------------------------------------------------------------ */
/* Binding access                                                      */
/* ------------------------------------------------------------------ */

/**
 * Returns the D1 binding, or null when it is not configured.
 *
 * NOTE for anyone porting older Cloudflare/Astro code: `Astro.locals.runtime.env`
 * was REMOVED in Astro 6. Bindings now come from the `cloudflare:workers`
 * module. Every Sun Pool-era snippet that reads `context.locals.runtime.env.DB`
 * needs this change, and it fails at runtime rather than at build, so it will
 * not show up in a type check.
 *
 * Null is a legitimate state, not a crash: the bare template ships with the
 * d1_databases block commented out in wrangler.toml, so a fresh clone runs
 * without a database. Callers surface "inventory is not configured yet"
 * instead of a 500 — the same reason the old admin API refused an upload
 * rather than writing an unreachable image URL.
 */
export function getDb(): D1Database | null {
  const bindings = env as unknown as Partial<Env>;
  return bindings.DB ?? null;
}

/* ------------------------------------------------------------------ */
/* Category guard — the heart of this phase                            */
/* ------------------------------------------------------------------ */

/**
 * Builds the `category IN (?,?)` fragment for the enabled categories.
 * Returns null when NOTHING is enabled, because `IN ()` is invalid SQL and
 * because the correct answer in that case is "no products", not "all
 * products". The bare template is exactly that case.
 */
function enabledCategoryClause(): { sql: string; binds: string[] } | null {
  if (enabledCategorySlugs.length === 0) return null;
  const placeholders = enabledCategorySlugs.map(() => '?').join(',');
  return { sql: `category IN (${placeholders})`, binds: [...enabledCategorySlugs] };
}

/** Is this string a category this client actually sells? Type-guard wrapper of config. */
export function isEnabledCategory(slug: string): slug is CategorySlug {
  return isCategoryEnabled(slug);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export interface ListProductsOptions {
  /** Restrict to one category. Ignored (returns []) if it is not enabled. */
  category?: string;
  /**
   * Admin views pass true to see drafts and hidden rows. Public callers
   * must never set this. It does NOT bypass the category filter — an
   * admin still cannot surface a category the client does not sell.
   */
  includeUnpublished?: boolean;
  limit?: number;
}

export async function listProducts(
  db: D1Database,
  options: ListProductsOptions = {},
): Promise<Product[]> {
  const enabled = enabledCategoryClause();
  if (!enabled) return [];

  const where: string[] = [enabled.sql];
  const binds: unknown[] = [...enabled.binds];

  if (options.category !== undefined) {
    // A request for a disabled category is not an error and not a 404 with
    // a leak — it is simply empty. There is no way to ask this function
    // for saunas and receive saunas when saunas are off.
    if (!isEnabledCategory(options.category)) return [];
    where.push('category = ?');
    binds.push(options.category);
  }

  if (options.includeUnpublished) {
    where.push("status != 'deleted'");
  } else {
    const statusPlaceholders = PUBLIC_STATUSES.map(() => '?').join(',');
    where.push(`status IN (${statusPlaceholders})`);
    binds.push(...PUBLIC_STATUSES);
  }

  let sql = `SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, id ASC`;
  if (options.limit !== undefined) {
    sql += ' LIMIT ?';
    binds.push(options.limit);
  }

  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<ProductRow>();

  return (result.results ?? []).map(normalizeProduct);
}

/**
 * One product by slug. Returns null for a product in a disabled category,
 * so an old /saunas/xyz URL cannot resurrect a page after the category is
 * turned off.
 */
export async function getProductBySlug(
  db: D1Database,
  slug: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<Product | null> {
  const enabled = enabledCategoryClause();
  if (!enabled) return null;

  const statusClause = options.includeUnpublished
    ? "status != 'deleted'"
    : `status IN (${PUBLIC_STATUSES.map(() => '?').join(',')})`;
  const statusBinds = options.includeUnpublished ? [] : [...PUBLIC_STATUSES];

  const row = await db
    .prepare(
      `SELECT * FROM products WHERE slug = ? AND ${enabled.sql} AND ${statusClause} LIMIT 1`,
    )
    .bind(slug, ...enabled.binds, ...statusBinds)
    .first<ProductRow>();

  return row ? normalizeProduct(row) : null;
}

/** Public product counts per enabled category, for nav badges and listings. */
export async function countProductsByCategory(
  db: D1Database,
): Promise<Record<string, number>> {
  const enabled = enabledCategoryClause();
  const counts: Record<string, number> = {};
  for (const slug of enabledCategorySlugs) counts[slug] = 0;
  if (!enabled) return counts;

  const statusPlaceholders = PUBLIC_STATUSES.map(() => '?').join(',');
  const result = await db
    .prepare(
      `SELECT category, COUNT(*) AS n FROM products
       WHERE ${enabled.sql} AND status IN (${statusPlaceholders})
       GROUP BY category`,
    )
    .bind(...enabled.binds, ...PUBLIC_STATUSES)
    .all<{ category: string; n: number }>();

  for (const row of result.results ?? []) counts[row.category] = row.n;
  return counts;
}


/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export interface InventoryStatus {
  configured: boolean;
  bindingName: string;
  enabledCategories: string[];
  /**
   * For the OPERATOR'S CONSOLE and internal pages only — wrangler commands,
   * binding names, config paths. Rendering this to a customer page is a gate
   * failure ('No operator diagnostics in customer pages').
   */
  operatorDetail: string;
  /**
   * The only string a customer may see. Built from config, zero internals,
   * and it gives them the one thing that actually helps: a way to reach a
   * human (RC-A — one string was serving two audiences).
   */
  customerMessage: string;
}

/** Used by pages and API routes to explain themselves when D1 is absent. */
export function inventoryStatus(db: D1Database | null): InventoryStatus {
  const bindingName = site.integrations.d1BindingName;
  // No phone DIGITS in the string: every rendered phone must be a tel: link
  // (the gate enforces it), so pages pair this message with their own
  // tel-href action and the quiz appends its own Call link to API errors.
  const customerMessage =
    "Live inventory is temporarily unavailable — give us a call and we'll tell you what's on the floor.";
  if (!db) {
    return {
      configured: false,
      bindingName,
      enabledCategories: [...enabledCategorySlugs],
      operatorDetail:
        `No D1 database is bound as "${bindingName}". Create one with ` +
        '`wrangler d1 create <name>`, uncomment the [[d1_databases]] block in ' +
        'wrangler.toml, then run `npm run db:migrate:local`.',
      customerMessage,
    };
  }
  if (enabledCategorySlugs.length === 0) {
    return {
      configured: true,
      bindingName,
      enabledCategories: [],
      operatorDetail:
        'Database is bound, but no categories are enabled in client.config.ts, ' +
        'so there is nothing to sell and every product query returns empty.',
      customerMessage,
    };
  }
  return {
    configured: true,
    bindingName,
    enabledCategories: [...enabledCategorySlugs],
    operatorDetail: 'Inventory is configured.',
    customerMessage,
  };
}
