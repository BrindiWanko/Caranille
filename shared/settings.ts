/**
 * @file Known engine settings and their default values.
 *
 * These are the values written by the seed on a fresh database and edited later
 * from the editor's "System" and "Terms" tabs. Content-related strings (game
 * title, currency, element names, terms...) are authored freely by the game
 * creator and are displayed as-is; the defaults are sample content.
 */
import type { ParamName } from './database.js';

/** Facing direction using the engine's numeric-keypad convention: 2 down, 4 left, 6 right, 8 up. */
export type Direction = 2 | 4 | 6 | 8;

/** Map position used for new characters and respawns. */
export interface StartPosition {
  mapId: number;
  x: number;
  y: number;
  direction: Direction;
}

/** Names shown to players for basic game notions (content, any language). */
export interface Terms {
  level: string;
  hp: string;
  mp: string;
  xp: string;
  params: Record<ParamName, string>;
}

/**
 * Declaration of a switch or variable (its id is its index + 1).
 * Personal ones are stored per character (story progress of each player);
 * global ones are shared by the whole server (world events).
 */
export interface DataName {
  /** Switches only: stored per instance of an instanced map (shared by its players). */
  instance?: boolean;
  name: string;
  global: boolean;
}

/** Maximum number of declared switches, and of declared variables. */
export const MAX_SWITCHES = 999;

/** Shape of the settings stored in `system_settings`. */
export interface SystemSettings {
  gameTitle: string;
  tileSize: 48 | 32 | 16;
  startPosition: StartPosition;
  currencyName: string;
  maxLevel: number;
  maxPartySize: number;
  /** Largest raid (party turned into a raid). */
  maxRaidSize: number;
  /** Minutes an empty instance is kept before being closed. */
  instanceIdleMinutes: number;
  /** Gold spent to found a guild. */
  guildCreationCost: number;
  /** Element names; index 0 is "no element". */
  elements: string[];
  weaponTypes: string[];
  armorTypes: string[];
  /** Gold given to new characters. */
  startingGold: number;
  /** Parameter points given at each level up (0 = no distribution). */
  statPointsPerLevel: number;
  /** Price paid by shops for an item, in percent of its price. */
  sellRate: number;
  /** Number of different entries a bag can hold. */
  bagSize: number;
  terms: Terms;
  /** Switch declarations (id = index + 1). Undeclared ids are personal. */
  switches: DataName[];
  /** Variable declarations (id = index + 1). Undeclared ids are personal. */
  variables: DataName[];
}

/** Default settings applied by the seed on a brand-new database. */
export const DEFAULT_SETTINGS: SystemSettings = {
  gameTitle: 'Caranille',
  tileSize: 48,
  startPosition: { mapId: 1, x: 20, y: 17, direction: 2 },
  currencyName: 'Or',
  maxLevel: 99,
  maxPartySize: 5,
  maxRaidSize: 20,
  instanceIdleMinutes: 5,
  guildCreationCost: 1000,
  elements: ['Aucun', 'Physique', 'Feu', 'Glace', 'Foudre', 'Eau', 'Terre', 'Vent', 'Lumière', 'Ténèbres'],
  weaponTypes: ['Aucun', 'Épée', 'Hache', 'Lance', 'Arc', 'Bâton', 'Dague', 'Masse'],
  armorTypes: ['Aucun', 'Tissu', 'Cuir', 'Métal', 'Bouclier', 'Accessoire'],
  startingGold: 50,
  statPointsPerLevel: 3,
  sellRate: 50,
  bagSize: 48,
  terms: {
    level: 'Niveau',
    hp: 'PV',
    mp: 'PM',
    xp: 'Expérience',
    params: { mhp: 'PV max', mmp: 'PM max', atk: 'Attaque', def: 'Défense', mat: 'Magie', mdf: 'Déf. magique', agi: 'Agilité', luk: 'Chance' },
  },
  switches: [{ name: 'Coffret de Lina retrouvé', global: false }],
  variables: [{ name: 'Signatures du registre', global: true }],
};

/** Keys of the settings editable in the System tab. */
export const SYSTEM_SETTING_KEYS = [
  'gameTitle', 'startPosition', 'currencyName', 'maxLevel', 'maxPartySize', 'maxRaidSize', 'instanceIdleMinutes', 'guildCreationCost',
  'elements', 'weaponTypes', 'armorTypes', 'startingGold', 'statPointsPerLevel', 'sellRate', 'bagSize', 'terms', 'switches', 'variables',
] as const;
