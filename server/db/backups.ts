/**
 * @file Automatic database backups: a consistent copy (SQLite online backup)
 * is written to `data/backups/` at a fixed interval, and only the most recent
 * copies are kept.
 */
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './database.js';

/** Backup files written by this module. */
const BACKUP_FILE = /^caranille-\d{8}-\d{6}\.db$/;

/**
 * Writes one backup now and deletes the oldest ones beyond `keep`.
 * @returns The path of the new backup.
 */
export async function backupNow(db: Db, dir: string, keep: number, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = join(dir, `caranille-${stamp}.db`);
  await db.backup(file);
  const files = readdirSync(dir).filter((f) => BACKUP_FILE.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(dir, old));
  return file;
}

/**
 * Starts periodic backups.
 * @param hours - Interval (0 disables backups).
 * @returns A function stopping them.
 */
export function scheduleBackups(db: Db, dir: string, hours: number, keep: number): () => void {
  if (hours <= 0) return () => undefined;
  const timer = setInterval(() => {
    backupNow(db, dir, keep).catch((err: unknown) => console.error('[caranille] automatic backup failed', err));
  }, hours * 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
