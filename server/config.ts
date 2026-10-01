/**
 * @file Runtime configuration, read once from environment variables with safe
 * defaults for local development. Every other module imports `config` instead
 * of reading `process.env` directly, so all tunables are listed in one place.
 *
 * Environment variables:
 * - `PORT` (default 3000), `HOST` (default 0.0.0.0)
 * - `SESSION_SECRET` (when unset, a random per-install secret is generated and
 *   stored in the database, so sessions survive restarts)
 * - `DB_PATH` (default `data/game.db`)
 * - `NODE_ENV` (`production` enables secure cookies and disables dev helpers)
 * - `TRUST_PROXY` (set to `1` behind a reverse proxy)
 * - `MAX_CHARACTERS` (characters per account, default 4)
 * - `CARANILLE_DEV` (set to `1` by `npm run dev`)
 * - `BACKUP_HOURS` (automatic backups interval, default 6, 0 = off),
 *   `BACKUP_KEEP` (backups kept, default 10)
 */
import { fromRoot } from './paths.js';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`Environment variable ${name} must be an integer (got "${raw}")`);
  return value;
}

/** Immutable server configuration. */
export const config = Object.freeze({
  port: intFromEnv('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  production: process.env.NODE_ENV === 'production',
  /** Set by `npm run dev`: enables hot-reload helpers (translation files...). */
  devReload: process.env.CARANILLE_DEV === '1',
  /** Explicit session secret; when `undefined` a persisted random one is used. */
  sessionSecret: process.env.SESSION_SECRET || undefined,
  dbPath: fromRoot(process.env.DB_PATH ?? 'data/game.db'),
  trustProxy: process.env.TRUST_PROXY === '1',
  maxCharactersPerAccount: intFromEnv('MAX_CHARACTERS', 4),
  backupHours: intFromEnv('BACKUP_HOURS', 6),
  backupKeep: intFromEnv('BACKUP_KEEP', 10),
  /** Session lifetime in milliseconds (30 days). */
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
});

/** Type of the configuration object. */
export type Config = typeof config;
