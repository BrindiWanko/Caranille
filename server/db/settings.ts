/**
 * @file Repository for engine-wide settings (`system_settings`) and server secrets.
 *
 * Settings are stored as JSON values under string keys. The set of known keys and
 * their default values is defined in `shared/settings.ts`; unknown keys are allowed
 * so that later features can add settings without a migration.
 */
import { randomBytes } from 'node:crypto';
import type { Statement } from 'better-sqlite3';
import type { Db } from './database.js';

/** Typed access to `system_settings` and `server_secrets`. */
export class SettingsRepository {
  private readonly getStmt: Statement<[string], string>;
  private readonly setStmt: Statement<[string, string]>;
  private readonly allStmt: Statement<[], { key: string; value: string }>;
  private readonly getSecretStmt: Statement<[string], string>;
  private readonly insertSecretStmt: Statement<[string, string]>;

  constructor(db: Db) {
    this.getStmt = db.prepare<[string], string>('SELECT value FROM system_settings WHERE key = ?').pluck();
    this.setStmt = db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
    this.allStmt = db.prepare('SELECT key, value FROM system_settings');
    this.getSecretStmt = db.prepare<[string], string>('SELECT value FROM server_secrets WHERE name = ?').pluck();
    this.insertSecretStmt = db.prepare('INSERT OR IGNORE INTO server_secrets (name, value) VALUES (?, ?)');
  }

  /**
   * Reads a setting.
   * @param key - Setting key.
   * @param fallback - Value returned when the key is absent.
   */
  get<T>(key: string, fallback: T): T {
    const raw = this.getStmt.get(key);
    return raw === undefined ? fallback : (JSON.parse(raw) as T);
  }

  /**
   * Writes (inserts or replaces) a setting.
   * @param key - Setting key.
   * @param value - Any JSON-serializable value.
   */
  set(key: string, value: unknown): void {
    this.setStmt.run(key, JSON.stringify(value));
  }

  /** Tells whether a setting exists. */
  has(key: string): boolean {
    return this.getStmt.get(key) !== undefined;
  }

  /** Returns every setting as a plain object. */
  all(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of this.allStmt.all()) out[row.key] = JSON.parse(row.value);
    return out;
  }

  /**
   * Returns a persisted secret, generating a random one on first use.
   * `INSERT OR IGNORE` followed by a read makes this safe even if two
   * processes race on first boot: both end up with the same stored value.
   * @param name - Secret name.
   */
  secret(name: string): string {
    this.insertSecretStmt.run(name, randomBytes(48).toString('base64url'));
    return this.getSecretStmt.get(name)!;
  }
}
