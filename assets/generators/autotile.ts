/**
 * @file Builders for autotile blocks in the standard sheet layout.
 *
 * A floor-type block is 2 × 3 tiles (32 × 48 logical pixels):
 *   - tile (0,0): the isolated patch, used as palette preview;
 *   - tile (1,0): the four inner corners (a concave bite in each corner);
 *   - tiles (0..1, 1..2): a large 2 × 2 patch whose borders are the edges and
 *     outer corners.
 * The renderer assembles any of the 48 shapes from 8 × 8 quarters of this block.
 *
 * Seamlessness rule: in every quarter table, a quarter keeps the parity of its
 * position (a top-left quarter always comes from an even/even quarter slot), so
 * textures only need a period of 16 pixels (one tile) to join perfectly in any
 * assembled shape. Texture painters therefore receive tile-local coordinates.
 */
import type { Color } from '../../shared/art/pixel.js';
import { PixelCanvas } from '../../shared/art/pixel.js';

/** Returns the texture colour at tile-local coordinates (0–15). */
export type Painter = (x: number, y: number) => Color;

/** Appearance of a floor-type autotile. */
export interface FloorStyle {
  /** Material texture inside the patch. */
  fill: Painter;
  /**
   * Colour of the edge band: called for inside pixels with their distance to
   * the outside (1 = touching it). Return `undefined` to keep the fill colour.
   */
  edge?: (distance: number, x: number, y: number, fillColor: Color) => Color | undefined;
  /** What is drawn outside the patch; `null` leaves it transparent (overlay autotiles). */
  outside: Painter | null;
  /** Corner rounding of the patch, in pixels (default 3). */
  radius?: number;
  /** Width of the edge band examined, in pixels (default 3). */
  edgeWidth?: number;
}

const T = 16;

/** Tells whether (x, y) is inside a box with corners cut by `r` (diamond cut, pixel-art style). */
function insideRoundBox(x: number, y: number, w: number, h: number, r: number): boolean {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const dx = x < r ? r - x : x >= w - r ? x - (w - r - 1) : 0;
  const dy = y < r ? r - y : y >= h - r ? y - (h - r - 1) : 0;
  return dx + dy <= r;
}

/**
 * Paints one region of a floor block from an inside/outside mask.
 * @param region - Region size.
 * @param inside - Mask; coordinates outside the region are passed too (for edge detection).
 */
function paintRegion(
  canvas: PixelCanvas,
  ox: number,
  oy: number,
  w: number,
  h: number,
  inside: (x: number, y: number) => boolean,
  style: FloorStyle,
): void {
  const band = style.edgeWidth ?? 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lx = x % T;
      const ly = y % T;
      if (!inside(x, y)) {
        canvas.set(ox + x, oy + y, style.outside ? style.outside(lx, ly) : null);
        continue;
      }
      const fill = style.fill(lx, ly);
      let color: Color = fill;
      if (style.edge) {
        // Chebyshev distance to the nearest outside pixel, limited to the band width.
        let distance = band + 1;
        for (let d = 1; d <= band && distance > band; d++) {
          for (let j = -d; j <= d && distance > band; j++) {
            for (let i = -d; i <= d; i++) {
              if (Math.max(Math.abs(i), Math.abs(j)) === d && !inside(x + i, y + j)) {
                distance = d;
                break;
              }
            }
          }
        }
        if (distance <= band) color = style.edge(distance, lx, ly, fill) ?? fill;
      }
      canvas.set(ox + x, oy + y, color);
    }
  }
}

/**
 * Draws a floor-type autotile block.
 * @param canvas - Sheet canvas.
 * @param bx - Block left, in tiles.
 * @param by - Block top, in tiles.
 * @param style - Appearance.
 */
export function drawFloorBlock(canvas: PixelCanvas, bx: number, by: number, style: FloorStyle): void {
  const r = style.radius ?? 3;
  const ox = bx * T;
  const oy = by * T;
  // Isolated patch: everything beyond the tile counts as outside.
  paintRegion(canvas, ox, oy, T, T, (x, y) => insideRoundBox(x, y, T, T, r), style);
  // Inner corners: the patch continues beyond the tile; only the four corner bites are outside.
  paintRegion(
    canvas,
    ox + T,
    oy,
    T,
    T,
    (x, y) => {
      if (x < 0 || y < 0 || x >= T || y >= T) return true;
      const cx = x < T / 2 ? x : T - 1 - x;
      const cy = y < T / 2 ? y : T - 1 - y;
      return cx + cy >= r;
    },
    style,
  );
  // Large patch: its outer border is the edge.
  paintRegion(canvas, ox, oy + T, 2 * T, 2 * T, (x, y) => insideRoundBox(x, y, 2 * T, 2 * T, r), style);
}

/** Appearance of a wall-type autotile (A3, A4 sides). */
export interface WallStyle {
  /** Texture of the wall. */
  fill: Painter;
  /**
   * Edge treatment: receives the distance (0-based) to each border of the
   * 2 × 2 block and returns a colour, or `undefined` to keep the fill.
   */
  edge?: (d: { left: number; top: number; right: number; bottom: number }, x: number, y: number, fillColor: Color) => Color | undefined;
}

/**
 * Draws a wall-type autotile block (2 × 2 tiles).
 * @param canvas - Sheet canvas.
 * @param bx - Block left, in tiles.
 * @param by - Block top, in tiles.
 * @param style - Appearance.
 */
export function drawWallBlock(canvas: PixelCanvas, bx: number, by: number, style: WallStyle): void {
  const size = 2 * T;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fill = style.fill(x % T, y % T);
      const d = { left: x, top: y, right: size - 1 - x, bottom: size - 1 - y };
      canvas.set(bx * T + x, by * T + y, style.edge?.(d, x % T, y % T, fill) ?? fill);
    }
  }
}

/**
 * Draws one waterfall frame (2 × 1 tiles): left and right quarters columns are the edges.
 * @param canvas - Sheet canvas.
 * @param bx - Frame left, in tiles.
 * @param by - Frame top, in tiles.
 * @param style - Same interface as wall blocks (top/bottom distances are unused).
 */
export function drawWaterfallFrame(canvas: PixelCanvas, bx: number, by: number, style: WallStyle): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < 2 * T; x++) {
      const fill = style.fill(x % T, y);
      const d = { left: x, top: 99, right: 2 * T - 1 - x, bottom: 99 };
      canvas.set(bx * T + x, by * T + y, style.edge?.(d, x % T, y, fill) ?? fill);
    }
  }
}

/**
 * Builds a seamless 16 × 16 texture and returns a painter reading it.
 * @param draw - Draws the texture; use `wrapSet` so details crossing a border wrap around.
 */
export function texture(draw: (t: TextureCanvas) => void): Painter {
  const canvas = new TextureCanvas();
  draw(canvas);
  return (x, y) => canvas.get(((x % T) + T) % T, ((y % T) + T) % T);
}

/** A 16 × 16 canvas whose writes wrap around (for seamless textures). */
export class TextureCanvas extends PixelCanvas {
  constructor() {
    super(T, T);
  }

  /** Writes a pixel with wrap-around coordinates. */
  wrapSet(x: number, y: number, color: Color): void {
    this.set(((x % T) + T) % T, ((y % T) + T) % T, color);
  }
}
