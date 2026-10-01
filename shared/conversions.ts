/**
 * @file Conversion of older sheet layouts to the standard layout.
 *
 * A conversion never rewrites the creator's image: it produces a *layout*, a
 * list of copy operations (source rectangle in the original image →
 * destination rectangle in a standard sheet). The client composes the
 * standard sheet from the original image with this table when loading it.
 * Virtual sheet names have the form `<image>~<slot>` (for example
 * `Chipset01~A2`), so a tileset can reference converted sheets like any other.
 *
 * Supported layouts:
 * - 32 px sheets (A1–E): identical structure, only scaled — no conversion needed;
 * - legacy autotiles (96 × 128 at 32 px: a single-tile preview and an
 *   inner-corner tile on the first row, then a 3 × 3 patch) → one A2 kind;
 * - legacy tilesets (8 columns of 32 px tiles, any height) → B–E pages
 *   (16 rows per page half, exactly the two-halves layout of B–E sheets);
 * - 16 px chipsets (480 × 256): 12 ground autotiles → A2, 144 lower tiles → A5
 *   and B, 144 upper tiles → C (water and animated tiles are not converted);
 * - 16 px character sheets (288 × 256, rows up/right/down/left) → standard row order;
 * - 16 px face sheets (192 × 192, 4 × 4 faces of 48 px) → two standard 4 × 2 sheets.
 */
import { SHEET_SIZE_IN_TILES, type TilesetSheet } from './tiles.js';

/** One copy operation, in source pixels and destination tile-size units. */
export interface CopyOp {
  /** Source rectangle in the original image (pixels). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination rectangle in the standard sheet, in pixels at the standard size. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** A composed sheet: its size and the copies that build it. */
export interface SheetLayout {
  width: number;
  height: number;
  ops: CopyOp[];
}

/** Layouts produced by converting one image, keyed by virtual slot (e.g. `A2`, `B`, `0`). */
export type ConversionLayouts = Record<string, SheetLayout>;

/** Standard tile size used for converted sheets. */
const T = 48;

function sheetSize(slot: TilesetSheet): { width: number; height: number } {
  const s = SHEET_SIZE_IN_TILES[slot];
  return { width: s.cols * T, height: s.rows * T };
}

/**
 * Quarter mapping from a 3 × 4-tile legacy autotile block (source tile size `st`)
 * to a 2 × 3-tile standard floor block. The standard 4 × 4-quarter patch uses the
 * legacy 6 × 6-quarter patch's outer ring and centre: quarter columns/rows
 * 0, 1, 2, 3 come from 0, 2, 3, 5.
 * @param sx - Source block left (pixels).
 * @param sy - Source block top (pixels).
 * @param st - Source tile size.
 * @param dx - Destination block left (pixels, 48 px tiles).
 * @param dy - Destination block top.
 */
export function legacyAutotileOps(sx: number, sy: number, st: number, dx: number, dy: number): CopyOp[] {
  const sq = st / 2;
  const dq = T / 2;
  const ops: CopyOp[] = [];
  // Top row: preview tile and inner-corner tile are copied whole.
  for (let i = 0; i < 2; i++) ops.push({ sx: sx + i * st, sy, sw: st, sh: st, dx: dx + i * T, dy, dw: T, dh: T });
  const map = [0, 2, 3, 5];
  for (let qy = 0; qy < 4; qy++) {
    for (let qx = 0; qx < 4; qx++) {
      ops.push({
        sx: sx + map[qx]! * sq,
        sy: sy + st + map[qy]! * sq,
        sw: sq,
        sh: sq,
        dx: dx + qx * dq,
        dy: dy + T + qy * dq,
        dw: dq,
        dh: dq,
      });
    }
  }
  return ops;
}

/** Converts a legacy autotile image (96 × 128 at 32 px, or any 3 × 4-tile block) to one A2 kind. */
export function convertLegacyAutotile(width: number): ConversionLayouts {
  const st = width / 3;
  return { A2: { ...sheetSize('A2'), ops: legacyAutotileOps(0, 0, st, 0, 0) } };
}

/**
 * Converts a legacy 8-column tileset to B–E pages.
 * @param width - Image width (8 tiles).
 * @param height - Image height.
 * @returns Layouts for `B`, `C`, `D`, `E` as far as the image goes.
 */
export function convertLegacyTileset(width: number, height: number): ConversionLayouts {
  const st = width / 8;
  const rows = Math.floor(height / st);
  const out: ConversionLayouts = {};
  (['B', 'C', 'D', 'E'] as const).forEach((slot, page) => {
    const ops: CopyOp[] = [];
    for (let half = 0; half < 2; half++) {
      const firstRow = page * 32 + half * 16;
      const count = Math.min(16, rows - firstRow);
      if (count <= 0) continue;
      ops.push({ sx: 0, sy: firstRow * st, sw: 8 * st, sh: count * st, dx: half * 8 * T, dy: 0, dw: 8 * T, dh: count * T });
    }
    if (ops.length) out[slot] = { ...sheetSize(slot), ops };
  });
  return out;
}

/**
 * Converts a 16 px chipset (480 × 256, 30 × 16 tiles).
 *
 * Chipset regions (in 16 px tiles): ground autotiles are 3 × 4 blocks, four at
 * columns 0–5 / rows 8–15 and eight at columns 6–11; the 144 lower tiles fill
 * columns 12–17 (96 tiles) then 18–23 rows 0–7 (48); the 144 upper tiles fill
 * columns 18–23 rows 8–15 (48) then 24–29 (96). Tiles are read in rows of six.
 */
export function convertChipset16(): ConversionLayouts {
  const st = 16;
  const a2: CopyOp[] = [];
  for (let i = 0; i < 12; i++) {
    const [bx, by] = i < 4 ? [(i % 2) * 3, 8 + Math.floor(i / 2) * 4] : [6 + ((i - 4) % 2) * 3, Math.floor((i - 4) / 2) * 4];
    // Standard A2 kinds are laid out eight per row, each 2 × 3 tiles.
    a2.push(...legacyAutotileOps(bx * st, by * st, st, (i % 8) * 2 * T, Math.floor(i / 8) * 3 * T));
  }
  const tileOps = (list: [number, number][], place: (n: number) => [number, number]): CopyOp[] =>
    list.map(([cx, cy], n) => {
      const [tx, ty] = place(n);
      return { sx: cx * st, sy: cy * st, sw: st, sh: st, dx: tx * T, dy: ty * T, dw: T, dh: T };
    });
  const lower: [number, number][] = [];
  for (let n = 0; n < 144; n++) lower.push(n < 96 ? [12 + (n % 6), Math.floor(n / 6)] : [18 + ((n - 96) % 6), Math.floor((n - 96) / 6)]);
  const upper: [number, number][] = [];
  for (let n = 0; n < 144; n++) upper.push(n < 48 ? [18 + (n % 6), 8 + Math.floor(n / 6)] : [24 + ((n - 48) % 6), Math.floor((n - 48) / 6)]);
  // B–E sheets: tile n of a page is at column (n ≥ 128 ? 8 : 0) + n % 8, row floor(n % 128 / 8).
  const pagePlace = (n: number): [number, number] => [(n >= 128 ? 8 : 0) + (n % 8), Math.floor((n % 128) / 8)];
  return {
    A2: { ...sheetSize('A2'), ops: a2 },
    // The first 128 lower tiles become A5 (plain ground tiles, eight per row); the rest start page B.
    A5: { ...sheetSize('A5'), ops: tileOps(lower.slice(0, 128), (n) => [n % 8, Math.floor(n / 8)]) },
    B: { ...sheetSize('B'), ops: tileOps(lower.slice(128), (n) => pagePlace(n + 1)) },
    C: { ...sheetSize('C'), ops: tileOps(upper, (n) => pagePlace(n + 1)) },
  };
}

/** Row of each standard direction (down, left, right, up) in a 16 px character sheet (up, right, down, left). */
const CHAR16_ROW = [2, 3, 1, 0];

/** Converts a 16 px character sheet (288 × 256) to the standard row order at 3× scale. */
export function convertCharacter16(width: number, height: number): ConversionLayouts {
  const fw = width / 12;
  const fh = height / 8;
  const ops: CopyOp[] = [];
  for (let block = 0; block < 8; block++) {
    const bx = (block % 4) * 3;
    const by = Math.floor(block / 4) * 4;
    for (let row = 0; row < 4; row++) {
      ops.push({
        sx: bx * fw,
        sy: (by + CHAR16_ROW[row]!) * fh,
        sw: 3 * fw,
        sh: fh,
        dx: bx * fw * 3,
        dy: (by + row) * fh * 3,
        dw: 3 * fw * 3,
        dh: fh * 3,
      });
    }
  }
  return { '0': { width: width * 3, height: height * 3, ops } };
}

/** Converts a 16 px face sheet (4 × 4 faces of 48 px) to two standard sheets of 4 × 2 faces at 144 px. */
export function convertFace16(width: number): ConversionLayouts {
  const fs = width / 4;
  const out: ConversionLayouts = {};
  for (let sheet = 0; sheet < 2; sheet++) {
    const ops: CopyOp[] = [];
    for (let i = 0; i < 8; i++) {
      const src = sheet * 8 + i;
      ops.push({ sx: (src % 4) * fs, sy: Math.floor(src / 4) * fs, sw: fs, sh: fs, dx: (i % 4) * 144, dy: Math.floor(i / 4) * 144, dw: 144, dh: 144 });
    }
    out[String(sheet)] = { width: 576, height: 288, ops };
  }
  return out;
}

/**
 * Chooses the conversion for a detected format.
 * @returns Layouts, or `null` when the image is used as is.
 */
export function conversionFor(format: string, width: number, height: number): ConversionLayouts | null {
  switch (format) {
    case 'legacy-autotile':
      return convertLegacyAutotile(width);
    case 'legacy-tileset':
      return convertLegacyTileset(width, height);
    case 'chipset16':
      return convertChipset16();
    case 'character-sheet16':
      return convertCharacter16(width, height);
    case 'face-sheet16':
      return convertFace16(width);
    default:
      return null;
  }
}

/**
 * Sheet names a tileset may use for an image: the image itself, or its
 * virtual slots when it is in a convertible layout.
 * @param name - Image name.
 * @param format - Detected format.
 * @param width - Image width.
 * @param height - Image height.
 */
export function tilesetSheetNames(name: string, format: string, width: number, height: number): string[] {
  const layouts = conversionFor(format, width, height);
  return layouts ? Object.keys(layouts).map((slot) => `${name}~${slot}`) : [name];
}

/** Separator between an image name and a virtual slot. */
export const VIRTUAL_SEPARATOR = '~';

/** Splits a virtual sheet name (`image~slot`). */
export function parseVirtualName(name: string): { image: string; slot: string } | null {
  const i = name.lastIndexOf(VIRTUAL_SEPARATOR);
  return i > 0 ? { image: name.slice(0, i), slot: name.slice(i + 1) } : null;
}
