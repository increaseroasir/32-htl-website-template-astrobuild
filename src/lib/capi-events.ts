/**
 * THE CONVERSION VALUE LADDER — one table, one place.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Lead is worth 0. That is not a placeholder — it is the design.  │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * A form fill costs the business nothing and is worth nothing until someone
 * qualifies it. If `Lead` carried a positive value, Meta would optimise for
 * volume of form fills — which is exactly how an account fills up with cheap
 * leads that never buy. Sending 0 tells Meta the opposite: the signal it
 * should learn from is what happens AFTER the form.
 *
 * That only works if the later events actually fire. Four of the five below
 * are not website events at all — they happen in the CRM, days later, when a
 * human moves a deal down the pipeline. They come back in through
 * POST /api/lead-stage with `action_source: 'system_generated'`, which is
 * Meta's marker for "this conversion did not happen in a browser".
 *
 *   Lead            0        someone submitted the form
 *   QualifiedLead   75       a human confirmed they are a real buyer
 *   Schedule        300      an appointment is on the calendar
 *   Showed          600      they turned up
 *   Purchase        actual   the real sale value — never a default
 *
 * WHY THE NUMBERS ARE ENV VARS, NOT CONFIG
 * ----------------------------------------
 * These are commercial figures that change when margins change, and they
 * differ per client on the same codebase. They are set with
 * `wrangler secret put` alongside the pixel ID and CAPI token — the same rule
 * that keeps every other client-specific commercial value out of git. The
 * config schema is untouched.
 *
 * PURCHASE IS DELIBERATELY DIFFERENT
 * ----------------------------------
 * Every other event has a default. Purchase has none, and the endpoint
 * REFUSES it without a positive value. A defaulted purchase value is a lie
 * told to the bidding algorithm in units of dollars, and it is a lie that
 * compounds — Meta will go and find more people like whoever it thinks bought
 * for that amount. Better to drop the event than to send a made-up number.
 */

export const CAPI_EVENT_NAMES = [
  'Lead',
  'QualifiedLead',
  'Schedule',
  'Showed',
  'Purchase',
] as const;

export type CapiEventName = (typeof CAPI_EVENT_NAMES)[number];

/** Events the CRM may fire. `Lead` is excluded — only the website sends that. */
export const STAGE_EVENT_NAMES = ['QualifiedLead', 'Schedule', 'Showed', 'Purchase'] as const;
export type StageEventName = (typeof STAGE_EVENT_NAMES)[number];

export interface CapiEventDefinition {
  readonly name: CapiEventName;
  /**
   * 'website' — happened in a browser we were watching.
   * 'system_generated' — happened elsewhere and was reported afterwards.
   * Getting this wrong is not cosmetic: Meta uses it to decide how to
   * attribute and how much to trust the browser signals attached to it.
   */
  readonly actionSource: 'website' | 'system_generated';
  /** Fallback when no env override and no supplied value. null = required. */
  readonly defaultValue: number | null;
  /** Secret name that overrides the default. */
  readonly envKey: string | null;
  /** Whether the caller may supply a value at all. */
  readonly acceptsSuppliedValue: boolean;
}

export const CAPI_EVENTS: Record<CapiEventName, CapiEventDefinition> = {
  Lead: {
    name: 'Lead',
    actionSource: 'website',
    defaultValue: 0,
    envKey: 'META_VALUE_LEAD',
    acceptsSuppliedValue: false,
  },
  QualifiedLead: {
    name: 'QualifiedLead',
    actionSource: 'system_generated',
    defaultValue: 75,
    envKey: 'META_VALUE_QUALIFIED',
    acceptsSuppliedValue: false,
  },
  Schedule: {
    name: 'Schedule',
    actionSource: 'system_generated',
    defaultValue: 300,
    envKey: 'META_VALUE_SCHEDULE',
    acceptsSuppliedValue: false,
  },
  Showed: {
    name: 'Showed',
    actionSource: 'system_generated',
    defaultValue: 600,
    envKey: 'META_VALUE_SHOWED',
    acceptsSuppliedValue: false,
  },
  Purchase: {
    name: 'Purchase',
    actionSource: 'system_generated',
    // No default, on purpose. See the header comment.
    defaultValue: null,
    envKey: null,
    acceptsSuppliedValue: true,
  },
};

export function isStageEvent(value: string): value is StageEventName {
  return (STAGE_EVENT_NAMES as readonly string[]).includes(value);
}

/** A malformed secret must not silently become 0 — it must be ignored. */
function parseEnvValue(raw: string | undefined): { kind: 'absent' } | { kind: 'malformed' } | { kind: 'ok'; value: number } {
  if (raw === undefined || raw === null || raw.trim() === '') return { kind: 'absent' };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { kind: 'malformed' };
  return { kind: 'ok', value: n };
}

export type ValueResolution =
  | {
      ok: true;
      value: number;
      source: 'supplied' | 'env' | 'default';
      /**
       * Set when the env override existed but was unusable (not a number,
       * or negative) and the default was used instead. The caller MUST log
       * it with the var name — a typo'd secret silently becoming another
       * business's default economics is K-06's exact failure mode.
       */
      malformedEnvKey?: string;
    }
  | { ok: false; error: string };

/**
 * Works out what value to send, in this order:
 *   1. a value the caller supplied (Purchase only)
 *   2. the env override for this event
 *   3. the built-in default
 * and fails when an event that requires a real number does not have one.
 */
export function resolveEventValue(
  eventName: CapiEventName,
  env: Record<string, string | undefined>,
  supplied?: unknown,
): ValueResolution {
  const def = CAPI_EVENTS[eventName];

  if (def.acceptsSuppliedValue && supplied !== undefined && supplied !== null && supplied !== '') {
    const n = typeof supplied === 'number' ? supplied : Number(supplied);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `${eventName} value must be a number.` };
    }
    if (n <= 0) {
      return { ok: false, error: `${eventName} requires a value greater than 0.` };
    }
    return { ok: true, value: n, source: 'supplied' };
  }

  const fromEnv = def.envKey ? parseEnvValue(env[def.envKey]) : ({ kind: 'absent' } as const);
  if (fromEnv.kind === 'ok') return { ok: true, value: fromEnv.value, source: 'env' };

  if (def.defaultValue !== null) {
    return {
      ok: true,
      value: def.defaultValue,
      source: 'default',
      ...(fromEnv.kind === 'malformed' && def.envKey ? { malformedEnvKey: def.envKey } : {}),
    };
  }

  return {
    ok: false,
    error: `${eventName} requires a positive value — send "value" or "actual_sale_value". No default is applied.`,
  };
}
