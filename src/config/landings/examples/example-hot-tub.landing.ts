/**
 * EXAMPLE LANDING PAGE — the shape, not the copy.
 *
 * Every string here is placeholder text written to demonstrate the structure.
 * NONE of it is a claim any real business has substantiated. Replace all of
 * it before running a single dollar of traffic.
 *
 * Copy this file, rename it `<your-slug>.landing.ts`, and it becomes a page
 * at /lp/<your-slug>. There is no list to register it in.
 *
 * WHAT THE STRUCTURE IS DOING, section by section:
 *
 *   hero        — the headline names the OUTCOME, not the business. The
 *                 subhead pre-qualifies, so the wrong clicks bounce before
 *                 they cost a lead instead of after.
 *   cta         — placed high. A visitor ready to convert should not have to
 *                 scroll to find the form.
 *   benefits    — outcome-framed, not feature-framed.
 *   gallery     — proof of scale. Real installs, never stock photography.
 *   testimonials— first name + last initial, and a SPECIFIC detail. Specifics
 *                 are what make a testimonial read as real.
 *   bignumber   — one figure, stated precisely. "2,400" beats "thousands".
 *   faq         — handles the objections the form otherwise absorbs.
 *   cta         — repeated. The SAME offer, not an A/B variant within a page.
 *
 * On superlatives: any bullet with `superlative: true` REQUIRES a footnote,
 * and the build fails without one. That is the only place this template
 * refuses to ship something merely because it renders.
 */

// NOTE: this path has one more `../` than a live landing page needs, because
// examples live one folder deeper. When you copy this file up into
// src/config/landings/, change it to '../landing.schema'.
import type { LandingInput } from '../../landing.schema';

export const landing: LandingInput = {
  slug: 'example-hot-tub',
  internalName: 'EXAMPLE — hot tub offer (replace before use)',
  title: 'See Hot Tub Pricing — EXAMPLE PAGE',
  category: 'hot-tub',

  sections: [
    {
      type: 'hero',
      // No business name in the headline. The outcome goes here.
      headline: 'EXAMPLE HEADLINE — the outcome, a number, and a timeframe',
      // Pre-qualifier. Lose the wrong click before it costs a lead.
      subhead: 'EXAMPLE — for homeowners in [service area] with a level backyard.',
      image: null,
      bullets: [
        { text: 'EXAMPLE — outcome-framed benefit, not a feature', superlative: false, footnote: null },
        { text: 'EXAMPLE — what changes for them, stated plainly', superlative: false, footnote: null },
        { text: 'EXAMPLE — the objection this removes', superlative: false, footnote: null },
        {
          text: 'EXAMPLE — a superlative claim, which is why it carries a marker',
          superlative: true,
          footnote:
            'EXAMPLE FOOTNOTE — replace with the real substantiation: the source, the sample, the date. An unsubstantiated superlative is a false advertising claim.',
        },
      ],
    },

    {
      type: 'cta',
      heading: 'EXAMPLE — see local pricing',
      buttonLabel: 'What are you shopping for?',
      subtext: 'EXAMPLE — soft, low-commitment subtext.',
    },

    {
      type: 'trust',
      items: ['EXAMPLE — Family owned', 'EXAMPLE — Local delivery', 'EXAMPLE — Real people answer'],
      logos: [],
    },

    {
      type: 'benefits',
      heading: 'EXAMPLE — what they actually get',
      items: [
        { title: 'EXAMPLE benefit one', body: 'EXAMPLE — one or two sentences.', icon: null },
        { title: 'EXAMPLE benefit two', body: 'EXAMPLE — one or two sentences.', icon: null },
        { title: 'EXAMPLE benefit three', body: 'EXAMPLE — one or two sentences.', icon: null },
        { title: 'EXAMPLE benefit four', body: 'EXAMPLE — one or two sentences.', icon: null },
      ],
    },

    {
      type: 'bignumber',
      value: 'EXAMPLE',
      label: 'EXAMPLE — what the number counts',
      claim: null,
    },

    {
      type: 'reviews',
      heading: 'EXAMPLE — what customers say',
      items: [
        {
          name: 'EXAMPLE — First name + last initial',
          rating: 5,
          location: 'EXAMPLE — town',
          quote: 'EXAMPLE — a real quote, in their words, with a specific detail in it.',
          detail: 'EXAMPLE — the specific: what they bought, what they were worried about.',
          source: null,
          date: null,
        },
        {
          name: 'EXAMPLE — First name + last initial',
          rating: 5,
          location: 'EXAMPLE — town',
          quote: 'EXAMPLE — second testimonial.',
          detail: null,
          source: null,
          date: null,
        },
      ],
      aggregate: null,
    },

    {
      type: 'faq',
      heading: 'EXAMPLE — questions people ask',
      items: [
        { q: 'EXAMPLE — the price question', a: 'EXAMPLE — answer it honestly.' },
        { q: 'EXAMPLE — the delivery question', a: 'EXAMPLE — answer it honestly.' },
        { q: 'EXAMPLE — the objection that kills the sale', a: 'EXAMPLE — answer it honestly.' },
      ],
    },

    {
      // Repeated. Same offer, same wording — not a variant.
      type: 'cta',
      heading: 'EXAMPLE — see local pricing',
      buttonLabel: 'What are you shopping for?',
      subtext: null,
    },
  ],

  disclosures: [
    'EXAMPLE DISCLOSURE — replace before running traffic. Consent language, and any disclaimer the offer requires.',
  ],

  // The single link allowed off this page, or null. Use it to catch the
  // people who will never buy — the wrong trade, the wrong region — rather
  // than letting them bounce.
  exitLink: null,
};
