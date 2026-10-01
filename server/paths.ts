/**
 * @file Resolves the project root directory and well-known sub-directories.
 *
 * The server runs either from sources (`server/*.ts` through tsx) or from the
 * compiled output (`dist/server/*.js`). Rather than relying on the current
 * working directory, we walk up from this module until we find `package.json`,
 * so that data, views, locales and assets are always found.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findProjectRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate project root (package.json not found)');
    dir = parent;
  }
}

/** Absolute path of the project root (the folder containing `package.json`). */
export const ROOT_DIR = findProjectRoot(dirname(fileURLToPath(import.meta.url)));

/** Well-known project directories, all absolute. */
export const PATHS = {
  root: ROOT_DIR,
  views: join(ROOT_DIR, 'views'),
  locales: join(ROOT_DIR, 'locales'),
  public: join(ROOT_DIR, 'public'),
  assets: join(ROOT_DIR, 'assets'),
  audio: join(ROOT_DIR, 'audio'),
  uploads: join(ROOT_DIR, 'uploads'),
  migrations: join(ROOT_DIR, 'server', 'db', 'migrations'),
  data: join(ROOT_DIR, 'data'),
} as const;

/**
 * Resolves a path relative to the project root unless it is already absolute.
 * @param p - Relative or absolute path.
 */
export function fromRoot(p: string): string {
  return resolve(ROOT_DIR, p);
}
