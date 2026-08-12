/**
 * FIELD POLICY — the only hand-written list in the intake layer.
 *
 * The SHAPE of the config comes from the template's Zod schema, automatically.
 * What cannot come from the schema is *policy*: for each field, does the intake
 * form ASK the client, pre-fill a DEFAULT, hold it FIXED, or COMPOSE it from
 * other answers? That is a product decision, not a type, so it lives here.
 *
 *   ask       the form asks the client for it
 *   default   the form pre-fills the value below; the client may override it
 *   fixed     the generator always writes this; the form never shows it
 *   composed  the generator builds it from other answers (never typed directly)
 *
 * This file is checked against the schema on every manifest build. Add a field
 * to the template's schema without adding it here and the build fails — so this
 * list cannot quietly fall behind the thing it describes.
 *
 * NOTHING here changes the template. It only records how the form treats each
 * field the template already defines.
 */

export const GROUPS = [
  { id: 'business', title: 'The business', blurb: 'Name, year founded, what they do.' },
  { id: 'contact', title: 'How to reach them', blurb: 'One phone number. Everything else is derived from it.' },
  { id: 'location', title: 'Where they are', blurb: 'Street address, plus the map pin coordinates.' },
  { id: 'hours', title: 'Opening hours', blurb: 'Feeds the footer AND the schema.org hours. Typed once.' },
  { id: 'categories', title: 'What they sell', blurb: 'Checkboxes. Unchecked means the category does not exist on the site at all.' },
  { id: 'service-areas', title: 'Areas served', blurb: 'Towns and regions. Footer pills + schema.org areaServed.' },
  { id: 'social', title: 'Social profiles', blurb: 'Footer icons AND schema.org sameAs come from these.' },
  { id: 'brand', title: 'Look and feel', blurb: 'Pre-filled with the navy + gold default. Override per client.' },
  { id: 'nav', title: 'Navigation', blurb: 'Category links are automatic. These are the extras.' },
  { id: 'homepage', title: 'Homepage', blurb: 'The page is a list of sections. The generator lays out a sensible default; extra material is added later.' },
  { id: 'financing', title: 'Financing', blurb: 'Optional. Leave the whole section blank if they do not offer it — the page then does not exist.' },
  { id: 'integrations', title: 'Integrations', blurb: 'On/off only. Keys and tokens are wrangler secrets, never config.' },
  { id: 'system', title: 'System', blurb: 'Set by the generator. Not shown on the form.' },
];

/**
 * Values the template DERIVES from the fields above. The form must never ask
 * for any of these, and the generator must never write them into the config —
 * a stored copy of a derived value is the drift bug this template exists to
 * prevent. Source: the `derived` export in src/config/index.ts.
 */
export const DERIVED_NEVER_ASK = [
  { key: 'isTemplate', from: 'deployMode' },
  { key: 'phoneDisplay', from: 'contact.phone' },
  { key: 'telHref', from: 'contact.phone' },
  { key: 'smsHref', from: 'contact.smsPhone ?? contact.phone' },
  { key: 'emailHref', from: 'contact.email' },
  { key: 'yearsInBusiness', from: 'identity.foundedYear + current year' },
  { key: 'copyrightLine', from: 'identity.name + current year' },
  { key: 'addressOneLine', from: 'address.*' },
  { key: 'addressLines', from: 'address.*' },
  { key: 'mapEmbedUrl', from: 'address.* (URL-encoded)' },
  { key: 'directionsUrl', from: 'address.* + googlePlaceId' },
  { key: 'hoursDisplay', from: 'hours[]' },
  { key: 'socialLinks', from: 'social.*' },
  { key: 'sameAs', from: 'social.*' },
  { key: 'headerNav', from: 'nav.items + enabled categories' },
  { key: 'footerNav', from: 'nav.items + enabled categories' },
  { key: 'enabledCategories', from: 'categories map + the category catalog' },
  { key: 'enabledCategorySlugs', from: 'categories map' },
];

/* The navy + gold ramp, used as the pre-filled default for every new client. */
// The three ramp inputs. The other twenty tokens are DERIVED (src/config/ramp.ts).
const D = {
  primary: '#16469B',
  accent: '#FFB81C',
  urgent: '#D7261E',
};

const color = (key, label, help) => ({
  source: 'default',
  group: 'brand',
  control: 'color',
  label,
  help,
  example: D[key],
});

export const FIELD_POLICY = {
  /* ---------------- system ---------------- */
  deployMode: {
    source: 'fixed',
    group: 'system',
    label: 'Deploy mode',
    help: "The generator ALWAYS writes 'template'. An unreviewed config therefore cannot deploy — the template's existing gate refuses it. Approval flips it to 'client'.",
    example: 'template',
  },

  /* ---------------- business ---------------- */
  'identity.name': {
    source: 'ask',
    group: 'business',
    control: 'text',
    label: 'Business name',
    help: 'Exactly as it should appear in the header, footer, page titles and Google results.',
    example: 'Sun Pool & Spa Supply',
  },
  'identity.foundedYear': {
    source: 'ask',
    group: 'business',
    control: 'number',
    label: 'Year founded',
    help: 'Check the logo. This one number produces every "serving since" and "X years" line on the site.',
    example: 1978,
  },
  'identity.tagline': {
    source: 'ask',
    group: 'business',
    control: 'textarea',
    label: 'One-line description',
    help: 'Used for the meta description fallback and schema.org. One sentence.',
    example: 'The best hot tub and swim spa store in San Diego County. Real units on the floor.',
  },
  'identity.siteUrl': {
    source: 'ask',
    group: 'business',
    control: 'url',
    label: 'Website address',
    help: 'The live https:// domain, no trailing slash. Drives canonical URLs and the sitemap.',
    example: 'https://sunpoolandspasupply.com',
  },
  'identity.schemaType': {
    source: 'default',
    group: 'business',
    control: 'select',
    label: 'Business type (schema.org)',
    help: 'How Google should classify the business. The default suits a spa/hot-tub dealer.',
    example: 'HomeAndConstructionBusiness',
  },

  /* ---------------- contact ---------------- */
  'contact.phone': {
    source: 'ask',
    group: 'contact',
    control: 'tel',
    label: 'Phone number',
    help: 'E.164 format, e.g. +16195618587. The display string and the tap-to-call link are both derived from this — there is no second place to type a number.',
    example: '+16195618587',
  },
  'contact.smsPhone': {
    source: 'ask',
    group: 'contact',
    control: 'tel',
    label: 'Separate SMS number',
    help: 'Leave blank if texts go to the main number.',
    example: null,
  },
  'contact.email': {
    source: 'ask',
    group: 'contact',
    control: 'email',
    label: 'Public email address',
    help: 'Leave blank if the business does not publish one. Blank means no email appears anywhere on the site.',
    example: null,
  },

  /* ---------------- location ---------------- */
  'address.street': { source: 'ask', group: 'location', control: 'text', label: 'Street address', example: '12473 Woodside Ave' },
  'address.street2': { source: 'ask', group: 'location', control: 'text', label: 'Suite / unit', help: 'Leave blank if there is none.', example: 'Suite C' },
  'address.city': { source: 'ask', group: 'location', control: 'text', label: 'City', example: 'Lakeside' },
  'address.region': { source: 'ask', group: 'location', control: 'text', label: 'State / province', example: 'CA' },
  'address.postalCode': { source: 'ask', group: 'location', control: 'text', label: 'ZIP / postal code', example: '92040' },
  'address.latitude': {
    source: 'ask',
    group: 'location',
    control: 'number',
    label: 'Latitude',
    help: 'Right-click the shop on Google Maps and copy the first number. Required — the map embed is derived from the address, but schema.org needs the real coordinates and the build fails without them.',
    example: 32.857086,
  },
  'address.longitude': {
    source: 'ask',
    group: 'location',
    control: 'number',
    label: 'Longitude',
    help: 'The second number from the same right-click.',
    example: -116.924479,
  },
  'address.googlePlaceId': {
    source: 'ask',
    group: 'location',
    control: 'text',
    label: 'Google Place ID',
    help: 'Optional. Improves the "get directions" link. Leave blank if unknown.',
    example: null,
  },

  /* ---------------- hours ---------------- */
  hours: {
    source: 'composed',
    group: 'hours',
    control: 'repeater',
    label: 'Opening hours',
    help: 'One row per distinct set of hours. At least one row required.',
  },
  'hours[].days': {
    source: 'ask',
    group: 'hours',
    control: 'multiselect',
    label: 'Days',
    example: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  },
  'hours[].opens': { source: 'ask', group: 'hours', control: 'time', label: 'Opens', help: '24-hour, e.g. 09:30.', example: '09:30' },
  'hours[].closes': { source: 'ask', group: 'hours', control: 'time', label: 'Closes', help: '24-hour, e.g. 17:00.', example: '17:00' },

  /* ---------------- social ---------------- */
  'social.facebook': { source: 'ask', group: 'social', control: 'url', label: 'Facebook page', help: 'Full https:// URL, or blank.', example: null },
  'social.instagram': { source: 'ask', group: 'social', control: 'url', label: 'Instagram', example: null },
  'social.youtube': { source: 'ask', group: 'social', control: 'url', label: 'YouTube', example: null },
  'social.tiktok': { source: 'ask', group: 'social', control: 'url', label: 'TikTok', example: null },
  'social.x': { source: 'ask', group: 'social', control: 'url', label: 'X / Twitter', example: null },
  'social.linkedin': { source: 'ask', group: 'social', control: 'url', label: 'LinkedIn', example: null },
  'social.googleBusiness': { source: 'ask', group: 'social', control: 'url', label: 'Google Business Profile', example: null },

  /* ---------------- brand: colours ---------------- */
  'brand.colors.primary': color('primary', 'Primary', 'The main brand colour.'),
  'brand.colors.accent': color('accent', 'Accent', 'The call-to-action colour.'),
  'brand.colors.urgent': color('urgent', 'Urgency'),
  'brand.colors.overrides': {
    source: 'default',
    group: 'brand',
    label: 'Derived-token overrides',
    help: 'The other twenty tokens are derived from the three above (ramp.ts). Any of them may be pinned here by hand — metallic golds and some brand reds resist arithmetic — and a pinned value wins.',
    example: {},
  },
  'brand.colors.overrides{}': {
    source: 'default',
    group: 'brand',
    control: 'color',
    label: 'Pinned token value',
    example: null,
  },

  /* ---------------- brand: type, logos, radius ---------------- */
  'brand.fonts.display': {
    source: 'default',
    group: 'brand',
    control: 'text',
    label: 'Display font stack',
    example: "'Bricolage Grotesque', system-ui, sans-serif",
  },
  'brand.fonts.body': { source: 'default', group: 'brand', control: 'text', label: 'Body font stack', example: "'Instrument Sans', system-ui, sans-serif" },
  'brand.fonts.mono': { source: 'default', group: 'brand', control: 'text', label: 'Mono font stack', example: "'Spline Sans Mono', ui-monospace, monospace" },
  'brand.fonts.googleFontsHref': {
    source: 'default',
    group: 'brand',
    control: 'url',
    label: 'Google Fonts link',
    help: 'Must load every family named above. Blank means self-hosted fonts.',
    example:
      'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Instrument+Sans:wght@400..700&family=Spline+Sans+Mono:wght@400..600&display=swap',
  },
  'brand.logos.nav': {
    source: 'ask',
    group: 'brand',
    control: 'url',
    label: 'Header logo URL',
    help: 'Upload to R2 and paste the public URL. For light backgrounds. Must be absolute — a relative path 404s on nested pages.',
    example: 'https://pub-24055549503540b0b5ff19237b87d146.r2.dev/logos/logo-nav.png',
  },
  'brand.logos.footer': {
    source: 'ask',
    group: 'brand',
    control: 'url',
    label: 'Footer / drawer logo URL',
    help: 'The knockout (light-on-dark) version. This is also what the mobile menu uses — a missing one is why the old drawer showed bare text.',
    example: 'https://pub-24055549503540b0b5ff19237b87d146.r2.dev/logos/logo-footer.png',
  },
  'brand.logos.favicon': {
    source: 'default',
    group: 'brand',
    control: 'url',
    label: 'Favicon URL',
    help: 'Defaults to the template placeholder. The review step flags it if it is still the placeholder.',
    reviewWarnIfDefault: true,
    example: '/brand/favicon.svg',
  },
  'brand.logos.ogImage': {
    source: 'default',
    group: 'brand',
    control: 'url',
    label: 'Share image URL',
    help: 'What appears when someone shares the site. Defaults to the template placeholder — the review step flags it.',
    reviewWarnIfDefault: true,
    example: '/brand/og-default.png',
  },
  'brand.radius.card': { source: 'default', group: 'brand', control: 'number', label: 'Card corner radius (px)', example: 20 },
  'brand.radius.button': { source: 'default', group: 'brand', control: 'number', label: 'Button corner radius (px)', example: 14 },
  'brand.radius.pill': { source: 'default', group: 'brand', control: 'number', label: 'Pill corner radius (px)', example: 999 },

  /* ---------------- navigation ---------------- */
  'nav.items': {
    source: 'composed',
    group: 'nav',
    label: 'Navigation items',
    help: "The generator always emits { type: 'categories' } first — that placeholder expands into one link per ENABLED category. It never writes a hardcoded category href, because the schema rejects a nav link to a category that is off. Extra links from the form are appended after it.",
  },
  'nav.primaryCta.label': { source: 'default', group: 'nav', control: 'text', label: 'Main button text', example: 'Shop Inventory' },
  'nav.primaryCta.href': { source: 'default', group: 'nav', control: 'text', label: 'Main button destination', help: 'One canonical destination. The old site had this pointing two different places.', example: '/inventory' },

  /* ---------------- categories ---------------- */
  categories: {
    source: 'composed',
    group: 'categories',
    control: 'checkbox',
    label: 'Product categories',
    help: 'Opt-in. A category left unchecked has no route, no nav link, no footer link, no sitemap entry, no breadcrumb, no quiz option and no admin dropdown entry. It does not exist.',
  },
  'categories{}.enabled': { source: 'composed', group: 'categories', label: 'Enabled', help: 'True for every checked category. The generator never writes an entry with enabled:false — it omits the key entirely.' },
  'categories{}.label': { source: 'ask', group: 'categories', control: 'text', label: 'Custom label', help: 'Optional. Only if this client calls it something else.', example: null },
  'categories{}.blurb': { source: 'ask', group: 'categories', control: 'textarea', label: 'Custom blurb', help: 'Optional. Falls back to the catalog description.', example: null },
  'categories{}.heroImage': { source: 'ask', group: 'categories', control: 'url', label: 'Category hero image URL', help: 'Optional. Absolute URL or path.', example: null },
  'categories{}.sortOrder': { source: 'composed', group: 'categories', label: 'Sort order', help: 'Derived from the order the categories were checked: 10, 20, 30…' },

  /* ---------------- service areas ---------------- */
  serviceAreas: {
    source: 'ask',
    group: 'service-areas',
    control: 'repeater',
    label: 'Areas served',
    help: 'One per line. Only places the business actually serves — these become footer links and schema.org claims.',
    example: ['Lakeside', 'El Cajon', 'Santee', 'East County San Diego'],
  },

  /* ---------------- homepage ---------------- */
  'homepage.sections': {
    source: 'composed',
    group: 'homepage',
    label: 'Homepage sections',
    help: "The generator writes a default arrangement that needs no copy: the hero headline falls back to the tagline, the category row builds itself from the checked categories, and the product row reads live inventory. Reviews, stats, a comparison table and an FAQ are added afterwards when the client supplies real material — they cannot be invented.",
  },
  'homepage.disclosures': {
    source: 'composed',
    group: 'homepage',
    label: 'Homepage small print',
    help: 'Required only if a homepage section makes a superlative claim. The build fails without it in that case.',
  },

  /* ---------------- financing ---------------- */
  'financing.headline': {
    source: 'ask',
    group: 'financing',
    control: 'text',
    label: 'Financing headline',
    help: 'Leave this and the rest of the section blank if they do not offer financing — the /financing page then does not exist at all.',
    example: null,
  },
  'financing.blurb': {
    source: 'ask',
    group: 'financing',
    control: 'textarea',
    label: 'Financing summary',
    help: 'One or two sentences.',
    example: null,
  },
  'financing.bullets': {
    source: 'ask',
    group: 'financing',
    control: 'repeater',
    label: 'Financing points',
    help: 'One per line. Only what the client has CONFIRMED. Never guess a rate or a term — a wrong number here is a Truth-in-Lending problem, not a typo.',
    example: null,
  },
  'financing.lenderName': {
    source: 'ask',
    group: 'financing',
    control: 'text',
    label: 'Lender name',
    help: 'Who actually underwrites it. Optional.',
    example: null,
  },
  'financing.applyUrl': {
    source: 'ask',
    group: 'financing',
    control: 'url',
    label: 'Application link',
    help: "The lender's application page, if there is one. Optional.",
    example: null,
  },
  'financing.disclaimer': {
    source: 'ask',
    group: 'financing',
    control: 'textarea',
    label: 'Financing disclaimer',
    help: 'REQUIRED if financing is offered. The qualifying terms — "on approved credit", who the offer applies to, what expires when. An offer stated without its terms is the claim regulators care about.',
    reviewWarnIfDefault: false,
    example: null,
  },

  /* ---------------- display policy (C14 / O-12) ----------------
     What a price is allowed to SAY. Policy, not style: silence is the
     safe state, so both flags are explicit decisions, never derived. */
  'display.showPrice': {
    source: 'ask',
    group: 'financing',
    control: 'checkbox',
    label: 'Show cash prices',
    help: 'Off shows "Ask for current pricing" instead of a number. A price shown is a claim; some dealers may not publish one.',
    example: true,
  },
  'financing.showMonthly': {
    source: 'ask',
    group: 'financing',
    control: 'checkbox',
    label: 'Show monthly payments',
    help: 'A monthly payment is a CREDIT OFFER, so this switch lives inside the financing block: no block, no flag.',
    example: false,
  },

  /* ---------------- integrations ---------------- */
  'integrations.ghl.enabled': {
    source: 'ask',
    group: 'integrations',
    control: 'checkbox',
    label: 'Send leads to GoHighLevel',
    help: 'On/off only. The API key and Location ID are wrangler secrets and never enter this config or git.',
    example: false,
  },
  'integrations.meta.enabled': {
    source: 'ask',
    group: 'integrations',
    control: 'checkbox',
    label: 'Meta Conversions API',
    help: 'On/off only. Pixel ID and CAPI token are wrangler secrets.',
    example: false,
  },
  'integrations.zaraz.enabled': { source: 'ask', group: 'integrations', control: 'checkbox', label: 'Cloudflare Zaraz', help: 'Browser-side tagging. Configured in the Cloudflare dashboard, not here.', example: false },
  'integrations.sentry.enabled': { source: 'ask', group: 'integrations', control: 'checkbox', label: 'Sentry error tracking', example: false },
};
