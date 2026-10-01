/**
 * @file Extra interior furniture for the Inside tileset (sheet C): living
 * room, bedroom, kitchen, tavern, workshop and wall decorations. Same
 * conventions as `objects.ts`.
 */
import { OUTLINE, RAMPS, type Ramp } from '../../shared/art/palette.js';
import { Rng, seedFrom, withAlpha } from '../../shared/art/pixel.js';
import { foliage, groundShadow, layers, shadedBlob, sprite, type Draw } from './objects.js';

const WOOD = RAMPS.wood;
const LIGHT = RAMPS.woodLight;

// ---------------------------------------------------------------------------
// Living room
// ---------------------------------------------------------------------------

/** Upholstered armchair facing down. */
export function armchair(fabric: Ramp = RAMPS.carpetRed): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRoundRect(2, 1, 12, 8, 2, fabric[1]);
      s.hline(3, 12, 1, fabric[2]);
      s.fillRect(1, 6, 3, 8, fabric[2]);
      s.fillRect(12, 6, 3, 8, fabric[1]);
      s.vline(1, 6, 13, fabric[3]);
      s.fillRect(4, 8, 8, 5, fabric[2]);
      s.hline(4, 11, 8, fabric[3]);
      s.fillRect(2, 14, 2, 2, WOOD[1]);
      s.fillRect(12, 14, 2, 2, WOOD[1]);
    }),
  );
}

/** Sofa, 2 × 1 tiles, facing down. */
export function sofa(fabric: Ramp = RAMPS.carpetGreen): Draw {
  return layers(
    groundShadow(16, 15, 30, 3),
    sprite(32, 16, (s) => {
      s.fillRoundRect(2, 1, 28, 8, 2, fabric[1]);
      s.hline(3, 28, 1, fabric[2]);
      s.fillRect(1, 5, 3, 9, fabric[2]);
      s.fillRect(28, 5, 3, 9, fabric[1]);
      s.vline(1, 5, 13, fabric[3]);
      s.fillRect(4, 8, 24, 5, fabric[2]);
      s.hline(4, 27, 8, fabric[3]);
      s.vline(16, 8, 12, fabric[1]);
      s.fillRect(7, 4, 5, 4, RAMPS.gold[2]);
      s.fillRect(20, 4, 5, 4, RAMPS.cloth[2]);
      for (const lx of [2, 28]) s.fillRect(lx, 14, 2, 2, WOOD[1]);
    }),
  );
}

/** Round table with a cloth and a teapot. */
export function roundTable(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(7, 10, 2, 5, WOOD[1]);
      s.fillRect(4, 14, 8, 1, WOOD[1]);
      s.fillEllipse(1, 2, 14, 10, LIGHT[2]);
      s.fillEllipse(2, 3, 12, 7, LIGHT[3]);
      s.fillEllipse(5, 3, 5, 4, RAMPS.flowerWhite[2]);
      s.set(10, 5, RAMPS.flowerWhite[1]);
      s.set(6, 3, '#ffffff');
    }),
  );
}

/** Small wooden stool. */
export function stool(): Draw {
  return sprite(16, 16, (s) => {
    s.fillEllipse(4, 5, 8, 5, LIGHT[3]);
    s.hline(5, 10, 9, LIGHT[1]);
    for (const lx of [5, 10]) s.fillRect(lx, 9, 1, 6, WOOD[1]);
    s.hline(5, 10, 12, WOOD[2]);
  });
}

/** Writing desk with papers and an inkwell, 2 × 1 tiles. */
export function desk(): Draw {
  return layers(
    groundShadow(16, 15, 30, 3),
    sprite(32, 16, (s) => {
      s.fillRect(1, 2, 30, 7, WOOD[2]);
      s.hline(1, 30, 2, WOOD[3]);
      s.fillRect(1, 9, 30, 6, WOOD[1]);
      s.strokeRect(19, 10, 10, 4, WOOD[0]);
      s.set(24, 12, RAMPS.gold[3]);
      s.fillRect(3, 9, 3, 6, WOOD[0]);
      s.fillRect(5, 3, 7, 5, RAMPS.plaster[3]);
      s.hline(6, 10, 5, RAMPS.plaster[1]);
      s.hline(6, 9, 6, RAMPS.plaster[1]);
      s.fillRect(15, 4, 3, 3, RAMPS.dark[2]);
      s.line(17, 4, 21, 0, '#ffffff');
      s.fillRect(23, 3, 5, 4, RAMPS.roofRed[2]);
    }),
  );
}

/** Chest of drawers. */
export function dresser(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(1, 3, 14, 12, WOOD[2]);
      s.fillRect(1, 2, 14, 2, WOOD[3]);
      for (let y = 5; y < 15; y += 3) {
        s.hline(2, 13, y + 2, WOOD[0]);
        s.set(5, y + 1, RAMPS.gold[3]);
        s.set(10, y + 1, RAMPS.gold[3]);
      }
      s.vline(14, 4, 14, WOOD[1]);
    }),
  );
}

/** Bedside table with a candle. */
export function nightstand(): Draw {
  return layers(
    groundShadow(8, 15, 10, 3),
    sprite(16, 16, (s) => {
      s.fillRect(3, 7, 10, 8, WOOD[2]);
      s.fillRect(3, 6, 10, 2, WOOD[3]);
      s.hline(4, 11, 10, WOOD[0]);
      s.set(8, 9, RAMPS.gold[3]);
      s.fillRect(7, 2, 2, 4, '#f4f0dc');
      s.set(7, 1, RAMPS.fire[3]);
      s.set(8, 0, RAMPS.fire[2]);
    }),
  );
}

/** Grandfather clock, 1 × 2 tiles. */
export function grandfatherClock(): Draw {
  return layers(
    groundShadow(8, 30, 12, 3),
    sprite(16, 32, (s) => {
      s.fillRect(3, 2, 10, 29, WOOD[2]);
      s.fillRect(2, 1, 12, 3, WOOD[1]);
      s.hline(4, 11, 0, WOOD[3]);
      s.vline(3, 3, 30, WOOD[3]);
      s.vline(12, 3, 30, WOOD[0]);
      s.fillEllipse(4, 4, 8, 8, RAMPS.plaster[3]);
      s.line(8, 8, 8, 5, OUTLINE);
      s.line(8, 8, 10, 8, OUTLINE);
      s.fillRect(5, 14, 6, 13, RAMPS.dark[2]);
      s.vline(8, 14, 22, RAMPS.gold[1]);
      s.fillEllipse(6, 21, 4, 4, RAMPS.gold[3]);
      s.fillRect(2, 28, 12, 3, WOOD[1]);
    }),
  );
}

/** Tall potted plant (ficus), 1 × 2 tiles. */
export function tallPlant(): Draw {
  return layers(
    groundShadow(8, 30, 12, 3),
    sprite(16, 32, (s) => {
      s.fillRect(4, 23, 8, 8, RAMPS.brick[2]);
      s.hline(3, 12, 23, RAMPS.brick[3]);
      s.vline(11, 24, 30, RAMPS.brick[1]);
      s.line(8, 23, 7, 10, WOOD[1]);
      foliage(s, 1, 1, 14, 12, RAMPS.leaves, 'ficus');
      foliage(s, 2, 11, 12, 9, RAMPS.leaves, 'ficus2');
    }),
  );
}

/** Vase with flowers. */
export function flowerVase(petals: Ramp = RAMPS.flowerBlue): Draw {
  return layers(
    groundShadow(8, 15, 8, 2),
    sprite(16, 16, (s) => {
      shadedBlob(s, 5, 8, 6, 7, RAMPS.roofBlue);
      s.fillRect(6, 6, 4, 3, RAMPS.roofBlue[2]);
      s.line(8, 6, 5, 2, RAMPS.leaves[1]);
      s.line(8, 6, 11, 2, RAMPS.leaves[1]);
      s.vline(8, 1, 6, RAMPS.leaves[2]);
      for (const [fx, fy] of [[5, 2], [11, 2], [8, 1]] as const) {
        s.fillRect(fx - 1, fy - 1, 3, 2, petals[2]);
        s.set(fx, fy - 1, petals[3]);
      }
    }),
  );
}

/** Standing candelabrum, 1 × 2 tiles. */
export function candelabrum(): Draw {
  return layers(
    groundShadow(8, 30, 8, 2),
    sprite(16, 32, (s) => {
      const g = RAMPS.gold;
      s.fillRect(7, 8, 2, 20, g[1]);
      s.vline(7, 8, 27, g[3]);
      s.fillRect(4, 28, 8, 3, g[1]);
      s.hline(3, 12, 8, g[2]);
      for (const cx of [3, 7, 12]) {
        s.fillRect(cx, 3, 2, 5, '#f4f0dc');
        s.set(cx, 1, RAMPS.fire[2]);
        s.set(cx, 2, RAMPS.fire[3]);
      }
      s.fillEllipse(0, 0, 16, 6, withAlpha(RAMPS.fire[3], 0.2));
    }),
  );
}

/** Upright piano, 2 × 1 tiles. */
export function piano(): Draw {
  return layers(
    groundShadow(16, 15, 30, 3),
    sprite(32, 16, (s) => {
      const r = RAMPS.dark;
      s.fillRect(1, 1, 30, 14, r[3]);
      s.hline(1, 30, 1, RAMPS.stone[1]);
      s.fillRect(3, 8, 26, 3, '#f4f4fa');
      for (let x = 4; x < 29; x += 2) s.vline(x, 8, 10, x % 4 === 0 ? OUTLINE : '#c8c8d8');
      for (let x = 5; x < 28; x += 4) s.fillRect(x, 8, 1, 2, OUTLINE);
      s.fillRect(10, 2, 12, 5, RAMPS.plaster[3]);
      s.hline(11, 20, 4, OUTLINE);
      s.fillRect(2, 13, 3, 2, r[1]);
      s.fillRect(27, 13, 3, 2, r[1]);
    }),
  );
}

/** Round rug, 2 × 2 tiles (flat, passable). */
export function roundRug(ramp: Ramp = RAMPS.carpetBlue): Draw {
  return (c, x, y) => {
    c.fillEllipse(x + 1, y + 3, 30, 26, ramp[1]);
    c.fillEllipse(x + 3, y + 5, 26, 22, ramp[2]);
    c.fillEllipse(x + 8, y + 9, 16, 14, RAMPS.gold[2]);
    c.fillEllipse(x + 10, y + 11, 12, 10, ramp[2]);
    c.fillEllipse(x + 13, y + 14, 6, 4, ramp[3]);
  };
}

// ---------------------------------------------------------------------------
// Bedroom and bathroom
// ---------------------------------------------------------------------------

/** Double bed, 2 × 2 tiles. */
export function doubleBed(sheet: Ramp = RAMPS.carpetRed): Draw {
  return sprite(32, 32, (s) => {
    s.fillRect(1, 1, 30, 30, WOOD[2]);
    s.fillRect(1, 1, 30, 5, WOOD[1]);
    s.hline(1, 30, 1, WOOD[3]);
    for (const px of [3, 17]) {
      s.fillRoundRect(px, 6, 12, 6, 1, '#f4f4fa');
      s.hline(px + 1, px + 10, 11, '#c8c8d8');
    }
    s.fillRect(2, 13, 28, 16, sheet[2]);
    s.hline(2, 29, 13, sheet[3]);
    s.hline(2, 29, 15, '#f4f4fa');
    s.vline(29, 14, 28, sheet[1]);
    s.fillRect(1, 29, 30, 2, WOOD[1]);
  });
}

/** Baby cradle. */
export function cradle(): Draw {
  return layers(
    groundShadow(8, 15, 12, 3),
    sprite(16, 16, (s) => {
      s.fillEllipse(1, 4, 14, 10, LIGHT[2]);
      s.fillEllipse(3, 5, 10, 7, RAMPS.flowerWhite[3]);
      s.fillEllipse(4, 7, 8, 5, RAMPS.carpetBlue[3]);
      s.fillEllipse(4, 5, 4, 3, '#f4f4fa');
      s.hline(2, 13, 14, WOOD[1]);
    }),
  );
}

/** Wooden bathtub, 2 × 1 tiles. */
export function bathtub(): Draw {
  return layers(
    groundShadow(16, 15, 30, 3),
    sprite(32, 16, (s) => {
      s.fillRoundRect(1, 2, 30, 13, 3, WOOD[2]);
      for (let x = 4; x < 30; x += 4) s.vline(x, 4, 13, WOOD[1]);
      s.hline(2, 29, 5, RAMPS.iron[2]);
      s.hline(2, 29, 12, RAMPS.iron[2]);
      s.fillRoundRect(4, 4, 24, 7, 2, RAMPS.water[2]);
      s.hline(6, 12, 5, RAMPS.water[3]);
      s.fillEllipse(18, 5, 5, 3, '#ffffff');
      s.fillEllipse(22, 7, 3, 2, '#ffffff');
    }),
  );
}

/** Washstand with a basin and a jug. */
export function washstand(): Draw {
  return layers(
    groundShadow(8, 15, 12, 3),
    sprite(16, 16, (s) => {
      s.fillRect(2, 7, 12, 8, LIGHT[2]);
      s.fillRect(2, 6, 12, 2, LIGHT[3]);
      s.hline(3, 12, 11, LIGHT[0]);
      s.fillEllipse(2, 3, 9, 5, RAMPS.flowerWhite[2]);
      s.fillEllipse(3, 4, 7, 3, RAMPS.water[2]);
      s.fillRect(10, 1, 3, 6, RAMPS.roofBlue[2]);
      s.set(13, 2, RAMPS.roofBlue[1]);
    }),
  );
}

/** Standing mirror, 1 × 2 tiles. */
export function mirror(): Draw {
  return layers(
    groundShadow(8, 30, 10, 2),
    sprite(16, 32, (s) => {
      s.fillEllipse(2, 1, 12, 24, RAMPS.gold[1]);
      s.fillEllipse(4, 3, 8, 20, RAMPS.ice[2]);
      s.line(5, 9, 8, 5, '#ffffff');
      s.line(6, 13, 10, 8, RAMPS.ice[3]);
      s.fillRect(7, 25, 2, 4, RAMPS.gold[1]);
      s.fillRect(4, 29, 8, 2, RAMPS.gold[1]);
    }),
  );
}

// ---------------------------------------------------------------------------
// Kitchen and tavern
// ---------------------------------------------------------------------------

/** Iron cooking stove with a stovepipe, 1 × 2 tiles. */
export function stove(): Draw {
  return layers(
    groundShadow(8, 30, 14, 3),
    sprite(16, 32, (s) => {
      const r = RAMPS.iron;
      s.fillRect(6, 0, 4, 18, r[1]);
      s.vline(6, 0, 17, r[2]);
      s.fillRect(1, 17, 14, 14, r[1]);
      s.fillRect(1, 16, 14, 3, r[2]);
      s.hline(1, 14, 16, r[3]);
      s.fillRect(4, 22, 8, 6, RAMPS.dark[0]);
      s.fillEllipse(5, 24, 6, 4, RAMPS.fire[1]);
      s.fillEllipse(6, 25, 4, 3, RAMPS.fire[3]);
      s.fillEllipse(2, 15, 5, 3, r[0]);
      s.fillRect(11, 13, 4, 4, RAMPS.dark[2]);
      s.hline(10, 15, 13, r[3]);
    }),
  );
}

/** Kitchen counter with food (talk across it like a shop counter). */
export function kitchenCounter(items: 'bread' | 'pots' | 'veggies'): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(0, 4, 16, 3, LIGHT[3]);
    s.fillRect(0, 7, 16, 8, LIGHT[1]);
    s.hline(0, 15, 7, LIGHT[0]);
    s.strokeRect(2, 9, 12, 5, LIGHT[0]);
    s.set(8, 11, RAMPS.iron[3]);
    if (items === 'bread') {
      s.fillEllipse(2, 1, 7, 4, RAMPS.thatch[2]);
      s.hline(3, 7, 1, RAMPS.thatch[3]);
      s.fillEllipse(9, 2, 5, 3, RAMPS.dirt[3]);
    } else if (items === 'pots') {
      s.fillRect(2, 1, 5, 4, RAMPS.iron[2]);
      s.hline(1, 7, 1, RAMPS.iron[3]);
      s.fillRect(9, 2, 5, 3, RAMPS.brick[2]);
      s.hline(9, 13, 2, RAMPS.brick[3]);
    } else {
      s.fillEllipse(2, 2, 4, 3, RAMPS.flowerRed[2]);
      s.fillEllipse(6, 1, 4, 4, RAMPS.leaves[2]);
      s.fillRect(11, 2, 4, 2, RAMPS.leavesAutumn[3]);
      s.set(15, 2, RAMPS.leaves[2]);
    }
  }, null);
}

/** Cupboard with plates on its shelves, 1 × 2 tiles. */
export function cupboard(): Draw {
  return sprite(16, 32, (s) => {
    s.fillRect(1, 2, 14, 29, WOOD[2]);
    s.fillRect(0, 1, 16, 3, WOOD[1]);
    s.hline(1, 14, 1, WOOD[3]);
    for (const sy of [5, 11]) {
      s.fillRect(2, sy, 12, 5, WOOD[0]);
      for (let px = 3; px < 13; px += 3) {
        s.fillEllipse(px, sy, 3, 4, RAMPS.flowerWhite[3]);
        s.set(px + 1, sy + 2, RAMPS.roofBlue[2]);
      }
      s.hline(2, 13, sy + 4, WOOD[3]);
    }
    s.vline(8, 18, 29, WOOD[0]);
    s.strokeRect(2, 18, 12, 12, WOOD[1]);
    s.set(6, 24, RAMPS.gold[3]);
    s.set(10, 24, RAMPS.gold[3]);
  });
}

/** Wall shelf with jars (on the wall, drawn over the player). */
export function wallShelf(): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(0, 10, 16, 2, WOOD[2]);
    s.hline(0, 15, 10, WOOD[3]);
    s.set(2, 12, WOOD[1]);
    s.set(13, 12, WOOD[1]);
    const jars: [number, Ramp][] = [[1, RAMPS.roofGreen], [5, RAMPS.leavesAutumn], [10, RAMPS.roofBlue]];
    for (const [jx, r] of jars) {
      s.fillRect(jx, 4, 4, 6, r[2]);
      s.vline(jx, 4, 9, r[3]);
      s.hline(jx, jx + 3, 3, LIGHT[1]);
    }
    s.fillRect(14, 6, 2, 4, RAMPS.plaster[3]);
  });
}

/** Cooking cauldron on the fire. */
export function cauldron(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillEllipse(3, 11, 10, 4, RAMPS.fire[2]);
      s.set(6, 13, RAMPS.fire[3]);
      s.set(9, 12, RAMPS.fire[3]);
      shadedBlob(s, 1, 3, 14, 10, RAMPS.iron);
      s.fillEllipse(2, 2, 12, 4, RAMPS.iron[0]);
      s.fillEllipse(3, 3, 10, 2, RAMPS.roofGreen[2]);
      s.set(6, 3, RAMPS.roofGreen[3]);
      s.fillEllipse(8, 0, 3, 3, withAlpha('#ffffff', 0.5));
    }),
  );
}

/** Barrel with a tap on a stand. */
export function barrelTap(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(2, 12, 2, 3, WOOD[1]);
      s.fillRect(12, 12, 2, 3, WOOD[1]);
      s.fillEllipse(1, 2, 14, 11, WOOD[2]);
      s.vline(4, 3, 11, RAMPS.iron[1]);
      s.vline(11, 3, 11, RAMPS.iron[1]);
      s.fillEllipse(5, 4, 6, 7, WOOD[3]);
      s.fillRect(7, 8, 2, 4, RAMPS.gold[2]);
      s.set(8, 12, RAMPS.gold[3]);
    }),
  );
}

/** Tavern stool (passable). */
export function barStool(): Draw {
  return sprite(16, 16, (s) => {
    s.fillEllipse(4, 3, 8, 4, RAMPS.carpetRed[2]);
    s.hline(5, 10, 3, RAMPS.carpetRed[3]);
    s.vline(5, 7, 14, WOOD[1]);
    s.vline(10, 7, 14, WOOD[1]);
    s.hline(5, 10, 11, WOOD[2]);
  });
}

/** Sacks of flour / grain. */
export function sacks(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      const r = RAMPS.plaster;
      shadedBlob(s, 1, 4, 8, 11, r);
      shadedBlob(s, 7, 6, 8, 9, r);
      s.hline(3, 6, 5, RAMPS.thatch[1]);
      s.hline(9, 12, 7, RAMPS.thatch[1]);
      s.set(4, 10, RAMPS.dirt[1]);
      s.set(10, 11, RAMPS.dirt[1]);
    }),
  );
}

/** Stack of firewood. */
export function woodpile(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 3 - row; k++) {
          const lx = 1 + k * 5 + row * 2;
          const ly = 10 - row * 4;
          s.fillEllipse(lx, ly, 5, 5, LIGHT[3]);
          s.set(lx + 2, ly + 2, LIGHT[1]);
          s.set(lx + 1, ly + 1, WOOD[2]);
        }
      }
    }),
  );
}

/** Dining table set for a meal, 3 × 2 tiles. */
export function diningTable(): Draw {
  return layers(
    groundShadow(24, 29, 44, 5),
    sprite(48, 32, (s) => {
      s.fillRect(1, 2, 46, 24, LIGHT[2]);
      s.hline(1, 46, 2, LIGHT[3]);
      s.fillRect(4, 4, 40, 20, RAMPS.flowerWhite[3]);
      s.strokeRect(4, 4, 40, 20, RAMPS.flowerWhite[1]);
      s.fillRect(1, 26, 46, 3, LIGHT[1]);
      for (const lx of [3, 43]) s.fillRect(lx, 28, 2, 3, WOOD[1]);
      for (const [px, py] of [[8, 6], [20, 6], [32, 6], [8, 16], [20, 16], [32, 16]] as const) {
        s.fillEllipse(px, py, 7, 5, RAMPS.flowerWhite[2]);
        s.fillEllipse(px + 2, py + 1, 3, 3, RAMPS.leavesAutumn[2]);
      }
      s.fillEllipse(40, 10, 4, 8, RAMPS.roofRed[2]);
      s.fillRect(41, 7, 2, 3, RAMPS.roofRed[1]);
    }),
  );
}

// ---------------------------------------------------------------------------
// Workshop and armory
// ---------------------------------------------------------------------------

/** Blacksmith anvil. */
export function anvil(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      const r = RAMPS.iron;
      s.fillRect(5, 9, 6, 6, WOOD[2]);
      s.fillRect(2, 4, 12, 4, r[2]);
      s.hline(2, 13, 4, r[3]);
      s.fillRect(0, 4, 3, 2, r[2]);
      s.fillRect(5, 8, 6, 2, r[1]);
      s.line(10, 2, 14, 6, WOOD[2]);
      s.fillRect(8, 1, 4, 3, r[1]);
    }),
  );
}

/** Weapon rack with swords and spears, 2 × 1 tiles. */
export function weaponRack(): Draw {
  return sprite(32, 16, (s) => {
    s.fillRect(1, 11, 30, 3, WOOD[2]);
    s.hline(1, 30, 11, WOOD[3]);
    s.fillRect(1, 4, 2, 11, WOOD[1]);
    s.fillRect(29, 4, 2, 11, WOOD[1]);
    s.hline(1, 30, 4, WOOD[2]);
    for (let k = 0; k < 4; k++) {
      const wx = 6 + k * 6;
      s.vline(wx, 0, 11, RAMPS.silver[2]);
      s.vline(wx + 1, 1, 10, RAMPS.silver[3]);
      s.hline(wx - 1, wx + 2, 8, RAMPS.gold[2]);
      s.vline(wx, 9, 12, WOOD[1]);
    }
  });
}

/** Armor stand, 1 × 2 tiles. */
export function armorStand(): Draw {
  return layers(
    groundShadow(8, 30, 12, 3),
    sprite(16, 32, (s) => {
      const r = RAMPS.silver;
      s.fillRect(7, 22, 2, 7, WOOD[1]);
      s.fillRect(4, 28, 8, 3, WOOD[1]);
      shadedBlob(s, 4, 1, 8, 8, r);
      s.hline(5, 10, 5, OUTLINE);
      s.fillRect(3, 9, 10, 12, r[2]);
      s.vline(3, 9, 20, r[3]);
      s.vline(12, 9, 20, r[1]);
      s.fillRect(1, 9, 3, 5, r[1]);
      s.fillRect(12, 9, 3, 5, r[1]);
      s.hline(3, 12, 17, RAMPS.wood[1]);
      s.set(8, 17, RAMPS.gold[3]);
    }),
  );
}

/** Spinning wheel. */
export function spinningWheel(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillEllipse(1, 1, 11, 11, LIGHT[2]);
      s.fillEllipse(3, 3, 7, 7, null);
      s.line(6, 2, 6, 10, LIGHT[1]);
      s.line(2, 6, 10, 6, LIGHT[1]);
      s.fillEllipse(5, 5, 3, 3, WOOD[1]);
      s.line(6, 11, 4, 15, WOOD[1]);
      s.line(6, 11, 12, 15, WOOD[1]);
      s.fillRect(11, 6, 4, 3, RAMPS.plaster[3]);
      s.line(13, 9, 13, 14, WOOD[1]);
    }),
  );
}

/** Globe on a stand. */
export function globe(): Draw {
  return layers(
    groundShadow(8, 15, 10, 2),
    sprite(16, 16, (s) => {
      s.fillRect(7, 11, 2, 3, RAMPS.gold[1]);
      s.fillRect(4, 14, 8, 1, WOOD[1]);
      shadedBlob(s, 3, 1, 10, 10, RAMPS.water);
      s.fillEllipse(5, 3, 3, 4, RAMPS.leaves[2]);
      s.fillEllipse(9, 6, 3, 3, RAMPS.sand[2]);
      s.line(2, 6, 7, 11, RAMPS.gold[2]);
    }),
  );
}

// ---------------------------------------------------------------------------
// Wall decorations (drawn over the player)
// ---------------------------------------------------------------------------

/** Framed painting: `landscape` or `portrait`. */
export function painting(kind: 'landscape' | 'portrait'): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(1, 2, 14, 11, RAMPS.gold[1]);
    s.strokeRect(1, 2, 14, 11, RAMPS.gold[3]);
    if (kind === 'landscape') {
      s.fillRect(3, 4, 10, 4, RAMPS.water[3]);
      s.fillRect(3, 8, 10, 3, RAMPS.grass[2]);
      s.fillEllipse(4, 5, 5, 4, RAMPS.leaves[1]);
      s.set(11, 5, RAMPS.flowerYellow[3]);
    } else {
      s.fillRect(3, 4, 10, 7, RAMPS.cloth[1]);
      s.fillEllipse(6, 4, 4, 4, RAMPS.plaster[3]);
      s.fillRect(5, 8, 6, 3, RAMPS.carpetRed[2]);
    }
  });
}

/** Hanging banner, 1 × 2 tiles. */
export function banner(ramp: Ramp = RAMPS.carpetRed): Draw {
  return sprite(16, 32, (s) => {
    s.fillRect(1, 1, 14, 2, RAMPS.gold[2]);
    s.fillRect(3, 3, 10, 22, ramp[2]);
    s.vline(3, 3, 24, ramp[3]);
    s.vline(12, 3, 24, ramp[1]);
    for (let j = 0; j < 4; j++) {
      s.hline(3 + j, 7, 25 + j, ramp[2]);
      s.hline(8, 12 - j, 25 + j, ramp[1]);
    }
    s.fillEllipse(5, 9, 6, 7, RAMPS.gold[2]);
    s.fillEllipse(6, 10, 4, 5, ramp[1]);
    s.set(7, 12, RAMPS.gold[3]);
  });
}

/** Mounted deer antlers trophy. */
export function antlerTrophy(): Draw {
  return sprite(16, 16, (s) => {
    s.fillEllipse(4, 7, 8, 7, WOOD[2]);
    s.fillEllipse(6, 7, 4, 7, RAMPS.dirt[2]);
    s.set(6, 9, OUTLINE);
    s.set(9, 9, OUTLINE);
    const antler = (dir: number) => {
      s.line(8 - dir * 2, 7, 8 - dir * 6, 1, RAMPS.plaster[2]);
      s.line(8 - dir * 4, 4, 8 - dir * 7, 4, RAMPS.plaster[2]);
      s.line(8 - dir * 5, 3, 8 - dir * 4, 0, RAMPS.plaster[3]);
    };
    antler(1);
    antler(-1);
  });
}

/** Window with curtains. */
export function curtainWindow(curtain: Ramp = RAMPS.carpetRed): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(2, 2, 12, 11, LIGHT[1]);
    s.fillRect(3, 3, 10, 9, RAMPS.water[3]);
    s.vline(8, 3, 11, LIGHT[1]);
    s.hline(3, 12, 7, LIGHT[1]);
    s.set(4, 4, '#ffffff');
    s.fillRect(1, 1, 14, 2, curtain[1]);
    for (let j = 0; j < 11; j++) {
      const w = 3 - Math.floor(j / 5);
      s.hline(1, 1 + w, 2 + j, curtain[2]);
      s.hline(14 - w, 14, 2 + j, curtain[2]);
    }
    s.vline(1, 2, 12, curtain[3]);
  });
}

/** Wall clock. */
export function wallClock(): Draw {
  return sprite(16, 16, (s) => {
    s.fillEllipse(3, 2, 10, 10, WOOD[2]);
    s.fillEllipse(4, 3, 8, 8, RAMPS.plaster[3]);
    s.line(8, 7, 8, 4, OUTLINE);
    s.line(8, 7, 10, 8, OUTLINE);
    s.vline(8, 12, 14, RAMPS.gold[1]);
    s.fillEllipse(7, 13, 3, 3, RAMPS.gold[3]);
  });
}

/** Shelf of books fixed to the wall. */
export function bookWallShelf(): Draw {
  const rng = new Rng(seedFrom('wall-books'));
  const books = [RAMPS.roofRed, RAMPS.roofBlue, RAMPS.roofGreen, RAMPS.gold, RAMPS.cloth];
  return sprite(16, 16, (s) => {
    s.fillRect(0, 11, 16, 2, WOOD[2]);
    s.hline(0, 15, 11, WOOD[3]);
    let x = 1;
    while (x < 14) {
      const b = rng.pick(books);
      const h = rng.int(5, 7);
      s.fillRect(x, 11 - h, 2, h, b[2]);
      s.vline(x, 11 - h, 10, b[3]);
      x += 2;
    }
  });
}
