/**
 * @file Map format.
 *
 * A map stores its cells in one flat array `data` indexed as
 * `(z * height + y) * width + x`, with six layers:
 *   z = 0..3  tile layers (0 = ground; A tiles usually sit on 0–1, B–E on 2–3),
 *   z = 4     shadow bits (one bit per tile quarter: 1 = top-left, 2 = top-right,
 *             4 = bottom-left, 8 = bottom-right),
 *   z = 5     region ids (0 = none, 1–255), used by spawns and scripts.
 * The engine-specific block `mmo` holds multiplayer properties (map type,
 * PvP, instancing...). Events follow the event format described in
 * `shared/events.ts`.
 */
import type { Spawn } from './combat.js';
import type { GameEvent } from './events.js';

/** Number of layers stored per cell. */
export const MAP_LAYERS = 6;
/** Layer of shadow bits. */
export const SHADOW_LAYER = 4;
/** Layer of region ids. */
export const REGION_LAYER = 5;

/** Kind of map, used for rules and the editor tree icons. */
export type MapType = 'town' | 'field' | 'dungeon' | 'instance';

/** Multiplayer properties of a map. */
export interface MapMmoProperties {
  type: MapType;
  /** Players may attack each other. */
  pvp: boolean;
  /** Each group gets its own copy of the map. */
  instance: boolean;
  /** Monsters appearing on the map (missing in maps saved before combat existed). */
  spawns?: Spawn[];
  /**
   * Cells made impassable by hand in the editor's passability mode, whatever
   * their tiles say (cell index = y * width + x).
   */
  blocked?: number[];
  /** Cells made passable by hand, whatever their tiles say. */
  opened?: number[];
}

/** Audio reference (name in `audio/<kind>/`, volume 0–100, pitch 50–150, pan -100–100). */
export interface AudioRef {
  name: string;
  volume: number;
  pitch: number;
  pan: number;
}

/** A map. */
export interface MapData {
  width: number;
  height: number;
  tilesetId: number;
  /** Name shown to players when entering (content, any language). */
  displayName: string;
  /** Scroll type: 0 none, 1 loop vertically, 2 loop horizontally, 3 both (looping is not supported yet). */
  scrollType: number;
  autoplayBgm: boolean;
  bgm: AudioRef;
  autoplayBgs: boolean;
  bgs: AudioRef;
  parallaxName: string;
  parallaxLoopX: boolean;
  parallaxLoopY: boolean;
  parallaxSx: number;
  parallaxSy: number;
  parallaxShow: boolean;
  /** Characters cannot walk (used for maps shown as scenery). */
  disableDashing: boolean;
  note: string;
  data: number[];
  /** Index = event id; index 0 and deleted ids are `null`. */
  events: (GameEvent | null)[];
  mmo: MapMmoProperties;
}

/** Entry of the map tree (editor), without cell data. */
export interface MapInfo {
  id: number;
  name: string;
  parentId: number;
  order: number;
  expanded: boolean;
}

/** Empty audio reference. */
export const NO_AUDIO: AudioRef = { name: '', volume: 90, pitch: 100, pan: 0 };

/**
 * Creates an empty map.
 * @param width - Width in tiles.
 * @param height - Height in tiles.
 * @param tilesetId - Tileset id.
 */
export function createMap(width: number, height: number, tilesetId: number): MapData {
  return {
    width,
    height,
    tilesetId,
    displayName: '',
    scrollType: 0,
    autoplayBgm: false,
    bgm: { ...NO_AUDIO },
    autoplayBgs: false,
    bgs: { ...NO_AUDIO },
    parallaxName: '',
    parallaxLoopX: false,
    parallaxLoopY: false,
    parallaxSx: 0,
    parallaxSy: 0,
    parallaxShow: true,
    disableDashing: false,
    note: '',
    data: new Array<number>(width * height * MAP_LAYERS).fill(0),
    events: [null],
    mmo: { type: 'field', pvp: false, instance: false },
  };
}

/**
 * Index of a cell in `data`.
 * @param map - Map.
 * @param x - Column.
 * @param y - Row.
 * @param z - Layer (0–5).
 */
export function cellIndex(map: Pick<MapData, 'width' | 'height'>, x: number, y: number, z: number): number {
  return (z * map.height + y) * map.width + x;
}

/** Tells whether a position is inside the map. */
export function isValidPosition(map: Pick<MapData, 'width' | 'height'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** Reads a cell (0 outside the map). */
export function tileAt(map: Pick<MapData, 'width' | 'height' | 'data'>, x: number, y: number, z: number): number {
  return isValidPosition(map, x, y) ? (map.data[cellIndex(map, x, y, z)] ?? 0) : 0;
}

/** Writes a cell (ignored outside the map). */
export function setTileAt(map: Pick<MapData, 'width' | 'height' | 'data'>, x: number, y: number, z: number, value: number): void {
  if (isValidPosition(map, x, y)) map.data[cellIndex(map, x, y, z)] = value;
}

/** Offset of a direction: 2 down, 4 left, 6 right, 8 up. */
export function directionOffset(d: number): { dx: number; dy: number } {
  return { dx: d === 4 ? -1 : d === 6 ? 1 : 0, dy: d === 8 ? -1 : d === 2 ? 1 : 0 };
}

/** Opposite direction. */
export function reverseDirection(d: number): number {
  return 10 - d;
}
