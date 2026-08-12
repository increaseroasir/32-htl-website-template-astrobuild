# Hot Tub Store Website Template

A reusable Astro 6 template that generates client store sites. **This repo is the template, not a client site.**

The template exists to make one class of bug structurally impossible: the same fact drifting across many files. Everything a client site needs to know about itself lives in exactly one place — `src/config/client.config.ts`.

---

## THE ONE LAW

**One fact lives in ONE place.**

Name, phone, founding year, address, hours, nav links, labels, logos, colours, categories, social URLs — each exists exactly once, in the config. Every page reads it. Anything computable from those facts (the `tel:` href, the display phone number, the formatted address, the map embed, the directions link, years in business, `sameAs`) is **derived**, not stored, so a derived value can never disagree with its source.

If you ever see the same fact typed into two files, **that is the bug**. Fix the source, not the copies.

---

## Build a client site

```bash
npm install
npm run client:use sun-pool     # or: copy any clients/*.config.ts over src/config/client.config.ts
npm run build
```

That is the whole operation. No component, page, layout, stylesheet or API route changes between clients.

The repo ships with a **placeholder** config (`deployMode: 'template'`), so a fresh clone renders obviously-fake facts and a red TEMPLATE MODE banner. The deploy gate refuses to ship anything still in template mode — that is what keeps placeholder text off a live site.

---

## Commands

| Command | What it does |
|---|---|
| `npm run gate` | **Run before every deploy.** Fails on any guardrail violation, then prints the eyeball checklist only a human can do |
| `npm run gate:fast` | Source and config checks only — skips booting the site |
| `npm run dev` | Local dev server with Cloudflare bindings |
| `npm run build` | Production build. **Validates the config first** — an invalid config fails the build with a plain-English list of what is wrong |
| `npm run check` | Type-check every `.astro` and `.ts` file |
| `npm run client:use <name>` | Make `clients/<name>.config.ts` the active config |
| `npm run preview` | Run the built Worker locally via Wrangler |
| `npm run deploy` | build → gate → deploy. Refuses to ship if the gate fails (**operator only**) |

---

## Stack (locked — do not substitute)

| Layer | Choice |
|---|---|
| Framework | Astro 6 (`6.4.8`) |
| Language | TypeScript, strict |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite` |
| Islands | React — interactive components only |
| Deploy target | Cloudflare **Workers** via `@astrojs/cloudflare` **v13** |
| Database | Cloudflare D1 |
| Storage | Cloudflare R2 |
| CRM | GoHighLevel (native `/api/lead`) |
| Tag manager | Cloudflare Zaraz |

### Two pinning rules that matter

**1. `vite` is pinned to `7.3.6` in `devDependencies` and `overrides`. Do not remove it.**

Astro 6 runs on Vite 7. `@tailwindcss/vite` declares Vite as a *peer* with range `^5 || ^6 || ^7 || ^8`, so npm happily installs Vite **8** and hoists it to the root while Astro keeps a nested Vite 7. Two Vite copies break the SSR dependency optimiser with a baffling `require_dist is not a function` at build time. The pin plus the override guarantees exactly one Vite. Verify any time dependencies change:

```bash
npm ls vite     # every line should say 7.3.6
```

**2. Do not use `@astrojs/tailwind`.** It peers to Astro ≤5 and Tailwind 3, and will not work here. Tailwind is wired through `@tailwindcss/vite` in `astro.config.ts`.

Astro **7** and `@astrojs/cloudflare` **v14** now exist. This template deliberately stays on 6/v13 — the locked stack — rather than grabbing latest. Upgrading is a separate, deliberate project.

---

## Where things live

```
src/config/schema.ts        The contract. Zod schema — enforcement, not documentation.
src/config/categories.ts    Catalog of every category the TEMPLATE supports.
src/config/client.config.ts THE active client config. The one source of truth.
src/config/index.ts         Validates the config, exposes `site` + `derived`.
clients/*.config.ts         Example / per-client configs. Never imported by components.
src/components/BrandTokens.astro  The only bridge from config colours to CSS.
src/components/Header.astro The ONE header. Contains the drawer AND its script.
src/components/Footer.astro The ONE footer. Contains no admin markup at all.
src/components/SocialIcon.astro   Glyph lookup, keyed by config social names.
src/layouts/BaseLayout.astro      Mounts Header + Footer for every page.
src/styles/theme.css        Exact port of the live design system. Zero hex codes.
src/styles/global.css       Tailwind token bridge. Zero hex codes.
src/lib/db.ts               The ONLY way products are read. Filters by config.
src/lib/seo.ts              Every schema.org object. Pages never hand-write JSON-LD.
src/lib/meta-capi.ts        Conversions API. Hashing + the dedup event_id.
src/lib/ghl.ts              GoHighLevel contact upsert.
src/lib/hash.ts             SHA-256 with Meta's normalisation rules.
src/lib/admin-auth.ts       Reused Sun Pool auth. Do not redesign.
db/schema.sql               D1 tables: products, leads, lead_events,
                            admin_sessions.
db/seed.example.sql         Local dev fixtures. Never apply to production.
```

### Why the Header owns its own script

The live site had a hamburger button on 8 pages with no menu and no JavaScript behind it — the button was copied, the drawer and its script were not. Here the drawer markup **and** the code that opens it live inside `Header.astro`. A page that has a header has a working menu, because they are the same file. There is no way to get one without the other.

---

## Guardrails already enforced

These are not conventions to remember — the build fails if they are violated.

| Guardrail | How it is enforced |
|---|---|
| Absolute asset paths only | Schema rejects any logo or hero path that does not start with `/` or `https://` |
| Every phone is a `tel:` link | Config stores one E.164 number; the display string and `tel:` href are both derived. There is no way to render a phone as plain text |
| Categories are opt-in | Absent from config = OFF. Everything that lists categories iterates one array |
| No nav link to a disabled category | Schema cross-check fails the build |
| Colours are config values | `global.css` and every component contain no hex codes |
| Complete geo for schema.org | Latitude and longitude are required fields, not optional |
| Map is never blank | Derived from the address — there is no `mapEmbedUrl` field to leave empty |
| Social icons and `sameAs` agree | Both read the same derived list |
| Placeholder config cannot ship | `deployMode: 'template'` is refused by the deploy gate |
| Admin never crawled | Excluded from the sitemap; `noindex` in `public/_headers` |
| No admin link on public pages | The Footer component contains no admin markup — not hidden, absent |
| Mobile menu works everywhere | Drawer + its script live inside the one Header component |
| Logo present on every page, light and dark | One `<img>` in the header, one knockout variant in the drawer and footer |
| No dead social links | Icons render only for platforms with a URL in config; no `href="#"` path exists |
| Nav labels cannot drift | Header and footer render from the same config array |
| LocalBusiness JSON-LD on every page | Mounted in `BaseLayout`, so a page cannot render without it |
| Schema is never incomplete | `geo` is a required config field; hours and `sameAs` read the same arrays the footer prints |
| Schema is server-rendered | Built in `src/lib/seo.ts` at request time, not injected by a client script |
| Structured data cannot advertise a disabled category | `makesOffer` and `ItemList` are built from `enabledCategories` |
| A disabled category cannot serve products | Every public query filters by `enabledCategorySlugs` — the same array the nav uses |
| Drafts and deleted rows never reach a customer | Public status filter is an allow-list (`available`, `pending`, `sold`), not a deny-list |
| Turning a category off never destroys data | Products stay in the table, become invisible, and are reported as orphans |
| Categories cannot become a second source of truth | There is no categories table; the config block is the only place they exist |

---

## Database (Cloudflare D1)

The template ships with **no database bound**. A fresh clone runs, and the
inventory API returns a 503 explaining exactly what to do rather than a 500.

To wire one up:

```bash
wrangler d1 create my-client-inventory     # copy the database_id it prints
```

Uncomment the `[[d1_databases]]` block in `wrangler.toml`, paste the id, then:

```bash
npm run db:apply:local      # create the tables locally
npm run db:seed:local       # optional: example fixtures for development
npm run db:apply:remote     # production - operator only
```

### Categories are config, not data

There is **no categories table**. Whether this site sells saunas is decided
in exactly one place - the `categories` block of `client.config.ts`. Labels,
URL segments and ordering all live there too.

Every public query filters `category IN (...)` using `enabledCategorySlugs`,
the same array the header nav renders from. So a sauna product can sit in the
database, fully valid, and never appear anywhere on the site. Flip one config
line and it appears in the API, the category route, and the nav together.

Turning a category off never deletes anything. The product rows stay; they
simply become invisible until the category is enabled again.

### Astro 6 changed how bindings are read

`Astro.locals.runtime.env` was **removed in Astro 6**. Bindings now come from
the `cloudflare:workers` module:

```ts
import { env } from 'cloudflare:workers';
```

Any older Cloudflare snippet using `context.locals.runtime.env.DB` will compile
fine and then fail at runtime. `src/lib/db.ts` has the correct pattern.

---

## Tracking: Meta CAPI, GoHighLevel, Zaraz

### How deduplication works

Every lead fires the `Lead` event **twice** — once from the browser through
Zaraz, once from the server through the Conversions API. Meta merges them into
one conversion, but only if both carry the same `event_id` **and** the same
`event_name`.

That id is generated when the lead is saved and written to `lead_events`
BEFORE either side fires. The browser then uses the id the **server** returned,
not one it made up. If they ever disagreed, every lead would be counted twice —
which halves your reported cost per lead and quietly corrupts every
optimisation decision after it.

The `lead_events` table is the audit: `fired_client_side` and
`fired_server_side` are set independently, so "did both halves fire?" is a
query, not a guess.

### Setup

**1. Secrets** (never in config, never in git):

```bash
wrangler secret put GHL_API_KEY
wrangler secret put GHL_LOCATION_ID
wrangler secret put META_PIXEL_ID
wrangler secret put META_CAPI_ACCESS_TOKEN
wrangler secret put META_TEST_EVENT_CODE   # remove before going live
```

**2. Turn them on** in `client.config.ts`:

```ts
integrations: {
  ghl:   { enabled: true },
  meta:  { enabled: true },
  zaraz: { enabled: true },
}
```

Both the flag AND the secret must be present, or the call is skipped silently.
That is deliberate: a half-configured client should send nothing rather than
send broken events.

**3. Zaraz**, in the Cloudflare dashboard (there is no snippet to paste — it
runs at the edge):

- Zaraz → Add tool → **Meta Pixel**. Enter the pixel ID and the same CAPI
  access token.
- Triggers → new trigger on the dataLayer event **`lead_submit`**.
- Map it to the Meta Pixel **`Lead`** event.
- **Map `event_id` from the dataLayer to the tag's Event ID field.** This is
  the step that makes deduplication work. Skip it and every lead counts twice.
- Optional second trigger on `product_style_selected` for a mid-funnel event.
- Enable the Consent Manager if you need Consent Mode v2.

### Test that a real lead flows through

1. Set `META_TEST_EVENT_CODE` to the code from **Events Manager → your pixel →
   Test Events**.
2. Visit the site with a campaign URL so there is attribution to check:
   `https://yoursite.com/find-your-match?utm_source=facebook&utm_campaign=test&fbclid=TESTCLICK123`
3. Complete the quiz with a real phone and email you can check.
4. **Meta**: Test Events should show ONE `Lead` — not two. Open it and confirm
   it says the event was received from both Browser and Server and was
   deduplicated. Two separate rows means the Event ID mapping in step 3 of
   setup is missing.
5. **GHL**: the contact appears with tags `website-lead`, `category-hot-tub`,
   `source-facebook`, `campaign-test`, and custom fields including
   `first_touch_utm_source` and `lead_uuid`.
6. **The audit table**, which is the ground truth:

```bash
wrangler d1 execute DB --remote --command \
  "SELECT substr(event_id,1,8) AS id, fired_client_side, fired_server_side, payload
   FROM lead_events ORDER BY created_at DESC LIMIT 1;"
```

   Both flags at `1` means both halves fired with the same id. The `payload`
   column records the GHL and CAPI HTTP status, so a failure tells you which
   one and why.

7. Remove `META_TEST_EVENT_CODE` before real traffic — events sent with it do
   not count as conversions.

### If something did not arrive

The lead is **always** saved first. A GHL outage or a Meta error costs a sync,
never a customer — check `payload` in `lead_events` for the status code, and
the Worker logs (`wrangler tail`) for the message.

---

## Deploying

See **[DEPLOY.md](DEPLOY.md)** — the full runbook, from creating the database
to proving a lead reaches GoHighLevel. Deploying is operator-only.

---

## The pre-deploy gate

```bash
npm run build && npm run gate
```

`npm run deploy` runs both for you and will not deploy if the gate fails.

It checks two different things, because they catch different bugs. **Source
checks** read the repo — a hex code typed into a component, a category slug
hardcoded, an admin link, a form field missing `autocomplete`. **Rendered
checks** boot the site and crawl every route, because the HTML is the only
thing a customer or a crawler ever sees.

Proven to catch each of these by reintroducing them one at a time:

| Reintroduced defect | Caught by |
|---|---|
| Admin link back in the public footer | `No /admin link in any component` |
| `product.category === 'hot-tub'` in a component | `No category slugs hardcoded outside src/config` |
| A brand hex typed into a component | `No brand colour literals outside src/config` |
| Two labels for one destination | `One label per destination` |
| `src="assets/logo.png"` | `No relative asset paths` |
| Phone rendered as text, not a `tel:` link | `Every phone is a tel: link` |
| Knockout logo missing from the drawer | `Logo present, light and knockout` |
| `autocomplete` stripped from the quiz phone field | `Autocomplete on island form fields` |
| Config still in template mode | `Config is not in client mode` |

That last one is the important one: the gate **blocks a deploy of the
un-customised template**, along with placeholder facts like Null Island
coordinates, a 555 phone number and an `example.com` URL.

### What the gate cannot do

It catches **broken**, not **wrong**. Every Sun Pool defect worked perfectly —
the admin link returned 200, the saunas page rendered, "1979" was valid text,
Shop Inventory went somewhere real. No scanner flags a working thing.

So the gate finishes by printing a checklist it cannot tick for you:

```
[ ] Every category and product shown is something this client ACTUALLY SELLS.
[ ] Every fact is TRUE for this client — year, address, phone, hours, prices.
[ ] No leftover text from another client or from the template.
[ ] Nothing backend or internal is visible to a customer.
[ ] Nav labels match what this client calls things.
[ ] You clicked every nav link and it went where it said.
```

Green machine checks are permission to start looking, not permission to ship.

---

## Rules for working in this repo

- **One job per commit.** Do not start the next job until the current one is committed.
- **Commit via terminal**, not the editor button:
  ```bash
  git add -A && git commit -m "message" && git push
  ```
- **Deploy ≠ commit.** Committing saves to GitHub; deploying makes it live. Deploy is operator-only.
- **Read-only first.** Before any risky change, list what will change, then change it.
- **Machine checks do not catch wrong, only broken.** A dead admin link, a category nobody sells, a wrong founding year — all render perfectly. Before any launch, a human clicks every page and asks "does anything here not belong, or say something false?"

---

## Secrets

Secrets never live in config and never enter git.

```bash
wrangler secret put ADMIN_PASSWORD
wrangler secret put ADMIN_SESSION_SECRET
wrangler secret put GHL_API_KEY
wrangler secret put META_CAPI_ACCESS_TOKEN
```

`.env.example` lists every variable. Copy it to `.env` for local dev.

Brand colours, logos, phone, address, hours, nav and categories are **not** environment variables — they are config.
