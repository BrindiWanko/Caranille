/**
 * @file Characters on the map (player, other players, events): grid position,
 * smooth movement between cells, facing and walking animation, and sprite
 * drawing from character sheets.
 *
 * Movement: a character moves cell by cell; `x, y` is the destination cell and
 * `realX, realY` the interpolated position. At move speed s, the distance per
 * frame is 2^s / 256 tiles (speed 4: 16 frames per tile at 60 fps).
 *
 * Animation: sheets have 3 patterns per direction, played 0-1-2-1; pattern 1
 * is the standing pose. The pattern advances every (9 - speed) × 3 frames,
 * 1.5 × faster while walking.
 *
 * Sheet rules: a name starting with `$` holds one character (3 × 4 frames),
 * otherwise eight (4 × 2 blocks); a name containing `!` right after the
 * optional `$` is drawn without the usual 6-pixel lift and without shadow
 * (doors, chests, flames). Frames are anchored by their bottom centre on the
 * bottom centre of the cell.
 */
import { directionOffset } from '../../shared/map.js';
import type { Direction } from '../../shared/settings.js';
import type { Bitmap } from './assets.js';

/** Where a character's frames come from. */
export interface SpriteSource {
  image: Bitmap;
  /** Treated as a single-character sheet. */
  single: boolean;
  /** Object sheet (`!` prefix). */
  object: boolean;
  /** Character index in a multi-character sheet (0–7). */
  index: number;
}

/**
 * Parses sheet name prefixes.
 * @param name - Character sheet file name.
 */
export function sheetFlags(name: string): { single: boolean; object: boolean } {
  return { single: /^!?\$/.test(name), object: /^\$?!/.test(name) };
}

/** A character on the map. */
export class MapCharacter {
  x = 0;
  y = 0;
  realX = 0;
  realY = 0;
  direction: Direction = 2;
  moveSpeed = 4;
  pattern = 1;
  walkAnime = true;
  stepAnime = false;
  directionFix = false;
  /** Tile id drawn instead of a character sheet (tile events). */
  tileId = 0;
  sprite: SpriteSource | null = null;
  /** Standing on a bush cell (lower part drawn semi-transparent). */
  bush = false;
  /** Opacity 0–1. */
  opacity = 1;
  private animationCount = 0;

  /** Places the character on a cell instantly. */
  locate(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.realX = x;
    this.realY = y;
  }

  /** Tells whether the character is between two cells. */
  isMoving(): boolean {
    return this.realX !== this.x || this.realY !== this.y;
  }

  /** Faces a direction unless the direction is fixed. */
  setDirection(d: Direction): void {
    if (!this.directionFix) this.direction = d;
  }

  /** Starts a step towards `d` (the caller has checked passability). */
  moveStraight(d: Direction): void {
    this.setDirection(d);
    const { dx, dy } = directionOffset(d);
    this.x += dx;
    this.y += dy;
  }

  /** Distance covered per frame, in tiles. */
  distancePerFrame(): number {
    return 2 ** this.moveSpeed / 256;
  }

  /** Advances movement and animation by one frame (1/60 s). */
  update(): void {
    const moving = this.isMoving();
    if (moving) {
      const step = this.distancePerFrame();
      if (this.x < this.realX) this.realX = Math.max(this.realX - step, this.x);
      if (this.x > this.realX) this.realX = Math.min(this.realX + step, this.x);
      if (this.y < this.realY) this.realY = Math.max(this.realY - step, this.y);
      if (this.y > this.realY) this.realY = Math.min(this.realY + step, this.y);
    }
    if (moving && this.walkAnime) this.animationCount += 1.5;
    else if (this.stepAnime || this.pattern !== 1) this.animationCount += 1;
    if (this.animationCount >= (9 - this.moveSpeed) * 3) {
      this.animationCount = 0;
      if (!moving && !this.stepAnime) this.pattern = 1;
      else this.pattern = (this.pattern + 1) % 4;
    }
  }

  /** Pattern column (0–2) derived from the 4-step cycle. */
  patternColumn(): number {
    return this.pattern < 3 ? this.pattern : 1;
  }

  /**
   * Draws the character.
   * @param ctx - Context translated to map pixels.
   * @param tileSize - Tile size in pixels.
   * @param shadow - Shadow image drawn under non-object characters (optional).
   * @param drawTile - Callback drawing a tile id (for tile events).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    tileSize: number,
    shadow: Bitmap | null,
    drawTile: (id: number, dx: number, dy: number) => void,
  ): void {
    const px = this.realX * tileSize;
    const py = this.realY * tileSize;
    ctx.globalAlpha = this.opacity;
    if (this.tileId > 0) {
      drawTile(this.tileId, px, py);
      ctx.globalAlpha = 1;
      return;
    }
    const s = this.sprite;
    if (!s) {
      ctx.globalAlpha = 1;
      return;
    }
    const fw = s.image.width / (s.single ? 3 : 12);
    const fh = s.image.height / (s.single ? 4 : 8);
    const blockX = s.single ? 0 : (s.index % 4) * 3;
    const blockY = s.single ? 0 : Math.floor(s.index / 4) * 4;
    const sx = (blockX + this.patternColumn()) * fw;
    const sy = (blockY + (this.direction - 2) / 2) * fh;
    const lift = s.object ? 0 : Math.round((tileSize * 6) / 48);
    const dx = Math.round(px + tileSize / 2 - fw / 2);
    const dy = Math.round(py + tileSize - fh - lift);
    if (shadow && !s.object) {
      ctx.drawImage(shadow, Math.round(px + tileSize / 2 - shadow.width / 2), Math.round(py + tileSize - shadow.height - lift / 2));
    }
    if (this.bush && !s.object) {
      // The lower part of the body is drawn semi-transparent, as if hidden by the bush.
      const depth = Math.round((tileSize * 12) / 48);
      ctx.drawImage(s.image, sx, sy, fw, fh - depth, dx, dy, fw, fh - depth);
      ctx.globalAlpha = this.opacity * 0.5;
      ctx.drawImage(s.image, sx, sy + fh - depth, fw, depth, dx, dy + fh - depth, fw, depth);
    } else {
      ctx.drawImage(s.image, sx, sy, fw, fh, dx, dy, fw, fh);
    }
    ctx.globalAlpha = 1;
  }

  /** Screen-space sort key (lower = drawn first). */
  sortY(): number {
    return this.realY;
  }
}
