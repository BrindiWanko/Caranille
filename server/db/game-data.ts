/**
 * @file Repository of the `game_data` table: every record authored in the
 * editor's database tabs, stored as JSON and typed through `GameDataTypes`.
 *
 * A small in-memory cache avoids re-parsing JSON on hot paths (the game loop
 * reads classes and tilesets constantly); every write goes through this class
 * and invalidates the cache, so the editor's changes are visible immediately.
 */
import type { Statement } from 'better-sqlite3';
import { normalizeRecord } from '../../shared/database-schema.js';
import { DATABASE_TYPES, type DatabaseType, type GameDataType, type GameDataTypes } from '../../shared/database.js';
import type { Db } from './database.js';

/** Typed access to editor database records. */
export class GameDataRepository {
  private readonly listStmt: Statement<[string], { data: string }>;
  private readonly upsertStmt: Statement<[string, number, string, string]>;
  private readonly deleteStmt: Statement<[string, number]>;
  private readonly countStmt: Statement<[string], number>;
  private readonly cache = new Map<GameDataType, Map<number, unknown>>();

  constructor(private readonly db: Db) {
    this.listStmt = db.prepare('SELECT data FROM game_data WHERE type = ? ORDER BY id');
    this.upsertStmt = db.prepare(`INSERT INTO game_data (type, id, name, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(type, id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = datetime('now')`);
    this.deleteStmt = db.prepare('DELETE FROM game_data WHERE type = ? AND id = ?');
    this.countStmt = db.prepare<[string], number>('SELECT COUNT(*) FROM game_data WHERE type = ?').pluck();
  }

  private load<T extends GameDataType>(type: T): Map<number, GameDataTypes[T]> {
    let entries = this.cache.get(type) as Map<number, GameDataTypes[T]> | undefined;
    if (!entries) {
      entries = new Map();
      for (const row of this.listStmt.all(type)) {
        let record = JSON.parse(row.data) as GameDataTypes[T];
        // Records written by older versions are completed with the current schema's defaults.
        if ((DATABASE_TYPES as readonly string[]).includes(type)) {
          record = normalizeRecord(type as DatabaseType, record, record.id) as unknown as GameDataTypes[T];
        }
        entries.set(record.id, record);
      }
      this.cache.set(type, entries);
    }
    return entries;
  }

  /** All records of a type, ordered by id. */
  list<T extends GameDataType>(type: T): GameDataTypes[T][] {
    return [...this.load(type).values()];
  }

  /** One record, or `undefined`. */
  get<T extends GameDataType>(type: T, id: number): GameDataTypes[T] | undefined {
    return this.load(type).get(id);
  }

  /** Number of records of a type. */
  count(type: GameDataType): number {
    return this.countStmt.get(type)!;
  }

  /** Inserts or replaces a record. */
  save<T extends GameDataType>(type: T, record: GameDataTypes[T]): void {
    this.upsertStmt.run(type, record.id, record.name, JSON.stringify(record));
    this.cache.delete(type);
  }

  /** Next free id of a type. */
  nextId(type: GameDataType): number {
    return Math.max(0, ...this.load(type).keys()) + 1;
  }

  /**
   * Replaces every record of several types in one transaction (database import).
   * @param records - New records by type.
   */
  replaceAll(records: Partial<{ [T in GameDataType]: GameDataTypes[T][] }>): void {
    const clear = this.db.prepare('DELETE FROM game_data WHERE type = ?');
    this.db.transaction(() => {
      for (const [type, list] of Object.entries(records) as [GameDataType, { id: number; name: string }[]][]) {
        clear.run(type);
        for (const r of list) this.upsertStmt.run(type, r.id, r.name, JSON.stringify(r));
        this.cache.delete(type);
      }
    })();
  }

  /** Deletes a record. */
  remove(type: GameDataType, id: number): void {
    this.deleteStmt.run(type, id);
    this.cache.delete(type);
  }
}
