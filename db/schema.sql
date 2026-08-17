-- ============================================================
-- D1 SCHEMA — hot tub store template
--
-- SOURCE OF db/migrations/0001_init.sql. This file is the human-readable
-- reference only — future schema changes are NEW migration files in
-- db/migrations/ (applied with npm run db:migrate:local|remote),
-- never edits here.
--
-- Field names are deliberately IDENTICAL to the existing Sun Pool
-- admin API (functions/api/admin.js). Phase 6 reuses that auth and
-- CRUD as-is, so the column names must match or the reuse breaks.
--
-- Timestamps are INTEGER milliseconds (Date.now()), matching the
-- existing admin code. Not TEXT, not seconds.
-- ============================================================


-- ------------------------------------------------------------
-- NOTE: there is deliberately NO categories table. Category labels,
-- segments and ordering live in ONE place — the `categories` block
-- of the client config. A database mirror of that config was removed
-- (it had zero readers) so a site can never have saunas ON in the
-- database and OFF in config — the class of split truth this
-- template exists to prevent.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- products — the inventory.
--
-- `category` is a plain TEXT column, not a foreign key, on purpose.
-- Turning a category off must never delete or block a client's
-- product rows; it makes them invisible on the site while the data
-- survives. Visibility is enforced in the query layer against the
-- config array.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  category          TEXT NOT NULL,
  inventory_name    TEXT NOT NULL,

  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','available','pending','sold','hidden','deleted')),

  price             INTEGER NOT NULL DEFAULT 0,
  monthly_payment   INTEGER NOT NULL DEFAULT 0,
  quantity          INTEGER NOT NULL DEFAULT 0,

  primary_image     TEXT NOT NULL DEFAULT '',
  gallery_images    TEXT NOT NULL DEFAULT '[]',   -- JSON array of URLs
  quick_facts       TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  why_bullets       TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  ghl_tags          TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings

  promo_label       TEXT NOT NULL DEFAULT '',
  delivery_promise  TEXT NOT NULL DEFAULT '',

  -- Product-detail sales copy. All optional; the page hides a
  -- section whose field is empty.
  headline          TEXT NOT NULL DEFAULT '',
  positioning_label TEXT NOT NULL DEFAULT '',
  hero_description  TEXT NOT NULL DEFAULT '',
  long_description  TEXT NOT NULL DEFAULT '',
  best_for          TEXT NOT NULL DEFAULT '',

  featured          INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,

  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category   ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status     ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_listing    ON products(category, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_featured   ON products(featured, sort_order);


-- ------------------------------------------------------------
-- leads — every form submission, with first-touch attribution.
--
-- uuid is assigned by middleware on first visit (Phase 5), so a
-- lead can be created before the form is submitted and updated
-- afterwards without losing the attribution captured on arrival.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  uuid                     TEXT PRIMARY KEY,

  first_name               TEXT NOT NULL DEFAULT '',
  last_name                TEXT NOT NULL DEFAULT '',
  email                    TEXT NOT NULL DEFAULT '',
  phone                    TEXT NOT NULL DEFAULT '',

  -- What they were looking at. Validated against the ENABLED
  -- categories, so a lead cannot be tagged with a category this
  -- client does not sell.
  category                 TEXT NOT NULL DEFAULT '',
  product_slug             TEXT NOT NULL DEFAULT '',
  message                  TEXT NOT NULL DEFAULT '',
  source_page              TEXT NOT NULL DEFAULT '',

  -- First touch (set once, never overwritten)
  first_touch_utm_source   TEXT NOT NULL DEFAULT '',
  first_touch_utm_medium   TEXT NOT NULL DEFAULT '',
  first_touch_utm_campaign TEXT NOT NULL DEFAULT '',
  first_touch_utm_content  TEXT NOT NULL DEFAULT '',
  first_touch_utm_term     TEXT NOT NULL DEFAULT '',
  first_touch_fbclid       TEXT NOT NULL DEFAULT '',
  first_touch_gclid        TEXT NOT NULL DEFAULT '',
  first_touch_ttclid       TEXT NOT NULL DEFAULT '',

  -- Last touch (overwritten on each visit)
  last_touch_utm_source    TEXT NOT NULL DEFAULT '',
  last_touch_utm_campaign  TEXT NOT NULL DEFAULT '',

  -- Meta match-quality fields
  fbp                      TEXT NOT NULL DEFAULT '',
  fbc                      TEXT NOT NULL DEFAULT '',
  ip_address               TEXT NOT NULL DEFAULT '',
  user_agent               TEXT NOT NULL DEFAULT '',

  -- CRM sync
  ghl_contact_id           TEXT NOT NULL DEFAULT '',
  ghl_synced_at            INTEGER,

  status                   TEXT NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new','contacted','quoted','won','lost')),

  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_created  ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_email    ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_phone    ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_category ON leads(category);


-- ------------------------------------------------------------
-- lead_events — one row per tracking event, for CAPI dedup + audit.
--
-- event_id is the shared key between the browser pixel and the
-- server-side Conversions API call. Without this table there is no
-- way to prove a Lead event was counted once rather than twice.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_uuid          TEXT NOT NULL,
  event_name         TEXT NOT NULL,
  event_id           TEXT NOT NULL,
  fired_client_side  INTEGER NOT NULL DEFAULT 0,
  fired_server_side  INTEGER NOT NULL DEFAULT 0,
  payload            TEXT NOT NULL DEFAULT '{}',
  created_at         INTEGER NOT NULL,
  FOREIGN KEY (lead_uuid) REFERENCES leads(uuid)
);

CREATE INDEX IF NOT EXISTS idx_events_lead  ON lead_events(lead_uuid);
CREATE INDEX IF NOT EXISTS idx_events_id    ON lead_events(event_id);

-- One pipeline-stage event per lead, ever.
--
-- CRM webhooks retry. Without this index, one booked appointment
-- retried three times is three Schedule events at $300 each, and the
-- bidding algorithm is told this lead was worth $900. The index makes
-- the second write fail, and /api/lead-stage treats that failure as
-- success so the CRM stops retrying.
--
-- PARTIAL, excluding 'Lead', on purpose: a visitor who submits the form
-- twice legitimately produces two Lead rows, each with its own
-- browser-generated event_id. Constraining those would break the
-- website's own dedup pairing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_stage_once
  ON lead_events(lead_uuid, event_name)
  WHERE event_name <> 'Lead';


-- ------------------------------------------------------------
-- admin_sessions — server-side session tokens for /admin.
--
-- Stores a SHA-256 hash of (token + ADMIN_SESSION_SECRET), never a
-- token and never a password. This is the existing Sun Pool auth
-- table, reproduced exactly; Phase 6 reuses that code as-is rather
-- than designing new authentication.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash  TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON admin_sessions(expires_at);
