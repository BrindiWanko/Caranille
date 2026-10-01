/**
 * @file Real-time combat on the map, in the style of classic online action
 * games: players attack in the direction they face, use skills with a cost
 * and a cooldown, and monsters shared by every player of the map move and
 * fight under server control.
 *
 * Monsters: each map lists spawns (enemy, count, region). The monsters of a
 * map exist while players are on it (they are created on the first visit and
 * dropped a while after the last player left). Their AI runs on the server
 * tick: wandering near home, aggro (aggressive and coward enemies attack on
 * sight, passive ones when hit), chase, flight when hurt (coward), return home
 * when led too far (full heal), reappearance after their respawn delay.
 *
 * Every number is computed here: damage formulas from the database (parsed,
 * never evaluated as code), elements, critical hits, hit and evasion rates,
 * states (duration, HP/MP per second, restrictions, removal on damage).
 * Clients receive the results (floating numbers, animations, monster
 * positions) and send only intents.
 *
 * Rewards are personal: every player who hurt a monster receives its
 * experience and gold and rolls its drops for itself. On PvP maps players can
 * also hit each other (no rewards). A player at 0 HP reappears after a few
 * seconds at its respawn point with full HP and MP.
 */
import { COMBAT, HOTBAR_SIZE, type ActionView, type CombatActor, type DamageView, type HotbarSlot, type MonsterView, type SkillsPayload, type SkillView, type Spawn } from '../../shared/combat.js';
import type { Damage, Effect, EnemyData, RaidData, Scope, SkillData } from '../../shared/database.js';
import { evalFormula } from '../../shared/formula.js';
import { REGION_LAYER, tileAt, type MapData } from '../../shared/map.js';
import { canMove, isPassable } from '../../shared/passability.js';
import { DEFAULT_SETTINGS, type Direction, type StartPosition } from '../../shared/settings.js';
import { Priority } from '../../shared/events.js';
import { stepMs } from './events.js';
import { offset } from './map-runtime.js';
import { attackElement, elementRate, enemyStats, playerStats, stateRate, traitSum, type ActiveStates, type BattlerStats } from './stats.js';
import { mapRoom, sameZone, type PlayerSession, type World } from './world.js';

/** A map, or one instance of an instanced map. */
type Zone = { mapId: number; instance: number };

/** AI and state timers. */
const AI_TICK_MS = 100;
/** Monsters of a map without players are dropped after this delay. */
const IDLE_MAP_MS = 120_000;
/** Minimum time between two skills of a player. */
const GLOBAL_COOLDOWN_MS = 400;
/** Drops rarer than this (percent) are logged. */
const RARE_DROP_CHANCE = 10;
/** Out of combat for this long, players regenerate. */
const REGEN_DELAY_MS = 8000;

const DIRS: Direction[] = [2, 4, 6, 8];
const reverse = (d: Direction): Direction => (10 - d) as Direction;

/** Direction from one cell towards another (largest axis first). */
function towards(fromX: number, fromY: number, toX: number, toY: number): Direction {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 6 : 4;
  return dy > 0 ? 2 : dy < 0 ? 8 : dx > 0 ? 6 : 4;
}

/** Distance in cells (largest axis). */
const distance = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** A monster on a map. */
export interface Monster {
  id: number;
  def: EnemyData;
  spawn: number;
  x: number;
  y: number;
  direction: Direction;
  hp: number;
  mp: number;
  homeX: number;
  homeY: number;
  mode: 'idle' | 'chase' | 'flee' | 'return';
  /** Character chased. */
  targetId: number;
  nextMoveAt: number;
  nextActionAt: number;
  modeUntil: number;
  states: ActiveStates;
  /** Damage dealt by each character (rewards). */
  damage: Map<number, number>;
  dead: boolean;
  respawnAt: number;
  /** Called by a boss: removed for good when defeated. */
  summoned?: boolean;
  /** Boss in its enraged phase. */
  enraged?: boolean;
  /** Boss phases already started, and when each repeating mechanic fires next. */
  phases?: Map<number, number>;
}

/** Combat state of one map. */
class MapCombat {
  readonly monsters = new Map<number, Monster>();
  /** Cells blocked by solid events (monsters do not walk on them). */
  readonly blocked = new Set<number>();
  /** Candidate cells of each spawn. */
  readonly cells: number[][] = [];
  /** Positions changed since the last broadcast. */
  readonly moves = new Map<number, [number, number, number, Direction]>();
  emptySince = 0;

  constructor(readonly mapId: number, readonly instance: number, readonly map: MapData, readonly flags: readonly number[], readonly spawns: Spawn[]) {
    for (const e of map.events) {
      const page = e?.pages[0];
      if (e && page && page.priorityType === Priority.Same && !page.through) this.blocked.add(e.y * map.width + e.x);
    }
    for (const s of spawns) {
      const list: number[] = [];
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (s.region > 0 && tileAt(map, x, y, REGION_LAYER) !== s.region) continue;
          if (!DIRS.some((d) => isPassable(map, flags, x, y, d)) || this.blocked.has(y * map.width + x)) continue;
          list.push(y * map.width + x);
        }
      }
      this.cells.push(list);
    }
  }
}

/** A battler taking part in an action. */
type Combatant = { kind: 'player'; p: PlayerSession } | { kind: 'monster'; m: Monster; map: MapCombat };

/** Combat for the whole world. */
export class CombatSystem {
  /** Combat state of each zone (map, or instance of an instanced map), by room name. */
  private readonly maps = new Map<string, MapCombat>();
  private nextMonsterId = 1;
  private lastSecond = Date.now();

  constructor(private readonly world: World) {}

  private get ctx() {
    return this.world.ctx;
  }

  // --- Maps and monsters ------------------------------------------------------

  /** Combat state of a map, created (with its monsters) on first use. */
  private mapCombat(mapId: number, instance = 0): MapCombat | undefined {
    const key = mapRoom(mapId, instance);
    let mc = this.maps.get(key);
    if (!mc) {
      const runtime = this.world.mapRuntime(mapId);
      if (!runtime) return undefined;
      mc = new MapCombat(mapId, instance, runtime.map, runtime.flags, runtime.map.mmo.spawns ?? []);
      this.maps.set(key, mc);
      mc.spawns.forEach((s, i) => {
        const def = this.ctx.gameData.get('enemy', s.enemyId);
        if (def) for (let n = 0; n < s.count; n++) this.spawnMonster(mc!, def, i, false);
      });
    }
    return mc;
  }

  /** Places a new monster of a spawn on a free cell (or retries later when none is free). */
  private spawnMonster(mc: MapCombat, def: EnemyData, spawn: number, announce: boolean, reuse?: Monster): void {
    const cells = mc.cells[spawn] ?? [];
    const w = mc.map.width;
    let cell = -1;
    for (let tries = 0; tries < 20 && cells.length > 0; tries++) {
      const c = cells[Math.floor(Math.random() * cells.length)]!;
      if (!this.occupied(mc.mapId, c % w, Math.floor(c / w), mc.instance)) {
        cell = c;
        break;
      }
    }
    const now = Date.now();
    if (cell < 0) {
      if (reuse) reuse.respawnAt = now + 5000;
      return;
    }
    const stats = enemyStats(this.ctx, def, new Map());
    const m: Monster = reuse ?? {
      id: this.nextMonsterId++, def, spawn, x: 0, y: 0, direction: 2, hp: 0, mp: 0, homeX: 0, homeY: 0,
      mode: 'idle', targetId: 0, nextMoveAt: 0, nextActionAt: 0, modeUntil: 0, states: new Map(), damage: new Map(), dead: false, respawnAt: 0,
    };
    Object.assign(m, {
      def, x: cell % w, y: Math.floor(cell / w), homeX: cell % w, homeY: Math.floor(cell / w), direction: DIRS[Math.floor(Math.random() * 4)]!,
      hp: stats.params.mhp, mp: stats.params.mmp, mode: 'idle', targetId: 0, nextMoveAt: now + 500 + Math.random() * 2000, nextActionAt: now + 1000, dead: false,
    });
    m.states.clear();
    m.damage.clear();
    mc.monsters.set(m.id, m);
    if (announce) this.world.room(mc.mapId, mc.instance)?.emit('monsterSpawned', this.view(m));
  }

  /** View of a monster for clients. */
  private view(m: Monster): MonsterView {
    return {
      id: m.id, enemyId: m.def.id, name: m.def.name, characterName: m.def.characterName, characterIndex: m.def.characterIndex,
      x: m.x, y: m.y, direction: m.direction, hp: m.hp, maxHp: this.monsterStats(m).params.mhp, moveSpeed: m.def.moveSpeed,
    };
  }

  /** Monsters of a map as sent to a player entering it. */
  views(mapId: number, instance = 0): MonsterView[] {
    const mc = this.mapCombat(mapId, instance);
    return mc ? [...mc.monsters.values()].filter((m) => !m.dead).map((m) => this.view(m)) : [];
  }

  /** The map was edited: its monsters are recreated from the new spawns. */
  reloadMap(mapId: number): void {
    for (const [key, mc] of this.maps) if (mc.mapId === mapId) this.maps.delete(key);
  }

  /** Drops the combat state of an instance (the instance was closed). */
  dropZone(mapId: number, instance: number): void {
    this.maps.delete(mapRoom(mapId, instance));
  }

  /** Tells whether a living monster stands on a cell. */
  occupied(mapId: number, x: number, y: number, instance = 0): boolean {
    const mc = this.maps.get(mapRoom(mapId, instance));
    if (!mc) return false;
    for (const m of mc.monsters.values()) if (!m.dead && m.x === x && m.y === y) return true;
    return false;
  }

  /** Monster by id on a map. */
  monster(mapId: number, id: number, instance = 0): Monster | undefined {
    return this.maps.get(mapRoom(mapId, instance))?.monsters.get(id);
  }

  private monsterStats(m: Monster): BattlerStats {
    const stats = enemyStats(this.ctx, m.def, m.states);
    if (m.enraged) stats.params = { ...stats.params, atk: Math.floor(stats.params.atk * 1.5), mat: Math.floor(stats.params.mat * 1.5) };
    return stats;
  }

  // --- Bosses -------------------------------------------------------------------------

  /** Raid whose boss this monster is, in an instance of the raid's map. */
  private raidOf(mc: MapCombat, m: Monster) {
    if (!mc.instance) return undefined;
    const raid = this.world.instances.raidOn(mc.mapId);
    return raid && raid.bossEnemyId === m.def.id ? raid : undefined;
  }

  /** Phases of a fighting boss: adds, marked zones, enrage. */
  private bossTick(mc: MapCombat, m: Monster, now: number): void {
    const raid = this.raidOf(mc, m);
    if (!raid) return;
    const hpRate = (m.hp / Math.max(1, this.monsterStats(m).params.mhp)) * 100;
    m.phases ??= new Map();
    raid.phases.forEach((phase, index) => {
      if (hpRate >= phase.hpBelow) return;
      const next = m.phases!.get(index);
      if (next === undefined) {
        // The phase starts.
        m.phases!.set(index, phase.interval > 0 ? now + phase.interval * 1000 : Number.MAX_SAFE_INTEGER);
        if (phase.mechanic === 'enrage') {
          m.enraged = true;
          for (const p of this.world.playersOn(mc.mapId, mc.instance)) p.socket.emit('notify', { key: 'notify.boss_enraged', params: { name: m.def.name } });
        } else this.bossMechanic(mc, m, phase);
      } else if (now >= next && phase.mechanic !== 'enrage') {
        m.phases!.set(index, now + Math.max(1, phase.interval) * 1000);
        this.bossMechanic(mc, m, phase);
      }
    });
  }

  private bossMechanic(mc: MapCombat, m: Monster, phase: RaidData['phases'][number]): void {
    if (phase.mechanic === 'adds') {
      const def = this.ctx.gameData.get('enemy', phase.enemyId);
      if (!def) return;
      for (let i = 0; i < phase.count; i++) this.summon(mc, def, m.x, m.y);
      for (const p of this.world.playersOn(mc.mapId, mc.instance)) p.socket.emit('notify', { key: 'notify.boss_adds', params: { name: m.def.name } });
    } else if (phase.mechanic === 'zone') {
      const players = this.world.playersOn(mc.mapId, mc.instance).filter((p) => !p.combat.dead);
      const target = players[Math.floor(Math.random() * players.length)];
      if (target) this.strike(mc, target.x, target.y, phase.radius, phase.damage);
    }
  }

  /** A monster called by a boss (or by an event), on a free cell near a point. */
  private summon(mc: MapCombat, def: EnemyData, x: number, y: number): Monster | undefined {
    for (let r = 1; r <= 3; r++) {
      for (let tries = 0; tries < 8; tries++) {
        const cx = x + Math.floor(Math.random() * (2 * r + 1)) - r;
        const cy = y + Math.floor(Math.random() * (2 * r + 1)) - r;
        if (cx < 0 || cy < 0 || cx >= mc.map.width || cy >= mc.map.height) continue;
        if (!DIRS.some((d) => isPassable(mc.map, mc.flags, cx, cy, d)) || mc.blocked.has(cy * mc.map.width + cx) || this.occupied(mc.mapId, cx, cy, mc.instance)) continue;
        if (this.world.playersOn(mc.mapId, mc.instance).some((p) => p.x === cx && p.y === cy)) continue;
        const stats = enemyStats(this.ctx, def, new Map());
        const add: Monster = {
          id: this.nextMonsterId++, def, spawn: -1, x: cx, y: cy, direction: 2, hp: stats.params.mhp, mp: stats.params.mmp, homeX: cx, homeY: cy,
          mode: 'idle', targetId: 0, nextMoveAt: Date.now() + 500, nextActionAt: Date.now() + 1000, modeUntil: 0, states: new Map(), damage: new Map(), dead: false, respawnAt: 0, summoned: true,
        };
        mc.monsters.set(add.id, add);
        this.world.room(mc.mapId, mc.instance)?.emit('monsterSpawned', this.view(add));
        return add;
      }
    }
    return undefined;
  }

  /**
   * Event command "Battle": an enemy appears next to the player, in their zone,
   * and attacks them at once; it is removed for good when defeated.
   * @returns `false` when the enemy does not exist or no cell is free nearby.
   */
  ambush(p: PlayerSession, enemyId: number): boolean {
    const def = this.ctx.gameData.get('enemy', enemyId);
    const mc = def ? this.mapCombat(p.mapId, p.instance) : undefined;
    const m = def && mc ? this.summon(mc, def, p.x, p.y) : undefined;
    if (!m) return false;
    m.mode = 'chase';
    m.targetId = p.characterId;
    return true;
  }

  /** Marks an area, then hits the players still inside it. */
  private strike(mc: MapCombat, x: number, y: number, radius: number, damage: number): void {
    const ms = 1500;
    this.world.room(mc.mapId, mc.instance)?.emit('telegraph', { x, y, radius, ms });
    const timer = setTimeout(() => {
      if (this.maps.get(mapRoom(mc.mapId, mc.instance)) !== mc) return;
      const views: DamageView[] = [];
      for (const p of this.world.playersOn(mc.mapId, mc.instance)) {
        if (p.combat.dead || distance(p.x, p.y, x, y) > radius) continue;
        const target: Combatant = { kind: 'player', p };
        this.applyVitals(target, 'hp_damage', damage, null);
        views.push({ target: this.actor(target), amount: damage, kind: 'hp_damage', critical: false, hp: p.hp, maxHp: this.stats(p).params.mhp });
      }
      this.broadcastDamage(mc, views);
    }, ms);
    timer.unref();
  }

  // --- Players ------------------------------------------------------------------

  /** Battle parameters of a player (cached until equipment, level or states change). */
  stats(p: PlayerSession): BattlerStats {
    p.combat.stats ??= playerStats(this.ctx, p.characterId, p.classId, p.level, p.combat.states, p.allocated);
    return p.combat.stats;
  }

  /** Equipment, level or states changed: parameters are computed again. */
  invalidate(p: PlayerSession): void {
    p.combat.stats = null;
  }

  /** Tells whether a player may move (alive, no movement restriction). */
  canMove(p: PlayerSession): boolean {
    return !p.combat.dead && !this.restricted(p.combat.states, 'move');
  }

  private restricted(states: ActiveStates, what: 'move' | 'act'): boolean {
    for (const id of states.keys()) {
      const r = this.ctx.gameData.get('state', id)?.restriction ?? 'none';
      if (r === 'cannot_both' || r === (what === 'move' ? 'cannot_move' : 'cannot_act')) return true;
    }
    return false;
  }

  /** Skills a player knows (learnt from its class up to its level). */
  knownSkills(p: PlayerSession): SkillData[] {
    const cls = this.ctx.gameData.get('class', p.classId);
    const ids = [...new Set((cls?.learnings ?? []).filter((l) => l.level <= p.level).map((l) => l.skillId))];
    return ids.map((id) => this.ctx.gameData.get('skill', id)).filter((s): s is SkillData => s !== undefined);
  }

  /** Skills, hotbar and running cooldowns of a player. */
  skillsPayload(p: PlayerSession): SkillsPayload {
    const now = Date.now();
    const skills: SkillView[] = this.knownSkills(p).map((s) => ({ id: s.id, name: s.name, description: s.description, icon: s.icon, mpCost: s.mpCost, cooldown: s.cooldown, range: s.range }));
    const cooldowns: Record<number, number> = {};
    for (const [id, readyAt] of p.combat.cooldowns) if (readyAt > now) cooldowns[id] = readyAt - now;
    return { skills, hotbar: p.combat.hotbar, cooldowns };
  }

  /** Sends the skills payload. */
  pushSkills(p: PlayerSession): void {
    if (this.world.isLive(p)) p.socket.emit('skills', this.skillsPayload(p));
  }

  /** A player entered the world: hotbar loaded (filled with known skills when empty). */
  playerJoined(p: PlayerSession): void {
    p.combat.hotbar = this.ctx.progression.hotbar(p.characterId);
    if (p.combat.hotbar.every((s) => s === null)) {
      this.knownSkills(p).slice(0, HOTBAR_SIZE).forEach((s, i) => (p.combat.hotbar[i] = { kind: 'skill', id: s.id }));
    }
  }

  /** Stores a new hotbar sent by the player. */
  setHotbar(p: PlayerSession, slots: HotbarSlot[]): void {
    this.ctx.progression.setHotbar(p.characterId, slots);
    p.combat.hotbar = this.ctx.progression.hotbar(p.characterId);
  }

  /** The player's level changed: new skills are announced and placed on the hotbar. */
  levelChanged(p: PlayerSession, before: number): void {
    this.invalidate(p);
    if (p.level <= before) return;
    const cls = this.ctx.gameData.get('class', p.classId);
    const learnt = (cls?.learnings ?? []).filter((l) => l.level > before && l.level <= p.level);
    let changed = false;
    for (const l of learnt) {
      const skill = this.ctx.gameData.get('skill', l.skillId);
      if (!skill) continue;
      p.socket.emit('notify', { key: 'notify.skill_learned', params: { name: skill.name }, icon: skill.icon });
      const free = p.combat.hotbar.findIndex((s) => s === null);
      if (free >= 0 && !p.combat.hotbar.some((s) => s?.kind === 'skill' && s.id === skill.id)) {
        p.combat.hotbar[free] = { kind: 'skill', id: skill.id };
        changed = true;
      }
    }
    if (changed) this.ctx.progression.setHotbar(p.characterId, p.combat.hotbar);
    this.pushSkills(p);
  }

  // --- Combatants -----------------------------------------------------------------

  private actor(c: Combatant): CombatActor {
    return c.kind === 'player' ? { kind: 'player', id: c.p.characterId } : { kind: 'monster', id: c.m.id };
  }

  private statsOf(c: Combatant): BattlerStats {
    return c.kind === 'player' ? this.stats(c.p) : this.monsterStats(c.m);
  }

  private statesOf(c: Combatant): ActiveStates {
    return c.kind === 'player' ? c.p.combat.states : c.m.states;
  }

  private position(c: Combatant): { x: number; y: number; direction: Direction } {
    return c.kind === 'player' ? c.p : c.m;
  }

  private vitals(c: Combatant): { hp: number; mp: number; level: number } {
    return c.kind === 'player' ? { hp: c.p.hp, mp: c.p.mp, level: c.p.level } : { hp: c.m.hp, mp: c.m.mp, level: 1 };
  }

  /** Values a damage formula reads about a battler. */
  private formulaView(c: Combatant): Record<string, number> {
    return { ...this.statsOf(c).params, ...this.vitals(c) };
  }

  private alive(c: Combatant): boolean {
    return c.kind === 'player' ? !c.p.combat.dead && this.world.isLive(c.p) : !c.m.dead;
  }

  /** Monsters (and, on PvP maps, other players) standing on a cell, as seen by an attacker. */
  private targetsAt(mc: MapCombat, user: Combatant, x: number, y: number): Combatant[] {
    const out: Combatant[] = [];
    for (const m of mc.monsters.values()) if (!m.dead && m.x === x && m.y === y) out.push({ kind: 'monster', m, map: mc });
    if (user.kind === 'player' ? mc.map.mmo.pvp : true) {
      for (const p of this.world.playersOn(mc.mapId, mc.instance)) {
        if (p.x !== x || p.y !== y || p.combat.dead || (user.kind === 'player' && user.p === p)) continue;
        out.push({ kind: 'player', p });
      }
    }
    return out;
  }

  /** First hostile target on the line the user faces, within `range` cells. */
  private firstInLine(mc: MapCombat, user: Combatant, range: number): { target: Combatant | null; cell: { x: number; y: number } } {
    const pos = this.position(user);
    const { dx, dy } = offset(pos.direction);
    let cell = { x: pos.x + dx, y: pos.y + dy };
    for (let i = 1; i <= Math.max(1, range); i++) {
      const x = pos.x + dx * i;
      const y = pos.y + dy * i;
      if (x < 0 || y < 0 || x >= mc.map.width || y >= mc.map.height) break;
      cell = { x, y };
      const found = this.targetsAt(mc, user, x, y);
      if (found.length) return { target: found[0]!, cell };
    }
    return { target: null, cell };
  }

  // --- Damage -----------------------------------------------------------------

  /**
   * Computes and applies one hit.
   * @param normalAttack - Uses the attack element and critical rate of the user.
   */
  private hit(user: Combatant, target: Combatant, damage: Damage, normalAttack: boolean): DamageView | null {
    if (damage.type === 'none' || !this.alive(target)) return null;
    const a = this.statsOf(user);
    const b = this.statsOf(target);
    const hostile = damage.type === 'hp_damage' || damage.type === 'mp_damage';
    const maxHp = b.params.mhp;
    if (hostile) {
      const hitRate = COMBAT.hitRate + traitSum(a.traits, 'hit_rate');
      const evasion = COMBAT.evasionRate + traitSum(b.traits, 'evasion') + Math.max(0, (b.params.agi - a.params.agi) / 1000);
      if (Math.random() > hitRate || Math.random() < evasion) {
        return { target: this.actor(target), amount: 0, kind: 'miss', critical: false, hp: this.vitals(target).hp, maxHp };
      }
    }
    let value = evalFormula(damage.formula, this.formulaView(user), this.formulaView(target), (id) => (user.kind === 'player' ? this.world.getVariable(user.p, id) : 0));
    const element = normalAttack ? attackElement(a.traits) : damage.element;
    value *= elementRate(b.traits, element);
    if (damage.variance > 0) value *= 1 + ((Math.random() * 2 - 1) * damage.variance) / 100;
    let critical = false;
    if (hostile && (normalAttack || damage.critical)) {
      const rate = COMBAT.criticalRate + traitSum(a.traits, 'critical') + Math.max(0, (a.params.luk - b.params.luk) / 1000);
      critical = Math.random() < rate;
      if (critical) value *= COMBAT.criticalMultiplier;
    }
    const amount = Math.max(0, Math.round(value));
    this.applyVitals(target, damage.type, amount, user);
    return { target: this.actor(target), amount, kind: damage.type, critical, hp: this.vitals(target).hp, maxHp };
  }

  /** Changes HP / MP of a combatant, handling death and damage-removed states. */
  private applyVitals(target: Combatant, kind: Damage['type'], amount: number, source: Combatant | null): void {
    const max = this.statsOf(target).params;
    const sign = kind === 'hp_damage' || kind === 'mp_damage' ? -1 : 1;
    const hpKind = kind === 'hp_damage' || kind === 'hp_recover';
    if (target.kind === 'player') {
      const p = target.p;
      if (hpKind) p.hp = Math.max(0, Math.min(max.mhp, p.hp + sign * amount));
      else p.mp = Math.max(0, Math.min(max.mmp, p.mp + sign * amount));
      p.socket.emit('playerUpdate', { hp: p.hp, mp: p.mp });
      if (sign < 0) {
        p.combat.lastHurt = Date.now();
        this.removeOnDamage(target);
      }
      if (p.hp <= 0) this.playerDies(p);
    } else {
      const m = target.m;
      if (hpKind) m.hp = Math.max(0, Math.min(max.mhp, m.hp + sign * amount));
      else m.mp = Math.max(0, Math.min(max.mmp, m.mp + sign * amount));
      if (sign < 0 && source?.kind === 'player') {
        m.damage.set(source.p.characterId, (m.damage.get(source.p.characterId) ?? 0) + amount);
        // Any monster hit turns on its attacker (passive ones included).
        if (m.mode !== 'flee') {
          m.mode = 'chase';
          m.targetId = source.p.characterId;
        }
        this.removeOnDamage(target);
      }
      if (m.hp <= 0) this.monsterDies(target.map, m);
    }
  }

  private removeOnDamage(c: Combatant): void {
    const states = this.statesOf(c);
    let changed = false;
    for (const id of [...states.keys()]) {
      if (this.ctx.gameData.get('state', id)?.removeOnDamage) {
        states.delete(id);
        changed = true;
      }
    }
    if (changed) this.statesChanged(c);
  }

  /** Applies the effects of a skill or item to a target. */
  private applyEffects(user: Combatant, target: Combatant, effects: Effect[]): DamageView[] {
    const views: DamageView[] = [];
    const now = Date.now();
    const maxHp = () => this.statsOf(target).params.mhp;
    for (const e of effects) {
      if (!this.alive(target)) break;
      const states = this.statesOf(target);
      if (e.kind === 'add_state') {
        const state = this.ctx.gameData.get('state', e.value);
        if (!state || Math.random() * 100 >= e.percent * stateRate(this.statsOf(target).traits, state.id)) continue;
        states.set(state.id, state.duration > 0 ? now + state.duration * 1000 : Infinity);
        this.statesChanged(target);
        if (target.kind === 'player' && state.message) target.p.socket.emit('notify', { key: 'notify.state_added', params: { name: target.p.name, message: state.message }, icon: state.icon });
      } else if (e.kind === 'remove_state') {
        if (states.delete(e.value)) this.statesChanged(target);
      } else if (e.kind === 'recover_hp' || e.kind === 'recover_mp') {
        const params = this.statsOf(target).params;
        const amount = e.value + Math.floor(((e.kind === 'recover_hp' ? params.mhp : params.mmp) * e.percent) / 100);
        const kind = e.kind === 'recover_hp' ? 'hp_recover' : 'mp_recover';
        this.applyVitals(target, kind, amount, user);
        views.push({ target: this.actor(target), amount, kind, critical: false, hp: this.vitals(target).hp, maxHp: maxHp() });
      } else if (e.kind === 'gain_xp' && target.kind === 'player') {
        this.world.runner.setExp(target.p, target.p.xp + e.value, true);
      } else if (e.kind === 'common_event' && target.kind === 'player') {
        const list = this.ctx.gameData.get('commonEvent', e.value)?.list;
        if (list && !target.p.busy) void this.world.runner.runCommonList(target.p, list);
      }
    }
    return views;
  }

  /** States of a combatant changed (parameters, HUD icons). */
  private statesChanged(c: Combatant): void {
    if (c.kind !== 'player') return;
    this.invalidate(c.p);
    c.p.socket.emit('playerUpdate', { states: [...c.p.combat.states.keys()].map((id) => this.ctx.gameData.get('state', id)?.icon ?? 0) });
  }

  // --- Actions --------------------------------------------------------------------

  /** Broadcasts an action (animation) to the map. */
  private announce(zone: Zone, action: ActionView): void {
    // Targets may be battlers: only their coordinates are sent.
    this.world.room(zone.mapId, zone.instance)?.emit('combatAction', { ...action, targets: action.targets.map(({ x, y }) => ({ x, y })) });
  }

  private broadcastDamage(zone: Zone, views: DamageView[]): void {
    if (views.length) this.world.room(zone.mapId, zone.instance)?.emit('damage', views);
  }

  private animation(id: number): ActionView['animation'] {
    const a = id > 0 ? this.ctx.gameData.get('animation', id) : undefined;
    return a ? { sheet: a.sheet, frameCount: a.frameCount, frameSize: a.frameSize, fps: a.fps, sound: a.sound } : null;
  }

  /** Can a player act now (alive, not in a dialogue, not restricted)? */
  private ready(p: PlayerSession): boolean {
    return this.world.isLive(p) && !p.busy && !p.combat.dead && !this.restricted(p.combat.states, 'act');
  }

  /** Normal attack of a player in the direction it faces. */
  attack(p: PlayerSession): void {
    const now = Date.now();
    if (!this.ready(p) || now < p.combat.nextAttackAt) return;
    const mc = this.mapCombat(p.mapId, p.instance);
    if (!mc) return;
    const user: Combatant = { kind: 'player', p };
    const stats = this.stats(p);
    p.combat.nextAttackAt = now + Math.max(350, COMBAT.attackDelay * (1 - Math.min(0.4, stats.params.agi / 300)));
    const { target, cell } = this.firstInLine(mc, user, stats.attackRange);
    this.announce(mc, { actor: this.actor(user), direction: p.direction, skillId: 0, range: stats.attackRange, targets: [target ? this.position(target) : cell], animation: this.animation(stats.attackAnimation) });
    if (!target) return;
    const view = this.hit(user, target, { type: 'hp_damage', formula: COMBAT.attackFormula, element: 0, variance: 20, critical: true }, true);
    if (view) this.broadcastDamage(mc, [view]);
  }

  /** Uses a skill from the hotbar or the skill list. */
  useSkill(p: PlayerSession, skillId: number): void {
    const now = Date.now();
    if (!this.ready(p)) return;
    const skill = this.knownSkills(p).find((s) => s.id === skillId);
    if (!skill) return;
    if (now < p.combat.globalReadyAt || now < (p.combat.cooldowns.get(skillId) ?? 0)) return;
    if (p.mp < skill.mpCost) {
      p.socket.emit('notify', { key: 'error.combat.not_enough_mp' });
      return;
    }
    const mc = this.mapCombat(p.mapId, p.instance);
    if (!mc) return;
    const user: Combatant = { kind: 'player', p };
    const targets = this.skillTargets(mc, user, skill.scope, skill.range, skill.area);
    if (targets.hostile && targets.list.length === 0) {
      p.socket.emit('notify', { key: 'error.combat.no_target' });
      return;
    }
    p.mp -= skill.mpCost;
    p.socket.emit('playerUpdate', { mp: p.mp });
    p.combat.globalReadyAt = now + GLOBAL_COOLDOWN_MS;
    if (skill.cooldown > 0) {
      p.combat.cooldowns.set(skill.id, now + skill.cooldown * 1000);
      p.socket.emit('cooldown', { skillId: skill.id, ms: skill.cooldown * 1000 });
    }
    this.perform(mc, user, skill, targets.list, targets.cells);
  }

  /** Resolves the targets of a skill scope. */
  private skillTargets(mc: MapCombat, user: Combatant, scope: Scope, range: number, area: number): { list: Combatant[]; cells: { x: number; y: number }[]; hostile: boolean } {
    const pos = this.position(user);
    if (scope === 'enemy' || scope === 'enemies_area') {
      const { target, cell } = this.firstInLine(mc, user, Math.max(1, range));
      if (scope === 'enemy') return { list: target ? [target] : [], cells: [target ? this.position(target) : cell], hostile: true };
      const center = target ? this.position(target) : cell;
      const list: Combatant[] = [];
      for (let y = center.y - area; y <= center.y + area; y++) for (let x = center.x - area; x <= center.x + area; x++) list.push(...this.targetsAt(mc, user, x, y));
      return { list, cells: [center], hostile: true };
    }
    if (scope === 'allies_area') {
      const list: Combatant[] = user.kind === 'player'
        ? this.world.playersOn(mc.mapId, mc.instance).filter((o) => !o.combat.dead && distance(o.x, o.y, pos.x, pos.y) <= Math.max(area, 1)).map((o) => ({ kind: 'player', p: o }))
        : [...mc.monsters.values()].filter((m) => !m.dead && distance(m.x, m.y, pos.x, pos.y) <= Math.max(area, 1)).map((m) => ({ kind: 'monster', m, map: mc }));
      return { list, cells: [pos], hostile: false };
    }
    if (scope === 'ally' && user.kind === 'player') {
      // The ally faced within range, or the user itself.
      const { dx, dy } = offset(pos.direction);
      for (let i = 1; i <= Math.max(1, range); i++) {
        const other = this.world.playersOn(mc.mapId, mc.instance).find((o) => o !== user.p && !o.combat.dead && o.x === pos.x + dx * i && o.y === pos.y + dy * i);
        if (other) return { list: [{ kind: 'player', p: other }], cells: [other], hostile: false };
      }
    }
    return { list: [user], cells: [pos], hostile: false };
  }

  /** Performs a skill on resolved targets (damage, effects, animation). */
  private perform(mc: MapCombat, user: Combatant, skill: SkillData, targets: Combatant[], cells: { x: number; y: number }[]): void {
    const pos = this.position(user);
    this.announce(mc, { actor: this.actor(user), direction: pos.direction, skillId: skill.id, range: skill.range, targets: cells, animation: this.animation(skill.animationId) });
    const views: DamageView[] = [];
    for (const target of targets) {
      const view = this.hit(user, target, skill.damage, false);
      if (view) views.push(view);
      if (view?.kind !== 'miss') views.push(...this.applyEffects(user, target, skill.effects));
    }
    this.broadcastDamage(mc, views);
  }

  // --- Deaths ------------------------------------------------------------------------

  /**
   * A monster died: rewards for everyone who hurt it (shared with their party
   * members on the map), then its respawn timer.
   */
  private monsterDies(mc: MapCombat, m: Monster): void {
    if (m.dead) return;
    m.dead = true;
    m.respawnAt = Date.now() + Math.max(1, m.def.respawn) * 1000;
    const raid = this.raidOf(mc, m);
    // Monsters called by a boss are gone for good; a raid boss does not come back in its instance.
    if (m.summoned) mc.monsters.delete(m.id);
    if (raid) m.respawnAt = Number.MAX_SAFE_INTEGER;
    this.world.room(mc.mapId, mc.instance)?.emit('monsterRemoved', { id: m.id, died: true });
    const rewarded = new Set<number>();
    for (const characterId of m.damage.keys()) {
      const p = this.world.player(characterId);
      if (!p || !sameZone(p, mc) || !this.world.isLive(p) || rewarded.has(characterId)) continue;
      const group = this.world.party.membersNear(p).filter((g) => !rewarded.has(g.characterId));
      for (const g of group) rewarded.add(g.characterId);
      this.reward(p, group, m.def);
    }
    m.damage.clear();
    const instance = raid ? this.world.instances.get(mc.instance) : undefined;
    if (raid && instance) this.world.raids.bossDefeated(raid, instance);
  }

  /**
   * Experience, gold and drops of a defeated enemy for a player and its party
   * members on the map: experience and gold are split (+10 % per extra
   * member); drops are rolled by each member (personal loot) or once and
   * given in turn (shared loot).
   */
  private reward(p: PlayerSession, group: PlayerSession[], def: EnemyData): void {
    const members = group.length ? group : [p];
    const bonus = 1 + 0.1 * (members.length - 1);
    const exp = Math.floor((def.exp * bonus) / members.length);
    const gold = Math.floor((def.gold * bonus) / members.length);
    for (const g of members) {
      if (exp > 0) {
        g.socket.emit('notify', { key: 'notify.exp_gained', params: { amount: exp } });
        this.world.runner.setExp(g, g.xp + exp, true);
      }
      if (gold > 0) this.world.changeGold(g, gold);
      this.world.quests.onKill(g, def.id);
    }
    for (const drop of def.drops) {
      const taker = this.world.party.lootTaker(p, members);
      const give = (g: PlayerSession) => {
        if (Math.random() * 100 >= drop.chance) return;
        this.world.changeItems(g, drop.kind, drop.id, 1);
        // Rare drops are logged for the administrators.
        if (drop.chance < RARE_DROP_CHANCE) this.ctx.admin.logDrop(g.characterId, def.id, drop.kind, drop.id, drop.chance);
      };
      if (taker) give(taker);
      else for (const g of members) give(g);
    }
  }

  /** A player reached 0 HP: it reappears at its respawn point after a short delay. */
  private playerDies(p: PlayerSession): void {
    if (p.combat.dead) return;
    p.combat.dead = true;
    p.combat.states.clear();
    this.world.trade.cancel(p);
    this.statesChanged({ kind: 'player', p });
    p.socket.emit('playerDied', { seconds: COMBAT.respawnSeconds });
    const session = p;
    setTimeout(() => {
      if (!this.world.isLive(session) || !session.combat.dead) return;
      const { params } = this.stats(session);
      session.combat.dead = false;
      session.hp = params.mhp;
      session.mp = params.mmp;
      session.socket.emit('playerUpdate', { hp: session.hp, mp: session.mp });
      const start = this.ctx.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition);
      const point = this.ctx.progression.respawn(session.characterId) ?? start;
      if (!this.world.transfer(session, point.mapId, point.x, point.y, 2)) this.world.transfer(session, start.mapId, start.x, start.y, start.direction);
    }, COMBAT.respawnSeconds * 1000);
  }

  // --- Monster AI ----------------------------------------------------------------------

  /** Can a monster step from its cell towards `d`? */
  private monsterCanStep(mc: MapCombat, m: Monster, d: Direction): boolean {
    const { dx, dy } = offset(d);
    const x = m.x + dx;
    const y = m.y + dy;
    if (x < 0 || y < 0 || x >= mc.map.width || y >= mc.map.height) return false;
    if (!canMove(mc.map, mc.flags, m.x, m.y, d) || mc.blocked.has(y * mc.map.width + x)) return false;
    if (this.occupied(mc.mapId, x, y, mc.instance)) return false;
    return !this.world.playersOn(mc.mapId, mc.instance).some((p) => p.x === x && p.y === y);
  }

  private stepMonster(mc: MapCombat, m: Monster, d: Direction): boolean {
    m.direction = d;
    if (!this.monsterCanStep(mc, m, d)) {
      mc.moves.set(m.id, [m.id, m.x, m.y, m.direction]);
      return false;
    }
    const { dx, dy } = offset(d);
    m.x += dx;
    m.y += dy;
    mc.moves.set(m.id, [m.id, m.x, m.y, m.direction]);
    return true;
  }

  /** Steps towards a cell (largest axis first, then the other one). */
  private stepTowards(mc: MapCombat, m: Monster, x: number, y: number, away = false): void {
    const dx = x - m.x;
    const dy = y - m.y;
    const horizontal: Direction = dx > 0 ? 6 : 4;
    const vertical: Direction = dy > 0 ? 2 : 8;
    let order: Direction[] = Math.abs(dx) > Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal];
    if (dx === 0) order = [vertical, 4, 6];
    if (dy === 0) order = [horizontal, 8, 2];
    if (away) order = order.map(reverse);
    for (const d of order) if (this.stepMonster(mc, m, d)) return;
  }

  /** The player a monster chases, if still valid. */
  private target(mc: MapCombat, m: Monster): PlayerSession | undefined {
    const p = m.targetId ? this.world.player(m.targetId) : undefined;
    return p && sameZone(p, mc) && !p.combat.dead && this.world.isLive(p) ? p : undefined;
  }

  /** Nearest player within the aggro radius (players in a dialogue are left alone). */
  private spot(mc: MapCombat, m: Monster): PlayerSession | undefined {
    let best: PlayerSession | undefined;
    let bestDistance = m.def.aggroRadius + 1;
    for (const p of this.world.playersOn(mc.mapId, mc.instance)) {
      if (p.combat.dead || p.busy) continue;
      const d = distance(p.x, p.y, m.x, m.y);
      if (d < bestDistance) {
        best = p;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Runs one AI step of a monster. */
  private think(mc: MapCombat, m: Monster, now: number): void {
    const stats = this.monsterStats(m);
    const moveMs = stepMs(m.def.moveSpeed);
    const canMoveNow = now >= m.nextMoveAt && !this.restricted(m.states, 'move');
    const canAct = now >= m.nextActionAt && !this.restricted(m.states, 'act');
    const tooFar = distance(m.x, m.y, m.homeX, m.homeY) > COMBAT.leash;
    if (m.mode === 'idle') {
      if (m.def.ai !== 'passive') {
        const seen = this.spot(mc, m);
        if (seen) {
          m.mode = 'chase';
          m.targetId = seen.characterId;
        }
      }
      if (m.mode === 'idle' && canMoveNow) {
        // Wander around home.
        const d = distance(m.x, m.y, m.homeX, m.homeY) > 3 ? towards(m.x, m.y, m.homeX, m.homeY) : DIRS[Math.floor(Math.random() * 4)]!;
        this.stepMonster(mc, m, d);
        m.nextMoveAt = now + moveMs + 1500 + Math.random() * 3000;
      }
      return;
    }
    if (m.mode === 'return') {
      if (m.x === m.homeX && m.y === m.homeY) {
        m.mode = 'idle';
        m.hp = stats.params.mhp;
        m.damage.clear();
        return;
      }
      if (canMoveNow) {
        const before = m.x * 1000 + m.y;
        this.stepTowards(mc, m, m.homeX, m.homeY);
        // Stuck on the way home: teleport there.
        if (m.x * 1000 + m.y === before && Math.random() < 0.1) {
          m.x = m.homeX;
          m.y = m.homeY;
          mc.moves.set(m.id, [m.id, m.x, m.y, m.direction]);
        }
        m.nextMoveAt = now + moveMs;
      }
      return;
    }
    const target = this.target(mc, m);
    if (target && !tooFar) this.bossTick(mc, m, now);
    if (!target || tooFar) {
      m.mode = 'return';
      m.targetId = 0;
      return;
    }
    if (m.mode === 'flee') {
      if (now > m.modeUntil) m.mode = 'return';
      else if (canMoveNow) {
        this.stepTowards(mc, m, target.x, target.y, true);
        m.nextMoveAt = now + moveMs;
      }
      return;
    }
    if (m.def.ai === 'coward' && m.hp < stats.params.mhp * 0.3) {
      m.mode = 'flee';
      m.modeUntil = now + 4000;
      return;
    }
    // Chase and attack.
    const inLine = target.x === m.x || target.y === m.y;
    const gap = Math.abs(target.x - m.x) + Math.abs(target.y - m.y);
    if (canAct && inLine && gap >= 1) {
      // The normal attack, or one of the enemy's skills whose reach covers the gap.
      const skills = m.def.actions.flatMap((a) => {
        const skill = this.ctx.gameData.get('skill', a.skillId);
        return skill && (skill.damage.type !== 'none' || skill.effects.length > 0) ? [{ skill, weight: a.weight, range: Math.max(1, skill.range) }] : [];
      });
      const options = [{ skill: null as SkillData | null, weight: 5, range: 1 }, ...skills].filter((o) => gap <= o.range);
      if (options.length) {
        let roll = Math.random() * options.reduce((s, o) => s + o.weight, 0);
        const choice = options.find((o) => (roll -= o.weight) < 0) ?? options[0]!;
        m.direction = towards(m.x, m.y, target.x, target.y);
        mc.moves.set(m.id, [m.id, m.x, m.y, m.direction]);
        this.monsterAct(mc, m, choice.skill);
        m.nextActionAt = now + Math.max(800, 2000 - stats.params.agi * 10) / (m.enraged ? 2 : 1);
        m.nextMoveAt = Math.max(m.nextMoveAt, now + 300);
        return;
      }
    }
    if (canMoveNow && gap > 1) {
      this.stepTowards(mc, m, target.x, target.y);
      m.nextMoveAt = now + moveMs;
    } else if (canMoveNow && !inLine) {
      this.stepTowards(mc, m, target.x, target.y);
      m.nextMoveAt = now + moveMs;
    }
  }

  /** A monster attacks (normal attack when `skill` is null) in the direction it faces. */
  private monsterAct(mc: MapCombat, m: Monster, skill: SkillData | null): void {
    const user: Combatant = { kind: 'monster', m, map: mc };
    if (skill) {
      const targets = this.skillTargets(mc, user, skill.scope, skill.range, skill.area);
      if (targets.hostile && targets.list.length === 0) return;
      this.perform(mc, user, skill, targets.list, targets.cells);
      return;
    }
    const { target, cell } = this.firstInLine(mc, user, 1);
    this.announce(mc, { actor: this.actor(user), direction: m.direction, skillId: 0, range: 1, targets: [target ? this.position(target) : cell], animation: null });
    if (!target || target.kind !== 'player') return;
    const view = this.hit(user, target, { type: 'hp_damage', formula: COMBAT.attackFormula, element: 0, variance: 20, critical: true }, true);
    if (view) this.broadcastDamage(mc, [view]);
  }

  // --- Ticks ------------------------------------------------------------------------

  /** Server tick: AI of the monsters of maps with players, states every second, respawns. */
  tick(): void {
    const now = Date.now();
    const second = now - this.lastSecond >= 1000;
    if (second) this.lastSecond = now;
    for (const [key, mc] of this.maps) {
      const players = this.world.playersOn(mc.mapId, mc.instance);
      if (players.length === 0) {
        mc.emptySince ||= now;
        if (now - mc.emptySince > IDLE_MAP_MS) this.maps.delete(key);
        continue;
      }
      mc.emptySince = 0;
      for (const m of mc.monsters.values()) {
        if (m.dead) {
          if (now >= m.respawnAt) this.spawnMonster(mc, m.def, m.spawn, true, m);
          continue;
        }
        try {
          this.think(mc, m, now);
        } catch (err) {
          // One faulty monster (bad data) must not stop the others.
          console.error('[combat] monster AI error', err);
        }
        if (second && !m.dead) this.stateTick({ kind: 'monster', m, map: mc }, now);
      }
    }
    if (second) for (const p of this.world.allPlayers()) this.playerSecond(p, now);
  }

  /** States (HP / MP per second, expiry) of one combatant, once per second. */
  private stateTick(c: Combatant, now: number): void {
    const states = this.statesOf(c);
    if (states.size === 0) return;
    const views: DamageView[] = [];
    let expired = false;
    for (const [id, until] of [...states]) {
      const state = this.ctx.gameData.get('state', id);
      if (!state || now >= until) {
        states.delete(id);
        expired = true;
        continue;
      }
      const params = this.statsOf(c).params;
      for (const [rate, hp] of [[state.hpPerSecond, true], [state.mpPerSecond, false]] as const) {
        if (!rate) continue;
        const amount = Math.max(1, Math.floor(((hp ? params.mhp : params.mmp) * Math.abs(rate)) / 100));
        const kind = rate < 0 ? (hp ? 'hp_damage' : 'mp_damage') : hp ? 'hp_recover' : 'mp_recover';
        this.applyVitals(c, kind, amount, null);
        if (hp) views.push({ target: this.actor(c), amount, kind, critical: false, hp: this.vitals(c).hp, maxHp: params.mhp });
        if (!this.alive(c)) break;
      }
    }
    if (expired) this.statesChanged(c);
    this.broadcastDamage(c.kind === 'player' ? c.p : c.map, views);
  }

  /** Once per second for each player: states and regeneration out of combat. */
  private playerSecond(p: PlayerSession, now: number): void {
    if (!this.world.isLive(p) || p.combat.dead) return;
    this.stateTick({ kind: 'player', p }, now);
    if (p.combat.dead || now - p.combat.lastHurt < REGEN_DELAY_MS) return;
    const { params } = this.stats(p);
    if (p.hp >= params.mhp && p.mp >= params.mmp) return;
    p.hp = Math.min(params.mhp, p.hp + Math.max(1, Math.floor(params.mhp * 0.02)));
    p.mp = Math.min(params.mmp, p.mp + Math.max(1, Math.floor(params.mmp * 0.02)));
    p.socket.emit('playerUpdate', { hp: p.hp, mp: p.mp });
  }

  /** Monster positions changed since the last call, per map (flushed by the world tick). */
  flushMoves(): [number, number, [number, number, number, Direction][]][] {
    const out: [number, number, [number, number, number, Direction][]][] = [];
    for (const mc of this.maps.values()) {
      if (mc.moves.size) out.push([mc.mapId, mc.instance, [...mc.moves.values()]]);
      mc.moves.clear();
    }
    return out;
  }

  /** Positions of the living monsters of a zone, as `[id, x, y, direction]`. */
  positions(mapId: number, instance: number): [number, number, number, Direction][] {
    const mc = this.maps.get(mapRoom(mapId, instance));
    return mc ? [...mc.monsters.values()].filter((m) => !m.dead).map((m) => [m.id, m.x, m.y, m.direction]) : [];
  }

  /** Interval of the AI tick. */
  static readonly TICK_MS = AI_TICK_MS;
}
