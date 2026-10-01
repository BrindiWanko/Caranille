/**
 * @file Helper to assemble a tileset: the nine sheet canvases (A1–E) in the
 * standard layout, and the 8192-entry flags table (passability, star, bush,
 * counter...). Tileset generators call its methods with tile coordinates; the
 * builder takes care of sheet geometry and of giving every shape of an
 * autotile kind the same flags.
 */
import {
  AUTOTILE_SHAPES,
  FLAG_STAR,
  SHEET_SIZE_IN_TILES,
  TILE_ID_A1,
  TILE_ID_A2,
  TILE_ID_A3,
  TILE_ID_A4,
  TILE_ID_MAX,
  TILESET_SHEETS,
  a5TileId,
  plainTileId,
  type TilesetSheet,
} from '../../shared/tiles.js';
import { drawFloorBlock, drawWallBlock, drawWaterfallFrame, type FloorStyle, type WallStyle } from './autotile.js';
import { PixelCanvas } from '../../shared/art/pixel.js';

/** Logical pixels per tile side. */
export const T = 16;

/** Tileset display modes. */
export const TilesetMode = { World: 0, Area: 1, Legacy32: 2 } as const;

/** Result of a tileset generator. */
export interface GeneratedTileset {
  /** Base name; sheets are saved as `<name>_<sheet>.svg` (e.g. `Outside_A2`). */
  name: string;
  mode: number;
  /** Canvases of the sheets that contain something. */
  sheets: Partial<Record<TilesetSheet, PixelCanvas>>;
  flags: number[];
}

/** Mutable tileset under construction. */
export class TilesetBuilder {
  readonly flags: number[] = new Array<number>(TILE_ID_MAX).fill(0);
  private readonly sheets = new Map<TilesetSheet, PixelCanvas>();

  /**
   * @param name - Tileset base name.
   * @param mode - Tileset mode.
   */
  constructor(
    readonly name: string,
    readonly mode: number = TilesetMode.Area,
  ) {
    // Tile id 0 is the "empty" tile of upper layers: it must never block anything.
    this.flags[0] = FLAG_STAR;
  }

  /** Returns (creating if needed) the canvas of a sheet. */
  sheet(name: TilesetSheet): PixelCanvas {
    let canvas = this.sheets.get(name);
    if (!canvas) {
      const size = SHEET_SIZE_IN_TILES[name];
      canvas = new PixelCanvas(size.cols * T, size.rows * T);
      this.sheets.set(name, canvas);
    }
    return canvas;
  }

  /** Sets the flags of every shape of an autotile kind. */
  kindFlags(kind: number, flag: number): void {
    const first = TILE_ID_A1 + kind * AUTOTILE_SHAPES;
    for (let s = 0; s < AUTOTILE_SHAPES; s++) this.flags[first + s] = flag;
  }

  /**
   * Draws an A1 animated water kind (0, 1, or an even kind ≥ 4): three frames side by side.
   * @param kind - A1 kind.
   * @param styleForFrame - Style of each frame (0–2).
   * @param flag - Tile flags.
   */
  a1Water(kind: number, styleForFrame: (frame: number) => FloorStyle, flag: number): void {
    const canvas = this.sheet('A1');
    const { bx, by } = a1Block(kind);
    for (let f = 0; f < 3; f++) drawFloorBlock(canvas, bx + f * 2, by, styleForFrame(f));
    this.kindFlags(kind, flag);
  }

  /** Draws an A1 static decoration kind (2 or 3). */
  a1Decoration(kind: 2 | 3, style: FloorStyle, flag: number): void {
    drawFloorBlock(this.sheet('A1'), 6, kind === 2 ? 0 : 3, style);
    this.kindFlags(kind, flag);
  }

  /** Draws an A1 waterfall kind (odd kind ≥ 5): three frames stacked vertically. */
  a1Waterfall(kind: number, styleForFrame: (frame: number) => WallStyle, flag: number): void {
    const canvas = this.sheet('A1');
    const { bx, by } = a1Block(kind);
    for (let f = 0; f < 3; f++) drawWaterfallFrame(canvas, bx, by + f, styleForFrame(f));
    this.kindFlags(kind, flag);
  }

  /**
   * Draws an A2 ground kind.
   * @param col - Block column (0–7).
   * @param row - Block row (0–3).
   */
  a2(col: number, row: number, style: FloorStyle, flag: number): void {
    drawFloorBlock(this.sheet('A2'), col * 2, row * 3, style);
    this.kindFlags((TILE_ID_A2 - TILE_ID_A1) / AUTOTILE_SHAPES + row * 8 + col, flag);
  }

  /**
   * Draws an A3 building kind (rows 0 and 2 are roofs, 1 and 3 walls).
   * @param col - Block column (0–7).
   * @param row - Block row (0–3).
   */
  a3(col: number, row: number, style: WallStyle, flag: number): void {
    drawWallBlock(this.sheet('A3'), col * 2, row * 2, style);
    this.kindFlags((TILE_ID_A3 - TILE_ID_A1) / AUTOTILE_SHAPES + row * 8 + col, flag);
  }

  /**
   * Draws an A4 wall top (floor-type block).
   * @param col - Block column (0–7).
   * @param pair - Top/side pair (0–2).
   */
  a4Top(col: number, pair: number, style: FloorStyle, flag: number): void {
    drawFloorBlock(this.sheet('A4'), col * 2, pair * 5, style);
    this.kindFlags((TILE_ID_A4 - TILE_ID_A1) / AUTOTILE_SHAPES + pair * 16 + col, flag);
  }

  /** Draws an A4 wall side (wall-type block) under the top of the same pair. */
  a4Side(col: number, pair: number, style: WallStyle, flag: number): void {
    drawWallBlock(this.sheet('A4'), col * 2, pair * 5 + 3, style);
    this.kindFlags((TILE_ID_A4 - TILE_ID_A1) / AUTOTILE_SHAPES + pair * 16 + 8 + col, flag);
  }

  /**
   * Draws a plain A5 tile.
   * @param col - Column (0–7).
   * @param row - Row (0–15).
   * @param draw - Receives the sheet and the tile's pixel origin.
   */
  a5(col: number, row: number, draw: (c: PixelCanvas, x: number, y: number) => void, flag: number): void {
    draw(this.sheet('A5'), col * T, row * T);
    this.flags[a5TileId(col, row)] = flag;
  }

  /**
   * Draws an object spanning one or more plain tiles of a B–E sheet.
   * @param sheet - 'B', 'C', 'D' or 'E'.
   * @param col - Left column (0–15).
   * @param row - Top row (0–15).
   * @param draw - Receives the sheet and the pixel origin of the top-left tile.
   * @param flags - Flags per covered tile, row by row (`flags[row][col]`); a single number applies to all.
   * @param size - Size in tiles.
   */
  object(
    sheet: 'B' | 'C' | 'D' | 'E',
    col: number,
    row: number,
    draw: (c: PixelCanvas, x: number, y: number) => void,
    flags: number | number[][],
    size: { w: number; h: number } = { w: 1, h: 1 },
  ): void {
    const canvas = this.sheet(sheet);
    const sheetIndex = TILESET_SHEETS.indexOf(sheet) - 5;
    draw(canvas, col * T, row * T);
    for (let j = 0; j < size.h; j++) {
      for (let i = 0; i < size.w; i++) {
        const f = typeof flags === 'number' ? flags : (flags[j]?.[i] ?? 0);
        this.flags[plainTileId(sheetIndex, col + i, row + j)] = f;
      }
    }
  }

  /** Finalises the tileset. */
  build(): GeneratedTileset {
    return { name: this.name, mode: this.mode, sheets: Object.fromEntries(this.sheets), flags: this.flags };
  }
}

/** Block origin (in tiles) of an A1 kind, frame 0. */
function a1Block(kind: number): { bx: number; by: number } {
  if (kind === 0) return { bx: 0, by: 0 };
  if (kind === 1) return { bx: 0, by: 3 };
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  const bx = Math.floor(tx / 4) * 8 + (kind % 2 === 1 ? 6 : 0);
  const by = ty * 6 + (Math.floor(tx / 2) % 2) * 3;
  return { bx, by };
}
