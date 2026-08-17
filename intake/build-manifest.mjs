#!/usr/bin/env node
/**
 * FIELD MANIFEST BUILDER  —  intake layer, Phase A.
 *
 * Reads the template's REAL Zod schema (src/config/schema.ts) and walks it to
 * produce intake/field-manifest.json: every leaf field, its type, whether it is
 * required / nullable / defaulted, and every constraint the schema enforces
 * (regex, min, max, enum members, string format).
 *
 * WHY THIS EXISTS
 * ---------------
 * The intake form and the generator both need to know what fields exist. If
 * either of them keeps its own hand-typed list, that list is a SECOND COPY of
 * the schema — and second copies drift. That is the exact defect class this
 * whole template was built to kill. So nothing here is typed by hand: the list
 * is derived from the schema at build time.
 *
 * THE ANTI-DRIFT LOCK
 * -------------------
 * Field *policy* (do we ASK the client for this, DEFAULT it, or DERIVE it?) is
 * not a schema concept, so it lives in policy/field-policy.mjs. This builder
 * cross-checks the two and EXITS 1 if they disagree:
 *
 *   - a schema field with no policy entry  → someone added a config field and
 *     did not decide whether the form should ask for it
 *   - a policy entry with no schema field  → someone removed or renamed a
 *     config field and the intake layer still thinks it exists
 *
 * So a change to the template's schema cannot silently pass through the intake
 * layer. It fails loudly, here, before any form or generator runs.
 *
 * READ-ONLY: this script never writes anywhere except intake/.
 *
 * Usage:
 *   node intake/build-manifest.mjs           # write field-manifest.json
 *   node intake/build-manifest.mjs --check   # verify it is up to date, write nothing
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTemplateSchema } from './lib/load-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'field-manifest.json');

const CHECK_ONLY = process.argv.includes('--check');

/* ------------------------------------------------------------------ */
/* 2. Walk the Zod tree                                                */
/* ------------------------------------------------------------------ */

const def = (s) => s?._zod?.def;

/** Peel default / nullable / optional wrappers, recording what we peeled. */
function unwrap(schema) {
  const flags = { optional: false, nullable: false, hasDefault: false, defaultValue: undefined };
  let cur = schema;
  for (let i = 0; i < 12; i++) {
    const d = def(cur);
    if (!d) break;
    if (d.type === 'default' || d.type === 'prefault') {
      flags.hasDefault = true;
      flags.defaultValue = typeof d.defaultValue === 'function' ? d.defaultValue() : d.defaultValue;
      cur = d.innerType;
    } else if (d.type === 'nullable') {
      flags.nullable = true;
      cur = d.innerType;
    } else if (d.type === 'optional') {
      flags.optional = true;
      cur = d.innerType;
    } else if (d.type === 'pipe') {
      // A `.transform()` (theme → resolved colours). The INTAKE asks for the
      // input shape, so walk the `in` side; the output is derived.
      cur = d.in;
    } else break;
  }
  return { schema: cur, flags };
}

/** Turn Zod's internal checks into something a form builder can use. */
function readConstraints(schema) {
  const d = def(schema);
  const out = {};
  if (!d) return out;
  if (d.format) out.format = d.format; // 'email' | 'url' | ...
  if (d.pattern instanceof RegExp) out.pattern = d.pattern.source;
  if (Array.isArray(d.entries)) out.enum = d.entries;
  if (d.entries && !Array.isArray(d.entries) && d.type === 'enum') out.enum = Object.values(d.entries);
  if (d.values instanceof Set) out.enum = [...d.values];

  for (const check of d.checks ?? []) {
    const c = check?._zod?.def;
    if (!c) continue;
    switch (c.check) {
      case 'greater_than':
        out.min = c.value;
        break;
      case 'less_than':
        out.max = c.value;
        break;
      case 'min_length':
        out.minLength = c.minimum;
        break;
      case 'max_length':
        out.maxLength = c.maximum;
        break;
      case 'length_equals':
        out.length = c.length;
        break;
      case 'string_format':
        if (c.pattern instanceof RegExp) out.pattern = c.pattern.source;
        if (c.format) out.format = c.format;
        if (c.prefix) out.startsWith = c.prefix;
        break;
      case 'number_format':
        if (c.format?.includes('int')) out.integer = true;
        break;
      default:
        // Custom .refine() checks carry no machine-readable rule. The message
        // is the only thing we can surface, and it is the thing a human needs.
        if (c.error && typeof c.error === 'string') {
          (out.rules ??= []).push(c.error);
        } else if (typeof c.error === 'function') {
          try {
            const msg = c.error({});
            if (typeof msg === 'string') (out.rules ??= []).push(msg);
          } catch {
            /* message factory needs a real issue — skip it */
          }
        }
    }
  }
  return out;
}

const fields = [];

function walk(schema, path) {
  const { schema: inner, flags } = unwrap(schema);
  const d = def(inner);
  const kind = d?.type;

  if (kind === 'object') {
    for (const [key, child] of Object.entries(inner.shape)) {
      walk(child, path ? `${path}.${key}` : key);
    }
    return;
  }

  if (kind === 'array') {
    // Arrays of objects: describe the element's fields under `path[]`.
    const el = unwrap(d.element).schema;
    if (def(el)?.type === 'object') {
      record(path, 'array<object>', flags, readConstraints(inner));
      walk(d.element, `${path}[]`);
      return;
    }
    if (def(el)?.type === 'union') {
      // nav.items — a discriminated union. Not a form field; the generator
      // composes it. Recorded as composite so policy must acknowledge it.
      record(path, 'array<union>', flags, {
        ...readConstraints(inner),
        variants: def(el).options.map((o) => {
          const t = unwrap(def(o).shape.type).schema;
          return def(t)?.values ? [...def(t).values][0] : 'unknown';
        }),
      });
      return;
    }
    record(path, `array<${def(el)?.type ?? 'unknown'}>`, flags, {
      ...readConstraints(inner),
      element: readConstraints(el),
    });
    return;
  }

  if (kind === 'record') {
    // categories — partialRecord(enum, override). Composite: the form drives
    // it with checkboxes, the generator assembles the map.
    const keySchema = unwrap(d.keyType).schema;
    record(path, 'record', flags, { keys: readConstraints(keySchema).enum ?? [] });
    walk(d.valueType, `${path}{}`);
    return;
  }

  record(path, kind ?? 'unknown', flags, readConstraints(inner));
}

function record(path, type, flags, constraints) {
  fields.push({
    path,
    type,
    required: !flags.optional && !flags.hasDefault,
    nullable: flags.nullable,
    ...(flags.hasDefault ? { default: flags.defaultValue } : {}),
    ...(Object.keys(constraints).length ? { constraints } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* 3. Build, join with policy, verify                                  */
/* ------------------------------------------------------------------ */

const { clientConfigSchema } = await loadTemplateSchema();
const { FIELD_POLICY, DERIVED_NEVER_ASK, GROUPS } = await import('./policy/field-policy.mjs');

walk(clientConfigSchema, '');

const schemaPaths = new Set(fields.map((f) => f.path));
const policyPaths = new Set(Object.keys(FIELD_POLICY));

const missingPolicy = [...schemaPaths].filter((p) => !policyPaths.has(p));
const stalePolicy = [...policyPaths].filter((p) => !schemaPaths.has(p));

if (missingPolicy.length || stalePolicy.length) {
  console.error('\n  MANIFEST OUT OF SYNC WITH THE TEMPLATE SCHEMA\n');
  if (missingPolicy.length) {
    console.error('  Schema fields with no intake policy (add them to policy/field-policy.mjs):');
    for (const p of missingPolicy) console.error(`    + ${p}`);
  }
  if (stalePolicy.length) {
    console.error('\n  Policy entries for fields the schema no longer has (delete them):');
    for (const p of stalePolicy) console.error(`    - ${p}`);
  }
  console.error('\n  The intake layer refuses to build a stale field list.\n');
  process.exit(1);
}

const merged = fields.map((f) => {
  const p = FIELD_POLICY[f.path];
  return {
    ...f,
    source: p.source, // 'ask' | 'default' | 'derive-from-address' | 'fixed'
    group: p.group,
    ...(p.label ? { label: p.label } : {}),
    ...(p.help ? { help: p.help } : {}),
    ...(p.control ? { control: p.control } : {}),
    ...(p.example !== undefined ? { example: p.example } : {}),
  };
});

const manifest = {
  $comment:
    'GENERATED FILE — do not edit. Produced by intake/build-manifest.mjs from src/config/schema.ts. Run `node intake/build-manifest.mjs` after any schema change.',
  generatedFrom: 'src/config/schema.ts',
  manifestVersion: 1,
  groups: GROUPS,
  counts: {
    total: merged.length,
    ask: merged.filter((f) => f.source === 'ask').length,
    default: merged.filter((f) => f.source === 'default').length,
    fixed: merged.filter((f) => f.source === 'fixed').length,
    composed: merged.filter((f) => f.source === 'composed').length,
  },
  neverAsk: DERIVED_NEVER_ASK,
  fields: merged,
};

const json = JSON.stringify(manifest, null, 2) + '\n';

if (CHECK_ONLY) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== json) {
    console.error('field-manifest.json is stale. Run: node intake/build-manifest.mjs');
    process.exit(1);
  }
  console.log(`field-manifest.json is up to date (${merged.length} fields).`);
  process.exit(0);
}

writeFileSync(OUT, json);
console.log(`Wrote intake/field-manifest.json — ${merged.length} fields`);
console.log(
  `  ask ${manifest.counts.ask}   default ${manifest.counts.default}   ` +
    `fixed ${manifest.counts.fixed}   composed ${manifest.counts.composed}`,
);
