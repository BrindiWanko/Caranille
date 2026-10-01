/**
 * @file Renders a map to a bitmap with the generated tileset canvases, using
 * the same drawing rules as the client renderer (quarter assembly for
 * autotiles, lower tiles, shadows, then star tiles). Used to preview maps from
 * the command line and in tests comparing autotile output.
 *
 * Usage: `tsx assets/generators/map-preview.ts <out.png>` renders the demo village.
 */
import { writeFileSync } from 'node:fs';
import type { PixelCanvas } from '../../shared/art/pixel.js';
import { PixelCanvas as Canvas } from '../../shared/art/pixel.js';
import { SHADOW_LAYER, tileAt, type MapData } from '../../shared/map.js';
import { FLAG_STAR, autotileSource, isAutotile, plainTileSource, type TilesetSheet } from '../../shared/tiles.js';
import { buildDemoVillage } from '../../server/db/demo-map.js';
import { encodePng } from './png.js';
import { outsideTileset } from './tilesets.js';

const T = 16;
const H = T / 2;

/** Draws one tile id at a destination (logical pixels). */
export function drawTile(out: PixelCanvas, sheets: Partial<Record<TilesetSheet, PixelCanvas>>, id: number, dx: number, dy: number, frame = 0): void {
  if (id === 0) return;
  if (isAutotile(id)) {
    const src = autotileSource(id, frame);
    const sheet = sheets[src.sheet];
    if (!sheet) return;
    const quarters = src.table[(id - 2048) % 48]!;
    quarters.forEach(([qx, qy], i) => {
      out.blit(sheet, dx + (i % 2) * H, dy + Math.floor(i / 2) * H, {
        sx: src.bx * T + qx * H,
        sy: src.by * T + qy * H,
        sw: H,
        sh: H,
      });
    });
    return;
  }
  const src = plainTileSource(id);
  const sheet = sheets[src.sheet];
  if (sheet) out.blit(sheet, dx, dy, { sx: src.col * T, sy: src.row * T, sw: T, sh: T });
}

/** Renders a whole map (lower tiles, shadows, star tiles). */
export function renderMap(map: MapData, sheets: Partial<Record<TilesetSheet, PixelCanvas>>, flags: readonly number[], frame = 0): PixelCanvas {
  const out = new Canvas(map.width * T, map.height * T);
  for (const pass of ['lower', 'upper'] as const) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        for (let z = 0; z < 4; z++) {
          const id = tileAt(map, x, y, z);
          const star = ((flags[id] ?? 0) & FLAG_STAR) !== 0 && id !== 0;
          if ((pass === 'upper') === star) drawTile(out, sheets, id, x * T, y * T, frame);
          if (pass === 'lower' && z === 1) {
            const bits = tileAt(map, x, y, SHADOW_LAYER);
            for (let q = 0; q < 4; q++) {
              if (bits & (1 << q)) out.fillRect(x * T + (q % 2) * H, y * T + Math.floor(q / 2) * H, H, H, '#00000080');
            }
          }
        }
      }
    }
  }
  return out;
}

if (process.argv[1]?.endsWith('map-preview.ts')) {
  const tileset = outsideTileset();
  const png = encodePng(renderMap(buildDemoVillage(), tileset.sheets, tileset.flags), 2);
  writeFileSync(process.argv[2] ?? 'map-preview.png', png);
  console.log('map preview written');
}
