/**
 * @file Editor API of the game database (administrators only; mounted inside
 * the editor router, which already checks the role and the CSRF header).
 *
 * Every record is normalised with the shared schema before being stored, so
 * the game only ever reads complete, valid records. Changes are immediately
 * visible in game: the repository cache is refreshed on every write.
 *
 * Routes: list / create / save / delete records of a type, read and save the
 * System and Terms settings, export and import the whole database as JSON.
 */
import { Router, type Response } from 'express';
import { SchemaError, defaultRecord, normalizeRecord } from '../../shared/database-schema.js';
import { DATABASE_TYPES, PARAMS, type DatabaseType, type GameDataTypes } from '../../shared/database.js';
import { DEFAULT_SETTINGS, MAX_SWITCHES, SYSTEM_SETTING_KEYS, type DataName, type SystemSettings, type Terms } from '../../shared/settings.js';
import type { ServerContext } from '../context.js';

/** Version of the database export format. */
export const DATABASE_EXPORT_VERSION = 1;

const isType = (t: string): t is DatabaseType => (DATABASE_TYPES as readonly string[]).includes(t);

function fail(res: Response, status: number, error: string, params?: Record<string, string | number>): void {
  res.status(status).json({ error, params });
}

const text = (v: unknown, fallback: string, max = 100) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const int = (v: unknown, fallback: number, min: number, max: number) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : fallback);
const names = (v: unknown, fallback: string[]) =>
  Array.isArray(v) && v.length > 0 ? v.slice(0, 100).map((n, i) => text(n, fallback[i] ?? '', 40)) : fallback;

/** Switch / variable declarations: names trimmed, scope as a boolean, bounded count. */
function dataNames(v: unknown, fallback: DataName[]): DataName[] {
  if (!Array.isArray(v)) return fallback;
  return v.slice(0, MAX_SWITCHES).map((d) => {
    const entry = (typeof d === 'object' && d !== null ? d : {}) as Partial<DataName>;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : '';
    // A switch is personal, global or of an instance (instance wins over global).
    return entry.instance === true ? { name, global: false, instance: true } : { name, global: entry.global === true };
  });
}

/**
 * Validates the System / Terms settings sent by the editor.
 * @param raw - Untrusted values.
 * @param current - Current settings (fallbacks).
 */
export function normalizeSystem(raw: Record<string, unknown>, current: SystemSettings): Partial<SystemSettings> {
  const start = (raw.startPosition ?? {}) as Partial<SystemSettings['startPosition']>;
  const terms = (raw.terms ?? {}) as Partial<Terms>;
  const params = (terms.params ?? {}) as Partial<Terms['params']>;
  return {
    gameTitle: text(raw.gameTitle, current.gameTitle),
    startPosition: {
      mapId: int(start.mapId, current.startPosition.mapId, 1, 1_000_000),
      x: int(start.x, current.startPosition.x, 0, 255),
      y: int(start.y, current.startPosition.y, 0, 255),
      direction: ([2, 4, 6, 8] as const).includes(start.direction as 2) ? (start.direction as 2 | 4 | 6 | 8) : current.startPosition.direction,
    },
    currencyName: text(raw.currencyName, current.currencyName, 30),
    maxLevel: int(raw.maxLevel, current.maxLevel, 1, 999),
    maxPartySize: int(raw.maxPartySize, current.maxPartySize, 2, 40),
    maxRaidSize: int(raw.maxRaidSize, current.maxRaidSize, 2, 40),
    instanceIdleMinutes: int(raw.instanceIdleMinutes, current.instanceIdleMinutes, 1, 1440),
    guildCreationCost: int(raw.guildCreationCost, current.guildCreationCost, 0, 99_999_999),
    elements: names(raw.elements, current.elements),
    weaponTypes: names(raw.weaponTypes, current.weaponTypes),
    armorTypes: names(raw.armorTypes, current.armorTypes),
    startingGold: int(raw.startingGold, current.startingGold, 0, 99_999_999),
    statPointsPerLevel: int(raw.statPointsPerLevel, current.statPointsPerLevel, 0, 20),
    sellRate: int(raw.sellRate, current.sellRate, 0, 100),
    bagSize: int(raw.bagSize, current.bagSize, 10, 200),
    terms: {
      level: text(terms.level, current.terms.level, 30),
      hp: text(terms.hp, current.terms.hp, 30),
      mp: text(terms.mp, current.terms.mp, 30),
      xp: text(terms.xp, current.terms.xp, 30),
      params: Object.fromEntries(PARAMS.map((p) => [p, text(params[p], current.terms.params[p], 30)])) as Terms['params'],
    },
    switches: dataNames(raw.switches, current.switches),
    variables: dataNames(raw.variables, current.variables),
  };
}

/** Current System / Terms settings. */
export function readSystem(ctx: ServerContext): SystemSettings {
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const key of SYSTEM_SETTING_KEYS) out[key] = ctx.settings.get(key, DEFAULT_SETTINGS[key]);
  return out as unknown as SystemSettings;
}

/**
 * Creates the database router (mounted under `/api/editor`).
 * @param ctx - Server context.
 */
export function databaseRouter(ctx: ServerContext): Router {
  const router = Router();

  router.get('/db/:type', (req, res) => {
    const { type } = req.params;
    if (!isType(type)) {
      fail(res, 404, 'error.db.unknown_type');
      return;
    }
    res.json({ records: ctx.gameData.list(type) });
  });

  router.post('/db/:type', (req, res) => {
    const { type } = req.params;
    if (!isType(type)) {
      fail(res, 404, 'error.db.unknown_type');
      return;
    }
    const id = ctx.gameData.nextId(type);
    const body = req.body as { copyOf?: unknown };
    const source = Number.isInteger(body.copyOf) ? ctx.gameData.get(type, body.copyOf as number) : undefined;
    const record = source ? normalizeRecord(type, { ...source, name: `${source.name} (2)` }, id) : defaultRecord(type, id);
    if (!source) (record as { name: string }).name = `#${id}`;
    ctx.gameData.save(type, record as GameDataTypes[typeof type]);
    res.json({ record });
  });

  router.put('/db/:type/:id', (req, res) => {
    const { type } = req.params;
    const id = Number(req.params.id);
    if (!isType(type) || !Number.isInteger(id) || id < 1 || id > 9999) {
      fail(res, 400, 'error.db.unknown_type');
      return;
    }
    try {
      const record = normalizeRecord(type, (req.body as { record?: unknown }).record, id);
      ctx.gameData.save(type, record as GameDataTypes[typeof type]);
      res.json({ record });
    } catch (err) {
      if (err instanceof SchemaError) fail(res, 400, 'error.db.invalid_field', { field: err.path });
      else throw err;
    }
  });

  router.delete('/db/:type/:id', (req, res) => {
    const { type } = req.params;
    const id = Number(req.params.id);
    if (!isType(type)) {
      fail(res, 404, 'error.db.unknown_type');
      return;
    }
    if (type === 'class') {
      const used = ctx.db.prepare<[number], number>('SELECT COUNT(*) FROM characters WHERE class_id = ?').pluck().get(id) ?? 0;
      if (used > 0) {
        fail(res, 400, 'error.db.class_in_use', { count: used });
        return;
      }
      if (ctx.gameData.count('class') <= 1) {
        fail(res, 400, 'error.db.last_class');
        return;
      }
    }
    ctx.gameData.remove(type, id);
    res.json({ ok: true });
  });

  router.get('/system', (_req, res) => {
    res.json({ system: readSystem(ctx) });
  });

  router.put('/system', (req, res) => {
    const values = normalizeSystem((req.body as { system?: Record<string, unknown> }).system ?? {}, readSystem(ctx));
    ctx.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) ctx.settings.set(key, value);
    })();
    ctx.world.systemChanged();
    res.json({ system: readSystem(ctx) });
  });

  router.get('/db-export', (_req, res) => {
    const data = Object.fromEntries(DATABASE_TYPES.map((t) => [t, ctx.gameData.list(t)]));
    res.setHeader('Content-Disposition', 'attachment; filename="database.json"');
    res.json({ version: DATABASE_EXPORT_VERSION, database: data, system: readSystem(ctx) });
  });

  router.post('/db-import', (req, res) => {
    const body = req.body as { version?: unknown; database?: Record<string, unknown[]>; system?: Record<string, unknown> };
    if (body.version !== DATABASE_EXPORT_VERSION || typeof body.database !== 'object' || body.database === null) {
      fail(res, 400, 'error.db.invalid_export');
      return;
    }
    const records: Partial<{ [T in DatabaseType]: GameDataTypes[T][] }> = {};
    try {
      for (const type of DATABASE_TYPES) {
        const list = body.database[type];
        if (!Array.isArray(list)) continue;
        const seen = new Set<number>();
        const out: unknown[] = [];
        for (const raw of list) {
          const id = Number((raw as { id?: unknown })?.id);
          if (!Number.isInteger(id) || id < 1 || id > 9999 || seen.has(id)) throw new SchemaError(`${type}.id`);
          seen.add(id);
          out.push(normalizeRecord(type, raw, id));
        }
        (records as Record<string, unknown[]>)[type] = out;
      }
    } catch (err) {
      if (err instanceof SchemaError) {
        fail(res, 400, 'error.db.invalid_field', { field: err.path });
        return;
      }
      throw err;
    }
    if (records.class && records.class.length === 0) {
      fail(res, 400, 'error.db.last_class');
      return;
    }
    ctx.gameData.replaceAll(records);
    if (body.system) {
      const values = normalizeSystem(body.system, readSystem(ctx));
      for (const [key, value] of Object.entries(values)) ctx.settings.set(key, value);
    }
    ctx.world.systemChanged();
    res.json({ ok: true, counts: Object.fromEntries(Object.entries(records).map(([t, l]) => [t, (l as unknown[]).length])) });
  });

  return router;
}
