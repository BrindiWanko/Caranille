/**
 * @file Portrait ("face") generator for dialogue windows and the HUD.
 *
 * Draws a bust from the same appearance parameters as the character sprites,
 * on a 48 × 48 logical canvas (144 × 144 px at the default scale, the standard
 * face size). Face sheets hold 4 × 2 portraits in reading order, matching the
 * order of characters in the corresponding character sheet.
 */
import { type CharacterAppearance } from './character.js';
import { HAIR_RAMPS, OUTFIT_RAMPS, OUTLINE, RAMPS, SKIN_RAMPS, type Ramp } from './palette.js';
import { PixelCanvas } from './pixel.js';

/** Face size in logical pixels. */
export const FACE_SIZE = 48;

/** Fills an ellipse with top-left lighting (3 tones). */
function lit(s: PixelCanvas, x: number, y: number, w: number, h: number, r: Ramp, dark = 1, base = 2, light = 3): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      const nx = (i + 0.5 - cx) / (w / 2);
      const ny = (j + 0.5 - cy) / (h / 2);
      if (nx * nx + ny * ny > 1) continue;
      const l = -nx * 0.5 - ny * 0.7;
      s.set(i, j, r[(l > 0.55 ? light : l > -0.45 ? base : dark) as 0 | 1 | 2 | 3]);
    }
  }
}

function eye(s: PixelCanvas, x: number, y: number, iris: Ramp, female: boolean, flip: boolean): void {
  // 5 × 6 eye: white, iris (2 tones), pupil, highlight, upper lid line.
  s.fillRect(x, y + 1, 5, 5, '#ffffff');
  s.fillRect(x + 1, y + 1, 3, 5, iris[2]);
  s.fillRect(x + 1, y + 4, 3, 2, iris[1]);
  s.fillRect(x + 2, y + 2, 1, 3, OUTLINE);
  s.set(flip ? x + 3 : x + 1, y + 2, '#ffffff');
  s.hline(x - (female ? 1 : 0), x + 4 + (female ? 1 : 0), y, OUTLINE);
  if (female) s.set(flip ? x - 1 : x + 5, y + 1, OUTLINE);
  s.hline(x + 1, x + 3, y + 6, iris[0]);
}

/**
 * Draws a portrait.
 * @param a - Appearance.
 * @returns A 48 × 48 canvas.
 */
export function drawFace(a: CharacterAppearance): PixelCanvas {
  const s = new PixelCanvas(FACE_SIZE, FACE_SIZE);
  const skeleton = a.outfit === 'skeleton';
  const goblin = a.outfit === 'goblin';
  const skin = goblin ? SKIN_RAMPS[4]! : skeleton ? SKIN_RAMPS[5]! : SKIN_RAMPS[a.skin] ?? SKIN_RAMPS[0]!;
  const hair = HAIR_RAMPS[a.hairColor] ?? HAIR_RAMPS[0]!;
  const main = OUTFIT_RAMPS[a.outfitColor] ?? OUTFIT_RAMPS[0]!;
  const female = a.body === 'female';
  const long = a.hair === 'long';
  const covered = a.outfit === 'guard' || a.outfit === 'sage' || skeleton;

  // Long hair falls behind the shoulders.
  if (long && !covered) {
    s.fillRoundRect(9, 14, 30, 30, 6, hair[1]);
    s.fillRect(10, 30, 28, 14, hair[1]);
  }
  if (a.hair === 'ponytail' && !covered) lit(s, 32, 12, 10, 22, hair);

  // Shoulders and outfit.
  let torso = main;
  if (a.outfit === 'priest') torso = RAMPS.flowerWhite;
  if (a.outfit === 'warrior' || a.outfit === 'guard') torso = RAMPS.silver;
  if (a.outfit === 'sage') torso = RAMPS.cloth;
  if (goblin || skeleton) torso = skin;
  s.fillRoundRect(6, 38, 36, 12, 5, torso[2]);
  s.hline(9, 38, 38, torso[3]);
  s.vline(40, 40, 47, torso[1]);
  s.vline(41, 41, 47, torso[1]);
  if (a.outfit === 'warrior' || a.outfit === 'guard') {
    lit(s, 4, 36, 12, 9, RAMPS.silver);
    lit(s, 32, 36, 12, 9, RAMPS.silver);
    s.fillRect(21, 39, 6, 9, main[2]);
  } else if (a.outfit === 'priest') {
    s.fillRect(22, 39, 4, 9, main[2]);
    s.fillRect(19, 42, 10, 2, RAMPS.gold[3]);
    s.fillRect(23, 40, 2, 7, RAMPS.gold[3]);
  } else if (a.outfit === 'mage') {
    s.fillRect(22, 38, 4, 10, main[3]);
  } else if (a.outfit === 'archer') {
    s.line(12, 38, 34, 47, RAMPS.roofBrown[1]);
    s.line(13, 38, 35, 47, RAMPS.roofBrown[2]);
  } else if (a.outfit === 'merchant' || a.outfit === 'innkeeper') {
    s.fillRect(15, 42, 18, 6, RAMPS.flowerWhite[3]);
  } else if (a.outfit === 'smith') {
    s.fillRect(15, 41, 18, 7, RAMPS.roofBrown[2]);
  }
  if (skeleton) for (let y = 40; y < 48; y += 3) s.hline(14, 33, y, skin[0]);

  // Neck.
  s.fillRect(20, 34, 8, 5, skin[1]);

  // Head.
  lit(s, 11, 8, 26, 29, skin);
  if (goblin) {
    for (let i = 0; i < 6; i++) {
      s.hline(5 + i, 11, 18 + Math.floor(i / 2), skin[2]);
      s.hline(37, 42 - i, 18 + Math.floor(i / 2), skin[1]);
    }
  } else if (!covered && !long) {
    // Ears.
    s.fillEllipse(9, 20, 4, 7, skin[2]);
    s.fillEllipse(35, 20, 4, 7, skin[1]);
  }

  // Face features.
  const iris = goblin ? RAMPS.flowerRed : skeleton ? RAMPS.dark : ([RAMPS.roofBlue, RAMPS.roofGreen, RAMPS.roofBrown, RAMPS.cloth][a.hairColor % 4] as Ramp);
  if (skeleton) {
    s.fillEllipse(15, 19, 7, 7, OUTLINE);
    s.fillEllipse(26, 19, 7, 7, OUTLINE);
    s.fillRect(22, 27, 4, 3, OUTLINE);
    for (let x = 16; x <= 31; x += 3) s.vline(x, 31, 33, skin[0]);
    s.hline(16, 31, 31, skin[0]);
  } else {
    eye(s, 15, 20, iris, female, false);
    eye(s, 28, 20, iris, female, true);
    // Eyebrows in the hair colour.
    s.hline(15, 19, 17, hair[0]);
    s.hline(28, 32, 17, hair[0]);
    // Nose and mouth.
    s.set(24, 27, skin[1]);
    s.set(23, 28, skin[1]);
    s.hline(22, 25, 31, skin[0]);
    if (female) {
      s.set(21, 30, skin[0]);
      s.fillRect(14, 28, 3, 2, '#f09090');
      s.fillRect(31, 28, 3, 2, '#f09090');
    }
    if (goblin) s.set(26, 32, '#ffffff');
  }

  // Beard.
  if (a.beard) {
    const b = a.outfit === 'sage' ? RAMPS.flowerWhite : hair;
    for (let y = 27; y <= 42; y++) {
      const half = y < 33 ? 12 - Math.max(0, 29 - y) * 2 : Math.max(2, 12 - (y - 32));
      for (let x = 24 - half; x < 24 + half; x++) if (y > 29 || x < 19 || x > 28) s.set(x, y, y < 30 ? b[3] : b[2]);
    }
    s.hline(21, 26, 31, b[0]);
  }

  // Hair.
  if (!covered && a.hair !== 'bald') {
    lit(s, 9, 3, 30, 17, hair);
    // Fringe locks falling on the forehead.
    for (const [x, len] of [[12, 7], [15, 9], [19, 6], [23, 8], [27, 6], [31, 9], [34, 7]] as const) {
      s.fillRect(x, 14, 3, len - 2, hair[2]);
      s.set(x + 1, 14 + len - 2, hair[1]);
    }
    s.vline(9, 12, long ? 40 : 26, hair[1]);
    s.vline(10, 12, long ? 40 : 25, hair[2]);
    s.vline(38, 12, long ? 40 : 26, hair[0]);
    s.vline(37, 12, long ? 40 : 25, hair[1]);
    s.hline(14, 26, 5, hair[3]);
    if (a.hair === 'spiky') {
      for (const [x, y] of [[10, 2], [16, 0], [22, 0], [28, 0], [34, 2]] as const) {
        for (let i = 0; i < 5; i++) s.hline(x + Math.floor(i / 2), x + 4 - Math.floor(i / 2), y + 4 - i, hair[i < 2 ? 3 : 2]);
      }
    }
    if (a.hair === 'bun') lit(s, 18, 0, 12, 8, hair);
  } else if (a.hair === 'bald' && !covered) {
    s.hline(17, 30, 10, skin[3]);
  }

  // Headwear.
  if (a.outfit === 'mage') {
    const h = main;
    s.fillRoundRect(3, 11, 42, 6, 2, h[1]);
    s.hline(4, 43, 11, h[2]);
    for (let y = 0; y < 11; y++) {
      const half = 3 + y;
      s.hline(24 - half + Math.floor((11 - y) / 2), 23 + half + Math.floor((11 - y) / 2), y, h[2]);
    }
    s.hline(8, 39, 10, RAMPS.gold[2]);
  } else if (a.outfit === 'guard') {
    const m = RAMPS.silver;
    lit(s, 9, 2, 30, 26, m);
    s.fillRect(13, 17, 22, 16, skin[2]);
    eye(s, 15, 20, iris, female, false);
    eye(s, 28, 20, iris, female, true);
    s.hline(22, 25, 31, skin[0]);
    s.fillRect(23, 2, 2, 15, m[1]);
    s.fillRect(20, 0, 8, 3, main[2]);
  } else if (a.outfit === 'sage') {
    const hood = RAMPS.cloth;
    lit(s, 7, 2, 34, 22, hood);
    s.fillRect(7, 14, 5, 26, hood[1]);
    s.fillRect(36, 14, 5, 26, hood[0]);
  } else if (a.outfit === 'warrior') {
    s.fillRect(10, 13, 28, 3, main[2]);
    s.hline(10, 37, 13, main[3]);
  } else if (a.outfit === 'merchant') {
    s.fillRoundRect(9, 2, 30, 8, 3, RAMPS.roofBrown[2]);
    s.hline(6, 41, 9, RAMPS.roofBrown[1]);
  }

  s.outline(OUTLINE);
  return s;
}

/**
 * Assembles up to eight portraits into a standard face sheet (4 × 2).
 * @param faces - Portraits in reading order.
 */
export function assembleFaceSheet(faces: readonly PixelCanvas[]): PixelCanvas {
  const sheet = new PixelCanvas(FACE_SIZE * 4, FACE_SIZE * 2);
  faces.slice(0, 8).forEach((f, i) => sheet.blit(f, (i % 4) * FACE_SIZE, Math.floor(i / 4) * FACE_SIZE));
  return sheet;
}
