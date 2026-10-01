/**
 * @file Resource kinds and sheet format detection.
 *
 * Images are classified by folder (`tilesets`, `characters`...) and, inside a
 * folder, by file name and pixel size. Detection lets the editor accept sheets
 * made for other tile sizes or older layouts and tell the creator what was
 * recognised (e.g. "standard tileset A2, 48 px"). Format ids are neutral,
 * engine-specific names.
 */

/** Resource folders, mirroring the standard project layout. */
export const RESOURCE_KINDS = [
  'tilesets', 'characters', 'faces', 'enemies', 'animations', 'system', 'parallaxes', 'pictures',
  'bgm', 'bgs', 'me', 'se',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Image kinds (the others are audio). */
export const IMAGE_KINDS: readonly ResourceKind[] = [
  'tilesets', 'characters', 'faces', 'enemies', 'animations', 'system', 'parallaxes', 'pictures',
];

/** Detected format ids. */
export type ResourceFormat =
  | `standard-tileset-${'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'b' | 'c' | 'd' | 'e'}`
  | `sheet32-tileset-${'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'b' | 'c' | 'd' | 'e'}`
  | 'legacy-autotile'
  | 'legacy-tileset'
  | 'chipset16'
  | 'character-sheet'
  | 'character-single'
  | 'character-sheet16'
  | 'face-sheet'
  | 'face-sheet16'
  | 'window-skin'
  | 'icon-set'
  | 'balloon'
  | 'image'
  | 'audio'
  | 'unknown';

/** Sheet sizes in tiles, used to recognise a tileset sheet at any tile size. */
const SHEET_TILES: Record<string, [number, number]> = {
  a1: [16, 12], a2: [16, 12], a3: [16, 8], a4: [16, 15], a5: [8, 16], b: [16, 16], c: [16, 16], d: [16, 16], e: [16, 16],
};

/** Result of format detection. */
export interface DetectedFormat {
  format: ResourceFormat;
  /** Tile size the sheet was made for, when relevant. */
  tileSize?: number;
  /** Tileset sheet slot (A1..E) when recognised. */
  sheet?: string;
}

/**
 * Detects the format of an image resource.
 * @param kind - Resource folder.
 * @param name - File name without extension.
 * @param width - Pixel width (0 if unknown).
 * @param height - Pixel height (0 if unknown).
 */
export function detectFormat(kind: ResourceKind, name: string, width: number, height: number): DetectedFormat {
  if (!IMAGE_KINDS.includes(kind)) return { format: 'audio' };
  const lower = name.toLowerCase();
  if (kind === 'tilesets') {
    const suffix = /_(a[1-5]|[b-e])$/.exec(lower)?.[1];
    if (suffix) {
      const [cols, rows] = SHEET_TILES[suffix]!;
      for (const size of [48, 32]) {
        if (width === cols * size && height === rows * size) {
          const format = (size === 48 ? `standard-tileset-${suffix}` : `sheet32-tileset-${suffix}`) as ResourceFormat;
          return { format, tileSize: size, sheet: suffix.toUpperCase() };
        }
      }
      // Other tile sizes (e.g. 16 or 24 px) with the standard proportions.
      if (width % cols === 0 && height % rows === 0 && width / cols === height / rows) {
        return { format: `standard-tileset-${suffix}` as ResourceFormat, tileSize: width / cols, sheet: suffix.toUpperCase() };
      }
    }
    if (width === 480 && height === 256) return { format: 'chipset16', tileSize: 16 };
    if (width === 96 && height === 128) return { format: 'legacy-autotile', tileSize: 32 };
    if (width === 256 && height % 32 === 0) return { format: 'legacy-tileset', tileSize: 32 };
    return { format: 'unknown' };
  }
  if (kind === 'characters') {
    // Legacy 16 px character sheets: 4 × 2 characters of 3 × 4 frames of 24 × 32 px.
    if (width === 288 && height === 256 && !lower.includes('$')) return { format: 'character-sheet16' };
    return { format: lower.startsWith('$') || lower.startsWith('!$') ? 'character-single' : 'character-sheet' };
  }
  if (kind === 'faces') return { format: width === 192 && height === 192 ? 'face-sheet16' : 'face-sheet' };
  if (kind === 'system') {
    if (lower === 'window') return { format: 'window-skin' };
    if (lower === 'iconset') return { format: 'icon-set' };
    if (lower === 'balloon') return { format: 'balloon' };
  }
  return { format: 'image' };
}
