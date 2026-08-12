#!/usr/bin/env node
/**
 * THE GATE — run this before every deploy.
 *
 *   npm run gate
 *
 * It fails the build on any guardrail violation. The point is not to catch
 * mistakes carefully; it is to make the Sun Pool session's defects impossible
 * to ship even if every human forgets.
 *
 * Two classes of check, because they catch different bugs:
 *
 *   SOURCE  — reads the repo. Catches "someone typed a hex code into a
 *             component" before it can drift.
 *   RENDERED — boots the site and crawls it. Catches what the HTML actually
 *             contains, which is the only thing a customer or a crawler ever
 *             sees. An admin link that "isn't in any component" still counts
 *             if it appears in the output.
 *
 * What it CANNOT do — and this is the important part:
 *
 *   Automated checks catch BROKEN, not WRONG. Every one of the Sun Pool
 *   defects worked perfectly: the admin link returned 200, the saunas page
 *   rendered, "1979" was valid text, Shop Inventory went somewhere real.
 *   No scanner flags a working thing. The eyeball checklist this prints at
 *   the end is not decoration — it is the half of the job no gate can do.
 *
 * Exit codes: 0 = pass (warnings allowed), 1 = at least one failure.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The gate has to be runnable against a tree that is NOT this repo.
 *
 * Every check in here claims to catch a defect. The only proof of that
 * claim is reintroducing the defect and watching the gate fail — which
 * means the harness needs to point the gate at a fixture directory with a
 * manifest of its own, and read the result as data rather than as prose.
 * Hence --root, --manifest, --source-only and --json. Nothing about a
 * normal `npm run gate` changes: the defaults are what they always were.
 */
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => !a.includes('=')));
const valueOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(valueOf('--root') ?? DEFAULT_ROOT);
const MANIFEST = resolve(valueOf('--manifest') ?? join(ROOT, 'dist', 'gate-manifest.json'));

/** Source + config checks only. No build, no server — what the harness runs. */
const SOURCE_ONLY = flags.has('--source-only');
const SKIP_RENDER = SOURCE_ONLY || flags.has('--no-render');
/** Machine-readable results, so a test asserts WHICH check failed. */
const JSON_OUT = flags.has('--json');
const PORT = Number(valueOf('--port') ?? 4399);

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

const results = [];
const fail = (check, detail) => results.push({ level: 'FAIL', check, detail });
const warn = (check, detail) => results.push({ level: 'WARN', check, detail });
const pass = (check, detail = '') => results.push({ level: 'PASS', check, detail });

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', yellow: '', green: '', dim: '', bold: '', off: '' };

/* ------------------------------------------------------------------ */
/* File helpers                                                        */
/* ------------------------------------------------------------------ */

const SOURCE_EXT = new Set(['.astro', '.ts', '.tsx', '.css', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.wrangler', '.git']);

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (SOURCE_EXT.has(extname(entry.name))) out.push(full);
  }
  return out;
}

/** Strip block and line comments so a defect described in prose is not a hit. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ------------------------------------------------------------------ */
/* SOURCE CHECKS                                                       */
/* ------------------------------------------------------------------ */

async function sourceChecks() {
  const files = await walk(join(ROOT, 'src'));

  // --- 1. No colour literals outside the config -------------------
  //
  // Two survivors, and only these two: the neutral stops of the image
  // placeholder gradient. They are MATERIAL, not brand — the grey behind a
  // missing photo is chrome no client will ever tune, and tokenizing them
  // would add two config fields nobody would ever fill in. Everything else
  // in the tree is brand and belongs in config. Do not add a third entry
  // here without writing down why it is material.
  const ALLOWED = new Set(['#eef2f8', '#e2e9f4']);

  // Longest alternative first. #RRGGBBAA must be consumed whole: with only
  // {6}|{3}, "#e8a40080" matched NOTHING — after "#e8a400" comes "8", a word
  // character, so \b never fired, and "#e8a" failed the same way. An alpha
  // variant of a brand colour was completely invisible to this check.
  const HEX = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

  const colourOffenders = [];
  let colourCount = 0;
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('src/config/')) continue;
    // The admin panel is internal chrome, not a customer-facing brand
    // surface. It pulls brand colours through define:vars and uses neutral
    // greys for its own furniture; forcing those into every client's config
    // would add tokens nobody will ever tune.
    if (rel.startsWith('src/pages/admin/')) continue;
    const body = stripComments(await readFile(file, 'utf8'));
    for (const [i, line] of body.split('\n').entries()) {
      const bad = (line.match(HEX) ?? []).filter((m) => !ALLOWED.has(m.toLowerCase()));
      // Numeric arguments only. rgb(var(--brand-deep-rgb) / .5) is the
      // CORRECT form and appears throughout theme.css — [^)]* stops at the
      // ")" of var(), so the token form never starts with a digit and is
      // filtered out here rather than reported.
      const calls = line.match(/(?:rgba?|hsla?)\([^)]*\)/g) ?? [];
      bad.push(...calls.filter((c) => /^(?:rgba?|hsla?)\(\s*[0-9]/.test(c)));
      if (!bad.length) continue;
      colourCount += bad.length;
      colourOffenders.push(`${rel}:${i + 1} ${bad.join(' ')}`);
    }
  }
  if (colourOffenders.length) {
    const shown = colourOffenders.slice(0, 8).join('\n      ');
    const rest = colourOffenders.length - 8;
    fail(
      'No brand colour literals outside src/config',
      rest > 0
        ? `${colourCount} literals on ${colourOffenders.length} lines\n      ${shown}\n      … and ${rest} more lines`
        : shown,
    );
  } else {
    pass('No brand colour literals outside src/config');
  }

  // --- 2. No category names typed into code -----------------------
  const catWords = /'(hot-tub|swim-spa|sauna|massage-chair|cold-plunge)'/g;
  const catOffenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('src/config/')) continue;
    const body = stripComments(await readFile(file, 'utf8'));
    if (catWords.test(body)) catOffenders.push(rel);
    catWords.lastIndex = 0;
  }
  if (catOffenders.length) {
    fail(
      'No category slugs hardcoded outside src/config',
      `${catOffenders.join(', ')} — this is the saunas defect. Read from enabledCategories.`,
    );
  } else {
    pass('No category slugs hardcoded outside src/config');
  }

  // --- 3. No admin link in any component --------------------------
  const adminOffenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('src/pages/admin/')) continue;
    const body = stripComments(await readFile(file, 'utf8'));
    if (/href=["'`][^"'`]*\/admin/.test(body)) adminOffenders.push(rel);
  }
  if (adminOffenders.length) fail('No /admin link in any component', adminOffenders.join(', '));
  else pass('No /admin link in any component');

  // --- 3b. Autocomplete on island form fields ---------------------
  // The rendered check below can only see SERVER html. A React island's
  // form is built in the browser, so its inputs never appear there — which
  // is exactly where the quiz lives. Without this, the single most
  // important form on the site would be the one the gate cannot check.
  const acOffenders = [];
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    const rel = relative(ROOT, file);
    const body = await readFile(file, 'utf8');
    for (const tag of body.matchAll(/<input\b[\s\S]*?\/>/g)) {
      const el = tag[0];
      const name = /name=["']([^"']+)["']/.exec(el)?.[1] ?? '';
      const type = /type=["']([^"']+)["']/.exec(el)?.[1] ?? 'text';
      const isPii = /name|email|phone|tel|zip|postal|address/i.test(name) || ['email', 'tel'].includes(type);
      if (isPii && !/autoComplete=/.test(el)) {
        acOffenders.push(`${rel}: <input name="${name}" type="${type}">`);
      }
    }
  }
  if (acOffenders.length) {
    fail('Autocomplete on island form fields', acOffenders.join('\n      '));
  } else {
    pass('Autocomplete on island form fields');
  }

  // --- 3c. The financing link is gated on the financing block -----
  // /financing 404s for any client whose financing block is null. A link to
  // it that is not gated on that block therefore ships a dead end from every
  // page it appears on — the nav-link defect, one component further down.
  // The rule is deliberately per-file: a file that links there has to know
  // whether the page exists.
  const finOffenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('src/config/')) continue;
    const body = stripComments(await readFile(file, 'utf8'));
    const links = /(?:href|financingHref)=["'`]\/financing\b|["'`]\/financing["'`]/.test(body);
    if (links && !/site\.financing/.test(body)) finOffenders.push(rel);
  }
  if (finOffenders.length) {
    fail(
      'Financing link is gated on the financing block',
      `${finOffenders.join(', ')} — links to /financing without checking site.financing. ` +
        'That page 404s whenever financing is null.',
    );
  } else {
    pass('Financing link is gated on the financing block');
  }

  // --- 3d. Prices go through pricingFor() -------------------------
  // A price is not just a number to format. Whether it may be shown at all
  // depends on the unit's status and on the display config, and a surface
  // that formats its own price skips both. formatPrice/formatMonthly are
  // module-private for that reason; this catches anyone re-exporting or
  // reimplementing them.
  const priceOffenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('src/lib/')) continue;
    const body = stripComments(await readFile(file, 'utf8'));
    if (/\bformatPrice\b|\bformatMonthly\b/.test(body)) priceOffenders.push(rel);
  }
  if (priceOffenders.length) {
    fail(
      'Prices go through pricingFor()',
      `${priceOffenders.join(', ')} — formats its own price, which skips the sold/pending ` +
        'and display-config rules. Use pricingFor().',
    );
  } else {
    pass('Prices go through pricingFor()');
  }

  // --- 3e. Structured data prices go through pricingFor() ---------
  // JSON-LD is a second surface publishing the same fact, and it is the one
  // nobody eyeballs. A file that writes a price into schema.org output and
  // does not consult pricingFor() is deciding for itself what may be
  // published — which is how the DOM and the schema come to disagree.
  const schemaPriceOffenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('src/config/')) continue;
    const body = stripComments(await readFile(file, 'utf8'));
    // An Offer node is the only place schema.org carries a price, so that
    // is the trigger. Matching the word "price" anywhere caught a button
    // label on the internal proof page — a check that fires on prose is a
    // check people learn to ignore.
    if (!/["']@type["']\s*:\s*["']Offer["']/.test(body)) continue;
    if (!/pricingFor\s*\(/.test(body)) schemaPriceOffenders.push(rel);
  }
  if (schemaPriceOffenders.length) {
    fail(
      'Structured data prices go through pricingFor()',
      `${schemaPriceOffenders.join(', ')} — publishes a price to schema.org on its own terms. ` +
        'A sold unit shows no price on the page; its Offer must not carry one either.',
    );
  } else {
    pass('Structured data prices go through pricingFor()');
  }

  // --- 4. Secrets are not in the repo -----------------------------
  for (const name of ['.env', '.dev.vars']) {
    if (existsSync(join(ROOT, name))) {
      warn(`${name} exists locally`, 'Fine for development. Confirm it is gitignored and never committed.');
    }
  }
  const tokenish = [];
  for (const file of files) {
    const body = await readFile(file, 'utf8');
    if (/\b(ghp_|github_pat_|EAAG[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{24,})/.test(body)) {
      tokenish.push(relative(ROOT, file));
    }
  }
  if (tokenish.length) fail('No credentials committed in source', tokenish.join(', '));
  else pass('No credentials committed in source');

  // --- 5. D1 migrations configured ---------------------------------
  // A schema change on a live client database is impossible without a
  // migrations path (J-08): `CREATE TABLE IF NOT EXISTS` skips existing
  // tables entirely, so an edit to schema.sql never reaches a client.
  // The baseline must exist BEFORE the first client DB does.
  const wranglerToml = existsSync(join(ROOT, 'wrangler.toml'))
    ? await readFile(join(ROOT, 'wrangler.toml'), 'utf8')
    : '';
  let migrationCount = 0;
  try {
    migrationCount = (await readdir(join(ROOT, 'db', 'migrations'))).filter((f) =>
      f.endsWith('.sql'),
    ).length;
  } catch {
    /* dir missing → count stays 0 */
  }
  if (!wranglerToml.includes('migrations_dir')) {
    fail('D1 migrations configured', 'wrangler.toml has no migrations_dir entry.');
  } else if (migrationCount === 0) {
    fail('D1 migrations configured', 'db/migrations/ is missing or has no .sql files.');
  } else {
    pass('D1 migrations configured', `${migrationCount} migration file(s)`);
  }
}

/* ------------------------------------------------------------------ */
/* CONFIG CHECKS                                                       */
/* ------------------------------------------------------------------ */

const PLACEHOLDERS = [
  { field: 'identity.name', test: (m) => /CLIENT NAME|PLACEHOLDER|Lorem/i.test(m.identity.name) },
  { field: 'identity.siteUrl', test: (m) => /example\.com/i.test(m.identity.siteUrl) },
  { field: 'contact.phone', test: (m) => /^\+1555555/.test(m.contact.phone) },
  { field: 'address.postalCode', test: (m) => m.address.postalCode === '00000' },
  {
    field: 'address geo',
    test: (m) => m.address.latitude === 0 && m.address.longitude === 0,
    hint: 'Null Island. Set the real coordinates or the LocalBusiness schema is wrong.',
  },
  { field: 'address.street', test: (m) => /placeholder/i.test(m.address.street) },
];

function configChecks(m) {
  // --- The big one -------------------------------------------------
  if (m.deployMode !== 'client') {
    fail(
      'Config is not in client mode',
      `deployMode is "${m.deployMode}". This is the un-customised template — it must never reach a live domain.`,
    );
  } else {
    pass('Config is in client mode');
  }

  const found = PLACEHOLDERS.filter((p) => p.test(m)).map((p) => p.hint ? `${p.field} (${p.hint})` : p.field);
  if (found.length) fail('No placeholder facts', found.join(', '));
  else pass('No placeholder facts');

  if (m.categories.length === 0) fail('At least one category enabled', 'Nothing to sell.');
  else pass('At least one category enabled', m.categories.map((c) => c.slug).join(', '));

  if (m.hoursCount === 0) fail('Opening hours set', 'Needed by the footer and by schema.org.');
  else pass('Opening hours set');

  if (m.sameAs.length === 0) {
    warn('Social profiles set', 'sameAs is empty, so the LocalBusiness schema has no social proof. Not fatal.');
  } else {
    pass('Social profiles set', `${m.sameAs.length} in sameAs`);
  }

  if (m.serviceAreas.length === 0) warn('Service areas set', 'areaServed will be omitted from schema.');
  else pass('Service areas set');

  // --- Nav sanity --------------------------------------------------
  const labels = new Map();
  for (const item of [...m.nav.header, ...m.nav.footer]) {
    const existing = labels.get(item.href);
    if (existing && existing !== item.label) {
      fail(
        'One label per destination',
        `${item.href} is called both "${existing}" and "${item.label}". The live site had FIVE names for /contact.`,
      );
    }
    labels.set(item.href, item.label);
  }
  if (!results.some((r) => r.check === 'One label per destination')) pass('One label per destination');

  // --- A monthly payment is a credit offer -------------------------
  // The schema already refuses this combination at build time. It is
  // checked again here because the gate is what runs against a manifest
  // from a build somebody else made, and this is the one defect on the
  // list that ships a regulated claim rather than a broken link.
  if (m.display?.showMonthly && !m.financingEnabled) {
    fail(
      'Monthly payments require financing terms',
      'display.showMonthly is true but financing is null. "$149/mo" with no lender, ' +
        'no APR and no disclaimer is an offer stated without its terms.',
    );
  } else {
    pass(
      'Monthly payments require financing terms',
      m.display?.showMonthly ? 'shown, financing configured' : 'not shown',
    );
  }

  const ctaHref = m.nav.primaryCta.href;
  if (!m.nav.header.some((n) => n.href === ctaHref) && ctaHref !== '/inventory') {
    warn('Primary CTA destination', `${ctaHref} is not in the nav. Confirm it exists.`);
  } else {
    pass('Primary CTA destination', ctaHref);
  }

  // --- Integrations ------------------------------------------------
  // Enabled-but-unconfigured is silent at runtime by design, which is exactly
  // why it needs to be loud here.
  const envHints = {
    ghl: ['GHL_API_KEY', 'GHL_LOCATION_ID'],
    meta: ['META_PIXEL_ID', 'META_CAPI_ACCESS_TOKEN'],
  };
  for (const [key, vars] of Object.entries(envHints)) {
    if (m.integrations[key]?.enabled) {
      warn(
        `${key.toUpperCase()} enabled`,
        `Confirm these secrets are set on the Worker: ${vars.join(', ')}. Enabled without them means leads sync nowhere, silently.`,
      );
    }
  }
  if (m.integrations.meta?.enabled) {
    warn('Meta test code', 'Confirm META_TEST_EVENT_CODE is REMOVED. Test events do not count as conversions.');
  }
}

/* ------------------------------------------------------------------ */
/* RENDERED CHECKS                                                     */
/* ------------------------------------------------------------------ */

function startServer() {
  return new Promise((resolve, reject) => {
    // detached: true puts the server in its own process group. Killing the
    // npx wrapper alone leaves the real Astro process running, the port held,
    // and `npm run gate` hanging forever after it has already printed its
    // result — so the group is what gets signalled below.
    const proc = spawn('npx', ['astro', 'dev', '--port', String(PORT)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error('dev server did not start within 90s'));
      }
    }, 90_000);

    proc.stdout.on('data', (chunk) => {
      if (!settled && /localhost:\d+/.test(String(chunk))) {
        settled = true;
        clearTimeout(timer);
        setTimeout(() => resolve(proc), 1500);
      }
    });
    proc.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`dev server exited with code ${code}`));
      }
    });
  });
}

/** Kills the whole process group, not just the wrapper. */
function stopServer(proc) {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

async function fetchPage(path) {
  const res = await fetch(`http://localhost:${PORT}${path}`, { redirect: 'manual' });
  return { status: res.status, html: await res.text() };
}

async function renderedChecks(m) {
  const problems = {
    admin: [],
    relative: [],
    deadHref: [],
    plainPhone: [],
    noLogo: [],
    noDrawer: [],
    badSchema: [],
    noAutocomplete: [],
  };

  const phoneDisplay = m.contact.phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');

  for (const route of m.routes) {
    let page;
    try {
      page = await fetchPage(route);
    } catch (error) {
      fail('Route reachable', `${route} — ${error.message}`);
      continue;
    }
    const html = page.html;

    // /404 is expected to 404; everything else must be 200.
    const expect404 = route === '/404';
    if (!expect404 && page.status !== 200) {
      fail('Route returns 200', `${route} returned ${page.status}`);
    }

    // Admin link in customer-facing output.
    if (/href=["'][^"']*\/admin/.test(html)) problems.admin.push(route);

    // The config proof sheet is an internal diagnostic. Like /admin it is
    // reachable by URL and must never be LINKED — a customer following a
    // link to a page of colour swatches is the "works fine, shouldn't be
    // there" defect.
    if (/href=["'][^"']*\/proof/.test(html)) problems.admin.push(`${route} → /proof`);

    // Relative asset paths — the category-hero 404.
    const relSrc = [...html.matchAll(/(?:src|href)=["'](?!https?:|\/|#|data:|mailto:|tel:|sms:)([^"']+)["']/g)]
      .map((x) => x[1])
      .filter((v) => !v.startsWith('?'));
    if (relSrc.length) problems.relative.push(`${route}: ${relSrc.slice(0, 3).join(', ')}`);

    // Dead placeholder links.
    if (/href=["']#["']/.test(html)) problems.deadHref.push(route);

    // A phone rendered as text rather than a tel: link.
    // Anchors are removed first, then ALL remaining tags — otherwise a
    // React island's serialised props (which live in an attribute) look
    // like visible text and produce a false positive.
    const visibleText = html
      .replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, '')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<[^>]+>/g, ' ');
    if (phoneDisplay && visibleText.includes(phoneDisplay)) problems.plainPhone.push(route);

    // Header logo + knockout logo (drawer and footer).
    const navLogo = html.includes(m.logos.nav);
    const footLogo = (html.match(new RegExp(escapeRe(m.logos.footer), 'g')) ?? []).length;
    if (!navLogo || footLogo < 2) {
      problems.noLogo.push(`${route} (nav:${navLogo} knockout:${footLogo})`);
    }

    // A hamburger with no drawer is the dead-menu defect.
    const hasBurger = html.includes('id="burger"');
    const hasDrawer = html.includes('id="drawer"');
    if (hasBurger !== hasDrawer) problems.noDrawer.push(route);
    if (!hasBurger) problems.noDrawer.push(`${route} (no mobile menu at all)`);

    // Complete LocalBusiness JSON-LD, server-rendered.
    const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
      .map((x) => {
        try {
          return JSON.parse(x[1]);
        } catch {
          return { __parseError: true };
        }
      });
    if (blocks.some((b) => b.__parseError)) {
      problems.badSchema.push(`${route}: invalid JSON-LD`);
    }
    const business = blocks.find((b) => b['@id'] && String(b['@id']).includes('#business'));
    if (!business) {
      problems.badSchema.push(`${route}: no LocalBusiness`);
    } else {
      const missing = [];
      if (!business.geo?.latitude && business.geo?.latitude !== 0) missing.push('geo');
      if (!business.openingHoursSpecification?.length) missing.push('hours');
      if (!business.telephone) missing.push('telephone');
      if (!business.address?.streetAddress) missing.push('address');
      if (missing.length) problems.badSchema.push(`${route}: missing ${missing.join(', ')}`);
    }

    // Every PII input needs an autocomplete token.
    for (const input of html.matchAll(/<input\b[^>]*>/g)) {
      const tag = input[0];
      const name = /name=["']([^"']+)["']/.exec(tag)?.[1] ?? '';
      const type = /type=["']([^"']+)["']/.exec(tag)?.[1] ?? 'text';
      const isPii = /name|email|phone|tel|zip|postal|address/i.test(name) || ['email', 'tel'].includes(type);
      if (isPii && !/autocomplete=/i.test(tag)) {
        problems.noAutocomplete.push(`${route}: <input name="${name}">`);
      }
    }
  }

  report('No /admin link in rendered pages', problems.admin);
  report('No relative asset paths', problems.relative);
  report('No dead href="#"', problems.deadHref);
  report('Every phone is a tel: link', problems.plainPhone);
  report('Logo present, light and knockout', problems.noLogo);
  report('Mobile menu present and wired', problems.noDrawer);
  report('Complete LocalBusiness on every page', problems.badSchema);
  report('Autocomplete on every PII field', problems.noAutocomplete);

  // Sitemap + robots.
  try {
    const sitemapPath = join(ROOT, 'dist', 'client', 'sitemap-0.xml');
    if (existsSync(sitemapPath)) {
      const xml = await readFile(sitemapPath, 'utf8');
      if (xml.includes('/admin')) fail('Sitemap excludes admin', 'found /admin');
      else pass('Sitemap excludes admin');

      const disabled = ['saunas', 'massage-chairs', 'cold-plunges'].filter(
        (seg) => !m.categories.some((c) => c.segment === seg) && xml.includes(`/${seg}`),
      );
      if (disabled.length) fail('Sitemap has no disabled categories', disabled.join(', '));
      else pass('Sitemap has no disabled categories');
    } else {
      warn('Sitemap present', 'dist/client/sitemap-0.xml not found — run npm run build first.');
    }
  } catch (error) {
    warn('Sitemap check', error.message);
  }

  const robots = await fetchPage('/robots.txt').catch(() => null);
  if (robots && /Disallow:\s*\/admin/.test(robots.html)) pass('robots.txt disallows admin');
  else fail('robots.txt disallows admin', 'missing Disallow: /admin');

  await checkLandingPages(m, robots);
}

/**
 * PAID LANDING PAGES — the opposite rules to every other page.
 *
 * A landing page fails in ways a normal page cannot: it leaks into the search
 * index, it offers an escape hatch back into the site, or it ships with
 * EXAMPLE copy still in it. None of those look broken. All of them cost money
 * quietly, which is exactly why they are checked rather than trusted.
 */
async function checkLandingPages(m, robots) {
  const routes = m.landingRoutes ?? [];

  if (robots && !/Disallow:\s*\/lp\//.test(robots.html)) {
    fail('robots.txt disallows /lp/', 'missing Disallow: /lp/');
  } else if (robots) {
    pass('robots.txt disallows /lp/');
  }

  if (routes.length === 0) {
    // Not a failure. A client with no paid campaigns has no landing pages.
    return;
  }

  const leaked = [];
  const indexable = [];
  const noLabel = [];
  const noForm = [];
  const placeholder = [];
  const unlocked = [];

  for (const [i, route] of routes.entries()) {
    let page;
    try {
      page = await fetchPage(route);
    } catch (error) {
      fail('Landing page reachable', `${route} — ${error.message}`);
      continue;
    }
    if (page.status !== 200) {
      fail('Landing page returns 200', `${route} returned ${page.status}`);
      continue;
    }
    const html = page.html;

    // 1. Must be noindex. Three mechanisms protect this; check the one that
    //    travels with the page itself.
    if (!/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html)) {
      indexable.push(route);
    }

    // 2. No link back into the site. Every escape hatch is a paid click
    //    leaving without converting. tel:, the form, and the one configured
    //    exit link are allowed; internal page links are not.
    //    Only <a> tags count — a favicon or a stylesheet is an asset, not an
    //    exit. Matching every href was a false positive on /brand/favicon.svg.
    const internal = [...html.matchAll(/<a\b[^>]*\bhref=["'](\/[^"'#?]*)["']/gi)]
      .map((x) => x[1])
      .filter(
        (h) =>
          h !== '' &&
          !h.startsWith('/lp/') &&
          !h.startsWith('/_astro') &&
          h !== m.landingExitHrefs?.[i],
      );
    if (internal.length) leaked.push(`${route}: ${[...new Set(internal)].slice(0, 4).join(', ')}`);

    // 3. The FTC advertorial disclosure must actually render.
    const label = m.landingLabels?.[i];
    if (label && !html.includes(label)) noLabel.push(route);

    // 4. A landing page with no form cannot convert.
    if (!/<form\b/i.test(html) && !/quiz-/.test(html)) noForm.push(route);

    // 5. Placeholder copy that reached a paid page.
    if (/\bEXAMPLE\b|\bLorem ipsum\b|\bTODO\b|\[service area\]/i.test(html)) placeholder.push(route);

    // 6. Locked viewport — a pinch-zoom on mobile paid traffic is a misfired
    //    tap on a form field.
    if (!/user-scalable=no/.test(html)) unlocked.push(route);
  }

  report('Landing pages are noindex', indexable);
  report('No organic links off a landing page', leaked);
  report('Advertorial label rendered', noLabel);
  report('Landing page has a lead form', noForm);
  report('No placeholder copy on a landing page', placeholder);
  report('Landing page viewport is locked', unlocked);

  try {
    const sitemapPath = join(ROOT, 'dist', 'client', 'sitemap-0.xml');
    if (existsSync(sitemapPath)) {
      const xml = await readFile(sitemapPath, 'utf8');
      if (xml.includes('/lp/')) fail('Sitemap excludes landing pages', 'found /lp/ in the sitemap');
      else pass('Sitemap excludes landing pages');
    }
  } catch (error) {
    warn('Landing sitemap check', error.message);
  }
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function report(check, offenders) {
  if (offenders.length) fail(check, [...new Set(offenders)].slice(0, 6).join('\n      '));
  else pass(check);
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

const EYEBALL = [
  'Every category and product shown is something this client ACTUALLY SELLS.',
  'Every fact is TRUE for this client — year, address, phone, hours, prices.',
  'No leftover text from another client or from the template.',
  'Nothing backend or internal is visible to a customer.',
  'Nav labels match what this client calls things.',
  'You clicked every nav link and it went where it said.',
];

async function main() {
  if (!JSON_OUT) console.log(`\n${C.bold}PRE-DEPLOY GATE${C.off}\n`);

  if (!existsSync(MANIFEST)) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ crashed: true, reason: `manifest missing: ${MANIFEST}`, results: [] }));
    } else {
      console.error(
        `${C.red}Cannot run: ${relative(ROOT, MANIFEST)} is missing.${C.off}\n` +
          `Run \`npm run build\` first — the gate checks what was built, not what is in source.\n`,
      );
    }
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));

  await sourceChecks();
  configChecks(manifest);

  let server = null;
  if (SOURCE_ONLY) {
    // Deliberately silent. The harness runs source checks in isolation on
    // purpose; a warning there would fire in every single test.
  } else if (SKIP_RENDER) {
    warn('Rendered checks skipped', '--no-render was passed. Half the gate did not run.');
  } else {
    try {
      server = await startServer();
      await renderedChecks(manifest);
    } catch (error) {
      fail('Rendered checks', `could not start the site: ${error.message}`);
    } finally {
      stopServer(server);
    }
  }

  /* -------- output -------- */
  const failures = results.filter((r) => r.level === 'FAIL');
  const warnings = results.filter((r) => r.level === 'WARN');
  const passes = results.filter((r) => r.level === 'PASS');

  if (JSON_OUT) {
    console.log(JSON.stringify({ crashed: false, results }));
    process.exit(failures.length ? 1 : 0);
  }

  for (const r of passes) {
    console.log(`  ${C.green}PASS${C.off}  ${r.check}${r.detail ? `  ${C.dim}${r.detail}${C.off}` : ''}`);
  }
  for (const r of warnings) {
    console.log(`  ${C.yellow}WARN${C.off}  ${r.check}\n      ${C.dim}${r.detail}${C.off}`);
  }
  for (const r of failures) {
    console.log(`  ${C.red}FAIL${C.off}  ${r.check}\n      ${r.detail}`);
  }

  console.log(
    `\n  ${passes.length} passed · ${C.yellow}${warnings.length} warnings${C.off} · ${
      failures.length ? C.red : ''
    }${failures.length} failures${C.off}\n`,
  );

  console.log(`${C.bold}The gate cannot check these. You can.${C.off}`);
  console.log(`${C.dim}Automated checks catch broken, not wrong. Every Sun Pool defect worked perfectly.${C.off}`);
  for (const item of EYEBALL) console.log(`  [ ] ${item}`);
  console.log('');

  if (failures.length) {
    console.log(`${C.red}${C.bold}BLOCKED — do not deploy.${C.off}\n`);
    process.exit(1);
  }
  console.log(`${C.green}Machine checks passed.${C.off} Now do the eyeball pass above, then deploy.\n`);
  // Explicit: a stray handle from the dev server must not leave the gate
  // hanging after it has already reported.
  process.exit(0);
}

main().catch((error) => {
  if (JSON_OUT) {
    console.log(JSON.stringify({ crashed: true, reason: String(error?.stack ?? error), results }));
  } else {
    console.error(`\n${C.red}Gate crashed:${C.off}`, error);
  }
  process.exit(1);
});
