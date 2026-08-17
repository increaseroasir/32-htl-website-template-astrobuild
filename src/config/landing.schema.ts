/**
 * PAID LANDING PAGE SCHEMA.
 *
 * A landing page is ONE config file. The section vocabulary is shared with
 * the homepage (see sections.schema.ts) — a section type built for one is
 * immediately available to the other, and there is only ever one renderer.
 *
 * WHY LANDING PAGES ARE THEIR OWN PAGE TYPE
 * -----------------------------------------
 * A paid landing page has the opposite requirements to every other page:
 *
 *   - it must NOT be indexed (paid-only; indexed it competes with the real
 *     site for the same keywords and collects traffic already paid for)
 *   - it must NOT have nav, a footer sitemap, or any organic link out —
 *     every escape hatch is a paid click leaving without converting
 *   - it repeats the SAME call to action rather than offering choices
 *
 * Rendering one through BaseLayout would give it a header, nav and a footer
 * full of links. So it gets its own layout, its own route prefix that
 * robots.txt disallows, and the sitemap excludes it.
 *
 * WHAT IS TEMPLATED AND WHAT IS NOT
 * ---------------------------------
 * The STRUCTURE is templated. The CLAIMS are not, and cannot be: "#1 rated"
 * is true for one client and a false advertising claim for the next. Every
 * superlative carries a required footnote, and the build fails without one.
 */

import { z } from 'zod';
import { CATEGORY_SLUGS } from './categories';
import { sectionSchema, collectFootnotes } from './sections.schema';

export { claimSchema, collectFootnotes } from './sections.schema';
export type { Claim, Section } from './sections.schema';

export const landingSchema = z
  .object({
    /** URL segment. The page lives at /lp/<slug>. */
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers and hyphens.'),

    /** Internal name for you, never rendered. */
    internalName: z.string().min(1),

    /** Browser tab title. Not indexed, but it shows in the tab and on share. */
    title: z.string().min(1),

    /**
     * Which category this page sells. Must be one the client has enabled — a
     * landing page for a product they do not sell is the saunas defect with a
     * media budget behind it.
     */
    category: z.enum([...CATEGORY_SLUGS]),

    /**
     * The FTC advertorial label. Required and not overridable to empty: an ad
     * styled as editorial without disclosure is a deceptive format.
     */
    advertorialLabel: z.string().min(1).default('Advertorial'),

    sections: z.array(sectionSchema).min(1),

    /** Legal text under the fold. Consent language, disclaimers. */
    disclosures: z.array(z.string().min(1)).default([]),

    /**
     * The ONE link allowed off this page. Everything else is a dead end on
     * purpose. Use it for the "I'm not a homeowner" exit that monetises
     * non-buyers, or leave it null.
     */
    exitLink: z
      .object({ label: z.string().min(1), href: z.string().min(1) })
      .nullable()
      .default(null),
  })
  .superRefine((lp, ctx) => {
    // At least one lead form, or the page cannot convert.
    const hasForm =
      lp.sections.some((s) => s.type === 'cta') ||
      lp.sections.some((s) => s.type === 'hero' && s.leadCard !== null);
    if (!hasForm) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'A landing page with no lead form cannot convert. Add a cta section or a hero leadCard.',
      });
    }
    // The first section must be the hero — a paid visitor decides in the first
    // screen and there is nothing above it to earn the scroll.
    if (lp.sections[0]?.type !== 'hero') {
      ctx.addIssue({ code: 'custom', path: ['sections', 0], message: 'The first section must be the hero.' });
    }
    // A superlative needs somewhere for its substantiation to print.
    if (collectFootnotes(lp.sections).length > 0 && lp.disclosures.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['disclosures'],
        message:
          'This page makes a superlative claim but has no disclosures block to print the substantiation in.',
      });
    }
  });

export type Landing = z.infer<typeof landingSchema>;
export type LandingInput = z.input<typeof landingSchema>;
export type LandingSection = Landing['sections'][number];
