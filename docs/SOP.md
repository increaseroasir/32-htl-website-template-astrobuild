# WEBSITE ↔ SUB-ACCOUNT — SOURCE OF TRUTH
Template: 32-htl-website-template-astrobuild @ cc9371e · Astro 7 SSR on Cloudflare Workers · D1 database · Google Sheets vault · GHL sub-account (v2 snapshot, 13 workflows)

This file is the contract. If a workflow, a sheet, a field, or a doc disagrees with this file, this file wins. Column orders and event names in here are APPEND-ONLY — never renamed, never reordered.

---

## 1. THE MAP — who owns which fact

| System | Owns | Never holds |
|---|---|---|
| **Website (Worker + D1)** | The lead record (source of truth), attribution, consent, dedup, conversion events, product catalog | — |
| **D1 database** | Every lead, every event, every status. Durable record. | — |
| **Google Sheet (vault)** | Human-readable MIRROR of D1. One lead = one row. Product columns are a SNAPSHOT frozen at submit time (owner ruling 2026-08-14). | Product TRUTH — current price/stock always come from D1. A later product edit never rewrites old sheet rows. |
| **GHL sub-account** | Working the lead: texting, calling, pipeline, appointments | Attribution truth, dedup decisions, conversion firing |
| **Meta** | Receives conversions once, deduplicated, with real values | — |

**The laws:**
1. D1 write FIRST, always. Sheet and syncs come after. A Google or CRM outage costs a report, never a customer.
2. The vault is a PROJECTION of D1 — upsert by lead_uuid, one row forever. DRIFTED rows are never retried (human repairs the sheet).
3. The browser conversion is gated on `duplicate` and NOTHING else (machine-enforced by the deploy gate).
4. No failure vanishes into a console line — every outcome lands in a D1 status column, the Missed Leads tab, or an alert.
5. Secrets live in `wrangler secret put`, never in git, never in GHL custom values.

---

## 2. LEAD FLOW — exact order (POST /api/lead)

```
0. Middleware (every page visit): mints lead_uuid cookie, stores
   first-touch + last-touch attribution cookies (utm_* + fbclid/gclid/ttclid)
1. Validate  — honeypot (server-side; bots get fake success), category
   allowlist, consent version resolved to exact wording, field rules
2. Duplicate check — ONE indexed D1 query, 24h, email OR phone (last 10
   digits). Prior conversion counted → suppress. Prior FAILED/NONE → allow.
3. D1 INSERT — upsert on lead_uuid. conversion_status='PENDING'.
   lead_events row written with the event_id (the dedup key).
4. Product enrichment — D1 lookup by product_slug (name/id/price/monthly/
   stock/admin tags). Never blocks; null = sync unenriched.
5. GHL upsert + Meta CAPI — in parallel. CAPI only if NOT duplicate.
   GHL failure ≠ CAPI failure ≠ lead failure.
6. conversion_status resolved → DUPLICATE / DISABLED / SENT / FAILED.
   Audit row updated (what fired, what didn't, why).
7. Response to browser: { ok, leadUuid, eventId, duplicate }
8. AFTER the response (waitUntil): vault upsert to 'All Leads' sheet,
   vault_status recorded in D1, failures → Missed Leads tab + alert.
9. Browser: if (!duplicate) → fire tag with the SERVER's eventId +
   PATCH /api/lead {eventId} (marks fired_client_side). Redirect to
   /thank-you. Thank-you page never fires Lead.
```

---

## 3. WEBSITE → GHL: what the sync writes

Contact upsert (LeadConnector API, per lead): firstName, lastName, email, phone, source (= source page or "website"), tags, customFields.

### 3a. TAGS (all lowercased, 60-char cap)

| Tag | When | Example |
|---|---|---|
| `website-lead` | ALWAYS, first tag, every sync | `website-lead` |
| `category-<slug>` | category chosen | `category-hot-tubs` |
| `product-<slug>` | product-page lead | `product-cascade-x200` |
| `source-<utm_source>` | first-touch source exists | `source-fb` |
| `campaign-<utm_campaign>` | first-touch campaign exists | `campaign-summer` |
| `model interest - <name>` | product enrichment found the product | `model interest - cascade x200` |
| *(admin per-product tags)* | set on the product in the admin, passed through | `floor-model`, `clearance` |

**Sub-account hook: workflow `01 Intake` triggers on `website-lead` added.** Nothing on the website emits `new-lead` — that tag is for FB/chat/manual intakes, stamped GHL-side.

### 3b. CUSTOM FIELDS (matched by KEY — a missing key in the location = value silently dropped; create every one of these at onboarding)

| Field key | Value |
|---|---|
| `lead_uuid` | the website's lead id. **THE JOIN KEY** for everything below. |
| `product_category` | category LABEL (display) |
| `product_slug` | product slug |
| `message` | customer message |
| `source_page` | page the lead came from |
| `first_touch_utm_source` / `_medium` / `_campaign` / `_utm_term` | first-touch UTMs |
| `first_touch_ad_name` | first-touch utm_content |
| `first_touch_fbclid` / `first_touch_gclid` | first-touch click IDs |
| `last_touch_utm_source` / `last_touch_utm_campaign` | last-touch pair |
| `product_name` / `product_id` / `product_price` / `product_monthly` / `product_stock` | D1 product facts (only when a product matched) |

---

## 4. GHL → WEBSITE: the two webhook contracts

Both use the SAME secret: `Authorization: Bearer <STAGE_WEBHOOK_SECRET>` (a Worker secret). GHL-side (owner ruling 2026-08-14): every webhook header carries `Bearer {{custom_values.stage_webhook_secret}}` — a plain header row, NOT GHL's AUTHORIZATION dropdown — so one custom value per install replaces five hand-pasted headers. The master snapshot ships that custom value BLANK (blank → `Bearer ` → 401 on every call, loud in execution logs, caught at smoke test). Never export a snapshot from a client account. Note this is the GHL-presented secret, which lives inside GHL either way; Worker-side secrets (Meta, Google, GHL API key) stay out of custom values, always.

### 4a. Stage events — POST `{site_base_url}/api/lead-stage`
Fired by workflow `11 CAPI` on pipeline stage change.

Body: `{ "leadUuid": "{{contact.lead_uuid}}", "event": "<exact string>", "value": <number, Purchase only> }`

| Pipeline stage | `event` (EXACT) | Value sent to Meta |
|---|---|---|
| 03 Hot Pursuit | `QualifiedLead` | env `META_VALUE_QUALIFIED` (default 75) |
| 05 Appointment Set | `Schedule` | env `META_VALUE_SCHEDULE` (default 300) |
| 06 Showed | `Showed` | env `META_VALUE_SHOWED` (default 600) |
| 08 Sold | `Purchase` | `value` from the payload — REQUIRED, number. No value = refused. |

Endpoint behavior: dedupes on (lead_uuid, event) — retries and backward stage moves are safe (200 `duplicate:true`). Refuses `Lead` (browser/server pair owns it). 401 = wrong secret. 404 = unknown lead_uuid. 503 = retry, alert after 3.

**Guard in GHL:** `lead_uuid` empty → skip the webhook, notify. The site can't match a lead it never created.

### 4b. Phone lead mint — POST `{site_base_url}/api/phone-lead`
Fired by workflows `01`/`09` ONLY when `contact.lead_uuid` is empty.

Body: `{ "phone": "...", "firstName"?, "lastName"?, "email"?, "ghlContactId": "{{contact.id}}", "callId"? }` → `{ ok, leadUuid, existing }`

Write the returned `leadUuid` into `contact.lead_uuid`. After that, stage events work for phone leads. Same 24h identity match as the website — a recognized human returns their EXISTING uuid, never a twin. Phone needs ≥10 digits (email-only = 400, stays unattributed until they touch the site). Minted leads fire NO Lead conversion (`conversion_status='NONE'`) — a later website form from the same human fires the real Lead unsuppressed.

---

## 5. D1 — fields the website writes per lead

`leads` row: `uuid` · `first_name` `last_name` `email`(lowercased) `phone`(digits) · `category` `product_slug` `message` `source_page` · first-touch: `utm_source/_medium/_campaign/_content/_term`, `fbclid` `gclid` `ttclid` · last-touch: `utm_source` `utm_campaign` · `fbp` `fbc` `ip_address` `user_agent` · `consent_version` `consent_text` `consent_url` · `conversion_status` · `ghl_contact_id` `ghl_synced_at` · `vault_status` `vault_error` `vault_synced_at` · `created_at` `updated_at`

`lead_events` row per conversion: `lead_uuid`, `event_name`, `event_id` (the browser/server dedup key), `fired_client_side`, `fired_server_side`, `payload` (audit: what fired, ghl/capi outcomes, duplicate info).

### Status values

| Column | Values | Meaning |
|---|---|---|
| `conversion_status` | `PENDING` → `SENT` / `FAILED` / `DUPLICATE` / `DISABLED`; `NONE` (phone-minted); `''` (pre-migration) | What happened to the Lead conversion. THE DUPLICATE RULE READS THIS: `FAILED`/`NONE` prior → new conversion allowed; everything else → suppressed. |
| `vault_status` | `''` / `SENT` / `FAILED` / `DRIFTED` / `UNCONFIGURED` | Sheet write outcome. `FAILED` = retry job's queue. `DRIFTED` = NOT retryable, human repairs sheet. |
| `ghl_synced_at` | timestamp, only when a contact id was returned | "Synced" = we hold the CRM's id, never a guess. |

---

## 6. THE VAULT SHEET

Google Sheet, tab **'All Leads'** — the human window into D1. Writer: service account (shared as Editor). Appends anchor to `'All Leads'!A1` (never an open range — the column-AF bug), upserts by lead_uuid in column A, resolved at write time.

**43 columns, append-only, position is the contract:**
`lead_uuid · submitted_at · first_name · last_name · email · phone · category · product_slug · message · source_page · traffic_channel · landing_page_url · referrer_url · utm_source · utm_medium · utm_campaign · utm_content · utm_term · fbclid · gclid · ttclid · event_id · fbp · fbc · ghl_status · ghl_contact_id · ghl_error · capi_status · capi_error · consent_version · contactable · conversion_value · retry_count · last_retry_at · product_name · product_id · product_price · product_monthly · product_stock · product_qty · financing_interest · form_intent · msclkid`

Notes: `landing_page_url`/`referrer_url` are RESERVED (write empty until the middleware capture ticket ships). `capi_status` mirrors `conversion_status` exactly. `contactable` = YES only when phone + consent both exist (built for progressive funnels).

**Columns 35–40 (owner ruling 2026-08-14): the product SNAPSHOT.** `product_name/id/price/monthly/stock/qty` are frozen from D1 enrichment at submit — the same object sent to GHL, so sheet and CRM cannot disagree. D1 stays the only source of truth for product data; a later price/stock edit does NOT rewrite old rows (the row records what the lead saw when they asked). Empty on category-only leads and phone leads. **Columns 41–43 are RESERVED:** `financing_interest`/`form_intent` fill when the survey wizard ships; `msclkid` fills if Microsoft Ads ever runs. Old-sheet names that did NOT return, on purpose: `timestamp`/`lead_source`/`campaign`/`page_url` (exact duplicates of `submitted_at`/`utm_source`/`utm_campaign`/`source_page`), `inventory_status_tag`/`model_interest_tag` (tag SPELLINGS of `product_stock`/`product_name` — the tags themselves go to GHL), `product_page_url`/`original_catalog_link`/`clicked_model`/`clicked_model_price` (covered by `source_page` + the snapshot; the old catalog-click memory is not a template feature).

Tab **'Missed Leads'** — append-only incident log (never upserted), one row per GHL failure:
`logged_at · lead_uuid · failed_step · error · first_name · last_name · email · phone · source_page`

---

## 7. ALERTS

`ALERT_WEBHOOK_URL` secret = one Slack-compatible webhook (Slack / Discord / GHL inbound). Fired from the after-response task:
- GHL sync failed → Missed Leads row + alert
- CAPI failed (real failure, not duplicate/disabled) → alert
- Vault FAILED or DRIFTED → alert (loudest — if the mirror is down, everything after it is unmonitored)
Unconfigured = loud console line saying no alert channel exists.

---

## 8. SECRETS (all via `wrangler secret put`, per client)

| Secret | For | Unset behavior |
|---|---|---|
| `GHL_API_KEY` + `GHL_LOCATION_ID` | CRM sync | K-01 error logged, lead still saved |
| `META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` | server conversions | K-02 error logged |
| `META_VALUE_QUALIFIED/_SCHEDULE/_SHOWED` | value ladder | defaults 75/300/600 + K-06 warning per event |
| `STAGE_WEBHOOK_SECRET` | both CRM→site endpoints | endpoints 503, loudly |
| `GOOGLE_SHEETS_ID` + `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | vault (key arrives with literal \n — the code un-escapes; all trimmed) | vault_status=UNCONFIGURED, lead unaffected |
| `ALERT_WEBHOOK_URL` | failure alerts | console fallback |
| `META_TEST_EVENT_CODE` | smoke test ONLY: put → verify in Events Manager → DELETE | if set, every event is a test event and warns on every fire. Gate fails the build if ever committed. |
| `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` | admin panel | — |

---

## 9. DUPLICATE RULE (exact)

Match: same email (lowercased) OR same phone (last 10 digits) within 24h — one indexed D1 query, never a sheet read. Decision by the PRIOR lead's `conversion_status`: `FAILED` or `NONE` → let the new conversion fire (recovers lost signal). Anything else → suppress both halves (server skips CAPI, response carries `duplicate:true`, browser skips tag + PATCH). The lead itself is ALWAYS stored and synced — suppression is ad-signal only.

---

## 10. CONSENT (TCPA)

Stored per lead at submit: `consent_version` + the EXACT rendered `consent_text` + the page URL. Not a boolean. The GHL sub-account may only automate SMS to leads that have this record; phone-minted leads have none (`contactable=NO`) — human dial only.

---

## 11. INDEXING

Enforced by the deploy gate: robots.txt disallows `/lp/`, sitemap excludes internal routes. Rule for new funnel pages: `/lp/*` and wizard steps 2+ = noindex + canonical to the funnel entry, out of the sitemap. Product/category pages stay indexed.

---

## 12. ONBOARDING A CLIENT (runbook)

1. Client config (`clients/<name>.config.ts`): identity (real name/siteUrl/phone/address/geo/foundedYear), theme + ≤3 color overrides, categories, sections, financing, `deployMode: 'client'`.
2. `npm ci && npm run build && node scripts/gate.mjs` — must be **0 failures** in client mode (template mode fails exactly 3 locks by design).
3. Cloudflare: create D1 + R2, put ids in wrangler.toml, `wrangler d1 migrations apply` (0001–0004).
4. Secrets: everything in §8.
5. Google Sheet: create, tabs exactly `All Leads` and `Missed Leads`, share with the service-account email as Editor.
6. GHL location: create the custom FIELDS from §3b (exact keys) + the v2 snapshot's fields; confirm workflow `01` triggers on `website-lead`; set `site_base_url` custom value (live domain, no trailing slash); set the `stage_webhook_secret` custom value to the same value as the Worker's `STAGE_WEBHOOK_SECRET` (one value — all webhook headers reference it; verify one webhook delivers the resolved header on first smoke test).
7. Smoke: `scripts/smoke-lead.sh` locally; then live — one test lead (`META_TEST_EVENT_CODE` set) → confirm: D1 row, sheet row `SENT`, GHL contact with tags + fields, Events Manager shows ONE deduped Lead → delete the test code.
8. Stage test: move the test opportunity through Hot Pursuit → Sold (with a quote value) → confirm 4 events, second attempt returns `duplicate:true`.
9. A2P/10DLC + verified email sending domain (never travel with a snapshot).

---

## 13. DEFERRED (known, deliberate — not bugs)

- Middleware capture of landing URL + verbatim query string → fills the two reserved vault columns. Ship with the survey funnel.
- Vault retry job for `FAILED` rows (reads D1, resolves by lead_uuid, updates-or-refuses, never appends over DRIFTED).
- Survey funnel (shape B) integration when the external UI lands — see `FUNNEL_BUILD_LIST.md`.
