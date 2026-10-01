/**
 * @file Biome tilesets shipped with the engine: Cavern (caves and mines),
 * Jungle, Volcano and Sea (beaches, harbours, open ocean). Cavern, Jungle and
 * Volcano reuse the Outside liquids sheet (water, lava, swamp...); Sea has its
 * own liquids sheet with sandy shores, lagoons and reefs.
 */
import type { PixelCanvas } from '../../shared/art/pixel.js';
import { Rng, seedFrom } from '../../shared/art/pixel.js';
import { RAMPS, type Ramp } from '../../shared/art/palette.js';
import { FLAG_BOAT_BLOCK, FLAG_BUSH, FLAG_DAMAGE, FLAG_IMPASSABLE, FLAG_LADDER, FLAG_SHIP_BLOCK, FLAG_STAR } from '../../shared/tiles.js';
import { texture, type FloorStyle, type Painter, type WallStyle } from './autotile.js';
import * as M from './materials.js';
import * as B from './objects-biomes.js';
import * as O from './objects.js';
import { TilesetBuilder, TilesetMode, type GeneratedTileset } from './tileset-builder.js';
import { baseGround, fallStyle, liquidStyle, overlay, wallSide, wallTop } from './tilesets.js';

const PASS = 0;
const X = FLAG_IMPASSABLE;
const STAR = FLAG_STAR;
const TALL = [[STAR], [X]];
const BIG = [[STAR, STAR], [X, X]];

/** Fills a whole plain tile with a texture. */
const tile = (p: Painter) => (c: PixelCanvas, x: number, y: number) => {
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) c.set(x + i, y + j, p(i, j));
};

/** A texture with strands of vines hanging over it. */
function withVines(base: Painter, ramp: Ramp, seed: string): Painter {
  const rng = new Rng(seedFrom(seed));
  const strands = Array.from({ length: 3 }, () => ({ x: rng.int(0, 15), len: rng.int(6, 15) }));
  return (x, y) => {
    for (const s of strands) {
      if (x === s.x && y < s.len) return y % 4 === 0 ? ramp[3] : ramp[1];
      if (x === s.x + 1 && y < s.len && y % 4 === 2) return ramp[2];
    }
    return base(x, y);
  };
}

/** Cooled lava: dark crust with glowing seams. */
function lavaCrust(seed = 'crust'): Painter {
  const rng = new Rng(seedFrom(seed));
  const glow = RAMPS.magma;
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, RAMPS.basalt[2]);
    for (let i = 0; i < 10; i++) t.wrapSet(rng.int(0, 15), rng.int(0, 15), RAMPS.basalt[3]);
    for (let i = 0; i < 4; i++) {
      let x = rng.int(0, 15);
      let y = rng.int(0, 15);
      for (let k = 0; k < 7; k++) {
        t.wrapSet(x, y, k % 3 === 0 ? glow[3] : glow[2]);
        t.wrapSet(x, y + 1, RAMPS.basalt[0]);
        x += rng.int(0, 1);
        y += rng.int(-1, 1);
      }
    }
  });
}

/** Rock face with glowing magma veins. */
function magmaVeins(seed = 'veins'): Painter {
  const rock = M.rockFace(RAMPS.basalt, seed);
  const rng = new Rng(seedFrom(`${seed}-v`));
  const veins = new Set<number>();
  for (let v = 0; v < 2; v++) {
    let x = rng.int(0, 15);
    for (let y = 0; y < 16; y++) {
      veins.add(y * 16 + (((x % 16) + 16) % 16));
      x += rng.int(-1, 1);
    }
  }
  return (x, y) => (veins.has(y * 16 + x) ? ((x + y) % 3 === 0 ? RAMPS.magma[3] : RAMPS.magma[2]) : rock(x, y));
}

/** Sand strewn with shells and pebbles (overlay fill). */
function shellySand(): Painter {
  const s = M.sand(RAMPS.sand, 'shells');
  return (x, y) => {
    const h = (x * 11 + y * 7) % 29;
    if (h === 0) return RAMPS.coral[3];
    if (h === 1) return RAMPS.flowerWhite[3];
    if (h === 2) return RAMPS.stone[2];
    return s(x, y);
  };
}

/** Tropical undergrowth with bright flowers (overlay fill). */
function tropicalMeadow(): Painter {
  const g = M.grass(RAMPS.jungle, 'tropic-meadow', 6);
  const colors = [RAMPS.coral[3], RAMPS.flowerYellow[2], RAMPS.poison[3], RAMPS.leavesAutumn[3]];
  return (x, y) => {
    const h = (x * 5 + y * 11) % 19;
    if (h === 0) return colors[(x + y) % 4]!;
    return g(x, y);
  };
}

/** Kelp floating on water (A1 decoration, drawn on transparent). */
function kelp(): Painter {
  return (x, y) => {
    for (const [kx, top] of [[3, 2], [8, 5], [12, 1]] as const) {
      const sx = kx + (Math.floor(y / 3) % 2);
      if (y >= top && y <= 14 && x === sx) return y % 3 === 0 ? RAMPS.swamp[3] : RAMPS.swamp[2];
    }
    return null;
  };
}

/** Builds the A4 cliffs / walls of a tileset (first pair). */
function walls(b: TilesetBuilder, list: [FloorStyle, WallStyle][]): void {
  list.forEach(([top, side], col) => {
    b.a4Top(col, 0, top, X);
    b.a4Side(col, 0, side, X);
  });
}

// ---------------------------------------------------------------------------
// Cavern
// ---------------------------------------------------------------------------

/** Caves, crystal grottos and mines. */
export function cavernTileset(): GeneratedTileset {
  const b = new TilesetBuilder('Cavern', TilesetMode.Area);

  b.a2(0, 0, baseGround(M.dirt(RAMPS.mud, 'cav-mud')), PASS);
  b.a2(1, 0, baseGround(M.dirt(RAMPS.stone, 'cav-grey')), PASS);
  b.a2(2, 0, baseGround(M.dirt(RAMPS.basalt, 'cav-dark')), PASS);
  b.a2(3, 0, baseGround(M.flagstone(RAMPS.glow, 'cav-crystal')), PASS);
  b.a2(4, 0, overlay(M.dirt(RAMPS.rock, 'cav-gravel'), RAMPS.rock), PASS);
  b.a2(5, 0, overlay(M.grass(RAMPS.glow, 'cav-glowmoss', 3), RAMPS.glow, true), PASS);
  b.a2(6, 0, overlay(M.liquid(RAMPS.deepWater, 0, 'cav-puddle'), RAMPS.deepWater), PASS);
  b.a2(7, 0, overlay(M.planks(RAMPS.plank, 'cav-boards'), RAMPS.plank, true), PASS);
  b.a2(0, 1, baseGround(M.sand(RAMPS.wetSand, 'cav-sand')), PASS);
  b.a2(1, 1, baseGround(M.cobble(RAMPS.rock, 'cav-cobble')), PASS);
  b.a2(2, 1, baseGround(M.flagstone(RAMPS.ice, 'cav-ice')), PASS);
  b.a2(3, 1, baseGround(M.grass(RAMPS.swamp, 'cav-moss')), PASS);
  b.a2(4, 1, overlay(M.dirt(RAMPS.mud, 'cav-mudpatch'), RAMPS.mud), PASS);
  b.a2(5, 1, overlay(M.liquid(RAMPS.ice, 0, 'cav-frost'), RAMPS.ice), PASS);
  b.a2(6, 1, overlay(M.dirt(RAMPS.cliff, 'cav-red'), RAMPS.cliff), PASS);
  b.a2(7, 1, overlay(M.flagstone(RAMPS.poison, 'cav-amethyst'), RAMPS.poison, true), PASS);

  walls(b, [
    [wallTop(M.dirt(RAMPS.cliff, 'cvt1'), RAMPS.cliff), wallSide(M.rockFace(RAMPS.cliff, 'cvw1'), RAMPS.cliff)],
    [wallTop(M.dirt(RAMPS.stone, 'cvt2'), RAMPS.stone), wallSide(M.rockFace(RAMPS.stone, 'cvw2'), RAMPS.stone)],
    [wallTop(M.dirt(RAMPS.basalt, 'cvt3'), RAMPS.basalt), wallSide(M.rockFace(RAMPS.basalt, 'cvw3'), RAMPS.basalt)],
    [wallTop(M.flagstone(RAMPS.glow, 'cvt4'), RAMPS.glow), wallSide(M.rockFace(RAMPS.glow, 'cvw4'), RAMPS.glow)],
    [wallTop(M.grass(RAMPS.swamp, 'cvt5'), RAMPS.swamp), wallSide(withVines(M.rockFace(RAMPS.rock, 'cvw5'), RAMPS.swamp, 'cvv5'), RAMPS.rock)],
    [wallTop(M.snow('cvt6'), RAMPS.snow), wallSide(M.rockFace(RAMPS.ice, 'cvw6'), RAMPS.ice)],
    [wallTop(M.sand(RAMPS.wetSand, 'cvt7'), RAMPS.wetSand), wallSide(M.rockFace(RAMPS.wetSand, 'cvw7'), RAMPS.wetSand)],
    [wallTop(M.dirt(RAMPS.mud, 'cvt8'), RAMPS.mud), wallSide(M.boards(RAMPS.wood, 'cvw8'), RAMPS.wood)],
  ]);

  b.a5(0, 0, tile(M.solid('#000000')), X);
  b.a5(1, 0, (c, x, y) => {
    c.fillRect(x, y, 16, 16, RAMPS.dark[1]);
    c.fillEllipse(x + 1, y + 1, 14, 14, '#000000');
  }, X);
  b.a5(2, 0, tile(M.planks(RAMPS.plank, 'cav-floor')), PASS);
  b.a5(3, 0, O.stairs(false, RAMPS.rock), PASS | FLAG_LADDER);

  b.object('B', 1, 0, B.stalagmite(), X);
  b.object('B', 2, 0, B.stalagmite(RAMPS.stone), X);
  b.object('B', 3, 0, B.stalactite(), STAR);
  b.object('B', 4, 0, B.stalactite(RAMPS.ice), STAR);
  b.object('B', 5, 0, B.glowMushrooms(), PASS);
  b.object('B', 6, 0, B.glowMushrooms(RAMPS.poison), PASS);
  b.object('B', 7, 0, O.crystal(RAMPS.glow), X);
  b.object('B', 0, 1, B.oreRock(RAMPS.gold), X);
  b.object('B', 1, 1, B.oreRock(RAMPS.silver), X);
  b.object('B', 2, 1, B.oreRock(RAMPS.poison), X);
  b.object('B', 3, 1, B.oreRock(RAMPS.glow), X);
  b.object('B', 4, 1, B.rubble(), PASS);
  b.object('B', 5, 1, B.rubble(RAMPS.stone, 'rubble2'), PASS);
  b.object('B', 6, 1, B.ropeLadder(), PASS | FLAG_LADDER);
  b.object('B', 7, 1, B.minerTools(), X);
  b.object('B', 0, 2, B.rails('h'), PASS);
  b.object('B', 1, 2, B.rails('v'), PASS);
  b.object('B', 2, 2, B.mineCart(), X);
  b.object('B', 3, 2, B.mineCart(RAMPS.silver), X);
  b.object('B', 4, 2, B.lantern(), X);
  b.object('B', 5, 2, O.chest(false), X);
  b.object('B', 6, 2, O.chest(true), X);
  b.object('B', 7, 2, O.bones(true), PASS);
  b.object('B', 0, 3, B.tallStalagmite(), TALL, { w: 1, h: 2 });
  b.object('B', 1, 3, B.tallStalagmite(RAMPS.ice), TALL, { w: 1, h: 2 });
  b.object('B', 2, 3, B.bigCrystal(), TALL, { w: 1, h: 2 });
  b.object('B', 3, 3, B.bigCrystal(RAMPS.poison), TALL, { w: 1, h: 2 });
  b.object('B', 4, 3, B.mineSupport(), [[STAR], [PASS]], { w: 1, h: 2 });
  b.object('B', 5, 3, O.pillar(RAMPS.rock), TALL, { w: 1, h: 2 });
  b.object('B', 6, 3, O.rock(RAMPS.rock, true), BIG, { w: 2, h: 2 });
  b.object('B', 0, 5, O.cobweb(), STAR);
  b.object('B', 1, 5, O.crack(RAMPS.rock), PASS);
  b.object('B', 2, 5, O.stairs(false, RAMPS.rock), PASS | FLAG_LADDER);
  b.object('B', 3, 5, O.stairs(true, RAMPS.rock), PASS);
  b.object('B', 4, 5, O.barrel(), X);
  b.object('B', 5, 5, O.crate(), X);
  b.object('B', 6, 5, O.wallTorch(), STAR);
  b.object('B', 7, 5, O.bones(), PASS);

  return b.build();
}

// ---------------------------------------------------------------------------
// Jungle
// ---------------------------------------------------------------------------

/** Tropical forest, rivers and overgrown temples. */
export function jungleTileset(): GeneratedTileset {
  const b = new TilesetBuilder('Jungle', TilesetMode.Area);
  const jungleGrass = M.grass(RAMPS.jungle, 'jgrass', 9);

  b.a2(0, 0, baseGround(jungleGrass), PASS);
  b.a2(1, 0, baseGround(M.grass(RAMPS.jungleLight, 'jlight')), PASS);
  b.a2(2, 0, baseGround(M.dirt(RAMPS.mud, 'jmud')), PASS);
  b.a2(3, 0, baseGround(M.grass(RAMPS.leavesAutumn, 'jlitter', 10)), PASS);
  b.a2(4, 0, overlay(M.dirt(RAMPS.path, 'jpath'), RAMPS.path), PASS);
  b.a2(5, 0, overlay(M.grass(RAMPS.jungle, 'jtall', 14), RAMPS.jungle, true), PASS | FLAG_BUSH);
  b.a2(6, 0, overlay(tropicalMeadow(), RAMPS.jungle, true), PASS);
  b.a2(7, 0, overlay(M.flagstone(RAMPS.stoneWarm, 'jtemple-path'), RAMPS.stoneWarm), PASS);
  b.a2(0, 1, baseGround(M.flagstone(RAMPS.stoneWarm, 'jtemple')), PASS);
  b.a2(1, 1, baseGround(M.grass(RAMPS.swamp, 'jswamp')), PASS);
  b.a2(2, 1, baseGround(M.sand(RAMPS.sand, 'jbank')), PASS);
  b.a2(3, 1, baseGround(M.dirt(RAMPS.cliff, 'jred')), PASS);
  b.a2(4, 1, overlay(M.grass(RAMPS.jungleLight, 'jmoss', 3), RAMPS.jungleLight, true), PASS);
  b.a2(5, 1, overlay(M.liquid(RAMPS.mud, 0, 'jpuddle'), RAMPS.mud), PASS);
  b.a2(6, 1, overlay(M.dirt(RAMPS.mud, 'jmudpath'), RAMPS.mud), PASS);
  b.a2(7, 1, overlay(M.planks(RAMPS.bamboo, 'jbamboo-floor'), RAMPS.bamboo, true), PASS);

  // Huts and temples.
  b.a3(0, 0, { ...roofStyle(M.thatchRoof('jthatch'), RAMPS.thatch) }, X);
  b.a3(1, 0, roofStyle(M.leafy(RAMPS.jungleLight, 'jleafroof'), RAMPS.jungleLight), X);
  b.a3(2, 0, roofStyle(M.shingles(RAMPS.stoneWarm, 'jstoneroof'), RAMPS.stoneWarm), X);
  b.a3(3, 0, roofStyle(M.shingles(RAMPS.gold, 'jgoldroof'), RAMPS.gold), X);
  b.a3(0, 1, wallSide(M.boards(RAMPS.bamboo, 'jhut'), RAMPS.bamboo), X);
  b.a3(1, 1, wallSide(M.plaster(RAMPS.mud, 'jmudwall'), RAMPS.mud), X);
  b.a3(2, 1, wallSide(withVines(M.bricks(RAMPS.stoneWarm, 'jtemplewall'), RAMPS.jungleLight, 'jtv'), RAMPS.stoneWarm), X);
  b.a3(3, 1, wallSide(M.bricks(RAMPS.gold, 'jgoldwall'), RAMPS.gold), X);

  walls(b, [
    [wallTop(jungleGrass, RAMPS.jungle), wallSide(withVines(M.rockFace(RAMPS.cliff, 'jw1'), RAMPS.jungleLight, 'jv1'), RAMPS.cliff)],
    [wallTop(M.flagstone(RAMPS.stoneWarm, 'jt2'), RAMPS.stoneWarm), wallSide(withVines(M.bricks(RAMPS.stoneWarm, 'jw2'), RAMPS.jungle, 'jv2'), RAMPS.stoneWarm)],
    [wallTop(M.leafy(RAMPS.jungle, 'jt3'), RAMPS.jungle), wallSide(M.leafy(RAMPS.jungle, 'jw3'), RAMPS.jungle)],
    [wallTop(M.dirt(RAMPS.cliff, 'jt4'), RAMPS.cliff), wallSide(M.rockFace(RAMPS.brick, 'jw4'), RAMPS.brick)],
    [wallTop(M.planks(RAMPS.bamboo, 'jt5'), RAMPS.bamboo), wallSide(M.boards(RAMPS.bamboo, 'jw5'), RAMPS.bamboo)],
    [wallTop(M.grass(RAMPS.swamp, 'jt6'), RAMPS.swamp), wallSide(M.rockFace(RAMPS.stone, 'jw6'), RAMPS.stone)],
    [wallTop(M.flagstone(RAMPS.gold, 'jt7'), RAMPS.gold), wallSide(M.bricks(RAMPS.gold, 'jw7'), RAMPS.gold)],
    [wallTop(M.dirt(RAMPS.mud, 'jt8'), RAMPS.mud), wallSide(M.rockFace(RAMPS.mud, 'jw8'), RAMPS.mud)],
  ]);

  b.a5(0, 0, tile(M.solid('#000000')), X);
  b.a5(1, 0, tile(M.planks(RAMPS.bamboo, 'jbridge-h')), PASS);
  b.a5(2, 0, (c, x, y) => {
    tile(M.planks(RAMPS.bamboo, 'jbridge-v'))(c, x, y);
    for (let i = 0; i < 16; i += 4) c.vline(x + i, y, y + 15, RAMPS.bamboo[0]);
  }, PASS);
  b.a5(3, 0, O.stairs(false, RAMPS.stoneWarm), PASS | FLAG_LADDER);

  b.object('B', 1, 0, B.fern(), PASS | FLAG_BUSH);
  b.object('B', 2, 0, B.fern(RAMPS.jungle), PASS | FLAG_BUSH);
  b.object('B', 3, 0, B.bigLeafPlant(), X);
  b.object('B', 4, 0, B.tropicalFlowers(), PASS);
  b.object('B', 5, 0, B.tropicalFlowers(RAMPS.sulfur), PASS);
  b.object('B', 6, 0, B.tropicalFlowers(RAMPS.poison), PASS);
  b.object('B', 7, 0, B.carnivorousPlant(), X);
  b.object('B', 0, 1, B.hangingVines(), STAR);
  b.object('B', 1, 1, B.hangingVines(RAMPS.jungle), STAR);
  b.object('B', 2, 1, O.rock(RAMPS.stoneWarm), X);
  b.object('B', 3, 1, O.mushrooms(RAMPS.sulfur), PASS);
  b.object('B', 4, 1, O.bush(RAMPS.jungle, 'jbush'), X);
  b.object('B', 5, 1, O.bush(RAMPS.jungleLight, 'jbush2'), X);
  b.object('B', 6, 1, O.stump(), X);
  b.object('B', 7, 1, O.tallGrass(RAMPS.jungle), PASS | FLAG_BUSH);
  b.object('B', 0, 2, B.palmTree(), BIG, { w: 2, h: 2 });
  b.object('B', 2, 2, B.jungleTree(), BIG, { w: 2, h: 2 });
  b.object('B', 4, 2, B.jungleTree(RAMPS.jungleLight, 'jungle-tree2'), BIG, { w: 2, h: 2 });
  b.object('B', 6, 2, B.bamboo(), TALL, { w: 1, h: 2 });
  b.object('B', 7, 2, B.bananaPlant(), TALL, { w: 1, h: 2 });
  b.object('B', 0, 4, B.ruinPillar(), TALL, { w: 1, h: 2 });
  b.object('B', 1, 4, B.stoneIdol(), TALL, { w: 1, h: 2 });
  b.object('B', 2, 4, B.mossyLog(), X, { w: 2, h: 1 });
  b.object('B', 4, 4, O.chest(false, RAMPS.stoneWarm), X);
  b.object('B', 5, 4, O.pot(RAMPS.stoneWarm), X);
  b.object('B', 6, 4, O.rock(RAMPS.stoneWarm, true), BIG, { w: 2, h: 2 });
  b.object('B', 2, 5, O.bones(true), PASS);
  b.object('B', 3, 5, O.crack(RAMPS.stoneWarm), PASS);
  b.object('B', 4, 5, O.tent(RAMPS.bamboo), BIG, { w: 2, h: 2 });

  return b.build();
}

/** Roof style (same as the Outside roofs). */
function roofStyle(fill: Painter, ramp: Ramp): WallStyle {
  return {
    fill,
    edge: (d) => {
      if (d.left === 0 || d.right === 0 || d.bottom === 0) return RAMPS.dark[0];
      if (d.top <= 1) return ramp[3];
      if (d.bottom === 1 || d.bottom === 2) return ramp[0];
      if (d.left === 1 || d.right === 1) return ramp[1];
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Volcano
// ---------------------------------------------------------------------------

/** Volcanic slopes, lava fields and fire fortresses. */
export function volcanoTileset(): GeneratedTileset {
  const b = new TilesetBuilder('Volcano', TilesetMode.Area);

  b.a2(0, 0, baseGround(M.dirt(RAMPS.basalt, 'vbasalt')), PASS);
  b.a2(1, 0, baseGround(M.dirt(RAMPS.stone, 'vash')), PASS);
  b.a2(2, 0, baseGround(lavaCrust()), PASS);
  b.a2(3, 0, baseGround(M.dirt(RAMPS.brick, 'vred')), PASS);
  b.a2(4, 0, overlay(M.sand(RAMPS.stone, 'vashpatch'), RAMPS.stone), PASS);
  b.a2(5, 0, overlay(M.flagstone(RAMPS.obsidian, 'vobsidian'), RAMPS.obsidian), PASS);
  b.a2(6, 0, overlay(M.dirt(RAMPS.sulfur, 'vsulfur'), RAMPS.sulfur), PASS);
  b.a2(7, 0, overlay(lavaCrust('vembers'), RAMPS.magma, true), PASS | FLAG_DAMAGE);
  b.a2(0, 1, baseGround(M.flagstone(RAMPS.obsidian, 'vobsfloor')), PASS);
  b.a2(1, 1, baseGround(M.dirt(RAMPS.mud, 'vscorched')), PASS);
  b.a2(2, 1, baseGround(M.cobble(RAMPS.basalt, 'vcobble')), PASS);
  b.a2(3, 1, baseGround(M.dirt(RAMPS.sulfur, 'vbrimstone')), PASS);
  b.a2(4, 1, overlay(M.dirt(RAMPS.basalt, 'vgravel'), RAMPS.basalt), PASS);
  b.a2(5, 1, overlay(M.cobble(RAMPS.brick, 'vroad'), RAMPS.brick), PASS);
  b.a2(6, 1, overlay(M.dirt(RAMPS.rock, 'vrocky'), RAMPS.rock), PASS);
  b.a2(7, 1, overlay(M.sand(RAMPS.brick, 'vredsand'), RAMPS.brick), PASS);

  walls(b, [
    [wallTop(M.dirt(RAMPS.basalt, 'vt1'), RAMPS.basalt), wallSide(M.rockFace(RAMPS.basalt, 'vw1'), RAMPS.basalt)],
    [wallTop(M.dirt(RAMPS.brick, 'vt2'), RAMPS.brick), wallSide(M.rockFace(RAMPS.brick, 'vw2'), RAMPS.brick)],
    [wallTop(M.flagstone(RAMPS.obsidian, 'vt3'), RAMPS.obsidian), wallSide(M.rockFace(RAMPS.obsidian, 'vw3'), RAMPS.obsidian)],
    [wallTop(M.dirt(RAMPS.stone, 'vt4'), RAMPS.stone), wallSide(M.rockFace(RAMPS.rock, 'vw4'), RAMPS.rock)],
    [wallTop(lavaCrust('vt5'), RAMPS.basalt), wallSide(magmaVeins(), RAMPS.basalt)],
    [wallTop(M.dirt(RAMPS.sulfur, 'vt6'), RAMPS.sulfur), wallSide(M.rockFace(RAMPS.sulfur, 'vw6'), RAMPS.sulfur)],
    [wallTop(M.flagstone(RAMPS.dark, 'vt7'), RAMPS.dark), wallSide(M.bricks(RAMPS.dark, 'vw7'), RAMPS.stone)],
    [wallTop(M.sand(RAMPS.stone, 'vt8'), RAMPS.stone), wallSide(M.rockFace(RAMPS.stone, 'vw8'), RAMPS.stone)],
  ]);

  b.a5(0, 0, tile(M.solid('#000000')), X);
  b.a5(1, 0, tile(M.planks(RAMPS.wood, 'vbridge')), PASS);
  b.a5(2, 0, tile(lavaCrust('va5')), PASS);
  b.a5(3, 0, O.stairs(false, RAMPS.basalt), PASS | FLAG_LADDER);

  b.object('B', 1, 0, B.lavaRock(), X);
  b.object('B', 2, 0, B.steamVent(), X);
  b.object('B', 3, 0, B.obsidianShards(), X);
  b.object('B', 4, 0, B.sulfurCrystals(), X);
  b.object('B', 5, 0, B.ashPile(), PASS);
  b.object('B', 6, 0, B.emberCrack(), PASS | FLAG_DAMAGE);
  b.object('B', 7, 0, O.bones(true), PASS);
  b.object('B', 0, 1, O.rock(RAMPS.basalt), X);
  b.object('B', 1, 1, O.rock(RAMPS.brick), X);
  b.object('B', 2, 1, O.crystal(RAMPS.magma), X);
  b.object('B', 3, 1, O.crystal(RAMPS.obsidian), X);
  b.object('B', 4, 1, O.wallTorch(), STAR);
  b.object('B', 5, 1, O.bones(), PASS);
  b.object('B', 6, 1, O.crack(RAMPS.basalt), PASS);
  b.object('B', 7, 1, O.chest(false, RAMPS.dark), X);
  b.object('B', 0, 2, B.charredTree(), TALL, { w: 1, h: 2 });
  b.object('B', 1, 2, B.basaltColumns(), TALL, { w: 1, h: 2 });
  b.object('B', 2, 2, O.pillar(RAMPS.basalt), TALL, { w: 1, h: 2 });
  b.object('B', 3, 2, B.bigCrystal(RAMPS.magma), TALL, { w: 1, h: 2 });
  b.object('B', 4, 2, B.lavaRock(true), BIG, { w: 2, h: 2 });
  b.object('B', 6, 2, B.ribcage(), BIG, { w: 2, h: 2 });
  b.object('B', 0, 4, O.altar(), X, { w: 2, h: 1 });
  b.object('B', 2, 4, O.stairs(false, RAMPS.basalt), PASS | FLAG_LADDER);
  b.object('B', 3, 4, O.stairs(true, RAMPS.basalt), PASS);
  b.object('B', 4, 4, O.ironDoor(), PASS);
  b.object('B', 5, 4, O.chest(true, RAMPS.dark), X);

  return b.build();
}

// ---------------------------------------------------------------------------
// Sea
// ---------------------------------------------------------------------------

/** Beaches, harbours, reefs and the open ocean. */
export function seaTileset(): GeneratedTileset {
  const b = new TilesetBuilder('Sea', TilesetMode.Area);
  const sandFill = M.sand();
  const wetFill = M.sand(RAMPS.wetSand, 'wet');
  const rockFill = M.dirt(RAMPS.rock, 'shore-rock');
  const grassFill = M.grass();

  // --- A1: sea, ocean, lagoons and reefs ----------------------------------------
  b.a1Water(0, (f) => liquidStyle(RAMPS.water, f, sandFill, RAMPS.sand[0], 'sea'), X);
  b.a1Water(1, (f) => liquidStyle(RAMPS.deepWater, f, sandFill, RAMPS.sand[0], 'ocean'), X | FLAG_BOAT_BLOCK);
  b.a1Decoration(2, overlay(M.rockFace(RAMPS.rock, 'reef'), RAMPS.rock, true), X | FLAG_BOAT_BLOCK | FLAG_SHIP_BLOCK);
  b.a1Decoration(3, { fill: kelp(), outside: null }, X);
  b.a1Water(4, (f) => liquidStyle(RAMPS.lagoon, f, sandFill, RAMPS.sand[0], 'lagoon'), X);
  b.a1Waterfall(5, (f) => fallStyle(RAMPS.water, f), X);
  b.a1Water(6, (f) => liquidStyle(RAMPS.lagoon, f, wetFill, RAMPS.wetSand[0], 'reef-lagoon'), X);
  b.a1Waterfall(7, (f) => fallStyle(RAMPS.lagoon, f), X);
  b.a1Water(8, (f) => liquidStyle(RAMPS.water, f, grassFill, RAMPS.dirt[1], 'coast'), X);
  b.a1Waterfall(9, (f) => fallStyle(RAMPS.deepWater, f), X);
  b.a1Water(10, (f) => liquidStyle(RAMPS.ice, f, M.snow('polar'), RAMPS.ice[0], 'polar'), X);
  b.a1Waterfall(11, (f) => fallStyle(RAMPS.ice, f, RAMPS.snow), X);
  b.a1Water(12, (f) => liquidStyle(RAMPS.obsidian, f, rockFill, RAMPS.rock[0], 'abyss'), X | FLAG_BOAT_BLOCK);
  b.a1Waterfall(13, (f) => fallStyle(RAMPS.obsidian, f), X);
  b.a1Water(14, (f) => liquidStyle(RAMPS.water, f, rockFill, RAMPS.rock[0], 'tidepool'), X);
  b.a1Waterfall(15, (f) => fallStyle(RAMPS.water, f, RAMPS.stone), X);

  // --- A2: shores ------------------------------------------------------------------
  b.a2(0, 0, baseGround(sandFill), PASS);
  b.a2(1, 0, baseGround(wetFill), PASS);
  b.a2(2, 0, baseGround(M.cobble(RAMPS.stone, 'pebbles')), PASS);
  b.a2(3, 0, baseGround(M.grass(RAMPS.grass, 'dune')), PASS);
  b.a2(4, 0, overlay(M.sand(RAMPS.wetSand, 'wetpatch'), RAMPS.wetSand), PASS);
  b.a2(5, 0, overlay(M.dirt(RAMPS.stone, 'shingle'), RAMPS.stone), PASS);
  b.a2(6, 0, overlay(shellySand(), RAMPS.sand), PASS);
  b.a2(7, 0, overlay(M.grass(RAMPS.jungleLight, 'dunegrass', 12), RAMPS.jungleLight, true), PASS | FLAG_BUSH);
  b.a2(0, 1, baseGround(M.planks(RAMPS.plank, 'dock')), PASS);
  b.a2(1, 1, baseGround(rockFill), PASS);
  b.a2(2, 1, baseGround(M.sand(RAMPS.plaster, 'whitesand')), PASS);
  b.a2(3, 1, baseGround(M.sand(RAMPS.lagoon, 'seabed')), PASS);
  b.a2(4, 1, overlay(M.liquid(RAMPS.lagoon, 0, 'tidal'), RAMPS.lagoon), PASS);
  b.a2(5, 1, overlay(M.grass(RAMPS.swamp, 'wrack', 3), RAMPS.swamp, true), PASS);
  b.a2(6, 1, overlay(M.rockFace(RAMPS.rock, 'wetrock'), RAMPS.rock, true), PASS);
  b.a2(7, 1, overlay(M.planks(RAMPS.plank, 'boardwalk'), RAMPS.plank, true), PASS);

  // --- A4: cliffs and quays ----------------------------------------------------------
  walls(b, [
    [wallTop(grassFill, RAMPS.grass), wallSide(M.rockFace(RAMPS.cliff, 'sw1'), RAMPS.cliff)],
    [wallTop(M.grass(RAMPS.grass, 'chalk-top'), RAMPS.grass), wallSide(M.rockFace(RAMPS.plaster, 'sw2'), RAMPS.plaster)],
    [wallTop(sandFill, RAMPS.sand), wallSide(M.rockFace(RAMPS.sand, 'sw3'), RAMPS.sand)],
    [wallTop(M.flagstone(RAMPS.stone, 'quay'), RAMPS.stone), wallSide(M.bricks(RAMPS.stone, 'sw4'), RAMPS.stone)],
    [wallTop(rockFill, RAMPS.rock), wallSide(M.rockFace(RAMPS.rock, 'sw5'), RAMPS.rock)],
    [wallTop(M.planks(RAMPS.plank, 'pier'), RAMPS.plank), wallSide(M.boards(RAMPS.wood, 'sw6'), RAMPS.wood)],
    [wallTop(M.dirt(RAMPS.coral, 'reef-top'), RAMPS.coral), wallSide(M.rockFace(RAMPS.coral, 'sw7'), RAMPS.coral)],
    [wallTop(M.dirt(RAMPS.basalt, 'black-top'), RAMPS.basalt), wallSide(M.rockFace(RAMPS.basalt, 'sw8'), RAMPS.basalt)],
  ]);

  // --- A5 -----------------------------------------------------------------------------
  b.a5(0, 0, tile(M.solid('#000000')), X);
  b.a5(1, 0, tile(M.planks(RAMPS.plank, 'pier-h')), PASS);
  b.a5(2, 0, (c, x, y) => {
    tile(M.planks(RAMPS.plank, 'pier-v'))(c, x, y);
    for (let i = 0; i < 16; i += 4) c.vline(x + i, y, y + 15, RAMPS.plank[0]);
  }, PASS);
  b.a5(3, 0, tile(sandFill), PASS);
  b.a5(4, 0, O.stairs(false, RAMPS.stone), PASS | FLAG_LADDER);

  // --- B: beach and harbour props (water props block, like the water under them) ---
  b.object('B', 1, 0, B.shell(), PASS);
  b.object('B', 2, 0, B.shell(RAMPS.plaster), PASS);
  b.object('B', 3, 0, B.starfish(), PASS);
  b.object('B', 4, 0, B.starfish(RAMPS.coral), PASS);
  b.object('B', 5, 0, B.bottle(), PASS);
  b.object('B', 6, 0, B.driftwood(), PASS);
  b.object('B', 7, 0, B.fishingNet(), PASS);
  b.object('B', 0, 1, B.coral(), X);
  b.object('B', 1, 1, B.coral(RAMPS.cloth), X);
  b.object('B', 2, 1, B.coral(RAMPS.sulfur), X);
  b.object('B', 3, 1, B.seaweed(), X);
  b.object('B', 4, 1, B.buoy(), X);
  b.object('B', 5, 1, O.rock(RAMPS.rock), X);
  b.object('B', 6, 1, B.seaweed(RAMPS.jungle), X);
  b.object('B', 7, 1, B.dockPost(), X);
  b.object('B', 0, 2, B.anchor(), X);
  b.object('B', 1, 2, B.sandcastle(), X);
  b.object('B', 2, 2, O.barrel(), X);
  b.object('B', 3, 2, O.crate(), X);
  b.object('B', 4, 2, O.chest(false), X);
  b.object('B', 5, 2, O.chest(true), X);
  b.object('B', 6, 2, O.bones(true), PASS);
  b.object('B', 7, 2, O.rock(RAMPS.stone), X);
  b.object('B', 0, 3, B.palmTree(), BIG, { w: 2, h: 2 });
  b.object('B', 2, 3, B.palmTree(RAMPS.jungle), BIG, { w: 2, h: 2 });
  b.object('B', 4, 3, B.lighthouse(), [[STAR], [STAR], [X]], { w: 1, h: 3 });
  b.object('B', 5, 3, B.wreckMast(), TALL, { w: 1, h: 2 });
  b.object('B', 6, 3, B.rowboat(), X, { w: 2, h: 1 });
  b.object('B', 6, 4, O.rock(RAMPS.rock, true), BIG, { w: 2, h: 2 });

  return b.build();
}
