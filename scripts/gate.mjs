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
import { spawn, spawnSync } from 'node:child_process';

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

  // --- 5. No operator diagnostics in customer pages ----------------
  // inventoryStatus() splits one string into {operatorDetail,
  // customerMessage} (C9). A customer page that renders the operator half
  // prints wrangler commands and binding names to shoppers and crawlers —
  // the whole H-area root cause. admin/ and proof.astro are the operator's
  // own screens; console.* lines are the operator's console. Everything
  // else in src/pages may only touch customerMessage.
  const diagOffenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (!rel.startsWith('src/pages/')) continue;
    if (rel.startsWith('src/pages/admin/') || rel === 'src/pages/proof.astro') continue;
    const body = stripComments(await readFile(file, 'utf8'));
    for (const [i, line] of body.split('\n').entries()) {
      if (line.includes('console.')) continue;
      if (/operatorDetail|dbStatus\.message|Status\.message|status\.message/.test(line)) {
        diagOffenders.push(`${rel}:${i + 1}`);
      }
    }
  }
  if (diagOffenders.length) {
    fail(
      'No operator diagnostics in customer pages',
      `${diagOffenders.join(', ')} — renders operator detail to customers. Render customerMessage; ` +
        'send operatorDetail to console.error.',
    );
  } else {
    pass('No operator diagnostics in customer pages');
  }

  // --- 6. Internal routes are delisted ------------------------------
  // The operator's diagnostic pages live in ONE list
  // (src/config/internal-routes.ts); the sitemap filter must read it and
  // the list must name /proof. If either stops being true, a re-listed
  // internal route reaches every crawler on the next deploy (L-01).
  const internalRoutesFile = join(ROOT, 'src', 'config', 'internal-routes.ts');
  const configFile = join(ROOT, 'astro.config.ts');
  let internalRoutesBody = '';
  let astroConfigBody = '';
  try {
    internalRoutesBody = stripComments(await readFile(internalRoutesFile, 'utf8'));
  } catch {
    /* missing file caught below */
  }
  try {
    astroConfigBody = stripComments(await readFile(configFile, 'utf8'));
  } catch {
    /* astro.config.ts missing only in synthetic fixtures */
  }
  const routeEntries = [...internalRoutesBody.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
  if (!routeEntries.includes('/proof')) {
    fail(
      'Internal routes are delisted',
      "src/config/internal-routes.ts must list '/proof' — it is an unauthenticated diagnostic page.",
    );
  } else if (astroConfigBody && !/INTERNAL_ROUTES/.test(astroConfigBody)) {
    fail(
      'Internal routes are delisted',
      'astro.config.ts no longer reads INTERNAL_ROUTES — the sitemap filter is unwired.',
    );
  } else {
    pass('Internal routes are delisted', routeEntries.join(', '));
  }

  // --- 7. Headers file is intact ------------------------------------
  // public/_headers carries the client-hint delegation Meta match quality
  // depends on (C11 / spec §4.1). Three regressions this refuses:
  // the real token going missing, any ch-ua-* wildcard delegation
  // (fingerprint handed to every third party), and the capability denials
  // disappearing.
  let headersBody = '';
  try {
    headersBody = await readFile(join(ROOT, 'public', '_headers'), 'utf8');
  } catch {
    /* missing file fails below */
  }
  const headerProblems = [];
  if (!headersBody.includes('ch-ua-full-version-list=')) {
    headerProblems.push('ch-ua-full-version-list missing (ch-ua-full-version alone is not a real token)');
  }
  if (/ch-ua-[a-z-]*=\(\*\)/.test(headersBody)) {
    headerProblems.push('a ch-ua-* hint is delegated to (*) — Facebook origins only');
  }
  if (!headersBody.includes('camera=()')) {
    headerProblems.push('capability denials (camera=() etc.) missing');
  }
  if (headerProblems.length) fail('Headers file is intact', headerProblems.join('; '));
  else pass('Headers file is intact');

  // --- 8. No viewport lock in src -----------------------------------
  // The source half of the C12 inversion: a locked viewport is a WCAG
  // 1.4.4 failure that never comes back, and this catches it without a
  // dev server (the rendered half is 'Landing viewport allows zoom').
  const viewportOffenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    const body = stripComments(await readFile(file, 'utf8'));
    for (const [i, line] of body.split('\n').entries()) {
      if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1\b/.test(line)) {
        viewportOffenders.push(`${rel}:${i + 1}`);
      }
    }
  }
  if (viewportOffenders.length) {
    fail(
      'No viewport lock in src',
      `${viewportOffenders.join(', ')} — pinch-zoom must work (WCAG 1.4.4). iOS input zoom is solved by the 16px rule in theme.css.`,
    );
  } else {
    pass('No viewport lock in src');
  }

  // --- 9. Images declare width and height ---------------------------
  // An <img> with no dimensions gives the browser nothing to reserve, so
  // the page shifts as each one arrives — paid mobile traffic feels it
  // worst (E-01/E-02/E-04). admin/ is internal chrome.
  const imgOffenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (!rel.endsWith('.astro') && !rel.endsWith('.tsx')) continue;
    if (rel.startsWith('src/pages/admin/')) continue;
    const body = stripComments(await readFile(file, 'utf8'));
    for (const tag of body.match(/<img\b[^>]*>/gs) ?? []) {
      if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
        imgOffenders.push(`${rel} — ${tag.slice(0, 60).replace(/\s+/g, ' ')}…`);
      }
    }
  }
  if (imgOffenders.length) {
    fail(
      'Images declare width and height',
      `${imgOffenders.join('\n      ')} — no reserved space, the page shifts as it loads.`,
    );
  } else {
    pass('Images declare width and height');
  }

  // --- 10. D1 migrations configured ---------------------------------
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

  // --- 11. Browser conversion gated on duplicate status only --------
  // The duplicate rule (Lead Vault, Job 3): a suppressed duplicate must
  // not fire the browser half of the Lead conversion — and NOTHING ELSE
  // may gate it. Gating it on a sync outcome (ghl/capi) quietly starves
  // Meta of signal every time the CRM hiccups; removing the gate
  // double-fires every repeat customer. The guard must be exactly
  // `!data.duplicate`.
  const quizPath = join(ROOT, 'src', 'components', 'islands', 'Quiz.tsx');
  let quizBody = '';
  try {
    quizBody = stripComments(await readFile(quizPath, 'utf8'));
  } catch {
    /* missing file fails below */
  }
  const trackIdx = quizBody.indexOf("track('lead_submit'");
  if (trackIdx === -1) {
    fail(
      'Browser conversion gated on duplicate status only',
      "track('lead_submit' not found in src/components/islands/Quiz.tsx — the browser half of the conversion is gone.",
    );
  } else {
    const guards = [...quizBody.slice(0, trackIdx).matchAll(/if\s*\(([^)]*)\)/g)];
    const condition = guards.length ? guards[guards.length - 1][1].trim() : '';
    if (condition !== '!data.duplicate') {
      fail(
        'Browser conversion gated on duplicate status only',
        `the guard nearest track('lead_submit') is "${condition || '(none)'}" — it must be exactly !data.duplicate. ` +
          'No gate double-fires repeat customers; any other gate starves Meta of signal it paid for.',
      );
    } else {
      pass('Browser conversion gated on duplicate status only');
    }
  }

  /* ----- The Lead Vault seals (Job 5) — five checks, each pinned by a
     defect-reintroducing harness test. The vault's load-bearing
     properties stop being conventions here and become failures. ----- */

  // --- 12. Vault write comes after the D1 write ---------------------
  // D1 is the durable record; the sheet is a projection of it. A vault
  // write before the INSERT re-creates the Sun Pool ordering, where a
  // Google outage costs a customer instead of a report row. Applies to
  // EVERY lead-writing endpoint (website + phone mint).
  const LEAD_ENDPOINTS = ['lead.ts', 'phone-lead.ts'];
  const endpointBodies = {};
  for (const name of LEAD_ENDPOINTS) {
    try {
      endpointBodies[name] = stripComments(
        await readFile(join(ROOT, 'src', 'pages', 'api', name), 'utf8'),
      );
    } catch {
      endpointBodies[name] = '';
    }
  }
  const leadBody = endpointBodies['lead.ts'];
  const orderProblems = [];
  for (const name of LEAD_ENDPOINTS) {
    const body = endpointBodies[name];
    const d1InsertIdx = body.indexOf('INSERT INTO leads');
    const vaultCallIdx = body.indexOf('upsertRowByLeadUuid(');
    if (d1InsertIdx === -1 || vaultCallIdx === -1) {
      orderProblems.push(
        `${name} is missing ${d1InsertIdx === -1 ? 'the D1 INSERT' : 'the vault write'} — the lead path is not wired`,
      );
    } else if (vaultCallIdx < d1InsertIdx) {
      orderProblems.push(
        `a vault write appears BEFORE the D1 INSERT in ${name} — D1 first, always; the sheet is the window, not the record`,
      );
    }
  }
  if (orderProblems.length) fail('Vault write comes after the D1 write', orderProblems.join('; '));
  else pass('Vault write comes after the D1 write');

  // --- 13. Vault write cannot fail the lead -------------------------
  // The task runs in waitUntil, after the response. Two ways to break
  // that: return a response from inside the task, or await the task
  // before responding. Both are refused here, in every lead endpoint.
  const taskProblems = [];
  for (const name of LEAD_ENDPOINTS) {
    const body = endpointBodies[name];
    const vaultBlockStart = body.indexOf('const vaultTask');
    const vaultBlockEnd = body.indexOf('})();', vaultBlockStart);
    if (vaultBlockStart === -1 || vaultBlockEnd === -1) {
      taskProblems.push(`the vaultTask block is missing from ${name}`);
      continue;
    }
    const vaultBlock = body.slice(vaultBlockStart, vaultBlockEnd);
    if (/return json\(/.test(vaultBlock)) {
      taskProblems.push(`${name}: the vault task can return a response to the customer`);
    }
    if (/await vaultTask/.test(body)) {
      taskProblems.push(`${name}: the response awaits the vault task — sheet latency and failures become customer-facing`);
    }
  }
  if (taskProblems.length) fail('Vault write cannot fail the lead', taskProblems.join('; '));
  else pass('Vault write cannot fail the lead');

  // --- 14. Sheet append anchors to A1, never an open range ----------
  // The column-AF bug: an open column range lets Sheets latch onto stray
  // right-hand content and write a live lead where no reader looks.
  const sheetsPath = join(ROOT, 'src', 'lib', 'sheets.ts');
  let sheetsBody = '';
  try {
    sheetsBody = stripComments(await readFile(sheetsPath, 'utf8'));
  } catch {
    /* missing file fails below */
  }
  const appendStart = sheetsBody.indexOf('export async function appendRow');
  // Bound the region at the NEXT function declaration, exported or not —
  // the private column-A lookup that follows legitimately reads '!A:A'.
  const nextFn = /\n(?:export )?(?:async )?function /g;
  nextFn.lastIndex = appendStart + 1;
  const appendEnd = nextFn.exec(sheetsBody)?.index ?? -1;
  if (appendStart === -1) {
    fail('Sheet append anchors to A1, never an open range', 'appendRow is missing from src/lib/sheets.ts.');
  } else {
    const appendFn = sheetsBody.slice(appendStart, appendEnd === -1 ? undefined : appendEnd);
    if (!appendFn.includes('!A1')) {
      fail(
        'Sheet append anchors to A1, never an open range',
        "appendRow no longer anchors to '<tab>'!A1 — the append can drift out of column A again.",
      );
    } else if (/![A-Z]+:[A-Z]+/.test(appendFn)) {
      fail(
        'Sheet append anchors to A1, never an open range',
        'appendRow contains an open column range — this is the exact shape that wrote a live lead at column AF.',
      );
    } else {
      pass('Sheet append anchors to A1, never an open range');
    }
  }

  // --- 15. Google secrets declared in the env schema ----------------
  // A secret missing from Env is invisible to the type-checker and
  // becomes undefined at 2am instead of failing at build.
  let envBody = '';
  try {
    envBody = await readFile(join(ROOT, 'src', 'env.d.ts'), 'utf8');
  } catch {
    /* missing file fails below */
  }
  const missingSecrets = ['GOOGLE_SHEETS_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'].filter(
    (name) => !envBody.includes(name),
  );
  if (missingSecrets.length) {
    fail(
      'Google secrets declared in the env schema',
      `${missingSecrets.join(', ')} missing from src/env.d.ts — the vault cannot be configured type-safely.`,
    );
  } else {
    pass('Google secrets declared in the env schema');
  }

  // --- 16. No Meta test event code in committed config --------------
  // A committed META_TEST_EVENT_CODE sends every conversion to Meta's
  // test stream in production — spend with zero recorded conversions.
  // The secret belongs in `wrangler secret put`, used briefly, deleted.
  const testCodeProblems = [];
  if (/^\s*META_TEST_EVENT_CODE\s*=/m.test(wranglerToml)) {
    testCodeProblems.push('wrangler.toml sets META_TEST_EVENT_CODE as a var');
  }
  for (const file of files) {
    const rel = relative(ROOT, file);
    const body = stripComments(await readFile(file, 'utf8'));
    if (/META_TEST_EVENT_CODE['"]?\s*[:=]\s*['"][^'"]+['"]/.test(body)) {
      testCodeProblems.push(`${rel} hardcodes a test event code`);
    }
  }
  if (testCodeProblems.length) {
    fail('No Meta test event code in committed config', testCodeProblems.join('; '));
  } else {
    pass('No Meta test event code in committed config');
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
  //
  // ACCEPTANCE, DECIDED (A.2 / G-19, G-21): "clean" means — on a
  // client-mode config, 0 failures; on the template config, exactly the
  // three deliberate locks ('Config is in client mode', 'No placeholder
  // facts', 'At least one category enabled') and nothing else. The locks
  // keep exit 1 on purpose: `npm run deploy`'s build && gate && deploy
  // chain must stay physically unable to ship the blank template. The
  // category lock is PART of the lock set — deliberately stricter than
  // the schema, because the gate only ever runs pre-deploy. No special
  // exit code unless CI ever needs a green run on the bare template
  // (none exists). The harness asserts this set with SET EQUALITY.
  //
  // ONE name per check (G-14): pass and fail report the same name, or
  // the pending ledger and history can never match up.
  if (m.deployMode !== 'client') {
    fail(
      'Config is in client mode',
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

  // The schema's ceiling is a static 2100 (Workers freeze the clock at 0 in
  // global scope, so the schema cannot ask "what year is it"). THIS process
  // has a real clock, so the honest check lives here.
  if (m.identity.foundedYear > new Date().getFullYear()) {
    fail(
      'Founded year is not in the future',
      `identity.foundedYear is ${m.identity.foundedYear} — every "years in business" line would be negative.`,
    );
  } else {
    pass('Founded year is not in the future');
  }

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
    // --ignore-lock + forced foreground (Astro 7): dev now runs as a
    // per-project background daemon, and a second `astro dev` ATTACHES to
    // it instead of starting. A daemon left over from an earlier run —
    // possibly with different node_modules under it — would make the gate
    // crawl a stale server and fail every rendered check for the wrong
    // reason. Worse, in an auto-detected agent environment Astro forces
    // daemon mode, which rejects --ignore-lock; ASTRO_DEV_BACKGROUND=1 is
    // the daemon child's own marker and forces a plain foreground server.
    // The gate always gets its own private server in its own process
    // group, and never touches the daemon's lock.
    const proc = spawn('npx', ['astro', 'dev', '--port', String(PORT), '--ignore-lock'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, ASTRO_DEV_BACKGROUND: '1' },
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
        // "Listening" is not "ready": on a COLD dev server (Astro 7 /
        // Vite 8 first boot) the dep optimiser can interrupt early requests
        // mid-stream, and a truncated page fails rendered checks for the
        // wrong reason. Poll until the homepage arrives complete twice.
        (async () => {
          let complete = 0;
          for (let i = 0; i < 60 && complete < 2; i++) {
            try {
              const res = await fetch(`http://localhost:${PORT}/`);
              const body = await res.text();
              complete = res.ok && body.includes('</html>') ? complete + 1 : 0;
            } catch {
              complete = 0;
            }
            if (complete < 2) await new Promise((r) => setTimeout(r, 1000));
          }
          if (complete >= 2) resolve(proc);
          else reject(new Error('dev server listening but the homepage never rendered completely'));
        })();
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
  // Astro 7's dev process can re-parent out of the spawn group and survive
  // the group signal, leaving a zombie holding the port that poisons the
  // NEXT gate run. Sweep by exact command line (pkill exists on macOS and
  // Linux; failures are ignored).
  try {
    spawnSync('pkill', ['-f', `astro dev --port ${PORT} --ignore-lock`]);
  } catch {
    /* best effort */
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

      // Rendered half of 'Internal routes are delisted' (C10): the BUILT
      // sitemap must not advertise any INTERNAL_ROUTES entry. Runs in
      // phase-end/full gates today; harness fixture lands at AL-3.
      try {
        const internalSrc = await readFile(join(ROOT, 'src', 'config', 'internal-routes.ts'), 'utf8');
        const internalEntries = [...internalSrc.matchAll(/'(\/[^']*)'/g)].map((mm) => mm[1]);
        const listed = internalEntries.filter((route) => xml.includes(route));
        if (listed.length) fail('Sitemap excludes internal routes', listed.join(', '));
        else pass('Sitemap excludes internal routes', internalEntries.join(', '));
      } catch {
        fail('Sitemap excludes internal routes', 'src/config/internal-routes.ts unreadable');
      }

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
  const locked = [];

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

    // 6. INVERTED at C12 (decision A.4, spec §4.3): the gate used to
    //    REQUIRE user-scalable=no here — a WCAG 1.4.4 failure iOS ignores
    //    anyway. Now a locked viewport is the defect. iOS auto-zoom is
    //    solved by the ≥16px input rule in theme.css.
    if (/user-scalable=no|maximum-scale=1\b/.test(html)) locked.push(route);
  }

  report('Landing pages are noindex', indexable);
  report('No organic links off a landing page', leaked);
  report('Advertorial label rendered', noLabel);
  report('Landing page has a lead form', noForm);
  report('No placeholder copy on a landing page', placeholder);
  report('Landing viewport allows zoom', locked);

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
