/**
 * @file Pixel-art props for the plain-tile sheets (B–E): nature, village,
 * furniture and dungeon objects. Each function draws into a sheet canvas at a
 * pixel origin; most objects are first drawn on a scratch canvas, outlined
 * with the shared dark outline colour, then copied, which gives the typical
 * chipset look (dark contour, 3–4 tone shading, light from the top-left).
 */
import { OUTLINE, RAMPS, SHADOW, type Ramp } from '../../shared/art/palette.js';
import { PixelCanvas, Rng, seedFrom, withAlpha, type Color } from '../../shared/art/pixel.js';

/** Draw callback used by the builder: sheet canvas and pixel origin. */
export type Draw = (c: PixelCanvas, x: number, y: number) => void;

/**
 * Draws on a scratch canvas, outlines it and copies it to the destination.
 * @param w - Scratch width.
 * @param h - Scratch height.
 * @param paint - Drawing callback (coordinates relative to the scratch canvas).
 * @param outline - Outline colour (`null` to skip).
 */
export function sprite(w: number, h: number, paint: (s: PixelCanvas) => void, outline: Color = OUTLINE): Draw {
  return (c, x, y) => {
    const s = new PixelCanvas(w, h);
    paint(s);
    if (outline) s.outline(outline);
    c.blit(s, x, y);
  };
}

/** Combines several draw callbacks. */
export function layers(...draws: Draw[]): Draw {
  return (c, x, y) => draws.forEach((d) => d(c, x, y));
}

/** Soft oval shadow on the ground. */
export function groundShadow(cx: number, cy: number, w: number, h: number): Draw {
  return (c, x, y) => c.fillEllipse(x + cx - Math.floor(w / 2), y + cy - Math.floor(h / 2), w, h, SHADOW);
}

/**
 * Shaded ellipse: base colour, highlight on the upper-left, shadow on the lower-right.
 */
export function shadedBlob(s: PixelCanvas, x: number, y: number, w: number, h: number, ramp: Ramp): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      const nx = (i + 0.5 - cx) / (w / 2);
      const ny = (j + 0.5 - cy) / (h / 2);
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const light = -nx * 0.6 - ny * 0.8;
      s.set(i, j, light > 0.55 ? ramp[3] : light > -0.25 ? ramp[2] : light > -0.75 ? ramp[1] : ramp[0]);
    }
  }
}

/** Leafy clump: several overlapping shaded blobs with leaf dots. */
function foliage(s: PixelCanvas, x: number, y: number, w: number, h: number, ramp: Ramp, seed: string): void {
  const rng = new Rng(seedFrom(seed));
  shadedBlob(s, x, y, w, h, ramp);
  for (let i = 0; i < (w * h) / 14; i++) {
    const px = x + rng.int(2, w - 3);
    const py = y + rng.int(2, h - 3);
    if (s.get(px, py) === ramp[2]) {
      s.set(px, py, ramp[3]);
      s.set(px + 1, py + 1, ramp[1]);
    }
  }
}

// ---------------------------------------------------------------------------
// Nature
// ---------------------------------------------------------------------------

/** Broadleaf tree, 2 × 2 tiles: round crown over a short trunk. */
export function roundTree(ramp: Ramp = RAMPS.leaves, seed = 'tree'): Draw {
  return layers(
    groundShadow(16, 29, 18, 5),
    sprite(32, 32, (s) => {
      s.fillRect(13, 20, 6, 10, RAMPS.wood[2]);
      s.vline(13, 20, 29, RAMPS.wood[3]);
      s.vline(18, 20, 29, RAMPS.wood[1]);
      s.set(12, 29, RAMPS.wood[1]);
      s.set(19, 29, RAMPS.wood[1]);
      foliage(s, 2, 1, 28, 22, ramp, seed);
      foliage(s, 5, 0, 14, 10, ramp, `${seed}-a`);
    }),
  );
}

/** Conifer, 1 × 2 tiles. */
export function pineTree(ramp: Ramp = RAMPS.grassDark): Draw {
  return layers(
    groundShadow(8, 29, 12, 4),
    sprite(16, 32, (s) => {
      s.fillRect(7, 24, 3, 6, RAMPS.wood[1]);
      for (let tier = 0; tier < 3; tier++) {
        const top = 1 + tier * 7;
        for (let j = 0; j < 10; j++) {
          const half = Math.floor(((j + 1) * (5 + tier)) / 10);
          for (let i = -half; i <= half; i++) {
            const c = i < -half / 2 ? ramp[3] : i > half / 2 ? ramp[1] : ramp[2];
            s.set(8 + i, top + j, j === 9 ? ramp[0] : c);
          }
        }
      }
    }),
  );
}

/** Round bush, 1 × 1 tile. */
export function bush(ramp: Ramp = RAMPS.leaves, seed = 'bush'): Draw {
  return layers(groundShadow(8, 14, 14, 4), sprite(16, 16, (s) => foliage(s, 1, 3, 14, 11, ramp, seed)));
}

/** Small flower patch (passable decoration). */
export function flowers(petals: Ramp, seed = 'flowers'): Draw {
  const rng = new Rng(seedFrom(seed));
  const spots = [
    { x: 2, y: 3 }, { x: 9, y: 2 }, { x: 5, y: 8 }, { x: 11, y: 9 }, { x: 2, y: 12 },
  ].map((p) => ({ x: p.x + rng.int(-1, 1), y: p.y + rng.int(0, 1) }));
  return (c, x, y) => {
    for (const p of spots) {
      c.set(x + p.x + 1, y + p.y + 2, RAMPS.grass[0]);
      c.set(x + p.x + 1, y + p.y + 3, RAMPS.grass[0]);
      c.set(x + p.x + 2, y + p.y + 3, RAMPS.grass[1]);
      c.set(x + p.x, y + p.y - 1, petals[0]);
      c.set(x + p.x + 2, y + p.y + 1, petals[0]);
      c.set(x + p.x, y + p.y, petals[2]);
      c.set(x + p.x + 2, y + p.y, petals[2]);
      c.set(x + p.x + 1, y + p.y - 1, petals[3]);
      c.set(x + p.x + 1, y + p.y + 1, petals[1]);
      c.set(x + p.x + 1, y + p.y, RAMPS.flowerYellow[3]);
    }
  };
}

/** Tall grass tuft, drawn over the lower half of characters (bush flag). */
export function tallGrass(ramp: Ramp = RAMPS.grass): Draw {
  return (c, x, y) => {
    for (let i = 0; i < 16; i += 2) {
      const h = 6 + ((i * 7) % 5);
      c.vline(x + i, y + 15 - h, y + 15, ramp[1]);
      c.set(x + i, y + 15 - h, ramp[3]);
      c.vline(x + i + 1, y + 17 - h, y + 15, ramp[0]);
    }
  };
}

/** Boulder. `big` draws a 2 × 2 tile rock. */
export function rock(ramp: Ramp = RAMPS.rock, big = false): Draw {
  const size = big ? 32 : 16;
  return layers(
    groundShadow(size / 2, size - 2, size - 2, big ? 6 : 4),
    sprite(size, size, (s) => {
      shadedBlob(s, 1, big ? 5 : 3, size - 2, big ? size - 7 : size - 5, ramp);
      if (big) {
        s.line(10, 12, 16, 18, ramp[0]);
        s.line(17, 18, 20, 24, ramp[0]);
      } else {
        s.set(6, 8, ramp[0]);
        s.set(7, 9, ramp[0]);
      }
    }),
  );
}

/** Tree stump. */
export function stump(): Draw {
  const w = RAMPS.wood;
  return layers(
    groundShadow(8, 14, 14, 4),
    sprite(16, 16, (s) => {
      s.fillRect(3, 7, 10, 7, w[2]);
      s.vline(3, 7, 13, w[3]);
      s.vline(12, 7, 13, w[1]);
      s.fillEllipse(3, 4, 10, 6, RAMPS.woodLight[3]);
      s.fillEllipse(5, 5, 6, 4, RAMPS.woodLight[2]);
      s.set(7, 6, RAMPS.woodLight[1]);
      s.set(8, 6, RAMPS.woodLight[1]);
    }),
  );
}

/** Mushroom cluster. */
export function mushrooms(cap: Ramp = RAMPS.flowerRed): Draw {
  return sprite(16, 16, (s) => {
    const shroom = (mx: number, my: number, r: number) => {
      s.fillRect(mx - 1, my, 2, r + 1, RAMPS.plaster[3]);
      shadedBlob(s, mx - r, my - r, r * 2, r + 1, cap);
      s.set(mx - 1, my - r + 1, '#ffffff');
    };
    shroom(5, 10, 3);
    shroom(11, 12, 2);
  });
}

// ---------------------------------------------------------------------------
// Village props
// ---------------------------------------------------------------------------

/** Wooden fence piece. */
export function fence(kind: 'h' | 'v' | 'post'): Draw {
  const w = RAMPS.woodLight;
  return sprite(16, 16, (s) => {
    if (kind === 'h') {
      s.fillRect(0, 6, 16, 2, w[2]);
      s.fillRect(0, 10, 16, 2, w[1]);
      s.hline(0, 15, 6, w[3]);
    }
    if (kind === 'v') {
      s.fillRect(7, 0, 2, 16, w[2]);
      s.vline(7, 0, 15, w[3]);
    }
    // Posts.
    const posts = kind === 'h' ? [1, 13] : [7];
    for (const px of posts) {
      s.fillRect(px, 3, 3, 12, w[2]);
      s.vline(px, 3, 14, w[3]);
      s.vline(px + 2, 3, 14, w[0]);
    }
  });
}

/** Signpost. */
export function signpost(): Draw {
  const w = RAMPS.woodLight;
  return layers(
    groundShadow(8, 15, 8, 2),
    sprite(16, 16, (s) => {
      s.fillRect(7, 8, 2, 7, RAMPS.wood[1]);
      s.fillRect(2, 2, 12, 7, w[2]);
      s.hline(2, 13, 2, w[3]);
      s.hline(2, 13, 8, w[0]);
      s.hline(4, 11, 4, w[0]);
      s.hline(4, 9, 6, w[0]);
    }),
  );
}

/** Barrel. */
export function barrel(): Draw {
  const w = RAMPS.wood;
  return layers(
    groundShadow(8, 15, 12, 3),
    sprite(16, 16, (s) => {
      s.fillRect(3, 3, 10, 12, w[2]);
      s.vline(4, 3, 14, w[3]);
      s.vline(11, 3, 14, w[1]);
      s.vline(12, 4, 13, w[0]);
      s.hline(3, 12, 5, RAMPS.iron[1]);
      s.hline(3, 12, 12, RAMPS.iron[1]);
      s.fillEllipse(3, 1, 10, 4, w[3]);
      s.hline(5, 10, 2, w[1]);
    }),
  );
}

/** Wooden crate. */
export function crate(): Draw {
  const w = RAMPS.woodLight;
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(2, 4, 12, 11, w[2]);
      s.fillRect(2, 2, 12, 3, w[3]);
      s.strokeRect(3, 5, 10, 9, w[0]);
      s.line(3, 5, 12, 13, w[1]);
      s.line(4, 5, 12, 12, w[3]);
    }),
  );
}

/** Stone well, 2 × 2 tiles. */
export function well(): Draw {
  return layers(
    groundShadow(16, 29, 26, 6),
    sprite(32, 32, (s) => {
      // Roof posts and roof.
      s.fillRect(6, 6, 2, 16, RAMPS.wood[1]);
      s.fillRect(24, 6, 2, 16, RAMPS.wood[1]);
      for (let j = 0; j < 6; j++) s.hline(3 + j, 28 - j, 7 - j, j < 2 ? RAMPS.roofRed[1] : RAMPS.roofRed[2]);
      s.hline(9, 22, 1, RAMPS.roofRed[3]);
      s.hline(10, 21, 12, RAMPS.iron[2]);
      // Stone rim.
      s.fillRect(3, 16, 26, 13, RAMPS.stone[2]);
      s.fillEllipse(3, 13, 26, 8, RAMPS.stone[3]);
      s.fillEllipse(7, 15, 18, 5, RAMPS.deepWater[1]);
      for (let i = 4; i < 28; i += 5) s.vline(i, 20, 28, RAMPS.stone[1]);
      s.hline(3, 28, 24, RAMPS.stone[1]);
    }),
  );
}

/** Street lamp, 1 × 2 tiles. */
export function lampPost(): Draw {
  return layers(
    groundShadow(8, 30, 8, 3),
    sprite(16, 32, (s) => {
      s.fillRect(7, 8, 2, 22, RAMPS.iron[1]);
      s.fillRect(5, 28, 6, 3, RAMPS.iron[1]);
      s.fillRect(4, 2, 8, 7, RAMPS.flowerYellow[3]);
      s.strokeRect(4, 2, 8, 7, RAMPS.iron[0]);
      s.hline(3, 12, 1, RAMPS.iron[1]);
      s.vline(8, 2, 8, RAMPS.iron[0]);
    }),
  );
}

/** Gravestone. */
export function gravestone(): Draw {
  const r = RAMPS.stone;
  return layers(
    groundShadow(8, 15, 12, 3),
    sprite(16, 16, (s) => {
      s.fillRect(4, 5, 8, 10, r[2]);
      s.fillEllipse(4, 2, 8, 6, r[2]);
      s.vline(4, 4, 14, r[3]);
      s.vline(11, 4, 14, r[1]);
      s.hline(6, 9, 7, r[0]);
      s.vline(7, 5, 10, r[0]);
    }),
  );
}

/** Stone statue on a pedestal, 1 × 2 tiles. */
export function statue(): Draw {
  const r = RAMPS.stone;
  return layers(
    groundShadow(8, 30, 14, 3),
    sprite(16, 32, (s) => {
      s.fillRect(2, 24, 12, 7, r[1]);
      s.hline(2, 13, 24, r[3]);
      shadedBlob(s, 5, 2, 6, 6, r); // head
      s.fillRect(4, 8, 8, 12, r[2]);
      s.vline(4, 8, 19, r[3]);
      s.vline(11, 8, 19, r[1]);
      s.fillRect(2, 9, 2, 7, r[2]);
      s.fillRect(12, 9, 2, 7, r[1]);
      s.fillRect(5, 20, 2, 4, r[1]);
      s.fillRect(9, 20, 2, 4, r[1]);
    }),
  );
}

/** Haystack. */
export function haystack(): Draw {
  return layers(groundShadow(8, 14, 14, 4), sprite(16, 16, (s) => shadedBlob(s, 1, 2, 14, 13, RAMPS.thatch)));
}

/** Wooden bench, 2 × 1 tiles. */
export function bench(): Draw {
  const w = RAMPS.woodLight;
  return sprite(32, 16, (s) => {
    s.fillRect(3, 4, 26, 3, w[2]);
    s.hline(3, 28, 4, w[3]);
    s.fillRect(3, 9, 26, 3, w[2]);
    s.hline(3, 28, 9, w[3]);
    for (const px of [5, 25]) s.fillRect(px, 7, 2, 8, RAMPS.wood[1]);
  });
}

/** Clay flower pot with a plant. */
export function flowerPot(petals: Ramp = RAMPS.flowerRed): Draw {
  return layers(
    groundShadow(8, 15, 10, 3),
    sprite(16, 16, (s) => {
      s.fillRect(4, 9, 8, 6, RAMPS.brick[2]);
      s.hline(3, 12, 9, RAMPS.brick[3]);
      s.vline(11, 10, 14, RAMPS.brick[1]);
      foliage(s, 3, 2, 10, 8, RAMPS.leaves, 'pot');
      s.set(6, 4, petals[2]);
      s.set(10, 5, petals[2]);
      s.set(8, 3, petals[3]);
    }),
  );
}

/** Door in a wall (1 × 1). */
export function door(ramp: Ramp = RAMPS.wood, arched = true): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(3, arched ? 2 : 1, 10, 14, ramp[2]);
    if (arched) s.fillEllipse(3, 0, 10, 5, ramp[2]);
    for (let x = 5; x < 12; x += 3) s.vline(x, 2, 15, ramp[1]);
    s.vline(3, 2, 15, ramp[3]);
    s.set(10, 9, RAMPS.gold[3]);
    s.set(10, 10, RAMPS.gold[1]);
  });
}

/** Window with shutters (1 × 1). */
export function windowTile(frame: Ramp = RAMPS.woodLight): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(4, 4, 8, 8, '#9fd8ff');
    s.fillRect(4, 8, 8, 4, '#5fa6e0');
    s.strokeRect(3, 3, 10, 10, frame[1]);
    s.vline(8, 4, 11, frame[1]);
    s.hline(4, 11, 8, frame[1]);
    s.set(5, 5, '#ffffff');
    s.fillRect(1, 3, 2, 10, frame[2]);
    s.fillRect(13, 3, 2, 10, frame[2]);
  });
}

/** Hanging shop sign with an icon. */
export function shopSign(icon: 'sword' | 'shield' | 'potion' | 'bed'): Draw {
  return sprite(16, 16, (s) => {
    s.hline(2, 13, 1, RAMPS.iron[1]);
    s.vline(3, 1, 3, RAMPS.iron[1]);
    s.vline(12, 1, 3, RAMPS.iron[1]);
    s.fillRect(1, 3, 14, 11, RAMPS.woodLight[2]);
    s.hline(1, 14, 3, RAMPS.woodLight[3]);
    s.hline(1, 14, 13, RAMPS.woodLight[0]);
    const m = RAMPS.silver;
    switch (icon) {
      case 'sword':
        s.line(4, 11, 11, 5, m[3]);
        s.line(5, 11, 11, 6, m[1]);
        s.line(4, 8, 7, 11, RAMPS.gold[2]);
        break;
      case 'shield':
        s.fillRect(5, 5, 6, 5, RAMPS.roofBlue[2]);
        s.fillRect(6, 10, 4, 1, RAMPS.roofBlue[2]);
        s.set(7, 11, RAMPS.roofBlue[1]);
        s.set(8, 11, RAMPS.roofBlue[1]);
        s.vline(8, 5, 10, RAMPS.gold[3]);
        break;
      case 'potion':
        s.fillRect(7, 4, 2, 2, m[2]);
        s.fillEllipse(5, 6, 6, 6, RAMPS.flowerRed[2]);
        s.set(6, 7, '#ffffff');
        break;
      case 'bed':
        s.fillRect(3, 8, 10, 3, RAMPS.carpetBlue[2]);
        s.fillRect(3, 6, 3, 2, '#ffffff');
        s.vline(3, 5, 11, RAMPS.wood[1]);
        s.vline(12, 7, 11, RAMPS.wood[1]);
        break;
    }
  });
}

/** Brick chimney (star tile sitting on roofs). */
export function chimney(): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(4, 3, 8, 12, RAMPS.brick[2]);
    s.fillRect(3, 2, 10, 3, RAMPS.brick[1]);
    s.hline(3, 12, 2, RAMPS.brick[3]);
    for (let j = 7; j < 15; j += 3) s.hline(4, 11, j, RAMPS.brick[0]);
    s.fillRect(5, 0, 2, 2, withAlpha('#c8c8d0', 0.8));
    s.fillRect(8, 0, 3, 1, withAlpha('#c8c8d0', 0.6));
  });
}

/** Striped awning, 2 × 1 tiles. */
export function awning(stripe: Ramp = RAMPS.roofRed): Draw {
  return sprite(32, 16, (s) => {
    for (let x = 0; x < 32; x++) {
      const c = Math.floor(x / 4) % 2 ? '#fff4e0' : stripe[2];
      s.vline(x, 1, 10, c);
      s.set(x, 11 + ((x % 4) < 2 ? 1 : 0), c);
    }
    s.hline(0, 31, 1, stripe[3]);
    s.hline(0, 31, 10, stripe[0]);
  });
}

/** Camping tent, 2 × 2 tiles. */
export function tent(ramp: Ramp = RAMPS.thatch): Draw {
  return layers(
    groundShadow(16, 29, 28, 5),
    sprite(32, 32, (s) => {
      for (let j = 0; j < 26; j++) {
        const half = Math.floor(j * 0.58) + 1;
        s.hline(16 - half, 15 + half, 3 + j, j % 6 === 5 ? ramp[1] : ramp[2]);
        s.set(16 - half, 3 + j, ramp[3]);
        s.set(15 + half, 3 + j, ramp[0]);
      }
      for (let j = 12; j < 29; j++) {
        const half = Math.floor((j - 12) * 0.35);
        s.hline(16 - half, 15 + half, j, RAMPS.dark[2]);
      }
      s.vline(16, 0, 3, RAMPS.wood[1]);
    }),
  );
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/** Wooden table, `w` tiles wide, 1 tile high (counter-like top view with legs). */
export function table(w = 2, cloth?: Ramp): Draw {
  const r = RAMPS.woodLight;
  const width = w * 16;
  return layers(
    groundShadow(width / 2, 14, width - 4, 3),
    sprite(width, 16, (s) => {
      s.fillRect(1, 2, width - 2, 8, cloth ? cloth[2] : r[2]);
      s.hline(1, width - 2, 2, cloth ? cloth[3] : r[3]);
      s.fillRect(1, 10, width - 2, 2, cloth ? cloth[1] : r[1]);
      for (const lx of [2, width - 4]) s.fillRect(lx, 12, 2, 3, RAMPS.wood[1]);
    }),
  );
}

/** Chair facing a direction. */
export function chair(facing: 'down' | 'left' | 'right' | 'up'): Draw {
  const r = RAMPS.woodLight;
  return sprite(16, 16, (s) => {
    const back = facing === 'down' ? 'top' : facing === 'up' ? 'bottom' : facing === 'left' ? 'right' : 'left';
    s.fillRect(4, 7, 8, 5, r[2]);
    s.hline(4, 11, 7, r[3]);
    s.fillRect(4, 12, 2, 3, r[1]);
    s.fillRect(10, 12, 2, 3, r[1]);
    if (back === 'top') s.fillRect(4, 1, 8, 6, r[1]);
    if (back === 'bottom') s.fillRect(4, 11, 8, 3, r[1]);
    if (back === 'left') s.fillRect(3, 2, 2, 10, r[1]);
    if (back === 'right') s.fillRect(11, 2, 2, 10, r[1]);
  });
}

/** Single bed, 1 × 2 tiles. */
export function bed(sheet: Ramp = RAMPS.carpetBlue): Draw {
  const r = RAMPS.wood;
  return sprite(16, 32, (s) => {
    s.fillRect(1, 1, 14, 30, r[2]);
    s.fillRect(1, 1, 14, 4, r[1]);
    s.hline(1, 14, 1, r[3]);
    s.fillRect(3, 5, 10, 6, '#f4f4fa');
    s.hline(3, 12, 10, '#c8c8d8');
    s.fillRect(2, 12, 12, 17, sheet[2]);
    s.hline(2, 13, 12, sheet[3]);
    s.vline(13, 13, 28, sheet[1]);
    s.fillRect(1, 29, 14, 2, r[1]);
  });
}

/** Treasure chest, closed or open. */
export function chest(open = false, ramp: Ramp = RAMPS.wood): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(2, 7, 12, 8, ramp[2]);
      s.hline(2, 13, 14, ramp[0]);
      if (open) {
        s.fillRect(2, 2, 12, 5, ramp[1]);
        s.fillRect(3, 6, 10, 2, RAMPS.dark[1]);
        s.set(5, 6, RAMPS.gold[3]);
        s.set(8, 7, RAMPS.gold[3]);
      } else {
        s.fillRect(2, 4, 12, 4, ramp[3]);
        s.hline(2, 13, 7, ramp[0]);
        s.fillRect(7, 6, 2, 3, RAMPS.gold[3]);
      }
      s.vline(4, 4, 14, RAMPS.gold[1]);
      s.vline(11, 4, 14, RAMPS.gold[1]);
    }),
  );
}

/** Bookshelf, 1 × 2 tiles. */
export function bookshelf(): Draw {
  const r = RAMPS.wood;
  const books = [RAMPS.roofRed, RAMPS.roofBlue, RAMPS.roofGreen, RAMPS.gold, RAMPS.cloth];
  const rng = new Rng(seedFrom('books'));
  return sprite(16, 32, (s) => {
    s.fillRect(1, 1, 14, 30, r[1]);
    s.hline(1, 14, 1, r[3]);
    for (let shelf = 0; shelf < 4; shelf++) {
      const y = 3 + shelf * 7;
      let x = 2;
      while (x < 14) {
        const bw = rng.int(1, 2);
        const b = rng.pick(books);
        const top = y + rng.int(0, 1);
        s.fillRect(x, top, bw, 6 - (top - y), b[2]);
        s.vline(x, top, y + 5, b[3]);
        x += bw;
      }
      s.hline(1, 14, y + 6, r[0]);
    }
  });
}

/** Clay pot / vase. */
export function pot(ramp: Ramp = RAMPS.brick): Draw {
  return layers(
    groundShadow(8, 15, 10, 3),
    sprite(16, 16, (s) => {
      shadedBlob(s, 3, 5, 10, 10, ramp);
      s.fillRect(5, 3, 6, 3, ramp[2]);
      s.hline(5, 10, 3, ramp[3]);
      s.hline(6, 9, 4, ramp[0]);
    }),
  );
}

/** Shop counter segment (counter flag lets players talk across it). */
export function counter(): Draw {
  const r = RAMPS.woodLight;
  return sprite(16, 16, (s) => {
    s.fillRect(0, 2, 16, 5, r[3]);
    s.fillRect(0, 7, 16, 8, r[1]);
    s.hline(0, 15, 7, r[0]);
    for (let x = 3; x < 16; x += 5) s.vline(x, 8, 14, r[0]);
  }, null);
}

/** Fireplace, 2 × 2 tiles. */
export function fireplace(): Draw {
  const st = RAMPS.stoneWarm;
  return sprite(32, 32, (s) => {
    s.fillRect(1, 2, 30, 29, st[2]);
    s.hline(0, 31, 2, st[3]);
    s.fillRect(0, 2, 32, 4, st[1]);
    s.fillRect(7, 12, 18, 19, RAMPS.dark[0]);
    s.fillEllipse(7, 9, 18, 8, RAMPS.dark[0]);
    s.fillEllipse(10, 20, 12, 10, RAMPS.fire[1]);
    s.fillEllipse(12, 22, 8, 8, RAMPS.fire[2]);
    s.fillEllipse(14, 25, 4, 5, RAMPS.fire[3]);
    s.fillRect(9, 28, 14, 2, RAMPS.wood[1]);
    for (let j = 8; j < 30; j += 5) {
      s.hline(1, 6, j, st[0]);
      s.hline(25, 30, j, st[0]);
    }
  });
}

/** Staircase going up or down (1 × 1). */
export function stairs(down: boolean, ramp: Ramp = RAMPS.stone): Draw {
  return (c, x, y) => {
    for (let step = 0; step < 4; step++) {
      const yy = y + step * 4;
      const shade = down ? 3 - step : step;
      c.fillRect(x, yy, 16, 4, ramp[Math.min(3, Math.max(0, shade)) as 0 | 1 | 2 | 3]);
      c.hline(x, x + 15, yy + 3, ramp[0]);
    }
  };
}

/** Standing candelabrum / candle. */
export function candle(): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(7, 6, 2, 8, '#f4f0dc');
    s.fillRect(5, 13, 6, 2, RAMPS.gold[1]);
    s.set(7, 4, RAMPS.fire[2]);
    s.set(8, 4, RAMPS.fire[3]);
    s.set(7, 5, RAMPS.fire[3]);
  });
}

/** Wardrobe, 1 × 2 tiles. */
export function wardrobe(): Draw {
  const r = RAMPS.wood;
  return sprite(16, 32, (s) => {
    s.fillRect(1, 2, 14, 29, r[2]);
    s.fillRect(0, 1, 16, 3, r[1]);
    s.vline(8, 5, 29, r[0]);
    s.strokeRect(2, 5, 12, 24, r[1]);
    s.set(6, 17, RAMPS.gold[3]);
    s.set(10, 17, RAMPS.gold[3]);
  });
}

/** Rug (flat, passable). */
export function rug(ramp: Ramp = RAMPS.carpetRed): Draw {
  return (c, x, y) => {
    c.fillRect(x + 1, y + 3, 14, 10, ramp[2]);
    c.strokeRect(x + 1, y + 3, 14, 10, ramp[0]);
    c.strokeRect(x + 3, y + 5, 10, 6, RAMPS.gold[2]);
  };
}

/** Potted plant for interiors. */
export function housePlant(): Draw {
  return flowerPot(RAMPS.flowerWhite);
}

// ---------------------------------------------------------------------------
// Dungeon
// ---------------------------------------------------------------------------

/** Wall torch (static frame; animated torches use the object character sheet). */
export function wallTorch(): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(7, 7, 2, 7, RAMPS.wood[1]);
    s.fillRect(6, 6, 4, 2, RAMPS.iron[1]);
    s.fillEllipse(5, 1, 6, 6, RAMPS.fire[1]);
    s.fillEllipse(6, 2, 4, 4, RAMPS.fire[2]);
    s.set(7, 3, RAMPS.fire[3]);
    s.set(8, 4, RAMPS.fire[3]);
  });
}

/** Stone pillar, 1 × 2 tiles. */
export function pillar(ramp: Ramp = RAMPS.stone): Draw {
  return layers(
    groundShadow(8, 30, 14, 3),
    sprite(16, 32, (s) => {
      s.fillRect(2, 0, 12, 3, ramp[3]);
      s.fillRect(3, 3, 10, 25, ramp[2]);
      s.vline(4, 3, 27, ramp[3]);
      s.vline(11, 3, 27, ramp[1]);
      s.vline(12, 3, 27, ramp[0]);
      s.fillRect(2, 28, 12, 3, ramp[1]);
    }),
  );
}

/** Scattered bones / skull. */
export function bones(skull = false): Draw {
  const b = RAMPS.flowerWhite;
  return sprite(16, 16, (s) => {
    if (skull) {
      shadedBlob(s, 4, 4, 8, 7, b);
      s.fillRect(5, 10, 6, 3, b[2]);
      s.set(6, 7, OUTLINE);
      s.set(9, 7, OUTLINE);
      s.set(7, 11, b[0]);
      s.set(9, 11, b[0]);
    } else {
      s.line(3, 12, 11, 6, b[2]);
      s.line(4, 12, 12, 6, b[1]);
      s.fillRect(2, 11, 2, 2, b[3]);
      s.fillRect(11, 5, 2, 2, b[3]);
      s.line(5, 5, 9, 9, b[2]);
    }
  });
}

/** Glowing crystal cluster. */
export function crystal(ramp: Ramp = RAMPS.poison): Draw {
  return sprite(16, 16, (s) => {
    const shard = (x: number, h: number, w: number) => {
      for (let j = 0; j < h; j++) {
        const half = Math.min(w, Math.floor((j + 1) / 2));
        s.hline(x - half, x + half, 15 - h + j, ramp[2]);
        s.set(x - half, 15 - h + j, ramp[3]);
        s.set(x + half, 15 - h + j, ramp[1]);
      }
    };
    shard(5, 9, 2);
    shard(10, 12, 2);
    shard(13, 6, 1);
  });
}

/** Iron-bound dungeon door (1 × 1). */
export function ironDoor(): Draw {
  return door(RAMPS.iron, true);
}

/** Stone altar, 2 × 1 tiles. */
export function altar(): Draw {
  const r = RAMPS.stone;
  return sprite(32, 16, (s) => {
    s.fillRect(2, 3, 28, 12, r[2]);
    s.fillRect(0, 2, 32, 4, r[3]);
    s.hline(2, 29, 14, r[0]);
    s.fillRect(13, 7, 6, 6, RAMPS.carpetRed[2]);
  });
}

/** Floor crack decal. */
export function crack(ramp: Ramp = RAMPS.stone): Draw {
  return (c, x, y) => {
    c.line(x + 3, y + 4, x + 7, y + 8, ramp[0]);
    c.line(x + 7, y + 8, x + 6, y + 12, ramp[0]);
    c.line(x + 7, y + 8, x + 12, y + 10, ramp[0]);
  };
}

/** Spider web in a corner. */
export function cobweb(): Draw {
  return (c, x, y) => {
    const w = withAlpha('#e8e8f0', 0.8);
    c.line(x, y, x + 10, y + 10, w);
    c.hline(x, x + 12, y, w);
    c.vline(x, y, y + 12, w);
    c.line(x + 6, y, x, y + 6, w);
    c.line(x + 11, y, x, y + 11, w);
  };
}
