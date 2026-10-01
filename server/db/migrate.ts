/**
 * @file Versioned schema migrations.
 *
 * Migrations are plain SQL files in `server/db/migrations/`, named
 * `NNN_description.sql`. They are applied in numeric order at startup, each in
 * its own transaction, and recorded in the `schema_migrations` table so that a
 * migration never runs twice. Applied migrations must never be edited: add a
 * new file instead.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './database.js';

/** Description of a migration file found on disk. */
export interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

const MIGRATION_NAME = /^(\d{3,})_([a-z0-9_]+)\.sql$/;

/**
 * Lists migration files of a directory, sorted by version.
 * @param dir - Directory containing `NNN_name.sql` files.
 * @throws If two files share the same version number.
 */
export function listMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir)
    .map((file) => {
      const match = MIGRATION_NAME.exec(file);
      return match ? { version: Number(match[1]), name: match[2]!, path: join(dir, file) } : null;
    })
    .filter((m): m is MigrationFile => m !== null)
    .sort((a, b) => a.version - b.version);
  for (let i = 1; i < files.length; i++) {
    if (files[i]!.version === files[i - 1]!.version) {
      throw new Error(`Duplicate migration version ${files[i]!.version}`);
    }
  }
  return files;
}

/**
 * Applies every pending migration.
 * @param db - Open connection.
 * @param dir - Migrations directory.
 * @returns The versions that were applied during this call.
 */
export function migrate(db: Db, dir: string): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all() as number[]);
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
  const done: number[] = [];
  for (const migration of listMigrations(dir)) {
    if (applied.has(migration.version)) continue;
    const sql = readFileSync(migration.path, 'utf8');
    // Schema change and bookkeeping row are committed together, or not at all.
    db.transaction(() => {
      db.exec(sql);
      record.run(migration.version, migration.name);
    })();
    done.push(migration.version);
  }
  return done;
}
