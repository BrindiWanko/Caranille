/**
 * @file The limited colour palette shared by every generated graphic.
 *
 * Each material is a ramp of four tones, from darkest to lightest:
 * `[0]` deep shadow / inner outline, `[1]` shadow, `[2]` base, `[3]` highlight.
 * Keeping all generators on these ramps is what makes tiles, characters and
 * interface look like they belong to the same game: vivid colours, dark
 * outlines and simple shading, in the spirit of classic 16 px chipsets.
 */

/** Four tones from darkest to lightest. */
export type Ramp = readonly [string, string, string, string];

/** Near-black used for sprite outlines. */
export const OUTLINE = '#1b1424';
/** Soft outline for terrain details. */
export const SOFT_OUTLINE = '#2b2433';
/** Semi-transparent cast shadow. */
export const SHADOW = '#10081a66';
/** Pure white highlight. */
export const WHITE = '#ffffff';

/** Material ramps. */
export const RAMPS = {
  grass: ['#23602c', '#358a33', '#58b33e', '#8fd65a'],
  grassDark: ['#173f24', '#245a2c', '#337a33', '#4f9c3c'],
  leaves: ['#1a4a26', '#2b7032', '#46a03c', '#7dcc52'],
  leavesAutumn: ['#6a2a14', '#a3481c', '#d77a26', '#f2b347'],
  dirt: ['#5a3a22', '#7d5230', '#a6723f', '#c99a5e'],
  path: ['#7a5a36', '#a27b4b', '#c79e66', '#e2c28b'],
  sand: ['#9c7c45', '#c9a25c', '#e6c67c', '#f6e3a6'],
  snow: ['#8a9bb8', '#b7c6de', '#dde7f5', '#ffffff'],
  water: ['#1b4a8c', '#2a6fc0', '#3f95e0', '#8fd0ff'],
  deepWater: ['#10285e', '#173b82', '#2553a8', '#4f86d2'],
  lava: ['#6a1208', '#b22a0c', '#ec5a14', '#ffc23a'],
  swamp: ['#2c3a1c', '#40562a', '#5c7a36', '#86a452'],
  poison: ['#3a1a52', '#5c2a80', '#8a44b0', '#c486e0'],
  ice: ['#4d7fa6', '#78aed0', '#aad6ee', '#e4f6ff'],
  stone: ['#3e3b4a', '#5e5a6c', '#86819a', '#b3aec4'],
  stoneWarm: ['#4a4038', '#6c5e50', '#938370', '#bcae98'],
  cobble: ['#4a4652', '#6e6878', '#948ea0', '#bdb8c8'],
  rock: ['#3a3430', '#5a5048', '#7e7266', '#a89c8e'],
  cliff: ['#4a3626', '#6e5038', '#93704c', '#b8966a'],
  wood: ['#4a2c18', '#6e4424', '#955f33', '#bf8348'],
  woodLight: ['#6e4a26', '#98693a', '#c28f52', '#e3b576'],
  plank: ['#5c3a20', '#83562f', '#aa7542', '#cf9a60'],
  brick: ['#5a2420', '#84372c', '#ad5040', '#cf7a60'],
  plaster: ['#9a8e7c', '#c4b8a2', '#e6dcc6', '#fff8e6'],
  roofRed: ['#5c1a1e', '#8e2a2a', '#c2423a', '#e6725a'],
  roofBlue: ['#1a2a5c', '#28428e', '#3a62c2', '#6a92e6'],
  roofGreen: ['#1a4a2e', '#276a3c', '#3a8e4c', '#66b872'],
  roofBrown: ['#4a2e1a', '#6e4626', '#966236', '#bf8a52'],
  thatch: ['#6a5220', '#957530', '#c29c44', '#e3c46a'],
  carpetRed: ['#5a1428', '#8a1f3a', '#b83450', '#e0627a'],
  carpetBlue: ['#182a5a', '#243e86', '#3458b4', '#5e82dc'],
  carpetGreen: ['#18402a', '#245e3a', '#34804e', '#5aa874'],
  gold: ['#7a4e10', '#b27a18', '#e6b030', '#fff07a'],
  silver: ['#4a5060', '#7a8294', '#aab2c4', '#e6ecf6'],
  iron: ['#34363e', '#50545e', '#747a86', '#a2a8b4'],
  cloth: ['#3a2a5a', '#54408a', '#7460b8', '#a490e0'],
  flowerRed: ['#7a1020', '#c01e34', '#f04a5a', '#ff9aa2'],
  flowerYellow: ['#8a6a08', '#d0a410', '#f6d632', '#fff49a'],
  flowerWhite: ['#8a8aa0', '#c4c4d6', '#ececf6', '#ffffff'],
  flowerBlue: ['#1c2e7a', '#2e4ac0', '#5078f0', '#a0beff'],
  fire: ['#8a1a08', '#e0400c', '#ff9a1a', '#fff27a'],
  dark: ['#0a0810', '#15121e', '#211c2e', '#302a40'],
  uiBlue: ['#0c1640', '#16286e', '#2a4a9a', '#4c74cc'],
  jungle: ['#0c3a1c', '#16602a', '#25893a', '#58c04a'],
  jungleLight: ['#2a5a10', '#4a8a18', '#78b82a', '#b4e050'],
  bamboo: ['#4a5a14', '#6e8a1e', '#9cba32', '#cce06a'],
  mud: ['#3a2616', '#57391f', '#76502c', '#98703e'],
  basalt: ['#1c1a1e', '#2e2a30', '#433d45', '#5e5660'],
  obsidian: ['#0e0a16', '#1e1630', '#34285a', '#6a58a8'],
  magma: ['#3a0c06', '#7a1a08', '#c8400c', '#ff8a1e'],
  sulfur: ['#6a5a08', '#a8920e', '#dcc82a', '#fff27a'],
  coral: ['#7a1e3a', '#c23a5a', '#f06a7a', '#ffb0a8'],
  lagoon: ['#0a5a6e', '#0e8a9a', '#22b8c0', '#8ae8e0'],
  wetSand: ['#6e5630', '#94743e', '#b8955a', '#d6b67a'],
  glow: ['#0e3a5a', '#1a74a0', '#3ac0e0', '#b0f6ff'],
} as const satisfies Record<string, Ramp>;

/** Name of a material ramp. */
export type RampName = keyof typeof RAMPS;

/** Skin tones (character creation). */
export const SKIN_RAMPS: readonly Ramp[] = [
  ['#7a4a38', '#c98a6a', '#f2c0a0', '#ffe2cc'],
  ['#6a3c28', '#b0704c', '#dca070', '#f4c89a'],
  ['#4a2a1c', '#8a5236', '#b8784e', '#dca274'],
  ['#2e1a12', '#5a3420', '#7e4c30', '#a26a46'],
  ['#5a6a3a', '#7e9a4c', '#a6c46a', '#d0e89a'], // goblin-like green, for monsters
  ['#8a8a96', '#b6b6c2', '#dedee8', '#ffffff'], // bone / pale
];

/** Hair colours (character creation). */
export const HAIR_RAMPS: readonly Ramp[] = [
  ['#1a1216', '#2e2228', '#4a3a42', '#6a5a64'], // black
  ['#3a200e', '#5e3618', '#8a5426', '#b27a40'], // brown
  ['#8a5a10', '#c48a1c', '#eec040', '#fff08a'], // blond
  ['#6a140e', '#a8261a', '#dc4a2a', '#ff8a5a'], // red
  ['#6a6a78', '#9a9aa8', '#c8c8d4', '#f4f4fa'], // silver
  ['#18286a', '#2a44a8', '#4a70dc', '#8aaeff'], // blue
  ['#1c5a2a', '#2c8a3e', '#4cbc5a', '#8ee890'], // green
  ['#5a1a5e', '#8e2e94', '#c04ec4', '#ec90ee'], // purple
  ['#8a2a52', '#c44478', '#ee70a2', '#ffb0d0'], // pink
];

/** Outfit colours (character creation). */
export const OUTFIT_RAMPS: readonly Ramp[] = [
  RAMPS.roofRed,
  RAMPS.roofBlue,
  RAMPS.roofGreen,
  RAMPS.cloth,
  RAMPS.roofBrown,
  ['#3a3a44', '#565664', '#7a7a8c', '#a4a4b8'],
  ['#8a8a96', '#b8b8c4', '#e2e2ec', '#ffffff'],
  RAMPS.gold,
];
