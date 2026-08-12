/**
 * LEAD CAPTURE — POST /api/lead
 *
 * Writes the lead to D1, logs the dedup event row, then syncs to
 * GoHighLevel and fires the Meta Conversions API — in that order, and only
 * ever in that order. The database write is what must not fail; the two
 * network calls after it are best-effort and their outcome is recorded.
 *
 * Two things are enforced here rather than trusted from the browser:
 *
 *   - The category must be one this client sells. A crafted request cannot
 *     file a sauna lead for a business that does not sell saunas.
 *   - Attribution comes from the COOKIES set by middleware, never from the
 *     request body. A form field could be edited; the first-touch cookie was
 *     written on arrival and is not exposed to the form at all.
 */

import type { APIRoute } from 'astro';
import { getDb, isEnabledCategory, inventoryStatus } from '../../lib/db';
import { site, derived } from '../../config';
import { consentTextFor } from '../../config/consent';
import { getEnv } from '../../lib/admin-auth';
import { sendMetaCapi, deriveFbc, type CapiResult } from '../../lib/meta-capi';
import { syncToGhl, buildGhlTags, type GhlResult } from '../../lib/ghl';
import { resolveEventValue } from '../../lib/capi-events';

export const prerender = false;

interface LeadBody {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  message?: unknown;
  category?: unknown;
  productSlug?: unknown;
  sourcePage?: unknown;
  eventId?: unknown;
  consentVersion?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Strip control characters and angle brackets, then cap the length. */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Deliberately permissive — a real customer with an odd address still counts. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** North American sanity check: at least 10 digits once punctuation is gone. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const db = getDb();
  if (!db) {
    const status = inventoryStatus(db);
    return json({ ok: false, error: status.message }, 503);
  }

  let body: LeadBody;
  try {
    body = (await request.json()) as LeadBody;
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  const name = clean(body.name, 140);
  const email = clean(body.email, 200).toLowerCase();
  const phoneRaw = clean(body.phone, 40);
  const phone = digitsOnly(phoneRaw);
  const message = clean(body.message, 1000);
  const productSlug = clean(body.productSlug, 120);
  const sourcePage = clean(body.sourcePage, 200);
  const eventId = clean(body.eventId, 80) || crypto.randomUUID();

  // Category: empty is fine ("just browsing"), but a value must be one this
  // client actually sells. Not a 500 — a clear, honest rejection.
  const requested = clean(body.category, 40);
  if (requested && !isEnabledCategory(requested)) {
    return json({ ok: false, error: 'That is not something we sell.' }, 400);
  }
  const category = requested;

  // Consent: the version is resolved to its exact wording SERVER-SIDE.
  // Client-supplied text is never trusted; an unknown or missing version is
  // a stale or tampered client and the lead is refused — a contactable lead
  // with no provable consent record is legal exposure, not a lead.
  const consentVersion = clean(body.consentVersion, 40);
  const consentText = consentVersion ? consentTextFor(consentVersion, site.identity.name) : null;
  if (!consentText) {
    return json({ ok: false, error: 'Please refresh the page and submit again.' }, 400);
  }

  const problems: string[] = [];
  if (name.length < 2) problems.push('a name');
  if (phone.length < 10) problems.push('a phone number');
  if (!looksLikeEmail(email)) problems.push('a valid email');
  if (problems.length > 0) {
    return json({ ok: false, error: `Please add ${problems.join(', ')}.` }, 400);
  }

  const [firstName = '', ...rest] = name.split(' ');
  const lastName = rest.join(' ');

  // The UUID is the one middleware assigned on arrival, so a repeat
  // submission updates the same lead instead of creating a duplicate.
  const uuid = cookies.get('lead_uuid')?.value ?? crypto.randomUUID();
  const now = Date.now();

  const ft = (key: string): string => cookies.get(`ft_${key}`)?.value ?? '';
  const lt = (key: string): string => cookies.get(`lt_${key}`)?.value ?? '';

  try {
    await db
      .prepare(
        `INSERT INTO leads (
           uuid, first_name, last_name, email, phone,
           category, product_slug, message, source_page,
           first_touch_utm_source, first_touch_utm_medium, first_touch_utm_campaign,
           first_touch_utm_content, first_touch_utm_term,
           first_touch_fbclid, first_touch_gclid, first_touch_ttclid,
           last_touch_utm_source, last_touch_utm_campaign,
           fbp, fbc, ip_address, user_agent,
           consent_version, consent_text, consent_url,
           created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(uuid) DO UPDATE SET
           first_name = excluded.first_name,
           last_name  = excluded.last_name,
           email      = excluded.email,
           phone      = excluded.phone,
           category   = excluded.category,
           product_slug = excluded.product_slug,
           message    = excluded.message,
           source_page = excluded.source_page,
           last_touch_utm_source   = excluded.last_touch_utm_source,
           last_touch_utm_campaign = excluded.last_touch_utm_campaign,
           consent_version = excluded.consent_version,
           consent_text    = excluded.consent_text,
           consent_url     = excluded.consent_url,
           updated_at = excluded.updated_at`,
      )
      .bind(
        uuid,
        firstName,
        lastName,
        email,
        phone,
        category,
        productSlug,
        message,
        sourcePage,
        ft('utm_source'),
        ft('utm_medium'),
        ft('utm_campaign'),
        ft('utm_content'),
        ft('utm_term'),
        ft('fbclid'),
        ft('gclid'),
        ft('ttclid'),
        lt('utm_source'),
        lt('utm_campaign'),
        cookies.get('_fbp')?.value ?? '',
        cookies.get('_fbc')?.value ?? '',
        clientAddress ?? '',
        request.headers.get('user-agent') ?? '',
        consentVersion,
        consentText,
        sourcePage,
        now,
        now,
      )
      .run();

    // The dedup key is recorded BEFORE either side fires, so both read the
    // same value rather than each inventing one.
    await db
      .prepare(
        `INSERT INTO lead_events (lead_uuid, event_name, event_id, fired_client_side, fired_server_side, payload, created_at)
         VALUES (?, ?, ?, 0, 0, ?, ?)`,
      )
      .bind(uuid, 'Lead', eventId, JSON.stringify({ category, productSlug, sourcePage }), now)
      .run();

    /* ---------------------------------------------------------------
       Downstream sync. The lead is ALREADY SAVED at this point.
       Nothing below may throw its way into the customer's response: a
       CRM outage or a Meta hiccup must cost a sync, not a customer.
       --------------------------------------------------------------- */

    const e = getEnv();
    const referer = request.headers.get('referer') ?? '';
    const eventSourceUrl = referer || new URL(sourcePage || '/', site.identity.siteUrl).href;

    const ghlEnabled = site.integrations.ghl.enabled && Boolean(e.GHL_API_KEY && e.GHL_LOCATION_ID);
    const metaEnabled =
      site.integrations.meta.enabled && Boolean(e.META_PIXEL_ID && e.META_CAPI_ACCESS_TOKEN);

    const categoryLabel =
      derived.enabledCategories.find((c) => c.slug === category)?.label ?? category;

    // Bottom rung of the value ladder. Resolves to 0 unless a client has
    // deliberately overridden META_VALUE_LEAD.
    const leadValueResult = resolveEventValue('Lead', e as unknown as Record<string, string | undefined>);
    const leadValue = leadValueResult.ok ? leadValueResult.value : 0;

    const [ghlResult, capiResult] = await Promise.all([
      ghlEnabled
        ? syncToGhl(
            { apiKey: e.GHL_API_KEY!, locationId: e.GHL_LOCATION_ID! },
            {
              firstName,
              lastName,
              email,
              phone,
              source: sourcePage || 'website',
              tags: buildGhlTags({
                category,
                productSlug,
                utmSource: ft('utm_source'),
                utmCampaign: ft('utm_campaign'),
              }),
              customFields: {
                lead_uuid: uuid,
                product_category: categoryLabel,
                product_slug: productSlug,
                message,
                source_page: sourcePage,
                first_touch_utm_source: ft('utm_source'),
                first_touch_utm_medium: ft('utm_medium'),
                first_touch_utm_campaign: ft('utm_campaign'),
                first_touch_ad_name: ft('utm_content'),
                first_touch_utm_term: ft('utm_term'),
                first_touch_fbclid: ft('fbclid'),
                first_touch_gclid: ft('gclid'),
                last_touch_utm_source: lt('utm_source'),
                last_touch_utm_campaign: lt('utm_campaign'),
              },
            },
          )
        : Promise.resolve<GhlResult>({ ok: false, status: 0, contactId: '', detail: 'disabled' }),

      metaEnabled
        ? sendMetaCapi(
            {
              pixelId: e.META_PIXEL_ID!,
              accessToken: e.META_CAPI_ACCESS_TOKEN!,
              ...(e.META_TEST_EVENT_CODE ? { testEventCode: e.META_TEST_EVENT_CODE } : {}),
            },
            {
              eventName: 'Lead',
              // The SAME id the browser will send. This is the dedup.
              eventId,
              eventSourceUrl,
              actionSource: 'website',
              user: {
                email,
                phone,
                firstName,
                lastName,
                externalId: uuid,
                fbp: cookies.get('_fbp')?.value ?? '',
                // Reconstructed from the stored fbclid when the pixel never
                // ran, so a blocked-pixel visitor keeps click attribution.
                fbc: deriveFbc(cookies.get('_fbc')?.value ?? '', ft('fbclid'), now),
                clientIp: clientAddress ?? '',
                userAgent: request.headers.get('user-agent') ?? '',
              },
              custom: {
                content_category: categoryLabel,
                content_name: productSlug,
                currency: 'USD',
                // 0 by default, and that is the point: a form fill is worth
                // nothing until a human qualifies it. The value that teaches
                // Meta anything arrives later, from /api/lead-stage.
                value: leadValue,
              },
            },
          )
        : Promise.resolve<CapiResult>({ ok: false, status: 0, detail: 'disabled' }),
    ]);

    if (ghlResult.ok) {
      await db
        .prepare('UPDATE leads SET ghl_contact_id = ?, ghl_synced_at = ?, updated_at = ? WHERE uuid = ?')
        .bind(ghlResult.contactId, Date.now(), Date.now(), uuid)
        .run();
    } else if (ghlEnabled) {
      console.error('[api/lead] GHL sync failed:', ghlResult.status, ghlResult.detail);
    }

    if (!capiResult.ok && metaEnabled) {
      console.error('[api/lead] Meta CAPI failed:', capiResult.status, capiResult.detail);
    }

    // The audit row records what actually happened, so "was this lead
    // double counted?" is answerable from the database instead of guessed.
    await db
      .prepare('UPDATE lead_events SET fired_server_side = ?, payload = ? WHERE event_id = ?')
      .bind(
        capiResult.ok ? 1 : 0,
        JSON.stringify({
          category,
          productSlug,
          sourcePage,
          ghl: { enabled: ghlEnabled, ok: ghlResult.ok, status: ghlResult.status, contactId: ghlResult.contactId },
          capi: { enabled: metaEnabled, ok: capiResult.ok, status: capiResult.status, received: capiResult.eventsReceived },
        }),
        eventId,
      )
      .run();

    return json({ ok: true, leadUuid: uuid, eventId });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown database error.';
    console.error('[api/lead] write failed:', detail);
    // The customer is not shown the database error — they are shown a way
    // to reach a human, which is the only thing that helps them.
    return json({ ok: false, error: 'We could not save that.' }, 500);
  }
};


/**
 * PATCH /api/lead — the browser confirming it fired its half of the event.
 *
 * Without this, `fired_client_side` would sit at 0 forever and the dedup
 * audit could only ever show one side. With it, a row showing 1/1 means both
 * events were sent with this id and Meta had what it needed to merge them.
 */
export const PATCH: APIRoute = async ({ request }) => {
  const db = getDb();
  if (!db) return json({ ok: false, error: 'Database is not configured.' }, 503);

  const body = (await request.json().catch(() => ({}))) as { eventId?: unknown };
  const eventId = clean(body.eventId, 80);
  if (!eventId) return json({ ok: false, error: 'eventId is required.' }, 400);

  await db
    .prepare('UPDATE lead_events SET fired_client_side = 1 WHERE event_id = ?')
    .bind(eventId)
    .run();

  return json({ ok: true });
};
