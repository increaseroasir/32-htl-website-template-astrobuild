/**
 * CROSS-SESSION DUPLICATE DETECTION (Lead Vault, Job 3).
 *
 * Same human, new browser or cleared cookies, second submission inside
 * 24 hours: the lead is STILL STORED and still syncs to the CRM (an
 * upsert there is an update, not a duplicate) — but the CONVERSION must
 * not fire twice. A double-fired Lead teaches Meta to find the same
 * person again, and deleting the event later does not undo the training.
 *
 * THE MECHANISM IS AN INDEXED D1 QUERY — never a sheet read. Sun Pool's
 * findRecentDuplicate read 'All Leads'!A:V (the entire sheet) on every
 * submission: it got slower forever and put a Google API call on the
 * critical path of every lead. Migration 0004 adds the two indexes;
 * the query below repeats the EXACT expression substr(phone, -10) so
 * SQLite can use the expression index.
 *
 * THE NORMALISATION IS THE MATCH — ported exactly from Sun Pool:
 *   email  lowercased and trimmed  (validate-lead already stores it so)
 *   phone  stripped to digits, leading 1 removed, last 10 kept
 * That is what makes "(619) 995-0289" and "16199950289" the same
 * person. The stored column is already digits-only, so substr(-10)
 * on the D1 side converges with normalizePhoneForDup on the JS side.
 *
 * THE THREE-WAY OUTCOME — ported exactly:
 *   prior SENT / DUPLICATE / PENDING → duplicate. Suppress the
 *     conversion (counted, in flight, or itself part of a suppressed
 *     chain — a DUPLICATE prior means the ORIGINAL conversion counted).
 *   prior FAILED → RETRY. Let it through: no conversion was ever
 *     counted for this human, so firing now RECOVERS lost signal.
 *   prior NONE → let it through. A phone-minted lead (POST
 *     /api/phone-lead) deliberately fires NO Lead conversion — it has
 *     no browser half and no consented web session. When that same
 *     human submits the website form a day later, that form IS the
 *     first Lead; suppressing it would erase the only Lead signal.
 *   prior DISABLED / '' → suppress (conservative: only a KNOWN
 *     never-counted conversion justifies re-firing; with Meta off, the
 *     browser tag still fired once).
 */

import { digitsOnly } from './validate-lead';

export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function normalizeEmailForDup(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits only, one leading 1 removed, last 10 kept. */
export function normalizePhoneForDup(phone: string): string {
  let digits = digitsOnly(phone);
  if (digits.startsWith('1')) digits = digits.slice(1);
  return digits.slice(-10);
}

export type ConversionStatus =
  | 'PENDING'
  | 'SENT'
  | 'FAILED'
  | 'DUPLICATE'
  | 'DISABLED'
  | 'NONE'
  | '';

export interface DuplicateHit {
  uuid: string;
  created_at: number;
  conversion_status: ConversionStatus | string;
}

/**
 * Kept as an exported constant so the lib harness can pin the shape:
 * indexed columns only, the exact substr expression, no sheet involved.
 */
export const DUPLICATE_QUERY =
  'SELECT uuid, created_at, conversion_status FROM leads ' +
  'WHERE (email = ?1 OR substr(phone, -10) = ?2) AND created_at > ?3 ' +
  'ORDER BY created_at DESC LIMIT 1';

/** Minimal structural slice of D1 so tests can hand in a fake. */
export interface DupDb {
  prepare(query: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null> };
  };
}

/**
 * The most recent lead inside the window matching this human, or null.
 * Runs BEFORE the current submission's own row is written — afterwards
 * the query would match the submission itself.
 */
export async function findRecentDuplicate(
  db: DupDb,
  input: { email: string; phone: string; now: number },
): Promise<DuplicateHit | null> {
  const email = normalizeEmailForDup(input.email);
  const phone10 = normalizePhoneForDup(input.phone);
  if (!email && !phone10) return null;
  // Space sentinels: stored email is trimmed and phone digits-only, so
  // ' ' can never match a real column — a blank key matches nothing.
  return await db
    .prepare(DUPLICATE_QUERY)
    .bind(email || ' ', phone10 || ' ', input.now - DUPLICATE_WINDOW_MS)
    .first<DuplicateHit>();
}

export interface DuplicateDecision {
  /** True: do not fire the conversion, either side. The lead still stores and still syncs. */
  suppress: boolean;
  priorUuid: string;
}

export function duplicateDecision(prior: DuplicateHit | null): DuplicateDecision {
  if (!prior) return { suppress: false, priorUuid: '' };
  if (prior.conversion_status === 'FAILED' || prior.conversion_status === 'NONE') {
    // FAILED: the prior conversion never counted — this one recovers it.
    // NONE: the prior lead (phone-minted) never fired one by design.
    return { suppress: false, priorUuid: prior.uuid };
  }
  return { suppress: true, priorUuid: prior.uuid };
}
