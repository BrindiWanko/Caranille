/**
 * @file Battle parameters of players and monsters.
 *
 * A player's parameters come from its class curves at its level, plus the
 * flat bonuses of its equipment and of the points it distributed, multiplied
 * by the `param_rate` traits of its class, equipment and active states. Monsters use their database values
 * with the traits of their states. Traits also give hit / evasion /
 * critical bonuses, element rates and the element of normal attacks.
 */
import { POINT_GAIN } from '../../shared/character.js';
import { PARAMS, paramAt, zeroParams, type EnemyData, type ParamName, type ParamValues, type Trait } from '../../shared/database.js';
import type { ServerContext } from '../context.js';

/** Parameters and traits of a battler, ready for the combat formulas. */
export interface BattlerStats {
  params: ParamValues;
  traits: Trait[];
  /** Reach of the normal attack in cells (weapon range, 1 without weapon). */
  attackRange: number;
  /** Animation of the normal attack (weapon), 0 = default slash. */
  attackAnimation: number;
}

/** Active states of a battler: state id → expiry time (ms, `Infinity` = until removed). */
export type ActiveStates = Map<number, number>;

/** Traits of the active states. */
function stateTraits(ctx: ServerContext, states: ActiveStates): Trait[] {
  const traits: Trait[] = [];
  for (const id of states.keys()) traits.push(...(ctx.gameData.get('state', id)?.traits ?? []));
  return traits;
}

/** Applies `param_rate` traits to parameters (at least 1 for max HP, 0 for the others). */
function applyRates(params: ParamValues, traits: Trait[]): ParamValues {
  const out = { ...params };
  for (const t of traits) {
    if (t.kind === 'param_rate' && (PARAMS as readonly string[]).includes(t.target)) out[t.target as ParamName] = Math.floor(out[t.target as ParamName] * t.value);
  }
  for (const p of PARAMS) out[p] = Math.max(p === 'mhp' ? 1 : 0, out[p]);
  return out;
}

/** Parameters from the class curves alone. */
export function classParams(ctx: ServerContext, classId: number, level: number): ParamValues {
  const cls = ctx.gameData.get('class', classId);
  const params = zeroParams();
  if (cls) for (const p of PARAMS) params[p] = paramAt(cls.params[p], level);
  return params;
}

/**
 * Parameters of a player.
 * @param states - Active states (their traits count).
 * @param allocated - Distributed points, by parameter.
 */
export function playerStats(ctx: ServerContext, characterId: number, classId: number, level: number, states: ActiveStates, allocated: Partial<Record<ParamName, number>> = {}): BattlerStats {
  const cls = ctx.gameData.get('class', classId);
  const params = classParams(ctx, classId, level);
  const traits: Trait[] = [...(cls?.traits ?? [])];
  for (const p of PARAMS) params[p] += (allocated[p] ?? 0) * POINT_GAIN[p];
  let attackRange = 1;
  let attackAnimation = 0;
  for (const [slot, item] of ctx.progression.equipment(characterId)) {
    const def = item.kind === 'weapon' ? ctx.gameData.get('weapon', item.id) : ctx.gameData.get('armor', item.id);
    if (!def) continue;
    for (const p of PARAMS) params[p] += def.params[p];
    traits.push(...def.traits);
    if (slot === 'weapon' && 'range' in def) {
      attackRange = Math.max(1, def.range);
      attackAnimation = def.animationId;
    }
  }
  traits.push(...stateTraits(ctx, states));
  return { params: applyRates(params, traits), traits, attackRange, attackAnimation };
}

/** Parameters of a monster. */
export function enemyStats(ctx: ServerContext, enemy: EnemyData, states: ActiveStates): BattlerStats {
  const traits = [...enemy.traits, ...stateTraits(ctx, states)];
  return { params: applyRates({ ...enemy.params }, traits), traits, attackRange: 1, attackAnimation: 0 };
}

/** Sum of the additive traits of a kind (hit rate, evasion, critical). */
export function traitSum(traits: Trait[], kind: Trait['kind']): number {
  return traits.reduce((sum, t) => (t.kind === kind ? sum + t.value : sum), 0);
}

/** Damage rate of an element for a target (product of its `element_rate` traits). */
export function elementRate(traits: Trait[], element: number): number {
  if (element <= 0) return 1;
  return traits.reduce((rate, t) => (t.kind === 'element_rate' && Number(t.target) === element ? rate * t.value : rate), 1);
}

/** Element of normal attacks (first `attack_element` trait), 0 = none. */
export function attackElement(traits: Trait[]): number {
  const t = traits.find((x) => x.kind === 'attack_element');
  return t ? Math.max(0, Math.trunc(Number(t.target))) : 0;
}

/** Chance (0–1) to resist a state (product of `state_resist` traits, as "chance to be affected"). */
export function stateRate(traits: Trait[], stateId: number): number {
  return traits.reduce((rate, t) => (t.kind === 'state_resist' && Number(t.target) === stateId ? rate * t.value : rate), 1);
}
