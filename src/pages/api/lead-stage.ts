/**
 * PIPELINE STAGE → META  —  POST /api/lead-stage
 *
 * The CRM calls this when a deal moves. It fires the matching offline
 * conversion to Meta with `action_source: 'system_generated'`, using the
 * identity data captured when the lead first submitted the form days earlier.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Lead` is worth 0 (see lib/capi-events.ts). All the optimisation signal is
 * downstream — qualified, booked, showed, bought. Without this endpoint the
 * value ladder is a table of numbers that nothing ever sends, and Meta learns
 * only "this person filled in a form", which is the signal that fills an
 * account with cheap leads.
 *
 * WHAT THE CRM SENDS
 * ------------------
 *   POST /api/lead-stage
 *   Authorization: Bearer <STAGE_WEBHOOK_SECRET>
 *   { "leadUuid": "...", "event": "Schedule" }
 *   { "leadUuid": "...", "event": "Purchase", "value": 8450 }
 *
 * The CRM sends the EVENT NAME, not its own stage name. One GHL workflow per
 * stage, each hardcoding the event it means. No table of stage names lives in
 * this codebase, so renaming a pipeline stage in GHL cannot silently break
 * tracking here — and there is no second list to keep in sync.
 *
 * THREE THINGS IT REFUSES TO DO
 * -----------------------------
 * 1. Fire twice. A unique index on (lead_uuid, event_name) makes a repeat
 *    call a no-op that returns 200. CRM webhooks retry; retries must not
 *    double-count a booked appointment.
 * 2. Fire `Lead`. Only the website sends that, with the browser's event_id.
 *    Allowing it here would break the browser/server dedup pair.
 * 3. Invent a Purchase value. No value, no event.
 */

import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { site } from '../../config';
import { getEnv } from '../../lib/admin-auth';
import { sendMetaCapi, deriveFbc, type CapiResult } from '../../lib/meta-capi';
import { CAPI_EVENTS, isStageEvent, resolveEventValue, STAGE_EVENT_NAMES } from '../../lib/capi-events';

export const prerender = false;

interface StageBody {
  leadUuid?: unknown;
  event?: unknown;
  value?: unknown;
  actual_sale_value?: unknown;
  currency?: unknown;
}

interface LeadRow {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  category: string;
  product_slug: string;
  source_page: string;
  first_touch_fbclid: string;
  fbp: string;
  fbc: string;
  ip_address: string;
  user_agent: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Length-independent comparison. The admin password check elsewhere is a
 * plain !== and is documented as such; this one is new code, so it does not
 * inherit that weakness.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export const POST: APIRoute = async ({ request }) => {
  const e = getEnv();
  const db = getDb();

  // A missing secret means NOT CONFIGURED, never OPEN. This endpoint can
  // spend a client's ad budget by teaching their pixel the wrong thing.
  if (!e.STAGE_WEBHOOK_SECRET) {
    // The CRM is calling but the secret was never set: every stage event —
    // the entire value ladder — is being dropped (K-01 class).
    console.error('[stage] REFUSED — STAGE_WEBHOOK_SECRET not set; stage events are being dropped');
    return json({ ok: false, error: 'Stage webhook is not configured.' }, 503);
  }
  const token = bearer(request);
  if (!token || !secretsMatch(token, e.STAGE_WEBHOOK_SECRET)) {
    // Either the CRM webhook is misconfigured (every event lost until fixed)
    // or someone is probing. Both deserve a line (K-05). Never log the token.
    console.warn('[stage] auth reject — bearer token missing or wrong');
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }
  if (!db) {
    console.error('[stage] REFUSED — D1 unbound; stage event dropped');
    return json({ ok: false, error: 'Database is not configured.' }, 503);
  }

  let body: StageBody;
  try {
    body = (await request.json()) as StageBody;
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400);
  }

  const leadUuid = typeof body.leadUuid === 'string' ? body.leadUuid.trim().slice(0, 80) : '';
  const eventName = typeof body.event === 'string' ? body.event.trim() : '';

  if (!leadUuid) return json({ ok: false, error: 'leadUuid is required.' }, 400);
  if (!isStageEvent(eventName)) {
    return json(
      {
        ok: false,
        error: `event must be one of: ${STAGE_EVENT_NAMES.join(', ')}. "Lead" is fired by the website only.`,
      },
      400,
    );
  }

  const definition = CAPI_EVENTS[eventName];
  const resolved = resolveEventValue(
    eventName,
    e as unknown as Record<string, string | undefined>,
    body.value ?? body.actual_sale_value,
  );
  if (!resolved.ok) {
    console.warn(`[stage] ${eventName} rejected — ${resolved.error}`);
    return json({ ok: false, error: resolved.error }, 400);
  }
  if (resolved.malformedEnvKey) {
    console.warn(
      `[capi] ${resolved.malformedEnvKey} is set but not a usable number — using default ${resolved.value} (K-06)`,
    );
  }
  if (resolved.source === 'default') {
    // K-06: the ladder is running on the TEMPLATE's numbers, not this
    // client's. Meta is being trained on another business's economics —
    // that must be visible in every `wrangler tail`.
    console.warn(
      `[capi] ${eventName} fired with DEFAULT value ${resolved.value} — set ${definition.envKey} to this client's real number (K-06)`,
    );
  }
  if (e.META_TEST_EVENT_CODE) {
    console.warn('[capi] META_TEST_EVENT_CODE is set — this event is a TEST event and will NOT count as a conversion; delete the secret after the smoke test');
  }

  let lead: LeadRow | null;
  try {
    lead = await db
      .prepare(
        `SELECT uuid, first_name, last_name, email, phone, category, product_slug, source_page,
                first_touch_fbclid, fbp, fbc, ip_address, user_agent
           FROM leads WHERE uuid = ?`,
      )
      .bind(leadUuid)
      .first<LeadRow>();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // 502 so the CRM retries — the deliberate retry semantics of this
    // endpoint (I-15; verification confirmed the 502 path is load-bearing).
    console.error('[stage] lead lookup failed:', detail);
    return json({ ok: false, error: 'Lookup failed — retry.' }, 502);
  }

  // No lead row means no identity data, which means an event Meta cannot
  // match to anyone. Saying so is more useful than firing a blank event.
  if (!lead) {
    console.warn('[stage] unknown leadUuid — event dropped:', leadUuid);
    return json({ ok: false, error: 'Unknown leadUuid.' }, 404);
  }

  const now = Date.now();

  /* ---------------------------------------------------------------
     Claim the event BEFORE firing, and make the claim survivable.

     A CRM webhook retries. Two different retries need two different
     answers, and the unique index on (lead_uuid, event_name) is what
     lets us tell them apart:

       - the first attempt SUCCEEDED  → do nothing, return duplicate
       - the first attempt FAILED     → re-send under the SAME event_id

     Re-sending with the same id is safe even if the first send actually
     did land: that is precisely what event_id deduplication is for. What
     is NOT safe is generating a fresh id on retry, which is how one
     booked appointment becomes three.
     --------------------------------------------------------------- */
  let existing: { event_id: string; fired_server_side: number } | null;
  try {
    existing = await db
      .prepare('SELECT event_id, fired_server_side FROM lead_events WHERE lead_uuid = ? AND event_name = ?')
      .bind(leadUuid, eventName)
      .first<{ event_id: string; fired_server_side: number }>();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[stage] event lookup failed:', detail);
    return json({ ok: false, error: 'Lookup failed — retry.' }, 502);
  }

  let eventId: string;

  if (existing) {
    if (existing.fired_server_side === 1) {
      // Already counted. Success, not an error — an error keeps the CRM
      // retrying something that has already happened.
      return json({ ok: true, leadUuid, event: eventName, duplicate: true });
    }
    eventId = existing.event_id;
  } else {
    eventId = crypto.randomUUID();
    try {
      await db
        .prepare(
          `INSERT INTO lead_events (lead_uuid, event_name, event_id, fired_client_side, fired_server_side, payload, created_at)
           VALUES (?, ?, ?, 0, 0, ?, ?)`,
        )
        .bind(
          leadUuid,
          eventName,
          eventId,
          JSON.stringify({ value: resolved.value, valueSource: resolved.source }),
          now,
        )
        .run();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Two webhooks landed at once and the index caught the second. The
      // other request owns this event; do not fire a competing one.
      if (/UNIQUE|constraint/i.test(detail)) {
        return json({ ok: true, leadUuid, event: eventName, duplicate: true });
      }
      console.error('[stage] event insert failed:', detail);
      return json({ ok: false, error: 'Could not record the event.' }, 500);
    }
  }

  const metaEnabled =
    site.integrations.meta.enabled && Boolean(e.META_PIXEL_ID && e.META_CAPI_ACCESS_TOKEN);

  if (!metaEnabled) {
    if (site.integrations.meta.enabled) {
      // Enabled in config, secrets missing: the CRM is faithfully reporting
      // stage changes and every one of them is going nowhere (K-02).
      console.error('[capi] enabled in config but META_PIXEL_ID/META_CAPI_ACCESS_TOKEN missing — stage event NOT fired (K-02)');
    }
    return json({ ok: true, leadUuid, event: eventName, sent: false, reason: 'meta disabled' });
  }

  const capiResult: CapiResult = await sendMetaCapi(
    {
      pixelId: e.META_PIXEL_ID!,
      accessToken: e.META_CAPI_ACCESS_TOKEN!,
      ...(e.META_TEST_EVENT_CODE ? { testEventCode: e.META_TEST_EVENT_CODE } : {}),
    },
    {
      eventName,
      eventId,
      // The page the lead originally came from. A stage change has no page of
      // its own, and Meta still wants a plausible source URL.
      eventSourceUrl: new URL(lead.source_page || '/', site.identity.siteUrl).href,
      actionSource: definition.actionSource,
      user: {
        email: lead.email,
        phone: lead.phone,
        firstName: lead.first_name,
        lastName: lead.last_name,
        externalId: lead.uuid,
        fbp: lead.fbp,
        // Same reconstruction as the website event, from the fbclid captured
        // on the visitor's very first arrival.
        fbc: deriveFbc(lead.fbc, lead.first_touch_fbclid, now),
        clientIp: lead.ip_address,
        userAgent: lead.user_agent,
      },
      custom: {
        value: resolved.value,
        currency: typeof body.currency === 'string' ? body.currency.toUpperCase().slice(0, 3) : 'USD',
        content_category: lead.category,
        content_name: lead.product_slug,
      },
    },
  );

  try {
    await db
      .prepare('UPDATE lead_events SET fired_server_side = ?, payload = ? WHERE event_id = ?')
      .bind(
        capiResult.ok ? 1 : 0,
        JSON.stringify({
          value: resolved.value,
          valueSource: resolved.source,
          actionSource: definition.actionSource,
          capi: {
            ok: capiResult.ok,
            status: capiResult.status,
            received: capiResult.eventsReceived,
            detail: capiResult.ok ? '' : capiResult.detail,
          },
        }),
        eventId,
      )
      .run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // The row still says fired_server_side = 0, so the CRM's retry will
    // re-send under the SAME event_id — Meta dedups; nothing double-counts.
    // 502 keeps that retry coming rather than stranding the record.
    console.error('[stage] audit UPDATE failed after send:', detail);
    return json({ ok: false, error: 'Recorded remotely but not locally — retry.' }, 502);
  }

  if (!capiResult.ok) {
    console.error('[stage] Meta CAPI failed:', capiResult.status, capiResult.detail);
    // 502, not 200 — a failed send SHOULD be retried, and the row above is
    // left at fired_server_side = 0 so the retry re-sends under the same
    // event_id rather than skipping it as a duplicate.
    return json(
      { ok: false, leadUuid, event: eventName, error: 'Meta rejected the event.', status: capiResult.status },
      502,
    );
  }

  return json({
    ok: true,
    leadUuid,
    event: eventName,
    value: resolved.value,
    valueSource: resolved.source,
    actionSource: definition.actionSource,
    eventId,
  });
};
