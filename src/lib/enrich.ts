/**
 * PRODUCT ENRICHMENT (Lead Vault, Job 4) — the enrichLeadFromInventory
 * idea from the Sun Pool build, pointed at THIS template's D1.
 *
 * A lead that names a product gets the product's facts attached to the
 * CRM record — name, id, category, price, monthly payment, stock status,
 * the per-product ghl_tags the admin curated, and the
 * "Model Interest - <name>" tag — so a salesperson opens the contact and
 * sees WHAT they want without a second lookup.
 *
 * WHERE ENRICHMENT GOES (owner ruling 2026-08-14): the CRM record AND
 * the vault row. The sheet's product columns are a SNAPSHOT of these
 * facts at submit time — D1 stays the source of truth for product data;
 * a later price/stock edit never rewrites old sheet rows.
 *
 * NEVER THROWS, never blocks a lead: any failure returns null and the
 * sync proceeds unenriched. A category-only lead (no slug) is the normal
 * null case, not an error.
 */

export interface ProductEnrichment {
  id: number;
  name: string;
  category: string;
  price: number;
  monthlyPayment: number;
  /** The products.status value: available / pending / sold / … */
  stockStatus: string;
  /** products.quantity at submit time — the vault's product_qty column. */
  quantity: number;
  /** Admin-curated per-product tags (products.ghl_tags JSON array). */
  ghlTags: string[];
}

/** Exported so the harness pins the shape: by slug, one row, D1 only. */
export const ENRICH_QUERY =
  'SELECT id, inventory_name, category, status, price, monthly_payment, quantity, ghl_tags ' +
  'FROM products WHERE slug = ?1 LIMIT 1';

/** Minimal structural slice of D1 so tests can hand in a fake. */
export interface EnrichDb {
  prepare(query: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null> };
  };
}

interface ProductRow {
  id: number;
  inventory_name: string;
  category: string;
  status: string;
  price: number;
  monthly_payment: number;
  quantity: number;
  ghl_tags: string;
}

export async function enrichFromInventory(
  db: EnrichDb,
  productSlug: string,
): Promise<ProductEnrichment | null> {
  if (!productSlug) return null;
  try {
    const row = await db.prepare(ENRICH_QUERY).bind(productSlug).first<ProductRow>();
    if (!row) {
      // A slug with no product row: stale link or hand-typed URL. The
      // lead is still fine; the salesperson just gets the slug alone.
      console.warn(`[lead] enrichment found no product for slug "${productSlug}"`);
      return null;
    }
    let ghlTags: string[] = [];
    try {
      const parsed = JSON.parse(row.ghl_tags || '[]');
      if (Array.isArray(parsed)) ghlTags = parsed.filter((t): t is string => typeof t === 'string');
    } catch {
      /* malformed admin JSON → no extra tags, not a failed lead */
    }
    return {
      id: row.id,
      name: row.inventory_name,
      category: row.category,
      price: row.price,
      monthlyPayment: row.monthly_payment,
      stockStatus: row.status,
      quantity: row.quantity,
      ghlTags,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[lead] enrichment failed — syncing unenriched: ${detail}`);
    return null;
  }
}
