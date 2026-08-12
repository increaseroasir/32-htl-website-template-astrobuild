/**
 * GHL response classification (C8 / I-03): the handler writes
 * ghl_synced_at only when a contact id came back, so the classifier's
 * three shapes — ok+id, ok+no-id, error — are what that decision hangs on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncToGhl, buildGhlTags } from '../../src/lib/ghl.ts';

const CONTACT = {
  firstName: 'Casey',
  lastName: 'Buyer',
  email: 'casey@fixture.test',
  phone: '6195550142',
  source: '/find-your-match',
  tags: ['website-lead'],
  customFields: { lead_uuid: 'uuid-1', empty_one: '' },
};

async function withResponse(response, fn) {
  const realFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return response;
  };
  try {
    const result = await syncToGhl({ apiKey: 'k', locationId: 'loc' }, CONTACT);
    return fn(result, captured);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('2xx with contact id → ok:true + contactId (the only shape that sets ghl_synced_at)', async () => {
  await withResponse(
    new Response(JSON.stringify({ contact: { id: 'ghl-123' } }), { status: 200 }),
    (r) => {
      assert.equal(r.ok, true);
      assert.equal(r.contactId, 'ghl-123');
    },
  );
});

test('2xx WITHOUT contact id → ok:true + empty contactId (logged, not synced)', async () => {
  await withResponse(new Response('OK', { status: 200 }), (r) => {
    assert.equal(r.ok, true);
    assert.equal(r.contactId, '');
  });
});

test('non-2xx → ok:false with detail', async () => {
  await withResponse(new Response('{"message":"invalid key"}', { status: 401 }), (r) => {
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.ok(r.detail.includes('invalid key'));
  });
});

test('empty custom fields are stripped from the payload', async () => {
  await withResponse(
    new Response(JSON.stringify({ contact: { id: 'x' } }), { status: 200 }),
    (_r, payload) => {
      const keys = payload.customFields.map((f) => f.key);
      assert.ok(keys.includes('lead_uuid'));
      assert.ok(!keys.includes('empty_one'));
    },
  );
});

test('tags derive from facts, lowercased', () => {
  assert.deepEqual(
    buildGhlTags({ category: 'hot-tub', productSlug: 'X200', utmSource: 'FB', utmCampaign: '' }),
    ['website-lead', 'category-hot-tub', 'product-x200', 'source-fb'],
  );
});
