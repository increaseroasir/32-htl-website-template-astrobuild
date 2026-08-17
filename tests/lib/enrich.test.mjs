/**
 * Product enrichment (Job 4). Pins: the D1 query shape (by slug, one
 * row); the row→enrichment mapping incl. defensive ghl_tags parsing;
 * and the no-throw guarantee — enrichment failure syncs unenriched, it
 * never blocks a lead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENRICH_QUERY, enrichFromInventory } from '../../src/lib/enrich.ts';

function fakeDb(row, opts = {}) {
  const calls = [];
  return {
    calls,
    prepare(query) {
      return {
        bind(...values) {
          calls.push({ query, values });
          return {
            async first() {
              if (opts.throwOnFirst) throw new Error('D1_ERROR: no such table');
              return row;
            },
          };
        },
      };
    },
  };
}

const PRODUCT_ROW = {
  id: 7,
  inventory_name: 'Cascade X200',
  category: 'hot-tubs',
  status: 'available',
  price: 8450,
  monthly_payment: 129,
  quantity: 3,
  ghl_tags: '["floor-model","clearance"]',
};

test('query: products by slug, one row, the exact fact columns, D1 only', () => {
  assert.ok(ENRICH_QUERY.includes('FROM products WHERE slug = ?1 LIMIT 1'));
  for (const col of ['id', 'inventory_name', 'category', 'status', 'price', 'monthly_payment', 'quantity', 'ghl_tags']) {
    assert.ok(ENRICH_QUERY.includes(col), `selects ${col}`);
  }
  assert.ok(!/sheet/i.test(ENRICH_QUERY));
});

test('a found product maps to the enrichment shape', async () => {
  const db = fakeDb(PRODUCT_ROW);
  const enrichment = await enrichFromInventory(db, 'cascade-x200');
  assert.deepEqual(enrichment, {
    id: 7,
    name: 'Cascade X200',
    category: 'hot-tubs',
    price: 8450,
    monthlyPayment: 129,
    stockStatus: 'available',
    quantity: 3,
    ghlTags: ['floor-model', 'clearance'],
  });
  assert.equal(db.calls[0].values[0], 'cascade-x200');
});

test('malformed ghl_tags JSON → empty tags, NOT a failed enrichment', async () => {
  const warned = console.warn;
  console.warn = () => {};
  try {
    const broken = await enrichFromInventory(fakeDb({ ...PRODUCT_ROW, ghl_tags: '{oops' }), 's');
    assert.deepEqual(broken.ghlTags, []);
    const nonArray = await enrichFromInventory(fakeDb({ ...PRODUCT_ROW, ghl_tags: '"x"' }), 's');
    assert.deepEqual(nonArray.ghlTags, []);
    const mixed = await enrichFromInventory(
      fakeDb({ ...PRODUCT_ROW, ghl_tags: '["ok", 3, null]' }),
      's',
    );
    assert.deepEqual(mixed.ghlTags, ['ok']);
  } finally {
    console.warn = warned;
  }
});

test('no slug → null with NO query; unknown slug → null; D1 error → null, never a throw', async () => {
  const warned = console.warn;
  console.warn = () => {};
  try {
    const none = fakeDb(PRODUCT_ROW);
    assert.equal(await enrichFromInventory(none, ''), null);
    assert.equal(none.calls.length, 0, 'category-only lead runs no query');

    assert.equal(await enrichFromInventory(fakeDb(null), 'ghost-slug'), null);
    assert.equal(await enrichFromInventory(fakeDb(null, { throwOnFirst: true }), 'x'), null);
  } finally {
    console.warn = warned;
  }
});
