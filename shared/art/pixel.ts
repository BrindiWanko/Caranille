/**
 * @file Pixel-art canvas shared by the SVG generators (build time) and the
 * browser client (character previews generated on the fly).
 *
 * Graphics are drawn on a grid of "logical pixels" (16 per tile side), then
 * exported as SVG where each logical pixel becomes a `scale × scale` square
 * (scale = tile size / 16, i.e. 3 for 48 px tiles). Export is compact: pixels
 * of the same colour are merged into horizontal runs and all runs of one
 * colour share a single `<path>`, so a full sheet stays small.
 */

/** A colour: `#rrggbb`, `#rrggbbaa`, or `null` for transparent. */
export type Color = string | null;

/** Deterministic pseudo-random generator (mulberry32), so generated art is stable between builds. */
export class Rng {
  private state: number;

  /** @param seed - Any integer; the same seed always yields the same sequence. */
  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Random element of an array. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** `true` with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/**
 * Hashes a string into a seed, so each asset can derive its own stable RNG.
 * @param text - Any string (e.g. the asset id).
 */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A mutable grid of logical pixels. */
export class PixelCanvas {
  readonly data: Color[];

  /**
   * @param width - Width in logical pixels.
   * @param height - Height in logical pixels.
   */
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Array<Color>(width * height).fill(null);
  }

  /** Tells whether a coordinate is inside the canvas. */
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Reads a pixel (transparent outside the canvas). */
  get(x: number, y: number): Color {
    return this.inside(x, y) ? this.data[y * this.width + x]! : null;
  }

  /** Writes a pixel; coordinates outside the canvas are ignored. */
  set(x: number, y: number, color: Color): void {
    if (this.inside(x, y)) this.data[y * this.width + x] = color;
  }

  /** Writes a pixel only where the canvas is currently opaque (to shade existing shapes). */
  shade(x: number, y: number, color: Color): void {
    if (this.get(x, y) !== null) this.set(x, y, color);
  }

  /** Fills a rectangle. */
  fillRect(x: number, y: number, w: number, h: number, color: Color): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, color);
  }

  /** Draws a one-pixel rectangle outline. */
  strokeRect(x: number, y: number, w: number, h: number, color: Color): void {
    for (let i = x; i < x + w; i++) {
      this.set(i, y, color);
      this.set(i, y + h - 1, color);
    }
    for (let j = y; j < y + h; j++) {
      this.set(x, j, color);
      this.set(x + w - 1, j, color);
    }
  }

  /** Horizontal line from x1 to x2 inclusive. */
  hline(x1: number, x2: number, y: number, color: Color): void {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) this.set(x, y, color);
  }

  /** Vertical line from y1 to y2 inclusive. */
  vline(x: number, y1: number, y2: number, color: Color): void {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) this.set(x, y, color);
  }

  /** Bresenham line. Coordinates are rounded: fractional endpoints would never be reached. */
  line(x0: number, y0: number, x1: number, y1: number, color: Color): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /**
   * Fills an axis-aligned ellipse inscribed in a box.
   * @param x - Box left.
   * @param y - Box top.
   * @param w - Box width.
   * @param h - Box height.
   */
  fillEllipse(x: number, y: number, w: number, h: number, color: Color): void {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        const nx = (i + 0.5 - cx) / rx;
        const ny = (j + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(i, j, color);
      }
    }
  }

  /**
   * Fills a rectangle with its corners cut by `r` pixels (pixel-art rounded box).
   */
  fillRoundRect(x: number, y: number, w: number, h: number, r: number, color: Color): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const dx = i < r ? r - i : i >= w - r ? i - (w - r - 1) : 0;
        const dy = j < r ? r - j : j >= h - r ? j - (h - r - 1) : 0;
        if (dx + dy <= r) this.set(x + i, y + j, color);
      }
    }
  }

  /**
   * Draws a one-pixel dark outline around every opaque region (outside the shape).
   * @param color - Outline colour.
   * @param diagonal - Also outline diagonal neighbours (thicker look).
   */
  outline(color: Color, diagonal = false): void {
    const add: number[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.get(x, y) !== null) continue;
        const touches =
          this.get(x - 1, y) !== null ||
          this.get(x + 1, y) !== null ||
          this.get(x, y - 1) !== null ||
          this.get(x, y + 1) !== null ||
          (diagonal &&
            (this.get(x - 1, y - 1) !== null ||
              this.get(x + 1, y - 1) !== null ||
              this.get(x - 1, y + 1) !== null ||
              this.get(x + 1, y + 1) !== null));
        if (touches) add.push(y * this.width + x);
      }
    }
    for (const i of add) this.data[i] = color;
  }

  /**
   * Copies another canvas onto this one (transparent source pixels are skipped).
   * @param src - Source canvas.
   * @param dx - Destination x.
   * @param dy - Destination y.
   * @param options - `flipX` mirrors horizontally; `sx/sy/sw/sh` select a source region.
   */
  blit(
    src: PixelCanvas,
    dx: number,
    dy: number,
    options: { flipX?: boolean; sx?: number; sy?: number; sw?: number; sh?: number; opaque?: boolean } = {},
  ): void {
    const sx = options.sx ?? 0;
    const sy = options.sy ?? 0;
    const sw = options.sw ?? src.width;
    const sh = options.sh ?? src.height;
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        const c = src.get(sx + (options.flipX ? sw - 1 - i : i), sy + j);
        if (c !== null || options.opaque) this.set(dx + i, dy + j, c);
      }
    }
  }

  /** Returns a copy of a region. */
  crop(x: number, y: number, w: number, h: number): PixelCanvas {
    const out = new PixelCanvas(w, h);
    out.blit(this, 0, 0, { sx: x, sy: y, sw: w, sh: h, opaque: true });
    return out;
  }

  /** Replaces every pixel of one colour by another. */
  recolor(map: Record<string, Color>): void {
    for (let i = 0; i < this.data.length; i++) {
      const c = this.data[i];
      if (c && Object.hasOwn(map, c)) this.data[i] = map[c]!;
    }
  }

  /**
   * Draws an ASCII pixel map. Each character is looked up in `palette`;
   * characters absent from the palette (typically `.` or space) are skipped.
   * @param rows - Lines of the drawing.
   * @param x - Destination x.
   * @param y - Destination y.
   * @param palette - Character to colour mapping.
   * @param flipX - Mirror horizontally.
   */
  drawMap(rows: readonly string[], x: number, y: number, palette: Record<string, Color>, flipX = false): void {
    rows.forEach((row, j) => {
      const width = row.length;
      for (let i = 0; i < width; i++) {
        const ch = row[i]!;
        if (!Object.hasOwn(palette, ch)) continue;
        this.set(x + (flipX ? width - 1 - i : i), y + j, palette[ch]!);
      }
    });
  }

  /**
   * Exports as an SVG document.
   * @param scale - Size of one logical pixel in SVG units (tile size / 16).
   */
  toSvg(scale: number): string {
    const runs = new Map<string, string[]>();
    for (let y = 0; y < this.height; y++) {
      let x = 0;
      while (x < this.width) {
        const color = this.data[y * this.width + x]!;
        let len = 1;
        while (x + len < this.width && this.data[y * this.width + x + len] === color) len++;
        if (color !== null) {
          const list = runs.get(color) ?? [];
          list.push(`M${x * scale} ${y * scale}h${len * scale}v${scale}h${-len * scale}z`);
          runs.set(color, list);
        }
        x += len;
      }
    }
    const w = this.width * scale;
    const h = this.height * scale;
    const paths = [...runs].map(([color, d]) => {
      // #rrggbbaa is split into fill + fill-opacity for the widest renderer support.
      if (color.length === 9) {
        const alpha = (Number.parseInt(color.slice(7), 16) / 255).toFixed(3);
        return `<path fill="${color.slice(0, 7)}" fill-opacity="${alpha}" d="${d.join('')}"/>`;
      }
      return `<path fill="${color}" d="${d.join('')}"/>`;
    });
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
      `shape-rendering="crispEdges">${paths.join('')}</svg>\n`
    );
  }
}

/**
 * Mixes two `#rrggbb` colours.
 * @param a - First colour.
 * @param b - Second colour.
 * @param t - 0 returns `a`, 1 returns `b`.
 */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => Number.parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => Number.parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Adds an alpha channel to a `#rrggbb` colour.
 * @param color - Opaque colour.
 * @param alpha - Opacity between 0 and 1.
 */
export function withAlpha(color: string, alpha: number): string {
  return color.slice(0, 7) + Math.round(alpha * 255).toString(16).padStart(2, '0');
}
