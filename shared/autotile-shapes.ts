/**
 * @file Recomputes autotile shapes after painting.
 *
 * Painting stores the autotile kind; the shape of every autotile cell depends
 * on its eight neighbours in the same layer. After any change, the shapes of
 * the changed cells and of their neighbours are recomputed. Map borders count
 * as "same kind" so that patches continue past the edge of the map.
 */
import { tileAt, setTileAt, type MapData } from './map.js';
import {
  autotileKind,
  floorShape,
  isAutotile,
  isTileA1,
  isWallTypeAutotile,
  isWaterfallKind,
  makeAutotileId,
  wallShape,
  waterfallShape,
  type Neighbours,
} from './tiles.js';

type Cells = Pick<MapData, 'width' | 'height' | 'data'>;

/** Same-kind test used for neighbours; outside the map counts as same. */
function sameKind(map: Cells, x: number, y: number, z: number, kind: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  const id = tileAt(map, x, y, z);
  return isAutotile(id) && autotileKind(id) === kind;
}

/**
 * Computes the correct autotile id for one cell.
 * @param map - Map cells.
 * @param x - Column.
 * @param y - Row.
 * @param z - Layer.
 * @returns The id with its shape updated (plain tiles are returned unchanged).
 */
export function shapedTileAt(map: Cells, x: number, y: number, z: number): number {
  const id = tileAt(map, x, y, z);
  if (!isAutotile(id)) return id;
  const kind = autotileKind(id);
  const same = (dx: number, dy: number) => sameKind(map, x + dx, y + dy, z, kind);
  const nb: Neighbours = {
    n: same(0, -1), ne: same(1, -1), e: same(1, 0), se: same(1, 1),
    s: same(0, 1), sw: same(-1, 1), w: same(-1, 0), nw: same(-1, -1),
  };
  let shape: number;
  if (isTileA1(id) && isWaterfallKind(kind)) shape = waterfallShape(nb);
  else if (isWallTypeAutotile(id)) shape = wallShape(nb);
  else shape = floorShape(nb);
  return makeAutotileId(kind, shape);
}

/**
 * Recomputes shapes in a rectangle (inclusive), extended by one cell on every side.
 * @param map - Map to update in place.
 * @param x0 - Left.
 * @param y0 - Top.
 * @param x1 - Right.
 * @param y1 - Bottom.
 * @param layers - Layers to process (default: the four tile layers).
 */
export function refreshAutotiles(map: Cells, x0: number, y0: number, x1: number, y1: number, layers = [0, 1, 2, 3]): void {
  for (const z of layers) {
    for (let y = Math.max(0, y0 - 1); y <= Math.min(map.height - 1, y1 + 1); y++) {
      for (let x = Math.max(0, x0 - 1); x <= Math.min(map.width - 1, x1 + 1); x++) {
        const id = tileAt(map, x, y, z);
        if (isAutotile(id)) setTileAt(map, x, y, z, shapedTileAt(map, x, y, z));
      }
    }
  }
}

/** Recomputes every autotile shape of a map. */
export function refreshAllAutotiles(map: Cells): void {
  refreshAutotiles(map, 0, 0, map.width - 1, map.height - 1);
}
