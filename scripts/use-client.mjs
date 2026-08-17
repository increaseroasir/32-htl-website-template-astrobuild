#!/usr/bin/env node
/**
 * npm run client:use <name>
 *
 * Copies clients/<name>.config.ts over src/config/client.config.ts, which is
 * the single file the whole site reads from.
 *
 * This is the entire "make a site for a different client" operation. No
 * component, page, layout, stylesheet or API route changes.
 *
 * The existing config is backed up first, because overwriting the one source
 * of truth without a copy would be a bad afternoon.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientsDir = join(root, 'clients');
const target = join(root, 'src', 'config', 'client.config.ts');

const name = process.argv[2];

function listClients() {
  return readdirSync(clientsDir)
    .filter((f) => f.endsWith('.config.ts'))
    .map((f) => f.replace(/\.config\.ts$/, ''));
}

if (!name) {
  console.error('\nUsage: npm run client:use <name>\n');
  console.error('Available client configs:');
  for (const c of listClients()) console.error(`  • ${c}`);
  console.error('');
  process.exit(1);
}

const source = join(clientsDir, `${name}.config.ts`);
if (!existsSync(source)) {
  console.error(`\nNo config found at clients/${name}.config.ts`);
  console.error('Available:', listClients().join(', ') || '(none)');
  console.error('');
  process.exit(1);
}

// Back up whatever is currently active.
if (existsSync(target)) {
  const backup = join(clientsDir, '_previous.config.ts.bak');
  copyFileSync(target, backup);
  console.log(`Backed up current config → clients/_previous.config.ts.bak`);
}

// clients/*.ts import the schema via '../src/config/schema'; once the file
// lives in src/config/ that path becomes './schema'.
const contents = readFileSync(source, 'utf8').replace(
  /from ['"]\.\.\/src\/config\/schema['"]/g,
  "from './schema'",
);

writeFileSync(target, contents, 'utf8');

console.log(`\nActive client config is now: ${name}`);
console.log('  src/config/client.config.ts  ← clients/' + name + '.config.ts');

/**
 * The homepage is a SECOND config file — a list of sections rather than a set
 * of facts. It is optional: a client without one gets the template's
 * placeholder homepage, which is honest rather than broken.
 *
 * It is separate from client.config.ts because it holds page CONTENT, not
 * facts. No fact appears in both — sections read the phone, address, hours
 * and category list from client.config at render time.
 */
const homepageSource = join(clientsDir, `${name}.homepage.ts`);
const homepageTarget = join(root, 'src', 'config', 'homepage.config.ts');

if (existsSync(homepageSource)) {
  if (existsSync(homepageTarget)) {
    copyFileSync(homepageTarget, join(clientsDir, '_previous.homepage.ts.bak'));
  }
  const hp = readFileSync(homepageSource, 'utf8').replace(
    /from ['"]\.\.\/src\/config\/homepage\.schema['"]/g,
    "from './homepage.schema'",
  );
  writeFileSync(homepageTarget, hp, 'utf8');
  console.log('  src/config/homepage.config.ts ← clients/' + name + '.homepage.ts');
} else {
  console.log(`  (no clients/${name}.homepage.ts — keeping the current homepage config)`);
}

console.log('\nRun `npm run build` — both configs are validated as the build starts.\n');
