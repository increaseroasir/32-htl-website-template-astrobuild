/**
 * SHA-256 hashing for PII sent to advertising platforms.
 *
 * Meta requires every identifier to be normalised THEN hashed. Getting the
 * normalisation wrong is the usual reason match rates are quietly poor: the
 * hash of "Bob@Example.com " and "bob@example.com" are different strings, so
 * a mis-normalised email simply never matches anyone and no error is raised.
 */

import { digitsOnly } from './validate-lead';

/** Hex SHA-256. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Lowercase, trimmed. Returns null for an empty value — never hash "". */
export async function hashEmail(email: string): Promise<string | null> {
  const clean = email.trim().toLowerCase();
  return clean ? sha256Hex(clean) : null;
}

/**
 * Digits only, with a country code. Meta expects E.164 WITHOUT the leading
 * "+". A 10-digit North American number is assumed to be +1; anything else
 * is passed through as-is rather than guessed at.
 */
export async function hashPhone(phone: string, defaultCountryCode = '1'): Promise<string | null> {
  const digits = digitsOnly(phone);
  if (!digits) return null;
  const e164 = digits.length === 10 ? `${defaultCountryCode}${digits}` : digits;
  return sha256Hex(e164);
}

/** Lowercase, trimmed, punctuation removed — Meta's rule for names. */
export async function hashName(name: string): Promise<string | null> {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-zÀ-ɏ ]/g, '')
    .trim();
  return clean ? sha256Hex(clean) : null;
}

/** Lowercase, trimmed. Used for city/region if ever sent. */
export async function hashPlain(value: string): Promise<string | null> {
  const clean = value.trim().toLowerCase();
  return clean ? sha256Hex(clean) : null;
}
