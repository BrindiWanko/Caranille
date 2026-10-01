/**
 * @file Default tilesets shipped with the engine: Outside (villages, fields),
 * Inside (houses, shops) and Dungeon (caves, ruins). Each one is drawn in the
 * standard sheet layout, so any sheet can later be replaced by a creator's own
 * image of the same format. Flags (passability, star, bush, counter, damage)
 * are defined next to the drawing of each tile.
 */
import type { PixelCanvas } from '../../shared/art/pixel.js';
import type { FloorStyle, Painter, WallStyle } from './autotile.js';
import * as M from './materials.js';
import * as O from './objects.js';
import { OUTLINE, RAMPS, type Ramp } from '../../shared/art/palette.js';
import { TilesetBuilder, TilesetMode, type GeneratedTileset } from './tileset-builder.js';
import {
  FLAG_BOAT_BLOCK,
  FLAG_BUSH,
  FLAG_COUNTER,
  FLAG_DAMAGE,
  FLAG_IMPASSABLE,
  FLAG_LADDER,
  FLAG_SHIP_BLOCK,
  FLAG_STAR,
} from '../../shared/tiles.js';

const PASS = 0;
const X = FLAG_IMPASSABLE;
const STAR = FLAG_STAR;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Opaque base ground: the texture everywhere, no visible border. */
function baseGround(fill: Painter): FloorStyle {
  return { fill, outside: fill };
}

/** Overlay patch (path, flowers...): transparent outside, dark rim. */
function overlay(fill: Painter, ramp: Ramp, raised = false): FloorStyle {
  return {
    fill,
    outside: null,
    edge: (d, x, y) => {
      if (d === 1) return ramp[0];
      if (d === 2) return raised ? ramp[3] : (x + y) % 2 === 0 ? ramp[1] : undefined;
      return undefined;
    },
  };
}

/** Liquid with a bank: dark bank line, then foam, then the surface. */
function liquidStyle(ramp: Ramp, frame: number, bank: Painter, bankEdge: string, seed: string): FloorStyle {
  return {
    fill: M.liquid(ramp, frame, seed),
    outside: bank,
    edge: (d, x, y) => {
      if (d === 1) return bankEdge;
      if (d === 2) return (x + y + frame) % 3 === 0 ? '#ffffff' : ramp[3];
      if (d === 3) return (x + frame) % 2 === 0 ? ramp[3] : undefined;
      return undefined;
    },
  };
}

/** Waterfall: rocky borders on the left and right edges. */
function fallStyle(ramp: Ramp, frame: number, rock: Ramp = RAMPS.rock): WallStyle {
  return {
    fill: M.falling(ramp, frame),
    edge: (d) => {
      const side = Math.min(d.left, d.right);
      if (side === 0) return OUTLINE;
      if (side === 1) return rock[2];
      if (side === 2) return rock[1];
      return undefined;
    },
  };
}

/** Top of a wall or cliff: the material with a dark contour and a light lip. */
function wallTop(fill: Painter, ramp: Ramp): FloorStyle {
  return {
    fill,
    outside: () => OUTLINE,
    radius: 2,
    edgeWidth: 2,
    edge: (d) => (d === 1 ? ramp[0] : d === 2 ? ramp[3] : undefined),
  };
}

/** Face of a wall or cliff. */
function wallSide(fill: Painter, ramp: Ramp): WallStyle {
  return {
    fill,
    edge: (d, _x, _y, c) => {
      if (d.left === 0 || d.right === 0 || d.bottom === 0) return OUTLINE;
      if (d.top === 0) return ramp[3];
      if (d.bottom === 1) return ramp[0];
      if (d.left === 1) return ramp[3];
      if (d.right === 1) return ramp[1];
      return c ?? undefined;
    },
  };
}

/** Roof: ridge highlight on top, eave shadow at the bottom, trim on the sides. */
function roof(fill: Painter, ramp: Ramp): WallStyle {
  return {
    fill,
    edge: (d) => {
      if (d.left === 0 || d.right === 0 || d.bottom === 0) return OUTLINE;
      if (d.top === 0) return ramp[3];
      if (d.top === 1) return ramp[3];
      if (d.bottom === 1 || d.bottom === 2) return ramp[0];
      if (d.left === 1 || d.right === 1) return ramp[1];
      return undefined;
    },
  };
}

/** Building wall: shadow under the roof, timber corners, stone foundation. */
function buildingWall(fill: Painter, trim: Ramp, foundation: Ramp = RAMPS.stone): WallStyle {
  return {
    fill,
    edge: (d) => {
      if (d.left === 0 || d.right === 0 || d.bottom === 0) return OUTLINE;
      if (d.left <= 2) return d.left === 1 ? trim[3] : trim[2];
      if (d.right <= 2) return d.right === 1 ? trim[1] : trim[2];
      if (d.bottom <= 3) return d.bottom === 3 ? foundation[3] : foundation[1 + (d.bottom % 2)];
      if (d.top <= 1) return trim[0];
      return undefined;
    },
  };
}

/** Lily pads floating on water (overlay, drawn on transparent). */
function lilyPads(): Painter {
  return (x, y) => {
    const pads = [
      [4, 4],
      [11, 10],
    ];
    for (const [px, py] of pads) {
      const dx = x - px!;
      const dy = y - py!;
      if (dx * dx + dy * dy <= 7 && !(dx > 0 && dy === 0)) return dx + dy < -1 ? RAMPS.leaves[3] : RAMPS.leaves[2];
      if (dx * dx + dy * dy <= 10) return RAMPS.leaves[0];
    }
    if (x === 13 && y === 3) return RAMPS.flowerWhite[3];
    return null;
  };
}

/** Flowers over grass (overlay fill). */
function meadow(): Painter {
  const g = M.grass(RAMPS.grass, 'meadow', 3);
  const colors = [RAMPS.flowerRed[2], RAMPS.flowerYellow[2], RAMPS.flowerWhite[3], RAMPS.flowerBlue[2]];
  return (x, y) => {
    const h = (x * 7 + y * 13) % 23;
    if (h === 0) return colors[(x + y) % 4]!;
    if (h === 1) return RAMPS.flowerYellow[3];
    return g(x, y);
  };
}

/** Tilled soil rows. */
function farmland(): Painter {
  const d = M.dirt(RAMPS.dirt, 'farm');
  return (x, y) => (y % 4 === 3 ? RAMPS.dirt[0] : y % 4 === 0 ? RAMPS.dirt[3] : d(x, y));
}

/** Crops over soil (overlay fill). */
function crops(): Painter {
  const soil = farmland();
  return (x, y) => {
    if (x % 4 === 1 && y % 4 !== 3) return y % 4 === 0 ? RAMPS.flowerYellow[3] : RAMPS.grass[1];
    if (x % 4 === 2 && y % 4 === 1) return RAMPS.grass[2];
    return soil(x, y);
  };
}

// ---------------------------------------------------------------------------
// Outside
// ---------------------------------------------------------------------------

/** Village / field tileset. */
export function outsideTileset(): GeneratedTileset {
  const b = new TilesetBuilder('Outside', TilesetMode.Area);
  const grassFill = M.grass();
  const rockFill = M.rockFace(RAMPS.rock, 'lavabank');
  const snowFill = M.snow();

  // --- A1: liquids ---------------------------------------------------------
  b.a1Water(0, (f) => liquidStyle(RAMPS.water, f, grassFill, RAMPS.dirt[1], 'sea'), X | 0);
  b.a1Water(1, (f) => liquidStyle(RAMPS.deepWater, f, grassFill, RAMPS.dirt[1], 'deep'), X | FLAG_BOAT_BLOCK);
  b.a1Decoration(2, overlay(M.rockFace(RAMPS.rock, 'searock'), RAMPS.rock, true), X | FLAG_BOAT_BLOCK | FLAG_SHIP_BLOCK);
  b.a1Decoration(3, { fill: lilyPads(), outside: null }, X);
  b.a1Water(4, (f) => liquidStyle(RAMPS.water, f, grassFill, RAMPS.dirt[1], 'pond'), X);
  b.a1Waterfall(5, (f) => fallStyle(RAMPS.water, f), X);
  b.a1Water(6, (f) => liquidStyle(RAMPS.lava, f, rockFill, RAMPS.rock[0], 'lava'), PASS | FLAG_DAMAGE);
  b.a1Waterfall(7, (f) => fallStyle(RAMPS.lava, f), X);
  b.a1Water(8, (f) => liquidStyle(RAMPS.swamp, f, M.grass(RAMPS.grassDark, 'swampbank'), RAMPS.swamp[0], 'swamp'), PASS | FLAG_BUSH);
  b.a1Waterfall(9, (f) => fallStyle(RAMPS.swamp, f), X);
  b.a1Water(10, (f) => liquidStyle(RAMPS.ice, f, snowFill, RAMPS.ice[0], 'ice'), PASS);
  b.a1Waterfall(11, (f) => fallStyle(RAMPS.ice, f, RAMPS.snow), X);
  b.a1Water(12, (f) => liquidStyle(RAMPS.poison, f, M.dirt(RAMPS.stone, 'poisonbank'), RAMPS.poison[0], 'poison'), PASS | FLAG_DAMAGE);
  b.a1Waterfall(13, (f) => fallStyle(RAMPS.poison, f), X);
  b.a1Water(14, (f) => liquidStyle(RAMPS.deepWater, f, M.sand(), RAMPS.sand[0], 'beach'), X);
  b.a1Waterfall(15, (f) => fallStyle(RAMPS.deepWater, f), X);

  // --- A2: grounds (left: opaque bases, right: overlays) -------------------
  b.a2(0, 0, baseGround(grassFill), PASS);
  b.a2(1, 0, baseGround(M.grass(RAMPS.grassDark, 'darkgrass')), PASS);
  b.a2(2, 0, baseGround(M.dirt()), PASS);
  b.a2(3, 0, baseGround(M.sand()), PASS);
  b.a2(4, 0, overlay(M.dirt(RAMPS.path, 'path'), RAMPS.path), PASS);
  b.a2(5, 0, overlay(M.grass(RAMPS.grass, 'patch'), RAMPS.grass, true), PASS);
  b.a2(6, 0, overlay(meadow(), RAMPS.grass, true), PASS);
  b.a2(7, 0, overlay(M.grass(RAMPS.grassDark, 'tall', 14), RAMPS.grassDark, true), PASS | FLAG_BUSH);

  b.a2(0, 1, baseGround(snowFill), PASS);
  b.a2(1, 1, baseGround(M.cobble()), PASS);
  b.a2(2, 1, baseGround(farmland()), PASS);
  b.a2(3, 1, baseGround(M.dirt(RAMPS.rock, 'rocky')), PASS);
  b.a2(4, 1, overlay(M.cobble(RAMPS.cobble, 'road'), RAMPS.cobble), PASS);
  b.a2(5, 1, overlay(M.sand(RAMPS.sand, 'sandpath'), RAMPS.sand), PASS);
  b.a2(6, 1, overlay(M.liquid(RAMPS.water, 0, 'puddle'), RAMPS.water), PASS);
  b.a2(7, 1, overlay(crops(), RAMPS.dirt, true), PASS | FLAG_BUSH);

  b.a2(0, 2, baseGround(M.grass(RAMPS.leavesAutumn, 'autumn')), PASS);
  b.a2(1, 2, baseGround(M.grass(RAMPS.swamp, 'bog')), PASS);
  b.a2(2, 2, baseGround(M.dirt(RAMPS.dark, 'ash')), PASS);
  b.a2(3, 2, baseGround(M.flagstone(RAMPS.stoneWarm, 'plaza')), PASS);
  b.a2(4, 2, overlay(snowFill, RAMPS.snow, true), PASS);
  b.a2(5, 2, overlay(M.dirt(RAMPS.stone, 'gravel'), RAMPS.stone), PASS);
  b.a2(6, 2, overlay(M.grass(RAMPS.swamp, 'moss', 3), RAMPS.swamp, true), PASS);
  b.a2(7, 2, overlay(M.flagstone(RAMPS.stone, 'tiles'), RAMPS.stone), PASS);

  // --- A3: roofs (rows 0, 2) and walls (rows 1, 3) --------------------------
  const roofs: [Painter, Ramp][] = [
    [M.shingles(RAMPS.roofRed, 'r1'), RAMPS.roofRed],
    [M.shingles(RAMPS.roofBlue, 'r2'), RAMPS.roofBlue],
    [M.shingles(RAMPS.roofGreen, 'r3'), RAMPS.roofGreen],
    [M.shingles(RAMPS.roofBrown, 'r4'), RAMPS.roofBrown],
    [M.thatchRoof(), RAMPS.thatch],
    [M.shingles(RAMPS.stone, 'r6'), RAMPS.stone],
    [M.shingles(RAMPS.cloth, 'r7'), RAMPS.cloth],
    [M.shingles(RAMPS.dark, 'r8'), RAMPS.dark],
  ];
  roofs.forEach(([fill, ramp], col) => b.a3(col, 0, roof(fill, ramp), X));
  const walls: WallStyle[] = [
    buildingWall(M.plaster(), RAMPS.wood),
    buildingWall(M.bricks(RAMPS.brick, 'w2'), RAMPS.stoneWarm),
    buildingWall(M.bricks(RAMPS.stone, 'w3', 8, 4), RAMPS.stone),
    buildingWall(M.boards(RAMPS.wood, 'w4'), RAMPS.wood),
    buildingWall(M.plaster(RAMPS.snow, 'w5'), RAMPS.woodLight),
    buildingWall(M.boards(RAMPS.woodLight, 'w6'), RAMPS.wood),
    buildingWall(M.bricks(RAMPS.dark, 'w7'), RAMPS.stone),
    buildingWall(M.bricks(RAMPS.sand, 'w8', 8, 4), RAMPS.stoneWarm),
  ];
  walls.forEach((style, col) => b.a3(col, 1, style, X));

  // --- A4: cliffs, ramparts, hedges ------------------------------------------
  const a4: [FloorStyle, WallStyle][] = [
    [wallTop(grassFill, RAMPS.grass), wallSide(M.rockFace(RAMPS.cliff, 'c1'), RAMPS.cliff)],
    [wallTop(M.sand(), RAMPS.sand), wallSide(M.rockFace(RAMPS.sand, 'c2'), RAMPS.sand)],
    [wallTop(snowFill, RAMPS.snow), wallSide(M.rockFace(RAMPS.ice, 'c3'), RAMPS.ice)],
    [wallTop(M.flagstone(RAMPS.stone, 'rampart'), RAMPS.stone), wallSide(M.bricks(RAMPS.stone, 'c4'), RAMPS.stone)],
    [wallTop(M.leafy(RAMPS.leaves, 'hedge-top'), RAMPS.leaves), wallSide(M.leafy(RAMPS.grassDark, 'hedge'), RAMPS.grassDark)],
    [wallTop(M.dirt(RAMPS.dark, 'volcano'), RAMPS.rock), wallSide(M.rockFace(RAMPS.rock, 'c6'), RAMPS.rock)],
    [wallTop(M.grass(RAMPS.leavesAutumn, 'autumncliff'), RAMPS.leavesAutumn), wallSide(M.rockFace(RAMPS.cliff, 'c7'), RAMPS.cliff)],
    [wallTop(M.flagstone(RAMPS.sand, 'sandstone'), RAMPS.sand), wallSide(M.bricks(RAMPS.sand, 'c8'), RAMPS.sand)],
  ];
  a4.forEach(([top, side], col) => {
    b.a4Top(col, 0, top, X);
    b.a4Side(col, 0, side, X);
  });

  // --- A5: plain ground tiles -------------------------------------------------
  const tile = (p: Painter) => (c: PixelCanvas, x: number, y: number) => {
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) c.set(x + i, y + j, p(i, j));
  };
  b.a5(0, 0, tile(M.solid('#000000')), X);
  b.a5(1, 0, tile(grassFill), PASS);
  b.a5(2, 0, tile(M.dirt()), PASS);
  b.a5(3, 0, tile(M.sand()), PASS);
  b.a5(4, 0, tile(M.cobble()), PASS);
  b.a5(5, 0, tile(M.planks(RAMPS.plank, 'bridge-h')), PASS);
  b.a5(6, 0, (c, x, y) => {
    tile(M.planks(RAMPS.plank, 'bridge-v'))(c, x, y);
    for (let i = 0; i < 16; i += 4) c.vline(x + i, y, y + 15, RAMPS.plank[0]);
  }, PASS);
  b.a5(7, 0, O.stairs(false, RAMPS.stone), PASS | FLAG_LADDER);
  b.a5(0, 1, (c, x, y) => {
    tile(grassFill)(c, x, y);
    c.fillEllipse(x + 2, y + 2, 12, 12, RAMPS.dark[0]);
  }, X);
  b.a5(1, 1, (c, x, y) => {
    tile(grassFill)(c, x, y);
    for (const [sx, sy] of [[2, 3], [9, 8], [4, 11]] as const) {
      c.fillRoundRect(x + sx, y + sy, 5, 4, 1, RAMPS.stone[2]);
      c.hline(x + sx + 1, x + sx + 3, y + sy, RAMPS.stone[3]);
    }
  }, PASS);
  b.a5(2, 1, tile(M.flagstone()), PASS);
  b.a5(3, 1, tile(M.snow('snow2')), PASS);

  // --- B: nature and village props ---------------------------------------------
  b.object('B', 1, 0, O.bush(), X);
  b.object('B', 2, 0, O.bush(RAMPS.leavesAutumn, 'bush2'), X);
  b.object('B', 3, 0, O.rock(), X);
  b.object('B', 4, 0, O.stump(), X);
  b.object('B', 5, 0, O.mushrooms(), PASS);
  b.object('B', 6, 0, O.mushrooms(RAMPS.flowerBlue), PASS);
  b.object('B', 7, 0, O.haystack(), X);
  b.object('B', 0, 1, O.flowers(RAMPS.flowerRed, 'f1'), PASS);
  b.object('B', 1, 1, O.flowers(RAMPS.flowerYellow, 'f2'), PASS);
  b.object('B', 2, 1, O.flowers(RAMPS.flowerWhite, 'f3'), PASS);
  b.object('B', 3, 1, O.flowers(RAMPS.flowerBlue, 'f4'), PASS);
  b.object('B', 4, 1, O.tallGrass(), PASS | FLAG_BUSH);
  b.object('B', 5, 1, O.gravestone(), X);
  b.object('B', 6, 1, O.signpost(), X);
  b.object('B', 7, 1, O.barrel(), X);
  b.object('B', 0, 2, O.crate(), X);
  b.object('B', 1, 2, O.fence('h'), X);
  b.object('B', 2, 2, O.fence('v'), X);
  b.object('B', 3, 2, O.fence('post'), X);
  b.object('B', 4, 2, O.flowerPot(), X);
  b.object('B', 5, 2, O.flowerPot(RAMPS.flowerYellow), X);
  b.object('B', 6, 2, O.bones(), PASS);
  b.object('B', 7, 2, O.rock(RAMPS.stone), X);
  const tree2x2 = [[STAR, STAR], [X, X]];
  b.object('B', 0, 3, O.roundTree(), tree2x2, { w: 2, h: 2 });
  b.object('B', 2, 3, O.roundTree(RAMPS.leavesAutumn, 'autumn-tree'), tree2x2, { w: 2, h: 2 });
  b.object('B', 4, 3, O.pineTree(), [[STAR], [X]], { w: 1, h: 2 });
  b.object('B', 5, 3, O.pineTree(RAMPS.leaves), [[STAR], [X]], { w: 1, h: 2 });
  b.object('B', 6, 3, O.lampPost(), [[STAR], [X]], { w: 1, h: 2 });
  b.object('B', 7, 3, O.statue(), [[STAR], [X]], { w: 1, h: 2 });
  b.object('B', 0, 5, O.well(), [[STAR, STAR], [X, X]], { w: 2, h: 2 });
  b.object('B', 2, 5, O.rock(RAMPS.rock, true), [[STAR, STAR], [X, X]], { w: 2, h: 2 });
  b.object('B', 4, 5, O.bench(), X, { w: 2, h: 1 });
  b.object('B', 6, 5, O.tent(), [[STAR, STAR], [X, X]], { w: 2, h: 2 });
  b.object('B', 4, 6, O.roundTree(RAMPS.grassDark, 'dark-tree'), tree2x2, { w: 2, h: 2 });

  // --- C: building details --------------------------------------------------------
  b.object('C', 0, 0, O.door(), PASS);
  b.object('C', 1, 0, O.door(RAMPS.iron, false), PASS);
  b.object('C', 2, 0, O.windowTile(), X);
  b.object('C', 3, 0, O.windowTile(RAMPS.roofBlue), X);
  b.object('C', 4, 0, O.chimney(), STAR);
  b.object('C', 5, 0, O.shopSign('sword'), STAR);
  b.object('C', 6, 0, O.shopSign('shield'), STAR);
  b.object('C', 7, 0, O.shopSign('potion'), STAR);
  b.object('C', 0, 1, O.shopSign('bed'), STAR);
  b.object('C', 1, 1, O.stairs(false, RAMPS.stoneWarm), PASS | FLAG_LADDER);
  b.object('C', 2, 1, O.stairs(true, RAMPS.stoneWarm), PASS);
  b.object('C', 4, 1, O.awning(), STAR, { w: 2, h: 1 });
  b.object('C', 6, 1, O.awning(RAMPS.roofBlue), STAR, { w: 2, h: 1 });
  b.object('C', 0, 2, O.table(2, RAMPS.carpetRed), X | FLAG_COUNTER, { w: 2, h: 1 });
  b.object('C', 2, 2, O.crate(), X);
  b.object('C', 3, 2, O.barrel(), X);
  b.object('C', 4, 2, O.pot(), X);

  return b.build();
}

// ---------------------------------------------------------------------------
// Inside
// ---------------------------------------------------------------------------

/** House / shop interior tileset. */
export function insideTileset(): GeneratedTileset {
  const b = new TilesetBuilder('Inside', TilesetMode.Area);

  b.a2(0, 0, baseGround(M.planks()), PASS);
  b.a2(1, 0, baseGround(M.flagstone(RAMPS.stoneWarm, 'in-stone')), PASS);
  b.a2(2, 0, baseGround(M.straw()), PASS);
  b.a2(3, 0, baseGround(M.planks(RAMPS.wood, 'dark-planks')), PASS);
  const carpets: Ramp[] = [RAMPS.carpetRed, RAMPS.carpetBlue, RAMPS.carpetGreen, RAMPS.cloth];
  carpets.forEach((ramp, i) =>
    b.a2(4 + i, 0, { ...overlay(M.carpet(ramp), ramp, true), edge: (d) => (d === 1 ? ramp[0] : d === 2 ? RAMPS.gold[2] : undefined) }, PASS),
  );
  b.a2(0, 1, baseGround(M.cobble(RAMPS.cobble, 'in-cobble')), PASS);
  b.a2(1, 1, baseGround(M.dirt(RAMPS.dirt, 'in-dirt')), PASS);
  b.a2(2, 1, baseGround(M.flagstone(RAMPS.snow, 'marble')), PASS);
  b.a2(3, 1, baseGround(M.planks(RAMPS.woodLight, 'light-planks')), PASS);

  const top = (ramp: Ramp) => wallTop(M.solid(ramp[1]), ramp);
  const insideWalls: [Ramp, Painter][] = [
    [RAMPS.plaster, M.plaster()],
    [RAMPS.wood, M.boards(RAMPS.wood, 'in-boards')],
    [RAMPS.stone, M.bricks(RAMPS.stone, 'in-stone-wall')],
    [RAMPS.brick, M.bricks(RAMPS.brick, 'in-brick')],
    [RAMPS.carpetBlue, M.carpet(RAMPS.carpetBlue, 'paper-blue')],
    [RAMPS.carpetGreen, M.carpet(RAMPS.carpetGreen, 'paper-green')],
    [RAMPS.woodLight, M.boards(RAMPS.woodLight, 'in-log')],
    [RAMPS.dark, M.bricks(RAMPS.dark, 'in-dark')],
  ];
  insideWalls.forEach(([ramp, fill], col) => {
    b.a4Top(col, 0, top(RAMPS.wood), X);
    b.a4Side(col, 0, wallSide(fill, ramp), X);
  });

  b.a5(0, 0, (c, x, y) => c.fillRect(x, y, 16, 16, '#000000'), X);

  b.object('B', 1, 0, O.chest(false), X);
  b.object('B', 2, 0, O.chest(true), X);
  b.object('B', 3, 0, O.chest(false, RAMPS.roofRed), X);
  b.object('B', 4, 0, O.pot(), X);
  b.object('B', 5, 0, O.pot(RAMPS.roofBlue), X);
  b.object('B', 6, 0, O.barrel(), X);
  b.object('B', 7, 0, O.crate(), X);
  b.object('B', 0, 1, O.chair('down'), PASS);
  b.object('B', 1, 1, O.chair('left'), PASS);
  b.object('B', 2, 1, O.chair('right'), PASS);
  b.object('B', 3, 1, O.chair('up'), PASS);
  b.object('B', 4, 1, O.table(2), X, { w: 2, h: 1 });
  b.object('B', 6, 1, O.table(2, RAMPS.flowerWhite), X, { w: 2, h: 1 });
  b.object('B', 0, 2, O.counter(), X | FLAG_COUNTER);
  b.object('B', 1, 2, O.counter(), X | FLAG_COUNTER);
  b.object('B', 2, 2, O.candle(), X);
  b.object('B', 3, 2, O.housePlant(), X);
  b.object('B', 4, 2, O.rug(), PASS);
  b.object('B', 5, 2, O.rug(RAMPS.carpetBlue), PASS);
  b.object('B', 6, 2, O.stairs(false, RAMPS.wood), PASS | FLAG_LADDER);
  b.object('B', 7, 2, O.stairs(true, RAMPS.wood), PASS);
  b.object('B', 0, 3, O.bed(), [[X], [X]], { w: 1, h: 2 });
  b.object('B', 1, 3, O.bed(RAMPS.carpetRed), [[X], [X]], { w: 1, h: 2 });
  b.object('B', 2, 3, O.bookshelf(), [[STAR], [X]], { w: 1, h: 2 });
  b.object('B', 3, 3, O.wardrobe(), [[STAR], [X]], { w: 1, h: 2 });
  b.object('B', 4, 3, O.fireplace(), [[STAR, STAR], [X, X]], { w: 2, h: 2 });
  b.object('B', 6, 3, O.windowTile(), X);
  b.object('B', 7, 3, O.door(), PASS);

  return b.build();
}

// ---------------------------------------------------------------------------
// Dungeon
// ---------------------------------------------------------------------------

/** Cave / ruins tileset. Uses the Outside liquids sheet for water and lava. */
export function dungeonTileset(): GeneratedTileset {
  const b = new TilesetBuilder('Dungeon', TilesetMode.Area);

  b.a2(0, 0, baseGround(M.dirt(RAMPS.stoneWarm, 'cave')), PASS);
  b.a2(1, 0, baseGround(M.flagstone(RAMPS.stone, 'dungeon')), PASS);
  b.a2(2, 0, baseGround(M.flagstone(RAMPS.dark, 'dark-floor')), PASS);
  b.a2(3, 0, baseGround(M.cobble(RAMPS.stone, 'ruins')), PASS);
  b.a2(4, 0, overlay(M.dirt(RAMPS.rock, 'gravel2'), RAMPS.rock), PASS);
  b.a2(5, 0, overlay(M.grass(RAMPS.swamp, 'cave-moss', 3), RAMPS.swamp, true), PASS);
  b.a2(6, 0, overlay(M.liquid(RAMPS.deepWater, 0, 'cave-puddle'), RAMPS.deepWater), PASS);
  b.a2(7, 0, overlay(M.carpet(RAMPS.carpetRed, 'throne'), RAMPS.carpetRed, true), PASS);

  const walls: [Ramp, Painter, Painter][] = [
    [RAMPS.rock, M.dirt(RAMPS.rock, 'cave-top'), M.rockFace(RAMPS.rock, 'cave-wall')],
    [RAMPS.stone, M.flagstone(RAMPS.stone, 'dtop'), M.bricks(RAMPS.stone, 'dwall')],
    [RAMPS.dark, M.solid(RAMPS.dark[2]), M.bricks(RAMPS.dark, 'dwall2')],
    [RAMPS.poison, M.dirt(RAMPS.poison, 'crystal-top'), M.rockFace(RAMPS.poison, 'crystal-wall')],
    [RAMPS.cliff, M.dirt(RAMPS.cliff, 'earth-top'), M.rockFace(RAMPS.cliff, 'earth-wall')],
    [RAMPS.ice, M.snow('ice-top'), M.rockFace(RAMPS.ice, 'ice-wall')],
    [RAMPS.brick, M.flagstone(RAMPS.brick, 'brick-top'), M.bricks(RAMPS.brick, 'brick-wall')],
    [RAMPS.stoneWarm, M.flagstone(RAMPS.stoneWarm, 'sand-top'), M.bricks(RAMPS.stoneWarm, 'sand-wall')],
  ];
  walls.forEach(([ramp, topFill, sideFill], col) => {
    b.a4Top(col, 0, wallTop(topFill, ramp), X);
    b.a4Side(col, 0, wallSide(sideFill, ramp), X);
  });

  b.a5(0, 0, (c, x, y) => c.fillRect(x, y, 16, 16, '#000000'), X);
  b.a5(1, 0, (c, x, y) => {
    c.fillRect(x, y, 16, 16, RAMPS.dark[1]);
    c.fillEllipse(x + 1, y + 1, 14, 14, '#000000');
  }, X);

  b.object('B', 1, 0, O.wallTorch(), STAR);
  b.object('B', 2, 0, O.bones(), PASS);
  b.object('B', 3, 0, O.bones(true), PASS);
  b.object('B', 4, 0, O.crystal(), X);
  b.object('B', 5, 0, O.crystal(RAMPS.ice), X);
  b.object('B', 6, 0, O.crack(), PASS);
  b.object('B', 7, 0, O.cobweb(), STAR);
  b.object('B', 0, 1, O.stairs(false), PASS | FLAG_LADDER);
  b.object('B', 1, 1, O.stairs(true), PASS);
  b.object('B', 2, 1, O.ironDoor(), PASS);
  b.object('B', 3, 1, O.chest(false), X);
  b.object('B', 4, 1, O.chest(true), X);
  b.object('B', 5, 1, O.rock(RAMPS.stone), X);
  b.object('B', 6, 1, O.altar(), X, { w: 2, h: 1 });
  b.object('B', 0, 2, O.pillar(), [[STAR], [X]], { w: 1, h: 2 });
  b.object('B', 1, 2, O.pillar(RAMPS.dark), [[STAR], [X]], { w: 1, h: 2 });
  b.object('B', 2, 2, O.statue(), [[STAR], [X]], { w: 1, h: 2 });
  b.object('B', 3, 2, O.gravestone(), X);
  b.object('B', 4, 2, O.pot(RAMPS.stone), X);

  return b.build();
}

/** Sheet names used by each default tileset, in `tilesetNames` order (A1..E); '' = none. */
export const DEFAULT_TILESET_SHEETS: Record<string, string[]> = {
  Outside: ['Outside_A1', 'Outside_A2', 'Outside_A3', 'Outside_A4', 'Outside_A5', 'Outside_B', 'Outside_C', '', ''],
  Inside: ['', 'Inside_A2', '', 'Inside_A4', 'Inside_A5', 'Inside_B', '', '', ''],
  Dungeon: ['Outside_A1', 'Dungeon_A2', '', 'Dungeon_A4', 'Dungeon_A5', 'Dungeon_B', '', '', ''],
};

