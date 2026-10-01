/**
 * @file Repository of the `maps` table (map tree and map content).
 *
 * Map content is parsed once and cached; the editor's saves go through
 * `save()`, which refreshes the cache so that the live world picks up the new
 * version immediately.
 */
import type { Statement } from 'better-sqlite3';
import type { MapData, MapInfo } from '../../shared/map.js';
import type { Db } from './database.js';

/** A saved snapshot of a map. */
export interface MapVersion {
  id: number;
  mapId: number;
  accountId: number | null;
  createdAt: string;
}

/** Snapshots kept per map; older ones are pruned. */
export const MAX_VERSIONS_PER_MAP = 50;

interface MapInfoRow {
  id: number;
  parent_id: number;
  name: string;
  sort_order: number;
  expanded: number;
}

/** Data access for maps. */
export class MapRepository {
  private readonly infosStmt: Statement<[], MapInfoRow>;
  private readonly dataStmt: Statement<[number], string>;
  private readonly upsertStmt: Statement<[number, number, string, number, number, string]>;
  private readonly countStmt: Statement<[], number>;
  private readonly maxIdStmt: Statement<[], number>;
  private readonly deleteStmt: Statement<[number]>;
  private readonly insertVersionStmt: Statement<[number, string, number | null]>;
  private readonly listVersionsStmt: Statement<[number], { id: number; map_id: number; account_id: number | null; created_at: string }>;
  private readonly versionDataStmt: Statement<[number, number], string>;
  private readonly pruneStmt: Statement<[number, number, number]>;
  private readonly deleteVersionsStmt: Statement<[number]>;
  private readonly cache = new Map<number, MapData>();

  constructor(private readonly db: Db) {
    this.infosStmt = db.prepare('SELECT id, parent_id, name, sort_order, expanded FROM maps ORDER BY parent_id, sort_order, id');
    this.dataStmt = db.prepare<[number], string>('SELECT data FROM maps WHERE id = ?').pluck();
    this.upsertStmt = db.prepare(`INSERT INTO maps (id, parent_id, name, sort_order, expanded, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, sort_order = excluded.sort_order,
        expanded = excluded.expanded, data = excluded.data, updated_at = datetime('now')`);
    this.countStmt = db.prepare<[], number>('SELECT COUNT(*) FROM maps').pluck();
    this.maxIdStmt = db.prepare<[], number>('SELECT COALESCE(MAX(id), 0) FROM maps').pluck();
    this.deleteStmt = db.prepare('DELETE FROM maps WHERE id = ?');
    this.insertVersionStmt = db.prepare('INSERT INTO map_versions (map_id, data, account_id) VALUES (?, ?, ?)');
    this.listVersionsStmt = db.prepare('SELECT id, map_id, account_id, created_at FROM map_versions WHERE map_id = ? ORDER BY id DESC');
    this.versionDataStmt = db.prepare<[number, number], string>('SELECT data FROM map_versions WHERE id = ? AND map_id = ?').pluck();
    // Keep the newest N snapshots of a map.
    this.pruneStmt = db.prepare(`DELETE FROM map_versions WHERE map_id = ? AND id NOT IN
      (SELECT id FROM map_versions WHERE map_id = ? ORDER BY id DESC LIMIT ?)`);
    this.deleteVersionsStmt = db.prepare('DELETE FROM map_versions WHERE map_id = ?');
  }

  /** Next free map id. */
  nextId(): number {
    return this.maxIdStmt.get()! + 1;
  }

  /**
   * Saves a map from the editor and records a snapshot in the history, in one transaction.
   * @param info - Tree entry.
   * @param data - Content.
   * @param accountId - Author of the change.
   */
  saveWithVersion(info: MapInfo, data: MapData, accountId: number | null): void {
    this.db.transaction(() => {
      this.save(info, data);
      this.insertVersionStmt.run(info.id, JSON.stringify(data), accountId);
      this.pruneStmt.run(info.id, info.id, MAX_VERSIONS_PER_MAP);
    })();
  }

  /** Deletes a map and its history. */
  delete(id: number): void {
    this.db.transaction(() => {
      this.deleteStmt.run(id);
      this.deleteVersionsStmt.run(id);
    })();
    this.cache.delete(id);
  }

  /** Snapshots of a map, newest first. */
  versions(mapId: number): MapVersion[] {
    return this.listVersionsStmt.all(mapId).map((r) => ({ id: r.id, mapId: r.map_id, accountId: r.account_id, createdAt: r.created_at }));
  }

  /** Content of a snapshot. */
  version(mapId: number, versionId: number): MapData | undefined {
    const raw = this.versionDataStmt.get(versionId, mapId);
    return raw === undefined ? undefined : (JSON.parse(raw) as MapData);
  }

  /** The map tree. */
  infos(): MapInfo[] {
    return this.infosStmt.all().map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      order: r.sort_order,
      expanded: r.expanded === 1,
    }));
  }

  /** Name of a map in the tree. */
  info(id: number): MapInfo | undefined {
    return this.infos().find((i) => i.id === id);
  }

  /** Content of a map, or `undefined`. */
  get(id: number): MapData | undefined {
    let map = this.cache.get(id);
    if (!map) {
      const raw = this.dataStmt.get(id);
      if (raw === undefined) return undefined;
      map = JSON.parse(raw) as MapData;
      this.cache.set(id, map);
    }
    return map;
  }

  /** Number of maps. */
  count(): number {
    return this.countStmt.get()!;
  }

  /**
   * Inserts or replaces a map.
   * @param info - Tree entry.
   * @param data - Content.
   */
  save(info: MapInfo, data: MapData): void {
    this.upsertStmt.run(info.id, info.parentId, info.name, info.order, info.expanded ? 1 : 0, JSON.stringify(data));
    this.cache.set(info.id, data);
  }
}
