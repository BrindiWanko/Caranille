/**
 * @file Schema of the editor database.
 *
 * One declaration per record type drives three things:
 * - the editor forms (fields are rendered from the schema);
 * - server-side validation (`normalizeRecord` coerces, clamps and fills every
 *   field, so a stored record always has the full, valid shape);
 * - default values of new records (`defaultRecord`).
 *
 * Field labels are translation keys `db.field.<key>`; option labels are
 * `db.option.<value>`.
 */
import { DEFAULT_APPEARANCE, OUTFITS, sanitizeAppearance } from './art/character.js';
import {
  BOSS_MECHANICS,
  EQUIP_SLOTS,
  OBJECTIVE_KINDS,
  PARAMS,
  noDamage,
  zeroParams,
  type DatabaseType,
  type GameDataTypes,
  type ParamCurve,
  type ParamName,
} from './database.js';
import type { EventCommand } from './events.js';

/**
 * Shows a field only when a sibling field has one of some values (the value is
 * still stored, with its default, so records keep a fixed shape).
 */
export interface FieldCondition {
  key: string;
  values: readonly string[];
}

/** Field declaration. */
export type Field = FieldBase & { when?: FieldCondition };

type FieldBase =
  | { key: string; type: 'text'; max?: number; multiline?: boolean }
  | { key: string; type: 'int'; min: number; max: number }
  | { key: string; type: 'number'; min: number; max: number }
  | { key: string; type: 'bool' }
  | { key: string; type: 'select'; options: readonly string[] }
  | { key: string; type: 'icon' }
  | { key: string; type: 'resource'; kind: string }
  | { key: string; type: 'ref'; ref: DatabaseType; allowNone?: boolean }
  | { key: string; type: 'params' }
  | { key: string; type: 'curves' }
  | { key: string; type: 'group'; fields: Field[] }
  | { key: string; type: 'list'; fields: Field[]; max: number }
  | { key: string; type: 'intList'; min: number; max: number }
  | { key: string; type: 'appearance' }
  | { key: string; type: 'commands' }
  /** A map id (picked from the map list in the editor). */
  | { key: string; type: 'map' }
  /** An event id of the map chosen in the sibling field `mapKey`. */
  | { key: string; type: 'event'; mapKey: string }
  /** Picks a cell of the map chosen in `mapKey` and writes the sibling fields `x` and `y` (stores nothing itself). */
  | { key: string; type: 'cell'; mapKey: string };

const SCOPES = ['none', 'self', 'enemy', 'ally', 'enemies_area', 'allies_area'] as const;
const TRAIT_KINDS = ['param_rate', 'element_rate', 'state_resist', 'attack_element', 'hit_rate', 'evasion', 'critical'] as const;
const EFFECT_KINDS = ['recover_hp', 'recover_mp', 'add_state', 'remove_state', 'gain_xp', 'common_event'] as const;

const name: Field = { key: 'name', type: 'text', max: 100 };
const description: Field = { key: 'description', type: 'text', max: 500, multiline: true };
const icon: Field = { key: 'icon', type: 'icon' };
const traits: Field = {
  key: 'traits',
  type: 'list',
  max: 30,
  fields: [
    { key: 'kind', type: 'select', options: TRAIT_KINDS },
    { key: 'target', type: 'text', max: 40 },
    { key: 'value', type: 'number', min: -100, max: 100 },
  ],
};
const effects: Field = {
  key: 'effects',
  type: 'list',
  max: 20,
  fields: [
    { key: 'kind', type: 'select', options: EFFECT_KINDS },
    { key: 'value', type: 'int', min: 0, max: 999_999 },
    { key: 'percent', type: 'int', min: 0, max: 100 },
  ],
};
const damage: Field = {
  key: 'damage',
  type: 'group',
  fields: [
    { key: 'type', type: 'select', options: ['none', 'hp_damage', 'mp_damage', 'hp_recover', 'mp_recover'] },
    { key: 'formula', type: 'text', max: 200 },
    { key: 'element', type: 'int', min: 0, max: 99 },
    { key: 'variance', type: 'int', min: 0, max: 100 },
    { key: 'critical', type: 'bool' },
  ],
};

const kindIs = (...values: string[]) => ({ key: 'kind', values });
const objectives: Field = {
  key: 'objectives',
  type: 'list',
  max: 10,
  fields: [
    { key: 'kind', type: 'select', options: OBJECTIVE_KINDS },
    { key: 'mapId', type: 'map', when: kindIs('talk', 'reach') },
    { key: 'eventId', type: 'event', mapKey: 'mapId', when: kindIs('talk') },
    { key: 'enemyId', type: 'ref', ref: 'enemy', when: kindIs('kill') },
    { key: 'itemId', type: 'ref', ref: 'item', when: kindIs('collect') },
    { key: 'switchId', type: 'int', min: 1, max: 9999, when: kindIs('switch') },
    { key: 'cell', type: 'cell', mapKey: 'mapId', when: kindIs('reach') },
    { key: 'x', type: 'int', min: 0, max: 255, when: kindIs('reach') },
    { key: 'y', type: 'int', min: 0, max: 255, when: kindIs('reach') },
    { key: 'radius', type: 'int', min: 0, max: 20, when: kindIs('reach') },
    { key: 'count', type: 'int', min: 1, max: 9999, when: kindIs('kill', 'collect') },
    { key: 'label', type: 'text', max: 120 },
  ],
};

const rewardItems: Field = {
  key: 'rewardItems',
  type: 'list',
  max: 10,
  fields: [
    { key: 'kind', type: 'select', options: ['item', 'weapon', 'armor'] },
    { key: 'item', type: 'ref', ref: 'item', when: kindIs('item') },
    { key: 'weapon', type: 'ref', ref: 'weapon', when: kindIs('weapon') },
    { key: 'armor', type: 'ref', ref: 'armor', when: kindIs('armor') },
    { key: 'count', type: 'int', min: 1, max: 99 },
  ],
};
const mechanicIs = (...values: string[]) => ({ key: 'mechanic', values });

/** Field lists of every database type (after the implicit `id`). */
export const SCHEMAS: Record<DatabaseType, Field[]> = {
  class: [
    name,
    description,
    icon,
    { key: 'outfit', type: 'select', options: OUTFITS },
    { key: 'defaultAppearance', type: 'appearance' },
    { key: 'params', type: 'curves' },
    { key: 'expBase', type: 'int', min: 1, max: 100_000 },
    { key: 'expGrowth', type: 'int', min: 0, max: 200 },
    { key: 'learnings', type: 'list', max: 200, fields: [{ key: 'level', type: 'int', min: 1, max: 999 }, { key: 'skillId', type: 'ref', ref: 'skill' }] },
    { key: 'weaponTypes', type: 'intList', min: 0, max: 99 },
    { key: 'armorTypes', type: 'intList', min: 0, max: 99 },
    traits,
  ],
  skill: [
    name,
    description,
    icon,
    { key: 'mpCost', type: 'int', min: 0, max: 9999 },
    { key: 'cooldown', type: 'number', min: 0, max: 3600 },
    { key: 'range', type: 'int', min: 0, max: 20 },
    { key: 'area', type: 'int', min: 0, max: 10 },
    { key: 'scope', type: 'select', options: SCOPES },
    damage,
    { key: 'animationId', type: 'ref', ref: 'animation', allowNone: true },
    effects,
    { key: 'message', type: 'text', max: 200 },
  ],
  item: [
    name,
    description,
    icon,
    { key: 'kind', type: 'select', options: ['regular', 'key', 'quest'] },
    { key: 'price', type: 'int', min: 0, max: 9_999_999 },
    { key: 'consumable', type: 'bool' },
    { key: 'maxStack', type: 'int', min: 1, max: 9999 },
    { key: 'occasion', type: 'select', options: ['always', 'battle', 'menu', 'never'] },
    { key: 'scope', type: 'select', options: SCOPES },
    damage,
    effects,
    { key: 'animationId', type: 'ref', ref: 'animation', allowNone: true },
  ],
  weapon: [
    name,
    description,
    icon,
    { key: 'weaponType', type: 'int', min: 0, max: 99 },
    { key: 'price', type: 'int', min: 0, max: 9_999_999 },
    { key: 'params', type: 'params' },
    { key: 'range', type: 'int', min: 1, max: 20 },
    { key: 'animationId', type: 'ref', ref: 'animation', allowNone: true },
    traits,
  ],
  armor: [
    name,
    description,
    icon,
    { key: 'armorType', type: 'int', min: 0, max: 99 },
    { key: 'slot', type: 'select', options: EQUIP_SLOTS.filter((s) => s !== 'weapon') },
    { key: 'price', type: 'int', min: 0, max: 9_999_999 },
    { key: 'params', type: 'params' },
    traits,
  ],
  enemy: [
    name,
    { key: 'characterName', type: 'resource', kind: 'characters' },
    { key: 'characterIndex', type: 'int', min: 0, max: 7 },
    { key: 'params', type: 'params' },
    { key: 'exp', type: 'int', min: 0, max: 9_999_999 },
    { key: 'gold', type: 'int', min: 0, max: 9_999_999 },
    {
      key: 'drops',
      type: 'list',
      max: 20,
      fields: [
        { key: 'kind', type: 'select', options: ['item', 'weapon', 'armor'] },
        { key: 'id', type: 'int', min: 1, max: 9999 },
        { key: 'chance', type: 'number', min: 0, max: 100 },
      ],
    },
    { key: 'ai', type: 'select', options: ['passive', 'aggressive', 'coward'] },
    { key: 'aggroRadius', type: 'int', min: 0, max: 30 },
    { key: 'actions', type: 'list', max: 20, fields: [{ key: 'skillId', type: 'ref', ref: 'skill' }, { key: 'weight', type: 'int', min: 1, max: 100 }] },
    { key: 'respawn', type: 'int', min: 0, max: 86_400 },
    { key: 'moveSpeed', type: 'int', min: 1, max: 6 },
    traits,
  ],
  state: [
    name,
    icon,
    { key: 'duration', type: 'number', min: 0, max: 86_400 },
    { key: 'restriction', type: 'select', options: ['none', 'cannot_move', 'cannot_act', 'cannot_both'] },
    { key: 'hpPerSecond', type: 'number', min: -100, max: 100 },
    { key: 'mpPerSecond', type: 'number', min: -100, max: 100 },
    { key: 'removeOnDamage', type: 'bool' },
    traits,
    { key: 'message', type: 'text', max: 200 },
  ],
  animation: [
    name,
    { key: 'sheet', type: 'resource', kind: 'animations' },
    { key: 'frameCount', type: 'int', min: 1, max: 100 },
    { key: 'frameSize', type: 'int', min: 8, max: 512 },
    { key: 'fps', type: 'int', min: 1, max: 60 },
    { key: 'sound', type: 'resource', kind: 'se' },
  ],
  commonEvent: [
    name,
    { key: 'trigger', type: 'select', options: ['none', 'autorun', 'parallel'] },
    { key: 'switchId', type: 'int', min: 0, max: 9999 },
    { key: 'list', type: 'commands' },
  ],
  quest: [
    name,
    icon,
    description,
    { key: 'category', type: 'text', max: 60 },
    { key: 'level', type: 'int', min: 1, max: 999 },
    { key: 'prerequisite', type: 'ref', ref: 'quest', allowNone: true },
    { key: 'autoComplete', type: 'bool' },
    { key: 'takeItems', type: 'bool' },
    { key: 'steps', type: 'list', max: 20, fields: [{ key: 'description', type: 'text', max: 200 }, objectives] },
    { key: 'rewardGold', type: 'int', min: 0, max: 9_999_999 },
    { key: 'rewardExp', type: 'int', min: 0, max: 9_999_999 },
    rewardItems,
  ],
  raid: [
    name,
    description,
    { key: 'mapId', type: 'map' },
    { key: 'bossEnemyId', type: 'ref', ref: 'enemy' },
    { key: 'minLevel', type: 'int', min: 1, max: 999 },
    { key: 'minPlayers', type: 'int', min: 1, max: 40 },
    { key: 'maxPlayers', type: 'int', min: 1, max: 40 },
    { key: 'lockout', type: 'select', options: ['weekly', 'daily', 'always'] },
    { key: 'lootMode', type: 'select', options: ['round_robin', 'need_greed'] },
    { key: 'rewardGold', type: 'int', min: 0, max: 9_999_999 },
    { key: 'rewardExp', type: 'int', min: 0, max: 9_999_999 },
    rewardItems,
    {
      key: 'phases',
      type: 'list',
      max: 10,
      fields: [
        { key: 'hpBelow', type: 'int', min: 1, max: 100 },
        { key: 'mechanic', type: 'select', options: BOSS_MECHANICS },
        { key: 'enemyId', type: 'ref', ref: 'enemy', when: mechanicIs('adds') },
        { key: 'count', type: 'int', min: 1, max: 10, when: mechanicIs('adds') },
        { key: 'damage', type: 'int', min: 1, max: 99_999, when: mechanicIs('zone') },
        { key: 'radius', type: 'int', min: 0, max: 5, when: mechanicIs('zone') },
        { key: 'interval', type: 'int', min: 0, max: 600, when: mechanicIs('adds', 'zone') },
      ],
    },
  ],
};

/** Error raised with the path of the first invalid field. */
export class SchemaError extends Error {
  constructor(readonly path: string) {
    super(path);
  }
}

function num(v: unknown, min: number, max: number, integer: boolean, path: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) throw new SchemaError(path);
  const value = integer ? Math.round(n) : n;
  return Math.min(max, Math.max(min, value));
}

/** Normalises one field value (throws `SchemaError` when it cannot be coerced). */
function normalizeField(field: Field, value: unknown, path: string): unknown {
  switch (field.type) {
    case 'text':
      return typeof value === 'string' ? value.slice(0, field.max ?? 200) : '';
    case 'int':
      return num(value ?? field.min, field.min, field.max, true, path);
    case 'number':
      return num(value ?? field.min, field.min, field.max, false, path);
    case 'bool':
      return value === true;
    case 'select':
      return field.options.includes(value as string) ? value : field.options[0];
    case 'icon':
      return num(value ?? 0, 0, 9999, true, path);
    case 'resource':
      return typeof value === 'string' ? value.slice(0, 200) : '';
    case 'ref':
      return num(value ?? 0, field.allowNone ? 0 : 1, 9999, true, path);
    case 'params': {
      const src = (value ?? {}) as Record<string, unknown>;
      return Object.fromEntries(PARAMS.map((p) => [p, num(src[p] ?? 0, -9999, 99_999, true, `${path}.${p}`)]));
    }
    case 'curves': {
      const src = (value ?? {}) as Record<string, Partial<ParamCurve>>;
      return Object.fromEntries(
        PARAMS.map((p) => [p, { base: num(src[p]?.base ?? 1, 1, 99_999, true, `${path}.${p}`), growth: num(src[p]?.growth ?? 0, 0, 9999, false, `${path}.${p}`) }]),
      ) as Record<ParamName, ParamCurve>;
    }
    case 'group':
      return normalizeFields(field.fields, value, path);
    case 'list': {
      const list = Array.isArray(value) ? value.slice(0, field.max) : [];
      return list.map((item, i) => normalizeFields(field.fields, item, `${path}[${i}]`));
    }
    case 'intList': {
      const list = Array.isArray(value) ? value : [];
      return [...new Set(list.map((v, i) => num(v, field.min, field.max, true, `${path}[${i}]`)))];
    }
    case 'appearance':
      return sanitizeAppearance(value ?? DEFAULT_APPEARANCE);
    case 'commands': {
      const list = Array.isArray(value) ? value : [];
      const commands: EventCommand[] = list.slice(0, 5000).map((c, i) => {
        const cmd = (c ?? {}) as Partial<EventCommand>;
        if (!Array.isArray(cmd.parameters) || JSON.stringify(cmd.parameters).length > 20_000) throw new SchemaError(`${path}[${i}]`);
        return { code: num(cmd.code, 0, 99_999, true, `${path}[${i}]`), indent: num(cmd.indent ?? 0, 0, 100, true, `${path}[${i}]`), parameters: cmd.parameters };
      });
      if (commands.length === 0 || commands.at(-1)!.code !== 0) commands.push({ code: 0, indent: 0, parameters: [] });
      return commands;
    }
    case 'map':
      return num(value ?? 1, 1, 1_000_000, true, path);
    case 'event':
      return num(value ?? 1, 1, 9999, true, path);
    case 'cell':
      return undefined;
  }
}

function normalizeFields(fields: Field[], value: unknown, path: string): Record<string, unknown> {
  const src = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    // A cell picker only edits its sibling x / y fields.
    if (f.type !== 'cell') out[f.key] = normalizeField(f, src[f.key], path ? `${path}.${f.key}` : f.key);
  }
  return out;
}

/**
 * Validates and completes a record.
 * @param type - Record type.
 * @param raw - Untrusted record.
 * @param id - Id it is stored under.
 * @throws {SchemaError} With the path of an invalid field.
 */
export function normalizeRecord<T extends DatabaseType>(type: T, raw: unknown, id: number): GameDataTypes[T] {
  return { id, ...normalizeFields(SCHEMAS[type], raw, '') } as unknown as GameDataTypes[T];
}

/**
 * A new record with default values.
 * @param type - Record type.
 * @param id - Id of the record.
 */
export function defaultRecord<T extends DatabaseType>(type: T, id: number): GameDataTypes[T] {
  const base = normalizeRecord(type, {}, id) as unknown as Record<string, unknown>;
  base.name = '';
  if (type === 'item') Object.assign(base, { consumable: true, maxStack: 99, occasion: 'always', scope: 'self', damage: noDamage() });
  if (type === 'skill') Object.assign(base, { range: 1, scope: 'enemy', damage: { ...noDamage(), type: 'hp_damage', formula: 'a.atk * 4 - b.def * 2' } });
  if (type === 'class') Object.assign(base, { expBase: 30, expGrowth: 25 });
  if (type === 'weapon') Object.assign(base, { range: 1, params: zeroParams() });
  if (type === 'enemy') Object.assign(base, { characterName: 'Monster1', ai: 'aggressive', aggroRadius: 5, respawn: 30, moveSpeed: 3 });
  if (type === 'animation') Object.assign(base, { frameCount: 5, frameSize: 96, fps: 12 });
  return base as unknown as GameDataTypes[T];
}
