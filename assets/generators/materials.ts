/**
 * @file Seamless 16 × 16 material textures (grass, dirt, water, stone, wood...)
 * shared by the tileset generators. Every texture is deterministic (seeded) and
 * wraps around, so it can fill any tile or autotile quarter without seams.
 */
import { texture, type Painter, type TextureCanvas } from './autotile.js';
import { RAMPS, type Ramp } from '../../shared/art/palette.js';
import { Rng, seedFrom } from '../../shared/art/pixel.js';

/** Scatters small specks of the given colours over the texture. */
function specks(t: TextureCanvas, rng: Rng, colors: readonly string[], count: number): void {
  for (let i = 0; i < count; i++) t.wrapSet(rng.int(0, 15), rng.int(0, 15), rng.pick(colors));
}

/**
 * Grass: base tone with little blade tufts (dark stem, light tip).
 * @param ramp - Grass ramp.
 * @param seed - Variation seed.
 * @param density - Number of tufts.
 */
export function grass(ramp: Ramp = RAMPS.grass, seed = 'grass', density = 6): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    specks(t, rng, [ramp[1]], 10);
    specks(t, rng, [ramp[3]], 5);
    for (let i = 0; i < density; i++) {
      const x = rng.int(0, 15);
      const y = rng.int(0, 15);
      t.wrapSet(x, y, ramp[1]);
      t.wrapSet(x - 1, y - 1, ramp[1]);
      t.wrapSet(x + 1, y - 1, ramp[1]);
      t.wrapSet(x, y - 1, ramp[3]);
    }
  });
}

/** Bare earth with pebbles. */
export function dirt(ramp: Ramp = RAMPS.dirt, seed = 'dirt'): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    specks(t, rng, [ramp[1]], 16);
    specks(t, rng, [ramp[3]], 8);
    for (let i = 0; i < 3; i++) {
      const x = rng.int(0, 15);
      const y = rng.int(0, 15);
      t.wrapSet(x, y, ramp[3]);
      t.wrapSet(x + 1, y, ramp[3]);
      t.wrapSet(x, y + 1, ramp[1]);
      t.wrapSet(x + 1, y + 1, ramp[0]);
    }
  });
}

/** Sand with fine grain and a few shell-like light dots. */
export function sand(ramp: Ramp = RAMPS.sand, seed = 'sand'): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    specks(t, rng, [ramp[1]], 14);
    specks(t, rng, [ramp[3]], 12);
  });
}

/** Snow: bright with soft blue shadows. */
export function snow(seed = 'snow'): Painter {
  const rng = new Rng(seedFrom(seed));
  const ramp = RAMPS.snow;
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    specks(t, rng, [ramp[1]], 8);
    specks(t, rng, [ramp[3]], 10);
  });
}

/**
 * Cobblestones: rounded stones separated by dark joints.
 * @param ramp - Stone ramp.
 */
export function cobble(ramp: Ramp = RAMPS.cobble, seed = 'cobble'): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[0]);
    // Two staggered rows of 8 × 8 stones.
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const x0 = col * 8 + (row % 2) * 4 - 4;
        const y0 = row * 8;
        for (let j = 1; j < 7; j++) {
          for (let i = 1; i < 7; i++) {
            const corner = (i === 1 || i === 6) && (j === 1 || j === 6);
            if (corner) continue;
            const c = j <= 2 || i <= 2 ? ramp[3] : j >= 5 || i >= 5 ? ramp[1] : ramp[2];
            t.wrapSet(x0 + i, y0 + j, c);
          }
        }
        if (rng.chance(0.5)) t.wrapSet(x0 + rng.int(3, 4), y0 + rng.int(3, 4), ramp[1]);
      }
    }
  });
}

/** Large square flagstones (dungeon / castle floor). */
export function flagstone(ramp: Ramp = RAMPS.stone, seed = 'flagstone'): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    t.hline(0, 15, 15, ramp[0]);
    t.vline(15, 0, 15, ramp[0]);
    t.hline(0, 14, 0, ramp[3]);
    t.vline(0, 0, 14, ramp[3]);
    t.hline(0, 15, 7, ramp[0]);
    t.vline(7, 8, 15, ramp[0]);
    t.hline(0, 14, 8, ramp[3]);
    t.set(8, 9, ramp[3]);
    specks(t, rng, [ramp[1]], 10);
  });
}

/** Wooden floor planks running horizontally. */
export function planks(ramp: Ramp = RAMPS.plank, seed = 'planks'): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    for (let row = 0; row < 4; row++) {
      const y = row * 4;
      t.hline(0, 15, y + 3, ramp[0]);
      t.hline(0, 15, y, ramp[3]);
      const joint = (row * 5 + 3) % 16;
      t.vline(joint, y, y + 2, ramp[0]);
      t.wrapSet(joint + 1, y + 1, ramp[3]);
      for (let k = 0; k < 2; k++) t.wrapSet(rng.int(0, 15), y + rng.int(1, 2), ramp[1]);
    }
  });
}

/**
 * Carpet with a woven dotted pattern.
 * @param ramp - Carpet ramp.
 */
export function carpet(ramp: Ramp, seed = 'carpet'): Painter {
  void seed;
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 16; x += 4) t.set(x, y, ramp[1]);
    for (let y = 2; y < 16; y += 4) for (let x = (y / 2) % 2 ? 0 : 2; x < 16; x += 4) t.set(x + 1, y, ramp[3]);
  });
}

/** Tatami-like woven straw. */
export function straw(seed = 'straw'): Painter {
  const ramp = RAMPS.thatch;
  void seed;
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    for (let y = 0; y < 16; y += 2) t.hline(0, 15, y, ramp[1]);
    for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x += 6) t.wrapSet(x + (y % 8 === 1 ? 0 : 3), y, ramp[3]);
  });
}

/**
 * Animated liquid surface (water, lava, swamp...). Frames shift the ripple
 * pattern so that playing frames 0-1-2-1 produces a gentle wave.
 * @param ramp - Liquid ramp.
 * @param frame - Animation frame (0–2).
 * @param seed - Variation seed.
 */
export function liquid(ramp: Ramp, frame: number, seed = 'water'): Painter {
  const rng = new Rng(seedFrom(seed));
  const ripples = Array.from({ length: 7 }, () => ({ x: rng.int(0, 15), y: rng.int(0, 15), len: rng.int(2, 4) }));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    // Darker diagonal bands give depth.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y * 2 + frame * 2) % 16 < 3) t.set(x, y, ramp[1]);
    for (const r of ripples) {
      const dx = frame; // ripples drift sideways
      for (let i = 0; i < r.len; i++) t.wrapSet(r.x + i + dx, r.y, ramp[3]);
      t.wrapSet(r.x - 1 + dx, r.y + 1, ramp[1]);
    }
  });
}

/**
 * Falling water: vertical streaks scrolling down with the frame.
 * @param ramp - Liquid ramp.
 * @param frame - Animation frame (0–2).
 */
export function falling(ramp: Ramp, frame: number): Painter {
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    const columns = [1, 4, 6, 9, 12, 14];
    columns.forEach((x, i) => {
      const offset = (i * 5 + frame * 5) % 16;
      for (let k = 0; k < 6; k++) t.wrapSet(x, offset + k, k < 2 ? ramp[3] : ramp[1]);
    });
    for (let x = 0; x < 16; x += 3) t.wrapSet(x, (frame * 5 + x) % 16, '#ffffff');
  });
}

/** Stone brick wall (for building walls and dungeon walls). */
export function bricks(ramp: Ramp, seed = 'bricks', brickW = 8, brickH = 4): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    for (let row = 0; row < 16 / brickH; row++) {
      const y = row * brickH;
      t.hline(0, 15, y + brickH - 1, ramp[0]);
      t.hline(0, 15, y, ramp[3]);
      const shift = row % 2 ? brickW / 2 : 0;
      for (let x = shift; x < 16 + shift; x += brickW) {
        t.vline(x % 16, y, y + brickH - 1, ramp[0]);
        t.wrapSet(x + 1, y + 1, ramp[3]);
      }
      if (rng.chance(0.6)) t.wrapSet(rng.int(0, 15), y + rng.int(1, brickH - 2), ramp[1]);
    }
  });
}

/** Vertical wooden boards (house walls, fences). */
export function boards(ramp: Ramp = RAMPS.wood, seed = 'boards'): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    for (let x = 0; x < 16; x += 4) {
      t.vline(x + 3, 0, 15, ramp[0]);
      t.vline(x, 0, 15, ramp[3]);
      t.wrapSet(x + 1, rng.int(0, 15), ramp[1]);
      t.wrapSet(x + 2, rng.int(0, 15), ramp[1]);
    }
  });
}

/** Plaster wall with faint cracks. */
export function plaster(ramp: Ramp = RAMPS.plaster, seed = 'plaster'): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    specks(t, rng, [ramp[1]], 6);
    specks(t, rng, [ramp[3]], 6);
  });
}

/** Roof tiles: overlapping rows of rounded shingles. */
export function shingles(ramp: Ramp, seed = 'roof'): Painter {
  void seed;
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    for (let row = 0; row < 4; row++) {
      const y = row * 4;
      const shift = row % 2 ? 2 : 0;
      t.hline(0, 15, y + 3, ramp[0]);
      t.hline(0, 15, y + 2, ramp[1]);
      for (let x = shift; x < 16 + shift; x += 4) {
        t.wrapSet(x, y + 2, ramp[0]);
        t.wrapSet(x, y + 1, ramp[1]);
        t.wrapSet(x + 1, y, ramp[3]);
        t.wrapSet(x + 2, y, ramp[3]);
      }
    }
  });
}

/** Thatched roof: straw strands. */
export function thatchRoof(seed = 'thatch'): Painter {
  const rng = new Rng(seedFrom(seed));
  const ramp = RAMPS.thatch;
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    for (let i = 0; i < 26; i++) {
      const x = rng.int(0, 15);
      const y = rng.int(0, 15);
      t.wrapSet(x, y, ramp[1]);
      t.wrapSet(x, y + 1, ramp[1]);
      t.wrapSet(x + 1, y - 1, ramp[3]);
    }
    t.hline(0, 15, 7, ramp[0]);
    t.hline(0, 15, 15, ramp[0]);
  });
}

/** Rough rock face (cliffs, cave walls). */
export function rockFace(ramp: Ramp = RAMPS.cliff, seed = 'rock'): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[2]);
    for (let i = 0; i < 5; i++) {
      const x = rng.int(0, 15);
      const y = rng.int(0, 15);
      const w = rng.int(3, 6);
      t.hline(x, x + w, y, ramp[0]);
      for (let k = 0; k < w; k++) t.wrapSet(x + k, y - 1, ramp[3]);
      t.wrapSet(x + w + 1, y + 1, ramp[1]);
    }
    specks(t, rng, [ramp[1]], 10);
  });
}

/** Hedge / leafy wall. */
export function leafy(ramp: Ramp = RAMPS.leaves, seed = 'leafy'): Painter {
  const rng = new Rng(seedFrom(seed));
  return texture((t) => {
    t.fillRect(0, 0, 16, 16, ramp[1]);
    for (let i = 0; i < 14; i++) {
      const x = rng.int(0, 15);
      const y = rng.int(0, 15);
      t.wrapSet(x, y, ramp[2]);
      t.wrapSet(x + 1, y, ramp[2]);
      t.wrapSet(x, y - 1, ramp[3]);
      t.wrapSet(x + 1, y + 1, ramp[0]);
    }
  });
}

/** Solid colour painter. */
export function solid(color: string): Painter {
  return () => color;
}
