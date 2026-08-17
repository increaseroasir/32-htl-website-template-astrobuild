/**
 * ADMIN AUTH — REUSED FROM SUN POOL, DELIBERATELY UNCHANGED.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  DO NOT REDESIGN THIS.                                           │
 * │  This is a faithful port of functions/api/admin.js from the      │
 * │  existing Sun Pool build. The mechanism is identical:            │
 * │                                                                  │
 * │    - password compared against env.ADMIN_PASSWORD                │
 * │    - token = crypto.randomUUID() + crypto.randomUUID()           │
 * │    - stored as SHA-256(token + ADMIN_SESSION_SECRET)             │
 * │    - row in admin_sessions with a 7-day expires_at               │
 * │    - every request checks Authorization: Bearer <token>          │
 * │    - expired rows swept on login                                 │
 * │                                                                  │
 * │  Only two things changed, and neither touches the mechanism:     │
 * │    1. Module shape — Astro API routes, not Pages Functions.      │
 * │    2. Bindings come from `cloudflare:workers`, because Astro 6   │
 * │       removed locals.runtime.env.                                │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Two properties of the original worth stating plainly, since they are
 * inherited rather than chosen here:
 *
 *   - The password check is a plain `!==` comparison, so it is not
 *     constant-time, and there is no rate limiting or lockout. A slow
 *     online guessing attack is not defended against.
 *   - The token is a bearer credential held by the browser; anyone holding
 *     it has admin until it expires.
 *
 * Both are unchanged on purpose. Changing them is a security project with
 * its own testing, not a side effect of a template rebuild.
 */

import { env } from 'cloudflare:workers';

export interface AdminSession {
  token_hash: string;
  created_at: number;
  expires_at: number;
}

/** Seven days, exactly as the original. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getEnv(): Partial<Env> {
  return env as unknown as Partial<Env>;
}

export { secretsMatch } from './secrets';

/** Hex SHA-256. Same helper, same output as the original `sha256()`. */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Is admin usable at all? Missing secrets means "not configured", not "open". */
export function adminConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.ADMIN_PASSWORD && e.ADMIN_SESSION_SECRET);
}

/**
 * Verifies the Bearer token against admin_sessions. Returns the session row
 * or null. Identical logic to the original `requireSession`.
 */
export async function requireSession(
  db: D1Database,
  request: Request,
): Promise<AdminSession | null> {
  const e = getEnv();
  if (!e.ADMIN_SESSION_SECRET) return null;

  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const tokenHash = await sha256(token + e.ADMIN_SESSION_SECRET);
  const row = await db
    .prepare('SELECT * FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(tokenHash, Date.now())
    .first<AdminSession>();

  return row ?? null;
}

/**
 * Issues a session. Sweeps expired rows first, exactly as the original did
 * on every login.
 */
export async function createSession(db: D1Database): Promise<string> {
  const e = getEnv();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256(token + (e.ADMIN_SESSION_SECRET ?? ''));
  const now = Date.now();

  await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now).run();
  await db
    .prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, now, now + SESSION_TTL_MS)
    .run();

  return token;
}

/** Explicit logout — deletes just this session's row. */
export async function destroySession(db: D1Database, request: Request): Promise<void> {
  const e = getEnv();
  if (!e.ADMIN_SESSION_SECRET) return;
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return;
  const tokenHash = await sha256(token + e.ADMIN_SESSION_SECRET);
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
}
