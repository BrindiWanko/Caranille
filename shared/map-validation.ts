/**
 * @file Structural validation of maps received from the editor.
 *
 * The editor is only reachable by administrators, but the server still checks
 * every map it stores: a malformed map could crash the game loop or every
 * client drawing it. Content (texts, names) is not judged, only shapes and
 * bounds.
 */
import { isValidSpawns } from './combat.js';
import type { EventCommand, EventPage, GameEvent } from './events.js';
import { MAP_LAYERS, type MapData, type MapType } from './map.js';
import { TILE_ID_MAX } from './tiles.js';

/** Largest map side accepted, in tiles. */
export const MAX_MAP_SIDE = 256;
/** Maximum number of events per map. */
export const MAX_EVENTS = 999;
/** Maximum commands per event page. */
const MAX_COMMANDS = 5000;
const MAP_TYPES: readonly MapType[] = ['town', 'field', 'dungeon', 'instance'];

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isStr = (v: unknown, max = 10_000): v is string => typeof v === 'string' && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Result of a validation: `null` when valid, otherwise the path of the first problem. */
export type ValidationError = string | null;

function validateCommand(c: unknown, path: string): ValidationError {
  const cmd = c as EventCommand;
  if (typeof cmd !== 'object' || cmd === null) return path;
  if (!isInt(cmd.code, 0, 99_999)) return `${path}.code`;
  if (!isInt(cmd.indent, 0, 100)) return `${path}.indent`;
  if (!Array.isArray(cmd.parameters) || cmd.parameters.length > 64) return `${path}.parameters`;
  if (JSON.stringify(cmd.parameters).length > 20_000) return `${path}.parameters`;
  return null;
}

function validatePage(page: unknown, path: string): ValidationError {
  const p = page as EventPage;
  if (typeof p !== 'object' || p === null) return path;
  if (typeof p.conditions !== 'object' || p.conditions === null) return `${path}.conditions`;
  const img = p.image;
  if (typeof img !== 'object' || img === null) return `${path}.image`;
  if (!isInt(img.tileId, 0, TILE_ID_MAX - 1) || !isStr(img.characterName, 200) || !isInt(img.characterIndex, 0, 7)) return `${path}.image`;
  if (![2, 4, 6, 8].includes(img.direction) || !isInt(img.pattern, 0, 3)) return `${path}.image`;
  if (!isInt(p.trigger, 0, 4) || !isInt(p.priorityType, 0, 2) || !isInt(p.moveType, 0, 3)) return `${path}.trigger`;
  if (!isInt(p.moveSpeed, 1, 6) || !isInt(p.moveFrequency, 1, 5)) return `${path}.moveSpeed`;
  for (const flag of [p.walkAnime, p.stepAnime, p.directionFix, p.through]) if (!isBool(flag)) return `${path}.flags`;
  if (typeof p.moveRoute !== 'object' || p.moveRoute === null || !Array.isArray(p.moveRoute.list)) return `${path}.moveRoute`;
  if (!Array.isArray(p.list) || p.list.length === 0 || p.list.length > MAX_COMMANDS) return `${path}.list`;
  for (let i = 0; i < p.list.length; i++) {
    const err = validateCommand(p.list[i], `${path}.list[${i}]`);
    if (err) return err;
  }
  return null;
}

/**
 * Validates one event.
 * @param e - Untrusted event.
 * @param id - Expected id (its index in `events`).
 * @param width - Map width.
 * @param height - Map height.
 */
export function validateEvent(e: unknown, id: number, width: number, height: number): ValidationError {
  const ev = e as GameEvent;
  const path = `events[${id}]`;
  if (typeof ev !== 'object' || ev === null) return path;
  if (ev.id !== id || !isStr(ev.name, 200) || !isStr(ev.note, 5000)) return `${path}.id`;
  if (!isInt(ev.x, 0, width - 1) || !isInt(ev.y, 0, height - 1)) return `${path}.position`;
  if (!Array.isArray(ev.pages) || ev.pages.length === 0 || ev.pages.length > 20) return `${path}.pages`;
  for (let i = 0; i < ev.pages.length; i++) {
    const err = validatePage(ev.pages[i], `${path}.pages[${i}]`);
    if (err) return err;
  }
  return null;
}

/**
 * Validates a whole map.
 * @param m - Untrusted map.
 * @param tilesetExists - Tells whether a tileset id exists.
 */
export function validateMap(m: unknown, tilesetExists: (id: number) => boolean): ValidationError {
  const map = m as MapData;
  if (typeof map !== 'object' || map === null) return 'map';
  if (!isInt(map.width, 1, MAX_MAP_SIDE) || !isInt(map.height, 1, MAX_MAP_SIDE)) return 'size';
  if (!isInt(map.tilesetId, 1, 9999) || !tilesetExists(map.tilesetId)) return 'tilesetId';
  if (!isStr(map.displayName, 200) || !isStr(map.note, 10_000) || !isStr(map.parallaxName, 200)) return 'texts';
  if (!isInt(map.scrollType, 0, 3)) return 'scrollType';
  for (const flag of [map.autoplayBgm, map.autoplayBgs, map.parallaxLoopX, map.parallaxLoopY, map.parallaxShow, map.disableDashing]) {
    if (!isBool(flag)) return 'flags';
  }
  if (!isInt(map.parallaxSx, -32, 32) || !isInt(map.parallaxSy, -32, 32)) return 'parallaxSpeed';
  for (const audio of [map.bgm, map.bgs]) {
    if (typeof audio !== 'object' || audio === null || !isStr(audio.name, 200)) return 'audio';
    if (!isInt(audio.volume, 0, 100) || !isInt(audio.pitch, 50, 150) || !isInt(audio.pan, -100, 100)) return 'audio';
  }
  const cells = map.width * map.height;
  if (!Array.isArray(map.data) || map.data.length !== cells * MAP_LAYERS) return 'data.length';
  for (let i = 0; i < map.data.length; i++) {
    const layer = Math.floor(i / cells);
    const max = layer < 4 ? TILE_ID_MAX - 1 : layer === 4 ? 15 : 255;
    if (!isInt(map.data[i], 0, max)) return `data[${i}]`;
  }
  const mmo = map.mmo;
  if (typeof mmo !== 'object' || mmo === null || !MAP_TYPES.includes(mmo.type) || !isBool(mmo.pvp) || !isBool(mmo.instance)) return 'mmo';
  if (mmo.spawns !== undefined && !isValidSpawns(mmo.spawns)) return 'mmo.spawns';
  for (const list of [mmo.blocked, mmo.opened]) {
    if (list !== undefined && (!Array.isArray(list) || list.length > cells || !list.every((i) => isInt(i, 0, cells - 1)))) return 'mmo.passage';
  }
  if (!Array.isArray(map.events) || map.events.length > MAX_EVENTS + 1 || map.events[0] !== null) return 'events';
  for (let id = 1; id < map.events.length; id++) {
    if (map.events[id] === null) continue;
    const err = validateEvent(map.events[id], id, map.width, map.height);
    if (err) return err;
  }
  return null;
}

/**
 * Resizes a map, keeping the top-left content and moving out-of-bounds events inside.
 * @param map - Map to resize (not modified).
 * @param width - New width.
 * @param height - New height.
 */
export function resizeMap(map: MapData, width: number, height: number): MapData {
  const data = new Array<number>(width * height * MAP_LAYERS).fill(0);
  for (let z = 0; z < MAP_LAYERS; z++) {
    for (let y = 0; y < Math.min(height, map.height); y++) {
      for (let x = 0; x < Math.min(width, map.width); x++) {
        data[(z * height + y) * width + x] = map.data[(z * map.height + y) * map.width + x] ?? 0;
      }
    }
  }
  const events = map.events.map((e) => (e ? { ...e, x: Math.min(e.x, width - 1), y: Math.min(e.y, height - 1) } : null));
  // Hand-made passability follows its cells; cells cut off are dropped.
  const moveCells = (list: number[] | undefined) =>
    list?.flatMap((i) => {
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      return x < width && y < height ? [y * width + x] : [];
    });
  const mmo = { ...map.mmo };
  for (const key of ['blocked', 'opened'] as const) {
    const moved = moveCells(map.mmo[key]);
    if (moved?.length) mmo[key] = moved;
    else delete mmo[key];
  }
  return { ...map, width, height, data, events, mmo };
}
