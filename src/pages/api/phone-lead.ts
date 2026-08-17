/**
 * PHONE LEAD MINT — POST /api/phone-lead
 *
 * The CRM's voice intake (workflow 09) calls this when a phone lead has
 * no `lead_uuid`. The lead becomes a real D1 row — the durable record —
 * and the returned uuid, written back onto the GHL contact, is what
 * lets every later stage event (/api/lead-stage) attribute this human's
 * funnel to ads. Without this, phone leads have no CAPI path at all.
 *
 *   POST /api/phone-lead
 *   Authorization: Bearer <STAGE_WEBHOOK_SECRET>     (same CRM trust domain)
 *   { "phone": "...", "firstName"?, "lastName"?, "email"?,
 *     "ghlContactId"?, "callId"? }
 *   → { ok: true, leadUuid, existing: boolean }
 *
 * WHAT IT REFUSES TO DO:
 *  - Fire a Lead conversion. There is no browser half and no consented
 *    web session; conversion_status is written 'NONE', which the
 *    duplicate rule treats as never-counted — a website form from the
 *    same human later fires the real Lead unsuppressed.
 *  - Invent consent. consent_* stay empty; the vault row's contactable
 *    column derives 'NO' — exactly what that column exists to show.
 *  - Split an identity it can recognise. The same 24h email/phone match
 *    the website uses runs first; a hit returns the EXISTING uuid
 *    instead of minting a twin.
 *
 * THE VAULT IS A PROJECTION OF D1 — a minted phone lead gets its sheet
 * row like any other lead: upsert by uuid, in waitUntil, never able to
 * fail the response.
 */

import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { json, bearer } from '../../lib/http';
import { getEnv } from '../../lib/admin-auth';
import { secretsMatch } from '../../lib/secrets';
import { clean, looksLikeEmail, digitsOnly } from '../../lib/validate-lead';
import { findRecentDuplicate } from '../../lib/duplicates';
import { sheetsConfigFromEnv, upsertRowByLeadUuid } from '../../lib/sheets';
import { buildVaultRow, persistVaultWrite } from '../../lib/vault-row';

export const prerender = false;

const EMPTY_TOUCH = {
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_content: '',
  utm_term: '',
  fbclid: '',
  gclid: '',
  ttclid: '',
};

export const POST: APIRoute = async ({ request, locals }) => {
  const e = getEnv();
  const db = getDb();

  // Missing secret = NOT CONFIGURED, never open — same rule as the
  // stage endpoint, same trust domain, same secret.
  if (!e.STAGE_WEBHOOK_SECRET) {
    console.error('[phone-lead] REFUSED — STAGE_WEBHOOK_SECRET not set; phone leads are not being minted');
    return json({ ok: false, error: 'Phone lead webhook is not configured.' }, 503);
  }
  const token = bearer(request);
  if (!token || !secretsMatch(token, e.STAGE_WEBHOOK_SECRET)) {
    console.warn('[phone-lead] auth reject — bearer token missing or wrong');
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }
  if (!db) {
    console.error('[phone-lead] REFUSED — D1 unbound; phone lead dropped');
    return json({ ok: false, error: 'Database is not configured.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400);
  }

  // GHL renders an EMPTY merge field into a raw JSON body as the literal
  // string "null" (sometimes "undefined"). Those are sentinels, not
  // values: a ghlContactId of "null" would stamp ghl_synced_at and mark
  // the vault row SENT against a contact that does not exist, and callId
  // "null" writes "phone lead — call null". Stripped HERE because this
  // endpoint's only caller is the CRM; the website form keeps human
  // input verbatim (people named Null exist, merge sentinels don't
  // arrive there).
  const ghlMerge = (value: unknown, cap: number): string => {
    const cleaned = clean(value, cap);
    return /^(?:null|undefined)$/i.test(cleaned) ? '' : cleaned;
  };

  const phone = digitsOnly(clean(body.phone, 40));
  if (phone.length < 10) {
    return json({ ok: false, error: 'phone with at least 10 digits is required.' }, 400);
  }
  const firstName = ghlMerge(body.firstName, 100);
  const lastName = ghlMerge(body.lastName, 100);
  const rawEmail = ghlMerge(body.email, 200).toLowerCase();
  const email = looksLikeEmail(rawEmail) ? rawEmail : '';
  const ghlContactId = ghlMerge(body.ghlContactId, 80);
  const callId = ghlMerge(body.callId, 120);
  const now = Date.now();

  // One human, one identity where recognisable: the same 24h match the
  // website's duplicate check uses. A hit returns the existing uuid so
  // the CRM stitches the call onto the lead we already hold.
  try {
    const prior = await findRecentDuplicate(db, { email, phone, now });
    if (prior) {
      return json({ ok: true, leadUuid: prior.uuid, existing: true });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[phone-lead] duplicate check failed — minting anyway:', detail);
  }

  const uuid = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO leads (
           uuid, first_name, last_name, email, phone,
           category, product_slug, message, source_page,
           ip_address, user_agent,
           ghl_contact_id, ghl_synced_at,
           conversion_status, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        uuid,
        firstName,
        lastName,
        email,
        phone,
        '', // category — a call has no browsing context
        '',
        callId ? `phone lead — call ${callId}` : 'phone lead',
        'phone', // source_page: the honest origin marker
        '',
        request.headers.get('user-agent') ?? '',
        ghlContactId,
        // The contact already lives in the CRM — that is where this lead
        // CAME from. "Synced" is true by construction when we hold its id.
        ghlContactId ? now : null,
        // NONE: deliberately no Lead conversion (no browser half, no web
        // consent). The duplicate rule lets a later website form fire
        // the real Lead unsuppressed.
        'NONE',
        now,
        now,
      )
      .run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown database error.';
    console.error('[phone-lead] write failed:', detail);
    return json({ ok: false, error: 'Could not store the lead.' }, 500);
  }

  // The projection, same rules as /api/lead: after D1, in waitUntil,
  // never able to fail the response. contactable derives 'NO' (no
  // consent record) — the column built for exactly this lead shape.
  const vaultTask = (async () => {
    try {
      // New UUID: vault_status is ''. DRIFTED refuse-to-write is for
      // /api/lead retries that re-read prior status — not this mint.

      const sheets = sheetsConfigFromEnv(e);
      if (!sheets) {
        await db
          .prepare('UPDATE leads SET vault_status = ?, vault_error = ?, updated_at = ? WHERE uuid = ?')
          .bind('UNCONFIGURED', 'Google Sheets secrets missing or blank', Date.now(), uuid)
          .run();
        return;
      }

      const result = await upsertRowByLeadUuid(
        sheets,
        uuid,
        buildVaultRow({
          leadUuid: uuid,
          submittedAt: now,
          firstName,
          lastName,
          email,
          phone,
          category: '',
          productSlug: '',
          message: callId ? `phone lead — call ${callId}` : 'phone lead',
          sourcePage: 'phone',
          firstTouch: EMPTY_TOUCH,
          eventId: '',
          fbp: '',
          fbc: '',
          ghlStatus: ghlContactId ? 'SENT' : 'DISABLED',
          ghlContactId,
          ghlError: '',
          capiStatus: 'NONE',
          capiError: '',
          consentVersion: '',
          conversionValue: 0,
          product: null, // a caller names no product — snapshot empty
        }),
      );
      await persistVaultWrite(db, uuid, result);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[phone-lead] vault task failed AND could not record itself in D1:', detail);
    }
  })();
  if (locals.cfContext?.waitUntil) {
    locals.cfContext.waitUntil(vaultTask);
  }

  return json({ ok: true, leadUuid: uuid, existing: false });
};
