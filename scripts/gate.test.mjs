#!/usr/bin/env node
/**
 * THE GATE, TESTED.
 *
 *   npm run gate:test
 *
 * A check that has never been watched to FAIL is not a check. Every defect
 * the gate claims to catch is reintroduced here, in a throwaway copy of the
 * tree, and the gate is run against it. A test passes only when:
 *
 *   1. the fixture WITH the defect makes the gate exit non-zero, naming the
 *      right check, and
 *   2. the same fixture WITHOUT the defect makes that check pass.
 *
 * Both halves matter. A check that fails on everything is as useless as one
 * that fails on nothing, and only the second half tells them apart.
 *
 * Fixtures are real directories, not mocks. The gate reads files; so does
 * this. Anything stubbed here is a hole in exactly the way the holes this
 * suite exists to close were holes.
 */

import { mkdtemp, cp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(ROOT, 'scripts', 'gate.mjs');

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', yellow: '', green: '', dim: '', bold: '', off: '' };

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A manifest that passes every config check. A test breaks exactly ONE
 * thing, so a failure names one cause rather than a pile of them.
 */
export function cleanManifest(overrides = {}) {
  return {
    generatedAt: new Date(0).toISOString(),
    deployMode: 'client',
    identity: { name: 'Fixture Spas', siteUrl: 'https://fixture-spas.test', foundedYear: 1998 },
    contact: { phone: '+16195550142', email: 'hello@fixture-spas.test' },
    address: {
      street: '1200 Harbor Way',
      city: 'San Diego',
      postalCode: '92101',
      latitude: 32.7157,
      longitude: -117.1611,
    },
    hoursCount: 6,
    sameAs: ['https://www.facebook.com/fixturespas'],
    serviceAreas: ['San Diego'],
    categories: [{ slug: 'hot-tub', segment: 'hot-tubs', href: '/hot-tubs', label: 'Hot Tubs' }],
    nav: {
      header: [
        { label: 'Hot Tubs', href: '/hot-tubs' },
        { label: 'Inventory', href: '/inventory' },
      ],
      footer: [{ label: 'Inventory', href: '/inventory' }],
      primaryCta: { label: 'Shop Inventory', href: '/inventory' },
      legalItems: [{ label: 'Privacy Policy', href: '/privacy-policy' }],
    },
    integrations: {},
    financingEnabled: false,
    display: { showPrice: true, showMonthly: false },
    logos: {
      nav: '/brand/logo-nav.svg',
      footer: '/brand/logo-footer.svg',
      inventory: null,
      favicon: '/brand/favicon.svg',
      ogImage: '/brand/og-default.png',
    },
    routes: ['/', '/inventory', '/hot-tubs', '/404'],
    landingRoutes: [],
    landingLabels: [],
    landingExitHrefs: [],
    ...overrides,
  };
}

/**
 * Copies the real `src/` into a temp root, hands it to `mutate` so a test can
 * reintroduce a defect, writes the manifest, runs the gate, deletes the copy.
 *
 * The copy is of the REAL source on purpose: a hand-written mini-tree would
 * drift from the thing being checked, and a check that passes on a fixture
 * nobody ships is not evidence about the template.
 */
export async function withFixture(mutate, manifest = cleanManifest()) {
  const dir = await mkdtemp(join(tmpdir(), 'gate-fixture-'));
  try {
    await cp(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
    // The gate also reads wrangler.toml, db/migrations (D1 migrations
    // check), astro.config.ts (internal-routes wiring) and public/_headers
    // (headers check); a fixture without them fails for the wrong reason.
    await cp(join(ROOT, 'wrangler.toml'), join(dir, 'wrangler.toml'));
    await cp(join(ROOT, 'db'), join(dir, 'db'), { recursive: true });
    await cp(join(ROOT, 'astro.config.ts'), join(dir, 'astro.config.ts'));
    await cp(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
    await mkdir(join(dir, 'dist'), { recursive: true });
    const manifestPath = join(dir, 'dist', 'gate-manifest.json');
    if (mutate) await mutate({ dir, manifest });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return runGate({ root: dir, manifest: manifestPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Runs the gate in source-only mode and returns its results as data. */
export function runGate({ root, manifest }) {
  const proc = spawnSync(
    process.execPath,
    [GATE, '--source-only', '--json', `--root=${root}`, `--manifest=${manifest}`],
    { encoding: 'utf8' },
  );
  let parsed;
  try {
    parsed = JSON.parse(proc.stdout.trim().split('\n').pop() ?? '{}');
  } catch {
    parsed = { crashed: true, reason: `unparseable output: ${proc.stdout}${proc.stderr}`, results: [] };
  }
  return { code: proc.status, ...parsed };
}

/* ------------------------------------------------------------------ */
/* Assertions                                                          */
/* ------------------------------------------------------------------ */

const find = (run, check) => run.results?.find((r) => r.check === check);

export function assertFails(run, check) {
  if (run.crashed) throw new Error(`gate crashed instead of failing: ${run.reason}`);
  const hit = find(run, check);
  if (!hit) throw new Error(`check "${check}" did not run at all`);
  if (hit.level !== 'FAIL') throw new Error(`check "${check}" reported ${hit.level}, expected FAIL`);
  if (run.code === 0) throw new Error(`check "${check}" failed but the gate still exited 0`);
}

export function assertPasses(run, check) {
  if (run.crashed) throw new Error(`gate crashed: ${run.reason}`);
  const hit = find(run, check);
  if (!hit) throw new Error(`check "${check}" did not run at all`);
  if (hit.level === 'FAIL') throw new Error(`check "${check}" failed on a clean fixture: ${hit.detail}`);
}

/* ------------------------------------------------------------------ */
/* Runner                                                             */
/* ------------------------------------------------------------------ */

const cases = [];
export const test = (name, fn) => cases.push({ name, fn });
/**
 * A check with no test yet. Listed rather than omitted: an untested check is
 * a known hole, and a hole nobody can see is the thing this file exists to
 * prevent. Batch 3 empties this list.
 */
export const pending = (name, why) => cases.push({ name, why });

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

/**
 * A monthly payment with no financing block behind it. The defect is in the
 * config, not the source, so the fixture only swaps the manifest.
 */
test('FAILS when a monthly payment is shown with no financing block', async () => {
  const run = await withFixture(null, cleanManifest({ financingEnabled: false, display: { showPrice: true, showMonthly: true } }));
  assertFails(run, 'Monthly payments require financing terms');
});

test('PASSES when the monthly payment is shown and financing is configured', async () => {
  const run = await withFixture(null, cleanManifest({ financingEnabled: true, display: { showPrice: true, showMonthly: true } }));
  assertPasses(run, 'Monthly payments require financing terms');
});

test('PASSES when there is no financing block and no monthly payment', async () => {
  const run = await withFixture(null);
  assertPasses(run, 'Monthly payments require financing terms');
});

/**
 * An ungated link to a page that only exists for some clients. The defect is
 * in source, so the fixture mutates the copied tree rather than the manifest.
 */
test('FAILS when a component links to /financing without checking site.financing', async () => {
  const run = await withFixture(async ({ dir }) => {
    const file = join(dir, 'src', 'components', 'Footer.astro');
    const body = await readFile(file, 'utf8');
    await writeFile(file, `${body}\n<a href="/financing">Apply For Financing</a>\n`);
  });
  assertFails(run, 'Financing link is gated on the financing block');
});

test('PASSES on the template as it stands', async () => {
  const run = await withFixture(null);
  assertPasses(run, 'Financing link is gated on the financing block');
});

/**
 * A surface formatting its own price. The rule it skips — sold units quote
 * nothing — is invisible at the call site, which is exactly why the call
 * site is not allowed to exist.
 */
test('FAILS when a component formats its own price', async () => {
  const run = await withFixture(async ({ dir }) => {
    const file = join(dir, 'src', 'components', 'ProductCard.astro');
    const body = await readFile(file, 'utf8');
    await writeFile(file, body.replace('pricingFor(product)', 'formatPrice(product.price)'));
  });
  assertFails(run, 'Prices go through pricingFor()');
});

test('PASSES when every price goes through pricingFor()', async () => {
  const run = await withFixture(null);
  assertPasses(run, 'Prices go through pricingFor()');
});

/**
 * The original defect, restored: publish any positive price, regardless of
 * whether the page will show one.
 */
test('FAILS when structured data publishes a price on its own terms', async () => {
  const run = await withFixture(async ({ dir }) => {
    const file = join(dir, 'src', 'lib', 'seo.ts');
    const body = await readFile(file, 'utf8');
    const broken = body.replace(
      'if (pricingFor(product).cash !== null) offer.price = product.price;',
      'if (product.price > 0) offer.price = product.price;',
    );
    if (broken === body) throw new Error('fixture did not reintroduce the defect');
    await writeFile(file, broken.replace("import { pricingFor } from './format';", ''));
  });
  assertFails(run, 'Structured data prices go through pricingFor()');
});

test('PASSES when the Offer takes its price from pricingFor()', async () => {
  const run = await withFixture(null);
  assertPasses(run, 'Structured data prices go through pricingFor()');
});

/**
 * These fixtures REPLACE the copied tree instead of mutating it.
 *
 * Every other test here mutates real src/ because the defect it restores is
 * the only one of its kind in the tree. This check is different: src/ still
 * holds ~55 colour literals until Batch 1 finishes, so against the real tree
 * assertFails would succeed with the mutation removed — and a test that
 * passes without its own defect is not a test. The mutate callback runs after
 * the copy and before the gate, so it can put a synthetic tree there instead.
 *
 * Other source checks see a one-file tree and find nothing to report, so the
 * colour check is the only thing that can fail here. When the sweep lands,
 * the clean-tree half of the pair joins them: assertPasses(withFixture(null)).
 */
const COLOUR = 'No brand colour literals outside src/config';
const onlyStyles = (css) => async ({ dir }) => {
  await rm(join(dir, 'src'), { recursive: true, force: true });
  await mkdir(join(dir, 'src', 'styles'), { recursive: true });
  await writeFile(join(dir, 'src', 'styles', 'theme.css'), css);
};

test('FAILS on a 3-digit hex', async () => {
  assertFails(await withFixture(onlyStyles('.a{color:#fff}')), COLOUR);
});

/**
 * The alpha variant a client would reach for. Invisible to the old regex:
 * \b never fires after "#e8a400" when the next character is "8".
 */
test('FAILS on an 8-digit hex', async () => {
  assertFails(await withFixture(onlyStyles('.a{color:#e8a40080}')), COLOUR);
});

test('FAILS on a numeric rgb()', async () => {
  assertFails(await withFixture(onlyStyles('.a{border-color:rgb(255 255 255 / .3)}')), COLOUR);
});

test('FAILS on a numeric rgba()', async () => {
  assertFails(await withFixture(onlyStyles('.a{box-shadow:0 0 4px rgba(0, 0, 0, .35)}')), COLOUR);
});

/** Zero hsl() in the tree today. The check is silent the day someone writes one. */
test('FAILS on a numeric hsl()', async () => {
  assertFails(await withFixture(onlyStyles('.a{color:hsl(210 88% 35%)}')), COLOUR);
});

/**
 * The false-positive guard. This is the form the whole template is being
 * moved TO; a check that flagged it would make the sweep impossible.
 */
test('PASSES on rgb(var(--brand-x-rgb) / a)', async () => {
  assertPasses(await withFixture(onlyStyles('.a{box-shadow:0 0 4px rgb(var(--brand-deep-rgb) / .5)}')), COLOUR);
});

test('PASSES on the two whitelisted material neutrals', async () => {
  assertPasses(await withFixture(onlyStyles('.a{background:linear-gradient(155deg,#eef2f8,#e2e9f4)}')), COLOUR);
});

/**
 * An <img> with no reserved space (C16 / E-01). The fixture strips width
 * from the header logo; the check must name the file.
 */
test('FAILS when an img loses its width attribute', async () => {
  const run = await withFixture(async ({ dir }) => {
    const file = join(dir, 'src', 'components', 'Header.astro');
    const body = await readFile(file, 'utf8');
    await writeFile(file, body.replace('width="165"', ''));
  });
  assertFails(run, 'Images declare width and height');
});

test('PASSES with every img dimensioned', async () => {
  assertPasses(await withFixture(null), 'Images declare width and height');
});

/**
 * The viewport lock coming back (C12 / G-10, N-05). The gate used to
 * REQUIRE user-scalable=no on landing pages; now any reappearance in src
 * is a failure the source check catches without a dev server.
 */
test('FAILS when a viewport lock reappears in src', async () => {
  const run = await withFixture(async ({ dir }) => {
    const file = join(dir, 'src', 'layouts', 'PaidLayout.astro');
    const body = await readFile(file, 'utf8');
    await writeFile(
      file,
      body.replace(
        'content="width=device-width, initial-scale=1, viewport-fit=cover"',
        'content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"',
      ),
    );
  });
  assertFails(run, 'No viewport lock in src');
});

test('PASSES with zoom allowed everywhere', async () => {
  assertPasses(await withFixture(null), 'No viewport lock in src');
});

/**
 * The wildcard client-hint delegation coming back (C11 / verification
 * defect #2). The fixture restores the shipped-wrong line; the check must
 * refuse all three regressions it guards.
 */
test('FAILS when a ch-ua hint is delegated to (*)', async () => {
  const run = await withFixture(async ({ dir }) => {
    const file = join(dir, 'public', '_headers');
    const body = await readFile(file, 'utf8');
    await writeFile(
      file,
      body.replace(/ch-ua-model=\([^)]*\)/, 'ch-ua-model=(*)'),
    );
  });
  assertFails(run, 'Headers file is intact');
});

test('FAILS when ch-ua-full-version-list disappears', async () => {
  const run = await withFixture(async ({ dir }) => {
    const file = join(dir, 'public', '_headers');
    const body = await readFile(file, 'utf8');
    await writeFile(file, body.replace('ch-ua-full-version-list=', 'ch-ua-full-version='));
  });
  assertFails(run, 'Headers file is intact');
});

test('PASSES on the shipped headers file', async () => {
  assertPasses(await withFixture(null), 'Headers file is intact');
});

/**
 * A re-listed internal route (C10 / L-01). The fixture empties
 * INTERNAL_ROUTES; the check must refuse — an unauthenticated diagnostic
 * page with no /proof entry is one sitemap regeneration from public.
 */
test('FAILS when INTERNAL_ROUTES no longer lists /proof', async () => {
  const run = await withFixture(async ({ dir }) => {
    await writeFile(
      join(dir, 'src', 'config', 'internal-routes.ts'),
      `export const INTERNAL_ROUTES = [] as const;\n`,
    );
  });
  assertFails(run, 'Internal routes are delisted');
});

test('PASSES with /proof listed and the sitemap filter wired', async () => {
  assertPasses(await withFixture(null), 'Internal routes are delisted');
});

/**
 * Operator diagnostics on a customer page (C9 / the H-area root cause).
 * The fixture adds a page interpolating operatorDetail; the check must
 * name it, and must NOT fire on proof.astro (the operator's own screen)
 * or on console.error lines.
 */
test('FAILS when a customer page renders operatorDetail', async () => {
  const run = await withFixture(async ({ dir }) => {
    await writeFile(
      join(dir, 'src', 'pages', 'broken-status.astro'),
      `---\nimport { getDb, inventoryStatus } from '../lib/db';\nconst dbStatus = inventoryStatus(getDb());\n---\n<p>{dbStatus.operatorDetail}</p>\n`,
    );
  });
  assertFails(run, 'No operator diagnostics in customer pages');
});

test('PASSES on the clean tree — proof.astro and console lines exempt', async () => {
  assertPasses(await withFixture(null), 'No operator diagnostics in customer pages');
});

/**
 * A schema change with no path to a live client DB (J-08). The fixture
 * removes db/migrations; the check must notice before the first client
 * database exists, not after.
 */
test('FAILS when db/migrations is missing', async () => {
  const run = await withFixture(async ({ dir }) => {
    await rm(join(dir, 'db', 'migrations'), { recursive: true, force: true });
  });
  assertFails(run, 'D1 migrations configured');
});

test('PASSES with the shipped 0001 baseline in place', async () => {
  assertPasses(await withFixture(null), 'D1 migrations configured');
});
pending('No category slugs hardcoded outside src/config', 'work order item 20');
pending('No /admin link in any component', 'work order item 20');
pending('Autocomplete on island form fields', 'work order item 17');
pending('No credentials committed in source', 'work order item 20');
pending('Config is in client mode', 'work order item 20');
pending('No placeholder facts', 'work order item 20');
pending('At least one category enabled', 'work order item 20');
pending('Opening hours set', 'work order item 20');
pending('One label per destination', 'work order item 20');
pending('No /admin link in rendered pages', 'work order items 12 + 16 — needs a built fixture');
pending('No relative asset paths', 'work order item 12 — needs a built fixture');
pending('No dead href="#"', 'work order item 12 — needs a built fixture');
pending('Every phone is a tel: link', 'work order items 9 + 10');
pending('Logo present, light and knockout', 'work order item 11');
pending('Mobile menu present and wired', 'work order item 12 — needs a built fixture');
pending('Complete LocalBusiness on every page', 'work order item 12 — needs a built fixture');
pending('Autocomplete on every PII field', 'work order item 17');
pending('Sitemap excludes admin and disabled categories', 'work order item 19');

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  console.log(`\n${C.bold}GATE TESTS THE GATE${C.off}\n`);

  let passed = 0;
  let failed = 0;
  let waiting = 0;

  for (const c of cases) {
    if (!c.fn) {
      waiting += 1;
      console.log(`  ${C.yellow}TODO${C.off}  ${c.name}  ${C.dim}${c.why}${C.off}`);
      continue;
    }
    try {
      await c.fn();
      passed += 1;
      console.log(`  ${C.green}PASS${C.off}  ${c.name}`);
    } catch (error) {
      failed += 1;
      console.log(`  ${C.red}FAIL${C.off}  ${c.name}\n        ${error.message}`);
    }
  }

  console.log(
    `\n  ${passed} passed · ${C.yellow}${waiting} untested${C.off} · ${failed ? C.red : ''}${failed} failed${C.off}\n`,
  );

  if (waiting) {
    console.log(
      `${C.dim}Untested checks are holes. Each one is a check that claims to catch a defect\n` +
        `and has never been watched to do it.${C.off}\n`,
    );
  }

  process.exit(failed ? 1 : 0);
}

// Only when run directly. The helpers above are importable so a fixture can
// be driven from a scratch script without the whole suite firing.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`\n${C.red}Harness crashed:${C.off}`, error);
    process.exit(1);
  });
}
