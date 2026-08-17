/**
 * STRUCTURED DATA BUILDERS.
 *
 * All schema.org output is generated here, from config and from database
 * rows — never hand-written into a page. That is what stops the SEO
 * breadcrumb still listing saunas after the category was removed from the
 * nav: there is no second, hand-maintained copy of what the business sells.
 *
 * Everything is emitted server-side. The old build injected its schema at
 * runtime with seo-schema.js, so a crawler that did not run the script saw
 * nothing at all.
 */

import { site, derived } from '../config';
import type { Product } from './db';
import { pricingFor } from './format';

const siteUrl = site.identity.siteUrl;

/** Stable node id, so every page points at ONE business entity. */
export const BUSINESS_ID = `${siteUrl}#business`;

export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl).href;
}

/* ------------------------------------------------------------------ */
/* LocalBusiness                                                       */
/* ------------------------------------------------------------------ */

export function buildLocalBusiness(): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': site.identity.schemaType,
    '@id': BUSINESS_ID,
    name: site.identity.name,
    description: site.identity.tagline,
    url: siteUrl,
    telephone: site.contact.phone,
    image: absoluteUrl(site.brand.logos.ogImage),
    logo: absoluteUrl(site.brand.logos.nav),
    foundingDate: String(site.identity.foundedYear),

    address: {
      '@type': 'PostalAddress',
      streetAddress: [site.address.street, site.address.street2].filter(Boolean).join(', '),
      addressLocality: site.address.city,
      addressRegion: site.address.region,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },

    // Required in the config schema precisely so it cannot be omitted here.
    geo: {
      '@type': 'GeoCoordinates',
      latitude: site.address.latitude,
      longitude: site.address.longitude,
    },

    // The same array the footer prints as opening hours.
    openingHoursSpecification: site.hours.map((range) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: range.days.map((d) => `https://schema.org/${d}`),
      opens: range.opens,
      closes: range.closes,
    })),
  };

  // Optional fields are emitted only when true. An empty sameAs asserts
  // something false about the business rather than saying nothing.
  if (site.contact.email) schema.email = site.contact.email;
  if (derived.sameAs.length > 0) schema.sameAs = derived.sameAs;
  if (site.serviceAreas.length > 0) {
    schema.areaServed = site.serviceAreas.map((area) => ({ '@type': 'Place', name: area }));
  }
  if (derived.enabledCategories.length > 0) {
    schema.makesOffer = derived.enabledCategories.map((c) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Product', name: c.label, category: c.label },
      url: absoluteUrl(c.href),
    }));
  }

  return schema;
}

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

/** Product status → schema.org availability. Unmapped statuses are private. */
const AVAILABILITY: Record<string, string> = {
  available: 'https://schema.org/InStock',
  pending: 'https://schema.org/LimitedAvailability',
  sold: 'https://schema.org/SoldOut',
};

export function buildProduct(product: Product, pagePath: string): Record<string, unknown> {
  const url = absoluteUrl(pagePath);

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.inventoryName,
    category: product.categoryLabel,
    url,
  };

  const description = product.heroDescription || product.longDescription;
  if (description) schema.description = description;

  const images = [product.primaryImage, ...product.galleryImages]
    .filter((i) => i.startsWith('/') || i.startsWith('https://'))
    .map((i) => absoluteUrl(i));
  if (images.length > 0) schema.image = images;

  const availability = AVAILABILITY[product.status];
  if (availability) {
    const offer: Record<string, unknown> = {
      '@type': 'Offer',
      availability,
      url,
      priceCurrency: 'USD',
      seller: { '@id': BUSINESS_ID },
      itemCondition: 'https://schema.org/NewCondition',
    };
    // The page and the structured data have to agree.
    //
    // This used to publish any positive price, so a sold unit — whose page
    // shows no price at all — still carried one in its Offer, and a client
    // who turned cash prices off published them to Google anyway. What a
    // customer reads and what a crawler reads were two different answers
    // from two different rules.
    //
    // pricingFor() is the one rule. If it will not print a cash figure, no
    // figure is published. A price of 0 also means "ask", and publishing 0
    // would be a lie Google treats as an error rather than as a gap.
    if (pricingFor(product).cash !== null) offer.price = product.price;
    schema.offers = offer;
  }

  if (product.quickFacts.length > 0) {
    schema.additionalProperty = product.quickFacts.map((fact) => ({
      '@type': 'PropertyValue',
      name: 'Feature',
      value: fact,
    }));
  }

  return schema;
}

/* ------------------------------------------------------------------ */
/* ItemList (category + inventory listings)                            */
/* ------------------------------------------------------------------ */

export function buildItemList(
  products: Product[],
  listName: string,
): Record<string, unknown> | null {
  if (products.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: listName,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: absoluteUrl(`${p.categoryHref}/${p.slug}`),
      name: p.inventoryName,
    })),
  };
}
