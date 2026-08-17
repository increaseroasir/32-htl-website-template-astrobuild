-- ============================================================
-- EXAMPLE SEED DATA — for local development only.
--
--   npm run db:seed:local
--
-- This is NOT client data and must never be applied to production.
-- Names are obviously fictional so a seeded row can never be mistaken
-- for real inventory during a client eyeball pass.
--
-- Note the deliberate trap on the last row: a SAUNA product, inserted
-- while saunas are OFF in config. It exists to prove the guard. Insert
-- it, open /inventory, and it must not appear. Turn saunas on in
-- client.config.ts and it appears — with no change to any SQL or code.
-- ============================================================

DELETE FROM products WHERE slug LIKE 'example-%';

INSERT INTO products (
  slug, category, inventory_name, status, price, monthly_payment, quantity,
  primary_image, gallery_images, quick_facts, why_bullets, ghl_tags,
  promo_label, delivery_promise, headline, positioning_label,
  hero_description, long_description, best_for,
  featured, sort_order, created_at, updated_at
) VALUES
(
  'example-hot-tub-six-seat', 'hot-tub', 'EXAMPLE Six-Seat Hot Tub', 'available',
  8995, 149, 2,
  '/brand/og-default.png', '[]',
  '["6 seats","45 jets","Plug and play"]',
  '["Fits four to six comfortably","Runs on a standard outlet"]',
  '["example","hot-tub"]',
  'EXAMPLE OFFER', 'Delivery in 2 weeks',
  'An example six-seat hot tub', 'Most popular',
  'Seed data for local development.', 'Longer example description.', 'Families',
  1, 10, 1754870400000, 1754870400000
),
(
  'example-hot-tub-draft', 'hot-tub', 'EXAMPLE Draft Unit', 'draft',
  7495, 129, 1,
  '', '[]', '[]', '[]', '[]', '', '', '', '', '', '', '',
  0, 20, 1754870400000, 1754870400000
),
(
  'example-hot-tub-sold', 'hot-tub', 'EXAMPLE Sold Unit', 'sold',
  6995, 119, 0,
  '', '[]', '[]', '[]', '[]', '', '', '', '', '', '', '',
  0, 30, 1754870400000, 1754870400000
),
(
  'example-swim-spa-swim', 'swim-spa', 'EXAMPLE Swim Spa', 'available',
  21995, 319, 1,
  '', '[]', '["Swim current","Dual zone"]', '[]', '["example","swim-spa"]',
  '', 'Delivery in 3 weeks', '', '', '', '', '',
  1, 10, 1754870400000, 1754870400000
),
-- THE TRAP. Saunas are OFF in config. This row must never reach a
-- customer, and no code in the app knows it is special.
(
  'example-sauna-trap', 'sauna', 'EXAMPLE Sauna (should never render)', 'available',
  4995, 89, 3,
  '', '[]', '[]', '[]', '[]', '', '', '', '', '', '', '',
  0, 10, 1754870400000, 1754870400000
);
