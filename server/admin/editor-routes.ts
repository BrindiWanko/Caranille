/**
 * @file JSON API of the map editor (administrators only).
 *
 * Every route checks the administrator role on the server and, for writes, the
 * `X-CSRF-Token` header. Saving a map requires holding its edit lock; saved
 * maps are validated, stored with a history snapshot, and pushed live to the
 * players currently on them.
 *
 * Errors are returned as `{ error: <translation key>, params? }`.
 */
import express, { Router, type Request, type Response } from 'express';
import { refreshAllAutotiles } from '../../shared/autotile-shapes.js';
import type { TilesetData } from '../../shared/database.js';
import { tilesetSheetNames } from '../../shared/conversions.js';
import { createMap, type MapData, type MapInfo, type MapType } from '../../shared/map.js';
import { MAX_MAP_SIDE, resizeMap, validateMap } from '../../shared/map-validation.js';
import { DEFAULT_SETTINGS, type StartPosition } from '../../shared/settings.js';
import { TILE_ID_A2, TILE_ID_MAX, TILESET_SHEETS } from '../../shared/tiles.js';
import { currentAccount, requireRoleApi } from '../auth/middleware.js';
import type { ServerContext } from '../context.js';
import { verifyCsrfHeader } from '../http/csrf.js';
import { databaseRouter } from './database-routes.js';
import { imageSize, scanResources } from '../resources/scanner.js';
import { MAX_UPLOAD_BYTES, deleteUpload, guessKind, sanitizeName, sniffType, storeUpload } from '../resources/uploads.js';
import { exportMap, importProject } from '../importers/project.js';
import { ZipError, readZip } from '../importers/zip.js';

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const MAP_TYPES: readonly MapType[] = ['town', 'field', 'dungeon', 'instance'];

function fail(res: Response, status: number, error: string, params?: Record<string, string | number>): void {
  res.status(status).json({ error, params });
}

/** Validates an editor tileset payload. */
function validateTileset(t: unknown, id: number, tilesetNames: Set<string>): TilesetData | null {
  const ts = t as TilesetData;
  if (typeof ts !== 'object' || ts === null) return null;
  if (typeof ts.name !== 'string' || ts.name.length > 100 || !isInt(ts.mode, 0, 2)) return null;
  if (!Array.isArray(ts.tilesetNames) || ts.tilesetNames.length !== TILESET_SHEETS.length) return null;
  if (!ts.tilesetNames.every((n) => typeof n === 'string' && (n === '' || tilesetNames.has(n)))) return null;
  if (!Array.isArray(ts.flags) || ts.flags.length !== TILE_ID_MAX || !ts.flags.every((f) => isInt(f, 0, 0xffff))) return null;
  return { id, name: ts.name, mode: ts.mode, tilesetNames: [...ts.tilesetNames], flags: [...ts.flags] };
}

/**
 * Creates the editor API router (mount under `/api/editor`).
 * @param ctx - Server context.
 */
export function editorRouter(ctx: ServerContext): Router {
  const router = Router();
  router.use(requireRoleApi('admin'));
  // Maps can be large: this router has its own body limit.
  router.use(express.json({ limit: '20mb' }));
  router.use(verifyCsrfHeader);
  router.use(databaseRouter(ctx));

  const account = (res: Response) => currentAccount(res)!;
  const mapId = (req: Request) => Number(req.params.id);
  const tilesetNames = () =>
    new Set(ctx.resources.all().filter((r) => r.kind === 'tilesets').flatMap((r) => tilesetSheetNames(r.name, r.format, r.width ?? 0, r.height ?? 0)));

  router.get('/bootstrap', (_req, res) => {
    res.json({
      maps: ctx.maps.infos(),
      tilesets: ctx.gameData.list('tileset').map((t) => ({ id: t.id, name: t.name, mode: t.mode, tilesetNames: t.tilesetNames })),
      startPosition: ctx.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition),
    });
  });

  router.get('/maps/:id', (req, res) => {
    const info = ctx.maps.info(mapId(req));
    const map = ctx.maps.get(mapId(req));
    if (!info || !map) {
      fail(res, 404, 'error.editor.map_not_found');
      return;
    }
    res.json({ info, map, lock: ctx.editLocks.holder(info.id) ?? null });
  });

  router.post('/maps/:id/lock', (req, res) => {
    const id = mapId(req);
    if (!ctx.maps.info(id)) {
      fail(res, 404, 'error.editor.map_not_found');
      return;
    }
    const me = account(res);
    if (!ctx.editLocks.acquire(id, me.id, me.username)) {
      fail(res, 409, 'error.editor.locked', { name: ctx.editLocks.holder(id)?.username ?? '?' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/maps/:id/lock', (req, res) => {
    ctx.editLocks.release(mapId(req), account(res).id);
    res.json({ ok: true });
  });

  router.put('/maps/:id', (req, res) => {
    const id = mapId(req);
    const info = ctx.maps.info(id);
    if (!info) {
      fail(res, 404, 'error.editor.map_not_found');
      return;
    }
    if (!ctx.editLocks.isHeldBy(id, account(res).id)) {
      fail(res, 409, 'error.editor.lock_required');
      return;
    }
    const map = (req.body as { map?: unknown }).map;
    const error = validateMap(map, (t) => ctx.gameData.get('tileset', t) !== undefined);
    if (error) {
      fail(res, 400, 'error.editor.invalid_map', { detail: error });
      return;
    }
    ctx.maps.saveWithVersion(info, map as MapData, account(res).id);
    ctx.world.reloadMap(id);
    res.json({ ok: true });
  });

  router.post('/maps', (req, res) => {
    const body = req.body as { name?: unknown; parentId?: unknown; width?: unknown; height?: unknown; tilesetId?: unknown; displayName?: unknown; type?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
    const tilesetId = Number(body.tilesetId);
    const tileset = ctx.gameData.get('tileset', tilesetId);
    const parentId = Number(body.parentId ?? 0);
    if (!name || !tileset || !isInt(body.width, 1, MAX_MAP_SIDE) || !isInt(body.height, 1, MAX_MAP_SIDE)) {
      fail(res, 400, 'error.editor.invalid_map');
      return;
    }
    if (parentId !== 0 && !ctx.maps.info(parentId)) {
      fail(res, 400, 'error.editor.map_not_found');
      return;
    }
    const map = createMap(body.width, body.height, tilesetId);
    map.displayName = typeof body.displayName === 'string' ? body.displayName.slice(0, 100) : name;
    if (typeof body.type === 'string' && MAP_TYPES.includes(body.type as MapType)) map.mmo.type = body.type as MapType;
    // New maps start covered with the first ground of the tileset, when it has one.
    if (tileset.tilesetNames[1]) {
      map.data.fill(TILE_ID_A2, 0, map.width * map.height);
      refreshAllAutotiles(map);
    }
    const siblings = ctx.maps.infos().filter((i) => i.parentId === parentId);
    const info: MapInfo = { id: ctx.maps.nextId(), parentId, name, order: siblings.length + 1, expanded: true };
    ctx.maps.saveWithVersion(info, map, account(res).id);
    res.json({ info, map });
  });

  router.patch('/maps/:id/info', (req, res) => {
    const id = mapId(req);
    const info = ctx.maps.info(id);
    const map = ctx.maps.get(id);
    if (!info || !map) {
      fail(res, 404, 'error.editor.map_not_found');
      return;
    }
    const body = req.body as Partial<MapInfo> & { width?: unknown; height?: unknown };
    const next: MapInfo = { ...info };
    if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim().slice(0, 100);
    if (typeof body.expanded === 'boolean') next.expanded = body.expanded;
    if (isInt(body.order, 0, 100_000)) next.order = body.order;
    if (isInt(body.parentId, 0, 1_000_000) && body.parentId !== info.parentId) {
      // Refuse moves that would put a map inside its own subtree.
      let cursor = body.parentId;
      const infos = ctx.maps.infos();
      while (cursor !== 0) {
        if (cursor === id) {
          fail(res, 400, 'error.editor.invalid_parent');
          return;
        }
        cursor = infos.find((i) => i.id === cursor)?.parentId ?? 0;
      }
      next.parentId = body.parentId;
    }
    let data = map;
    if (isInt(body.width, 1, MAX_MAP_SIDE) && isInt(body.height, 1, MAX_MAP_SIDE) && (body.width !== map.width || body.height !== map.height)) {
      if (!ctx.editLocks.isHeldBy(id, account(res).id)) {
        fail(res, 409, 'error.editor.lock_required');
        return;
      }
      data = resizeMap(map, body.width, body.height);
      refreshAllAutotiles(data);
    }
    if (data !== map) ctx.maps.saveWithVersion(next, data, account(res).id);
    else ctx.maps.save(next, data);
    if (data !== map) ctx.world.reloadMap(id);
    res.json({ info: next, map: data });
  });

  router.delete('/maps/:id', (req, res) => {
    const id = mapId(req);
    if (!ctx.maps.info(id)) {
      fail(res, 404, 'error.editor.map_not_found');
      return;
    }
    const start = ctx.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition);
    if (start.mapId === id) {
      fail(res, 400, 'error.editor.delete_start_map');
      return;
    }
    if (ctx.maps.infos().some((i) => i.parentId === id)) {
      fail(res, 400, 'error.editor.delete_has_children');
      return;
    }
    const holder = ctx.editLocks.holder(id);
    if (holder && holder.accountId !== account(res).id) {
      fail(res, 409, 'error.editor.locked', { name: holder.username });
      return;
    }
    ctx.world.evacuateMap(id);
    ctx.maps.delete(id);
    ctx.editLocks.release(id, account(res).id);
    res.json({ ok: true });
  });

  router.get('/maps/:id/versions', (req, res) => {
    res.json({ versions: ctx.maps.versions(mapId(req)) });
  });

  router.post('/maps/:id/versions/:versionId/restore', (req, res) => {
    const id = mapId(req);
    const info = ctx.maps.info(id);
    const data = ctx.maps.version(id, Number(req.params.versionId));
    if (!info || !data) {
      fail(res, 404, 'error.editor.map_not_found');
      return;
    }
    if (!ctx.editLocks.isHeldBy(id, account(res).id)) {
      fail(res, 409, 'error.editor.lock_required');
      return;
    }
    // An old snapshot may reference a tileset that was deleted since.
    if (validateMap(data, (t) => ctx.gameData.get('tileset', t) !== undefined)) {
      fail(res, 400, 'error.editor.invalid_map');
      return;
    }
    ctx.maps.saveWithVersion(info, data, account(res).id);
    ctx.world.reloadMap(id);
    res.json({ map: data });
  });

  // --- Resources ---------------------------------------------------------------

  router.post('/resources', express.raw({ type: '*/*', limit: MAX_UPLOAD_BYTES }), (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const name = sanitizeName(String(req.query.name ?? ''));
    let kind = String(req.query.kind ?? 'auto');
    if (kind === 'auto') {
      const type = sniffType(data);
      const { width, height } = imageSize(data, type === 'svg' ? '.svg' : `.${type ?? ''}`);
      kind = type === 'ogg' || type === 'm4a' || type === 'mp3' || type === 'wav' ? 'se' : guessKind(name, width, height);
    }
    const result = storeUpload(kind, name, data);
    if (!result.ok) {
      fail(res, 400, result.errorKey);
      return;
    }
    ctx.resources.sync(scanResources());
    res.json({ resource: ctx.resources.all().find((r) => r.id === result.id) ?? null });
  });

  router.delete('/resources/:kind/:name', (req, res) => {
    const id = `${req.params.kind}/${req.params.name}`;
    const entry = ctx.resources.all().find((r) => r.id === id);
    if (!entry || entry.origin === 'generated' || !deleteUpload(entry.url.replace(/^\//, ''))) {
      fail(res, 400, 'error.resources.cannot_delete');
      return;
    }
    ctx.resources.sync(scanResources());
    res.json({ ok: true });
  });

  // --- Import / export ------------------------------------------------------------

  router.post('/import', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    try {
      const report = importProject(ctx, readZip(data), account(res).id);
      res.json({ report });
    } catch (err) {
      if (err instanceof ZipError) fail(res, 400, err.key);
      else throw err;
    }
  });

  router.get('/maps/:id/export', (req, res) => {
    const id = mapId(req);
    const map = ctx.maps.get(id);
    if (!map) {
      fail(res, 404, 'error.editor.map_not_found');
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="Map${String(id).padStart(3, '0')}.json"`);
    res.json(exportMap(map));
  });

  router.get('/tilesets/:id', (req, res) => {
    const tileset = ctx.gameData.get('tileset', Number(req.params.id));
    if (!tileset) {
      fail(res, 404, 'error.editor.tileset_not_found');
      return;
    }
    res.json({ tileset });
  });

  router.put('/tilesets/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!isInt(id, 1, 9999)) {
      fail(res, 400, 'error.editor.invalid_tileset');
      return;
    }
    const tileset = validateTileset((req.body as { tileset?: unknown }).tileset, id, tilesetNames());
    if (!tileset) {
      fail(res, 400, 'error.editor.invalid_tileset');
      return;
    }
    ctx.gameData.save('tileset', tileset);
    ctx.world.reloadMapsUsingTileset(id);
    res.json({ ok: true });
  });

  return router;
}
