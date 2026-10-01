/**
 * @file Real-time combat on the map, shared by the server and the client:
 * monster spawns of a map, what clients see of monsters, damage and attack
 * notifications, the player's skills and hotbar, and the rule constants used
 * by the server (the client only uses them for display).
 *
 * Every computation happens on the server; clients send intents (attack,
 * use a skill or an item of the hotbar) and display the results.
 */

/**
 * Monsters appearing on a map: `count` monsters of enemy `enemyId`, placed on
 * passable cells of region `region` (0 = anywhere on the map).
 */
export interface Spawn {
  enemyId: number;
  count: number;
  region: number;
}

/** Most spawn entries per map, and monsters per entry. */
export const MAX_SPAWNS = 30;
export const MAX_SPAWN_COUNT = 50;

/** A monster as seen by clients. */
export interface MonsterView {
  /** Id unique on the server while the monster lives. */
  id: number;
  enemyId: number;
  name: string;
  characterName: string;
  characterIndex: number;
  x: number;
  y: number;
  direction: 2 | 4 | 6 | 8;
  hp: number;
  maxHp: number;
  moveSpeed: number;
}

/** Who is involved in a combat action. */
export interface CombatActor {
  kind: 'player' | 'monster';
  id: number;
}

/**
 * One result shown as a floating number: damage, healing, miss.
 * `hp` is the target's HP after the hit (monsters' bars, other players).
 */
export interface DamageView {
  target: CombatActor;
  /** Positive amount (0 when missed). */
  amount: number;
  kind: 'hp_damage' | 'mp_damage' | 'hp_recover' | 'mp_recover' | 'miss';
  critical: boolean;
  hp: number;
  maxHp: number;
}

/**
 * An attack or skill being performed (for animations): the user faces
 * `direction`; `targets` are the cells hit (projectiles fly to the first one).
 */
export interface ActionView {
  actor: CombatActor;
  direction: 2 | 4 | 6 | 8;
  /** Normal attack (`attack`) or skill id. */
  skillId: number;
  /** Reach used (1 = melee). */
  range: number;
  targets: { x: number; y: number }[];
  animation: { sheet: string; frameCount: number; frameSize: number; fps: number; sound: string } | null;
}

/** A skill known by the player (texts are game content). */
export interface SkillView {
  id: number;
  name: string;
  description: string;
  icon: number;
  mpCost: number;
  /** Cooldown in seconds. */
  cooldown: number;
  range: number;
}

/** One hotbar slot. */
export type HotbarSlot = { kind: 'skill' | 'item'; id: number } | null;

/** Number of hotbar slots (keys 1 to 8). */
export const HOTBAR_SIZE = 8;

/** Payload of the `skills` event: known skills, hotbar and cooldowns still running. */
export interface SkillsPayload {
  skills: SkillView[];
  hotbar: HotbarSlot[];
  /** Remaining cooldowns in milliseconds, by skill id. */
  cooldowns: Record<number, number>;
}

/** Rule constants. */
export const COMBAT = {
  /** Base chance of a critical hit, and its damage multiplier. */
  criticalRate: 0.04,
  criticalMultiplier: 2,
  /** Base hit rate and evasion rate. */
  hitRate: 0.95,
  evasionRate: 0.05,
  /** Formula of the normal attack. */
  attackFormula: 'a.atk * 4 - b.def * 2',
  /** Time between two normal attacks (ms), shortened by agility. */
  attackDelay: 700,
  /** Seconds before a dead player reappears at its respawn point. */
  respawnSeconds: 3,
  /** A monster chasing further than this from its home gives up and goes back. */
  leash: 12,
} as const;

/** Tells whether a spawn list is valid (shape and bounds). */
export function isValidSpawns(value: unknown): value is Spawn[] {
  if (!Array.isArray(value) || value.length > MAX_SPAWNS) return false;
  return value.every(
    (s: Partial<Spawn>) =>
      typeof s === 'object' && s !== null &&
      Number.isInteger(s.enemyId) && s.enemyId! >= 1 && s.enemyId! <= 9999 &&
      Number.isInteger(s.count) && s.count! >= 1 && s.count! <= MAX_SPAWN_COUNT &&
      Number.isInteger(s.region) && s.region! >= 0 && s.region! <= 255,
  );
}
