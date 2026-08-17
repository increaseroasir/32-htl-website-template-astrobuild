/**
 * INTAKE → CONFIG OBJECT  (Phase A: in-memory only)
 *
 * Takes one intake answer file and returns the config object the template's
 * schema expects. It does NOT write a file, format TypeScript, or emit
 * comments — that is Phase B's generator. This exists so Phase A can prove one
 * thing before any of that is built: a filled-in intake form contains enough
 * information, in the right shapes, to produce a config the template accepts.
 *
 * THREE RULES IT ENFORCES, ALL OF THEM ON PURPOSE
 * -----------------------------------------------
 * 1. deployMode is ALWAYS 'template'. A generated config physically cannot
 *    deploy, because the template's existing gate refuses 'template'. Approval
 *    is a separate, deliberate act — not something a form submission can do.
 *
 * 2. nav ALWAYS starts with { type: 'categories' }, and extra links are
 *    checked against the category route segments before they are added. The
 *    schema would reject a link to a disabled category anyway; refusing to
 *    write one in the first place turns a build error into a clear message.
 *
 * 3. An unchecked category is OMITTED, never written as enabled:false. Absent
 *    is the template's "off". Writing the key would leave a half-present
 *    category in the config for someone to flip on by accident.
 *
 * Defaults are not typed here either — they are read from the field manifest,
 * which reads them from policy/field-policy.mjs. One source.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(resolve(HERE, '../field-manifest.json'), 'utf8'));

/** Category slug → URL segment, read from the template's own catalog. */
export const CATEGORY_SEGMENTS = {
  'hot-tub': 'hot-tubs',
  'swim-spa': 'swim-spas',
  sauna: 'saunas',
  'massage-chair': 'massage-chairs',
  'cold-plunge': 'cold-plunges',
};

/** The value the form pre-fills for a `default`-source field. */
function defaultFor(path) {
  const f = MANIFEST.fields.find((x) => x.path === path);
  if (!f) throw new Error(`No manifest entry for "${path}" — rebuild the manifest.`);
  return f.example;
}

/** Build an object of defaults for every field under a prefix. */
function defaultsUnder(prefix) {
  const out = {};
  for (const f of MANIFEST.fields) {
    if (!f.path.startsWith(prefix + '.')) continue;
    const key = f.path.slice(prefix.length + 1);
    if (key.includes('.') || key.includes('[') || key.includes('{')) continue;
    if (f.source !== 'default') continue;
    out[key] = f.example;
  }
  return out;
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const orNull = (v) => (blank(v) ? null : v);

export class IntakeError extends Error {}

/** null unless the client actually offers financing AND stated the terms. */
function assembleFinancing(fin) {
  if (!fin || typeof fin !== 'object') return null;
  const filled = [fin.headline, fin.blurb, fin.disclaimer].some((v) => !blank(v));
  const bullets = (fin.bullets ?? []).filter((b) => !blank(b));
  if (!filled && bullets.length === 0) return null;

  const missing = [];
  if (blank(fin.headline)) missing.push('headline');
  if (blank(fin.blurb)) missing.push('blurb');
  if (bullets.length === 0) missing.push('bullets');
  if (blank(fin.disclaimer)) missing.push('disclaimer');
  if (missing.length) {
    throw new IntakeError(
      `Financing is partly filled in — missing: ${missing.join(', ')}. ` +
        `Either complete it or clear the whole section. An offer published without its ` +
        `qualifying terms is the part that carries legal risk.`,
    );
  }

  return {
    headline: fin.headline,
    blurb: fin.blurb,
    bullets,
    lenderName: orNull(fin.lenderName),
    applyUrl: orNull(fin.applyUrl),
    disclaimer: fin.disclaimer,
  };
}

export function assembleConfig(intake) {
  if (!intake || typeof intake !== 'object') throw new IntakeError('Intake must be an object.');
  const b = intake.business ?? {};
  const c = intake.contact ?? {};
  const l = intake.location ?? {};
  const brand = intake.brand ?? {};
  const nav = intake.nav ?? {};
  const integrations = intake.integrations ?? {};

  /* ---- categories: presence means enabled, order means sortOrder ---- */
  const rawCats = Array.isArray(intake.categories) ? intake.categories : [];
  const categories = {};
  rawCats.forEach((entry, i) => {
    const slug = typeof entry === 'string' ? entry : entry?.slug;
    if (!slug) throw new IntakeError(`categories[${i}] has no slug.`);
    if (!(slug in CATEGORY_SEGMENTS)) {
      throw new IntakeError(
        `Unknown category "${slug}". The template supports: ${Object.keys(CATEGORY_SEGMENTS).join(', ')}.`,
      );
    }
    if (categories[slug]) throw new IntakeError(`Category "${slug}" listed twice.`);
    const o = typeof entry === 'string' ? {} : entry;
    categories[slug] = {
      enabled: true,
      label: orNull(o.label),
      blurb: orNull(o.blurb),
      heroImage: orNull(o.heroImage),
      sortOrder: typeof o.sortOrder === 'number' ? o.sortOrder : (i + 1) * 10,
    };
  });

  /* ---- nav: categories placeholder first, then the client's extras ---- */
  const enabledSegments = new Set(Object.keys(categories).map((s) => CATEGORY_SEGMENTS[s]));
  const allSegments = new Set(Object.values(CATEGORY_SEGMENTS));
  const items = [{ type: 'categories' }];
  for (const link of nav.extraLinks ?? []) {
    const seg = /^\/([a-z-]+)\/?$/.exec(link.href ?? '')?.[1];
    if (seg && allSegments.has(seg) && !enabledSegments.has(seg)) {
      throw new IntakeError(
        `Nav link "${link.label}" points at /${seg}, but that category is not checked. ` +
          `Category links are added automatically for checked categories — remove this one.`,
      );
    }
    if (seg && enabledSegments.has(seg)) {
      throw new IntakeError(
        `Nav link "${link.label}" duplicates the automatic /${seg} category link. Remove it.`,
      );
    }
    items.push({
      type: link.external ? 'external' : 'link',
      label: link.label,
      href: link.href,
      inHeader: link.inHeader ?? !link.external,
      inFooter: link.inFooter ?? true,
    });
  }

  return {
    // RULE 1 — always 'template'. Never taken from the intake file.
    deployMode: 'template',

    identity: {
      name: b.name,
      shortName: b.shortName,
      foundedYear: b.foundedYear,
      tagline: b.tagline,
      siteUrl: b.siteUrl,
      schemaType: b.schemaType ?? defaultFor('identity.schemaType'),
    },

    contact: {
      phone: c.phone,
      phoneDisplayOverride: orNull(c.phoneDisplayOverride),
      smsPhone: orNull(c.smsPhone),
      email: orNull(c.email),
    },

    address: {
      street: l.street,
      street2: orNull(l.street2),
      city: l.city,
      region: l.region,
      postalCode: l.postalCode,
      country: l.country ?? defaultFor('address.country'),
      latitude: l.latitude,
      longitude: l.longitude,
      googlePlaceId: orNull(l.googlePlaceId),
    },

    hours: intake.hours ?? [],

    social: {
      facebook: orNull(intake.social?.facebook),
      instagram: orNull(intake.social?.instagram),
      youtube: orNull(intake.social?.youtube),
      tiktok: orNull(intake.social?.tiktok),
      x: orNull(intake.social?.x),
      linkedin: orNull(intake.social?.linkedin),
      googleBusiness: orNull(intake.social?.googleBusiness),
    },

    brand: {
      colors: { ...defaultsUnder('brand.colors'), ...(brand.colors ?? {}) },
      fonts: { ...defaultsUnder('brand.fonts'), ...(brand.fonts ?? {}) },
      logos: {
        nav: brand.logos?.nav,
        footer: brand.logos?.footer,
        inventory: orNull(brand.logos?.inventory),
        favicon: blank(brand.logos?.favicon) ? defaultFor('brand.logos.favicon') : brand.logos.favicon,
        ogImage: blank(brand.logos?.ogImage) ? defaultFor('brand.logos.ogImage') : brand.logos.ogImage,
      },
      radius: { ...defaultsUnder('brand.radius'), ...(brand.radius ?? {}) },
    },

    nav: {
      items,
      primaryCta: {
        label: nav.primaryCta?.label ?? defaultFor('nav.primaryCta.label'),
        href: nav.primaryCta?.href ?? defaultFor('nav.primaryCta.href'),
      },
      legalItems: nav.legalItems ?? [
        { label: defaultFor('nav.legalItems[].label'), href: defaultFor('nav.legalItems[].href') },
      ],
    },

    categories,
    serviceAreas: intake.serviceAreas ?? [],

    /**
     * Financing is all-or-nothing. A partly-filled block would render a page
     * advertising an offer with no qualifying terms on it, which is the one
     * shape of this page that is worse than not having it.
     */
    financing: assembleFinancing(intake.financing),

    /**
     * A default homepage that needs no copy from anyone. The hero headline is
     * null so it falls back to the tagline; the category row builds itself
     * from the checked categories; the product row reads live inventory.
     * Reviews, stats, comparisons and FAQs are added later from real material
     * — they are the sections that cannot be invented.
     */
    homepage: {
      title: null,
      description: null,
      sections: [
        { type: 'hero', headline: null, actions: [{ label: 'Shop Inventory', href: '/inventory' }] },
        { type: 'categories', heading: 'What we sell' },
        {
          type: 'products',
          heading: 'On the floor now',
          limit: 4,
          moreLink: { label: 'See everything in stock', href: '/inventory' },
        },
        {
          type: 'cta',
          heading: 'Not sure which one fits?',
          buttonLabel: 'What are you shopping for?',
          subtext: "Tell us what you're shopping for and we'll send current pricing on what's in stock.",
        },
      ],
      disclosures: [],
    },

    integrations: {
      d1BindingName: defaultFor('integrations.d1BindingName'),
      r2BindingName: defaultFor('integrations.r2BindingName'),
      ghl: { enabled: !!integrations.ghl },
      meta: { enabled: !!integrations.meta },
      zaraz: { enabled: !!integrations.zaraz },
      sentry: { enabled: !!integrations.sentry },
    },
  };
}

/**
 * Fields the review step must eyeball because a plausible default was used
 * where a real client value belongs. Not errors — the build passes with these.
 * That is exactly why a human has to look.
 */
export function reviewWarnings(intake, config) {
  const warn = [];
  if (config.brand.logos.favicon === defaultFor('brand.logos.favicon'))
    warn.push('Favicon is still the template placeholder.');
  if (config.brand.logos.ogImage === defaultFor('brand.logos.ogImage'))
    warn.push('Share image (OG) is still the template placeholder — this is what shows when the site is shared.');
  if (Object.values(config.social).every((v) => v === null))
    warn.push('No social profiles. The LocalBusiness schema will have no sameAs at all.');
  if (config.contact.email === null) warn.push('No email address is published anywhere on the site.');
  if (config.serviceAreas.length === 0) warn.push('No service areas listed.');
  const defaults = defaultsUnder('brand.colors');
  if (Object.entries(defaults).every(([k, v]) => config.brand.colors[k] === v))
    warn.push('Brand colours are the unmodified navy + gold default — confirm that is intended for this client.');
  return warn;
}
