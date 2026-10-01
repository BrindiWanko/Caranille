/**
 * @file Import of an external project folder (zipped) and export of maps.
 *
 * A project folder holds `data/*.json` (tilesets, map tree, maps, database)
 * and `img/<kind>/`, `audio/<kind>/` resources. The importer:
 * - copies images and sounds into the uploads (same names, so sheet
 *   references keep working);
 * - adds the tilesets as new tilesets (existing ones are never overwritten);
 * - adds the maps under new ids, remapping tileset ids and the destination
 *   map of transfer commands, and keeps the tree structure;
 * - reports what could not be converted: unsupported event commands (by code),
 *   plugin commands, missing images, database files (imported with the
 *   database step), invalid maps;
 * - warns about the scripts the maps contain (script commands, script
 *   conditions and script operands): they will run on the server once the
 *   maps are played, so an archive of unknown origin must be reviewed.
 *
 * Maps and events use the same structure as the engine's own format, so most
 * content is taken as is; the engine-specific `mmo` block gets default values.
 */
import { isValidSpawns } from '../../shared/combat.js';
import { BranchType, Cmd, type EventCommand, type GameEvent } from '../../shared/events.js';
import type { TilesetData } from '../../shared/database.js';
import { MAP_LAYERS, NO_AUDIO, type AudioRef, type MapData, type MapInfo } from '../../shared/map.js';
import { validateMap } from '../../shared/map-validation.js';
import { RESOURCE_KINDS, type ResourceKind } from '../../shared/resource-formats.js';
import { TILE_ID_MAX, TILESET_SHEETS } from '../../shared/tiles.js';
import type { ServerContext } from '../context.js';
import { scanResources } from '../resources/scanner.js';
import { storeUpload } from '../resources/uploads.js';
import { importDatabase } from './database.js';
import type { ZipEntry } from './zip.js';

/** One remark of the import report (a translation key and its parameters). */
export interface ImportWarning {
  key: string;
  params?: Record<string, string | number>;
}

/** Summary of an import. */
export interface ImportReport {
  tilesets: number;
  maps: number;
  images: number;
  sounds: number;
  warnings: ImportWarning[];
  /** New ids of the imported maps, keyed by their id in the project. */
  mapIds: Record<number, number>;
  /** Database records imported, by type. */
  database: Record<string, number>;
}

/** Event command codes the interpreter runs today. */
export const SUPPORTED_COMMANDS: ReadonlySet<number> = new Set([
  Cmd.End, Cmd.ShowText, Cmd.TextLine, Cmd.TransferPlayer, Cmd.Comment, Cmd.CommentLine,
  Cmd.ChangeGold, Cmd.ChangeItems, Cmd.ChangeWeapons, Cmd.ChangeArmors,
]);

/** Codes of plugin commands, reported separately. */
const PLUGIN_COMMANDS = new Set([356, 357]);

/** Tells whether a command carries script code run by the sandbox. */
export function isScriptCommand(cmd: EventCommand): boolean {
  if (cmd.code === Cmd.Script) return true;
  if (cmd.code === Cmd.If) return cmd.parameters[0] === BranchType.Script;
  // Control variables with a script operand (operand type 4).
  return cmd.code === Cmd.ControlVariables && cmd.parameters[3] === 4;
}

const int = (v: unknown, fallback: number, min: number, max: number): number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : fallback;
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v: unknown): boolean => v === true;

function audio(v: unknown): AudioRef {
  const a = (v ?? {}) as Partial<AudioRef>;
  return { name: str(a.name), volume: int(a.volume, 90, 0, 100), pitch: int(a.pitch, 100, 50, 150), pan: int(a.pan, 0, -100, 100) };
}

function parseJson(entries: Map<string, Buffer>, path: string): unknown {
  const data = entries.get(path);
  if (!data) return undefined;
  try {
    // Project files may start with a byte order mark.
    return JSON.parse(data.toString('utf8').replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
}

/** Finds the folder containing `data/` inside the archive (projects are often zipped with their folder). */
function projectRoot(names: string[]): string | null {
  const marker = names.find((n) => /(^|\/)data\/(MapInfos|System|Tilesets)\.json$/i.test(n));
  if (!marker) return null;
  return marker.slice(0, marker.toLowerCase().lastIndexOf('data/'));
}

/**
 * Converts an external map object into the engine's map format.
 * @param raw - Parsed map file.
 * @param tilesetId - Tileset id in the engine.
 * @param remapMap - New id of a map referenced by a transfer command.
 * @param unsupported - Receives the codes of commands the interpreter does not run.
 * @param scripts - Receives the names of the events that contain scripts.
 */
export function convertMap(
  raw: Record<string, unknown>,
  tilesetId: number,
  remapMap: (id: number) => number | undefined,
  unsupported: Map<number, number>,
  scripts: string[] = [],
): MapData {
  const width = int(raw.width, 1, 1, 256);
  const height = int(raw.height, 1, 1, 256);
  const cells = width * height * MAP_LAYERS;
  const source = Array.isArray(raw.data) ? (raw.data as unknown[]) : [];
  const data = Array.from({ length: cells }, (_, i) => {
    const layer = Math.floor(i / (width * height));
    return int(source[i], 0, 0, layer < 4 ? TILE_ID_MAX - 1 : layer === 4 ? 15 : 255);
  });
  const events: (GameEvent | null)[] = [null];
  const rawEvents = Array.isArray(raw.events) ? (raw.events as unknown[]) : [];
  for (let id = 1; id < rawEvents.length; id++) {
    const e = rawEvents[id] as GameEvent | null;
    if (!e || typeof e !== 'object' || !Array.isArray(e.pages) || e.pages.length === 0) {
      events.push(null);
      continue;
    }
    let hasScript = false;
    const pages = e.pages.map((page) => {
      const list: EventCommand[] = (Array.isArray(page.list) ? page.list : []).map((c) => {
        const cmd: EventCommand = { code: int(c?.code, 0, 0, 99_999), indent: int(c?.indent, 0, 0, 100), parameters: Array.isArray(c?.parameters) ? [...c.parameters] : [] };
        if (!SUPPORTED_COMMANDS.has(cmd.code)) unsupported.set(cmd.code, (unsupported.get(cmd.code) ?? 0) + 1);
        if (isScriptCommand(cmd)) hasScript = true;
        // Transfers to a map of the project point to its new id.
        if (cmd.code === Cmd.TransferPlayer && cmd.parameters[0] === 0) {
          const target = remapMap(Number(cmd.parameters[1]));
          if (target !== undefined) cmd.parameters[1] = target;
        }
        return cmd;
      });
      if (list.length === 0 || list.at(-1)!.code !== Cmd.End) list.push({ code: Cmd.End, indent: 0, parameters: [] });
      const img = (page.image ?? {}) as Partial<GameEvent['pages'][number]['image']>;
      return {
        conditions: { ...(page.conditions ?? {}) } as GameEvent['pages'][number]['conditions'],
        image: {
          tileId: int(img.tileId, 0, 0, TILE_ID_MAX - 1),
          characterName: str(img.characterName),
          characterIndex: int(img.characterIndex, 0, 0, 7),
          direction: ([2, 4, 6, 8] as const).includes(img.direction as 2) ? (img.direction as 2 | 4 | 6 | 8) : 2,
          pattern: int(img.pattern, 1, 0, 3),
        },
        moveType: int(page.moveType, 0, 0, 3),
        moveSpeed: int(page.moveSpeed, 3, 1, 6),
        moveFrequency: int(page.moveFrequency, 3, 1, 5),
        moveRoute: {
          list: Array.isArray(page.moveRoute?.list) ? page.moveRoute.list : [{ code: 0 }],
          repeat: bool(page.moveRoute?.repeat),
          skippable: bool(page.moveRoute?.skippable),
          wait: bool(page.moveRoute?.wait),
        },
        walkAnime: page.walkAnime !== false,
        stepAnime: bool(page.stepAnime),
        directionFix: bool(page.directionFix),
        through: bool(page.through),
        priorityType: int(page.priorityType, 1, 0, 2),
        trigger: int(page.trigger, 0, 0, 4),
        list,
      };
    });
    if (hasScript) scripts.push(str(e.name) || `EV${id}`);
    events.push({ id, name: str(e.name) || `EV${id}`, note: str(e.note, 5000), x: int(e.x, 0, 0, width - 1), y: int(e.y, 0, 0, height - 1), pages });
  }
  return {
    width,
    height,
    tilesetId,
    displayName: str(raw.displayName),
    scrollType: int(raw.scrollType, 0, 0, 3),
    autoplayBgm: bool(raw.autoplayBgm),
    bgm: audio(raw.bgm),
    autoplayBgs: bool(raw.autoplayBgs),
    bgs: audio(raw.bgs),
    parallaxName: str(raw.parallaxName),
    parallaxLoopX: bool(raw.parallaxLoopX),
    parallaxLoopY: bool(raw.parallaxLoopY),
    parallaxSx: int(raw.parallaxSx, 0, -32, 32),
    parallaxSy: int(raw.parallaxSy, 0, -32, 32),
    parallaxShow: raw.parallaxShow !== false,
    disableDashing: bool(raw.disableDashing),
    note: str(raw.note, 10_000),
    data,
    events,
    mmo: importMmo(raw.mmo, width * height),
  };
}

/** The engine's own `mmo` block when a file carries a valid one (round trip of exported maps), defaults otherwise. */
function importMmo(raw: unknown, cells: number): MapData['mmo'] {
  const cellList = (v: unknown) => (Array.isArray(v) && v.length > 0 && v.length <= cells && v.every((i) => Number.isInteger(i) && i >= 0 && i < cells) ? (v as number[]) : undefined);
  const m = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<MapData['mmo']>;
  const types: MapData['mmo']['type'][] = ['town', 'field', 'dungeon', 'instance'];
  return {
    type: types.includes(m.type as MapData['mmo']['type']) ? (m.type as MapData['mmo']['type']) : 'field',
    pvp: m.pvp === true,
    instance: m.instance === true,
    ...(isValidSpawns(m.spawns) ? { spawns: m.spawns } : {}),
    ...(cellList(m.blocked) ? { blocked: cellList(m.blocked) } : {}),
    ...(cellList(m.opened) ? { opened: cellList(m.opened) } : {}),
  };
}

/**
 * Imports a project archive.
 * @param ctx - Server context.
 * @param files - Archive entries.
 * @param accountId - Administrator performing the import (map history author).
 */
export function importProject(ctx: ServerContext, files: ZipEntry[], accountId: number): ImportReport {
  const report: ImportReport = { tilesets: 0, maps: 0, images: 0, sounds: 0, warnings: [], mapIds: {}, database: {} };
  const root = projectRoot(files.map((f) => f.name)) ?? '';
  const byPath = new Map(files.filter((f) => f.name.startsWith(root)).map((f) => [f.name.slice(root.length), f.data]));
  const lowerIndex = new Map([...byPath.keys()].map((k) => [k.toLowerCase(), k]));
  const file = (path: string) => lowerIndex.get(path.toLowerCase());

  // 1. Resources.
  const ignoredFolders = new Set<string>();
  for (const [path, data] of byPath) {
    const m = /^(img|audio)\/([^/]+)\/([^/]+)\.(png|jpe?g|webp|svg|ogg|m4a|mp3|wav)$/i.exec(path);
    if (!m) continue;
    const kind = m[2]!.toLowerCase();
    if (!RESOURCE_KINDS.includes(kind as ResourceKind)) {
      ignoredFolders.add(`${m[1]}/${m[2]}`);
      continue;
    }
    const result = storeUpload(kind, m[3]!, data);
    if (!result.ok) report.warnings.push({ key: 'import.warning.file_refused', params: { file: path } });
    else if (m[1]!.toLowerCase() === 'img') report.images++;
    else report.sounds++;
  }
  for (const folder of ignoredFolders) report.warnings.push({ key: 'import.warning.folder_ignored', params: { folder } });
  ctx.resources.sync(scanResources());
  const imageNames = new Set(ctx.resources.all().filter((r) => r.kind === 'tilesets').map((r) => r.name));

  // 2. Tilesets (always added as new ones).
  const tilesetIds = new Map<number, number>();
  const rawTilesets = parseJson(byPath, file('data/Tilesets.json') ?? '');
  if (Array.isArray(rawTilesets)) {
    let nextId = Math.max(0, ...ctx.gameData.list('tileset').map((t) => t.id)) + 1;
    for (const raw of rawTilesets as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue;
      const names = Array.isArray(raw.tilesetNames) ? (raw.tilesetNames as unknown[]).map((n) => str(n)) : [];
      const tilesetNames = TILESET_SHEETS.map((_, i) => names[i] ?? '');
      for (const n of tilesetNames) if (n && !imageNames.has(n)) report.warnings.push({ key: 'import.warning.missing_image', params: { name: n } });
      const flags = Array.from({ length: TILE_ID_MAX }, (_, i) => int((raw.flags as unknown[] | undefined)?.[i], 0, 0, 0xffff));
      const tileset: TilesetData = { id: nextId, name: str(raw.name, 100) || `Tileset ${nextId}`, mode: int(raw.mode, 1, 0, 2), tilesetNames, flags };
      ctx.gameData.save('tileset', tileset);
      tilesetIds.set(int(raw.id, 0, 0, 9999), nextId);
      nextId++;
      report.tilesets++;
    }
  }

  // 3. Maps and tree.
  const rawInfos = parseJson(byPath, file('data/MapInfos.json') ?? '');
  const infos = (Array.isArray(rawInfos) ? rawInfos : []).filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
  let nextMapId = ctx.maps.nextId();
  for (const info of infos) report.mapIds[int(info.id, 0, 0, 99_999)] = nextMapId++;
  const unsupported = new Map<number, number>();
  const existingTileset = (id: number) => ctx.gameData.get('tileset', id) !== undefined;
  for (const info of infos) {
    const oldId = int(info.id, 0, 0, 99_999);
    const path = file(`data/Map${String(oldId).padStart(3, '0')}.json`);
    const raw = parseJson(byPath, path ?? '') as Record<string, unknown> | undefined;
    if (!raw) {
      report.warnings.push({ key: 'import.warning.map_missing', params: { id: oldId } });
      continue;
    }
    const tilesetId = tilesetIds.get(int(raw.tilesetId, 0, 0, 9999)) ?? ctx.gameData.list('tileset')[0]?.id ?? 1;
    const scripts: string[] = [];
    const map = convertMap(raw, tilesetId, (id) => report.mapIds[id], unsupported, scripts);
    const error = validateMap(map, existingTileset);
    if (error) {
      report.warnings.push({ key: 'import.warning.map_invalid', params: { id: oldId, detail: error } });
      continue;
    }
    if (scripts.length > 0) {
      report.warnings.push({ key: 'import.warning.scripts', params: { id: report.mapIds[oldId]!, count: scripts.length, events: scripts.slice(0, 10).join(', ') } });
    }
    const parentOld = int(info.parentId, 0, 0, 99_999);
    const entry: MapInfo = {
      id: report.mapIds[oldId]!,
      parentId: report.mapIds[parentOld] ?? 0,
      name: str(info.name, 100) || `Map ${oldId}`,
      order: int(info.order, 0, 0, 100_000),
      expanded: info.expanded !== false,
    };
    ctx.maps.saveWithVersion(entry, map, accountId);
    report.maps++;
  }
  for (const [code, count] of [...unsupported].sort((a, b) => a[0] - b[0])) {
    report.warnings.push({ key: PLUGIN_COMMANDS.has(code) ? 'import.warning.plugin_command' : 'import.warning.unsupported_command', params: { code, count } });
  }

  // 4. Database records (appended under new ids, references remapped).
  report.database = importDatabase(ctx, (name) => parseJson(byPath, file(`data/${name}.json`) ?? ''), report.warnings);
  for (const name of ['Actors', 'Troops', 'Animations', 'CommonEvents', 'System']) {
    if (file(`data/${name}.json`)) report.warnings.push({ key: 'import.warning.database_file', params: { file: `${name}.json` } });
  }
  const databaseCount = Object.values(report.database).reduce((a, b) => a + b, 0);
  if (report.maps === 0 && report.tilesets === 0 && report.images === 0 && report.sounds === 0 && databaseCount === 0) {
    report.warnings.push({ key: 'import.warning.nothing' });
  }
  return report;
}

/**
 * Exports a map in the external map file layout (for use in other tools).
 * The engine-only `mmo` block is added (other tools ignore it; importing the
 * file back here keeps the map type, PvP, instancing and monsters).
 * @param map - Map to export.
 */
export function exportMap(map: MapData): Record<string, unknown> {
  return {
    autoplayBgm: map.autoplayBgm,
    autoplayBgs: map.autoplayBgs,
    battleback1Name: '',
    battleback2Name: '',
    bgm: map.bgm ?? NO_AUDIO,
    bgs: map.bgs ?? NO_AUDIO,
    disableDashing: map.disableDashing,
    displayName: map.displayName,
    encounterList: [],
    encounterStep: 30,
    height: map.height,
    note: map.note,
    parallaxLoopX: map.parallaxLoopX,
    parallaxLoopY: map.parallaxLoopY,
    parallaxName: map.parallaxName,
    parallaxShow: map.parallaxShow,
    parallaxSx: map.parallaxSx,
    parallaxSy: map.parallaxSy,
    scrollType: map.scrollType,
    specifyBattleback: false,
    tilesetId: map.tilesetId,
    width: map.width,
    data: map.data,
    events: map.events,
    mmo: map.mmo,
  };
}
