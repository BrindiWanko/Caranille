/**
 * @file Pixel-art props of the biome tilesets: caverns and mines, jungle,
 * volcano and seaside. Same conventions as `objects.ts`: drawn on a scratch
 * canvas, outlined, light from the top-left, 3–4 tone ramps.
 */
import { OUTLINE, RAMPS, type Ramp } from '../../shared/art/palette.js';
import { Rng, seedFrom, withAlpha, type PixelCanvas } from '../../shared/art/pixel.js';
import { foliage, groundShadow, layers, shadedBlob, sprite, type Draw } from './objects.js';

/** Vertical cone (stalagmite, rock spire): `w` wide at the base, `h` high, base at `bottom`. */
function cone(s: PixelCanvas, cx: number, bottom: number, w: number, h: number, ramp: Ramp): void {
  for (let j = 0; j < h; j++) {
    const half = Math.max(0, Math.round(((j + 1) / h) * (w / 2)) - 1);
    const y = bottom - h + 1 + j;
    for (let i = -half; i <= half; i++) s.set(cx + i, y, i < -half / 3 ? ramp[3] : i > half / 3 ? ramp[1] : ramp[2]);
    if (half > 0) s.set(cx + half, y, ramp[0]);
  }
}

// ---------------------------------------------------------------------------
// Caverns and mines
// ---------------------------------------------------------------------------

/** Stalagmite group rising from the floor (1 × 1). */
export function stalagmite(ramp: Ramp = RAMPS.rock): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      cone(s, 6, 15, 8, 13, ramp);
      cone(s, 11, 15, 6, 8, ramp);
      cone(s, 2, 15, 3, 5, ramp);
    }),
  );
}

/** Tall stalagmite, 1 × 2 tiles. */
export function tallStalagmite(ramp: Ramp = RAMPS.rock): Draw {
  return layers(
    groundShadow(8, 30, 14, 3),
    sprite(16, 32, (s) => {
      cone(s, 7, 31, 12, 29, ramp);
      cone(s, 12, 31, 5, 9, ramp);
      for (let y = 8; y < 30; y += 6) s.set(6, y, ramp[1]);
    }),
  );
}

/** Stalactites hanging from the ceiling (drawn over the player). */
export function stalactite(ramp: Ramp = RAMPS.rock): Draw {
  return sprite(16, 16, (s) => {
    const drip = (cx: number, w: number, h: number) => {
      for (let j = 0; j < h; j++) {
        const half = Math.max(0, Math.round(((h - j) / h) * (w / 2)) - 1);
        for (let i = -half; i <= half; i++) s.set(cx + i, j, i < 0 ? ramp[3] : ramp[2]);
        if (half > 0) s.set(cx + half, j, ramp[1]);
      }
    };
    drip(4, 6, 12);
    drip(10, 5, 8);
    drip(13, 3, 5);
    s.set(4, 13, RAMPS.glow[3]);
  });
}

/** Glowing cave mushrooms (passable). */
export function glowMushrooms(ramp: Ramp = RAMPS.glow): Draw {
  return (c, x, y) => {
    const halo = withAlpha(ramp[3], 0.25);
    c.fillEllipse(x + 1, y + 3, 14, 12, halo);
    const shroom = (mx: number, my: number, r: number) => {
      c.fillRect(x + mx - 1, y + my, 2, r + 2, RAMPS.plaster[2]);
      for (let j = 0; j <= r; j++) c.hline(x + mx - r + Math.floor(j / 2), x + mx + r - Math.floor(j / 2), y + my - j, j === r ? ramp[3] : ramp[2]);
      c.hline(x + mx - r, x + mx + r, y + my, ramp[1]);
      c.set(x + mx - 1, y + my - r + 1, '#ffffff');
    };
    shroom(5, 9, 3);
    shroom(11, 12, 2);
    shroom(9, 6, 2);
  };
}

/** Rock with an ore vein (gold, silver, gems...). */
export function oreRock(ore: Ramp = RAMPS.gold, ramp: Ramp = RAMPS.rock): Draw {
  const rng = new Rng(seedFrom(`ore-${ore[2]}`));
  return layers(
    groundShadow(8, 14, 14, 4),
    sprite(16, 16, (s) => {
      shadedBlob(s, 1, 3, 14, 11, ramp);
      for (let i = 0; i < 6; i++) {
        const px = rng.int(3, 11);
        const py = rng.int(5, 11);
        s.set(px, py, ore[2]);
        s.set(px + 1, py, ore[3]);
        s.set(px, py + 1, ore[1]);
      }
    }),
  );
}

/** Large crystal formation, 1 × 2 tiles. */
export function bigCrystal(ramp: Ramp = RAMPS.glow): Draw {
  return layers(
    groundShadow(8, 30, 14, 3),
    sprite(16, 32, (s) => {
      const shard = (cx: number, bottom: number, w: number, h: number) => {
        for (let j = 0; j < h; j++) {
          const half = Math.min(w, Math.floor((j + 2) / 2));
          const yy = bottom - h + j;
          s.hline(cx - half, cx + half, yy, ramp[2]);
          s.set(cx - half, yy, ramp[3]);
          if (half > 1) s.set(cx - half + 1, yy, ramp[3]);
          s.set(cx + half, yy, ramp[1]);
        }
      };
      shard(8, 31, 3, 28);
      shard(4, 31, 2, 14);
      shard(12, 31, 2, 18);
      s.vline(7, 6, 26, '#ffffff');
    }),
  );
}

/** Mine support: two posts and a beam, 1 × 2 tiles. */
export function mineSupport(): Draw {
  const w = RAMPS.wood;
  return sprite(16, 32, (s) => {
    for (const px of [1, 12]) {
      s.fillRect(px, 3, 3, 28, w[2]);
      s.vline(px, 3, 30, w[3]);
      s.vline(px + 2, 3, 30, w[1]);
    }
    s.fillRect(0, 1, 16, 4, w[2]);
    s.hline(0, 15, 1, w[3]);
    s.hline(0, 15, 4, w[0]);
    s.line(4, 5, 7, 8, w[1]);
    s.line(11, 5, 8, 8, w[1]);
  });
}

/** Mine rails (passable): `h` horizontal, `v` vertical. */
export function rails(dir: 'h' | 'v'): Draw {
  return (c, x, y) => {
    const tie = RAMPS.wood;
    const rail = RAMPS.iron;
    for (let k = 1; k < 16; k += 4) {
      if (dir === 'h') {
        c.fillRect(x + k, y + 3, 2, 10, tie[1]);
        c.vline(x + k, y + 3, y + 12, tie[2]);
      } else {
        c.fillRect(x + 3, y + k, 10, 2, tie[1]);
        c.hline(x + 3, x + 12, y + k, tie[2]);
      }
    }
    if (dir === 'h') {
      for (const ry of [5, 10]) {
        c.hline(x, x + 15, y + ry, rail[3]);
        c.hline(x, x + 15, y + ry + 1, rail[1]);
      }
    } else {
      for (const rx of [5, 10]) {
        c.vline(x + rx, y, y + 15, rail[3]);
        c.vline(x + rx + 1, y, y + 15, rail[1]);
      }
    }
  };
}

/** Mine cart full of ore. */
export function mineCart(ore: Ramp = RAMPS.gold): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      const r = RAMPS.iron;
      s.fillRect(2, 6, 12, 7, r[2]);
      s.hline(1, 14, 6, r[3]);
      s.hline(2, 13, 12, r[0]);
      s.vline(4, 7, 11, r[1]);
      s.vline(11, 7, 11, r[1]);
      for (let i = 0; i < 5; i++) shadedBlob(s, 2 + i * 2, 2 + (i % 2), 4, 4, i % 2 ? ore : RAMPS.rock);
      for (const wx of [3, 10]) {
        s.fillRect(wx, 12, 3, 3, RAMPS.dark[2]);
        s.set(wx + 1, 13, r[3]);
      }
    }),
  );
}

/** Standing miner's lantern. */
export function lantern(): Draw {
  return layers(
    groundShadow(8, 15, 8, 2),
    sprite(16, 16, (s) => {
      s.fillEllipse(3, 2, 10, 11, withAlpha(RAMPS.fire[3], 0.25));
      s.fillRect(5, 5, 6, 8, RAMPS.flowerYellow[3]);
      s.strokeRect(5, 5, 6, 8, RAMPS.iron[1]);
      s.vline(8, 5, 12, RAMPS.iron[1]);
      s.hline(4, 11, 13, RAMPS.iron[0]);
      s.hline(5, 10, 4, RAMPS.iron[2]);
      s.set(7, 2, RAMPS.iron[1]);
      s.set(8, 2, RAMPS.iron[1]);
      s.set(7, 3, RAMPS.iron[1]);
      s.set(8, 3, RAMPS.iron[1]);
    }),
  );
}

/** Rubble and pebbles (passable). */
export function rubble(ramp: Ramp = RAMPS.rock, seed = 'rubble'): Draw {
  const rng = new Rng(seedFrom(seed));
  return sprite(16, 16, (s) => {
    for (let i = 0; i < 7; i++) {
      const w = rng.int(2, 4);
      shadedBlob(s, rng.int(1, 15 - w), rng.int(5, 14 - w), w, w - 1 || 1, ramp);
    }
  });
}

/** Rope ladder hanging down a ledge (ladder). */
export function ropeLadder(): Draw {
  return sprite(16, 16, (s) => {
    const rope = RAMPS.thatch;
    s.vline(4, 0, 15, rope[1]);
    s.vline(11, 0, 15, rope[1]);
    for (let y = 2; y < 16; y += 4) {
      s.hline(4, 11, y, RAMPS.wood[2]);
      s.hline(5, 10, y + 1, RAMPS.wood[0]);
    }
  });
}

/** Pickaxe and shovel leaning on a rock. */
export function minerTools(): Draw {
  return layers(
    groundShadow(8, 15, 12, 3),
    sprite(16, 16, (s) => {
      shadedBlob(s, 6, 8, 9, 7, RAMPS.rock);
      s.line(3, 14, 9, 3, RAMPS.wood[2]);
      s.line(5, 2, 12, 5, RAMPS.iron[2]);
      s.set(5, 2, RAMPS.iron[3]);
      s.line(12, 14, 13, 4, RAMPS.wood[1]);
      s.fillRect(11, 1, 4, 4, RAMPS.iron[2]);
      s.hline(11, 14, 1, RAMPS.iron[3]);
    }),
  );
}

// ---------------------------------------------------------------------------
// Jungle
// ---------------------------------------------------------------------------

/** Palm tree, 2 × 2 tiles: curved trunk and drooping fronds. */
export function palmTree(ramp: Ramp = RAMPS.jungleLight): Draw {
  return layers(
    groundShadow(18, 29, 16, 5),
    sprite(32, 32, (s) => {
      const bark = RAMPS.woodLight;
      for (let j = 0; j < 20; j++) {
        const tx = 16 + Math.round(Math.sin((j / 20) * 1.6) * 4);
        const yy = 30 - j;
        s.hline(tx - 1, tx + 1, yy, bark[2]);
        s.set(tx - 1, yy, bark[3]);
        s.set(tx + 1, yy, bark[1]);
        if (j % 3 === 0) s.hline(tx - 1, tx + 1, yy, bark[1]);
      }
      const top = { x: 19, y: 10 };
      const frond = (dx: number, dy: number) => {
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          const fx = Math.round(top.x + dx * t);
          const fy = Math.round(top.y + dy * t + t * t * 6);
          s.set(fx, fy, ramp[2]);
          s.set(fx, fy + 1, ramp[1]);
          if (k % 2 === 0 && k > 2) {
            s.set(fx, fy + 2, ramp[1]);
            s.set(fx - Math.sign(dx), fy + 2, ramp[0]);
          }
          s.set(fx, fy - 1, k < 10 ? ramp[3] : ramp[2]);
        }
      };
      frond(-14, -2);
      frond(12, -1);
      frond(-9, -8);
      frond(9, -8);
      frond(-3, 6);
      frond(6, 5);
      s.fillEllipse(17, 9, 5, 4, RAMPS.wood[1]);
      s.set(18, 10, RAMPS.wood[3]);
    }),
  );
}

/** Giant jungle tree, 2 × 2 tiles, with hanging vines. */
export function jungleTree(ramp: Ramp = RAMPS.jungle, seed = 'jungle-tree'): Draw {
  return layers(
    groundShadow(16, 29, 22, 5),
    sprite(32, 32, (s) => {
      const w = RAMPS.wood;
      s.fillRect(12, 18, 8, 12, w[2]);
      s.vline(12, 18, 29, w[3]);
      s.vline(19, 18, 29, w[1]);
      s.line(11, 29, 8, 31, w[1]);
      s.line(20, 29, 23, 31, w[1]);
      s.vline(16, 20, 28, w[1]);
      foliage(s, 0, 2, 32, 20, ramp, seed);
      foliage(s, 3, 0, 14, 10, ramp, `${seed}-a`);
      foliage(s, 16, 1, 14, 10, ramp, `${seed}-b`);
      for (const vx of [4, 9, 24, 28]) {
        const len = 6 + (vx % 5);
        s.vline(vx, 18, 18 + len, RAMPS.jungleLight[1]);
        s.set(vx, 18 + len, RAMPS.jungleLight[3]);
      }
    }),
  );
}

/** Fern (passable, hides the feet like a bush). */
export function fern(ramp: Ramp = RAMPS.jungleLight): Draw {
  return sprite(16, 16, (s) => {
    const leaf = (x0: number, y0: number, dx: number, dy: number) => {
      for (let k = 0; k <= 7; k++) {
        const fx = Math.round(x0 + (dx * k) / 7);
        const fy = Math.round(y0 + (dy * k) / 7 + (k * k) / 14);
        s.set(fx, fy, ramp[2]);
        if (k > 1 && k < 7) {
          s.set(fx, fy - 1, ramp[3]);
          s.set(fx, fy + 1, ramp[1]);
        }
      }
    };
    leaf(8, 13, -7, -7);
    leaf(8, 13, 7, -7);
    leaf(8, 13, -3, -11);
    leaf(8, 13, 3, -11);
    leaf(8, 14, -7, -2);
    leaf(8, 14, 7, -2);
  });
}

/** Large-leaved tropical plant. */
export function bigLeafPlant(ramp: Ramp = RAMPS.jungle): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      const leaf = (x: number, y: number, w: number, h: number) => {
        shadedBlob(s, x, y, w, h, ramp);
        s.line(x + 1, y + h - 1, x + w - 2, y + 1, ramp[1]);
      };
      leaf(0, 4, 8, 6);
      leaf(8, 3, 8, 6);
      leaf(4, 0, 8, 7);
      leaf(2, 9, 6, 5);
      leaf(9, 9, 6, 5);
      s.vline(8, 9, 15, RAMPS.jungle[0]);
    }),
  );
}

/** Tropical flower bush (passable). */
export function tropicalFlowers(petals: Ramp = RAMPS.coral): Draw {
  return sprite(16, 16, (s) => {
    foliage(s, 1, 6, 14, 9, RAMPS.jungle, `tropic-${petals[2]}`);
    const bloom = (fx: number, fy: number) => {
      s.set(fx, fy, petals[3]);
      s.set(fx - 1, fy, petals[2]);
      s.set(fx + 1, fy, petals[2]);
      s.set(fx, fy - 1, petals[2]);
      s.set(fx, fy + 1, petals[1]);
      s.set(fx + 1, fy + 1, RAMPS.flowerYellow[3]);
    };
    bloom(4, 7);
    bloom(10, 6);
    bloom(7, 11);
    bloom(12, 11);
  });
}

/** Vines hanging from above (drawn over the player). */
export function hangingVines(ramp: Ramp = RAMPS.jungleLight): Draw {
  return (c, x, y) => {
    const strands = [[2, 14], [5, 9], [8, 15], [11, 7], [14, 12]] as const;
    for (const [vx, len] of strands) {
      for (let j = 0; j < len; j++) {
        const sx = x + vx + (j % 6 < 3 ? 0 : 1);
        c.set(sx, y + j, j % 4 === 0 ? ramp[3] : ramp[1]);
        if (j % 4 === 2) c.set(sx + 1, y + j, ramp[2]);
      }
      c.set(x + vx, y + len, ramp[0]);
    }
  };
}

/** Bamboo stalks, 1 × 2 tiles. */
export function bamboo(ramp: Ramp = RAMPS.bamboo): Draw {
  return layers(
    groundShadow(8, 30, 14, 3),
    sprite(16, 32, (s) => {
      for (const [bx, top] of [[2, 3], [7, 0], [11, 5]] as const) {
        s.fillRect(bx, top, 3, 31 - top, ramp[2]);
        s.vline(bx, top, 30, ramp[3]);
        s.vline(bx + 2, top, 30, ramp[1]);
        for (let y = top + 5; y < 31; y += 6) s.hline(bx, bx + 2, y, ramp[0]);
        s.line(bx + 3, top + 6, bx + 6, top + 4, RAMPS.jungleLight[2]);
        s.line(bx - 1, top + 12, bx - 3, top + 10, RAMPS.jungleLight[2]);
      }
    }),
  );
}

/** Banana plant with a bunch of fruit, 1 × 2 tiles. */
export function bananaPlant(): Draw {
  const leaves = RAMPS.jungleLight;
  return layers(
    groundShadow(8, 30, 12, 3),
    sprite(16, 32, (s) => {
      s.fillRect(6, 14, 4, 17, RAMPS.bamboo[1]);
      s.vline(6, 14, 30, RAMPS.bamboo[2]);
      const leaf = (dx: number, dy: number) => {
        for (let k = 0; k <= 9; k++) {
          const fx = Math.round(8 + (dx * k) / 9);
          const fy = Math.round(13 + (dy * k) / 9 + (k * k) / 12);
          s.hline(fx - 1, fx + 1, fy, leaves[2]);
          s.set(fx, fy - 1, leaves[3]);
          s.set(fx, fy + 1, leaves[1]);
        }
      };
      leaf(-7, -11);
      leaf(7, -11);
      leaf(-7, -2);
      leaf(7, -3);
      leaf(0, -13);
      for (let i = 0; i < 4; i++) s.fillRect(9 + (i % 2), 15 + i * 2, 3, 2, RAMPS.flowerYellow[2 + (i % 2)]);
    }),
  );
}

/** Fallen mossy log, 2 × 1 tiles. */
export function mossyLog(): Draw {
  const w = RAMPS.wood;
  return layers(
    groundShadow(16, 14, 30, 4),
    sprite(32, 16, (s) => {
      s.fillRect(3, 5, 26, 9, w[2]);
      s.hline(3, 28, 5, w[3]);
      s.hline(3, 28, 13, w[0]);
      for (let x = 6; x < 26; x += 5) s.hline(x, x + 2, 9, w[1]);
      s.fillEllipse(0, 4, 7, 10, RAMPS.woodLight[3]);
      s.fillEllipse(2, 6, 3, 6, RAMPS.woodLight[1]);
      foliage(s, 8, 2, 10, 5, RAMPS.jungleLight, 'log-moss');
      foliage(s, 20, 3, 7, 4, RAMPS.jungleLight, 'log-moss2');
    }),
  );
}

/** Carnivorous plant with a big toothed bulb. */
export function carnivorousPlant(): Draw {
  return layers(
    groundShadow(8, 15, 12, 3),
    sprite(16, 16, (s) => {
      s.line(8, 15, 7, 9, RAMPS.jungle[1]);
      s.line(5, 15, 2, 11, RAMPS.jungle[2]);
      s.line(10, 15, 14, 12, RAMPS.jungle[2]);
      shadedBlob(s, 2, 1, 12, 9, RAMPS.coral);
      s.hline(3, 12, 6, RAMPS.dark[1]);
      s.hline(4, 11, 5, RAMPS.dark[2]);
      for (let x = 4; x < 12; x += 2) {
        s.set(x, 5, '#ffffff');
        s.set(x + 1, 7, '#ffffff');
      }
      s.set(5, 3, RAMPS.flowerYellow[3]);
      s.set(10, 2, RAMPS.flowerYellow[3]);
    }),
  );
}

/** Mossy ruined pillar, 1 × 2 tiles. */
export function ruinPillar(ramp: Ramp = RAMPS.stoneWarm): Draw {
  return layers(
    groundShadow(8, 30, 14, 3),
    sprite(16, 32, (s) => {
      s.fillRect(3, 6, 10, 22, ramp[2]);
      s.vline(4, 6, 27, ramp[3]);
      s.vline(11, 6, 27, ramp[1]);
      s.vline(12, 6, 27, ramp[0]);
      // Broken top.
      s.fillRect(2, 4, 12, 3, ramp[3]);
      s.set(13, 4, null);
      s.hline(2, 6, 3, ramp[3]);
      s.fillRect(2, 28, 12, 3, ramp[1]);
      s.line(5, 12, 9, 16, ramp[0]);
      foliage(s, 2, 3, 7, 5, RAMPS.jungleLight, 'pillar-moss');
      for (let y = 8; y < 28; y += 3) s.set(3 + (y % 2), y, RAMPS.jungleLight[1 + (y % 2)]);
    }),
  );
}

/** Carved stone idol / totem, 1 × 2 tiles. */
export function stoneIdol(ramp: Ramp = RAMPS.stoneWarm): Draw {
  return layers(
    groundShadow(8, 30, 14, 3),
    sprite(16, 32, (s) => {
      s.fillRect(2, 2, 12, 28, ramp[2]);
      s.vline(2, 2, 29, ramp[3]);
      s.vline(13, 2, 29, ramp[1]);
      s.hline(2, 13, 2, ramp[3]);
      // Face: brow, eyes, wide mouth.
      s.hline(3, 12, 7, ramp[0]);
      s.fillRect(4, 9, 3, 2, OUTLINE);
      s.fillRect(9, 9, 3, 2, OUTLINE);
      s.set(5, 9, RAMPS.lagoon[3]);
      s.set(10, 9, RAMPS.lagoon[3]);
      s.vline(8, 10, 14, ramp[1]);
      s.fillRect(4, 16, 8, 3, OUTLINE);
      for (let x = 5; x < 12; x += 2) s.set(x, 16, ramp[3]);
      s.hline(2, 13, 22, ramp[0]);
      s.hline(2, 13, 23, ramp[3]);
      s.fillRect(1, 28, 14, 3, ramp[1]);
      foliage(s, 9, 22, 6, 6, RAMPS.jungleLight, 'idol-moss');
    }),
  );
}

// ---------------------------------------------------------------------------
// Volcano
// ---------------------------------------------------------------------------

/** Volcanic rock with glowing lava cracks. */
export function lavaRock(big = false): Draw {
  const size = big ? 32 : 16;
  return layers(
    groundShadow(size / 2, size - 2, size - 2, big ? 6 : 4),
    sprite(size, size, (s) => {
      shadedBlob(s, 1, big ? 4 : 3, size - 2, size - (big ? 6 : 5), RAMPS.basalt);
      const glow = RAMPS.magma;
      if (big) {
        s.line(8, 10, 14, 18, glow[3]);
        s.line(14, 18, 13, 25, glow[2]);
        s.line(14, 18, 22, 21, glow[2]);
        s.line(20, 9, 23, 14, glow[2]);
      } else {
        s.line(5, 6, 8, 10, glow[3]);
        s.line(8, 10, 11, 11, glow[2]);
      }
    }),
  );
}

/** Steam / smoke vent in the ground. */
export function steamVent(): Draw {
  return (c, x, y) => {
    c.fillEllipse(x + 3, y + 10, 10, 5, RAMPS.basalt[0]);
    c.fillEllipse(x + 5, y + 11, 6, 3, RAMPS.magma[2]);
    c.set(x + 7, y + 12, RAMPS.magma[3]);
    const smoke = withAlpha('#d8d4e0', 0.55);
    c.fillEllipse(x + 5, y + 4, 6, 6, smoke);
    c.fillEllipse(x + 8, y, 6, 5, withAlpha('#d8d4e0', 0.35));
    c.fillEllipse(x + 3, y + 1, 4, 4, withAlpha('#d8d4e0', 0.3));
  };
}

/** Obsidian shards. */
export function obsidianShards(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      const r = RAMPS.obsidian;
      const shard = (cx: number, h: number, lean: number) => {
        for (let j = 0; j < h; j++) {
          const half = Math.floor((j + 1) / 3);
          const ox = Math.round((lean * (h - j)) / h);
          s.hline(cx - half + ox, cx + half + ox, 15 - h + j, r[1]);
          s.set(cx - half + ox, 15 - h + j, r[3]);
        }
      };
      shard(5, 11, -2);
      shard(10, 13, 1);
      shard(13, 6, 2);
    }),
  );
}

/** Charred dead tree, 1 × 2 tiles. */
export function charredTree(): Draw {
  return layers(
    groundShadow(8, 30, 12, 3),
    sprite(16, 32, (s) => {
      const r = RAMPS.basalt;
      s.fillRect(6, 10, 4, 21, r[2]);
      s.vline(6, 10, 30, r[3]);
      s.vline(9, 10, 30, r[1]);
      s.line(7, 14, 2, 7, r[2]);
      s.line(2, 7, 2, 4, r[2]);
      s.line(8, 11, 13, 4, r[2]);
      s.line(13, 4, 14, 1, r[2]);
      s.line(8, 18, 12, 14, r[2]);
      s.set(7, 22, RAMPS.magma[3]);
      s.set(8, 23, RAMPS.magma[2]);
    }),
  );
}

/** Yellow sulfur crystals. */
export function sulfurCrystals(): Draw {
  return sprite(16, 16, (s) => {
    const r = RAMPS.sulfur;
    for (const [bx, by, w] of [[2, 8, 5], [8, 5, 6], [5, 11, 4], [11, 11, 4]] as const) {
      shadedBlob(s, bx, by, w, w, r);
      s.set(bx + 1, by + 1, '#ffffff');
    }
  });
}

/** Basalt columns, 1 × 2 tiles. */
export function basaltColumns(): Draw {
  return layers(
    groundShadow(8, 30, 14, 3),
    sprite(16, 32, (s) => {
      const r = RAMPS.basalt;
      for (const [bx, top] of [[1, 8], [5, 2], [10, 5]] as const) {
        const w = 5;
        s.fillRect(bx, top + 2, w, 30 - top, r[2]);
        s.vline(bx, top + 2, 31, r[3]);
        s.vline(bx + w - 1, top + 2, 31, r[0]);
        s.fillRect(bx, top, w, 3, r[3]);
        s.hline(bx, bx + w - 1, top + 2, r[1]);
        s.hline(bx + 1, bx + w - 2, top + 12, r[1]);
      }
    }),
  );
}

/** Glowing crack in the ground (damage floor decal). */
export function emberCrack(): Draw {
  return (c, x, y) => {
    const g = RAMPS.magma;
    c.line(x + 2, y + 3, x + 7, y + 8, g[2]);
    c.line(x + 7, y + 8, x + 5, y + 13, g[2]);
    c.line(x + 7, y + 8, x + 13, y + 10, g[2]);
    c.line(x + 3, y + 3, x + 7, y + 7, g[3]);
    c.set(x + 7, y + 8, '#fff27a');
    c.set(x + 12, y + 10, g[3]);
  };
}

/** Ash pile (passable). */
export function ashPile(): Draw {
  return sprite(16, 16, (s) => {
    shadedBlob(s, 2, 7, 12, 8, RAMPS.stone);
    shadedBlob(s, 6, 5, 6, 5, RAMPS.stone);
    s.set(6, 11, RAMPS.magma[3]);
    s.set(10, 12, RAMPS.magma[2]);
  });
}

/** Giant ribcage remains, 2 × 2 tiles. */
export function ribcage(): Draw {
  const b = RAMPS.flowerWhite;
  return layers(
    groundShadow(16, 28, 28, 5),
    sprite(32, 32, (s) => {
      s.line(2, 27, 29, 27, b[2]);
      s.line(2, 28, 29, 28, b[1]);
      for (let i = 0; i < 5; i++) {
        const bx = 5 + i * 5;
        const h = 18 - Math.abs(i - 2) * 3;
        for (let j = 0; j < h; j++) {
          const curve = Math.round(Math.sin((j / h) * Math.PI) * 3);
          s.set(bx + curve, 27 - j, b[2]);
          s.set(bx + curve + 1, 27 - j, b[1]);
        }
      }
      shadedBlob(s, 24, 18, 8, 7, b);
      s.set(27, 21, OUTLINE);
    }),
  );
}

// ---------------------------------------------------------------------------
// Seaside
// ---------------------------------------------------------------------------

/** Sea shell (passable). */
export function shell(ramp: Ramp = RAMPS.coral): Draw {
  return sprite(16, 16, (s) => {
    for (let j = 0; j < 6; j++) s.hline(8 - j, 8 + j, 6 + j, ramp[2 + (j % 2 === 0 ? 1 : 0)]);
    for (let k = -4; k <= 4; k += 2) s.line(8, 7, 8 + k, 11, ramp[1]);
    s.fillRect(7, 12, 3, 2, ramp[1]);
  });
}

/** Starfish (passable). */
export function starfish(ramp: Ramp = RAMPS.leavesAutumn): Draw {
  return sprite(16, 16, (s) => {
    for (let a = 0; a < 5; a++) {
      const angle = -Math.PI / 2 + (a * 2 * Math.PI) / 5;
      for (let k = 0; k <= 5; k++) {
        const px = Math.round(8 + Math.cos(angle) * k);
        const py = Math.round(9 + Math.sin(angle) * k);
        s.set(px, py, k < 3 ? ramp[3] : ramp[2]);
        if (k < 4) s.set(px + 1, py, ramp[2]);
      }
    }
    s.set(8, 9, ramp[1]);
  });
}

/** Coral (placed on water: impassable). */
export function coral(ramp: Ramp = RAMPS.coral): Draw {
  return sprite(16, 16, (s) => {
    const branch = (x0: number, y0: number, dx: number, h: number) => {
      for (let j = 0; j < h; j++) {
        const bx = x0 + Math.round((dx * j) / h);
        s.set(bx, y0 - j, ramp[2]);
        s.set(bx + 1, y0 - j, ramp[1]);
      }
      s.fillRect(x0 + dx - 1, y0 - h - 1, 3, 2, ramp[3]);
    };
    branch(7, 14, 0, 11);
    branch(6, 11, -4, 6);
    branch(8, 10, 4, 7);
    branch(4, 14, -2, 5);
    branch(10, 14, 3, 5);
  });
}

/** Seaweed swaying in the water (placed on water: impassable). */
export function seaweed(ramp: Ramp = RAMPS.swamp): Draw {
  return sprite(16, 16, (s) => {
    for (const [bx, h] of [[3, 10], [7, 13], [11, 9]] as const) {
      for (let j = 0; j < h; j++) {
        const sx = bx + (Math.floor(j / 3) % 2);
        s.set(sx, 15 - j, ramp[2]);
        s.set(sx + 1, 15 - j, j % 3 === 0 ? ramp[3] : ramp[1]);
      }
    }
  });
}

/** Floating buoy. */
export function buoy(): Draw {
  return sprite(16, 16, (s) => {
    s.fillEllipse(2, 10, 12, 5, withAlpha('#ffffff', 0.4));
    s.fillRect(5, 4, 6, 8, RAMPS.roofRed[2]);
    s.fillRect(5, 7, 6, 2, '#f4f4fa');
    s.vline(5, 4, 11, RAMPS.roofRed[3]);
    s.vline(10, 4, 11, RAMPS.roofRed[1]);
    s.fillRect(7, 1, 2, 3, RAMPS.iron[2]);
    s.set(7, 0, RAMPS.flowerYellow[3]);
  });
}

/** Anchor lying on the sand. */
export function anchor(): Draw {
  return sprite(16, 16, (s) => {
    const r = RAMPS.iron;
    s.fillRect(7, 3, 2, 10, r[2]);
    s.vline(7, 3, 12, r[3]);
    s.hline(4, 11, 5, r[2]);
    s.fillEllipse(6, 0, 4, 4, r[1]);
    s.set(7, 1, null);
    s.set(8, 1, null);
    for (let k = 0; k < 6; k++) {
      s.set(2 + k, 9 + Math.round(Math.sqrt(k) * 2), r[2]);
      s.set(13 - k, 9 + Math.round(Math.sqrt(k) * 2), r[1]);
    }
    s.set(2, 8, r[3]);
    s.set(13, 8, r[3]);
  });
}

/** Wooden rowboat, 2 × 1 tiles. */
export function rowboat(): Draw {
  const w = RAMPS.woodLight;
  return sprite(32, 16, (s) => {
    s.fillEllipse(1, 2, 30, 13, w[1]);
    s.fillEllipse(3, 3, 26, 10, w[2]);
    s.fillEllipse(5, 5, 22, 7, RAMPS.wood[1]);
    s.hline(6, 25, 5, w[3]);
    for (const bx of [11, 19]) s.fillRect(bx, 5, 2, 7, w[3]);
    s.line(4, 9, 0, 13, RAMPS.wood[2]);
    s.fillRect(0, 12, 3, 3, RAMPS.wood[2]);
  });
}

/** Driftwood. */
export function driftwood(): Draw {
  return sprite(16, 16, (s) => {
    const r = RAMPS.stoneWarm;
    s.line(1, 11, 14, 7, r[3]);
    s.line(1, 12, 14, 8, r[2]);
    s.line(2, 13, 14, 9, r[1]);
    s.line(8, 10, 11, 4, r[2]);
    s.set(11, 3, r[3]);
  });
}

/** Wooden mooring post. */
export function dockPost(): Draw {
  return sprite(16, 16, (s) => {
    const w = RAMPS.wood;
    s.fillRect(5, 3, 6, 12, w[2]);
    s.vline(5, 3, 14, w[3]);
    s.vline(10, 3, 14, w[1]);
    s.fillEllipse(5, 1, 6, 4, RAMPS.woodLight[3]);
    s.hline(5, 10, 8, RAMPS.thatch[2]);
    s.hline(5, 10, 9, RAMPS.thatch[1]);
  });
}

/** Fishing net spread on the ground (passable). */
export function fishingNet(): Draw {
  return (c, x, y) => {
    const n = withAlpha(RAMPS.thatch[1], 0.9);
    for (let k = 1; k < 16; k += 3) {
      c.line(x + k, y + 2, x + k - 1, y + 14, n);
      c.line(x + 1, y + k, x + 14, y + k + 1, n);
    }
    c.set(x + 3, y + 3, RAMPS.flowerWhite[3]);
    c.set(x + 12, y + 11, RAMPS.flowerWhite[3]);
  };
}

/** Lighthouse, 1 × 3 tiles. */
export function lighthouse(): Draw {
  return layers(
    groundShadow(8, 46, 16, 4),
    sprite(16, 48, (s) => {
      for (let j = 0; j < 34; j++) {
        const yy = 13 + j;
        const half = 4 + Math.floor(j / 10);
        const stripe = Math.floor(j / 6) % 2 === 0 ? RAMPS.roofRed : RAMPS.flowerWhite;
        s.hline(8 - half, 7 + half, yy, stripe[2]);
        s.set(8 - half, yy, stripe[3]);
        s.set(7 + half, yy, stripe[1]);
      }
      s.fillRect(4, 6, 8, 7, RAMPS.flowerYellow[3]);
      s.strokeRect(4, 6, 8, 7, RAMPS.iron[1]);
      s.vline(8, 6, 12, RAMPS.iron[1]);
      s.fillRect(3, 12, 10, 2, RAMPS.iron[1]);
      for (let j = 0; j < 4; j++) s.hline(4 + j, 11 - j, 5 - j, RAMPS.roofRed[1]);
      s.set(7, 1, RAMPS.iron[2]);
      s.fillRect(7, 30, 2, 4, RAMPS.dark[2]);
      s.fillRect(6, 40, 4, 7, RAMPS.wood[1]);
    }),
  );
}

/** Sandcastle. */
export function sandcastle(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      const r = RAMPS.sand;
      s.fillRect(2, 8, 12, 7, r[2]);
      s.fillRect(5, 4, 6, 5, r[2]);
      for (const tx of [2, 11]) {
        s.fillRect(tx, 5, 3, 4, r[2]);
        s.set(tx + 1, 4, r[3]);
      }
      s.hline(2, 13, 8, r[3]);
      s.vline(13, 8, 14, r[1]);
      s.fillRect(7, 11, 2, 4, r[0]);
      s.vline(8, 0, 4, RAMPS.wood[1]);
      s.fillRect(9, 0, 3, 2, RAMPS.roofRed[2]);
    }),
  );
}

/** Broken ship mast sticking out of the sand or water, 1 × 2 tiles. */
export function wreckMast(): Draw {
  return sprite(16, 32, (s) => {
    const w = RAMPS.wood;
    s.fillRect(7, 2, 3, 29, w[2]);
    s.vline(7, 2, 30, w[3]);
    s.vline(9, 2, 30, w[1]);
    s.fillRect(1, 8, 15, 2, w[1]);
    s.hline(1, 15, 8, w[3]);
    // Torn sail.
    for (let j = 0; j < 9; j++) s.hline(2, 13 - (j % 3) * 2 - Math.floor(j / 3), 10 + j, j % 2 ? RAMPS.plaster[2] : RAMPS.plaster[3]);
    s.line(1, 9, 8, 0, RAMPS.thatch[1]);
    s.fillRect(3, 28, 11, 3, w[1]);
  });
}

/** Message in a bottle (passable). */
export function bottle(): Draw {
  return sprite(16, 16, (s) => {
    const g = RAMPS.lagoon;
    s.line(4, 11, 10, 6, g[2]);
    s.line(4, 12, 10, 7, g[1]);
    s.line(5, 12, 11, 7, g[2]);
    s.line(5, 11, 9, 8, RAMPS.plaster[3]);
    s.line(11, 6, 13, 4, g[3]);
    s.set(13, 4, RAMPS.wood[2]);
  });
}
