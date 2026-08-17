/**
 * Shared JSON responses and Bearer extraction for public lead APIs.
 * Admin keeps its own json() (private + X-Robots-Tag). Admin auth keeps
 * its case-insensitive Bearer parse — these helpers stay case-sensitive.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function bearer(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
