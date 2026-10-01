/**
 * @file Passability rules, shared by the client (movement prediction,
 * click-to-move pathfinding) and the server (authoritative validation).
 *
 * Tile rules: to know whether a cell can be left or entered in a direction, the
 * tile layers are examined from the top layer (3) down to the ground (0).
 * Star tiles are skipped: they are drawn above characters and never block.
 * The first non-star tile decides: if its direction bit is clear the move is
 * allowed, if it is set the move is blocked. A move from A to B in direction d
 * needs A passable towards d and B passable towards the opposite direction.
 *
 * Cell overrides: the editor's passability mode can make single cells
 * impassable (`mmo.blocked`) or passable (`mmo.opened`) in every direction,
 * whatever their tiles say; they win over the tile rules.
 *
 * Character rules: an event with "same as characters" priority that is not
 * "through" occupies its cell; players do not block each other (a common
 * choice for multiplayer worlds, avoiding doorway blocking).
 */
import { directionOffset, isValidPosition, reverseDirection, tileAt, type MapData, type MapMmoProperties } from './map.js';
import { FLAG_BUSH, FLAG_COUNTER, FLAG_DAMAGE, FLAG_LADDER, FLAG_STAR, terrainTag } from './tiles.js';

/** Bit of each direction in tile flags. */
const DIRECTION_BIT: Record<number, number> = { 2: 0x1, 4: 0x2, 6: 0x4, 8: 0x8 };

/** What the rules need to know about a map. */
export type PassabilityMap = Pick<MapData, 'width' | 'height' | 'data'> & { mmo?: Pick<MapMmoProperties, 'blocked' | 'opened'> };

/** Index sets of the override lists (built once per list). */
const overrideSets = new WeakMap<number[], Set<number>>();
const asSet = (list: number[]): Set<number> => {
  let set = overrideSets.get(list);
  if (!set) {
    set = new Set(list);
    overrideSets.set(list, set);
  }
  return set;
};

/**
 * Hand-made override of a cell: `false` blocked, `true` passable, `undefined`
 * when its tiles decide.
 */
export function passageOverride(map: PassabilityMap, x: number, y: number): boolean | undefined {
  const mmo = map.mmo;
  if (!mmo || (!mmo.blocked?.length && !mmo.opened?.length)) return undefined;
  const index = y * map.width + x;
  if (mmo.blocked && asSet(mmo.blocked).has(index)) return false;
  if (mmo.opened && asSet(mmo.opened).has(index)) return true;
  return undefined;
}

/** Tile passage of a cell in one direction, ignoring overrides. */
export function tilePassage(map: PassabilityMap, flags: readonly number[], x: number, y: number, bit: number): boolean {
  for (let z = 3; z >= 0; z--) {
    const flag = flags[tileAt(map, x, y, z)] ?? 0;
    if ((flag & FLAG_STAR) !== 0) continue;
    if ((flag & bit) === 0) return true;
    if ((flag & bit) === bit) return false;
  }
  return false;
}

/**
 * Sets the hand-made passability of a cell (editor): `blocked` or `open`.
 * Only what differs from the tiles is stored, so asking for what the tiles
 * already give removes the override. Lists are replaced, never mutated.
 */
export function setPassageOverride(map: PassabilityMap & { mmo: MapMmoProperties }, flags: readonly number[], x: number, y: number, state: 'blocked' | 'open'): void {
  const index = y * map.width + x;
  const blocked = (map.mmo.blocked ?? []).filter((i) => i !== index);
  const opened = (map.mmo.opened ?? []).filter((i) => i !== index);
  const tilesOpen = [0x1, 0x2, 0x4, 0x8].every((bit) => tilePassage(map, flags, x, y, bit));
  const tilesShut = [0x1, 0x2, 0x4, 0x8].every((bit) => !tilePassage(map, flags, x, y, bit));
  if (state === 'blocked' && !tilesShut) blocked.push(index);
  if (state === 'open' && !tilesOpen) opened.push(index);
  map.mmo.blocked = blocked;
  map.mmo.opened = opened;
  if (blocked.length === 0) delete map.mmo.blocked;
  if (opened.length === 0) delete map.mmo.opened;
}

/**
 * Checks passage for a cell in one direction (hand-made override, else tiles).
 * @param map - Map cells.
 * @param flags - Tileset flags.
 * @param x - Column.
 * @param y - Row.
 * @param bit - Direction bit to test (0x1 down, 0x2 left, 0x4 right, 0x8 up).
 */
export function checkPassage(map: PassabilityMap, flags: readonly number[], x: number, y: number, bit: number): boolean {
  return passageOverride(map, x, y) ?? tilePassage(map, flags, x, y, bit);
}

/**
 * Tells whether a cell can be left towards `d`.
 * @param d - Direction (2, 4, 6, 8).
 */
export function isPassable(map: PassabilityMap, flags: readonly number[], x: number, y: number, d: number): boolean {
  return isValidPosition(map, x, y) && checkPassage(map, flags, x, y, DIRECTION_BIT[d] ?? 0xf);
}

/**
 * Tells whether a move from (x, y) one step towards `d` is allowed by the tiles.
 * @returns `true` when the destination is inside the map and both cells allow the move.
 */
export function canMove(map: PassabilityMap, flags: readonly number[], x: number, y: number, d: number): boolean {
  const { dx, dy } = directionOffset(d);
  const nx = x + dx;
  const ny = y + dy;
  if (!isValidPosition(map, nx, ny)) return false;
  return isPassable(map, flags, x, y, d) && isPassable(map, flags, nx, ny, reverseDirection(d));
}

/** Tells whether any tile layer of a cell has a given flag. */
function layeredFlag(map: PassabilityMap, flags: readonly number[], x: number, y: number, bit: number): boolean {
  if (!isValidPosition(map, x, y)) return false;
  for (let z = 0; z < 4; z++) if (((flags[tileAt(map, x, y, z)] ?? 0) & bit) !== 0) return true;
  return false;
}

/** Bush cell: the lower part of characters is drawn semi-transparent. */
export const isBush = (map: PassabilityMap, flags: readonly number[], x: number, y: number): boolean =>
  layeredFlag(map, flags, x, y, FLAG_BUSH);
/** Ladder cell: characters face up. */
export const isLadder = (map: PassabilityMap, flags: readonly number[], x: number, y: number): boolean =>
  layeredFlag(map, flags, x, y, FLAG_LADDER);
/** Counter cell: the action button reaches the event behind it. */
export const isCounter = (map: PassabilityMap, flags: readonly number[], x: number, y: number): boolean =>
  layeredFlag(map, flags, x, y, FLAG_COUNTER);
/** Damage floor. */
export const isDamageFloor = (map: PassabilityMap, flags: readonly number[], x: number, y: number): boolean =>
  layeredFlag(map, flags, x, y, FLAG_DAMAGE);

/** Terrain tag of a cell (highest layer with a non-zero tag). */
export function terrainTagAt(map: PassabilityMap, flags: readonly number[], x: number, y: number): number {
  for (let z = 3; z >= 0; z--) {
    const tag = terrainTag(flags[tileAt(map, x, y, z)] ?? 0);
    if (tag > 0) return tag;
  }
  return 0;
}

/**
 * Finds a path with A* (4 directions) from one cell to another.
 * @param blocked - Extra blocking test for cells (e.g. solid events).
 * @param maxNodes - Search budget, to keep clicks far away cheap.
 * @returns The list of directions to follow, or `null` when unreachable. If the
 *   goal itself cannot be entered, the path leads to the closest reachable cell.
 */
export function findPath(
  map: PassabilityMap,
  flags: readonly number[],
  from: { x: number; y: number },
  to: { x: number; y: number },
  blocked: (x: number, y: number) => boolean = () => false,
  maxNodes = 4000,
): number[] | null {
  const w = map.width;
  const key = (x: number, y: number) => y * w + x;
  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const open: { k: number; f: number }[] = [{ k: key(from.x, from.y), f: h(from.x, from.y) }];
  const g = new Map<number, number>([[key(from.x, from.y), 0]]);
  const came = new Map<number, { prev: number; d: number }>();
  let best = { k: key(from.x, from.y), h: h(from.x, from.y) };
  let visited = 0;
  while (open.length > 0 && visited < maxNodes) {
    // Small maps: a linear scan for the lowest f is simpler than a heap and fast enough.
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
    const { k } = open.splice(bi, 1)[0]!;
    visited++;
    const x = k % w;
    const y = Math.floor(k / w);
    const hc = h(x, y);
    if (hc < best.h) best = { k, h: hc };
    if (hc === 0) break;
    for (const d of [2, 4, 6, 8]) {
      if (!canMove(map, flags, x, y, d)) continue;
      const { dx, dy } = directionOffset(d);
      const nx = x + dx;
      const ny = y + dy;
      if (blocked(nx, ny) && !(nx === to.x && ny === to.y)) continue;
      const nk = key(nx, ny);
      const ng = g.get(k)! + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, { prev: k, d });
        open.push({ k: nk, f: ng + h(nx, ny) });
      }
    }
  }
  const goal = g.has(key(to.x, to.y)) ? key(to.x, to.y) : best.k;
  if (goal === key(from.x, from.y)) return null;
  const path: number[] = [];
  for (let k = goal; k !== key(from.x, from.y); ) {
    const step = came.get(k);
    if (!step) return null;
    path.push(step.d);
    k = step.prev;
  }
  return path.reverse();
}
