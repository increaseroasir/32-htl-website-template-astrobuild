/**
 * META CONVERSIONS API.
 *
 * The point of this file is DEDUPLICATION. The browser fires a `Lead` event
 * through Zaraz and this fires the same `Lead` event server-side. Meta counts
 * them once — but only if both carry the same `event_id` AND the same
 * `event_name`. Get that wrong and every lead is counted twice, which
 * silently halves your reported cost per lead and makes every optimisation
 * decision after it wrong.
 *
 * The `event_id` is not invented here. It was generated and written to the
 * `lead_events` table when the lead was saved (Phase 5), so both sides read
 * the same recorded value rather than each making one up.
 *
 * Why send server-side at all when the pixel already fires: ad blockers, ITP,
 * and iOS strip a meaningful share of browser events. The server event has no
 * such problem, and carries IP and user-agent that improve matching.
 */

import { hashEmail, hashPhone, hashName } from './hash';

export interface CapiUserData {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  /** Our own lead UUID — Meta's external_id, which boosts match rate. */
  externalId: string;
  fbp: string;
  fbc: string;
  clientIp: string;
  userAgent: string;
}

export interface CapiEvent {
  eventName: string;
  /** THE dedup key. Must match what the browser sent. */
  eventId: string;
  eventSourceUrl: string;
  /**
   * Where the conversion happened. 'website' for anything a browser did;
   * 'system_generated' for a CRM stage change reported after the fact.
   * Defaults to 'website' so every existing caller behaves exactly as before.
   */
  actionSource?: 'website' | 'system_generated';
  /**
   * Unix SECONDS. Defaults to now. Set it when reporting something that
   * happened earlier — Meta rejects events older than seven days.
   */
  eventTime?: number;
  user: CapiUserData;
  custom?: Record<string, unknown>;
}

export interface CapiResult {
  ok: boolean;
  status: number;
  detail: string;
  /** Meta echoes this back; a mismatch means the event was not what we sent. */
  eventsReceived?: number;
}

/**
 * Meta's `fbc` is normally set by the pixel as a cookie. If the pixel has not
 * run — blocked, or the visitor arrived and converted before it loaded — but
 * we captured an `fbclid` on arrival, the value can be reconstructed in
 * Meta's documented format: fb.1.<timestamp_ms>.<fbclid>.
 *
 * Without this, a blocked-pixel visitor loses click attribution entirely.
 */
export function deriveFbc(existingFbc: string, fbclid: string, nowMs: number): string {
  if (existingFbc) return existingFbc;
  if (!fbclid) return '';
  return `fb.1.${nowMs}.${fbclid}`;
}

/** Meta rejects the whole payload if a hashed field is an empty string. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export async function sendMetaCapi(
  config: { pixelId: string; accessToken: string; testEventCode?: string; apiVersion?: string },
  event: CapiEvent,
  timeoutMs = 5000,
): Promise<CapiResult> {
  const version = config.apiVersion ?? 'v21.0';
  const url = `https://graph.facebook.com/${version}/${config.pixelId}/events`;

  const [em, ph, fn, ln] = await Promise.all([
    hashEmail(event.user.email),
    hashPhone(event.user.phone),
    hashName(event.user.firstName),
    hashName(event.user.lastName),
  ]);

  // external_id goes RAW. The browser pixel sends the raw lead UUID; Meta
  // matches the two values as sent, so hashing here guaranteed a mismatch —
  // the secondary match key was dead on every server event. em/ph/fn/ln are
  // PII and MUST be hashed; the UUID is our own opaque value and must not be.
  const externalId = event.user.externalId || null;

  const userData = compact({
    em: em ? [em] : [],
    ph: ph ? [ph] : [],
    fn: fn ? [fn] : [],
    ln: ln ? [ln] : [],
    external_id: externalId ? [externalId] : [],
    fbp: event.user.fbp,
    fbc: event.user.fbc,
    client_ip_address: event.user.clientIp,
    client_user_agent: event.user.userAgent,
  });

  const payload = {
    data: [
      compact({
        event_name: event.eventName,
        event_time: event.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        action_source: event.actionSource ?? 'website',
        event_source_url: event.eventSourceUrl,
        user_data: userData,
        custom_data: event.custom ? compact(event.custom) : undefined,
      }),
    ],
    ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, detail: text.slice(0, 500) };
    }

    let received: number | undefined;
    try {
      received = (JSON.parse(text) as { events_received?: number }).events_received;
    } catch {
      /* Meta returned something unexpected but a 2xx; treat as sent. */
    }
    return { ok: true, status: res.status, detail: text.slice(0, 300), eventsReceived: received };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown CAPI error';
    return { ok: false, status: 0, detail };
  }
}
