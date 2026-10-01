/**
 * @file Opens the single SQLite database file used for all persistent game data.
 *
 * SQLite is the only storage engine of the game: accounts, characters, world
 * state and every piece of content authored in the editor live in one file
 * (`data/game.db` by default). This module owns the connection and applies the
 * pragmas every other module relies on (WAL, foreign keys...).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Connection type used across repositories. */
export type Db = Database.Database;

/**
 * Opens (and creates if needed) a SQLite database with the engine's standard pragmas.
 * @param file - Path of the database file, or `:memory:` for tests.
 * @returns A ready-to-use connection. Migrations are NOT applied here; see `migrate()`.
 */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL lets the game loop keep reading while a batch save is being written.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // NORMAL is durable enough with WAL (only the last transactions may be lost on power failure).
  db.pragma('synchronous = NORMAL');
  // Wait instead of failing immediately if a backup or another handle holds a lock.
  db.pragma('busy_timeout = 5000');
  return db;
}
