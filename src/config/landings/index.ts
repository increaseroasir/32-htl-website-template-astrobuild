/**
 * LANDING PAGE REGISTRY.
 *
 * Every file in this folder that exports `landing` becomes a page at
 * /lp/<slug>. Adding a landing page is adding one file — there is no second
 * list to register it in, and therefore no way for the list and the files to
 * disagree.
 *
 * Each one is validated against landing.schema.ts at build time, and a
 * landing page for a category the client has not enabled is a BUILD ERROR.
 * Running paid traffic to a product the client does not sell is the saunas
 * defect with a media budget attached to it.
 */

import { landingSchema, type Landing } from '../landing.schema';
import { site } from './../index';
import { CATEGORY_CATALOG } from '../categories';

/**
 * Only the TOP level of this folder is live. `examples/` is deliberately not
 * matched — the shipped example is a shape to copy, not a page to serve, and
 * a template that ships a live landing page full of the word EXAMPLE is the
 * placeholder-text defect all over again.
 *
 * To activate one: copy examples/<x>.landing.ts up one level and edit it.
 */
const modules = import.meta.glob<{ landing: unknown }>('./*.landing.ts', { eager: true });

const parsed: Landing[] = [];
const problems: string[] = [];

for (const [path, mod] of Object.entries(modules)) {
  if (!mod || typeof mod !== 'object' || !('landing' in mod)) {
    problems.push(`${path} does not export "landing".`);
    continue;
  }
  const result = landingSchema.safeParse(mod.landing);
  if (!result.success) {
    for (const issue of result.error.issues) {
      problems.push(`${path} → ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    continue;
  }
  parsed.push(result.data);
}

// A landing page may only sell a category this client has enabled.
for (const lp of parsed) {
  const enabled = site.categories[lp.category]?.enabled === true;
  if (!enabled) {
    problems.push(
      `./${lp.slug}.landing.ts → category "${lp.category}" is not enabled for this client. ` +
        `Enable it in client.config.ts or delete the landing page. Paid traffic must not point at something they do not sell.`,
    );
  }
}

// Duplicate slugs would silently shadow each other on the route.
const seen = new Set<string>();
for (const lp of parsed) {
  if (seen.has(lp.slug)) problems.push(`Two landing pages share the slug "${lp.slug}".`);
  seen.add(lp.slug);
}

if (problems.length > 0) {
  throw new Error(
    `\n\nLANDING PAGE CONFIG INVALID — build stopped.\n\n` +
      problems.map((p) => `  • ${p}`).join('\n') +
      `\n\nFix src/config/landings/ and rebuild.\n`,
  );
}

export const landings: readonly Landing[] = parsed.sort((a, b) => a.slug.localeCompare(b.slug));

export function findLanding(slug: string): Landing | undefined {
  return landings.find((l) => l.slug === slug);
}

/** The catalog label for a landing page's category, for breadcrumb-free copy. */
export function categoryLabelFor(lp: Landing): string {
  return (
    site.categories[lp.category]?.label ??
    CATEGORY_CATALOG.find((c) => c.slug === lp.category)?.label ??
    lp.category
  );
}
