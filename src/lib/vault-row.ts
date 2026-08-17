/**
 * THE VAULT ROW — the template's own column contract (Lead Vault, Job 2).
 *
 * THE VAULT IS A PROJECTION OF D1. D1 is the source of truth; the sheet
 * is a view of it. It must be possible, in principle, to delete the
 * sheet and rebuild it from D1. Any behaviour that breaks that property
 * is wrong — which is why the writer UPSERTS by lead_uuid (one lead
 * identity, one row, forever) and why every value here is either held
 * in D1 or derived from values that are.
 *
 * Defined from THIS template's schema, not inherited from any client
 * build. Every column is a fact the template already holds (or derives
 * from ones it holds).
 *
 * THE ONE LAW, as recast by owner ruling 2026-08-14 ("everything also
 * goes to the sheet"): D1 remains the ONLY source of truth for product
 * facts — but the vault row now carries a SNAPSHOT of them (columns
 * 35–40), frozen at submit time. A later price/stock edit in D1 never
 * rewrites old rows; that is the point — the row records what the lead
 * saw when they asked. Consequence for rebuildability: a rebuild from
 * D1 reproduces every column EXCEPT the snapshot ones, which would take
 * current product values. Accepted and intended.
 *
 * COLUMN ORDER IS A CONTRACT. Append only — never insert, never reorder.
 * The writer maps by position, so a reorder silently shifts every field
 * for every downstream reader. The lib harness pins the exact list.
 *
 * Three columns flagged at definition time (recorded here so the reason
 * survives):
 *   - traffic_channel  DERIVED from held first-touch facts (click IDs +
 *     utm_medium). Derived, not stored twice — the classifier is below.
 *     The referrer-host half of Sun Pool's classifier is impossible here
 *     until the middleware captures a referrer (see next note).
 *   - landing_page_url, referrer_url  the template does NOT yet hold
 *     these — middleware stores lead_uuid + utm/click-id touches only.
 *     The columns are RESERVED (position is a contract) and written
 *     empty; a later middleware ticket (ft_landing / ft_referrer
 *     cookies) fills them. Adding them now avoids a reorder later.
 */

export const VAULT_COLUMNS = [
  'lead_uuid',
  'submitted_at',
  'first_name',
  'last_name',
  'email',
  'phone',
  'category',
  'product_slug',
  'message',
  'source_page',
  'traffic_channel',
  'landing_page_url',
  'referrer_url',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'ttclid',
  'event_id',
  'fbp',
  'fbc',
  'ghl_status',
  'ghl_contact_id',
  'ghl_error',
  'capi_status',
  'capi_error',
  'consent_version',
  // contactable — YES when phone is present AND consent is recorded.
  // Uniformly YES today because validation requires both before insert.
  // Reserved for progressive-capture funnels (shapes B and C), where
  // phone is captured mid-quiz and consent only at submit. Without this
  // column a partial lead is indistinguishable from a contactable one,
  // and nobody can filter "needs a consent call". Do not remove until
  // shapes B and C ship.
  'contactable',
  'conversion_value',
  'retry_count',
  'last_retry_at',
  // ── Columns 35+ · appended 2026-08-14 (append-only contract) ──
  // Product snapshot, projected from D1 enrichment AT SUBMIT TIME.
  // Empty when the lead named no product or enrichment found none.
  'product_name',
  'product_id',
  'product_price',
  'product_monthly',
  'product_stock', // products.status: available / pending / sold …
  'product_qty', // products.quantity at submit
  // Reserved — no form captures these yet. financing_interest and
  // form_intent are filled by the survey-wizard ticket; msclkid by
  // middleware if Microsoft Ads ever runs. Position is the contract.
  'financing_interest',
  'form_intent',
  'msclkid',
] as const;

export interface FirstTouch {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  fbclid: string;
  gclid: string;
  ttclid: string;
}

const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'cpm', 'cpv', 'cpa', 'retargeting', 'display']);

/**
 * paid / organic / referral / campaign / direct, derived from the
 * first-touch facts the template holds. (Sun Pool's version also used the
 * referrer host for internal/referral splits — not derivable here until
 * a referrer is captured; see the header note.)
 */
export function deriveTrafficChannel(ft: FirstTouch): string {
  if (ft.fbclid || ft.gclid || ft.ttclid) return 'paid';
  const medium = ft.utm_medium.toLowerCase();
  if (PAID_MEDIUMS.has(medium)) return 'paid';
  if (medium === 'organic') return 'organic';
  if (medium === 'referral') return 'referral';
  if (ft.utm_source || ft.utm_medium || ft.utm_campaign) return 'campaign';
  return 'direct';
}

/**
 * Structural slice of ProductEnrichment (src/lib/enrich.ts) — the exact
 * facts the snapshot columns freeze. null = no product on this lead.
 */
export interface ProductSnapshot {
  id: number;
  name: string;
  price: number;
  monthlyPayment: number;
  stockStatus: string;
  quantity: number;
}

export interface VaultRowInput {
  leadUuid: string;
  /** Unix ms — stringified to ISO by the builder. */
  submittedAt: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  category: string;
  productSlug: string;
  message: string;
  sourcePage: string;
  firstTouch: FirstTouch;
  eventId: string;
  fbp: string;
  fbc: string;
  ghlStatus: string;
  ghlContactId: string;
  ghlError: string;
  capiStatus: string;
  capiError: string;
  consentVersion: string;
  conversionValue: number;
  /** Submit-time product snapshot; null when the lead named no product. */
  product: ProductSnapshot | null;
}

/**
 * THE MISSED LEADS TAB (Job 4) — an append-only INCIDENT LOG, not a
 * projection. One row per failure event; a lead that fails twice appears
 * twice; nothing here is ever upserted or updated. THE ONE LAW applies
 * here too: no product facts. Column order is a contract like the vault's.
 */
export const MISSED_COLUMNS = [
  'logged_at',
  'lead_uuid',
  'failed_step',
  'error',
  'first_name',
  'last_name',
  'email',
  'phone',
  'source_page',
] as const;

export interface MissedRowInput {
  /** Unix ms — stringified to ISO by the builder. */
  loggedAt: number;
  leadUuid: string;
  /** Which leg failed: 'ghl' | 'capi' | 'vault' … */
  failedStep: string;
  error: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  sourcePage: string;
}

export function buildMissedRow(input: MissedRowInput): (string | number)[] {
  const row: Record<(typeof MISSED_COLUMNS)[number], string | number> = {
    logged_at: new Date(input.loggedAt).toISOString(),
    lead_uuid: input.leadUuid,
    failed_step: input.failedStep,
    error: input.error.slice(0, 500),
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    source_page: input.sourcePage,
  };
  return MISSED_COLUMNS.map((column) => row[column]);
}

export type VaultRowStatus = 'SENT' | 'DRIFTED' | 'FAILED' | 'UNCONFIGURED' | '';

/**
 * DRIFTED IS NOT RETRYABLE. A drifted row exists in the sheet, in the
 * wrong columns, invisible to every column-A reader. Retrying appends a
 * second row and orphans the first. DRIFTED means: mark it in D1, alert,
 * stop — a human repairs the sheet layout. Never append over it, never
 * PUT to the drifted range. Every vault writer (the submit path AND the
 * retry job) must consult this before touching the sheet.
 */
export function shouldWriteVaultRow(priorVaultStatus: string): boolean {
  return priorVaultStatus !== 'DRIFTED';
}

/** Outcome of a sheet upsert — enough to persist SENT / DRIFTED / FAILED. */
export interface VaultWriteOutcome {
  ok: boolean;
  status: number;
  drifted?: boolean;
  updatedRange?: string;
  error?: string;
}

export function vaultStatusFromWrite(result: VaultWriteOutcome): {
  status: 'SENT' | 'DRIFTED' | 'FAILED';
  detail: string;
} {
  const status = result.ok ? (result.drifted ? 'DRIFTED' : 'SENT') : 'FAILED';
  const detail = result.ok
    ? result.drifted
      ? `landed at ${result.updatedRange ?? '?'} — NOT retryable; repair the sheet layout by hand`
      : ''
    : `${result.status}: ${result.error ?? 'write failed'}`.slice(0, 300);
  return { status, detail };
}

export async function persistVaultWrite(
  db: D1Database,
  uuid: string,
  result: VaultWriteOutcome,
): Promise<{ status: 'SENT' | 'DRIFTED' | 'FAILED'; detail: string }> {
  const { status, detail } = vaultStatusFromWrite(result);
  await db
    .prepare(
      'UPDATE leads SET vault_status = ?, vault_error = ?, vault_synced_at = ?, updated_at = ? WHERE uuid = ?',
    )
    .bind(status, detail, status === 'SENT' ? Date.now() : null, Date.now(), uuid)
    .run();
  return { status, detail };
}

/**
 * One input object → one positional row, in VAULT_COLUMNS order.
 * (contactable's derivation and reason live on the column definition
 * above.)
 *
 * retry_count starts at 0 and last_retry_at empty — the retry job (later
 * ticket) owns both.
 */
export function buildVaultRow(input: VaultRowInput): (string | number)[] {
  const ft = input.firstTouch;
  const row: Record<(typeof VAULT_COLUMNS)[number], string | number> = {
    lead_uuid: input.leadUuid,
    submitted_at: new Date(input.submittedAt).toISOString(),
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    category: input.category,
    product_slug: input.productSlug,
    message: input.message,
    source_page: input.sourcePage,
    traffic_channel: deriveTrafficChannel(ft),
    landing_page_url: '', // reserved — not yet captured (see header)
    referrer_url: '', // reserved — not yet captured (see header)
    utm_source: ft.utm_source,
    utm_medium: ft.utm_medium,
    utm_campaign: ft.utm_campaign,
    utm_content: ft.utm_content,
    utm_term: ft.utm_term,
    fbclid: ft.fbclid,
    gclid: ft.gclid,
    ttclid: ft.ttclid,
    event_id: input.eventId,
    fbp: input.fbp,
    fbc: input.fbc,
    ghl_status: input.ghlStatus,
    ghl_contact_id: input.ghlContactId,
    ghl_error: input.ghlError,
    capi_status: input.capiStatus,
    capi_error: input.capiError,
    consent_version: input.consentVersion,
    contactable: input.phone && input.consentVersion ? 'YES' : 'NO',
    conversion_value: input.conversionValue,
    retry_count: 0,
    last_retry_at: '',
    // Snapshot columns — frozen from D1 enrichment at submit (header).
    product_name: input.product?.name ?? '',
    product_id: input.product ? input.product.id : '',
    product_price: input.product ? input.product.price : '',
    product_monthly: input.product ? input.product.monthlyPayment : '',
    product_stock: input.product?.stockStatus ?? '',
    product_qty: input.product ? input.product.quantity : '',
    // Reserved — written empty until their tickets land (header).
    financing_interest: '',
    form_intent: '',
    msclkid: '',
  };
  return VAULT_COLUMNS.map((column) => row[column]);
}
