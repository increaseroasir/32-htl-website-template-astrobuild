/**
 * ADMIN API — ported from the existing Sun Pool functions/api/admin.js.
 *
 * The auth is reused untouched (see src/lib/admin-auth.ts). The sanitisers,
 * the status vocabulary, the R2 upload rules and the soft-delete behaviour
 * are all the originals.
 *
 * THREE deliberate differences, none of them to the auth:
 *
 *   1. CATEGORIES is no longer `new Set(['hot-tub','swim-spa'])` typed into
 *      this file. It reads the enabled categories from config — the same
 *      array the nav, the routes, the sitemap and the public queries use.
 *      That hardcoded Set is precisely why removing saunas took 26 file
 *      edits and why the API was the copy everyone forgot.
 *
 *   2. Bindings come from `cloudflare:workers` (Astro 6 removed
 *      locals.runtime.env).
 *
 *   3. No CORS headers. The original shipped a permissive-ish CORS helper
 *      because it ran as a Pages Function; this route is served from the
 *      same origin as the panel, so cross-origin access is neither needed
 *      nor granted. Adding CORS to an admin API would widen it, not port it.
 *
 * Routes (all require Authorization: Bearer <token> except login):
 *   POST   ?action=login    { password }        → { ok, token }
 *   POST   ?action=logout                       → { ok }
 *   POST   ?action=upload   multipart image     → { ok, key, url }
 *   POST                    product JSON        → upsert
 *   GET                                         → list (incl. orphans)
 *   PATCH                   { slug, status }    → change status
 *   DELETE  ?slug=…                             → soft delete
 */

import type { APIRoute } from 'astro';
import { getDb, PRODUCT_STATUSES, parseJsonArray } from '../../lib/db';
import { enabledCategorySlugs, enabledCategories } from '../../config';
import {
  requireSession,
  createSession,
  destroySession,
  adminConfigured,
  getEnv,
  secretsMatch,
} from '../../lib/admin-auth';

export const prerender = false;

/* ---------- vocabulary (from the original) ---------- */

const STATUSES = new Set<string>(PRODUCT_STATUSES.filter((status) => status !== 'deleted'));
const PATCH_STATUSES = new Set<string>(PRODUCT_STATUSES);

const IMAGE_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const R2_UNCONFIGURED = 'UNCONFIGURED';

/* ---------- sanitisers (from the original) ---------- */

function slugify(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function cleanText(value: unknown, max = 180): string {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanArray(value: unknown, maxItems = 12, itemMax = 120): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, itemMax))
    .filter(Boolean)
    .slice(0, maxItems);
}

function numberInRange(value: unknown, min: number, max: number): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * The original's cleanImageUrl: root-relative or https only. This is the
 * same absolute-path rule the render side enforces, applied at the point of
 * WRITE, so a relative path never reaches the database in the first place.
 */
function cleanImageUrl(value: unknown): string {
  const url = cleanText(value, 600);
  if (!url) return '';
  if (url.startsWith('/')) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function r2PublicBase(): string {
  const e = getEnv();
  const explicit = String(e.R2_PUBLIC_BASE_URL ?? '').trim();
  if (explicit && explicit !== R2_UNCONFIGURED) return explicit.replace(/\/$/, '');
  const id = String(e.R2_PUBLIC_BUCKET_ID ?? '').trim();
  if (!id || id === R2_UNCONFIGURED) return '';
  // The dashboard shows the public host as pub-<id>.r2.dev, so a pasted
  // value usually already carries the prefix. Accept either form.
  return `https://pub-${id.replace(/^pub-/, '')}.r2.dev`;
}

function publicUrl(key: string): string {
  const base = r2PublicBase();
  return base ? `${base}/${key}` : key;
}

/* ---------- helpers ---------- */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

const UNAUTHORIZED = () => json({ ok: false, error: 'Unauthorized.' }, 401);

interface ProductInput {
  [key: string]: unknown;
}

/** The shape the upsert binds, mirroring the products table columns. */
interface ValidatedProduct {
  slug: string;
  inventory_name: string;
  category: string;
  price: number;
  monthly_payment: number;
  status: string;
  quantity: number;
  primary_image: string;
  gallery_images: string[];
  quick_facts: string[];
  ghl_tags: string[];
  why_bullets: string[];
  promo_label: string;
  delivery_promise: string;
  headline: string;
  positioning_label: string;
  hero_description: string;
  long_description: string;
  best_for: string;
  sort_order: number;
  featured: number;
}

function validateProduct(
  body: ProductInput,
): { ok: false; error: string } | { ok: true; product: ValidatedProduct } {
  const slug = slugify(body.slug ?? body.inventory_name);
  const inventoryName = cleanText(body.inventory_name, 140);
  const category = cleanText(body.category, 40);
  const status = cleanText(body.status ?? 'draft', 40);

  if (!slug || !inventoryName) {
    return { ok: false, error: 'Product name and a valid slug are required.' };
  }

  // THE difference from the original. The valid set is whatever this client
  // sells — so the admin dropdown, the public pages and this validator can
  // never disagree, and a category that is off cannot be assigned.
  if (!(enabledCategorySlugs as readonly string[]).includes(category)) {
    const list = enabledCategorySlugs.join(', ') || '(none enabled)';
    return { ok: false, error: `Invalid category. This site sells: ${list}.` };
  }

  if (!STATUSES.has(status)) {
    return { ok: false, error: 'Invalid status. Use draft, available, pending, sold, or hidden.' };
  }

  return {
    ok: true,
    product: {
      slug,
      inventory_name: inventoryName,
      category,
      price: numberInRange(body.price, 0, 999999),
      monthly_payment: numberInRange(body.monthly_payment, 0, 99999),
      status,
      quantity: numberInRange(body.quantity, 0, 999),
      primary_image: cleanImageUrl(body.primary_image),
      gallery_images: cleanArray(body.gallery_images, 20, 600).map(cleanImageUrl).filter(Boolean),
      quick_facts: cleanArray(body.quick_facts, 8, 90),
      ghl_tags: cleanArray(body.ghl_tags, 30, 100),
      why_bullets: cleanArray(body.why_bullets, 6, 220),
      promo_label: cleanText(body.promo_label, 80),
      delivery_promise: cleanText(body.delivery_promise, 220),
      headline: cleanText(body.headline, 140),
      positioning_label: cleanText(body.positioning_label, 60),
      hero_description: cleanText(body.hero_description, 320),
      long_description: cleanText(body.long_description, 1400),
      best_for: cleanText(body.best_for, 220),
      sort_order: numberInRange(body.sort_order, -9999, 9999),
      featured: body.featured ? 1 : 0,
    },
  };
}

/* ================================================================== */
/* POST — login, logout, upload, upsert                                */
/* ================================================================== */

export const POST: APIRoute = async ({ request, url }) => {
  const db = getDb();
  if (!db) return json({ ok: false, error: 'Database is not configured.' }, 503);

  const action = url.searchParams.get('action');

  /* ---- login ---- */
  if (action === 'login') {
    const body = (await request.json().catch(() => ({}))) as { password?: unknown };
    if (!adminConfigured()) {
      return json({ ok: false, error: 'Admin is not configured.' }, 503);
    }
    if (
      typeof body.password !== 'string' ||
      !secretsMatch(body.password, getEnv().ADMIN_PASSWORD ?? '')
    ) {
      return json({ ok: false, error: 'Invalid password.' }, 401);
    }
    const token = await createSession(db);
    return json({ ok: true, token });
  }

  /* ---- everything below needs a session ---- */
  const session = await requireSession(db, request);
  if (!session) return UNAUTHORIZED();

  if (action === 'logout') {
    await destroySession(db, request);
    return json({ ok: true });
  }

  /* ---- image upload ---- */
  if (action === 'upload') {
    const e = getEnv();
    if (!e.PRODUCT_IMAGES) {
      return json({ ok: false, error: 'PRODUCT_IMAGES bucket is not bound.' }, 503);
    }
    // The original refused rather than writing an unreachable URL. Kept:
    // a saved image URL that 404s is worse than a failed upload, because
    // nobody notices until a customer is looking at the page.
    if (!r2PublicBase()) {
      const raw = String(e.R2_PUBLIC_BUCKET_ID ?? '').trim();
      return json(
        {
          ok: false,
          error:
            'Image hosting is not configured: R2_PUBLIC_BUCKET_ID is ' +
            (raw ? `the placeholder "${raw}"` : 'not set') +
            '. Enable public access on the bucket, set R2_PUBLIC_BUCKET_ID to its bucket ID ' +
            '(or R2_PUBLIC_BASE_URL to a custom domain), and redeploy. Upload refused so no ' +
            'unreachable image URL is saved.',
        },
        503,
      );
    }

    const form = await request.formData();
    const file = form.get('image');
    if (!file || typeof file === 'string') {
      return json({ ok: false, error: 'Image file is required.' }, 400);
    }

    const contentType = file.type || 'application/octet-stream';
    const extension = IMAGE_TYPES.get(contentType);
    if (!extension) {
      return json({ ok: false, error: 'Only JPG, PNG, WEBP, and GIF images are allowed.' }, 400);
    }

    const maxBytes = Number(e.MAX_PRODUCT_IMAGE_BYTES ?? MAX_IMAGE_BYTES);
    if (file.size && file.size > maxBytes) {
      return json({ ok: false, error: 'Image is too large.' }, 400);
    }

    const originalName = file.name || 'product-image';
    const key =
      'products/' +
      Date.now() +
      '-' +
      (slugify(originalName.replace(/\.[^.]+$/, '')) || 'image') +
      extension;

    await e.PRODUCT_IMAGES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
    });

    return json({ ok: true, key, url: publicUrl(key) });
  }

  /* ---- upsert ---- */
  const body = (await request.json().catch(() => ({}))) as ProductInput;
  const validated = validateProduct(body);
  if (!validated.ok) return json({ ok: false, error: validated.error }, 400);

  const p = validated.product;
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO products (
         slug, inventory_name, category, price, monthly_payment, status, quantity,
         primary_image, gallery_images, quick_facts, ghl_tags, why_bullets,
         promo_label, delivery_promise, headline, positioning_label,
         hero_description, long_description, best_for, sort_order, featured,
         created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(slug) DO UPDATE SET
         inventory_name=excluded.inventory_name, category=excluded.category,
         price=excluded.price, monthly_payment=excluded.monthly_payment,
         status=excluded.status, quantity=excluded.quantity,
         primary_image=excluded.primary_image, gallery_images=excluded.gallery_images,
         quick_facts=excluded.quick_facts, ghl_tags=excluded.ghl_tags,
         why_bullets=excluded.why_bullets, promo_label=excluded.promo_label,
         delivery_promise=excluded.delivery_promise, headline=excluded.headline,
         positioning_label=excluded.positioning_label, hero_description=excluded.hero_description,
         long_description=excluded.long_description, best_for=excluded.best_for,
         sort_order=excluded.sort_order, featured=excluded.featured,
         updated_at=excluded.updated_at`,
    )
    .bind(
      p.slug,
      p.inventory_name,
      p.category,
      p.price,
      p.monthly_payment,
      p.status,
      p.quantity,
      p.primary_image,
      JSON.stringify(p.gallery_images),
      JSON.stringify(p.quick_facts),
      JSON.stringify(p.ghl_tags),
      JSON.stringify(p.why_bullets),
      p.promo_label,
      p.delivery_promise,
      p.headline,
      p.positioning_label,
      p.hero_description,
      p.long_description,
      p.best_for,
      p.sort_order,
      p.featured,
      now,
      now,
    )
    .run();

  return json({ ok: true, product: p });
};

/* ================================================================== */
/* GET — list                                                          */
/* ================================================================== */

export const GET: APIRoute = async ({ request }) => {
  const db = getDb();
  if (!db) return json({ ok: false, error: 'Database is not configured.' }, 503);

  const session = await requireSession(db, request);
  if (!session) return UNAUTHORIZED();

  // Admin sees EVERY non-deleted row, including products stranded in a
  // category that is now off. Hiding them would mean a client could not
  // find or clean up their own data after a config change. They are marked
  // `orphaned` so the panel can say so out loud.
  const result = await db
    .prepare("SELECT * FROM products WHERE status != 'deleted' ORDER BY sort_order ASC, id ASC")
    .all<Record<string, unknown>>();

  const products = (result.results ?? []).map((row) => ({
    ...row,
    gallery_images: parseJsonArray(String(row.gallery_images ?? '[]')),
    quick_facts: parseJsonArray(String(row.quick_facts ?? '[]')),
    ghl_tags: parseJsonArray(String(row.ghl_tags ?? '[]')),
    why_bullets: parseJsonArray(String(row.why_bullets ?? '[]')),
    orphaned: !(enabledCategorySlugs as readonly string[]).includes(String(row.category)),
  }));

  return json({
    ok: true,
    products,
    // The dropdown is built from this, so it cannot offer a category the
    // validator would then reject.
    categories: enabledCategories.map((c) => ({ slug: c.slug, label: c.label })),
    imagesConfigured: Boolean(r2PublicBase()),
  });
};

/* ================================================================== */
/* PATCH — change status                                               */
/* ================================================================== */

export const PATCH: APIRoute = async ({ request }) => {
  const db = getDb();
  if (!db) return json({ ok: false, error: 'Database is not configured.' }, 503);

  const session = await requireSession(db, request);
  if (!session) return UNAUTHORIZED();

  const body = (await request.json().catch(() => ({}))) as { slug?: unknown; status?: unknown };
  const slug = slugify(body.slug);
  const status = cleanText(body.status, 40);

  if (!slug || !PATCH_STATUSES.has(status)) {
    return json({ ok: false, error: 'valid slug and status are required.' }, 400);
  }

  const result = await db
    .prepare('UPDATE products SET status = ?, updated_at = ? WHERE slug = ?')
    .bind(status, Date.now(), slug)
    .run();

  if (!result.meta || result.meta.changes === 0) {
    return json({ ok: false, error: 'Product not found.' }, 404);
  }
  return json({ ok: true });
};

/* ================================================================== */
/* DELETE — soft delete                                                */
/* ================================================================== */

export const DELETE: APIRoute = async ({ request, url }) => {
  const db = getDb();
  if (!db) return json({ ok: false, error: 'Database is not configured.' }, 503);

  const session = await requireSession(db, request);
  if (!session) return UNAUTHORIZED();

  const fromBody = (await request.json().catch(() => ({}))) as { slug?: unknown };
  const slug = slugify(url.searchParams.get('slug') ?? fromBody.slug);
  if (!slug) return json({ ok: false, error: 'slug is required.' }, 400);

  // Soft delete, as the original did. A misclick in the admin panel must
  // not be the thing that destroys a client's product history.
  const result = await db
    .prepare('UPDATE products SET status = ?, updated_at = ? WHERE slug = ?')
    .bind('deleted', Date.now(), slug)
    .run();

  if (!result.meta || result.meta.changes === 0) {
    return json({ ok: false, error: 'Product not found.' }, 404);
  }
  return json({ ok: true });
};
