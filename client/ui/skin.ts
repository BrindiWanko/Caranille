/**
 * @file Applies the window skin image to the DOM interface.
 *
 * The skin (`system/Window`, standard 192 × 192 layout) is cut into parts that
 * become CSS custom properties on the document root:
 * `--skin-back` (stretched background), `--skin-pattern` (tiled pattern),
 * `--skin-frame` (9-slice border image, 24 px corners), `--skin-cursor`
 * (selection highlight, 4 px corners), `--skin-pause` (4-frame sprite strip)
 * and `--tc-0` … `--tc-31` (text colours for the `\C[n]` code). Replacing the
 * skin file by another image of the same layout re-skins every window.
 */
import type { Bitmap } from '../engine/assets.js';

function part(skin: Bitmap, x: number, y: number, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(skin, x, y, w, h, 0, 0, w, h);
  return `url("${c.toDataURL('image/png')}")`;
}

/**
 * Installs the skin. The skin may be of any size with the standard proportions
 * (coordinates are scaled from the 192 × 192 reference).
 * @param skin - Decoded skin image.
 */
export function applyWindowSkin(skin: Bitmap): void {
  const k = skin.width / 192;
  const root = document.documentElement.style;
  root.setProperty('--skin-back', part(skin, 0, 0, 96 * k, 96 * k));
  root.setProperty('--skin-pattern', part(skin, 0, 96 * k, 96 * k, 96 * k));
  root.setProperty('--skin-frame', part(skin, 96 * k, 0, 96 * k, 96 * k));
  root.setProperty('--skin-cursor', part(skin, 96 * k, 96 * k, 48 * k, 48 * k));
  // The pause sign's four frames are rearranged into a horizontal strip for a CSS steps() animation.
  const strip = document.createElement('canvas');
  strip.width = 96 * k;
  strip.height = 24 * k;
  const sctx = strip.getContext('2d')!;
  for (let f = 0; f < 4; f++) {
    sctx.drawImage(skin, (144 + (f % 2) * 24) * k, (96 + Math.floor(f / 2) * 24) * k, 24 * k, 24 * k, f * 24 * k, 0, 24 * k, 24 * k);
  }
  root.setProperty('--skin-pause', `url("${strip.toDataURL('image/png')}")`);
  const ctx = skin.getContext('2d')!;
  for (let n = 0; n < 32; n++) {
    const px = Math.floor((96 + (n % 8) * 12 + 6) * k);
    const py = Math.floor((144 + Math.floor(n / 8) * 12 + 6) * k);
    const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
    root.setProperty(`--tc-${n}`, `rgb(${r}, ${g}, ${b})`);
  }
}

/**
 * Installs the icon sheet as a CSS variable used by `.icon` elements.
 * @param url - URL of the icon sheet.
 * @param columns - Icons per row.
 */
export function applyIconSet(url: string, columns = 16): void {
  document.documentElement.style.setProperty('--iconset', `url("${url}")`);
  document.documentElement.style.setProperty('--iconset-columns', String(columns));
}
