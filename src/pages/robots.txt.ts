/**
 * robots.txt, generated so the Sitemap line carries the client's real
 * domain from config rather than a hand-typed URL that could drift.
 */
import type { APIRoute } from 'astro';
import { site } from '../config';

export const GET: APIRoute = () => {
  const body = [
    '# Admin is URL + server-auth only: never linked, never in the sitemap,',
    '# and served with X-Robots-Tag: noindex, nofollow. This is belt and',
    '# braces, not the mechanism.',
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api/',
    '# Paid landing pages. Also noindex in the markup and absent from the',
    '# sitemap — three mechanisms, because a leaked LP is quiet and costly.',
    'Disallow: /lp/',
    '# Internal config diagnostic. Never linked, noindex in the markup.',
    'Disallow: /proof',
    'Allow: /',
    '',
    `Sitemap: ${new URL('/sitemap-index.xml', site.identity.siteUrl).href}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
