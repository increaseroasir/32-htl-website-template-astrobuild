/**
 * LEAD VALIDATION — one pure function, the server's single decider (C7).
 *
 * Everything that decides whether a POST becomes a lead lives here, where a
 * test can reach it without a Workers runtime:
 *
 *   - the honeypot verdict (L-04): a filled `company` field is a bot. The
 *     SERVER decides — a bot POSTing straight to the API used to bypass the
 *     only spam trap because it lived in the island's JavaScript.
 *   - the consent version (C4): resolved to its exact wording server-side;
 *     unknown/missing → reject.
 *   - the field rules the handler previously applied inline.
 *
 * Verdicts:
 *   drop    — pretend success, log, write nothing (bots must not learn).
 *   reject  — 400 with a customer-safe message.
 *   ok      — cleaned fields, ready to insert.
 */

import { isCategoryEnabled } from '../config';
import { consentTextFor } from '../config/consent';

/** Strip control characters and angle brackets, then cap the length. */
export function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Deliberately permissive — a real customer with an odd address still counts. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** North American sanity check: at least 10 digits once punctuation is gone. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export interface LeadFields {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
  category: string;
  productSlug: string;
  sourcePage: string;
  eventId: string;
  consentVersion: string;
  consentText: string;
}

export type LeadVerdict =
  | { kind: 'drop'; reason: string }
  | { kind: 'reject'; status: number; error: string }
  | { kind: 'ok'; lead: LeadFields };

export function validateLead(body: Record<string, unknown>, businessName: string): LeadVerdict {
  // Honeypot FIRST — before any other work. Humans never see the field, so
  // a value in it is a bot (or, rarely, aggressive autofill: the caller
  // logs the drop so that recovery path exists — I-07).
  const company = clean(body.company, 200);
  if (company.length > 0) {
    return { kind: 'drop', reason: 'honeypot' };
  }

  const name = clean(body.name, 140);
  const email = clean(body.email, 200).toLowerCase();
  const phone = digitsOnly(clean(body.phone, 40));
  const message = clean(body.message, 1000);
  const productSlug = clean(body.productSlug, 120);
  const sourcePage = clean(body.sourcePage, 200);
  const eventId = clean(body.eventId, 80) || crypto.randomUUID();

  // Category: empty is fine ("just browsing"), but a value must be one this
  // client actually sells. Not a 500 — a clear, honest rejection.
  const category = clean(body.category, 40);
  if (category && !isCategoryEnabled(category)) {
    return { kind: 'reject', status: 400, error: 'That is not something we sell.' };
  }

  // Consent: version resolved to its exact wording SERVER-SIDE (C4).
  const consentVersion = clean(body.consentVersion, 40);
  const consentText = consentVersion ? consentTextFor(consentVersion, businessName) : null;
  if (!consentText) {
    return { kind: 'reject', status: 400, error: 'Please refresh the page and submit again.' };
  }

  const problems: string[] = [];
  if (name.length < 2) problems.push('a name');
  if (phone.length < 10) problems.push('a phone number');
  if (!looksLikeEmail(email)) problems.push('a valid email');
  if (problems.length > 0) {
    return { kind: 'reject', status: 400, error: `Please add ${problems.join(', ')}.` };
  }

  const [firstName = '', ...rest] = name.split(' ');
  return {
    kind: 'ok',
    lead: {
      name,
      firstName,
      lastName: rest.join(' '),
      email,
      phone,
      message,
      category,
      productSlug,
      sourcePage,
      eventId,
      consentVersion,
      consentText,
    },
  };
}
