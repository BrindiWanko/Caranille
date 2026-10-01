/**
 * @file System graphics: window skin, icon sheet, emotion balloons, character
 * shadow, mobile controls and application icon.
 *
 * These images keep fixed pixel sizes whatever the tile size, so they are drawn
 * with their own scale (2 real pixels per logical pixel for most of them).
 *
 * Window skin layout (192 × 192 px, i.e. 96 × 96 logical):
 * - (0, 0, 96, 96): background, stretched to the window size;
 * - (0, 96, 96, 96): background pattern, tiled over it;
 * - (96, 0, 96, 96): frame, drawn as a 9-slice with 24 px borders; the scroll
 *   arrows sit in its middle (up at 132,24 and down at 132,72, 24 × 12 each);
 * - (96, 96, 48, 48): selection cursor (9-slice, 4 px borders);
 * - (144, 96, 48, 48): "waiting for input" sign, four 24 × 24 frames;
 * - (96, 144, 96, 48): text colour palette, 8 × 4 cells of 12 × 12 px,
 *   referenced by the `\C[n]` message code.
 */
import { ICON_NAMES, type IconName } from '../../shared/icons.js';
import { OUTLINE, RAMPS, type Ramp } from '../../shared/art/palette.js';
import { PixelCanvas, mix, withAlpha } from '../../shared/art/pixel.js';
import type { GeneratedImage } from './build.js';
import { shadedBlob } from './objects.js';

/** Text colours of the window skin palette, in `\C[n]` order. */
export const TEXT_COLORS = [
  '#ffffff', '#20a0d6', '#ff784c', '#66cc40', '#99ccff', '#ccc0ff', '#ffffa0', '#808080',
  '#c0c0c0', '#2080cc', '#ff3810', '#00a010', '#3e9ade', '#a098ff', '#ffcc20', '#000000',
  '#84aaff', '#ffff40', '#ff2020', '#202040', '#e08040', '#f0c040', '#4080c0', '#40c0f0',
  '#80ff80', '#c08080', '#8080ff', '#ff80ff', '#00a040', '#00e060', '#a060e0', '#c080ff',
] as const;

/** Builds the window skin. */
export function windowSkin(): PixelCanvas {
  const c = new PixelCanvas(96, 96);
  // Background: vertical blue gradient (opacity is applied by the engine).
  for (let y = 0; y < 48; y++) c.hline(0, 47, y, mix('#2c4ea0', '#0e1a48', y / 47));
  // Background pattern: faint diagonal sparkle, mostly transparent.
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) if ((x + y * 3) % 12 === 0 && (x * y) % 5 === 0) c.set(x, 48 + y, withAlpha('#ffffff', 0.06));
  }
  // Frame: dark outer line, light double border, dark inner line, rounded corners.
  const fx = 48;
  const fy = 0;
  for (let i = 0; i < 48; i++) {
    for (let j = 0; j < 48; j++) {
      const d = Math.min(i, j, 47 - i, 47 - j);
      const corner = Math.min(i, 47 - i) + Math.min(j, 47 - j);
      if (corner < 2) continue;
      let color: string | null = null;
      if (d === 0 || corner === 2) color = '#10142c';
      else if (d === 1) color = '#e8ecff';
      else if (d === 2) color = '#a8b4e8';
      else if (d === 3) color = '#10142c';
      if (color) c.set(fx + i, fy + j, color);
    }
  }
  // Scroll arrows inside the frame area.
  const arrow = (x: number, y: number, up: boolean) => {
    for (let r = 0; r < 5; r++) {
      const half = up ? r : 4 - r;
      c.hline(x + 6 - half, x + 5 + half, y + r, '#ffffff');
    }
    c.hline(x + 1, x + 10, y + (up ? 5 : 0), withAlpha('#10142c', 0.6));
  };
  arrow(66, 12, true);
  arrow(66, 36, false);
  // Cursor.
  c.fillRoundRect(48, 48, 24, 24, 2, withAlpha('#ffffff', 0.22));
  c.strokeRect(49, 48, 22, 1, '#ffffff');
  c.strokeRect(49, 71, 22, 1, '#ffffff');
  c.vline(48, 49, 70, '#ffffff');
  c.vline(71, 49, 70, '#ffffff');
  c.hline(50, 69, 49, withAlpha('#ffffff', 0.5));
  // Pause sign: a small down-pointing triangle that bounces over 4 frames.
  for (let f = 0; f < 4; f++) {
    const ox = 72 + (f % 2) * 12;
    const oy = 48 + Math.floor(f / 2) * 12 + [0, 1, 2, 1][f]!;
    for (let r = 0; r < 4; r++) c.hline(ox + 2 + r, ox + 9 - r, oy + 3 + r, r === 0 ? '#ffe680' : '#ffffff');
    c.hline(ox + 2, ox + 9, oy + 2, OUTLINE);
  }
  // Text colour palette.
  TEXT_COLORS.forEach((color, n) => c.fillRect(48 + (n % 8) * 6, 72 + Math.floor(n / 8) * 6, 6, 6, color));
  return c;
}

// ---------------------------------------------------------------------------
// Icons (16 × 16 logical each, drawn at scale 2 → 32 px)
// ---------------------------------------------------------------------------

type IconPainter = (s: PixelCanvas) => void;

function potion(r: Ramp): IconPainter {
  return (s) => {
    s.fillRect(6, 1, 4, 2, RAMPS.wood[2]);
    s.fillRect(6, 3, 4, 3, withAlpha('#e0f0ff', 0.9));
    shadedBlob(s, 3, 5, 10, 10, r);
    s.set(5, 8, '#ffffff');
    s.set(5, 9, '#ffffff');
  };
}

function blade(metal: Ramp, hilt: Ramp): IconPainter {
  return (s) => {
    for (let i = 0; i < 9; i++) {
      s.set(5 + i, 10 - i, metal[3]);
      s.set(6 + i, 10 - i, metal[2]);
      s.set(6 + i, 11 - i, metal[1]);
    }
    s.line(2, 10, 6, 14, hilt[2]);
    s.line(3, 13, 1, 15, RAMPS.wood[1]);
    s.set(2, 14, RAMPS.wood[2]);
  };
}

function orb(r: Ramp, glyph?: (s: PixelCanvas) => void): IconPainter {
  return (s) => {
    shadedBlob(s, 1, 1, 14, 14, r);
    glyph?.(s);
  };
}

function badge(bg: Ramp, glyph: (s: PixelCanvas) => void): IconPainter {
  return (s) => {
    s.fillRoundRect(1, 1, 14, 14, 3, bg[2]);
    s.hline(3, 12, 1, bg[3]);
    s.hline(3, 12, 14, bg[0]);
    glyph(s);
  };
}

const W = '#ffffff';

/** Painter of each named icon. */
const ICONS: Partial<Record<IconName, IconPainter>> = {
  bag: (s) => {
    shadedBlob(s, 2, 4, 12, 11, RAMPS.roofBrown);
    s.fillRect(5, 2, 6, 3, RAMPS.roofBrown[1]);
    s.hline(4, 11, 5, RAMPS.roofBrown[0]);
    s.fillRect(7, 7, 2, 2, RAMPS.gold[3]);
  },
  character: (s) => {
    shadedBlob(s, 5, 1, 6, 6, RAMPS.plaster);
    s.fillRoundRect(3, 8, 10, 7, 2, RAMPS.roofBlue[2]);
    s.hline(4, 11, 8, RAMPS.roofBlue[3]);
  },
  skills: (s) => {
    for (let r = 0; r < 7; r++) {
      s.hline(8 - r, 7 + r, 1 + r, RAMPS.gold[r < 2 ? 3 : 2]);
      s.hline(8 - r, 7 + r, 14 - r, RAMPS.gold[1]);
    }
    s.fillRect(1, 7, 14, 2, RAMPS.gold[2]);
    s.set(7, 5, W);
  },
  quests: (s) => {
    s.fillRect(3, 2, 10, 12, RAMPS.plaster[3]);
    s.fillRect(2, 1, 12, 2, RAMPS.thatch[2]);
    s.fillRect(2, 13, 12, 2, RAMPS.thatch[2]);
    for (let y = 5; y < 12; y += 2) s.hline(5, 10, y, RAMPS.plaster[0]);
  },
  friends: (s) => {
    shadedBlob(s, 2, 2, 5, 5, RAMPS.plaster);
    s.fillRoundRect(1, 8, 7, 6, 2, RAMPS.roofGreen[2]);
    shadedBlob(s, 9, 3, 5, 5, RAMPS.plaster);
    s.fillRoundRect(8, 9, 7, 6, 2, RAMPS.roofRed[2]);
  },
  guild: (s) => {
    s.fillRect(3, 2, 10, 7, RAMPS.roofBlue[2]);
    for (let r = 0; r < 6; r++) s.hline(3 + r, 12 - r, 9 + r, RAMPS.roofBlue[2]);
    s.vline(3, 2, 9, RAMPS.roofBlue[3]);
    s.fillRect(7, 4, 2, 7, RAMPS.gold[3]);
    s.fillRect(5, 6, 6, 2, RAMPS.gold[3]);
  },
  party: (s) => {
    blade(RAMPS.silver, RAMPS.gold)(s);
    const t = new PixelCanvas(16, 16);
    blade(RAMPS.silver, RAMPS.gold)(t);
    s.blit(t, 0, 0, { flipX: true });
  },
  map: (s) => {
    s.fillRect(1, 3, 14, 11, RAMPS.sand[2]);
    s.vline(5, 3, 13, RAMPS.sand[1]);
    s.vline(10, 3, 13, RAMPS.sand[1]);
    s.fillEllipse(6, 6, 4, 3, RAMPS.grass[2]);
    s.set(11, 9, RAMPS.flowerRed[2]);
    s.set(12, 10, RAMPS.flowerRed[2]);
  },
  options: (s) => {
    s.fillEllipse(2, 2, 12, 12, RAMPS.iron[2]);
    for (const [x, y] of [[7, 0], [7, 14], [0, 7], [14, 7], [2, 2], [12, 2], [2, 12], [12, 12]] as const) s.fillRect(x, y, 2, 2, RAMPS.iron[2]);
    s.fillEllipse(5, 5, 6, 6, RAMPS.iron[0]);
    s.fillEllipse(6, 6, 4, 4, RAMPS.iron[3]);
  },
  admin: (s) => {
    // Crown.
    s.fillRect(2, 8, 12, 5, RAMPS.gold[2]);
    for (const x of [2, 7, 12]) {
      s.fillRect(x, 3, 2, 5, RAMPS.gold[2]);
      s.set(x, 2, RAMPS.gold[3]);
    }
    s.line(4, 7, 6, 5, RAMPS.gold[2]);
    s.line(9, 5, 11, 7, RAMPS.gold[2]);
    s.hline(2, 13, 13, RAMPS.gold[1]);
    s.set(5, 10, RAMPS.flowerRed[2]);
    s.set(8, 10, RAMPS.flowerBlue[2]);
    s.set(11, 10, RAMPS.roofGreen[3]);
  },
  chat: (s) => {
    s.fillRoundRect(1, 2, 14, 10, 3, RAMPS.flowerWhite[3]);
    s.line(4, 11, 3, 14, RAMPS.flowerWhite[3]);
    s.line(5, 11, 4, 14, RAMPS.flowerWhite[2]);
    for (const x of [4, 7, 10]) s.fillRect(x, 6, 2, 2, RAMPS.uiBlue[2]);
  },
  close: (s) => {
    s.line(3, 3, 12, 12, W);
    s.line(4, 3, 12, 11, W);
    s.line(12, 3, 3, 12, W);
    s.line(11, 3, 3, 11, W);
  },
  fullscreen: (s) => {
    for (const [x, y, dx, dy] of [[1, 1, 1, 1], [14, 1, -1, 1], [1, 14, 1, -1], [14, 14, -1, -1]] as const) {
      s.hline(x, x + dx * 4, y, W);
      s.vline(x, y, y + dy * 4, W);
      s.hline(x, x + dx * 4, y + dy, W);
      s.vline(x + dx, y, y + dy * 4, W);
    }
  },
  fullscreen_exit: (s) => {
    for (const [x, y, dx, dy] of [[5, 5, -1, -1], [10, 5, 1, -1], [5, 10, -1, 1], [10, 10, 1, 1]] as const) {
      s.hline(x, x + dx * 4, y, W);
      s.vline(x, y, y + dy * 4, W);
      s.hline(x, x + dx * 4, y - dy, W);
      s.vline(x - dx, y, y + dy * 4, W);
    }
  },
  menu: (s) => {
    for (const y of [3, 7, 11]) s.fillRect(2, y, 12, 2, W);
  },
  gold: (s) => {
    shadedBlob(s, 2, 2, 12, 12, RAMPS.gold);
    s.fillEllipse(5, 5, 6, 6, RAMPS.gold[1]);
    s.vline(8, 5, 10, RAMPS.gold[3]);
  },
  hp: orb(RAMPS.flowerRed, (s) => {
    s.fillRect(7, 4, 2, 8, W);
    s.fillRect(4, 7, 8, 2, W);
  }),
  mp: orb(RAMPS.flowerBlue, (s) => {
    for (let r = 0; r < 4; r++) s.hline(8 - r, 7 + r, 4 + r * 2, W);
    s.hline(5, 10, 11, W);
  }),
  xp: orb(RAMPS.roofGreen, (s) => {
    s.line(4, 4, 11, 11, W);
    s.line(11, 4, 4, 11, W);
  }),
  star: (s) => {
    const pts = [[8, 1], [10, 6], [15, 6], [11, 9], [13, 14], [8, 11], [3, 14], [5, 9], [1, 6], [6, 6]] as const;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (inPolygon(x + 0.5, y + 0.5, pts)) s.set(x, y, y < 7 ? RAMPS.gold[3] : RAMPS.gold[2]);
  },
  heart: (s) => {
    s.fillEllipse(1, 2, 8, 8, RAMPS.flowerRed[2]);
    s.fillEllipse(7, 2, 8, 8, RAMPS.flowerRed[2]);
    for (let r = 0; r < 7; r++) s.hline(1 + r, 14 - r, 7 + r, RAMPS.flowerRed[2]);
    s.set(4, 4, W);
  },
  trade: (s) => {
    s.line(2, 5, 13, 5, W);
    s.line(10, 2, 13, 5, W);
    s.line(13, 10, 2, 10, RAMPS.gold[3]);
    s.line(5, 13, 2, 10, RAMPS.gold[3]);
  },
  mail: (s) => {
    s.fillRect(1, 3, 14, 10, RAMPS.plaster[3]);
    s.line(1, 3, 8, 9, RAMPS.plaster[0]);
    s.line(14, 3, 8, 9, RAMPS.plaster[0]);
  },
  bell: (s) => {
    shadedBlob(s, 3, 2, 10, 11, RAMPS.gold);
    s.fillRect(3, 9, 10, 3, RAMPS.gold[2]);
    s.hline(2, 13, 12, RAMPS.gold[1]);
    s.fillRect(7, 13, 2, 2, RAMPS.gold[3]);
  },
  lock: (s) => {
    s.strokeRect(4, 2, 8, 7, RAMPS.iron[3]);
    s.fillRect(2, 7, 12, 8, RAMPS.gold[2]);
    s.fillRect(7, 10, 2, 3, OUTLINE);
  },
  unlock: (s) => {
    s.strokeRect(8, 1, 7, 7, RAMPS.iron[3]);
    s.fillRect(1, 7, 12, 8, RAMPS.gold[2]);
    s.fillRect(6, 10, 2, 3, OUTLINE);
  },
  check: (s) => {
    s.line(2, 8, 6, 12, RAMPS.roofGreen[3]);
    s.line(2, 9, 6, 13, RAMPS.roofGreen[3]);
    s.line(6, 12, 13, 3, RAMPS.roofGreen[3]);
    s.line(6, 13, 14, 4, RAMPS.roofGreen[3]);
  },
  cross: (s) => {
    s.line(3, 3, 12, 12, RAMPS.flowerRed[2]);
    s.line(4, 3, 13, 12, RAMPS.flowerRed[2]);
    s.line(12, 3, 3, 12, RAMPS.flowerRed[2]);
    s.line(13, 3, 4, 12, RAMPS.flowerRed[2]);
  },
  arrow_up: (s) => {
    for (let r = 0; r < 6; r++) s.hline(8 - r, 7 + r, 2 + r, RAMPS.roofGreen[3]);
    s.fillRect(6, 8, 4, 6, RAMPS.roofGreen[3]);
  },
  arrow_down: (s) => {
    for (let r = 0; r < 6; r++) s.hline(8 - r, 7 + r, 13 - r, RAMPS.flowerRed[2]);
    s.fillRect(6, 2, 4, 6, RAMPS.flowerRed[2]);
  },
  info: orb(RAMPS.roofBlue, (s) => {
    s.fillRect(7, 3, 2, 2, W);
    s.fillRect(7, 6, 2, 7, W);
  }),
  potion_red: potion(RAMPS.flowerRed),
  potion_blue: potion(RAMPS.flowerBlue),
  potion_green: potion(RAMPS.roofGreen),
  elixir: potion(RAMPS.gold),
  herb: (s) => {
    s.line(8, 15, 8, 5, RAMPS.grass[0]);
    shadedBlob(s, 2, 3, 6, 5, RAMPS.grass);
    shadedBlob(s, 8, 1, 6, 5, RAMPS.grass);
    shadedBlob(s, 5, 7, 6, 5, RAMPS.grass);
  },
  bread: (s) => {
    shadedBlob(s, 1, 4, 14, 9, RAMPS.path);
    for (const x of [4, 7, 10]) s.line(x, 6, x + 2, 9, RAMPS.path[0]);
  },
  apple: (s) => {
    shadedBlob(s, 2, 4, 12, 11, RAMPS.flowerRed);
    s.vline(8, 1, 4, RAMPS.wood[1]);
    s.fillRect(9, 2, 3, 2, RAMPS.grass[2]);
  },
  meat: (s) => {
    shadedBlob(s, 2, 2, 10, 10, RAMPS.brick);
    s.line(10, 10, 14, 14, RAMPS.flowerWhite[3]);
    s.fillRect(13, 12, 2, 2, RAMPS.flowerWhite[3]);
  },
  key: (s) => {
    s.fillEllipse(1, 2, 7, 7, RAMPS.gold[2]);
    s.fillEllipse(3, 4, 3, 3, OUTLINE);
    s.line(7, 7, 14, 14, RAMPS.gold[2]);
    s.line(7, 8, 13, 14, RAMPS.gold[1]);
    s.fillRect(11, 12, 2, 2, RAMPS.gold[2]);
  },
  scroll: (s) => {
    s.fillRect(3, 3, 10, 10, RAMPS.plaster[3]);
    s.fillEllipse(1, 1, 4, 14, RAMPS.plaster[2]);
    s.fillEllipse(11, 1, 4, 14, RAMPS.plaster[1]);
    s.hline(5, 10, 6, RAMPS.plaster[0]);
    s.hline(5, 10, 9, RAMPS.plaster[0]);
  },
  book: (s) => {
    s.fillRect(3, 1, 11, 14, RAMPS.roofRed[2]);
    s.vline(3, 1, 14, RAMPS.roofRed[0]);
    s.fillRect(4, 13, 10, 2, RAMPS.plaster[3]);
    s.fillRect(7, 4, 4, 4, RAMPS.gold[3]);
  },
  gem: (s) => {
    for (let r = 0; r < 4; r++) s.hline(5 - r, 10 + r, 3 + r, RAMPS.flowerBlue[3]);
    for (let r = 0; r < 7; r++) s.hline(2 + r, 13 - r, 7 + r, RAMPS.flowerBlue[r < 3 ? 2 : 1]);
    s.set(5, 4, W);
  },
  ore: (s) => shadedBlob(s, 1, 4, 14, 10, RAMPS.iron),
  feather: (s) => {
    s.line(3, 14, 12, 2, RAMPS.flowerWhite[1]);
    for (let i = 0; i < 8; i++) {
      s.line(4 + i, 12 - i, 2 + i, 9 - i, RAMPS.flowerWhite[3]);
      s.line(5 + i, 13 - i, 8 + i, 12 - i, RAMPS.flowerWhite[2]);
    }
  },
  bone: (s) => {
    s.line(4, 11, 11, 4, RAMPS.flowerWhite[3]);
    s.line(5, 11, 11, 5, RAMPS.flowerWhite[2]);
    for (const [x, y] of [[2, 10], [4, 12], [10, 2], [12, 4]] as const) s.fillRect(x, y, 2, 2, RAMPS.flowerWhite[3]);
  },
  letter: (s) => {
    s.fillRect(1, 4, 14, 9, RAMPS.plaster[3]);
    s.line(1, 4, 8, 9, RAMPS.plaster[1]);
    s.line(14, 4, 8, 9, RAMPS.plaster[1]);
    s.fillRect(7, 8, 3, 3, RAMPS.flowerRed[2]);
  },
  sword: blade(RAMPS.silver, RAMPS.gold),
  axe: (s) => {
    s.line(3, 14, 11, 4, RAMPS.wood[2]);
    shadedBlob(s, 8, 1, 7, 9, RAMPS.silver);
  },
  spear: (s) => {
    s.line(2, 14, 11, 5, RAMPS.wood[2]);
    for (let r = 0; r < 4; r++) s.line(10 + r, 5 - r, 12 + r / 2, 3 - r, RAMPS.silver[3]);
    s.fillRect(11, 2, 3, 3, RAMPS.silver[2]);
  },
  bow: (s) => {
    for (let i = 0; i < 12; i++) s.set(4 + Math.round(Math.sin((i / 11) * Math.PI) * 5), 2 + i, RAMPS.wood[2]);
    s.vline(4, 2, 13, RAMPS.flowerWhite[3]);
  },
  staff: (s) => {
    s.line(3, 14, 10, 7, RAMPS.wood[2]);
    shadedBlob(s, 9, 1, 6, 6, RAMPS.flowerBlue);
  },
  dagger: (s) => {
    s.line(6, 9, 12, 3, RAMPS.silver[3]);
    s.line(7, 9, 12, 4, RAMPS.silver[1]);
    s.line(3, 8, 7, 12, RAMPS.gold[2]);
    s.line(4, 12, 2, 14, RAMPS.wood[1]);
  },
  mace: (s) => {
    s.line(3, 14, 9, 8, RAMPS.wood[2]);
    shadedBlob(s, 8, 2, 7, 7, RAMPS.iron);
    for (const [x, y] of [[11, 1], [14, 5], [7, 5], [11, 9]] as const) s.set(x, y, RAMPS.iron[3]);
  },
  wand: (s) => {
    s.line(3, 13, 10, 6, RAMPS.plaster[3]);
    s.fillRect(10, 2, 4, 4, RAMPS.gold[3]);
    s.set(12, 1, RAMPS.gold[3]);
    s.set(14, 4, RAMPS.gold[3]);
  },
  shield: (s) => {
    s.fillRect(3, 2, 10, 7, RAMPS.roofBlue[2]);
    for (let r = 0; r < 6; r++) s.hline(3 + r, 12 - r, 9 + r, RAMPS.roofBlue[1]);
    s.strokeRect(3, 2, 10, 7, RAMPS.silver[3]);
    s.fillRect(7, 4, 2, 8, RAMPS.gold[3]);
  },
  helmet: (s) => {
    s.fillRoundRect(2, 3, 12, 11, 4, RAMPS.silver[2]);
    s.hline(4, 11, 3, RAMPS.silver[3]);
    s.fillRect(4, 8, 8, 2, OUTLINE);
    s.vline(8, 8, 13, RAMPS.silver[1]);
  },
  armor: (s) => {
    s.fillRect(3, 3, 10, 11, RAMPS.silver[2]);
    s.fillRect(1, 3, 3, 4, RAMPS.silver[3]);
    s.fillRect(12, 3, 3, 4, RAMPS.silver[1]);
    s.fillRect(6, 2, 4, 2, OUTLINE);
    s.hline(3, 12, 9, RAMPS.silver[0]);
  },
  robe: (s) => {
    for (let y = 2; y < 15; y++) {
      const half = 3 + Math.floor((y - 2) / 3);
      s.hline(8 - half, 7 + half, y, RAMPS.cloth[2]);
    }
    s.vline(8, 3, 14, RAMPS.gold[3]);
  },
  boots: (s) => {
    s.fillRect(3, 2, 5, 9, RAMPS.roofBrown[2]);
    s.fillRect(3, 10, 9, 4, RAMPS.roofBrown[2]);
    s.hline(3, 11, 13, RAMPS.roofBrown[0]);
    s.hline(3, 7, 4, RAMPS.roofBrown[3]);
  },
  gloves: (s) => {
    s.fillRoundRect(3, 4, 9, 9, 2, RAMPS.roofBrown[2]);
    for (const x of [3, 5, 7, 9]) s.fillRect(x, 1, 2, 4, RAMPS.roofBrown[2]);
    s.fillRect(11, 6, 3, 3, RAMPS.roofBrown[1]);
  },
  ring: (s) => {
    s.fillEllipse(3, 5, 10, 10, RAMPS.gold[2]);
    s.fillEllipse(5, 7, 6, 6, null);
    s.fillRect(6, 2, 4, 4, RAMPS.flowerRed[2]);
  },
  amulet: (s) => {
    s.line(3, 1, 7, 8, RAMPS.gold[1]);
    s.line(12, 1, 8, 8, RAMPS.gold[1]);
    shadedBlob(s, 5, 8, 6, 7, RAMPS.flowerBlue);
  },
  fire: orb(RAMPS.fire),
  ice: orb(RAMPS.ice, (s) => {
    s.vline(8, 3, 12, W);
    s.line(4, 5, 11, 10, W);
    s.line(11, 5, 4, 10, W);
  }),
  thunder: orb(RAMPS.gold, (s) => {
    s.line(9, 2, 5, 8, OUTLINE);
    s.line(5, 8, 10, 8, OUTLINE);
    s.line(10, 8, 6, 14, OUTLINE);
  }),
  heal: orb(RAMPS.roofGreen, (s) => {
    s.fillRect(7, 4, 2, 8, W);
    s.fillRect(4, 7, 8, 2, W);
  }),
  wind: orb(RAMPS.grass, (s) => {
    s.hline(3, 10, 5, W);
    s.hline(5, 12, 8, W);
    s.hline(3, 9, 11, W);
  }),
  earth: orb(RAMPS.dirt, (s) => shadedBlob(s, 5, 5, 6, 6, RAMPS.rock)),
  holy: orb(RAMPS.flowerYellow, (s) => {
    s.fillRect(7, 3, 2, 10, W);
    s.fillRect(4, 6, 8, 2, W);
  }),
  dark: orb(RAMPS.poison, (s) => shadedBlob(s, 5, 5, 6, 6, RAMPS.dark)),
  slash: badge(RAMPS.iron, (s) => {
    s.line(3, 12, 12, 3, W);
    s.line(4, 12, 12, 4, RAMPS.silver[2]);
  }),
  arrow: badge(RAMPS.roofBrown, (s) => {
    s.line(3, 12, 12, 3, RAMPS.flowerWhite[3]);
    s.fillRect(10, 3, 3, 3, RAMPS.silver[3]);
  }),
  shield_up: badge(RAMPS.roofBlue, (s) => ICONS.arrow_up!(s)),
  sword_up: badge(RAMPS.roofRed, (s) => ICONS.arrow_up!(s)),
  speed: badge(RAMPS.roofGreen, (s) => {
    s.line(4, 3, 9, 8, W);
    s.line(9, 8, 4, 13, W);
    s.line(8, 3, 13, 8, W);
    s.line(13, 8, 8, 13, W);
  }),
  teleport: orb(RAMPS.cloth, (s) => {
    s.strokeRect(4, 4, 8, 8, W);
    s.set(8, 8, W);
  }),
  revive: badge(RAMPS.gold, (s) => ICONS.heart!(s)),
  aura: orb(RAMPS.flowerYellow),
  poison: badge(RAMPS.poison, (s) => {
    shadedBlob(s, 4, 3, 8, 7, RAMPS.flowerWhite);
    s.set(6, 6, OUTLINE);
    s.set(9, 6, OUTLINE);
    s.line(4, 12, 11, 12, RAMPS.flowerWhite[3]);
  }),
  sleep: badge(RAMPS.uiBlue, (s) => {
    s.hline(4, 9, 4, W);
    s.line(9, 4, 4, 9, W);
    s.hline(4, 9, 9, W);
    s.hline(9, 12, 10, W);
    s.line(12, 10, 9, 13, W);
    s.hline(9, 12, 13, W);
  }),
  stun: badge(RAMPS.gold, (s) => {
    for (const [x, y] of [[4, 5], [11, 5], [8, 11]] as const) {
      s.set(x, y, W);
      s.set(x - 1, y, W);
      s.set(x + 1, y, W);
      s.set(x, y - 1, W);
      s.set(x, y + 1, W);
    }
  }),
  blind: badge(RAMPS.dark, (s) => {
    s.fillEllipse(3, 5, 10, 6, W);
    s.fillEllipse(6, 6, 4, 4, OUTLINE);
    s.line(2, 13, 13, 2, RAMPS.flowerRed[2]);
  }),
  silence: badge(RAMPS.stone, (s) => {
    s.fillRect(3, 7, 10, 2, W);
  }),
  atk_up: badge(RAMPS.roofRed, (s) => ICONS.arrow_up!(s)),
  def_up: badge(RAMPS.roofBlue, (s) => ICONS.arrow_up!(s)),
  atk_down: badge(RAMPS.roofRed, (s) => ICONS.arrow_down!(s)),
  def_down: badge(RAMPS.roofBlue, (s) => ICONS.arrow_down!(s)),
  regen: badge(RAMPS.roofGreen, (s) => ICONS.heal!(s)),
  burn: badge(RAMPS.fire, (s) => shadedBlob(s, 5, 4, 6, 9, RAMPS.fire)),
  freeze: badge(RAMPS.ice, (s) => ICONS.ice!(s)),
  confuse: badge(RAMPS.cloth, (s) => {
    s.strokeRect(5, 3, 6, 4, W);
    s.vline(10, 7, 9, W);
    s.fillRect(7, 11, 2, 2, W);
  }),
  berserk: badge(RAMPS.flowerRed, (s) => {
    s.line(3, 4, 7, 7, W);
    s.line(12, 4, 8, 7, W);
    s.hline(5, 10, 11, W);
  }),
  invisible: badge(RAMPS.stone, (s) => s.strokeRect(4, 4, 8, 8, withAlpha('#ffffff', 0.5))),
  dead: badge(RAMPS.dark, (s) => ICONS.bone!(s)),
};

function inPolygon(x: number, y: number, pts: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Builds the icon sheet (16 columns, rows as needed). */
export function iconSet(): PixelCanvas {
  const rows = Math.ceil(ICON_NAMES.length / 16);
  const sheet = new PixelCanvas(16 * 16, rows * 16);
  ICON_NAMES.forEach((name, index) => {
    const paint = ICONS[name];
    if (!paint) return;
    const s = new PixelCanvas(16, 16);
    paint(s);
    s.outline(OUTLINE);
    sheet.blit(s, (index % 16) * 16, Math.floor(index / 16) * 16);
  });
  return sheet;
}

// ---------------------------------------------------------------------------
// Balloons, shadow, mobile controls, app icon
// ---------------------------------------------------------------------------

/**
 * Emotion balloons: 10 rows (exclamation, question, music, heart, anger,
 * sweat, frustration, silence, idea, sleep) × 8 frames of 24 × 24 logical.
 * Frames 0–1 pop the bubble in, frames 2–7 show the symbol with a small bounce.
 */
export function balloons(): PixelCanvas {
  const sheet = new PixelCanvas(8 * 24, 10 * 24);
  const symbols: ((s: PixelCanvas, dy: number) => void)[] = [
    (s, dy) => {
      s.fillRect(11, 5 + dy, 3, 7, RAMPS.flowerRed[2]);
      s.fillRect(11, 13 + dy, 3, 2, RAMPS.flowerRed[2]);
    },
    (s, dy) => {
      s.strokeRect(9, 5 + dy, 6, 4, RAMPS.roofBlue[2]);
      s.fillRect(9, 9 + dy, 2, 1, null);
      s.fillRect(12, 9 + dy, 2, 3, RAMPS.roofBlue[2]);
      s.fillRect(12, 13 + dy, 2, 2, RAMPS.roofBlue[2]);
    },
    (s, dy) => {
      s.vline(14, 5 + dy, 12 + dy, OUTLINE);
      s.fillEllipse(10, 11 + dy, 5, 4, OUTLINE);
      s.hline(14, 16, 5 + dy, OUTLINE);
    },
    (s, dy) => {
      s.fillEllipse(7, 6 + dy, 6, 6, RAMPS.flowerRed[2]);
      s.fillEllipse(12, 6 + dy, 6, 6, RAMPS.flowerRed[2]);
      for (let r = 0; r < 5; r++) s.hline(7 + r, 17 - r, 10 + r + dy, RAMPS.flowerRed[2]);
    },
    (s, dy) => {
      for (const [x, y] of [[8, 6], [14, 6], [8, 12], [14, 12]] as const) {
        s.hline(x, x + 2, y + dy + 1, RAMPS.flowerRed[2]);
        s.vline(x + 1, y + dy, y + dy + 2, RAMPS.flowerRed[2]);
      }
    },
    (s, dy) => {
      shadedBlob(s, 10, 7 + dy, 5, 7, RAMPS.flowerBlue);
      s.set(12, 6 + dy, RAMPS.flowerBlue[2]);
    },
    (s, dy) => {
      for (let i = 0; i < 3; i++) s.line(7 + i * 4, 6 + dy, 9 + i * 4, 14 + dy, OUTLINE);
    },
    (s, dy) => {
      for (const x of [7, 11, 15]) s.fillRect(x, 10 + dy, 2, 2, OUTLINE);
    },
    (s, dy) => {
      shadedBlob(s, 8, 4 + dy, 8, 8, RAMPS.flowerYellow);
      s.fillRect(10, 12 + dy, 4, 3, RAMPS.iron[2]);
    },
    (s, dy) => {
      s.hline(8, 12, 6 + dy, RAMPS.uiBlue[2]);
      s.line(12, 6 + dy, 8, 10 + dy, RAMPS.uiBlue[2]);
      s.hline(8, 12, 10 + dy, RAMPS.uiBlue[2]);
      s.hline(13, 16, 11 + dy, RAMPS.uiBlue[3]);
      s.line(16, 11 + dy, 13, 14 + dy, RAMPS.uiBlue[3]);
      s.hline(13, 16, 14 + dy, RAMPS.uiBlue[3]);
    },
  ];
  symbols.forEach((symbol, row) => {
    for (let f = 0; f < 8; f++) {
      const s = new PixelCanvas(24, 24);
      const size = f === 0 ? 10 : f === 1 ? 16 : 20;
      const off = Math.floor((24 - size) / 2);
      s.fillRoundRect(off, off - 1, size, size - 2, 4, '#ffffff');
      // Tail pointing down-left towards the speaker.
      if (f >= 2) {
        s.set(7, 20, '#ffffff');
        s.set(6, 21, '#ffffff');
        s.set(8, 20, '#ffffff');
      }
      if (f >= 2) symbol(s, f % 3 === 0 ? -1 : 0);
      s.outline(OUTLINE);
      sheet.blit(s, f * 24, row * 24);
    }
  });
  return sheet;
}

/** Soft ellipse drawn under characters (one tile wide). */
export function characterShadow(): PixelCanvas {
  const s = new PixelCanvas(16, 8);
  s.fillEllipse(1, 1, 14, 6, '#00000040');
  s.fillEllipse(3, 2, 10, 4, '#00000040');
  return s;
}

/** Virtual joystick: base ring (64 × 64 logical) and knob (28 × 28), side by side. */
export function joystick(): PixelCanvas {
  const s = new PixelCanvas(96, 64);
  s.fillEllipse(0, 0, 64, 64, withAlpha('#0c1640', 0.45));
  s.fillEllipse(2, 2, 60, 60, withAlpha('#2a4a9a', 0.35));
  s.fillEllipse(8, 8, 48, 48, withAlpha('#0c1640', 0.25));
  for (const [x, y, up, horiz] of [[29, 5, true, false], [29, 53, false, false], [5, 29, true, true], [53, 29, false, true]] as const) {
    for (let r = 0; r < 4; r++) {
      if (horiz) s.vline(x + (up ? r : 3 - r), y + 3 - r, y + 3 + r, withAlpha('#ffffff', 0.7));
      else s.hline(x + 3 - r, x + 3 + r, y + (up ? r : 3 - r), withAlpha('#ffffff', 0.7));
    }
  }
  s.fillEllipse(66, 18, 28, 28, withAlpha('#e8ecff', 0.85));
  s.fillEllipse(69, 21, 22, 22, withAlpha('#4c74cc', 0.9));
  s.fillEllipse(72, 23, 10, 8, withAlpha('#ffffff', 0.5));
  return s;
}

/** Action (A) and cancel (B) buttons, 40 × 40 logical each, side by side. */
export function actionButtons(): PixelCanvas {
  const s = new PixelCanvas(80, 40);
  const glyphA = ['..##..', '.#..#.', '#....#', '######', '#....#', '#....#'];
  const glyphB = ['#####.', '#....#', '#####.', '#....#', '#....#', '#####.'];
  [
    { x: 0, ramp: RAMPS.roofRed, glyph: glyphA },
    { x: 40, ramp: RAMPS.roofBlue, glyph: glyphB },
  ].forEach(({ x, ramp, glyph }) => {
    s.fillEllipse(x, 0, 40, 40, withAlpha(ramp[0], 0.85));
    s.fillEllipse(x + 2, 2, 36, 36, withAlpha(ramp[2], 0.85));
    s.fillEllipse(x + 6, 4, 22, 14, withAlpha('#ffffff', 0.25));
    glyph.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') s.fillRect(x + 14 + i * 2, 14 + j * 2, 2, 2, '#ffffff');
    });
  });
  return s;
}

/** Application icon (home screen / PWA): a sword crossing a shield on the window blue. */
export function appIcon(): PixelCanvas {
  const s = new PixelCanvas(32, 32);
  s.fillRoundRect(0, 0, 32, 32, 6, '#16286e');
  s.fillRoundRect(2, 2, 28, 28, 5, '#2a4a9a');
  const shield = new PixelCanvas(16, 16);
  ICONS.shield!(shield);
  shield.outline(OUTLINE);
  const sword = new PixelCanvas(16, 16);
  ICONS.sword!(sword);
  sword.outline(OUTLINE);
  // Upscale the 16 px icons by 2 into the 32 px canvas.
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const c1 = shield.get(x, y);
      if (c1) s.fillRect(x * 2 - 2, y * 2 + 1, 2, 2, c1);
      const c2 = sword.get(x, y);
      if (c2) s.fillRect(x * 2 + 2, y * 2 - 1, 2, 2, c2);
    }
  }
  return s;
}

/** Returns every generated system graphic, with its fixed scale. */
export function systemSheets(): GeneratedImage[] {
  return [
    { path: 'system/Window', canvas: windowSkin(), scale: 2 },
    { path: 'system/IconSet', canvas: iconSet(), scale: 2 },
    { path: 'system/Balloon', canvas: balloons(), scale: 2 },
    { path: 'system/Shadow1', canvas: characterShadow() },
    { path: 'system/Joystick', canvas: joystick(), scale: 2 },
    { path: 'system/ActionButtons', canvas: actionButtons(), scale: 2 },
    { path: 'system/AppIcon', canvas: appIcon(), scale: 16 },
  ];
}
