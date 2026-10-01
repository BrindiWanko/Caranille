/**
 * @file Tests of the tile specification: autotile shape selection against the
 * quarter tables, source block positions, plain tile ids, format detection and
 * default tileset flags.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeAppearance } from '../shared/art/character.js';
import { detectFormat } from '../shared/resource-formats.js';
import {
  FLAG_STAR,
  FLOOR_AUTOTILE_TABLE,
  TILE_ID_A2,
  TILE_ID_A4,
  WALL_AUTOTILE_TABLE,
  autotileSource,
  floorShape,
  makeAutotileId,
  plainTileId,
  plainTileSource,
  wallShape,
  type Neighbours,
} from '../shared/tiles.js';
import { outsideTileset } from '../assets/generators/tilesets.js';

function neighbours(mask: number): Neighbours {
  const [n, ne, e, se, s, sw, w, nw] = Array.from({ length: 8 }, (_, i) => (mask & (1 << i)) !== 0) as boolean[];
  return { n: n!, ne: ne!, e: e!, se: se!, s: s!, sw: sw!, w: w!, nw: nw! };
}

/** Expected source quarter of the top-left corner for a neighbourhood, derived independently. */
function expectedTopLeft(nb: Neighbours): readonly [number, number] {
  if (!nb.n && !nb.w) return [0, 2]; // outer corner
  if (!nb.n) return [2, 2]; // top edge
  if (!nb.w) return [0, 4]; // left edge
  if (!nb.nw) return [2, 0]; // inner corner
  return [2, 4]; // fill
}

test('floor shapes: every neighbourhood maps to a shape whose quarters match its borders', () => {
  const used = new Set<number>();
  for (let mask = 0; mask < 256; mask++) {
    const nb = neighbours(mask);
    const shape = floorShape(nb);
    used.add(shape);
    assert.ok(shape >= 0 && shape < 47, `mask ${mask} -> shape ${shape}`);
    assert.deepEqual(FLOOR_AUTOTILE_TABLE[shape]![0], expectedTopLeft(nb), `top-left quarter for mask ${mask}`);
    // By symmetry, check the bottom-right corner too.
    const br = FLOOR_AUTOTILE_TABLE[shape]![3];
    if (!nb.s && !nb.e) assert.deepEqual(br, [3, 5]);
    else if (!nb.s) assert.deepEqual(br, [1, 5]);
    else if (!nb.e) assert.deepEqual(br, [3, 3]);
    else if (!nb.se) assert.deepEqual(br, [3, 1]);
    else assert.deepEqual(br, [1, 3]);
  }
  assert.equal(used.size, 47, 'shapes 0-46 are all reachable');
  assert.equal(floorShape(neighbours(255)), 0, 'fully surrounded = shape 0');
  assert.equal(floorShape(neighbours(0)), 46, 'isolated = shape 46');
});

test('wall shapes: one bit per differing border', () => {
  assert.equal(wallShape(neighbours(255)), 0);
  assert.equal(wallShape(neighbours(0)), 15);
  const leftOnly = wallShape({ ...neighbours(255), w: false });
  assert.equal(leftOnly, 1);
  assert.equal(WALL_AUTOTILE_TABLE[leftOnly]![0]![0], 0, 'left edge quarters come from the left column');
  assert.equal(WALL_AUTOTILE_TABLE[leftOnly]![1]![0], 1, 'right quarters stay inside');
});

test('autotile source blocks follow the standard sheet layout', () => {
  assert.deepEqual(autotileSource(makeAutotileId(0, 0), 0), { sheet: 'A1', bx: 0, by: 0, table: FLOOR_AUTOTILE_TABLE });
  assert.equal(autotileSource(makeAutotileId(0, 0), 1).bx, 2, 'water frame 1');
  assert.equal(autotileSource(makeAutotileId(0, 0), 3).bx, 2, 'water cycles 0-1-2-1');
  assert.deepEqual(
    [autotileSource(makeAutotileId(5, 0), 2).bx, autotileSource(makeAutotileId(5, 0), 2).by],
    [14, 2],
    'waterfall frames are stacked',
  );
  const a2 = autotileSource(TILE_ID_A2 + 48 * 9); // A2 kind: column 1, row 1
  assert.deepEqual([a2.sheet, a2.bx, a2.by], ['A2', 2, 3]);
  const a4Side = autotileSource(TILE_ID_A4 + 48 * 8); // first wall side
  assert.deepEqual([a4Side.bx, a4Side.by, a4Side.table === WALL_AUTOTILE_TABLE], [0, 3, true]);
  const a4Top2 = autotileSource(TILE_ID_A4 + 48 * 16); // second wall top
  assert.deepEqual([a4Top2.by, a4Top2.table === FLOOR_AUTOTILE_TABLE], [5, true]);
});

test('plain tile ids round-trip through the two-halves sheet layout', () => {
  for (let sheet = 0; sheet < 4; sheet++) {
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 16; col++) {
        const id = plainTileId(sheet, col, row);
        const src = plainTileSource(id);
        assert.deepEqual([src.col, src.row, src.sheet], [col, row, ['B', 'C', 'D', 'E'][sheet]]);
      }
    }
  }
  assert.equal(plainTileId(0, 8, 0), 128, 'right half starts at 128');
});

test('sheet formats are detected from name and size', () => {
  assert.deepEqual(detectFormat('tilesets', 'Outside_A2', 768, 576), { format: 'standard-tileset-a2', tileSize: 48, sheet: 'A2' });
  assert.equal(detectFormat('tilesets', 'World_B', 512, 512).format, 'sheet32-tileset-b');
  assert.equal(detectFormat('tilesets', 'Town_A5', 128, 256).tileSize, 16);
  assert.equal(detectFormat('tilesets', 'Chipset01', 480, 256).format, 'chipset16');
  assert.equal(detectFormat('tilesets', 'Water', 96, 128).format, 'legacy-autotile');
  assert.equal(detectFormat('characters', '$Boss1', 432, 512).format, 'character-single');
  assert.equal(detectFormat('characters', 'Hero', 288, 256).format, 'character-sheet16');
  assert.equal(detectFormat('system', 'Window', 192, 192).format, 'window-skin');
});

test('appearance input is sanitised', () => {
  const a = sanitizeAppearance({ body: 'female', skin: 99, hair: 'mohawk', hairColor: 2, outfit: 'skeleton', outfitColor: -1 }, ['warrior', 'mage']);
  assert.deepEqual(a, { body: 'female', skin: 0, hair: 'short', hairColor: 2, outfit: 'warrior', outfitColor: 0, beard: false });
  assert.equal(sanitizeAppearance(null).body, 'male');
});

test('default tileset flags: empty tile and tree crowns never block', () => {
  const outside = outsideTileset();
  assert.equal(outside.flags[0], FLAG_STAR);
  assert.equal(outside.flags[plainTileId(0, 0, 3)]! & FLAG_STAR, FLAG_STAR, 'tree crown is a star tile');
  assert.equal(outside.flags[plainTileId(0, 0, 4)]! & 0x0f, 0x0f, 'tree trunk is impassable');
});
