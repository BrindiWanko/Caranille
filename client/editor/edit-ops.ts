/**
 * @file Map painting operations of the editor, independent of the DOM (and
 * unit-tested). Every operation records the cells it changed so it can be
 * undone and redone.
 *
 * Automatic layer placement (default):
 * - ground tiles (animated water, base grounds, buildings, walls, A5) go to
 *   layer 0 and remove any ground overlay above them (layer 1);
 * - ground overlays (paths, patches, water decorations) go to layer 1;
 * - object tiles (B–E) go to layer 2, or stack on layer 3 when layer 2 already
 *   holds another object; the first B tile (empty) erases both object layers.
 * A layer can also be forced (layers 1–4 in the toolbar) for fine control.
 *
 * Autotile shapes are recomputed around every change.
 */
import { refreshAutotiles } from '../../shared/autotile-shapes.js';
import { REGION_LAYER, SHADOW_LAYER, cellIndex, isValidPosition, tileAt, type MapData } from '../../shared/map.js';
import {
  AUTOTILE_SHAPES,
  TILE_ID_A1,
  TILE_ID_A5,
  autotileKind,
  isAutotile,
  isGroundOverlayKind,
  isTileA1,
  isTileA2,
} from '../../shared/tiles.js';

/** One changed cell value. */
export interface CellChange {
  index: number;
  before: number;
  after: number;
}

/** A palette selection: a rectangle of tile ids (rows of columns), or region ids. */
export interface Stamp {
  tiles: number[][];
  /** `true` when the stamp holds region ids (region mode). */
  region?: boolean;
}

/** Normalises an autotile id to its kind's base id (shape 0). */
export function baseTileId(id: number): number {
  return isAutotile(id) ? TILE_ID_A1 + autotileKind(id) * AUTOTILE_SHAPES : id;
}

/**
 * Layer a tile goes to with automatic placement.
 * @param id - Tile id.
 * @returns 0 or 1 for ground tiles, 2 for objects (see `placeTile` for stacking).
 */
export function autoLayer(id: number): number {
  if (isTileA1(id)) {
    const kind = autotileKind(id);
    return kind === 2 || kind === 3 ? 1 : 0;
  }
  if (isTileA2(id) && isGroundOverlayKind(autotileKind(id))) return 1;
  if (isAutotile(id) || (id >= TILE_ID_A5 && id < TILE_ID_A5 + 128)) return 0;
  return 2;
}

/** Records and applies cell changes on a map. */
export class MapEditor {
  private changes = new Map<number, CellChange>();

  /**
   * @param map - Working copy of the map (modified in place).
   * @param forcedLayer - Layer forced from the toolbar (0–3), or `null` for automatic placement.
   */
  constructor(
    readonly map: MapData,
    public forcedLayer: number | null = null,
  ) {}

  private write(x: number, y: number, z: number, value: number): void {
    if (!isValidPosition(this.map, x, y)) return;
    const index = cellIndex(this.map, x, y, z);
    const before = this.map.data[index]!;
    if (before === value) return;
    const existing = this.changes.get(index);
    this.changes.set(index, { index, before: existing ? existing.before : before, after: value });
    this.map.data[index] = value;
  }

  /** Places one tile at a cell, following the layer rules. */
  placeTile(x: number, y: number, id: number): void {
    if (this.forcedLayer !== null) {
      this.write(x, y, this.forcedLayer, id);
      return;
    }
    const layer = autoLayer(id);
    if (layer === 0) {
      this.write(x, y, 0, id);
      this.write(x, y, 1, 0);
    } else if (layer === 1) {
      this.write(x, y, 1, id);
    } else if (id === 0) {
      this.write(x, y, 2, 0);
      this.write(x, y, 3, 0);
    } else {
      const l2 = tileAt(this.map, x, y, 2);
      const l3 = tileAt(this.map, x, y, 3);
      if (l3 !== 0 || (l2 !== 0 && l2 !== id)) this.write(x, y, 3, id);
      else this.write(x, y, 2, id);
    }
  }

  /** Writes a region id. */
  placeRegion(x: number, y: number, region: number): void {
    this.write(x, y, REGION_LAYER, region);
  }

  /**
   * Stamps a selection with its top-left at a cell; the pattern repeats when
   * `anchor` is given (so strokes and areas tile the selection seamlessly).
   */
  stamp(x: number, y: number, s: Stamp, anchor?: { x: number; y: number }): void {
    const h = s.tiles.length;
    const w = s.tiles[0]?.length ?? 0;
    if (!w || !h) return;
    if (anchor) {
      const row = s.tiles[(((y - anchor.y) % h) + h) % h]!;
      const id = row[(((x - anchor.x) % w) + w) % w]!;
      if (s.region) this.placeRegion(x, y, id);
      else this.placeTile(x, y, id);
      return;
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const id = s.tiles[j]![i]!;
        if (s.region) this.placeRegion(x + i, y + j, id);
        else this.placeTile(x + i, y + j, id);
      }
    }
  }

  /** Fills a rectangle (inclusive corners, any order) with a stamp pattern. */
  rectangle(x0: number, y0: number, x1: number, y1: number, s: Stamp): void {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) this.stamp(x, y, s, { x: ax, y: ay });
  }

  /** Fills the ellipse inscribed in a rectangle with a stamp pattern. */
  ellipse(x0: number, y0: number, x1: number, y1: number, s: Stamp): void {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    const rx = (bx - ax + 1) / 2;
    const ry = (by - ay + 1) / 2;
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.stamp(x, y, s, { x: ax, y: ay });
      }
    }
  }

  /**
   * Flood-fills the contiguous area (4 directions) that looks like the clicked
   * cell: same tiles on every tile layer (autotiles compared by kind), or the
   * same region id in region mode.
   */
  fill(x: number, y: number, s: Stamp): void {
    if (!isValidPosition(this.map, x, y)) return;
    const layers = s.region ? [REGION_LAYER] : this.forcedLayer !== null ? [this.forcedLayer] : [0, 1, 2, 3];
    const signature = (cx: number, cy: number) => layers.map((z) => baseTileId(tileAt(this.map, cx, cy, z))).join(',');
    const target = signature(x, y);
    const seen = new Set<number>();
    const stack = [[x, y]];
    const area: [number, number][] = [];
    while (stack.length > 0 && area.length < 100_000) {
      const [cx, cy] = stack.pop()!;
      const key = cy! * this.map.width + cx!;
      if (seen.has(key) || !isValidPosition(this.map, cx!, cy!)) continue;
      seen.add(key);
      if (signature(cx!, cy!) !== target) continue;
      area.push([cx!, cy!]);
      stack.push([cx! + 1, cy!], [cx! - 1, cy!], [cx!, cy! + 1], [cx!, cy! - 1]);
    }
    for (const [ax, ay] of area) this.stamp(ax, ay, s, { x, y });
  }

  /** Erases the topmost tile of a cell (objects first, then overlay, then ground). */
  erase(x: number, y: number): void {
    if (this.forcedLayer !== null) {
      this.write(x, y, this.forcedLayer, 0);
      return;
    }
    for (const z of [3, 2, 1, 0]) {
      if (tileAt(this.map, x, y, z) !== 0) {
        this.write(x, y, z, 0);
        return;
      }
    }
  }

  /**
   * Sets or clears one shadow quarter.
   * @param quarter - 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
   * @param on - New state.
   */
  shadow(x: number, y: number, quarter: number, on: boolean): void {
    const bits = tileAt(this.map, x, y, SHADOW_LAYER);
    this.write(x, y, SHADOW_LAYER, on ? bits | (1 << quarter) : bits & ~(1 << quarter));
  }

  /** Copies a rectangle of cells (all layers) for the clipboard. */
  copy(x0: number, y0: number, x1: number, y1: number): number[][][] {
    const out: number[][][] = [];
    for (let z = 0; z < 6; z++) {
      const rows: number[][] = [];
      for (let y = y0; y <= y1; y++) {
        const row: number[] = [];
        for (let x = x0; x <= x1; x++) row.push(tileAt(this.map, x, y, z));
        rows.push(row);
      }
      out.push(rows);
    }
    return out;
  }

  /** Pastes clipboard cells with their top-left at a cell. */
  paste(x: number, y: number, clip: number[][][]): void {
    clip.forEach((rows, z) => rows.forEach((row, j) => row.forEach((v, i) => this.write(x + i, y + j, z, v))));
  }

  /** Clears the tile layers of a rectangle. */
  clear(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = 1; z < 4; z++) this.write(x, y, z, 0);
  }

  /**
   * Ends an operation: recomputes autotile shapes around the changed cells and
   * returns every change (including shape updates) for the undo history.
   */
  commit(): CellChange[] {
    if (this.changes.size === 0) return [];
    const cells = this.map.width * this.map.height;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const { index } of this.changes.values()) {
      const c = index % cells;
      const cx = c % this.map.width;
      const cy = Math.floor(c / this.map.width);
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
    }
    // Shape updates are recorded as changes too, so undo restores them exactly.
    const before = new Map<number, number>();
    for (let z = 0; z < 4; z++) {
      for (let y = Math.max(0, y0 - 1); y <= Math.min(this.map.height - 1, y1 + 1); y++) {
        for (let x = Math.max(0, x0 - 1); x <= Math.min(this.map.width - 1, x1 + 1); x++) {
          const i = cellIndex(this.map, x, y, z);
          before.set(i, this.map.data[i]!);
        }
      }
    }
    refreshAutotiles(this.map, x0, y0, x1, y1);
    for (const [i, value] of before) {
      const after = this.map.data[i]!;
      if (after === value) continue;
      const existing = this.changes.get(i);
      this.changes.set(i, { index: i, before: existing ? existing.before : value, after });
    }
    const list = [...this.changes.values()].filter((c) => c.before !== c.after);
    this.changes = new Map();
    return list;
  }
}

/**
 * Applies recorded changes backwards or forwards.
 * @param map - Map to modify.
 * @param changes - Recorded changes.
 * @param undo - `true` to restore the previous values.
 */
export function applyChanges(map: MapData, changes: readonly CellChange[], undo: boolean): void {
  for (const c of changes) map.data[c.index] = undo ? c.before : c.after;
}

/**
 * Picks the tile shown at a cell (topmost non-empty layer) for the eyedropper.
 * @returns The base id of the tile (autotiles as their kind), or 0.
 */
export function pickTile(map: MapData, x: number, y: number): number {
  for (const z of [3, 2, 1, 0]) {
    const id = tileAt(map, x, y, z);
    if (id !== 0) return baseTileId(id);
  }
  return 0;
}
