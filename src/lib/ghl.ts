/**
 * GOHIGHLEVEL SYNC.
 *
 * Native, not a Zapier hop and not an embedded GHL iframe. That was the whole
 * reason for not moving the fleet to a page-builder: the lead pipeline is
 * owned here, so first-touch attribution reaches the CRM intact instead of
 * being dropped at a form boundary.
 *
 * A failure here NEVER fails the lead. By the time this runs the row is
 * already committed to D1, so a GHL outage costs a sync, not a customer.
 */

export interface GhlContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  tags: string[];
  customFields: Record<string, string>;
}

export interface GhlResult {
  ok: boolean;
  status: number;
  contactId: string;
  detail: string;
}

/**
 * Upserts a contact. GHL's upsert matches on email or phone, so a returning
 * customer updates their existing record rather than creating a duplicate
 * that splits their history across two contacts.
 */
export async function syncToGhl(
  config: { apiKey: string; locationId: string; apiVersion?: string },
  contact: GhlContact,
  timeoutMs = 5000,
): Promise<GhlResult> {
  const version = config.apiVersion ?? '2021-07-28';

  // GHL rejects a custom field whose value is an empty string, and an empty
  // UTM tells the CRM nothing anyway.
  const customFields = Object.entries(contact.customFields)
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([key, value]) => ({ key, field_value: value }));

  const payload = {
    locationId: config.locationId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    email: contact.email,
    phone: contact.phone,
    source: contact.source,
    tags: contact.tags,
    customFields,
  };

  try {
    const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Version: version,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, contactId: '', detail: text.slice(0, 500) };
    }

    let contactId = '';
    try {
      const data = JSON.parse(text) as { contact?: { id?: string }; id?: string };
      contactId = data.contact?.id ?? data.id ?? '';
    } catch {
      /* 2xx with an unexpected body — the contact landed, we just cannot
         record its id. Not worth failing the sync over. */
    }

    return { ok: true, status: res.status, contactId, detail: text.slice(0, 300) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown GHL error';
    return { ok: false, status: 0, contactId: '', detail };
  }
}

/**
 * Builds the tag list. Tags are how a GHL workflow decides which follow-up
 * sequence to run, so they are derived from facts rather than typed by hand
 * per site: the source, the category, and the campaign that earned the lead.
 */
export function buildGhlTags(input: {
  category: string;
  productSlug: string;
  utmSource: string;
  utmCampaign: string;
  /** Inventory name from D1 enrichment (Job 4) → "Model Interest - <name>". */
  productName?: string;
  /** Admin-curated per-product tags (products.ghl_tags) — passed through. */
  productTags?: string[];
}): string[] {
  const tags = ['website-lead'];
  if (input.category) tags.push(`category-${input.category}`);
  if (input.productSlug) tags.push(`product-${input.productSlug}`);
  if (input.utmSource) tags.push(`source-${input.utmSource}`);
  if (input.utmCampaign) tags.push(`campaign-${input.utmCampaign}`);
  // The salesperson-facing tag from the Sun Pool build. GHL stores tags
  // lowercased, so the map below costs nothing and keeps one code path.
  if (input.productName) tags.push(`model interest - ${input.productName}`);
  for (const tag of input.productTags ?? []) {
    if (tag.trim()) tags.push(tag.trim());
  }
  return tags.map((t) => t.toLowerCase().slice(0, 60));
}
