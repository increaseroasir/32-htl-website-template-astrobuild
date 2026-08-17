/**
 * THE VAULT ROW CONTRACT (Job 2; extended by owner ruling 2026-08-14).
 * Column order is append-only and the writer maps by position, so the
 * exact 43-name list is pinned verbatim — an insert, removal or reorder
 * fails here before it silently shifts every field for every downstream
 * reader. Columns 35–40 are the product SNAPSHOT (frozen from D1
 * enrichment at submit; D1 stays the source of truth); 41–43 are
 * reserved for the wizard ticket + Microsoft Ads. The append POSITION is
 * pinned: the original 34 must keep their slots exactly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VAULT_COLUMNS,
  MISSED_COLUMNS,
  deriveTrafficChannel,
  buildVaultRow,
  buildMissedRow,
  shouldWriteVaultRow,
} from '../../src/lib/vault-row.ts';

/* ---------------- the column contract ---------------- */

test('VAULT_COLUMNS is EXACTLY the 43-column contract, in order', () => {
  assert.deepEqual(
    [...VAULT_COLUMNS],
    [
      'lead_uuid',
      'submitted_at',
      'first_name',
      'last_name',
      'email',
      'phone',
      'category',
      'product_slug',
      'message',
      'source_page',
      'traffic_channel',
      'landing_page_url',
      'referrer_url',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'fbclid',
      'gclid',
      'ttclid',
      'event_id',
      'fbp',
      'fbc',
      'ghl_status',
      'ghl_contact_id',
      'ghl_error',
      'capi_status',
      'capi_error',
      'consent_version',
      'contactable',
      'conversion_value',
      'retry_count',
      'last_retry_at',
      'product_name',
      'product_id',
      'product_price',
      'product_monthly',
      'product_stock',
      'product_qty',
      'financing_interest',
      'form_intent',
      'msclkid',
    ],
  );
});

test('the 2026-08-14 columns were APPENDED — the original 34 keep their exact slots', () => {
  // Downstream readers built against the 34-column sheet must not shift.
  assert.equal(VAULT_COLUMNS.indexOf('lead_uuid'), 0);
  assert.equal(VAULT_COLUMNS.indexOf('last_retry_at'), 33, 'old contract ends at slot 33');
  assert.equal(VAULT_COLUMNS.indexOf('product_name'), 34, 'snapshot starts at slot 34');
  assert.equal(VAULT_COLUMNS.length, 43);
});

/* ---------------- traffic channel derivation ---------------- */

const noTouch = {
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_content: '',
  utm_term: '',
  fbclid: '',
  gclid: '',
  ttclid: '',
};

test('deriveTrafficChannel: click IDs always mean paid', () => {
  assert.equal(deriveTrafficChannel({ ...noTouch, fbclid: 'x' }), 'paid');
  assert.equal(deriveTrafficChannel({ ...noTouch, gclid: 'x' }), 'paid');
  assert.equal(deriveTrafficChannel({ ...noTouch, ttclid: 'x' }), 'paid');
});

test('deriveTrafficChannel: paid mediums, case-insensitive', () => {
  assert.equal(deriveTrafficChannel({ ...noTouch, utm_medium: 'cpc' }), 'paid');
  assert.equal(deriveTrafficChannel({ ...noTouch, utm_medium: 'Paid_Social' }), 'paid');
  assert.equal(deriveTrafficChannel({ ...noTouch, utm_medium: 'CPC' }), 'paid');
});

test('deriveTrafficChannel: organic / referral / campaign / direct', () => {
  assert.equal(deriveTrafficChannel({ ...noTouch, utm_medium: 'organic' }), 'organic');
  assert.equal(deriveTrafficChannel({ ...noTouch, utm_medium: 'referral' }), 'referral');
  assert.equal(deriveTrafficChannel({ ...noTouch, utm_source: 'newsletter' }), 'campaign');
  assert.equal(deriveTrafficChannel({ ...noTouch, utm_medium: 'email' }), 'campaign');
  assert.equal(deriveTrafficChannel(noTouch), 'direct');
});

/* ---------------- the builder maps by position ---------------- */

function fullInput() {
  return {
    leadUuid: 'uuid-1',
    submittedAt: 1755000000000,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+15555550100',
    category: 'hot-tubs',
    productSlug: 'demo-spa',
    message: 'Call me',
    sourcePage: '/hot-tubs/demo-spa',
    firstTouch: {
      utm_source: 'facebook',
      utm_medium: 'paid_social',
      utm_campaign: 'summer',
      utm_content: 'ad-3',
      utm_term: 'spa',
      fbclid: 'fb-1',
      gclid: '',
      ttclid: '',
    },
    eventId: 'evt-1',
    fbp: 'fb.1.123.456',
    fbc: 'fb.1.123.fb-1',
    ghlStatus: 'SENT',
    ghlContactId: 'contact-9',
    ghlError: '',
    capiStatus: 'FAILED',
    capiError: '500: server error',
    consentVersion: '2026-08-01',
    conversionValue: 0,
    product: {
      id: 7,
      name: 'Cascade X200',
      price: 8450,
      monthlyPayment: 129,
      stockStatus: 'available',
      quantity: 3,
    },
  };
}

const col = (name) => VAULT_COLUMNS.indexOf(name);

test('buildVaultRow: exactly one value per column, every one in its slot', () => {
  const row = buildVaultRow(fullInput());
  assert.equal(row.length, VAULT_COLUMNS.length);

  assert.equal(row[col('lead_uuid')], 'uuid-1');
  assert.equal(row[col('submitted_at')], new Date(1755000000000).toISOString());
  assert.equal(row[col('first_name')], 'Ada');
  assert.equal(row[col('last_name')], 'Lovelace');
  assert.equal(row[col('email')], 'ada@example.com');
  assert.equal(row[col('phone')], '+15555550100');
  assert.equal(row[col('category')], 'hot-tubs');
  assert.equal(row[col('product_slug')], 'demo-spa');
  assert.equal(row[col('message')], 'Call me');
  assert.equal(row[col('source_page')], '/hot-tubs/demo-spa');
  assert.equal(row[col('traffic_channel')], 'paid'); // fbclid present
  assert.equal(row[col('utm_source')], 'facebook');
  assert.equal(row[col('utm_medium')], 'paid_social');
  assert.equal(row[col('utm_campaign')], 'summer');
  assert.equal(row[col('utm_content')], 'ad-3');
  assert.equal(row[col('utm_term')], 'spa');
  assert.equal(row[col('fbclid')], 'fb-1');
  assert.equal(row[col('gclid')], '');
  assert.equal(row[col('ttclid')], '');
  assert.equal(row[col('event_id')], 'evt-1');
  assert.equal(row[col('fbp')], 'fb.1.123.456');
  assert.equal(row[col('fbc')], 'fb.1.123.fb-1');
  assert.equal(row[col('ghl_status')], 'SENT');
  assert.equal(row[col('ghl_contact_id')], 'contact-9');
  assert.equal(row[col('ghl_error')], '');
  assert.equal(row[col('capi_status')], 'FAILED');
  assert.equal(row[col('capi_error')], '500: server error');
  assert.equal(row[col('consent_version')], '2026-08-01');
  assert.equal(row[col('conversion_value')], 0);
  assert.equal(row[col('product_name')], 'Cascade X200');
  assert.equal(row[col('product_id')], 7);
  assert.equal(row[col('product_price')], 8450);
  assert.equal(row[col('product_monthly')], 129);
  assert.equal(row[col('product_stock')], 'available');
  assert.equal(row[col('product_qty')], 3);
});

test('no product on the lead → all six snapshot columns empty, never undefined', () => {
  const row = buildVaultRow({ ...fullInput(), product: null });
  for (const name of ['product_name', 'product_id', 'product_price', 'product_monthly', 'product_stock', 'product_qty']) {
    assert.equal(row[col(name)], '', `${name} must be '' without a product`);
  }
});

test('reserved columns write EMPTY until their tickets hold the facts', () => {
  const row = buildVaultRow(fullInput());
  assert.equal(row[col('landing_page_url')], ''); // middleware ticket
  assert.equal(row[col('referrer_url')], ''); // middleware ticket
  assert.equal(row[col('financing_interest')], ''); // wizard ticket
  assert.equal(row[col('form_intent')], ''); // wizard ticket
  assert.equal(row[col('msclkid')], ''); // Microsoft Ads, if ever
});

test('retry bookkeeping starts at zero — the retry job owns it', () => {
  const row = buildVaultRow(fullInput());
  assert.equal(row[col('retry_count')], 0);
  assert.equal(row[col('last_retry_at')], '');
});

test('contactable: YES with phone + consent, NO when either is missing', () => {
  assert.equal(buildVaultRow(fullInput())[col('contactable')], 'YES');
  assert.equal(
    buildVaultRow({ ...fullInput(), consentVersion: '' })[col('contactable')],
    'NO',
  );
  assert.equal(buildVaultRow({ ...fullInput(), phone: '' })[col('contactable')], 'NO');
});

/* ---------------- the Missed Leads incident log ---------------- */

test('MISSED_COLUMNS is the exact incident-log contract, in order', () => {
  assert.deepEqual(
    [...MISSED_COLUMNS],
    ['logged_at', 'lead_uuid', 'failed_step', 'error', 'first_name', 'last_name', 'email', 'phone', 'source_page'],
  );
  // THE ONE LAW applies here too.
  for (const forbidden of ['product_name', 'price', 'category_label', 'stock_status']) {
    assert.ok(!MISSED_COLUMNS.includes(forbidden), `${forbidden} is a product fact`);
  }
});

test('buildMissedRow maps by position, ISO timestamp, error capped', () => {
  const row = buildMissedRow({
    loggedAt: 1755000000000,
    leadUuid: 'uuid-1',
    failedStep: 'ghl',
    error: 'x'.repeat(600),
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '6199950289',
    sourcePage: '/hot-tubs',
  });
  const col = (name) => MISSED_COLUMNS.indexOf(name);
  assert.equal(row.length, MISSED_COLUMNS.length);
  assert.equal(row[col('logged_at')], new Date(1755000000000).toISOString());
  assert.equal(row[col('lead_uuid')], 'uuid-1');
  assert.equal(row[col('failed_step')], 'ghl');
  assert.equal(row[col('error')].length, 500, 'error capped at 500');
  assert.equal(row[col('phone')], '6199950289');
  for (const value of row) assert.ok(value !== undefined && value !== null);
});

test('DRIFTED is not retryable: the writer must skip it and write nothing', () => {
  assert.equal(shouldWriteVaultRow('DRIFTED'), false);
  for (const status of ['', 'SENT', 'FAILED', 'UNCONFIGURED']) {
    assert.equal(shouldWriteVaultRow(status), true, `${status || '(blank)'} is writable`);
  }
});

test('no value is ever undefined or null — Sheets RAW turns them into holes', () => {
  const row = buildVaultRow(fullInput());
  for (const [index, value] of row.entries()) {
    assert.ok(
      value !== undefined && value !== null,
      `column ${VAULT_COLUMNS[index]} produced ${String(value)}`,
    );
  }
});
