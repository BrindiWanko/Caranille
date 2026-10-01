/**
 * @file Repository of the `resources` table: the manifest of every graphic and
 * sound known to the game. Files stay on disk; rows hold their metadata.
 */
import type { Statement } from 'better-sqlite3';
import type { Db } from './database.js';

/** One manifest entry, as sent to the client and the editor. */
export interface Resource {
  id: string;
  kind: string;
  name: string;
  /** URL path under which the file is served (e.g. `/img/tilesets/Outside_A2.svg`). */
  url: string;
  format: string;
  mime: string;
  width: number | null;
  height: number | null;
  hash: string;
  origin: 'generated' | 'uploaded' | 'imported';
}

interface ResourceRow {
  id: string;
  kind: string;
  name: string;
  path: string;
  format: string;
  mime: string;
  width: number | null;
  height: number | null;
  hash: string;
  origin: Resource['origin'];
}

/** A resource found on disk, before being stored. */
export interface ScannedResource extends Omit<ResourceRow, 'origin'> {
  origin: Resource['origin'];
}

/** Data access for the resource manifest. */
export class ResourceRepository {
  private readonly allStmt: Statement<[], ResourceRow>;
  private readonly upsertStmt: Statement<[string, string, string, string, string, string, number | null, number | null, string, string]>;
  private readonly deleteStmt: Statement<[string]>;

  constructor(private readonly db: Db) {
    this.allStmt = db.prepare('SELECT id, kind, name, path, format, mime, width, height, hash, origin FROM resources ORDER BY kind, name');
    this.upsertStmt = db.prepare(`INSERT INTO resources (id, kind, name, path, format, mime, width, height, hash, origin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, path = excluded.path,
        format = excluded.format, mime = excluded.mime, width = excluded.width, height = excluded.height,
        hash = excluded.hash, origin = excluded.origin`);
    this.deleteStmt = db.prepare('DELETE FROM resources WHERE id = ?');
  }

  /** Every resource, ordered by kind then name. */
  all(): Resource[] {
    return this.allStmt.all().map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      url: `/${row.path.replace(/^assets\//, '')}`,
      format: row.format,
      mime: row.mime,
      width: row.width,
      height: row.height,
      hash: row.hash,
      origin: row.origin,
    }));
  }

  /**
   * Replaces the manifest content with what was found on disk, in one transaction:
   * new files are added, changed ones updated, missing ones removed.
   * @param scanned - Resources currently present on disk.
   * @returns Counts of changes.
   */
  sync(scanned: readonly ScannedResource[]): { added: number; removed: number; total: number } {
    return this.db.transaction(() => {
      const existing = new Set(this.allStmt.all().map((r) => r.id));
      let added = 0;
      for (const r of scanned) {
        if (!existing.delete(r.id)) added++;
        this.upsertStmt.run(r.id, r.kind, r.name, r.path, r.format, r.mime, r.width, r.height, r.hash, r.origin);
      }
      for (const id of existing) this.deleteStmt.run(id);
      return { added, removed: existing.size, total: scanned.length };
    })();
  }
}
