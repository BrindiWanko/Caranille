/**
 * @file Entry point of `npm run assets:build`: runs every SVG generator and
 * writes the resulting sheets into `assets/img/<kind>/`, plus the default
 * tileset definitions (sheet names and flags) into `assets/data/tilesets.json`,
 * which the database seed imports on a fresh server.
 *
 * Options: `--tile-size=48|32|16` (default 48) sets the pixel size of the
 * generated sheets; one logical pixel becomes `tileSize / 16` SVG units.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_ID_A1, TILE_ID_A2, TILESET_SHEETS } from '../../shared/tiles.js';
import { characterSheets } from './characters.js';
import type { PixelCanvas } from '../../shared/art/pixel.js';
import { encodePng } from './png.js';
import { systemSheets } from './system.js';
import { DEFAULT_TILESET_SHEETS, dungeonTileset, insideTileset, outsideTileset } from './tilesets.js';
import { cavernTileset, jungleTileset, seaTileset, volcanoTileset } from './tilesets-biomes.js';

/** A generated graphic: path relative to `assets/img/` (without extension) and its canvas. */
export interface GeneratedImage {
  path: string;
  canvas: PixelCanvas;
  /** Fixed SVG units per logical pixel (system graphics); defaults to tile size / 16. */
  scale?: number;
}

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function parseTileSize(): number {
  const arg = process.argv.find((a) => a.startsWith('--tile-size='));
  const size = arg ? Number(arg.split('=')[1]) : 48;
  if (![48, 32, 16].includes(size)) throw new Error('--tile-size must be 48, 32 or 16');
  return size;
}

/** Default tileset record, as stored by the seed. */
export interface TilesetData {
  id: number;
  name: string;
  mode: number;
  tilesetNames: string[];
  flags: number[];
}

function main(): void {
  const tileSize = parseTileSize();
  const scale = tileSize / 16;
  const images: GeneratedImage[] = [];

  const outside = outsideTileset();
  const inside = insideTileset();
  const dungeon = dungeonTileset();
  const biomes = [cavernTileset(), jungleTileset(), volcanoTileset(), seaTileset()];
  // Tilesets that reuse the Outside liquids sheet get the same A1 flags.
  for (const ts of [dungeon, ...biomes]) {
    if (DEFAULT_TILESET_SHEETS[ts.name]![0] !== 'Outside_A1') continue;
    for (let id = TILE_ID_A1; id < TILE_ID_A2; id++) ts.flags[id] = outside.flags[id]!;
  }

  const tilesets: TilesetData[] = [];
  [outside, inside, dungeon, ...biomes].forEach((ts, index) => {
    for (const sheet of TILESET_SHEETS) {
      const canvas = ts.sheets[sheet];
      if (canvas) images.push({ path: `tilesets/${ts.name}_${sheet}`, canvas });
    }
    tilesets.push({ id: index + 1, name: ts.name, mode: ts.mode, tilesetNames: DEFAULT_TILESET_SHEETS[ts.name]!, flags: ts.flags });
  });

  images.push(...characterSheets(), ...systemSheets());

  // Optional bitmap previews for visual checks: --png=<directory>.
  const pngArg = process.argv.find((a) => a.startsWith('--png='));
  const pngDir = pngArg?.slice('--png='.length);

  let bytes = 0;
  for (const image of images) {
    const file = join(ROOT, 'img', `${image.path}.svg`);
    mkdirSync(dirname(file), { recursive: true });
    const svg = image.canvas.toSvg(image.scale ?? scale);
    writeFileSync(file, svg);
    bytes += svg.length;
    if (pngDir) {
      const png = join(pngDir, `${image.path.replaceAll('/', '__')}.png`);
      mkdirSync(dirname(png), { recursive: true });
      writeFileSync(png, encodePng(image.canvas, 2, '#40304a'));
    }
  }
  const dataFile = join(ROOT, 'data', 'tilesets.json');
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, `${JSON.stringify({ tileSize, tilesets })}\n`);

  console.log(`assets:build - ${images.length} image(s), ${(bytes / 1024).toFixed(0)} KiB of SVG, tile size ${tileSize}px`);
}

main();
