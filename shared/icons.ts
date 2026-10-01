/**
 * @file Named indices into the icon sheet (`system/IconSet`).
 *
 * The icon sheet is a grid of 32 × 32 px icons, 16 per row; an icon index `n`
 * is at column `n % 16`, row `floor(n / 16)`. Creators may replace the sheet
 * with their own as long as they keep the grid; database entries (items,
 * skills, states) store plain indices, while the interface uses these names.
 */

/** Icon size in pixels. */
export const ICON_SIZE = 32;
/** Icons per row. */
export const ICON_COLUMNS = 16;

/** Icon names in sheet order. Index 0 is intentionally empty ("no icon"). */
export const ICON_NAMES = [
  // Row 0: interface
  'none', 'bag', 'character', 'skills', 'quests', 'friends', 'guild', 'party',
  'map', 'options', 'admin', 'chat', 'close', 'fullscreen', 'fullscreen_exit', 'menu',
  // Row 1: resources and misc
  'gold', 'hp', 'mp', 'xp', 'star', 'heart', 'trade', 'mail',
  'bell', 'lock', 'unlock', 'check', 'cross', 'arrow_up', 'arrow_down', 'info',
  // Row 2: consumables and key items
  'potion_red', 'potion_blue', 'potion_green', 'elixir', 'herb', 'bread', 'apple', 'meat',
  'key', 'scroll', 'book', 'gem', 'ore', 'feather', 'bone', 'letter',
  // Row 3: weapons
  'sword', 'axe', 'spear', 'bow', 'staff', 'dagger', 'mace', 'wand',
  // Row 3 (right half): armor
  'shield', 'helmet', 'armor', 'robe', 'boots', 'gloves', 'ring', 'amulet',
  // Row 4: skills
  'fire', 'ice', 'thunder', 'heal', 'wind', 'earth', 'holy', 'dark',
  'slash', 'arrow', 'shield_up', 'sword_up', 'speed', 'teleport', 'revive', 'aura',
  // Row 5: states
  'poison', 'sleep', 'stun', 'blind', 'silence', 'atk_up', 'def_up', 'atk_down',
  'def_down', 'regen', 'burn', 'freeze', 'confuse', 'berserk', 'invisible', 'dead',
] as const;

/** An icon name. */
export type IconName = (typeof ICON_NAMES)[number];

/**
 * Index of a named icon.
 * @param name - Icon name.
 */
export function iconIndex(name: IconName): number {
  return ICON_NAMES.indexOf(name);
}
