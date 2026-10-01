/**
 * @file Record types of the editor database (classes, skills, items, weapons,
 * armors, enemies, states, animations, tilesets, common events), shared by the
 * server (storage, game rules), the editor (forms) and the client (display).
 *
 * Every record has an `id` (unique within its type, starting at 1) and a
 * `name`. Names, descriptions and other texts are game content written by the
 * creator in any language; the engine never translates them.
 */
import type { CharacterAppearance, Outfit } from './art/character.js';
import type { EventCommand } from './events.js';

/** The eight base parameters of battlers. */
export const PARAMS = ['mhp', 'mmp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk'] as const;
export type ParamName = (typeof PARAMS)[number];

/** A parameter curve: value at level 1 and linear growth per level. */
export interface ParamCurve {
  base: number;
  growth: number;
}

/** Flat bonuses of equipment, by parameter. */
export type ParamValues = Record<ParamName, number>;

/** A passive modifier carried by equipment, states or classes. */
export interface Trait {
  kind: 'param_rate' | 'element_rate' | 'state_resist' | 'attack_element' | 'hit_rate' | 'evasion' | 'critical';
  /** Parameter name, element index or state id, depending on the kind. */
  target: string;
  /** Multiplier (rates, 1 = 100 %) or additive chance (hit, evasion, critical, 0.1 = +10 %). */
  value: number;
}

/** What using an item or a skill does, on top of its damage. */
export interface Effect {
  kind: 'recover_hp' | 'recover_mp' | 'add_state' | 'remove_state' | 'gain_xp' | 'common_event';
  /** Flat amount (recover, xp) or id (state, common event). */
  value: number;
  /** Percentage of the maximum (recover) or chance (states), 0–100. */
  percent: number;
}

/** Damage part of a skill or item. */
export interface Damage {
  type: 'none' | 'hp_damage' | 'mp_damage' | 'hp_recover' | 'mp_recover';
  /** Formula using `a` (user) and `b` (target) parameters, e.g. `a.atk * 4 - b.def * 2`. */
  formula: string;
  /** Element index in the system elements list (0 = none). */
  element: number;
  /** Random variation in percent. */
  variance: number;
  critical: boolean;
}

/** Who a skill or item affects. */
export type Scope = 'none' | 'self' | 'enemy' | 'ally' | 'enemies_area' | 'allies_area';

/** A skill learnt when reaching a level. */
export interface Learning {
  level: number;
  skillId: number;
}

/** Character class. */
export interface ClassData {
  id: number;
  name: string;
  description: string;
  /** Outfit drawn for characters of this class. */
  outfit: Outfit;
  /** Appearance proposed first in character creation. */
  defaultAppearance: CharacterAppearance;
  /** Icon index shown in lists. */
  icon: number;
  params: Record<ParamName, ParamCurve>;
  /** Experience needed for level 2; each level needs `expGrowth` percent more. */
  expBase: number;
  expGrowth: number;
  learnings: Learning[];
  /** Weapon type indices this class may equip (empty = all). */
  weaponTypes: number[];
  /** Armor type indices this class may equip (empty = all). */
  armorTypes: number[];
  traits: Trait[];
}

/** Skill. */
export interface SkillData {
  id: number;
  name: string;
  description: string;
  icon: number;
  mpCost: number;
  /** Cooldown in seconds. */
  cooldown: number;
  /** Reach in tiles (1 = adjacent). */
  range: number;
  /** Radius of the affected area in tiles (0 = single target). */
  area: number;
  scope: Scope;
  damage: Damage;
  animationId: number;
  effects: Effect[];
  message: string;
}

/** Item. */
export interface ItemData {
  id: number;
  name: string;
  description: string;
  icon: number;
  kind: 'regular' | 'key' | 'quest';
  price: number;
  consumable: boolean;
  /** Maximum stack in one inventory slot. */
  maxStack: number;
  occasion: 'always' | 'battle' | 'menu' | 'never';
  scope: Scope;
  damage: Damage;
  effects: Effect[];
  animationId: number;
}

/** Equipment slots. */
export const EQUIP_SLOTS = ['weapon', 'shield', 'head', 'body', 'accessory'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Weapon. */
export interface WeaponData {
  id: number;
  name: string;
  description: string;
  icon: number;
  /** Index in the system weapon types. */
  weaponType: number;
  price: number;
  params: ParamValues;
  /** Attack reach in tiles (1 melee, more for bows and staves). */
  range: number;
  animationId: number;
  traits: Trait[];
}

/** Armor. */
export interface ArmorData {
  id: number;
  name: string;
  description: string;
  icon: number;
  /** Index in the system armor types. */
  armorType: number;
  slot: Exclude<EquipSlot, 'weapon'>;
  price: number;
  params: ParamValues;
  traits: Trait[];
}

/** One possible drop of an enemy. */
export interface Drop {
  kind: 'item' | 'weapon' | 'armor';
  id: number;
  /** Chance in percent. */
  chance: number;
}

/** A skill an enemy may use. */
export interface EnemyAction {
  skillId: number;
  /** Relative weight when choosing an action. */
  weight: number;
}

/** Enemy. */
export interface EnemyData {
  id: number;
  name: string;
  characterName: string;
  characterIndex: number;
  params: ParamValues;
  exp: number;
  gold: number;
  drops: Drop[];
  /** Passive: attacks only when hit. Aggressive: attacks on sight. Coward: flees when hurt. */
  ai: 'passive' | 'aggressive' | 'coward';
  /** Detection radius in tiles. */
  aggroRadius: number;
  actions: EnemyAction[];
  /** Seconds before reappearing after defeat. */
  respawn: number;
  moveSpeed: number;
  traits: Trait[];
}

/** State (poison, stun, buffs...). */
export interface StateData {
  id: number;
  name: string;
  icon: number;
  /** Duration in seconds (0 = until removed). */
  duration: number;
  restriction: 'none' | 'cannot_move' | 'cannot_act' | 'cannot_both';
  /** HP change per second as a percentage of the maximum (negative = damage). */
  hpPerSecond: number;
  mpPerSecond: number;
  removeOnDamage: boolean;
  traits: Trait[];
  message: string;
}

/** Animation played on the map (strip of frames in an animation sheet). */
export interface AnimationData {
  id: number;
  name: string;
  /** Image in `img/animations/`. */
  sheet: string;
  frameCount: number;
  /** Frame size in pixels (square frames laid out left to right, then top to bottom). */
  frameSize: number;
  /** Frames per second. */
  fps: number;
  sound: string;
}

/** Common event, callable from any event (or running on its own). */
export interface CommonEventData {
  id: number;
  name: string;
  trigger: 'none' | 'autorun' | 'parallel';
  /** Switch that enables autorun/parallel common events. */
  switchId: number;
  list: EventCommand[];
}

/** Kinds of quest objectives. */
export const OBJECTIVE_KINDS = ['talk', 'kill', 'collect', 'reach', 'switch'] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

/**
 * One objective of a quest step. Only the fields of its kind are used:
 * - `talk`: talk to event `eventId` of map `mapId`;
 * - `kill`: defeat `count` enemies `enemyId`;
 * - `collect`: own `count` items `itemId` (checked on the bag, not counted);
 * - `reach`: stand within `radius` cells of (`x`, `y`) on map `mapId`;
 * - `switch`: switch `switchId` is ON.
 */
export interface QuestObjective {
  kind: ObjectiveKind;
  mapId: number;
  eventId: number;
  enemyId: number;
  itemId: number;
  switchId: number;
  x: number;
  y: number;
  radius: number;
  count: number;
  /** Text shown in the journal (a text is generated from the kind when empty). */
  label: string;
}

/** A quest step: a description and the objectives completing it. */
export interface QuestStep {
  description: string;
  objectives: QuestObjective[];
}

/** An item given when a quest is completed. */
export interface QuestRewardItem {
  kind: 'item' | 'weapon' | 'armor';
  item: number;
  weapon: number;
  armor: number;
  count: number;
}

/**
 * Quest. The progress of each character (in progress at a step, completed)
 * is stored with the character; events start, advance and complete quests and
 * test their status in page conditions and branches.
 *
 * Steps are optional: a quest without steps is driven by event commands only.
 * With steps, the server tracks the objectives of the current step and moves
 * to the next step when they are all met; after the last step the quest is
 * "ready" (to be handed in to an NPC), or completed at once with
 * `autoComplete`. Quests of the same `category` form a chapter; `prerequisite`
 * and `level` lock a quest until they are met.
 */
export interface QuestData {
  id: number;
  name: string;
  description: string;
  icon: number;
  /** Chapter or quest chain name (game content). */
  category: string;
  /** Minimum level to start the quest. */
  level: number;
  /** Quest to complete first (0 = none). */
  prerequisite: number;
  autoComplete: boolean;
  /** Removes the collected items when the quest is completed. */
  takeItems: boolean;
  steps: QuestStep[];
  rewardGold: number;
  rewardExp: number;
  rewardItems: QuestRewardItem[];
}

/** Mechanics of a boss phase. */
export const BOSS_MECHANICS = ['adds', 'zone', 'enrage'] as const;
export type BossMechanic = (typeof BOSS_MECHANICS)[number];

/**
 * A phase of a raid boss, active while its HP is below `hpBelow` percent:
 * - `adds`: calls `count` enemies `enemyId` around it (at the start of the
 *   phase, then every `interval` seconds if not 0);
 * - `zone`: every `interval` seconds, marks the ground under a player (radius
 *   `radius`) for a moment, then deals `damage` to everyone still inside;
 * - `enrage`: attacks faster and harder.
 */
export interface BossPhase {
  hpBelow: number;
  mechanic: BossMechanic;
  enemyId: number;
  count: number;
  damage: number;
  radius: number;
  interval: number;
}

/**
 * Raid (or dungeon with a boss): an instanced map, its boss, who may get the
 * rewards, how often, and how the loot is shared.
 */
export interface RaidData {
  id: number;
  name: string;
  description: string;
  /** Instanced map where the boss is. */
  mapId: number;
  bossEnemyId: number;
  /** Access: minimum level and party size to enter the map. */
  minLevel: number;
  minPlayers: number;
  maxPlayers: number;
  /** Rewards once per period for each character. */
  lockout: 'always' | 'daily' | 'weekly';
  /** Items of the loot table: in turn, or rolled for (need / greed). */
  lootMode: 'round_robin' | 'need_greed';
  rewardGold: number;
  rewardExp: number;
  rewardItems: QuestRewardItem[];
  phases: BossPhase[];
}

/** Tileset: sheet names in A1..E order and one flag value per tile id. */
export interface TilesetData {
  id: number;
  name: string;
  /** 0 world, 1 area, 2 legacy 32 px layout. */
  mode: number;
  tilesetNames: string[];
  flags: number[];
}

/** Map of record types to their shapes. */
export interface GameDataTypes {
  class: ClassData;
  skill: SkillData;
  item: ItemData;
  weapon: WeaponData;
  armor: ArmorData;
  enemy: EnemyData;
  state: StateData;
  animation: AnimationData;
  commonEvent: CommonEventData;
  quest: QuestData;
  raid: RaidData;
  tileset: TilesetData;
}

/** A record type name. */
export type GameDataType = keyof GameDataTypes;

/** Types edited through the generic database forms (tilesets have their own editor). */
export const DATABASE_TYPES = ['class', 'skill', 'item', 'weapon', 'armor', 'enemy', 'state', 'animation', 'commonEvent', 'quest', 'raid'] as const;
export type DatabaseType = (typeof DATABASE_TYPES)[number];

/**
 * Value of a parameter at a given level.
 * @param curve - Parameter curve.
 * @param level - Level (1-based).
 */
export function paramAt(curve: ParamCurve, level: number): number {
  return Math.max(1, Math.floor(curve.base + curve.growth * (level - 1)));
}

/**
 * Total experience needed to reach a level.
 * @param cls - Class (experience curve).
 * @param level - Target level.
 */
export function expForLevel(cls: Pick<ClassData, 'expBase' | 'expGrowth'>, level: number): number {
  let total = 0;
  let step = cls.expBase;
  for (let l = 2; l <= level; l++) {
    total += Math.round(step);
    step *= 1 + cls.expGrowth / 100;
  }
  return total;
}

/** Parameter values all set to zero. */
export function zeroParams(): ParamValues {
  return { mhp: 0, mmp: 0, atk: 0, def: 0, mat: 0, mdf: 0, agi: 0, luk: 0 };
}

/** Damage block doing nothing. */
export function noDamage(): Damage {
  return { type: 'none', formula: '0', element: 0, variance: 20, critical: false };
}
