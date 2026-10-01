/**
 * @file Naming lint: makes sure the delivered project only uses the engine's own
 * neutral vocabulary for file formats and tools, and never refers to third-party
 * product names. Scans every text file of the project (except dependencies,
 * build output, the database and the private working notes) with a
 * case-insensitive pattern and exits with code 1 on any hit.
 *
 * The pattern is assembled from fragments so that this file does not match itself.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'data', 'uploads']);
const IGNORED_FILES = new Set(['prompt.md', 'step.txt', 'package-lock.json']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ogg', '.m4a', '.mp3', '.wav', '.db', '.ico', '.zip']);

const fragments = ['rpg ?mak' + 'er', 'rmm' + 'z', 'rmm' + 'v', '\\bm' + 'z\\b', '\\bm' + 'v\\b', 'enter' + 'brain', 'kado' + 'kawa', '\\br' + 'tp\\b'];
const FORBIDDEN = new RegExp(fragments.join('|'), 'i');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (!IGNORED_DIRS.has(entry)) yield* walk(full);
    } else if (!IGNORED_FILES.has(entry) && !BINARY_EXT.has(extname(entry).toLowerCase())) {
      yield full;
    }
  }
}

const hits: string[] = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  // File and folder names are checked too, not only contents.
  if (FORBIDDEN.test(rel)) hits.push(`${rel}: forbidden name in path`);
  // Build output is generated from sources that are already checked; skip source maps' embedded copies.
  if (rel.startsWith('public/build/')) continue;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const match = FORBIDDEN.exec(line);
    if (match) hits.push(`${rel}:${i + 1}: "${match[0]}"`);
  });
}

if (hits.length > 0) {
  console.error(`lint:names - ${hits.length} forbidden mention(s):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log('lint:names - OK');
