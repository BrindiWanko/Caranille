/**
 * @file Translation consistency check: every locale file in `locales/` must
 * define exactly the same set of keys as `en.json` (the reference locale), and
 * every value must be a non-empty string. Exits with code 1 on any mismatch.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = fileURLToPath(new URL('../locales', import.meta.url));
const REFERENCE = 'en.json';

type Tree = { [key: string]: string | Tree };

/** Flattens a nested dictionary into dotted keys, reporting non-string leaves. */
function flatten(tree: Tree, prefix: string, out: Map<string, unknown>): void {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, full, out);
    else out.set(full, value);
  }
}

function load(file: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  flatten(JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as Tree, '', out);
  return out;
}

const errors: string[] = [];
const reference = load(REFERENCE);
for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'))) {
  const keys = load(file);
  for (const [key, value] of keys) {
    if (typeof value !== 'string' || value.trim() === '') errors.push(`${file}: "${key}" must be a non-empty string`);
    if (!reference.has(key)) errors.push(`${file}: extra key "${key}" (absent from ${REFERENCE})`);
  }
  for (const key of reference.keys()) {
    if (!keys.has(key)) errors.push(`${file}: missing key "${key}"`);
  }
}

if (errors.length > 0) {
  console.error(`i18n:check - ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n:check - OK (${reference.size} keys)`);
