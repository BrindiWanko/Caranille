/**
 * @file Tile specification of the standard tileset format.
 *
 * This module is the single source of truth for how tile ids, tileset sheets,
 * tile flags and autotiles work. It is used by the SVG generators (to draw
 * sheets with the right layout), by the client renderer (to find the source
 * rectangle of each tile), by the editor (to compute autotile shapes when
 * painting) and by the importers.
 *
 * ## Tile ids
 * A map cell stores a numeric tile id. Ranges:
 *
 * | Range         | Sheet | Content                                              |
 * |---------------|-------|------------------------------------------------------|
 * | 0 – 255       | B     | 256 plain tiles                                      |
 * | 256 – 511     | C     | 256 plain tiles                                      |
 * | 512 – 767     | D     | 256 plain tiles                                      |
 * | 768 – 1023    | E     | 256 plain tiles                                      |
 * | 1536 – 1663   | A5    | 128 plain tiles                                      |
 * | 2048 – 2815   | A1    | 16 animated water autotile kinds × 48 shapes         |
 * | 2816 – 4351   | A2    | 32 ground autotile kinds × 48 shapes                 |
 * | 4352 – 5887   | A3    | 32 building (roof / wall) autotile kinds × 48 shapes |
 * | 5888 – 8191   | A4    | 48 wall autotile kinds (top / side) × 48 shapes      |
 *
 * Id 0 in layers above the ground means "empty". An autotile id is
 * `2048 + kind * 48 + shape`; the shape (0–47) says which neighbours are of
 * the same kind and therefore which quarter-tiles are assembled.
 *
 * ## Sheets (sizes given in tiles; multiply by the tile size, 48 px by default)
 * - A1: 16 × 12, A2: 16 × 12, A3: 16 × 8, A4: 16 × 15, A5: 8 × 16, B–E: 16 × 16.
 * - An autotile kind occupies a "block": 2 × 3 tiles for floor-type autotiles
 *   (top-left tile = isolated preview, top-right tile = four inner corners,
 *   bottom 2 × 2 tiles = a large patch with outer corners and edges),
 *   2 × 2 tiles for wall-type autotiles (edges on the four borders) and
 *   2 × 1 tiles per frame for waterfalls.
 */

/** First tile id of each range. */
export const TILE_ID_B = 0;
export const TILE_ID_C = 256;
export const TILE_ID_D = 512;
export const TILE_ID_E = 768;
export const TILE_ID_A5 = 1536;
export const TILE_ID_A1 = 2048;
export const TILE_ID_A2 = 2816;
export const TILE_ID_A3 = 4352;
export const TILE_ID_A4 = 5888;
export const TILE_ID_MAX = 8192;

/** Number of shapes per autotile kind. */
export const AUTOTILE_SHAPES = 48;

/** Default tile size in pixels. */
export const DEFAULT_TILE_SIZE = 48;

/** Order of sheet names inside a tileset's `tilesetNames` array. */
export const TILESET_SHEETS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'] as const;

/** One of the nine tileset sheets. */
export type TilesetSheet = (typeof TILESET_SHEETS)[number];

/** Size of each sheet, in tiles. */
export const SHEET_SIZE_IN_TILES: Record<TilesetSheet, { cols: number; rows: number }> = {
  A1: { cols: 16, rows: 12 },
  A2: { cols: 16, rows: 12 },
  A3: { cols: 16, rows: 8 },
  A4: { cols: 16, rows: 15 },
  A5: { cols: 8, rows: 16 },
  B: { cols: 16, rows: 16 },
  C: { cols: 16, rows: 16 },
  D: { cols: 16, rows: 16 },
  E: { cols: 16, rows: 16 },
};

// ---------------------------------------------------------------------------
// Tile flags (one 16-bit value per tile id in a tileset's `flags` array)
// ---------------------------------------------------------------------------

/** Bit set = cannot leave/enter the tile moving down. */
export const FLAG_BLOCK_DOWN = 0x0001;
/** Bit set = blocked towards the left. */
export const FLAG_BLOCK_LEFT = 0x0002;
/** Bit set = blocked towards the right. */
export const FLAG_BLOCK_RIGHT = 0x0004;
/** Bit set = blocked moving up. */
export const FLAG_BLOCK_UP = 0x0008;
/** All four directions blocked: the tile is impassable ("X"). */
export const FLAG_IMPASSABLE = 0x000f;
/** Star: the tile is drawn above characters and never affects passability. */
export const FLAG_STAR = 0x0010;
/** Ladder: characters face up while on it. */
export const FLAG_LADDER = 0x0020;
/** Bush: the lower part of characters standing on it is drawn semi-transparent. */
export const FLAG_BUSH = 0x0040;
/** Counter: characters can talk across it (action reaches one tile further). */
export const FLAG_COUNTER = 0x0080;
/** Damage floor: hurts characters walking on it. */
export const FLAG_DAMAGE = 0x0100;
/** Impassable by small boats. */
export const FLAG_BOAT_BLOCK = 0x0200;
/** Impassable by ships. */
export const FLAG_SHIP_BLOCK = 0x0400;
/** Airships cannot land here. */
export const FLAG_AIRSHIP_BLOCK = 0x0800;
/** Terrain tag (0–7), stored in the four high bits. */
export const TERRAIN_TAG_SHIFT = 12;

/**
 * Extracts the terrain tag of a flag value.
 * @param flag - Tile flag.
 */
export function terrainTag(flag: number): number {
  return (flag >> TERRAIN_TAG_SHIFT) & 0xf;
}

// ---------------------------------------------------------------------------
// Tile id helpers
// ---------------------------------------------------------------------------

/** Tells whether an id is in the autotile range (A1–A4). */
export function isAutotile(tileId: number): boolean {
  return tileId >= TILE_ID_A1 && tileId < TILE_ID_MAX;
}

/** Autotile kind (0–127) of an autotile id. */
export function autotileKind(tileId: number): number {
  return Math.floor((tileId - TILE_ID_A1) / AUTOTILE_SHAPES);
}

/** Autotile shape (0–47) of an autotile id. */
export function autotileShape(tileId: number): number {
  return (tileId - TILE_ID_A1) % AUTOTILE_SHAPES;
}

/**
 * Builds an autotile id.
 * @param kind - Autotile kind (0–127).
 * @param shape - Shape (0–47).
 */
export function makeAutotileId(kind: number, shape: number): number {
  return TILE_ID_A1 + kind * AUTOTILE_SHAPES + shape;
}

/** Tells whether two tile ids belong to the same autotile kind (or are the same plain tile). */
export function isSameKindTile(a: number, b: number): boolean {
  if (isAutotile(a) && isAutotile(b)) return autotileKind(a) === autotileKind(b);
  return a === b;
}

export const isTileA1 = (id: number): boolean => id >= TILE_ID_A1 && id < TILE_ID_A2;
export const isTileA2 = (id: number): boolean => id >= TILE_ID_A2 && id < TILE_ID_A3;
export const isTileA3 = (id: number): boolean => id >= TILE_ID_A3 && id < TILE_ID_A4;
export const isTileA4 = (id: number): boolean => id >= TILE_ID_A4 && id < TILE_ID_MAX;
export const isTileA5 = (id: number): boolean => id >= TILE_ID_A5 && id < TILE_ID_A5 + 128;

/** Tells whether an A1 kind is a waterfall (odd kinds from 5 upward). */
export function isWaterfallKind(kind: number): boolean {
  return kind >= 4 && kind < 16 && kind % 2 === 1;
}

/** Tells whether an A4 kind is a wall side (odd rows of the A4 sheet). */
export function isWallSideKind(kind: number): boolean {
  if (kind < 80 || kind >= 128) return false;
  return Math.floor((kind - 80) / 8) % 2 === 1;
}

/** Tells whether an autotile id is a roof (even rows of A3). */
export function isRoofKind(kind: number): boolean {
  return kind >= 48 && kind < 80 && Math.floor((kind - 48) / 8) % 2 === 0;
}

/**
 * Tells whether a tile id is a "wall-type" autotile, i.e. uses the 16-shape
 * wall table (A3 roofs and walls, A4 wall sides).
 */
export function isWallTypeAutotile(tileId: number): boolean {
  if (isTileA3(tileId)) return true;
  return isTileA4(tileId) && isWallSideKind(autotileKind(tileId));
}

/**
 * Tells whether a tile id is an A2 ground drawn as an overlay (transparent
 * outside its patch), meant to sit on layer 1 above a base ground. In field
 * tilesets, the four right-hand block columns of A2 hold these overlays.
 */
export function isGroundOverlayKind(kind: number): boolean {
  return kind >= 16 && kind < 48 && (kind - 16) % 8 >= 4;
}

// ---------------------------------------------------------------------------
// Autotile quarter tables
// ---------------------------------------------------------------------------
//
// Each shape is assembled from four quarter-tiles in the order
// [top-left, top-right, bottom-left, bottom-right]. Each entry gives the source
// quarter as [qx, qy] in half-tile units, relative to the kind's block.

/** A quarter source position, in half-tile units inside a block. */
export type Quarter = readonly [number, number];
/** Four quarters: top-left, top-right, bottom-left, bottom-right. */
export type ShapeQuarters = readonly [Quarter, Quarter, Quarter, Quarter];

/** Floor-type table (48 shapes) used by A1, A2 and A4 wall tops. */
export const FLOOR_AUTOTILE_TABLE: readonly ShapeQuarters[] = [
  [[2, 4], [1, 4], [2, 3], [1, 3]], [[2, 0], [1, 4], [2, 3], [1, 3]],
  [[2, 4], [3, 0], [2, 3], [1, 3]], [[2, 0], [3, 0], [2, 3], [1, 3]],
  [[2, 4], [1, 4], [2, 3], [3, 1]], [[2, 0], [1, 4], [2, 3], [3, 1]],
  [[2, 4], [3, 0], [2, 3], [3, 1]], [[2, 0], [3, 0], [2, 3], [3, 1]],
  [[2, 4], [1, 4], [2, 1], [1, 3]], [[2, 0], [1, 4], [2, 1], [1, 3]],
  [[2, 4], [3, 0], [2, 1], [1, 3]], [[2, 0], [3, 0], [2, 1], [1, 3]],
  [[2, 4], [1, 4], [2, 1], [3, 1]], [[2, 0], [1, 4], [2, 1], [3, 1]],
  [[2, 4], [3, 0], [2, 1], [3, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]],
  [[0, 4], [1, 4], [0, 3], [1, 3]], [[0, 4], [3, 0], [0, 3], [1, 3]],
  [[0, 4], [1, 4], [0, 3], [3, 1]], [[0, 4], [3, 0], [0, 3], [3, 1]],
  [[2, 2], [1, 2], [2, 3], [1, 3]], [[2, 2], [1, 2], [2, 3], [3, 1]],
  [[2, 2], [1, 2], [2, 1], [1, 3]], [[2, 2], [1, 2], [2, 1], [3, 1]],
  [[2, 4], [3, 4], [2, 3], [3, 3]], [[2, 4], [3, 4], [2, 1], [3, 3]],
  [[2, 0], [3, 4], [2, 3], [3, 3]], [[2, 0], [3, 4], [2, 1], [3, 3]],
  [[2, 4], [1, 4], [2, 5], [1, 5]], [[2, 0], [1, 4], [2, 5], [1, 5]],
  [[2, 4], [3, 0], [2, 5], [1, 5]], [[2, 0], [3, 0], [2, 5], [1, 5]],
  [[0, 4], [3, 4], [0, 3], [3, 3]], [[2, 2], [1, 2], [2, 5], [1, 5]],
  [[0, 2], [1, 2], [0, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [3, 1]],
  [[2, 2], [3, 2], [2, 3], [3, 3]], [[2, 2], [3, 2], [2, 1], [3, 3]],
  [[2, 4], [3, 4], [2, 5], [3, 5]], [[2, 0], [3, 4], [2, 5], [3, 5]],
  [[0, 4], [1, 4], [0, 5], [1, 5]], [[0, 4], [3, 0], [0, 5], [1, 5]],
  [[0, 2], [3, 2], [0, 3], [3, 3]], [[0, 2], [1, 2], [0, 5], [1, 5]],
  [[0, 4], [3, 4], [0, 5], [3, 5]], [[2, 2], [3, 2], [2, 5], [3, 5]],
  [[0, 2], [3, 2], [0, 5], [3, 5]], [[0, 0], [1, 0], [0, 1], [1, 1]],
];

/**
 * Wall-type table (16 shapes) used by A3 and A4 wall sides. The shape index is
 * a bit set of the borders that are edges: 1 = left, 2 = top, 4 = right, 8 = bottom.
 */
export const WALL_AUTOTILE_TABLE: readonly ShapeQuarters[] = [
  [[2, 2], [1, 2], [2, 1], [1, 1]], [[0, 2], [1, 2], [0, 1], [1, 1]],
  [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[2, 2], [3, 2], [2, 1], [3, 1]], [[0, 2], [3, 2], [0, 1], [3, 1]],
  [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]],
  [[2, 2], [1, 2], [2, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [1, 3]],
  [[2, 0], [1, 0], [2, 3], [1, 3]], [[0, 0], [1, 0], [0, 3], [1, 3]],
  [[2, 2], [3, 2], [2, 3], [3, 3]], [[0, 2], [3, 2], [0, 3], [3, 3]],
  [[2, 0], [3, 0], [2, 3], [3, 3]], [[0, 0], [3, 0], [0, 3], [3, 3]],
];

/** Waterfall table (4 shapes): bit 1 = left edge, bit 2 = right edge. */
export const WATERFALL_AUTOTILE_TABLE: readonly ShapeQuarters[] = [
  [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]],
];

// ---------------------------------------------------------------------------
// Source rectangles
// ---------------------------------------------------------------------------

/** Where to read an autotile: sheet, block origin (in tiles) and quarter table. */
export interface AutotileSource {
  sheet: 'A1' | 'A2' | 'A3' | 'A4';
  /** Block origin, in tiles. */
  bx: number;
  by: number;
  table: readonly ShapeQuarters[];
  /** For A2 "counter/table" kinds, drawn with a front face. */
  isTable?: boolean;
}

/**
 * Locates the block of an autotile kind in its sheet for a given animation frame.
 *
 * A1 layout: kinds 0 and 1 (sea, deep sea) have three animated frames side by
 * side (block columns 0, 2, 4); kinds 2 and 3 are static decorations at block
 * column 6. Kinds 4–15 are laid out in 8-tile-wide groups: even kinds are
 * animated water (three frames side by side), odd kinds are waterfalls whose
 * three frames are stacked vertically in the 2-tile column to the right.
 * Water uses the frame sequence 0-1-2-1; waterfalls cycle 0-1-2.
 *
 * @param tileId - Autotile id.
 * @param animationFrame - Global animation counter (incremented a few times per second).
 */
export function autotileSource(tileId: number, animationFrame = 0): AutotileSource {
  const kind = autotileKind(tileId);
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  if (isTileA1(tileId)) {
    const waterFrame = [0, 1, 2, 1][animationFrame % 4]!;
    if (kind === 0) return { sheet: 'A1', bx: waterFrame * 2, by: 0, table: FLOOR_AUTOTILE_TABLE };
    if (kind === 1) return { sheet: 'A1', bx: waterFrame * 2, by: 3, table: FLOOR_AUTOTILE_TABLE };
    if (kind === 2) return { sheet: 'A1', bx: 6, by: 0, table: FLOOR_AUTOTILE_TABLE };
    if (kind === 3) return { sheet: 'A1', bx: 6, by: 3, table: FLOOR_AUTOTILE_TABLE };
    const bx = Math.floor(tx / 4) * 8;
    const by = ty * 6 + (Math.floor(tx / 2) % 2) * 3;
    if (kind % 2 === 0) return { sheet: 'A1', bx: bx + waterFrame * 2, by, table: FLOOR_AUTOTILE_TABLE };
    return { sheet: 'A1', bx: bx + 6, by: by + (animationFrame % 3), table: WATERFALL_AUTOTILE_TABLE };
  }
  if (isTileA2(tileId)) {
    return { sheet: 'A2', bx: tx * 2, by: (ty - 2) * 3, table: FLOOR_AUTOTILE_TABLE };
  }
  if (isTileA3(tileId)) {
    return { sheet: 'A3', bx: tx * 2, by: (ty - 6) * 2, table: WALL_AUTOTILE_TABLE };
  }
  // A4: rows alternate between wall tops (3 tiles high, floor table) and wall sides (2 tiles high, wall table).
  const side = ty % 2 === 1;
  return {
    sheet: 'A4',
    bx: tx * 2,
    by: Math.floor((ty - 10) * 2.5 + (side ? 0.5 : 0)),
    table: side ? WALL_AUTOTILE_TABLE : FLOOR_AUTOTILE_TABLE,
  };
}

/**
 * Source position (in tiles) of a plain tile (A5, B–E) in its sheet.
 * B–E sheets are two 8-column halves: ids 0–127 fill the left half row by
 * row, ids 128–255 the right half.
 * @param tileId - Plain tile id.
 */
export function plainTileSource(tileId: number): { sheet: TilesetSheet; col: number; row: number } {
  const sheet: TilesetSheet = isTileA5(tileId) ? 'A5' : (['B', 'C', 'D', 'E'] as const)[Math.floor(tileId / 256)]!;
  return {
    sheet,
    col: (Math.floor(tileId / 128) % 2) * 8 + (tileId % 8),
    row: Math.floor((tileId % 256) / 8) % 16,
  };
}

/**
 * Inverse of `plainTileSource` for B–E: tile id of a cell of a B–E sheet.
 * @param sheetIndex - 0 for B, 1 for C, 2 for D, 3 for E.
 * @param col - Column (0–15).
 * @param row - Row (0–15).
 */
export function plainTileId(sheetIndex: number, col: number, row: number): number {
  return sheetIndex * 256 + (col >= 8 ? 128 : 0) + row * 8 + (col % 8);
}

/**
 * Tile id of an A5 cell.
 * @param col - Column (0–7).
 * @param row - Row (0–15).
 */
export function a5TileId(col: number, row: number): number {
  return TILE_ID_A5 + row * 8 + col;
}

// ---------------------------------------------------------------------------
// Shape computation (editor painting)
// ---------------------------------------------------------------------------

/**
 * Neighbour sameness around a cell, used to pick an autotile shape. Each field
 * is `true` when the neighbour is of the same autotile kind (map borders count
 * as "same" so that patches continue past the edge).
 */
export interface Neighbours {
  n: boolean; ne: boolean; e: boolean; se: boolean;
  s: boolean; sw: boolean; w: boolean; nw: boolean;
}

/** Quarter category for floor autotiles, derived from the three neighbours touching a corner. */
function floorQuarterCategory(vertical: boolean, horizontal: boolean, diagonal: boolean): string {
  if (!vertical && !horizontal) return 'outer';
  if (!vertical) return 'v-edge';
  if (!horizontal) return 'h-edge';
  if (!diagonal) return 'inner';
  return 'fill';
}

/** Category of each source quarter position in a floor block, per corner. */
function sourceCategory(corner: number, q: Quarter): string {
  const [qx, qy] = q;
  if (qy <= 1) return qx <= 1 ? 'preview' : 'inner';
  const isLeftCol = qx === 0;
  const isRightCol = qx === 3;
  const isTopRow = qy === 2;
  const isBottomRow = qy === 5;
  // For each corner, which block border is "outside" at that corner.
  const vOut = corner < 2 ? isTopRow : isBottomRow;
  const hOut = corner % 2 === 0 ? isLeftCol : isRightCol;
  if (vOut && hOut) return 'outer';
  if (vOut) return 'v-edge';
  if (hOut) return 'h-edge';
  return 'fill';
}

/** Precomputed quarter categories of each floor shape (0–46; shape 47 is the preview only). */
const FLOOR_SHAPE_KEYS: string[] = FLOOR_AUTOTILE_TABLE.map((quarters, shape) =>
  shape === 47 ? '' : quarters.map((q, corner) => sourceCategory(corner, q)).join('|'),
);

/**
 * Computes the floor autotile shape (0–46) matching a neighbourhood. The shape
 * is found by matching each corner's category against the quarter table, so
 * it is consistent with the renderer by construction.
 * @param nb - Neighbour sameness.
 */
export function floorShape(nb: Neighbours): number {
  const key = [
    floorQuarterCategory(nb.n, nb.w, nb.nw),
    floorQuarterCategory(nb.n, nb.e, nb.ne),
    floorQuarterCategory(nb.s, nb.w, nb.sw),
    floorQuarterCategory(nb.s, nb.e, nb.se),
  ].join('|');
  const shape = FLOOR_SHAPE_KEYS.indexOf(key);
  return shape === -1 ? 0 : shape;
}

/**
 * Computes the wall autotile shape (0–15): one bit per border that differs.
 * @param nb - Neighbour sameness (diagonals are ignored).
 */
export function wallShape(nb: Neighbours): number {
  return (nb.w ? 0 : 1) | (nb.n ? 0 : 2) | (nb.e ? 0 : 4) | (nb.s ? 0 : 8);
}

/**
 * Computes the waterfall shape (0–3).
 * @param nb - Neighbour sameness (only left/right matter).
 */
export function waterfallShape(nb: Neighbours): number {
  return (nb.w ? 0 : 1) | (nb.e ? 0 : 2);
}
