/**
 * DISPLAY FORMATTING — one place.
 *
 * A price is stored once, as an integer, and formatted here. No page builds
 * its own `$${price}` string, so a currency symbol or a thousands separator
 * cannot end up different on the listing than on the detail page.
 *
 * These functions are also where the config decides whether a figure may be
 * shown AT ALL. Putting that here rather than in each component means the
 * product card, the detail page, and anything added later cannot disagree
 * about it — there is one gate, and every price passes through it.
 */
import { site } from '../config';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Copy shown when a product has no price on record. */
export const ASK_FOR_PRICE = 'Ask for current pricing';

/**
 * 8995 → "$8,995". Zero or negative means "no price on record".
 * Returns null when the client does not publish cash prices, so every
 * surface falls back to ASK_FOR_PRICE together.
 *
 * Module-private on purpose. Every price a customer sees comes from
 * pricingFor() below, so no surface can render a figure while skipping the
 * status and config rules that decide whether it may be shown at all.
 */
function formatPrice(value: number): string | null {
  if (!site.display.showPrice) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return usd.format(value);
}

/**
 * 149 → "$149/mo". Null when there is no financing figure on record.
 *
 * Also null whenever this client has no financing block, no matter what the
 * database row says. A monthly payment is a credit offer: without configured
 * terms there is no lender, no APR and no disclaimer to qualify it. The row
 * can carry the number; the site will not repeat it.
 *
 * Module-private for the same reason as formatPrice.
 */
function formatMonthly(value: number): string | null {
  if (!site.display.showMonthly || site.financing === null) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${usd.format(value)}/mo`;
}

/**
 * Status → the pill label a customer sees, or null for statuses that carry
 * no badge. Kept here so the listing and the detail page cannot disagree
 * about what "pending" is called.
 */
export function statusLabel(status: string, quantity: number): string | null {
  switch (status) {
    case 'sold':
      return 'Sold';
    case 'pending':
      return 'Sale pending';
    case 'available':
      if (quantity === 1) return 'Last one';
      if (quantity > 1) return `${quantity} left`;
      return null;
    default:
      return null;
  }
}

/** Sold and pending units render muted rather than being hidden. */
export function isMutedStatus(status: string): boolean {
  return status === 'sold' || status === 'pending';
}

/* ------------------------------------------------------------------ */
/* The one entry point for anything a price is allowed to say           */
/* ------------------------------------------------------------------ */

/** What a listing or a detail page may print about one unit's price. */
export interface Pricing {
  /** Cash price, or null when it may not be shown. */
  readonly cash: string | null;
  /** Monthly payment, or null when it may not be shown. */
  readonly monthly: string | null;
  /** Whether to print ASK_FOR_PRICE in place of a cash figure. */
  readonly askForPrice: boolean;
}

/**
 * A sold or pending unit quotes NOTHING.
 *
 * Greying the photo was the only thing `muted` did, so a sold unit still
 * advertised a price and a monthly payment — an offer on something that
 * cannot be bought. Which figures may appear is decided here, once, rather
 * than by each surface remembering to check the status: the product card,
 * the detail page and anything added later cannot disagree, because there is
 * only one function that answers the question.
 *
 * "Ask for current pricing" is suppressed too. It is an invitation to
 * enquire about this unit, and there is nothing to enquire about.
 */
export function pricingFor(product: {
  readonly price: number;
  readonly monthlyPayment: number;
  readonly status: string;
}): Pricing {
  if (isMutedStatus(product.status)) {
    return { cash: null, monthly: null, askForPrice: false };
  }
  const cash = formatPrice(product.price);
  return {
    cash,
    monthly: formatMonthly(product.monthlyPayment),
    askForPrice: cash === null,
  };
}
