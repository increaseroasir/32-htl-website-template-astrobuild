# Deploy runbook

Follow this top to bottom. It assumes you have a terminal open in the repo
folder and nothing else.

**Deploying is operator-only.** No agent runs step 8.

---

## Before you start — what you need in hand

| Thing | Where it comes from |
|---|---|
| Cloudflare account with the domain on it | you already have this |
| The client's real facts | the client — see step 1 |
| GoHighLevel API key + Location ID | GHL → Settings → Business Info / API keys |
| Meta Pixel ID + Conversions API token | Events Manager → your pixel → Settings |
| Logo files | the client, or the existing site |

If you are missing the GHL or Meta credentials, you can still deploy — leave
those integrations `enabled: false` and turn them on later. Everything else is
required.

---

## 1. Fill in the client config

Open `src/config/client.config.ts` — or copy a client file over it:

```bash
npm run client:use lakeside-hot-tubs
```

**Every field must be true for this client.** The gate blocks obvious
placeholders, but it cannot know that a real-looking phone number is the wrong
one. This is the step where a wrong fact becomes a wrong website.

Set `deployMode: 'client'`. The gate refuses to deploy anything still on
`'template'`.

### Still unresolved for Sun Pool

These are `null` on purpose — I would not invent them. Fill them in before
launch:

- `social.facebook` / `social.instagram` — populates BOTH the footer icons and
  the schema.org `sameAs`. Currently the LocalBusiness schema has no social
  proof at all.
- `contact.email` — null means no email is published anywhere.
- `address.googlePlaceId` — optional, improves the directions link.
- `brand.logos.favicon` and `ogImage` — currently pointing at template
  placeholder art. The OG image is what shows when someone shares the site.

---

## 2. Create the database and the image bucket

```bash
wrangler d1 create lakeside-inventory
wrangler r2 bucket create lakeside-product-images
```

The first command prints a `database_id`. Copy it.

Then in the Cloudflare dashboard: **R2 → your bucket → Settings → Public
access → Allow**. Copy the bucket ID it shows.

---

## 3. Wire the bindings

Open `wrangler.toml`. Uncomment both blocks and paste your values:

```toml
[[d1_databases]]
binding = "DB"
database_name = "lakeside-inventory"
database_id = "paste-the-id-from-step-2"

[[r2_buckets]]
binding = "PRODUCT_IMAGES"
bucket_name = "lakeside-product-images"
```

Also set the Worker `name` at the top of the file to something client-specific.

---

## 4. Create the tables

```bash
npm run db:apply:remote
```

Run this once per client. It is safe to re-run — every statement is
`CREATE TABLE IF NOT EXISTS`.

Do **not** run `db:seed:local` against production. That is example data with
"EXAMPLE" in every name.

---

## 5. Set the secrets

Secrets never go in config and never go in git.

```bash
wrangler secret put ADMIN_PASSWORD
wrangler secret put ADMIN_SESSION_SECRET     # any long random string
wrangler secret put R2_PUBLIC_BUCKET_ID      # from step 2
wrangler secret put GHL_API_KEY
wrangler secret put GHL_LOCATION_ID
wrangler secret put META_PIXEL_ID
wrangler secret put META_CAPI_ACCESS_TOKEN
wrangler secret put STAGE_WEBHOOK_SECRET     # openssl rand -hex 32
```

Optional — the conversion value ladder. Skip these and the built-in
defaults apply (0 / 75 / 300 / 600):

```bash
wrangler secret put META_VALUE_QUALIFIED
wrangler secret put META_VALUE_SCHEDULE
wrangler secret put META_VALUE_SHOWED
```

There is no `META_VALUE_PURCHASE`. Purchase carries the real sale value or
it does not fire — see step 6b.

Each prompts for the value and does not echo it.

For `ADMIN_SESSION_SECRET`, any long random string works:

```bash
openssl rand -hex 32
```

**Do not set `META_TEST_EVENT_CODE` in production.** Events sent with it do
not count as conversions.

---

## 6. Set up Zaraz

Cloudflare dashboard → your zone → **Zaraz**. There is no snippet to paste;
it runs at the edge.

1. Add tool → **Meta Pixel** → pixel ID + the same CAPI token.
2. Triggers → new trigger on the dataLayer event **`lead_submit`**.
3. Map it to Meta's **`Lead`** event.
4. **Map `event_id` from the dataLayer into the tag's Event ID field.**

Step 4 is the one that matters. Without it every lead is counted twice, which
halves your reported cost per lead and quietly corrupts every optimisation
decision after it.

Optional: a second trigger on `product_style_selected`, and the Consent
Manager if you need Consent Mode v2.

---

## 6b. Wire the pipeline stages back to Meta

This is the half that makes the ad account learn. The website only ever
sends `Lead`, and **`Lead` is worth 0**. Everything Meta optimises towards
comes from the CRM.

| Event | Value | When to fire it |
|---|---|---|
| `QualifiedLead` | 75 | someone confirmed it is a real buyer |
| `Schedule` | 300 | an appointment is on the calendar |
| `Showed` | 600 | they turned up |
| `Purchase` | the real sale amount | closed |

In GoHighLevel, build **one workflow per stage**. Trigger: *Opportunity
Stage Changed*. Action: *Webhook*.

```
POST https://yoursite.com/api/lead-stage
Authorization: Bearer <STAGE_WEBHOOK_SECRET>
Content-Type: application/json

{ "leadUuid": "{{contact.lead_uuid}}", "event": "Schedule" }
```

`lead_uuid` is the custom field the site already writes on every lead, so
the contact carries it from the moment it arrives.

For the closed-won workflow, add the money:

```json
{ "leadUuid": "{{contact.lead_uuid}}", "event": "Purchase", "value": 8450 }
```

Each workflow hardcodes the event name it means. **Your GHL stage names are
never sent and never stored in the codebase** — rename a stage in GHL and
nothing here breaks.

Things worth knowing before you test it:

- **A retry cannot double-count.** One stage event per lead, enforced by the
  database. A repeat call returns `200` with `"duplicate": true` and sends
  nothing.
- **A failed send WILL retry correctly.** If Meta rejects the event, the
  endpoint returns `502` and leaves the row unsent, so the next attempt
  re-sends under the *same* event id.
- **Purchase without a positive value is rejected with `400`.** That is
  deliberate. A made-up sale figure teaches Meta to go and find more people
  like whoever it thinks paid it.
- **Meta rejects anything older than seven days.** A deal that sits in a
  stage for two weeks and then moves will still fire with today's timestamp,
  which is correct — the stage change is what happened today.

Test one by hand before trusting the workflows:

```bash
curl -sS -X POST https://yoursite.com/api/lead-stage \
  -H "Authorization: Bearer $STAGE_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"leadUuid":"PASTE_A_REAL_UUID","event":"QualifiedLead"}'
```

Expect `{"ok":true,...,"value":75,"actionSource":"system_generated"}`. Run it
twice — the second should say `"duplicate":true`. Then check Events Manager:
one `QualifiedLead`, received from Server, value 75.

---

## 7. Build and run the gate

```bash
npm run build && npm run gate
```

The gate boots the site, crawls every page, and fails on any guardrail
violation. **If it says BLOCKED, stop.** It prints exactly what is wrong.

Then do the part it cannot do. It ends by printing this list — actually walk
through the site and tick it:

```
[ ] Every category and product shown is something this client ACTUALLY SELLS.
[ ] Every fact is TRUE for this client — year, address, phone, hours, prices.
[ ] No leftover text from another client or from the template.
[ ] Nothing backend or internal is visible to a customer.
[ ] Nav labels match what this client calls things.
[ ] You clicked every nav link and it went where it said.
```

Every defect from the last build worked perfectly — the admin link returned
200, the saunas page rendered, "1979" was valid text. No scanner flags a
working thing. **This is the half of the job only you can do.**

---

## 8. Deploy

```bash
npm run deploy
```

That runs build → gate → deploy, and refuses to deploy if the gate fails.

If Cloudflare offers to **"Create a new project"** — **cancel.** That means
you are in the wrong folder or the Worker name is missing. Deploying from the
wrong place is how a client site ends up overwriting another one.

Then point the domain at the Worker: dashboard → **Workers & Pages → your
Worker → Settings → Domains & Routes → Add custom domain**.

---

## 9. Check the LIVE domain, not localhost

A local preview passing tells you nothing about production. Open the real
domain and check:

- [ ] Homepage loads, logo visible in the header
- [ ] Mobile menu opens and closes on a real phone
- [ ] Every nav link goes where it says
- [ ] A category page lists real products with real prices
- [ ] Tapping the phone number opens the dialler
- [ ] The map in the footer shows the right place
- [ ] `/admin` asks for a password and shows nothing before you log in
- [ ] `yoursite.com/robots.txt` loads and disallows `/admin`

---

## 10. Prove a lead flows through

Do this once, with a real phone and email you can check.

1. Visit with a campaign URL so there is attribution to verify:
   `https://yoursite.com/find-your-match?utm_source=facebook&utm_campaign=launch-test&fbclid=TESTCLICK123`
2. Complete the quiz.
3. **GHL** — the contact appears with tags `website-lead`,
   `category-hot-tub`, `source-facebook`, `campaign-launch-test`, and custom
   fields including `first_touch_utm_source`.
4. **Meta Events Manager** — one `Lead` event, received from both Browser and
   Server, deduplicated. **Two separate events means the Event ID mapping in
   step 6 is missing.**
5. **The audit table** — ground truth:

```bash
wrangler d1 execute DB --remote --command \
  "SELECT substr(event_id,1,8) AS id, fired_client_side, fired_server_side, payload
   FROM lead_events ORDER BY created_at DESC LIMIT 1;"
```

Both flags at `1` means both halves fired with the same id. The `payload`
column carries the GHL and CAPI HTTP status, so a failure tells you which one
and why.

Then delete the test lead from GHL so it does not sit in a follow-up sequence.

---

## If something is wrong after deploy

**Roll back** to the previous version — dashboard → your Worker →
**Deployments** → find the previous one → **Rollback**. This is instant and
does not touch the database.

**A lead did not reach GHL or Meta.** The lead is always saved to D1 first, so
it is not lost. Check `payload` in `lead_events` for the status code, and:

```bash
wrangler tail
```

for the live error message.

**Inventory is empty.** Check the D1 binding is uncommented in
`wrangler.toml`, that `npm run db:apply:remote` ran, and that products are set
to `available` rather than `draft` in `/admin`.

**Images do not load.** R2 public access is off, or `R2_PUBLIC_BUCKET_ID` is
wrong. The admin refuses uploads in that state rather than saving a URL that
404s — so if uploads are being refused, that is the cause and the message says
so.

---

## Adding a category later

One line in `client.config.ts`:

```ts
categories: {
  'hot-tub': { enabled: true },
  'sauna':   { enabled: true },   // ← new
}
```

That is the whole change. The route, the nav link, the footer link, the
sitemap entry, the breadcrumb, the quiz option, the admin dropdown and the
database queries all follow from that one array. There is no second place to
update — which is the entire point of the rebuild.
