/**
 * THE CONSENT RECORD — one versioned wording (D-04, paid-ads spec §1.8).
 *
 * Every surface that renders TCPA consent copy renders it FROM HERE, and the
 * server stores which version a lead agreed to. The rules:
 *
 *   1. The wording is never edited in place. A change is a NEW entry with a
 *      new version string; old versions stay forever, because a stored lead
 *      points at the version that was on screen when they submitted.
 *   2. The server resolves version → text itself. Client-supplied consent
 *      TEXT is never trusted or stored — a tampered POST could otherwise
 *      write "they agreed to anything" into the record.
 *   3. `{business}` is replaced with the client's `identity.name`, so the
 *      stored text is exactly what the visitor read on that client's site.
 */

export const CONSENT_VERSION = '2026-08-12.1';

const TEMPLATES: Record<string, string> = {
  '2026-08-12.1':
    'By submitting, I agree that {business} may call, text, and email me about my ' +
    'enquiry, including with automated messages. Consent is not a condition of ' +
    'purchase. Reply STOP to opt out.',
};

/**
 * Server-side version → text resolution. Unknown version → null; the API
 * rejects the lead rather than storing a consent record it cannot prove.
 */
export function consentTextFor(version: string, businessName: string): string | null {
  const template = TEMPLATES[version];
  return template ? template.replaceAll('{business}', businessName) : null;
}
