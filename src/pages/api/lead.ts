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
import { getDb, inventoryStatus } from '../../lib/db';
import { site, derived } from '../../config';
import { validateLead, clean } from '../../lib/validate-lead';
import { getEnv } from '../../lib/admin-auth';
import { sendMetaCapi, deriveFbc, type CapiResult } from '../../lib/meta-capi';
import { syncToGhl, buildGhlTags, type GhlResult } from '../../lib/ghl';
import { resolveEventValue } from '../../lib/capi-events';

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const db = getDb();
  if (!db) {
    const status = inventoryStatus(db);
    // A lead arrived and was REFUSED because D1 is unbound. Without this
    // line the operator's only signal is customers who stop converting
    // (I-01 — the loudest possible silent failure).
    console.error('[lead] REFUSED — D1 unbound:', status.message);
    return json({ ok: false, error: status.message }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  // One decider for everything between POST and insert — honeypot, consent
  // version, category allowlist, field rules (src/lib/validate-lead.ts).
  const verdict = validateLead(body, site.identity.name);

  if (verdict.kind === 'drop') {
    // The response is indistinguishable from real success — a bot must not
    // learn which field tripped it. The log line is the recovery path for
    // the rare human whose browser autofilled the trap (I-07); watch for
    // it after launch.
    console.warn('[lead] honeypot drop', {
      reason: verdict.reason,
      sourcePage: typeof body.sourcePage === 'string' ? body.sourcePage.slice(0, 200) : '',
    });
    return json({
      ok: true,
      leadUuid: cookies.get('lead_uuid')?.value ?? crypto.randomUUID(),
      eventId: crypto.randomUUID(),
    });
  }

  if (verdict.kind === 'reject') {
    return json({ ok: false, error: verdict.error }, verdict.status);
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    message,
    category,
    productSlug,
    sourcePage,
    eventId,
    consentVersion,
    consentText,
  } = verdict.lead;

  // Cloudflare's request metadata. In Astro v6 + adapter v13 the path is
  // request.cf (locals.runtime.cf was removed and throws). Present on
  // Workers; absent under plain `astro dev`, so every consumer treats a
  // missing field as "omit".
  const cf = (
    request as Request & {
      cf?: { postalCode?: string; city?: string; regionCode?: string; country?: string };
    }
  ).cf;

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

    // Enabled-in-config with missing secrets is the K-01/K-02 failure mode:
    // a populated-looking site where every lead quietly skips the CRM or the
    // pixel. It must be impossible to tail the logs and not see it.
    if (site.integrations.ghl.enabled && !ghlEnabled) {
      console.error('[ghl] enabled in config but GHL_API_KEY/GHL_LOCATION_ID missing — this lead did NOT sync (K-01)');
    }
    if (site.integrations.meta.enabled && !metaEnabled) {
      console.error('[capi] enabled in config but META_PIXEL_ID/META_CAPI_ACCESS_TOKEN missing — no server event fired (K-02)');
    }
    if (metaEnabled && e.META_TEST_EVENT_CODE) {
      // Compensating control for spec §5.2 (the build cannot see Worker
      // secrets): every event fired with a test code announces itself.
      console.warn('[capi] META_TEST_EVENT_CODE is set — this event is a TEST event and will NOT count as a conversion; delete the secret after the smoke test');
    }

    const categoryLabel =
      derived.enabledCategories.find((c) => c.slug === category)?.label ?? category;

    // Bottom rung of the value ladder. Resolves to 0 unless a client has
    // deliberately overridden META_VALUE_LEAD.
    const leadValueResult = resolveEventValue('Lead', e as unknown as Record<string, string | undefined>);
    const leadValue = leadValueResult.ok ? leadValueResult.value : 0;
    if (leadValueResult.ok && leadValueResult.malformedEnvKey) {
      console.warn(
        `[capi] ${leadValueResult.malformedEnvKey} is set but not a usable number — using default ${leadValue} (K-06)`,
      );
    }

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
                // Free geo match keys from Cloudflare's edge (P-01, spec
                // §2.5). Null-safe: absent cf fields are omitted downstream,
                // never empty-string-hashed. Lead event only — stage events
                // have no request to read geo from.
                zip: cf?.postalCode ?? '',
                city: cf?.city ?? '',
                state: cf?.regionCode ?? '',
                country: cf?.country ?? '',
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

    if (ghlResult.ok && ghlResult.contactId) {
      await db
        .prepare('UPDATE leads SET ghl_contact_id = ?, ghl_synced_at = ?, updated_at = ? WHERE uuid = ?')
        .bind(ghlResult.contactId, Date.now(), Date.now(), uuid)
        .run();
    } else if (ghlResult.ok) {
      // A 2xx with no contact id: the contact probably landed but cannot be
      // proven. ghl_synced_at deliberately NOT set — "synced" must mean "we
      // hold the CRM's id", or the flag is a lie (I-03; behaviour flagged
      // for AL-4 review).
      console.warn('[ghl] 2xx without a contact id — ghl_synced_at NOT set:', ghlResult.detail.slice(0, 200));
    } else if (ghlEnabled) {
      console.error('[ghl] sync failed:', ghlResult.status, ghlResult.detail);
    }

    if (!capiResult.ok && metaEnabled) {
      console.error('[capi] Lead event failed:', capiResult.status, capiResult.detail);
    }

    // The audit row records what actually happened, so "was this lead
    // double counted?" is answerable from the database instead of guessed.
    // Its own try/catch (I-19): the lead is committed and the syncs already
    // happened — bookkeeping failing may not turn success into a customer
    //-facing 500.
    try {
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
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[lead] audit UPDATE failed after commit — lead saved, syncs ran, bookkeeping lost:', detail);
    }

    return json({ ok: true, leadUuid: uuid, eventId });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown database error.';
    console.error('[lead] write failed:', detail);
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

  const result = await db
    .prepare('UPDATE lead_events SET fired_client_side = 1 WHERE event_id = ?')
    .bind(eventId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    // Still a 200 — the browser can do nothing about it — but the audit
    // trail now shows the mismatch instead of quietly recording nothing
    // (I-12): a PATCH for an event_id the server never wrote.
    console.warn('[lead] PATCH matched 0 rows — unknown event_id:', eventId);
  }

  return json({ ok: true });
};
