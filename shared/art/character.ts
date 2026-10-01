/**
 * @file Parametric character sprite generator.
 *
 * Produces character frames in the standard walking layout: 3 frames
 * (step A, standing, step B) × 4 directions (rows: down, left, right, up).
 * The same code runs at build time (to write NPC / monster sheets as SVG) and
 * in the browser (live preview in character creation, and on-the-fly sheets
 * for players whose appearance is stored as parameters instead of a file).
 *
 * A frame is 24 × 32 logical pixels (one logical pixel = tile size / 16 real
 * pixels), i.e. 1.5 tiles wide and 2 tiles tall, the classic proportions of
 * 16 px chipset games; the renderer anchors frames by their bottom centre.
 * Parts are drawn back to front (legs, body, arms, head, face, hair,
 * headwear), then a dark outline is added around the whole silhouette.
 */
import { HAIR_RAMPS, OUTFIT_RAMPS, OUTLINE, RAMPS, SKIN_RAMPS, type Ramp } from './palette.js';
import { PixelCanvas } from './pixel.js';

/** Frame width in logical pixels. */
export const CHAR_FRAME_W = 24;
/** Frame height in logical pixels. */
export const CHAR_FRAME_H = 32;

/** Facing directions in sheet row order. */
export const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
/** A facing direction. */
export type Facing = (typeof DIRECTIONS)[number];

/** Available hair styles. */
export const HAIR_STYLES = ['short', 'spiky', 'long', 'ponytail', 'bun', 'bald'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** Outfits: the four starting classes, then NPC and monster outfits. */
export const OUTFITS = [
  'warrior', 'mage', 'archer', 'priest',
  'villager', 'merchant', 'guard', 'smith', 'innkeeper', 'sage',
  'goblin', 'skeleton',
] as const;
export type Outfit = (typeof OUTFITS)[number];

/** Outfits a player may pick at character creation (tied to the class). */
export const PLAYER_OUTFITS: readonly Outfit[] = ['warrior', 'mage', 'archer', 'priest'];

/** Parameters describing a generated character. */
export interface CharacterAppearance {
  body: 'male' | 'female';
  /** Index into `SKIN_RAMPS`. */
  skin: number;
  hair: HairStyle;
  /** Index into `HAIR_RAMPS`. */
  hairColor: number;
  outfit: Outfit;
  /** Index into `OUTFIT_RAMPS`. */
  outfitColor: number;
  /** Adds a beard (drawn in the hair colour, or white for elders). */
  beard?: boolean;
}

/** Default appearance, also used to sanitise invalid input. */
export const DEFAULT_APPEARANCE: CharacterAppearance = {
  body: 'male',
  skin: 0,
  hair: 'short',
  hairColor: 1,
  outfit: 'warrior',
  outfitColor: 0,
};

/** Maximum index values for appearance fields visible to players. */
export const APPEARANCE_LIMITS = {
  skin: 4, // the last skin ramps are reserved for monsters
  hairColor: HAIR_RAMPS.length,
  outfitColor: OUTFIT_RAMPS.length,
} as const;

/**
 * Validates untrusted appearance data (from the client or the database).
 * Unknown or out-of-range values fall back to the defaults.
 * @param input - Any value.
 * @param allowedOutfits - Outfits accepted for this context.
 */
export function sanitizeAppearance(input: unknown, allowedOutfits: readonly Outfit[] = OUTFITS): CharacterAppearance {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const index = (v: unknown, max: number, fallback: number) =>
    Number.isInteger(v) && (v as number) >= 0 && (v as number) < max ? (v as number) : fallback;
  return {
    body: src.body === 'female' ? 'female' : 'male',
    skin: index(src.skin, APPEARANCE_LIMITS.skin, DEFAULT_APPEARANCE.skin),
    hair: HAIR_STYLES.includes(src.hair as HairStyle) ? (src.hair as HairStyle) : DEFAULT_APPEARANCE.hair,
    hairColor: index(src.hairColor, APPEARANCE_LIMITS.hairColor, DEFAULT_APPEARANCE.hairColor),
    outfit: allowedOutfits.includes(src.outfit as Outfit) ? (src.outfit as Outfit) : allowedOutfits[0]!,
    outfitColor: index(src.outfitColor, APPEARANCE_LIMITS.outfitColor, DEFAULT_APPEARANCE.outfitColor),
    beard: src.beard === true,
  };
}

/** Colours resolved for one character. */
interface Colors {
  skin: Ramp;
  hair: Ramp;
  main: Ramp; // outfit colour
  pants: Ramp;
  boots: Ramp;
  metal: Ramp;
  leather: Ramp;
  white: Ramp;
}

function resolveColors(a: CharacterAppearance): Colors {
  const skin =
    a.outfit === 'goblin' ? SKIN_RAMPS[4]! : a.outfit === 'skeleton' ? SKIN_RAMPS[5]! : SKIN_RAMPS[a.skin] ?? SKIN_RAMPS[0]!;
  return {
    skin,
    hair: HAIR_RAMPS[a.hairColor] ?? HAIR_RAMPS[0]!,
    main: OUTFIT_RAMPS[a.outfitColor] ?? OUTFIT_RAMPS[0]!,
    pants: ['#2a2230', '#3e3448', '#584a64', '#76688a'],
    boots: RAMPS.wood,
    metal: RAMPS.silver,
    leather: RAMPS.roofBrown,
    white: RAMPS.flowerWhite,
  };
}

/** Frame being drawn: the canvas, direction and step (-1, 0, +1). */
interface Ctx {
  s: PixelCanvas;
  dir: Facing;
  step: number;
  c: Colors;
  a: CharacterAppearance;
}

/** Fills a rect with a vertical 3-tone shading: light left column, dark right column. */
function shadedRect(s: PixelCanvas, x: number, y: number, w: number, h: number, r: Ramp, flip = false): void {
  s.fillRect(x, y, w, h, r[2]);
  if (w >= 3) {
    s.vline(flip ? x + w - 1 : x, y, y + h - 1, r[3]);
    s.vline(flip ? x : x + w - 1, y, y + h - 1, r[1]);
  }
}

const isRobe = (o: Outfit): boolean => o === 'mage' || o === 'priest' || o === 'sage';
const hasHelmet = (o: Outfit): boolean => o === 'guard';

// ---------------------------------------------------------------------------
// Body parts. Coordinates are for a 24 × 32 frame; "left" facing is drawn and
// "right" is obtained by mirroring the finished frame.
// ---------------------------------------------------------------------------

function drawLegs(x: Ctx): void {
  const { s, dir, step, c, a } = x;
  const pants = a.outfit === 'skeleton' ? c.skin : a.outfit === 'goblin' ? c.skin : a.outfit === 'warrior' || a.outfit === 'guard' ? c.main : c.pants;
  const boots = a.outfit === 'warrior' || a.outfit === 'guard' ? c.metal : a.outfit === 'skeleton' ? c.skin : c.boots;
  if (dir === 'down' || dir === 'up') {
    // Two legs; while walking one is extended (1 px lower) and the other lifted.
    const legs = [
      { x: 8, drop: step === -1 ? 1 : step === 1 ? -1 : 0 },
      { x: 13, drop: step === 1 ? 1 : step === -1 ? -1 : 0 },
    ];
    for (const leg of legs) {
      const bottom = 29 + leg.drop;
      shadedRect(s, leg.x, 23, 3, bottom - 23 - 1, pants);
      s.fillRect(leg.x, bottom - 1, 3, 2, boots[2]);
      s.set(leg.x + 2, bottom, boots[1]);
    }
  } else {
    // Side view: legs spread forwards/backwards while walking.
    const spread = step === 0 ? 0 : 2;
    const front = { x: 10 - spread, shade: pants[2] };
    const back = { x: 11 + spread, shade: pants[1] };
    for (const leg of [back, front]) {
      s.fillRect(leg.x, 23, 3, 5, leg.shade);
      s.fillRect(leg.x - 1, 28, 4, 2, leg === front ? boots[2] : boots[1]);
    }
  }
}

function drawBody(x: Ctx): void {
  const { s, dir, c, a } = x;
  const side = dir === 'left';
  const bx = side ? 9 : 8;
  const bw = side ? 6 : 8;
  let torso = c.main;
  if (a.outfit === 'priest') torso = c.white;
  if (a.outfit === 'warrior' || a.outfit === 'guard') torso = c.metal;
  if (a.outfit === 'sage') torso = RAMPS.stone;
  if (a.outfit === 'goblin') torso = c.skin;
  if (a.outfit === 'skeleton') torso = c.skin;
  shadedRect(s, bx, 17, bw, 6, torso);

  if (a.outfit === 'skeleton') {
    // Ribs: dark horizontal gaps.
    for (let y = 18; y <= 21; y += 2) s.hline(bx + 1, bx + bw - 2, y, c.skin[0]);
    s.vline(bx + Math.floor(bw / 2), 17, 22, c.skin[1]);
  }

  // Lower garment.
  if (isRobe(a.outfit)) {
    const robe = a.outfit === 'priest' ? c.white : a.outfit === 'sage' ? RAMPS.stone : c.main;
    for (let y = 23; y <= 28; y++) {
      const widen = Math.floor((y - 23) / 2);
      const x0 = bx - widen;
      const w = bw + widen * 2;
      s.hline(x0, x0 + w - 1, y, robe[2]);
      s.set(x0, y, robe[3]);
      s.set(x0 + w - 1, y, robe[1]);
    }
    s.hline(bx - 2, bx + bw + 1, 28, a.outfit === 'priest' ? c.main[2] : robe[0]);
    if (a.outfit === 'priest' && dir !== 'up') {
      // Coloured stole and a golden cross.
      s.vline(bx + (side ? 1 : 3), 17, 27, c.main[2]);
      s.vline(bx + (side ? 1 : 4), 17, 27, c.main[1]);
      if (!side) {
        s.vline(bx + 3, 18, 21, RAMPS.gold[3]);
        s.hline(bx + 2, bx + 5, 19, RAMPS.gold[3]);
      }
    }
    if (a.outfit === 'mage' && dir !== 'up') s.vline(bx + (side ? 1 : 3), 17, 28, c.main[3]);
  } else if (a.outfit === 'archer') {
    // Tunic skirt over the pants.
    s.fillRect(bx, 23, bw, 2, c.main[1]);
  } else if (a.body === 'female' && (a.outfit === 'villager' || a.outfit === 'innkeeper')) {
    for (let y = 23; y <= 26; y++) {
      const widen = Math.floor((y - 22) / 2);
      s.hline(bx - widen, bx + bw - 1 + widen, y, c.main[y === 26 ? 1 : 2]);
    }
  } else if (a.outfit === 'goblin') {
    s.fillRect(bx, 22, bw, 3, c.leather[2]);
    s.hline(bx, bx + bw - 1, 24, c.leather[0]);
  }

  // Belt.
  if (!isRobe(a.outfit) && a.outfit !== 'goblin' && a.outfit !== 'skeleton') {
    s.hline(bx, bx + bw - 1, 22, c.leather[1]);
    if (dir === 'down') s.set(bx + Math.floor(bw / 2), 22, RAMPS.gold[3]);
  }

  // Aprons.
  if ((a.outfit === 'merchant' || a.outfit === 'innkeeper' || a.outfit === 'smith') && dir !== 'up') {
    const apron = a.outfit === 'smith' ? c.leather : c.white;
    const ax = side ? bx : bx + 1;
    const aw = side ? 3 : bw - 2;
    s.fillRect(ax, 19, aw, 7, apron[2]);
    s.hline(ax, ax + aw - 1, 19, apron[3]);
  }

  // Warrior / guard tabard stripe in the outfit colour.
  if ((a.outfit === 'warrior' || a.outfit === 'guard') && dir !== 'up') {
    const tx = side ? bx + 1 : bx + 3;
    s.fillRect(tx, 17, 2, 6, c.main[2]);
    s.vline(tx, 17, 22, c.main[3]);
  }
}

function drawArm(x: Ctx, which: 'left' | 'right' | 'side'): void {
  const { s, step, c, a } = x;
  let sleeve = c.main;
  if (a.outfit === 'priest') sleeve = c.white;
  if (a.outfit === 'warrior' || a.outfit === 'guard') sleeve = c.metal;
  if (a.outfit === 'sage') sleeve = RAMPS.stone;
  if (a.outfit === 'smith' || a.outfit === 'goblin' || a.outfit === 'skeleton') sleeve = c.skin;
  if (which === 'side') {
    const ax = 11 + (step === -1 ? -1 : step === 1 ? 1 : 0);
    s.fillRect(ax, 17, 2, 4, sleeve[2]);
    s.set(ax, 17, sleeve[3]);
    s.fillRect(ax, 21, 2, 2, c.skin[2]);
    return;
  }
  // Arms swing opposite to the legs.
  const swing = which === 'left' ? (step === 1 ? 1 : step === -1 ? -1 : 0) : step === -1 ? 1 : step === 1 ? -1 : 0;
  const ax = which === 'left' ? 6 : 16;
  const top = 17 + Math.max(0, swing);
  s.fillRect(ax, top, 2, 4, sleeve[which === 'left' ? 2 : 1]);
  s.set(ax, top, sleeve[3]);
  s.fillRect(ax, top + 4, 2, 2, c.skin[which === 'left' ? 2 : 1]);
  if (a.outfit === 'warrior' || a.outfit === 'guard') {
    // Shoulder pads.
    s.fillRect(ax - (which === 'left' ? 1 : 0), 16, 3, 2, c.metal[3]);
  }
}

/** Quiver on the back (archers), drawn behind the head and hair. */
function drawQuiver(x: Ctx): void {
  const { s, dir, c, a } = x;
  if (a.outfit !== 'archer' || dir === 'down') return;
  const qx = dir === 'up' ? 14 : 15;
  s.fillRect(qx, 14, 3, 8, c.leather[2]);
  s.vline(qx, 14, 21, c.leather[3]);
  for (let i = 0; i < 3; i++) s.set(qx + i, 12 + (i % 2), RAMPS.flowerWhite[3]);
}

function drawHead(x: Ctx): void {
  const { s, dir, c, a } = x;
  const skin = c.skin;
  s.fillRoundRect(7, 7, 10, 10, 2, skin[2]);
  // Light from the top-left: right and bottom edges are darker.
  if (dir !== 'left') s.vline(16, 9, 14, skin[1]);
  s.hline(9, 14, 16, skin[1]);
  if (dir === 'up') return;
  if (dir === 'down') {
    const eye = a.outfit === 'skeleton' ? OUTLINE : a.outfit === 'goblin' ? '#d02020' : OUTLINE;
    s.fillRect(9, 12, 1, 2, eye);
    s.fillRect(14, 12, 1, 2, eye);
    if (a.outfit === 'skeleton') {
      s.fillRect(9, 12, 2, 2, OUTLINE);
      s.fillRect(13, 12, 2, 2, OUTLINE);
      s.hline(10, 13, 15, skin[0]);
    } else {
      s.set(9, 12, eye === OUTLINE ? '#3a3050' : eye);
      if (a.body === 'female') {
        s.set(8, 11, OUTLINE);
        s.set(15, 11, OUTLINE);
        s.set(8, 14, '#f08a8a');
        s.set(15, 14, '#f08a8a');
      }
      s.hline(11, 12, 15, skin[1]);
    }
    if (a.outfit === 'goblin') {
      // Pointed ears.
      s.fillRect(5, 11, 2, 2, skin[2]);
      s.fillRect(17, 11, 2, 2, skin[1]);
      s.set(4, 10, skin[2]);
      s.set(19, 10, skin[1]);
    }
  } else {
    // Facing left: one eye near the front, ear towards the back.
    const eye = a.outfit === 'goblin' ? '#d02020' : OUTLINE;
    s.fillRect(8, 12, a.outfit === 'skeleton' ? 2 : 1, 2, eye);
    if (a.body === 'female') s.set(7, 11, OUTLINE);
    s.set(7, 14, skin[1]);
    s.fillRect(13, 12, 1, 2, skin[1]);
    if (a.outfit === 'goblin') {
      s.fillRect(14, 10, 3, 2, skin[1]);
      s.set(17, 9, skin[1]);
    }
  }
}

function drawBeard(x: Ctx): void {
  const { s, dir, c, a } = x;
  if (!a.beard || dir === 'up') return;
  const ramp = a.outfit === 'sage' ? RAMPS.flowerWhite : c.hair;
  if (dir === 'down') {
    for (let y = 14; y <= 21; y++) {
      const half = y < 18 ? 4 : Math.max(1, 4 - (y - 17));
      s.hline(12 - half, 11 + half, y, y === 14 ? ramp[3] : ramp[2]);
    }
    s.hline(10, 13, 15, ramp[1]); // mouth line inside the beard
  } else {
    for (let y = 14; y <= 20; y++) s.hline(7, 10 - Math.floor((y - 14) / 3), y, ramp[2]);
  }
}

function drawHair(x: Ctx): void {
  const { s, dir, c, a } = x;
  const h = c.hair;
  if (a.hair === 'bald' || a.outfit === 'skeleton' || hasHelmet(a.outfit)) return;
  const long = a.hair === 'long';
  if (dir === 'down') {
    s.fillRoundRect(6, 5, 12, 6, 2, h[2]);
    s.hline(8, 13, 5, h[3]);
    // Fringe: an uneven lower edge over the forehead.
    for (const [fx, fy] of [[7, 11], [8, 11], [10, 11], [11, 12], [13, 11], [15, 11], [16, 11]] as const) s.set(fx, fy, h[2]);
    s.vline(6, 9, long ? 22 : 13, h[1]);
    s.vline(7, 9, long ? 21 : 12, h[2]);
    s.vline(17, 9, long ? 22 : 13, h[1]);
    s.vline(16, 9, long ? 21 : 12, h[1]);
    if (long) {
      s.vline(5, 12, 20, h[1]);
      s.vline(18, 12, 20, h[0]);
    }
  } else if (dir === 'up') {
    s.fillRoundRect(6, 5, 12, 12, 2, h[2]);
    s.hline(8, 15, 5, h[3]);
    s.vline(7, 7, 14, h[3]);
    s.vline(16, 7, 15, h[1]);
    s.hline(8, 15, 16, h[1]);
    if (long) {
      s.fillRect(6, 16, 12, 6, h[2]);
      s.vline(6, 16, 21, h[3]);
      s.vline(17, 16, 21, h[1]);
      s.hline(7, 16, 22, h[1]);
    }
  } else {
    s.fillRoundRect(7, 5, 11, 6, 2, h[2]);
    s.hline(9, 15, 5, h[3]);
    s.fillRect(12, 9, 6, long ? 13 : 6, h[2]);
    s.vline(17, 9, long ? 21 : 14, h[1]);
    s.vline(12, 11, long ? 21 : 14, h[1]);
    s.set(7, 11, h[2]);
    s.set(8, 11, h[2]);
    s.set(10, 11, h[2]);
  }
  if (a.hair === 'spiky') {
    const spikes = dir === 'left' ? [8, 11, 14, 17] : [7, 10, 13, 16];
    for (const sx of spikes) {
      s.set(sx, 4, h[2]);
      s.set(sx + 1, 4, h[3]);
      s.set(sx + 1, 3, h[3]);
    }
    if (dir === 'left') {
      s.set(18, 8, h[2]);
      s.set(19, 9, h[1]);
    }
  }
  if (a.hair === 'ponytail') {
    if (dir === 'up') {
      s.fillRect(10, 14, 4, 8, h[2]);
      s.vline(13, 14, 21, h[1]);
      s.hline(10, 13, 14, c.main[2]);
    } else if (dir === 'left') {
      s.fillRect(17, 9, 3, 9, h[2]);
      s.vline(19, 10, 17, h[1]);
      s.set(17, 9, c.main[2]);
    } else {
      s.fillRect(17, 11, 2, 5, h[1]);
    }
  }
  if (a.hair === 'bun') {
    const bx = dir === 'left' ? 13 : 9;
    const by = dir === 'up' ? 2 : 1;
    s.fillEllipse(bx, by, 6, 5, h[2]);
    s.set(bx + 1, by + 1, h[3]);
  }
}

function drawHeadwear(x: Ctx): void {
  const { s, dir, c, a } = x;
  if (a.outfit === 'mage') {
    // Pointed hat with a wide brim, tip bending backwards.
    const hat = c.main;
    s.fillRect(4, 8, 16, 2, hat[1]);
    s.hline(4, 19, 8, hat[2]);
    for (let y = 1; y < 8; y++) {
      const half = Math.floor((y + 1) / 2);
      const cx = dir === 'left' ? 12 + Math.floor((8 - y) / 3) : 12;
      s.hline(cx - half, cx + half - 1, y, hat[2]);
      s.set(cx - half, y, hat[3]);
    }
    s.hline(6, 17, 7, RAMPS.gold[2]);
  } else if (a.outfit === 'guard') {
    const m = c.metal;
    s.fillRoundRect(6, 4, 12, 8, 2, m[2]);
    s.hline(8, 15, 4, m[3]);
    s.vline(6, 7, 13, m[1]);
    s.vline(17, 7, 13, m[1]);
    if (dir === 'down') s.vline(11, 9, 12, m[1]);
    s.fillRect(11, 1, 2, 3, c.main[2]); // plume
  } else if (a.outfit === 'merchant') {
    s.fillRect(7, 5, 10, 3, c.leather[2]);
    s.hline(6, 17, 7, c.leather[1]);
  } else if (a.outfit === 'warrior' && dir !== 'up') {
    // Headband.
    s.hline(7, 16, 10, c.main[2]);
    if (dir === 'left') s.fillRect(17, 10, 2, 3, c.main[1]);
  } else if (a.outfit === 'sage') {
    // Hood.
    const hood = RAMPS.cloth;
    if (dir === 'up') {
      s.fillRoundRect(6, 5, 12, 12, 3, hood[2]);
    } else {
      s.fillRoundRect(6, 5, 12, 6, 3, hood[2]);
      s.vline(6, 8, 16, hood[1]);
      s.vline(17, 8, 16, hood[1]);
      if (dir === 'left') s.fillRect(13, 8, 5, 8, hood[2]);
    }
    s.hline(8, 15, 5, hood[3]);
  }
}

/**
 * Draws one frame.
 * @param a - Appearance.
 * @param dir - Facing direction.
 * @param frame - 0 (step A), 1 (standing) or 2 (step B).
 * @returns A 24 × 32 canvas.
 */
export function drawCharacterFrame(a: CharacterAppearance, dir: Facing, frame: number): PixelCanvas {
  const s = new PixelCanvas(CHAR_FRAME_W, CHAR_FRAME_H);
  const x: Ctx = { s, dir: dir === 'right' ? 'left' : dir, step: frame - 1, c: resolveColors(a), a };
  if (x.dir === 'down') {
    drawLegs(x);
    drawBody(x);
    // Quiver strap seen from the front.
    if (a.outfit === 'archer') s.line(9, 17, 14, 22, x.c.leather[1]);
    drawArm(x, 'left');
    drawArm(x, 'right');
  } else if (x.dir === 'up') {
    drawLegs(x);
    drawArm(x, 'left');
    drawArm(x, 'right');
    drawBody(x);
  } else {
    drawLegs(x);
    drawBody(x);
    drawArm(x, 'side');
  }
  drawQuiver(x);
  drawHead(x);
  drawBeard(x);
  drawHair(x);
  drawHeadwear(x);
  s.outline(OUTLINE);
  if (dir === 'right') {
    const mirrored = new PixelCanvas(CHAR_FRAME_W, CHAR_FRAME_H);
    mirrored.blit(s, 0, 0, { flipX: true });
    return mirrored;
  }
  return s;
}

/**
 * Draws the 3 × 4 frame block of one character (standard walking layout).
 * @param a - Appearance.
 * @returns A 72 × 128 canvas.
 */
export function drawCharacterBlock(a: CharacterAppearance): PixelCanvas {
  const block = new PixelCanvas(CHAR_FRAME_W * 3, CHAR_FRAME_H * 4);
  DIRECTIONS.forEach((dir, row) => {
    for (let frame = 0; frame < 3; frame++) block.blit(drawCharacterFrame(a, dir, frame), frame * CHAR_FRAME_W, row * CHAR_FRAME_H);
  });
  return block;
}

/**
 * Assembles up to eight character blocks into a standard sheet (4 × 2 characters).
 * @param blocks - Blocks in reading order.
 */
export function assembleCharacterSheet(blocks: readonly PixelCanvas[]): PixelCanvas {
  const bw = blocks[0]?.width ?? CHAR_FRAME_W * 3;
  const bh = blocks[0]?.height ?? CHAR_FRAME_H * 4;
  const sheet = new PixelCanvas(bw * 4, bh * 2);
  blocks.slice(0, 8).forEach((b, i) => sheet.blit(b, (i % 4) * bw, Math.floor(i / 4) * bh));
  return sheet;
}
