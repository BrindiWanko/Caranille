/**
 * @file Tile map renderer.
 *
 * Drawing order per cell (lower pass): layer 0, layer 1, shadows, layer 2,
 * layer 3, skipping star tiles; star tiles are drawn in the upper pass, after
 * characters. Autotiles are assembled from four quarters using the tables of
 * `shared/tiles.ts`; animated water (A1) cycles frames 0-1-2-1 and waterfalls
 * 0-1-2, advancing every 30 frames (half a second).
 *
 * Performance: the map is split into chunks of 16 × 16 cells rendered once
 * into offscreen canvases. Cells containing an animated tile are left out of
 * the chunk and redrawn every frame (their whole lower stack, so layers above
 * the water stay in order). Sheets of any tile size are accepted: the source
 * tile size is derived from each sheet's width, and scaled to the map tile size.
 */
import { SHADOW_LAYER, tileAt, type MapData } from '../../shared/map.js';
import {
  AUTOTILE_SHAPES,
  FLAG_STAR,
  SHEET_SIZE_IN_TILES,
  TILESET_SHEETS,
  TILE_ID_A1,
  autotileSource,
  isAutotile,
  isTileA1,
  plainTileSource,
  type TilesetSheet,
} from '../../shared/tiles.js';
import type { Bitmap } from './assets.js';

/** Cells per chunk side. */
const CHUNK = 16;
/** Frames between animation steps of water tiles. */
export const TILE_ANIMATION_FRAMES = 30;

interface Chunk {
  lower: HTMLCanvasElement | null;
  upper: HTMLCanvasElement | null;
  /** Cells whose lower stack is animated (drawn every frame). */
  animated: number[];
  dirty: boolean;
}

/** Renders the tile layers of one map. */
export class TilemapRenderer {
  private chunks: Chunk[] = [];
  private cols = 0;
  private rows = 0;
  /** Global animation counter (frames at 60 fps). */
  animationCount = 0;
  /** Tile layers drawn (the editor can show a single layer). */
  private visible: readonly boolean[] = [true, true, true, true];

  /**
   * @param map - Map cells.
   * @param flags - Tileset flags.
   * @param sheets - Loaded sheets by slot.
   * @param tileSize - Destination tile size in pixels.
   */
  constructor(
    private map: Pick<MapData, 'width' | 'height' | 'data'>,
    private flags: readonly number[],
    private sheets: Partial<Record<TilesetSheet, Bitmap>>,
    readonly tileSize: number,
  ) {
    this.reset();
  }

  /** Current animation frame index (increments every 30 frames). */
  get animationFrame(): number {
    return Math.floor(this.animationCount / TILE_ANIMATION_FRAMES);
  }

  /** Replaces the map (after an edit) and invalidates every chunk. */
  setMap(map: Pick<MapData, 'width' | 'height' | 'data'>, flags: readonly number[], sheets: Partial<Record<TilesetSheet, Bitmap>>): void {
    this.map = map;
    this.flags = flags;
    this.sheets = sheets;
    this.reset();
  }

  /**
   * Chooses which tile layers are drawn (all by default).
   * @param layer - Only layer shown (0–3), or `null` for every layer.
   */
  showOnlyLayer(layer: number | null): void {
    this.visible = [0, 1, 2, 3].map((z) => layer === null || z === layer);
    this.reset();
  }

  /** Marks the chunks covering a rectangle for redraw. */
  invalidate(x0: number, y0: number, x1: number, y1: number): void {
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        const chunk = this.chunks[cy * this.cols + cx];
        if (chunk) chunk.dirty = true;
      }
    }
  }

  private reset(): void {
    this.cols = Math.ceil(this.map.width / CHUNK);
    this.rows = Math.ceil(this.map.height / CHUNK);
    this.chunks = Array.from({ length: this.cols * this.rows }, () => ({ lower: null, upper: null, animated: [], dirty: true }));
  }

  private isStar(id: number): boolean {
    return id !== 0 && ((this.flags[id] ?? 0) & FLAG_STAR) !== 0;
  }

  /**
   * Draws one tile.
   * @param ctx - Destination.
   * @param id - Tile id.
   * @param dx - Destination x in pixels.
   * @param dy - Destination y in pixels.
   * @param frame - Animation frame index.
   */
  drawTile(ctx: CanvasRenderingContext2D, id: number, dx: number, dy: number, frame: number): void {
    if (id <= 0) return;
    const T = this.tileSize;
    if (isAutotile(id)) {
      const src = autotileSource(id, frame);
      const sheet = this.sheets[src.sheet];
      if (!sheet) return;
      const st = sheet.width / SHEET_SIZE_IN_TILES[src.sheet].cols;
      const half = st / 2;
      const quarters = src.table[(id - TILE_ID_A1) % AUTOTILE_SHAPES];
      if (!quarters) return;
      for (let i = 0; i < 4; i++) {
        const [qx, qy] = quarters[i]!;
        ctx.drawImage(sheet, src.bx * st + qx * half, src.by * st + qy * half, half, half, dx + (i % 2) * (T / 2), dy + (i >> 1) * (T / 2), T / 2, T / 2);
      }
      return;
    }
    const src = plainTileSource(id);
    const sheet = this.sheets[src.sheet];
    if (!sheet) return;
    const st = sheet.width / SHEET_SIZE_IN_TILES[src.sheet].cols;
    ctx.drawImage(sheet, src.col * st, src.row * st, st, st, dx, dy, T, T);
  }

  /** Draws the shadow bits of a cell (one dark quarter per set bit). */
  private drawShadow(ctx: CanvasRenderingContext2D, bits: number, dx: number, dy: number): void {
    if (!bits) return;
    const h = this.tileSize / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    for (let q = 0; q < 4; q++) if (bits & (1 << q)) ctx.fillRect(dx + (q % 2) * h, dy + (q >> 1) * h, h, h);
  }

  /** Draws the lower (non-star) stack of a cell. */
  private drawLowerCell(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, frame: number): void {
    for (let z = 0; z < 4; z++) {
      const id = tileAt(this.map, x, y, z);
      if (this.visible[z] && !this.isStar(id)) this.drawTile(ctx, id, dx, dy, frame);
      if (z === 1) this.drawShadow(ctx, tileAt(this.map, x, y, SHADOW_LAYER), dx, dy);
    }
  }

  private cellIsAnimated(x: number, y: number): boolean {
    for (let z = 0; z < 4; z++) {
      const id = tileAt(this.map, x, y, z);
      if (isTileA1(id) && !this.isStar(id)) return true;
    }
    return false;
  }

  private buildChunk(index: number): void {
    const chunk = this.chunks[index]!;
    const T = this.tileSize;
    const cx = (index % this.cols) * CHUNK;
    const cy = Math.floor(index / this.cols) * CHUNK;
    const w = Math.min(CHUNK, this.map.width - cx);
    const h = Math.min(CHUNK, this.map.height - cy);
    const make = () => {
      const c = document.createElement('canvas');
      c.width = w * T;
      c.height = h * T;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      return c;
    };
    const lower = chunk.lower ?? make();
    const lctx = lower.getContext('2d')!;
    lctx.clearRect(0, 0, lower.width, lower.height);
    let upper = chunk.upper;
    upper?.getContext('2d')!.clearRect(0, 0, upper.width, upper.height);
    let upperUsed = false;
    chunk.animated = [];
    for (let y = cy; y < cy + h; y++) {
      for (let x = cx; x < cx + w; x++) {
        const dx = (x - cx) * T;
        const dy = (y - cy) * T;
        if (this.cellIsAnimated(x, y)) chunk.animated.push(y * this.map.width + x);
        else this.drawLowerCell(lctx, x, y, dx, dy, 0);
        for (let z = 0; z < 4; z++) {
          const id = tileAt(this.map, x, y, z);
          if (!this.visible[z] || !this.isStar(id)) continue;
          upper ??= make();
          this.drawTile(upper.getContext('2d')!, id, dx, dy, 0);
          upperUsed = true;
        }
      }
    }
    chunk.lower = lower;
    // Most chunks have no star tile: drop their upper canvas to save memory.
    chunk.upper = upperUsed ? upper : null;
    chunk.dirty = false;
  }

  /**
   * Draws a cached chunk canvas with its edges on whole device pixels: at a
   * screen scale such as 110 %, a chunk would otherwise end between two device
   * pixels and leave a thin dark seam with its neighbour. Both neighbours round
   * their shared edge the same way, so they meet exactly.
   */
  private drawChunk(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, px: number, py: number): void {
    const t = ctx.getTransform();
    const sx = t.a || 1;
    const sy = t.d || 1;
    const x0 = Math.round(px * sx + t.e) - t.e;
    const y0 = Math.round(py * sy + t.f) - t.f;
    const x1 = Math.round((px + canvas.width) * sx + t.e) - t.e;
    const y1 = Math.round((py + canvas.height) * sy + t.f) - t.f;
    ctx.drawImage(canvas, x0 / sx, y0 / sy, (x1 - x0) / sx, (y1 - y0) / sy);
  }

  /** Iterates over chunks intersecting a view rectangle (pixels). */
  private visibleChunks(ox: number, oy: number, vw: number, vh: number, fn: (index: number, px: number, py: number) => void): void {
    const span = CHUNK * this.tileSize;
    const x0 = Math.max(0, Math.floor(ox / span));
    const y0 = Math.max(0, Math.floor(oy / span));
    const x1 = Math.min(this.cols - 1, Math.floor((ox + vw) / span));
    const y1 = Math.min(this.rows - 1, Math.floor((oy + vh) / span));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) fn(cy * this.cols + cx, cx * span, cy * span);
  }

  /**
   * Draws the lower pass (under characters).
   * @param ctx - Screen context, already translated so that map pixel (ox, oy) is at the top-left.
   * @param ox - View left in map pixels.
   * @param oy - View top in map pixels.
   * @param vw - View width in pixels.
   * @param vh - View height in pixels.
   */
  drawLower(ctx: CanvasRenderingContext2D, ox: number, oy: number, vw: number, vh: number): void {
    const frame = this.animationFrame;
    const T = this.tileSize;
    this.visibleChunks(ox, oy, vw, vh, (i, px, py) => {
      const chunk = this.chunks[i]!;
      if (chunk.dirty) this.buildChunk(i);
      if (chunk.lower) this.drawChunk(ctx, chunk.lower, px, py);
      for (const cell of chunk.animated) {
        const x = cell % this.map.width;
        const y = Math.floor(cell / this.map.width);
        if ((x + 1) * T < ox || x * T > ox + vw || (y + 1) * T < oy || y * T > oy + vh) continue;
        this.drawLowerCell(ctx, x, y, x * T, y * T, frame);
      }
    });
  }

  /** Draws the upper pass (star tiles, above characters). */
  drawUpper(ctx: CanvasRenderingContext2D, ox: number, oy: number, vw: number, vh: number): void {
    this.visibleChunks(ox, oy, vw, vh, (i, px, py) => {
      const chunk = this.chunks[i]!;
      if (chunk.dirty) this.buildChunk(i);
      if (chunk.upper) this.drawChunk(ctx, chunk.upper, px, py);
    });
  }
}

/** Sheet slots in `tilesetNames` order. */
export const SHEET_SLOTS: readonly TilesetSheet[] = TILESET_SHEETS;
