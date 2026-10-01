/**
 * @file Bridges the shared pixel-art canvas and the browser: draws a
 * `PixelCanvas` into an HTML canvas at an integer scale, and builds animated
 * character previews from appearance parameters.
 */
import { drawCharacterFrame, type CharacterAppearance, type Facing } from '../../shared/art/character.js';
import type { PixelCanvas } from '../../shared/art/pixel.js';

/**
 * Converts a pixel canvas to `ImageData` (one image pixel per logical pixel).
 * @param pc - Source.
 */
export function toImageData(pc: PixelCanvas): ImageData {
  const image = new ImageData(pc.width, pc.height);
  for (let i = 0; i < pc.data.length; i++) {
    const c = pc.data[i];
    if (!c) continue;
    image.data[i * 4] = Number.parseInt(c.slice(1, 3), 16);
    image.data[i * 4 + 1] = Number.parseInt(c.slice(3, 5), 16);
    image.data[i * 4 + 2] = Number.parseInt(c.slice(5, 7), 16);
    image.data[i * 4 + 3] = c.length === 9 ? Number.parseInt(c.slice(7, 9), 16) : 255;
  }
  return image;
}

/**
 * Renders a pixel canvas into a new offscreen canvas at an integer scale.
 * @param pc - Source.
 * @param scale - Magnification (1 real pixel per logical pixel × scale).
 */
export function rasterize(pc: PixelCanvas, scale: number): HTMLCanvasElement {
  const base = document.createElement('canvas');
  base.width = pc.width;
  base.height = pc.height;
  base.getContext('2d')!.putImageData(toImageData(pc), 0, 0);
  if (scale === 1) return base;
  const out = document.createElement('canvas');
  out.width = pc.width * scale;
  out.height = pc.height * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, out.width, out.height);
  return out;
}

/** An animated character preview bound to a canvas element. */
export class CharacterPreview {
  private frames = new Map<string, HTMLCanvasElement>();
  private tick = 0;
  private timer: number | undefined;
  /** Facing direction shown. */
  direction: Facing = 'down';
  /** When `false`, the character stands still. */
  walking = true;

  /**
   * @param canvas - Target canvas; its size is set to one frame at `scale`.
   * @param appearance - Initial appearance.
   * @param scale - Real pixels per logical pixel.
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private appearance: CharacterAppearance,
    private readonly scale = 3,
  ) {
    this.canvas.width = 24 * scale;
    this.canvas.height = 32 * scale;
    this.draw();
  }

  /** Replaces the appearance and redraws. */
  setAppearance(appearance: CharacterAppearance): void {
    this.appearance = appearance;
    this.frames.clear();
    this.draw();
  }

  /** Turns the character by a quarter turn (clockwise when `step` is 1). */
  rotate(step: 1 | -1): void {
    const order: Facing[] = ['down', 'left', 'up', 'right'];
    this.direction = order[(order.indexOf(this.direction) + step + 4) % 4]!;
    this.draw();
  }

  /** Starts the walking animation (0-1-2-1 cycle). */
  start(interval = 200): void {
    this.stop();
    this.timer = window.setInterval(() => {
      this.tick++;
      this.draw();
    }, interval);
  }

  /** Stops the animation. */
  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private draw(): void {
    const frame = this.walking ? [0, 1, 2, 1][this.tick % 4]! : 1;
    const key = `${this.direction}:${frame}`;
    let image = this.frames.get(key);
    if (!image) {
      image = rasterize(drawCharacterFrame(this.appearance, this.direction, frame), this.scale);
      this.frames.set(key, image);
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(image, 0, 0);
  }
}

