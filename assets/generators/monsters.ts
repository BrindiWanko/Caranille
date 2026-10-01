/**
 * @file Non-humanoid monster sprites (slime, bat, wolf, mushroom), the raid
 * boss, and animated object sheets (chests, flames). Every function returns a
 * 3 × 4 frame block in the standard walking layout (rows: down, left, right,
 * up). Humanoid monsters (goblin, skeleton) come from the character generator.
 */
import { CHAR_FRAME_H, CHAR_FRAME_W, DIRECTIONS, type Facing } from '../../shared/art/character.js';
import { OUTLINE, RAMPS, type Ramp } from '../../shared/art/palette.js';
import { PixelCanvas } from '../../shared/art/pixel.js';
import { shadedBlob } from './objects.js';

type FramePainter = (s: PixelCanvas, dir: Facing, frame: number) => void;

/**
 * Builds a block by painting each frame; "right" frames are mirrored "left" ones.
 * @param paint - Frame painter (only called with down, left and up).
 * @param w - Frame width.
 * @param h - Frame height.
 */
export function blockFrom(paint: FramePainter, w = CHAR_FRAME_W, h = CHAR_FRAME_H): PixelCanvas {
  const block = new PixelCanvas(w * 3, h * 4);
  DIRECTIONS.forEach((dir, row) => {
    for (let f = 0; f < 3; f++) {
      const s = new PixelCanvas(w, h);
      paint(s, dir === 'right' ? 'left' : dir, f);
      s.outline(OUTLINE);
      block.blit(s, f * w, row * h, { flipX: dir === 'right' });
    }
  });
  return block;
}

/** Bouncy slime: squashes and stretches with the frame. */
export function slime(ramp: Ramp = RAMPS.roofBlue): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const squash = f === 1 ? 0 : 1;
    const w = 16 + squash * 2;
    const h = 12 - squash * 2;
    const x = 12 - w / 2;
    const y = 30 - h;
    shadedBlob(s, x, y, w, h, ramp);
    s.hline(x + 2, x + w - 3, 29, ramp[1]);
    s.fillRect(x + 3, y + 2, 2, 2, '#ffffff');
    if (dir === 'down') {
      s.fillRect(9, y + h / 2, 1, 2, OUTLINE);
      s.fillRect(14, y + h / 2, 1, 2, OUTLINE);
    } else if (dir === 'left') {
      s.fillRect(x + 3, y + h / 2, 1, 2, OUTLINE);
    }
  });
}

/** Bat: flapping wings, hovering above the ground. */
export function bat(ramp: Ramp = RAMPS.cloth): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const wingUp = f !== 1;
    const cy = 16 + (f === 1 ? 1 : 0);
    shadedBlob(s, 8, cy - 4, 8, 8, ramp);
    // Ears.
    s.set(9, cy - 5, ramp[2]);
    s.set(14, cy - 5, ramp[2]);
    // Wings.
    for (let i = 0; i < 7; i++) {
      const wy = wingUp ? cy - 2 - Math.floor(i / 2) : cy + Math.floor(i / 3);
      const len = dir === 'left' ? 4 : 6 - Math.floor(i / 2);
      s.vline(7 - i, wy, wy + len - 3, ramp[1]);
      if (dir !== 'left') s.vline(16 + i, wy, wy + len - 3, ramp[1]);
      else s.vline(16 + Math.floor(i / 2), wy, wy + 2, ramp[0]);
    }
    if (dir !== 'up') {
      s.set(dir === 'left' ? 9 : 10, cy - 1, '#ffe040');
      if (dir === 'down') s.set(13, cy - 1, '#ffe040');
    }
    // Shadow is drawn by the engine; keep feet area empty.
  });
}

/** Wolf on four legs; the side view shows the full body. */
export function wolf(ramp: Ramp = ['#34303c', '#56505e', '#7c7686', '#aaa4b4']): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const step = f - 1;
    if (dir === 'left') {
      // Body.
      shadedBlob(s, 5, 16, 16, 9, ramp);
      // Legs.
      const legs = [6 + step, 9 - step, 15 + step, 18 - step];
      legs.forEach((lx, i) => s.fillRect(lx, 23, 2, 6, i % 2 ? ramp[1] : ramp[2]));
      // Head and snout.
      shadedBlob(s, 1, 12, 9, 8, ramp);
      s.fillRect(0, 16, 3, 3, ramp[2]);
      s.set(0, 16, OUTLINE);
      s.set(4, 14, '#ffd040');
      s.fillRect(6, 10, 2, 3, ramp[1]); // ear
      // Tail.
      s.line(20, 17, 23, 13 + (f % 2), ramp[2]);
    } else {
      const facingDown = dir === 'down';
      shadedBlob(s, 6, 14, 12, 12, ramp);
      for (const [lx, drop] of [[7, step], [15, -step]] as const) s.fillRect(lx, 24, 2, 5 + drop, ramp[1]);
      if (facingDown) {
        shadedBlob(s, 7, 9, 10, 9, ramp);
        s.fillRect(9, 15, 6, 3, ramp[3]);
        s.set(11, 15, OUTLINE);
        s.set(12, 15, OUTLINE);
        s.set(9, 12, '#ffd040');
        s.set(14, 12, '#ffd040');
        s.fillRect(7, 7, 2, 3, ramp[1]);
        s.fillRect(15, 7, 2, 3, ramp[1]);
      } else {
        shadedBlob(s, 7, 8, 10, 8, ramp);
        s.fillRect(7, 6, 2, 3, ramp[1]);
        s.fillRect(15, 6, 2, 3, ramp[1]);
        s.line(12, 24, 12 + step, 28, ramp[2]); // tail
      }
    }
  });
}

/** Walking mushroom: a big cap on a stubby stem with little feet. */
export function mushroom(cap: Ramp = RAMPS.flowerRed): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const step = f - 1;
    const stem = RAMPS.plaster;
    s.fillRect(9, 19, 6, 8, stem[2]);
    s.vline(14, 19, 26, stem[1]);
    s.fillRect(8 + step, 27, 3, 2, stem[1]);
    s.fillRect(13 - step, 27, 3, 2, stem[1]);
    shadedBlob(s, 3, 8, 18, 13, cap);
    for (const [sx, sy] of [[7, 11], [13, 10], [16, 15], [9, 16]] as const) {
      if (dir === 'up' || sx < 15 || dir !== 'left') s.fillRect(sx, sy, 2, 2, '#ffffff');
    }
    if (dir === 'down') {
      s.set(10, 22, OUTLINE);
      s.set(13, 22, OUTLINE);
    } else if (dir === 'left') {
      s.set(9, 22, OUTLINE);
    }
  });
}

/**
 * Raid boss: a horned armoured demon, two tiles wide (frames 48 × 64).
 * Meant for a `$`-prefixed sheet (one character per sheet).
 */
export function demonLord(): PixelCanvas {
  const armor: Ramp = ['#241a30', '#3c2c50', '#5a4474', '#8a70a8'];
  const skin: Ramp = RAMPS.roofRed;
  return blockFrom(
    (s, dir, f) => {
      const step = f - 1;
      const side = dir === 'left';
      // Cape.
      if (dir !== 'down') s.fillRect(side ? 22 : 10, 24, side ? 18 : 28, 32, RAMPS.carpetRed[1]);
      // Legs.
      for (const [lx, drop] of [[16, step], [26, -step]] as const) {
        s.fillRect(lx + (side ? step * 2 : 0), 46, 7, 14 + (side ? 0 : drop), armor[1]);
        s.fillRect(lx - 1 + (side ? step * 2 : 0), 58 + (side ? 0 : drop), 9, 3, armor[0]);
      }
      // Torso.
      shadedBlob(s, 12, 24, 24, 26, armor);
      s.fillRect(20, 30, 8, 8, RAMPS.gold[2]);
      s.fillRect(22, 32, 4, 4, '#ff3a3a');
      // Arms / pauldrons.
      if (!side) {
        shadedBlob(s, 5, 22, 12, 10, armor);
        shadedBlob(s, 31, 22, 12, 10, armor);
        s.fillRect(7, 31, 6, 14, armor[1]);
        s.fillRect(35, 31, 6, 14, armor[1]);
        s.fillRect(7, 44, 6, 4, skin[2]);
        s.fillRect(35, 44, 6, 4, skin[2]);
      } else {
        shadedBlob(s, 18, 22, 12, 10, armor);
        s.fillRect(20 + step, 31, 6, 14, armor[2]);
      }
      // Head with horns.
      shadedBlob(s, side ? 13 : 16, 8, 16, 16, skin);
      const hx = side ? 13 : 16;
      s.line(hx + 1, 10, hx - 3, 2, RAMPS.plaster[2]);
      s.line(hx + 2, 10, hx - 2, 2, RAMPS.plaster[3]);
      if (!side) {
        s.line(hx + 14, 10, hx + 18, 2, RAMPS.plaster[1]);
        s.line(hx + 13, 10, hx + 17, 2, RAMPS.plaster[2]);
      } else {
        s.line(hx + 12, 9, hx + 17, 3, RAMPS.plaster[1]);
      }
      if (dir === 'down') {
        s.fillRect(hx + 4, 15, 3, 2, '#fff04a');
        s.fillRect(hx + 9, 15, 3, 2, '#fff04a');
        s.hline(hx + 5, hx + 10, 20, skin[0]);
      } else if (side) {
        s.fillRect(hx + 2, 15, 3, 2, '#fff04a');
      }
    },
    48,
    64,
  );
}

/**
 * Treasure chest opening animation for an object sheet: the four rows are the
 * successive opening steps (closed, ajar, half, open); columns are identical.
 */
export function chestAnimation(ramp: Ramp = RAMPS.wood): PixelCanvas {
  const block = new PixelCanvas(CHAR_FRAME_W * 3, CHAR_FRAME_H * 4);
  for (let row = 0; row < 4; row++) {
    const s = new PixelCanvas(CHAR_FRAME_W, CHAR_FRAME_H);
    s.fillRect(5, 22, 14, 8, ramp[2]);
    s.hline(5, 18, 29, ramp[0]);
    const lidTop = 17 - row * 2;
    s.fillRect(5, lidTop, 14, 22 - lidTop, row === 0 ? ramp[3] : ramp[1]);
    if (row > 0) s.fillRect(6, 21, 12, 2, RAMPS.dark[1]);
    if (row === 3) {
      s.set(9, 21, RAMPS.gold[3]);
      s.set(13, 22, RAMPS.gold[3]);
    }
    s.vline(7, lidTop, 29, RAMPS.gold[1]);
    s.vline(16, lidTop, 29, RAMPS.gold[1]);
    if (row === 0) s.fillRect(11, 20, 2, 3, RAMPS.gold[3]);
    s.outline(OUTLINE);
    for (let f = 0; f < 3; f++) block.blit(s, f * CHAR_FRAME_W, row * CHAR_FRAME_H);
  }
  return block;
}

/**
 * Medicinal herb (quest pickups): a leafy tuft with white flowers and a
 * sparkle that moves around it; three frames repeated on every row.
 */
export function herbAnimation(): PixelCanvas {
  const block = new PixelCanvas(CHAR_FRAME_W * 3, CHAR_FRAME_H * 4);
  const sparkles: [number, number][] = [[5, 15], [18, 12], [12, 9]];
  for (let f = 0; f < 3; f++) {
    const s = new PixelCanvas(CHAR_FRAME_W, CHAR_FRAME_H);
    s.fillEllipse(12, 28, 8, 2, RAMPS.dark[0]);
    s.fillEllipse(8, 23, 4, 5, RAMPS.leaves[1]);
    s.fillEllipse(16, 23, 4, 5, RAMPS.leaves[1]);
    s.fillEllipse(12, 21, 4, 7, RAMPS.leaves[2]);
    s.vline(12, 17, 27, RAMPS.leaves[0]);
    s.set(10, 20, RAMPS.leaves[3]);
    s.set(15, 22, RAMPS.leaves[3]);
    for (const [x, y] of [[9, 18], [15, 17], [12, 15]] as const) {
      s.fillRect(x - 1, y - 1, 3, 3, RAMPS.flowerWhite[2]);
      s.set(x, y, RAMPS.flowerYellow[2]);
    }
    s.outline(OUTLINE);
    const [sx, sy] = sparkles[f]!;
    s.set(sx, sy, RAMPS.flowerWhite[3]);
    s.set(sx - 1, sy, RAMPS.gold[3]);
    s.set(sx + 1, sy, RAMPS.gold[3]);
    s.set(sx, sy - 1, RAMPS.gold[3]);
    s.set(sx, sy + 1, RAMPS.gold[3]);
    for (let row = 0; row < 4; row++) block.blit(s, f * CHAR_FRAME_W, row * CHAR_FRAME_H);
  }
  return block;
}

/** Flickering flame (torches, braziers): three frames repeated on every row. */
export function flameAnimation(): PixelCanvas {
  const block = new PixelCanvas(CHAR_FRAME_W * 3, CHAR_FRAME_H * 4);
  for (let f = 0; f < 3; f++) {
    const s = new PixelCanvas(CHAR_FRAME_W, CHAR_FRAME_H);
    const lean = f - 1;
    s.fillEllipse(8, 16, 8, 10, RAMPS.fire[1]);
    s.fillEllipse(9 + lean, 12 - (f % 2), 6, 9, RAMPS.fire[2]);
    s.fillEllipse(10 + lean, 16, 4, 6, RAMPS.fire[3]);
    s.set(12 + lean * 2, 9, RAMPS.fire[2]);
    for (let row = 0; row < 4; row++) block.blit(s, f * CHAR_FRAME_W, row * CHAR_FRAME_H);
  }
  return block;
}
