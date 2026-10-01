/**
 * @file Repository of story progress.
 *
 * Personal data (switches, variables, self switches, quests) is loaded once
 * when a character enters the world and kept in memory in a
 * {@link CharacterProgress}; every change is written through immediately
 * (these changes are rare: they come from event commands). Global switches
 * and variables are shared by the whole server and cached the same way.
 * Only non-default values have rows (a switch OFF, a variable at 0 or a quest
 * never started have none).
 */
import type { Statement } from 'better-sqlite3';
import { HOTBAR_SIZE, type HotbarSlot } from '../../shared/combat.js';
import { PARAMS, type EquipSlot, type ParamName } from '../../shared/database.js';
import type { SelfSwitch } from '../../shared/events.js';
import type { Db } from './database.js';
import { MAX_GOLD } from './inventory.js';

/** Largest absolute value of a variable. */
export const MAX_VARIABLE = 99_999_999;

/** Quest progress of one character. */
export interface QuestProgress {
  /** 1 in progress, 2 completed. */
  status: 1 | 2;
  step: number;
  /** Counters of the objectives of the current step (talk, kill, reach). */
  counters: number[];
  /** Time of the last change (journal order). */
  updatedAt: number;
}

/** Parses stored objective counters (anything invalid becomes an empty list). */
function parseCounters(json: string): number[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.slice(0, 50).map((n) => Math.max(0, Math.min(99_999, Math.trunc(Number(n)) || 0))) : [];
  } catch {
    return [];
  }
}

/** Personal progress of one character, kept in memory while it plays. */
export interface CharacterProgress {
  switches: Set<number>;
  variables: Map<number, number>;
  /** Keys `mapId:eventId:letter`. */
  selfSwitches: Set<string>;
  quests: Map<number, QuestProgress>;
}

/** Server-wide switches and variables. */
export interface GlobalProgress {
  switches: Set<number>;
  variables: Map<number, number>;
}

/** Key of a self switch in {@link CharacterProgress.selfSwitches}. */
export const selfSwitchKey = (mapId: number, eventId: number, letter: SelfSwitch): string => `${mapId}:${eventId}:${letter}`;

/** Clamps a variable value to the allowed range (non-numbers become 0). */
export function clampVariable(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_VARIABLE, Math.min(MAX_VARIABLE, Math.trunc(value)));
}

/** Coerces an untrusted hotbar to `HOTBAR_SIZE` valid slots. */
export function sanitizeHotbar(raw: unknown): HotbarSlot[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: HOTBAR_SIZE }, (_, i) => {
    const s = list[i] as { kind?: unknown; id?: unknown } | null | undefined;
    return s && (s.kind === 'skill' || s.kind === 'item') && Number.isInteger(s.id) && Number(s.id) >= 1 && Number(s.id) <= 9999 ? { kind: s.kind, id: Number(s.id) } : null;
  });
}

/** Data access for progress and equipment. */
export class ProgressionRepository {
  private readonly stmts: {
    switches: Statement<[number], number>;
    variables: Statement<[number], { variable_id: number; value: number }>;
    selfs: Statement<[number], { map_id: number; event_id: number; letter: SelfSwitch }>;
    quests: Statement<[number], { quest_id: number; status: 1 | 2; step: number; counters: string; updated: number }>;
    switchOn: Statement<[number, number]>;
    switchOff: Statement<[number, number]>;
    variableSet: Statement<[number, number, number]>;
    variableDel: Statement<[number, number]>;
    selfOn: Statement<[number, number, number, string]>;
    selfOff: Statement<[number, number, number, string]>;
    questSet: Statement<[number, number, number, number, string]>;
    questDel: Statement<[number, number]>;
    gSwitches: Statement<[], number>;
    gVariables: Statement<[], { variable_id: number; value: number }>;
    gSwitchOn: Statement<[number]>;
    gSwitchOff: Statement<[number]>;
    gVariableSet: Statement<[number, number]>;
    gVariableDel: Statement<[number]>;
    equipment: Statement<[number], { slot: EquipSlot; item_kind: 'weapon' | 'armor'; item_id: number }>;
    equipSet: Statement<[number, string, string, number]>;
    equipDel: Statement<[number, string]>;
    levelSet: Statement<[number, number, number]>;
    hotbar: Statement<[number], string>;
    hotbarSet: Statement<[string, number]>;
    respawn: Statement<[number], { respawn_map: number; respawn_x: number; respawn_y: number }>;
    respawnSet: Statement<[number, number, number, number]>;
  };

  constructor(private readonly db: Db) {
    this.stmts = {
      switches: db.prepare<[number], number>('SELECT switch_id FROM character_switches WHERE character_id = ?').pluck(),
      variables: db.prepare('SELECT variable_id, value FROM character_variables WHERE character_id = ?'),
      selfs: db.prepare('SELECT map_id, event_id, letter FROM character_self_switches WHERE character_id = ?'),
      quests: db.prepare(`SELECT quest_id, status, step, counters, CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated
        FROM character_quests WHERE character_id = ?`),
      switchOn: db.prepare('INSERT OR IGNORE INTO character_switches (character_id, switch_id) VALUES (?, ?)'),
      switchOff: db.prepare('DELETE FROM character_switches WHERE character_id = ? AND switch_id = ?'),
      variableSet: db.prepare(`INSERT INTO character_variables (character_id, variable_id, value) VALUES (?, ?, ?)
        ON CONFLICT(character_id, variable_id) DO UPDATE SET value = excluded.value`),
      variableDel: db.prepare('DELETE FROM character_variables WHERE character_id = ? AND variable_id = ?'),
      selfOn: db.prepare('INSERT OR IGNORE INTO character_self_switches (character_id, map_id, event_id, letter) VALUES (?, ?, ?, ?)'),
      selfOff: db.prepare('DELETE FROM character_self_switches WHERE character_id = ? AND map_id = ? AND event_id = ? AND letter = ?'),
      questSet: db.prepare(`INSERT INTO character_quests (character_id, quest_id, status, step, counters) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(character_id, quest_id) DO UPDATE SET status = excluded.status, step = excluded.step, counters = excluded.counters, updated_at = datetime('now')`),
      questDel: db.prepare('DELETE FROM character_quests WHERE character_id = ? AND quest_id = ?'),
      gSwitches: db.prepare<[], number>('SELECT switch_id FROM global_switches').pluck(),
      gVariables: db.prepare('SELECT variable_id, value FROM global_variables'),
      gSwitchOn: db.prepare('INSERT OR IGNORE INTO global_switches (switch_id) VALUES (?)'),
      gSwitchOff: db.prepare('DELETE FROM global_switches WHERE switch_id = ?'),
      gVariableSet: db.prepare(`INSERT INTO global_variables (variable_id, value) VALUES (?, ?)
        ON CONFLICT(variable_id) DO UPDATE SET value = excluded.value`),
      gVariableDel: db.prepare('DELETE FROM global_variables WHERE variable_id = ?'),
      equipment: db.prepare('SELECT slot, item_kind, item_id FROM character_equipment WHERE character_id = ?'),
      equipSet: db.prepare(`INSERT INTO character_equipment (character_id, slot, item_kind, item_id) VALUES (?, ?, ?, ?)
        ON CONFLICT(character_id, slot) DO UPDATE SET item_kind = excluded.item_kind, item_id = excluded.item_id`),
      equipDel: db.prepare('DELETE FROM character_equipment WHERE character_id = ? AND slot = ?'),
      levelSet: db.prepare('UPDATE characters SET level = ?, xp = ? WHERE id = ?'),
      hotbar: db.prepare<[number], string>('SELECT hotbar FROM characters WHERE id = ?').pluck(),
      hotbarSet: db.prepare('UPDATE characters SET hotbar = ? WHERE id = ?'),
      respawn: db.prepare('SELECT respawn_map, respawn_x, respawn_y FROM characters WHERE id = ?'),
      respawnSet: db.prepare('UPDATE characters SET respawn_map = ?, respawn_x = ?, respawn_y = ? WHERE id = ?'),
    };
  }

  /** Loads the personal progress of a character. */
  load(characterId: number): CharacterProgress {
    return {
      switches: new Set(this.stmts.switches.all(characterId)),
      variables: new Map(this.stmts.variables.all(characterId).map((r) => [r.variable_id, r.value])),
      selfSwitches: new Set(this.stmts.selfs.all(characterId).map((r) => selfSwitchKey(r.map_id, r.event_id, r.letter))),
      quests: new Map(this.stmts.quests.all(characterId).map((r) => [r.quest_id, { status: r.status, step: r.step, counters: parseCounters(r.counters), updatedAt: r.updated || 0 }])),
    };
  }

  /** Sets a personal switch (memory and database). */
  setSwitch(characterId: number, progress: CharacterProgress, id: number, on: boolean): void {
    if (on) {
      progress.switches.add(id);
      this.stmts.switchOn.run(characterId, id);
    } else {
      progress.switches.delete(id);
      this.stmts.switchOff.run(characterId, id);
    }
  }

  /** Sets a personal variable (clamped). */
  setVariable(characterId: number, progress: CharacterProgress, id: number, value: number): void {
    const v = clampVariable(value);
    if (v === 0) {
      progress.variables.delete(id);
      this.stmts.variableDel.run(characterId, id);
    } else {
      progress.variables.set(id, v);
      this.stmts.variableSet.run(characterId, id, v);
    }
  }

  /** Sets a self switch of one event for this character. */
  setSelfSwitch(characterId: number, progress: CharacterProgress, mapId: number, eventId: number, letter: SelfSwitch, on: boolean): void {
    const key = selfSwitchKey(mapId, eventId, letter);
    if (on) {
      progress.selfSwitches.add(key);
      this.stmts.selfOn.run(characterId, mapId, eventId, letter);
    } else {
      progress.selfSwitches.delete(key);
      this.stmts.selfOff.run(characterId, mapId, eventId, letter);
    }
  }

  /** Sets (or clears, with `null`) the progress of a quest. */
  setQuest(characterId: number, progress: CharacterProgress, questId: number, value: Omit<QuestProgress, 'updatedAt'> | null): void {
    if (value) {
      progress.quests.set(questId, { ...value, updatedAt: Date.now() });
      this.stmts.questSet.run(characterId, questId, value.status, value.step, JSON.stringify(value.counters));
    } else {
      progress.quests.delete(questId);
      this.stmts.questDel.run(characterId, questId);
    }
  }

  /** Loads the global switches and variables. */
  loadGlobal(): GlobalProgress {
    return {
      switches: new Set(this.stmts.gSwitches.all()),
      variables: new Map(this.stmts.gVariables.all().map((r) => [r.variable_id, r.value])),
    };
  }

  /** Sets a global switch. */
  setGlobalSwitch(global: GlobalProgress, id: number, on: boolean): void {
    if (on) {
      global.switches.add(id);
      this.stmts.gSwitchOn.run(id);
    } else {
      global.switches.delete(id);
      this.stmts.gSwitchOff.run(id);
    }
  }

  /** Sets a global variable (clamped). */
  setGlobalVariable(global: GlobalProgress, id: number, value: number): void {
    const v = clampVariable(value);
    if (v === 0) {
      global.variables.delete(id);
      this.stmts.gVariableDel.run(id);
    } else {
      global.variables.set(id, v);
      this.stmts.gVariableSet.run(id, v);
    }
  }

  /** Equipped items of a character, by slot. */
  equipment(characterId: number): Map<EquipSlot, { kind: 'weapon' | 'armor'; id: number }> {
    return new Map(this.stmts.equipment.all(characterId).map((r) => [r.slot, { kind: r.item_kind, id: r.item_id }]));
  }

  /**
   * Equips an owned item in a slot (it leaves the bag; the previous item goes
   * back to it), or empties the slot when `item` is `null`. Runs in one transaction.
   * @returns `false` when the item is not owned.
   */
  equip(characterId: number, slot: EquipSlot, item: { kind: 'weapon' | 'armor'; id: number } | null): boolean {
    return this.db.transaction(() => {
      const bagQuantity = (kind: string, id: number) =>
        this.db.prepare<[number, string, number], number>('SELECT quantity FROM character_items WHERE character_id = ? AND item_kind = ? AND item_id = ?').pluck().get(characterId, kind, id) ?? 0;
      if (item && bagQuantity(item.kind, item.id) < 1) return false;
      const previous = this.equipment(characterId).get(slot);
      if (previous) {
        this.db.prepare(`INSERT INTO character_items (character_id, item_kind, item_id, quantity) VALUES (?, ?, ?, 1)
          ON CONFLICT(character_id, item_kind, item_id) DO UPDATE SET quantity = MIN(99, quantity + 1)`).run(characterId, previous.kind, previous.id);
      }
      if (item) {
        const left = bagQuantity(item.kind, item.id) - 1;
        if (left > 0) this.db.prepare('UPDATE character_items SET quantity = ? WHERE character_id = ? AND item_kind = ? AND item_id = ?').run(left, characterId, item.kind, item.id);
        else this.db.prepare('DELETE FROM character_items WHERE character_id = ? AND item_kind = ? AND item_id = ?').run(characterId, item.kind, item.id);
        this.stmts.equipSet.run(characterId, slot, item.kind, item.id);
      } else {
        this.stmts.equipDel.run(characterId, slot);
      }
      return true;
    })();
  }

  /** Hotbar of a character (always `HOTBAR_SIZE` slots). */
  hotbar(characterId: number): HotbarSlot[] {
    let raw: unknown = [];
    try {
      raw = JSON.parse(this.stmts.hotbar.get(characterId) ?? '[]');
    } catch {
      raw = [];
    }
    return sanitizeHotbar(raw);
  }

  /** Stores the hotbar of a character. */
  setHotbar(characterId: number, slots: HotbarSlot[]): void {
    this.stmts.hotbarSet.run(JSON.stringify(sanitizeHotbar(slots)), characterId);
  }

  /** Respawn point of a character, or `null` for the start position. */
  respawn(characterId: number): { mapId: number; x: number; y: number } | null {
    const r = this.stmts.respawn.get(characterId);
    return r && r.respawn_map > 0 ? { mapId: r.respawn_map, x: r.respawn_x, y: r.respawn_y } : null;
  }

  /** Sets the respawn point of a character. */
  setRespawn(characterId: number, mapId: number, x: number, y: number): void {
    this.stmts.respawnSet.run(mapId, x, y, characterId);
  }

  /** Parameter points distributed by a character. */
  allocated(characterId: number): Partial<Record<ParamName, number>> {
    try {
      const raw = JSON.parse(this.db.prepare<[number], string>('SELECT allocated FROM characters WHERE id = ?').pluck().get(characterId) ?? '{}') as Record<string, unknown>;
      return Object.fromEntries(PARAMS.flatMap((p) => (Number.isInteger(raw[p]) && Number(raw[p]) > 0 ? [[p, Number(raw[p])]] : [])));
    } catch {
      return {};
    }
  }

  /** Stores the distributed parameter points. */
  setAllocated(characterId: number, allocated: Partial<Record<ParamName, number>>): void {
    this.db.prepare('UPDATE characters SET allocated = ? WHERE id = ?').run(JSON.stringify(allocated), characterId);
  }

  /** Stores the level and experience of a character. */
  setLevel(characterId: number, level: number, xp: number): void {
    this.stmts.levelSet.run(level, Math.max(0, Math.min(MAX_GOLD, Math.floor(xp))), characterId);
  }
}
