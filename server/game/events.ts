/**
 * @file Running events for players: page conditions, triggers (action,
 * touch, automatic, parallel), the interpreter host (what each command does
 * to the world), move routes and the autonomous movement of events.
 *
 * Everything here works on one player's copies of the events (see
 * map-runtime.ts): a route moving an NPC, a balloon or an erased event is
 * seen by that player only, while switches and variables declared global
 * affect everybody.
 */
import { EQUIP_SLOTS, expForLevel, paramAt } from '../../shared/database.js';
import { QuestStatus, RouteCmd, Trigger, questStatusMatches, type EventCommand, type EventConditions, type MoveRoute, type SelfSwitch } from '../../shared/events.js';
import type { EffectPayload, EventUpdate, MessagePayload } from '../../shared/protocol.js';
import { DEFAULT_SETTINGS, type Direction } from '../../shared/settings.js';
import { selfSwitchKey } from '../db/progression.js';
import { runCommands, type CharacterRef, type InterpreterHost } from '../events/interpreter.js';
import { evaluateScript, runScript, type ScriptState } from '../events/sandbox.js';
import { MapRuntime, offset, type EventInstance } from './map-runtime.js';
import { experienceRange } from './player-info.js';
import type { PlayerSession, World } from './world.js';

/** Longest time a message may stay open before the run gives up. */
const MESSAGE_TIMEOUT_MS = 30 * 60_000;
/** Minimum pause between two iterations of a parallel event. */
const PARALLEL_MIN_MS = 100;
/** Duration of a balloon icon. */
const BALLOON_MS = 1000;
/** Player walking speed. */
const PLAYER_SPEED = 4;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Milliseconds to walk one cell at a move speed (1–6). */
export function stepMs(speed: number): number {
  return ((256 / 2 ** speed) * 1000) / 60;
}

/** Direction from one cell towards another (largest axis first). */
function towards(fromX: number, fromY: number, toX: number, toY: number): Direction {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 6 : 4;
  return dy > 0 ? 2 : dy < 0 ? 8 : dx > 0 ? 6 : 4;
}

const reverse = (d: Direction): Direction => (10 - d) as Direction;
const RIGHT: Record<Direction, Direction> = { 2: 4, 4: 8, 8: 6, 6: 2 };
const LEFT: Record<Direction, Direction> = { 2: 6, 6: 8, 8: 4, 4: 2 };
const DIRS: Direction[] = [2, 4, 6, 8];
const randomDir = (): Direction => DIRS[Math.floor(Math.random() * 4)]!;

/** Something a move route can move: an event copy or the player. */
interface RouteActor {
  state(): { x: number; y: number; direction: Direction };
  speed(): number;
  /** Tries one step; returns `false` when blocked. */
  step(d: Direction): boolean;
  turn(d: Direction): void;
  /** Applies a setting command (speed, flags, image, sound). */
  setting(code: number, params: unknown[]): void;
}

/** Context of one run of a command list. */
interface RunContext {
  p: PlayerSession;
  /** Event running the commands (null for common events started on their own). */
  event: EventInstance | null;
  mapId: number;
  eventId: number;
  /** Map generation the run started on (targets on that map stop being valid after a transfer). */
  gen: number;
  /** Move routes started by this run, for "wait for completion". */
  routes: Promise<void>[];
  /** Extra condition for the run to go on (parallel events stop when their page changes). */
  valid: () => boolean;
}

/** Event execution for every player. */
export class EventRunner {
  /** Parallel runs in progress, per character (keys `e<id>` / `c<id>`). */
  private readonly parallels = new Map<number, Set<string>>();
  /** Time the last automatic event of a character ended (runaway protection). */
  private readonly lastAutorun = new Map<number, number>();
  private readonly autorunTimers = new Set<number>();

  constructor(private readonly world: World) {}

  private get ctx() {
    return this.world.ctx;
  }

  // --- Conditions and triggers ------------------------------------------------

  /** Tells whether page conditions hold for a player. */
  conditionsHold(p: PlayerSession, e: EventInstance, c: EventConditions): boolean {
    const w = this.world;
    if (c.switch1Valid && !w.getSwitch(p, c.switch1Id)) return false;
    if (c.switch2Valid && !w.getSwitch(p, c.switch2Id)) return false;
    if (c.variableValid && w.getVariable(p, c.variableId) < c.variableValue) return false;
    if (c.selfSwitchValid && !p.progress.selfSwitches.has(selfSwitchKey(p.mapId, e.def.id, c.selfSwitchCh))) return false;
    if (c.itemValid && this.ctx.inventory.quantity(p.characterId, 'item', c.itemId) < 1) return false;
    if (c.levelValid === true && p.level < (c.level ?? 1)) return false;
    if (c.questValid === true) {
      const id = c.questId ?? 0;
      const status = this.world.quests.status(p, id);
      const wanted = c.questStatus ?? QuestStatus.InProgress;
      if (!questStatusMatches(status, wanted)) return false;
      if (wanted === QuestStatus.InProgress && (p.progress.quests.get(id)?.step ?? 0) < (c.questStep ?? 0)) return false;
    }
    return true;
  }

  /** Commands of an active common event with a trigger, or `null`. */
  private commonList(p: PlayerSession, id: number, trigger: 'autorun' | 'parallel'): EventCommand[] | null {
    const ce = this.ctx.gameData.get('commonEvent', id);
    if (!ce || ce.trigger !== trigger) return null;
    if (ce.switchId > 0 && !this.world.getSwitch(p, ce.switchId)) return null;
    return ce.list;
  }

  /** Starts the parallel events that are active and not running, then the first automatic event. */
  startTriggers(p: PlayerSession): void {
    if (!this.world.isLive(p)) return;
    const running = this.parallels.get(p.characterId) ?? new Set<string>();
    this.parallels.set(p.characterId, running);
    for (const e of p.events.values()) {
      const key = `e${e.def.id}`;
      if (running.has(key) || MapRuntime.page(e)?.trigger !== Trigger.Parallel) continue;
      const page = MapRuntime.page(e)!;
      void this.parallel(p, key, () => (p.events.get(e.def.id) === e && MapRuntime.page(e) === page ? page.list : null), e);
    }
    for (const ce of this.ctx.gameData.list('commonEvent')) {
      const key = `c${ce.id}`;
      if (running.has(key) || !this.commonList(p, ce.id, 'parallel')) continue;
      void this.parallel(p, key, () => this.commonList(p, ce.id, 'parallel'), null);
    }
    if (p.busy || this.autorunTimers.has(p.characterId)) return;
    const auto = [...p.events.values()].find((e) => MapRuntime.page(e)?.trigger === Trigger.Autorun);
    const common = auto ? null : this.ctx.gameData.list('commonEvent').find((ce) => this.commonList(p, ce.id, 'autorun'));
    if (!auto && !common) return;
    // An automatic event that stays active re-runs; space the runs so a
    // forgotten switch cannot spin the server.
    const since = Date.now() - (this.lastAutorun.get(p.characterId) ?? 0);
    const delay = since < 200 ? 200 : 0;
    this.autorunTimers.add(p.characterId);
    setTimeout(() => {
      this.autorunTimers.delete(p.characterId);
      if (!this.world.isLive(p) || p.busy) return;
      if (auto && p.events.get(auto.def.id) === auto && MapRuntime.page(auto)?.trigger === Trigger.Autorun) void this.run(p, auto);
      else if (common) {
        const list = this.commonList(p, common.id, 'autorun');
        if (list) void this.runCommon(p, list);
      }
    }, delay);
  }

  /** Runs an event's active page for a player (action, touch or automatic trigger). */
  async run(p: PlayerSession, e: EventInstance): Promise<void> {
    const page = MapRuntime.page(e);
    if (!page || p.busy || e.locked) return;
    p.busy = true;
    e.locked = true;
    const gen = p.mapGen;
    const prelock = e.direction;
    const turned = !e.directionFix && page.trigger === Trigger.Action;
    if (turned) {
      // Face the player while talking.
      e.direction = towards(e.x, e.y, p.x, p.y);
      if (e.direction !== prelock) p.socket.emit('eventUpdate', { id: e.def.id, direction: e.direction });
    }
    const mapId = p.mapId;
    try {
      await runCommands(page.list, this.host({ p, event: e, mapId, eventId: e.def.id, gen, routes: [], valid: () => true }));
    } finally {
      e.locked = false;
      // Talking to an event (or touching it) fulfils "talk to" objectives.
      if (page.trigger <= Trigger.EventTouch && this.world.isLive(p)) this.world.quests.onTalk(p, mapId, e.def.id);
      if (turned && p.mapGen === gen && e.direction !== prelock && p.events.get(e.def.id) === e) {
        e.direction = prelock;
        if (this.world.isLive(p)) p.socket.emit('eventUpdate', { id: e.def.id, direction: prelock });
      }
      if (page.trigger === Trigger.Autorun) this.lastAutorun.set(p.characterId, Date.now());
      p.busy = false;
      this.world.refreshEvents(p);
    }
  }

  /** Runs the commands of a common event for a player (automatic trigger, item or skill effect). */
  async runCommonList(p: PlayerSession, list: EventCommand[]): Promise<void> {
    return this.runCommon(p, list);
  }

  /** Runs an automatic common event. */
  private async runCommon(p: PlayerSession, list: EventCommand[]): Promise<void> {
    p.busy = true;
    try {
      await runCommands(list, this.host({ p, event: null, mapId: p.mapId, eventId: 0, gen: p.mapGen, routes: [], valid: () => true }));
    } finally {
      this.lastAutorun.set(p.characterId, Date.now());
      p.busy = false;
      this.world.refreshEvents(p);
    }
  }

  /** Runs a parallel event over and over while its page (or switch) stays active. */
  private async parallel(p: PlayerSession, key: string, current: () => EventCommand[] | null, e: EventInstance | null): Promise<void> {
    const running = this.parallels.get(p.characterId)!;
    running.add(key);
    const gen = p.mapGen;
    try {
      while (this.world.isLive(p) && p.mapGen === gen) {
        const list = current();
        if (!list) break;
        const started = Date.now();
        await runCommands(list, this.host({ p, event: e, mapId: p.mapId, eventId: e?.def.id ?? 0, gen, routes: [], valid: () => p.mapGen === gen && current() === list }));
        await sleep(Math.max(PARALLEL_MIN_MS - (Date.now() - started), 16));
      }
    } finally {
      running.delete(key);
      if (running.size === 0 && !this.world.isLive(p)) this.parallels.delete(p.characterId);
    }
  }

  // --- Interpreter host -------------------------------------------------------

  /** Resolves a character reference of a run: the player, the running event or another event. */
  private target(run: RunContext, ref: CharacterRef): EventInstance | 'player' | null {
    if (ref < 0) return 'player';
    if (run.p.mapGen !== run.gen) return null;
    if (ref === 0) return run.event;
    return run.p.events.get(ref) ?? null;
  }

  /** Copy of the player's state given to scripts. */
  private scriptState(run: RunContext): ScriptState {
    const { p } = run;
    const w = this.world;
    const variables: Record<number, number> = Object.fromEntries([...p.progress.variables, ...[...w.global.variables].filter(([id]) => w.isGlobalVariable(id))]);
    const switches: Record<number, boolean> = {};
    for (const id of p.progress.switches) if (!w.isGlobalSwitch(id)) switches[id] = true;
    for (const id of w.global.switches) if (w.isGlobalSwitch(id)) switches[id] = true;
    const selfSwitches: Record<string, boolean> = {};
    for (const letter of ['A', 'B', 'C', 'D'] as const) selfSwitches[letter] = p.progress.selfSwitches.has(selfSwitchKey(run.mapId, run.eventId, letter));
    const items: Record<number, number> = {};
    for (const row of this.ctx.inventory.list(p.characterId)) if (row.kind === 'item') items[row.id] = row.quantity;
    return { variables, switches, selfSwitches, gold: this.ctx.inventory.gold(p.characterId), level: p.level, items, player: { name: p.name, mapId: p.mapId, x: p.x, y: p.y } };
  }

  /** Builds what the interpreter uses to act on the world for one run. */
  private host(run: RunContext): InterpreterHost {
    const { p } = run;
    const w = this.world;
    const ctx = this.ctx;
    const emitEffect = (effect: EffectPayload) => p.socket.emit('effect', effect);
    const targetId = (t: EventInstance | 'player') => (t === 'player' ? 0 : t.def.id);
    return {
      isActive: () => w.isLive(p) && run.valid(),
      showMessage: (message: MessagePayload) => this.ask(p, message),
      playerName: () => p.name,
      currencyName: () => w.currencyName(),

      getSwitch: (id) => w.getSwitch(p, id),
      setSwitch: (id, on) => w.setSwitch(p, id, on),
      getVariable: (id) => w.getVariable(p, id),
      setVariable: (id, value) => w.setVariable(p, id, value),
      getSelfSwitch: (letter) => p.progress.selfSwitches.has(selfSwitchKey(run.mapId, run.eventId, letter)),
      setSelfSwitch: (letter: SelfSwitch, on) => {
        if (run.eventId <= 0) return;
        if (p.progress.selfSwitches.has(selfSwitchKey(run.mapId, run.eventId, letter)) === on) return;
        ctx.progression.setSelfSwitch(p.characterId, p.progress, run.mapId, run.eventId, letter, on);
        w.refreshEvents(p);
      },

      gold: () => ctx.inventory.gold(p.characterId),
      level: () => p.level,
      exp: () => p.xp,
      vitals: () => ({ hp: p.hp, mp: p.mp }),
      itemCount: (kind, id, includeEquipped) => {
        let n = ctx.inventory.quantity(p.characterId, kind, id);
        if (includeEquipped && kind !== 'item') for (const eq of ctx.progression.equipment(p.characterId).values()) if (eq.kind === kind && eq.id === id) n++;
        return n;
      },
      mapId: () => p.mapId,
      characterState: (ref) => {
        const t = this.target(run, ref);
        if (!t) return null;
        return t === 'player' ? { x: p.x, y: p.y, direction: p.direction } : { x: t.x, y: t.y, direction: t.direction };
      },
      questStatus: (id) => ({ status: w.quests.status(p, id), step: p.progress.quests.get(id)?.step ?? 0 }),

      changeGold: (delta) => void w.changeGold(p, delta),
      changeItems: (kind, id, delta) => void w.changeItems(p, kind, id, delta),
      changeHp: (delta, allowDeath) => {
        const { maxHp } = w.maxVitals(p);
        p.hp = Math.max(allowDeath ? 0 : 1, Math.min(maxHp, p.hp + delta));
        p.socket.emit('playerUpdate', { hp: p.hp });
      },
      changeMp: (delta) => {
        const { maxMp } = w.maxVitals(p);
        p.mp = Math.max(0, Math.min(maxMp, p.mp + delta));
        p.socket.emit('playerUpdate', { mp: p.mp });
      },
      recoverAll: () => this.recoverAll(p),
      changeExp: (delta, show) => this.setExp(p, p.xp + delta, show),
      changeLevel: (delta, show) => {
        const cls = ctx.gameData.get('class', p.classId);
        const maxLevel = ctx.settings.get('maxLevel', DEFAULT_SETTINGS.maxLevel);
        const level = Math.max(1, Math.min(maxLevel, p.level + delta));
        this.setExp(p, cls ? expForLevel(cls, level) : 0, show, level);
      },
      changeEquipment: (slotIndex, itemId) => {
        const slot = EQUIP_SLOTS[slotIndex];
        if (!slot) return;
        if (itemId > 0) {
          const kind = slot === 'weapon' ? 'weapon' : 'armor';
          if (kind === 'armor' && ctx.gameData.get('armor', itemId)?.slot !== slot) return;
          if (!ctx.progression.equip(p.characterId, slot, { kind, id: itemId })) return;
        } else {
          ctx.progression.equip(p.characterId, slot, null);
        }
        w.pushInventory(p);
      },
      transfer: (mapId, x, y, direction, fade) => w.transfer(p, mapId, x, y, direction, fade),
      moveRoute: (ref, route) => {
        const t = this.target(run, ref);
        if (!t) return Promise.resolve();
        const done = this.route(p, run.gen, t, route);
        run.routes.push(done);
        return done;
      },
      waitForMovement: async () => {
        await Promise.all(run.routes);
        run.routes.length = 0;
      },
      showAnimation: async (ref, animationId, wait) => {
        const t = this.target(run, ref);
        const anim = ctx.gameData.get('animation', animationId);
        if (!t || !anim) return;
        emitEffect({ kind: 'animation', target: targetId(t), sheet: anim.sheet, frameCount: anim.frameCount, frameSize: anim.frameSize, fps: anim.fps, sound: anim.sound });
        if (wait) await sleep((anim.frameCount / Math.max(1, anim.fps)) * 1000);
      },
      showBalloon: async (ref, balloonId, wait) => {
        const t = this.target(run, ref);
        if (!t) return;
        emitEffect({ kind: 'balloon', target: targetId(t), balloon: Math.max(1, Math.min(15, balloonId)) });
        if (wait) await sleep(BALLOON_MS);
      },
      eraseEvent: () => {
        if (run.event && p.mapGen === run.gen) {
          run.event.erased = true;
          w.refreshEvents(p);
        }
      },
      playSe: (se) => emitEffect({ kind: 'se', ...se }),
      wait: (ms) => sleep(ms),
      notify: (text) => p.socket.emit('notify', { key: 'notify.custom', params: { text } }),
      quest: (command, questId, step) => w.quests.command(p, command, questId, step),
      screen: async (effect, wait) => {
        emitEffect(effect);
        if (wait) await sleep(effect.ms);
      },
      inn: async (price) => {
        if (ctx.inventory.gold(p.characterId) < price) {
          p.socket.emit('notify', { key: 'error.inn.not_enough_gold', params: { currency: w.currencyName() } });
          return;
        }
        if (price > 0) w.changeGold(p, -price);
        emitEffect({ kind: 'fade', ms: 1200 });
        await sleep(600);
        this.recoverAll(p);
        await sleep(600);
        p.socket.emit('notify', { key: 'notify.inn_rested' });
      },
      setRespawn: (point) => {
        const target = point ?? { mapId: p.mapId, x: p.x, y: p.y };
        const runtime = w.mapRuntime(target.mapId);
        if (runtime && target.x >= 0 && target.y >= 0 && target.x < runtime.map.width && target.y < runtime.map.height) ctx.progression.setRespawn(p.characterId, target.mapId, target.x, target.y);
      },
      shop: (goods, purchaseOnly) => w.sheet.openShop(p, goods, purchaseOnly),
      bank: () => w.sheet.openBank(p),
      battle: async (enemyId) => {
        if (!w.combat.ambush(p, enemyId)) p.socket.emit('notify', { key: 'notify.battle_no_room' });
      },
      commonEvent: (id) => ctx.gameData.get('commonEvent', id)?.list ?? null,
      runScript: (code) => runScript(code, this.scriptState(run)),
      evaluate: (expression) => evaluateScript(expression, this.scriptState(run)),
    };
  }

  /** Sends a message to the player and waits for the answer (or the disconnection). */
  private async ask(p: PlayerSession, message: MessagePayload): Promise<number> {
    if (!this.world.isLive(p)) return 0;
    let onDisconnect = () => undefined as void;
    const disconnected = new Promise<number>((resolve) => {
      onDisconnect = () => resolve(0);
      p.socket.once('disconnect', onDisconnect);
    });
    const answer = p.socket
      .timeout(MESSAGE_TIMEOUT_MS)
      .emitWithAck('showMessage', message)
      .then((a) => (Number.isInteger(a) ? Number(a) : 0))
      .catch(() => 0);
    try {
      return await Promise.race([answer, disconnected]);
    } finally {
      p.socket.off('disconnect', onDisconnect);
    }
  }

  /** Restores HP and MP to their maximum. */
  private recoverAll(p: PlayerSession): void {
    const { maxHp, maxMp } = this.world.maxVitals(p);
    p.hp = maxHp;
    p.mp = maxMp;
    p.socket.emit('playerUpdate', { hp: p.hp, mp: p.mp });
  }

  /**
   * Sets the experience of a character and derives its level from its class curve.
   * @param level - Forced level (level commands), otherwise computed from the experience.
   */
  setExp(p: PlayerSession, xp: number, showLevelUp: boolean, level?: number): void {
    const cls = this.ctx.gameData.get('class', p.classId);
    const maxLevel = this.ctx.settings.get('maxLevel', DEFAULT_SETTINGS.maxLevel);
    const exp = Math.max(0, Math.floor(xp));
    let newLevel = level ?? 1;
    if (level === undefined && cls) while (newLevel < maxLevel && expForLevel(cls, newLevel + 1) <= exp) newLevel++;
    const before = p.level;
    if (exp > p.xp) this.world.guilds.memberGainedExp(p, exp - p.xp);
    p.xp = exp;
    p.level = newLevel;
    this.ctx.progression.setLevel(p.characterId, p.level, p.xp);
    this.world.combat.invalidate(p);
    const { maxHp, maxMp } = this.world.maxVitals(p);
    p.hp = Math.min(p.hp, maxHp);
    p.mp = Math.min(p.mp, maxMp);
    p.socket.emit('playerUpdate', { xp: p.xp, level: p.level, maxHp, maxMp, hp: p.hp, mp: p.mp, ...experienceRange(this.ctx, cls, p.level) });
    if (showLevelUp && p.level > before) p.socket.emit('notify', { key: 'notify.level_up', params: { level: p.level } });
    if (p.level !== before) {
      this.world.combat.levelChanged(p, before);
      this.world.sheet.push(p);
      this.world.refreshEvents(p);
    }
  }

  // --- Move routes ------------------------------------------------------------

  /** Route actor for one of the player's event copies. */
  private eventActor(p: PlayerSession, e: EventInstance): RouteActor {
    const runtime = this.world.mapRuntime(p.mapId);
    const send = (update: Omit<EventUpdate, 'id'>) => p.socket.emit('eventUpdate', { id: e.def.id, ...update });
    return {
      state: () => ({ x: e.x, y: e.y, direction: e.direction }),
      speed: () => e.moveSpeed,
      step: (d) => {
        if (!e.directionFix) e.direction = d;
        if (!runtime || !runtime.canEventStep(p.events, e, d, p)) {
          send({ direction: e.direction });
          return false;
        }
        const { dx, dy } = offset(d);
        e.x += dx;
        e.y += dy;
        send({ x: e.x, y: e.y, direction: e.direction });
        return true;
      },
      turn: (d) => {
        if (e.directionFix || e.direction === d) return;
        e.direction = d;
        send({ direction: d });
      },
      setting: (code, params) => {
        if (code === RouteCmd.Speed) e.moveSpeed = Math.max(1, Math.min(6, Number(params[0]) || 3));
        else if (code === RouteCmd.WalkAnimeOn || code === RouteCmd.WalkAnimeOff) e.walkAnime = code === RouteCmd.WalkAnimeOn;
        else if (code === RouteCmd.StepAnimeOn || code === RouteCmd.StepAnimeOff) e.stepAnime = code === RouteCmd.StepAnimeOn;
        else if (code === RouteCmd.DirFixOn || code === RouteCmd.DirFixOff) e.directionFix = code === RouteCmd.DirFixOn;
        else if (code === RouteCmd.ThroughOn || code === RouteCmd.ThroughOff) e.through = code === RouteCmd.ThroughOn;
        else if (code === RouteCmd.Image) {
          e.characterName = String(params[0] ?? '').slice(0, 200);
          e.characterIndex = Math.max(0, Math.min(7, Number(params[1]) || 0));
          e.tileId = 0;
        } else if (code === RouteCmd.PlaySe) {
          const se = (params[0] ?? {}) as { name?: unknown };
          if (typeof se.name === 'string' && se.name) p.socket.emit('effect', { kind: 'se', name: se.name, volume: 90, pitch: 100, pan: 0 });
          return;
        } else return;
        send({ view: MapRuntime.view(e) });
      },
    };
  }

  /** Route actor for the player itself. */
  private playerActor(p: PlayerSession): RouteActor {
    let through = false;
    let speed = PLAYER_SPEED;
    return {
      state: () => ({ x: p.x, y: p.y, direction: p.direction }),
      speed: () => speed,
      step: (d) => {
        const runtime = this.world.mapRuntime(p.mapId);
        const { dx, dy } = offset(d);
        const nx = p.x + dx;
        const ny = p.y + dy;
        const inside = runtime !== undefined && nx >= 0 && ny >= 0 && nx < runtime.map.width && ny < runtime.map.height;
        if (!inside || (!through && !runtime.canStep(p.events, p.x, p.y, d))) {
          this.world.forceMove(p, p.x, p.y, d);
          return false;
        }
        this.world.forceMove(p, nx, ny, d);
        return true;
      },
      turn: (d) => {
        if (p.direction !== d) this.world.forceMove(p, p.x, p.y, d);
      },
      setting: (code, params) => {
        if (code === RouteCmd.Speed) speed = Math.max(1, Math.min(6, Number(params[0]) || PLAYER_SPEED));
        else if (code === RouteCmd.ThroughOn || code === RouteCmd.ThroughOff) through = code === RouteCmd.ThroughOn;
        else if (code === RouteCmd.PlaySe) {
          const se = (params[0] ?? {}) as { name?: unknown };
          if (typeof se.name === 'string' && se.name) p.socket.emit('effect', { kind: 'se', name: se.name, volume: 90, pitch: 100, pan: 0 });
        }
      },
    };
  }

  /**
   * Executes one route command.
   * @returns The time to wait before the next command, or -1 when a step was blocked.
   */
  private routeCommand(p: PlayerSession, actor: RouteActor, code: number, params: unknown[]): number {
    const s = actor.state();
    const step = (d: Direction) => (actor.step(d) ? stepMs(actor.speed()) : -1);
    switch (code) {
      case RouteCmd.MoveDown: return step(2);
      case RouteCmd.MoveLeft: return step(4);
      case RouteCmd.MoveRight: return step(6);
      case RouteCmd.MoveUp: return step(8);
      case RouteCmd.MoveRandom: return step(randomDir());
      case RouteCmd.MoveToward: return step(towards(s.x, s.y, p.x, p.y));
      case RouteCmd.MoveAway: return step(reverse(towards(s.x, s.y, p.x, p.y)));
      case RouteCmd.MoveForward: return step(s.direction);
      case RouteCmd.MoveBackward: {
        // Steps back while keeping the facing.
        const facing = s.direction;
        const ms = step(reverse(facing));
        actor.turn(facing);
        return ms;
      }
      case RouteCmd.Wait: return Math.max(0, Number(params[0]) || 0) * (1000 / 60);
      case RouteCmd.TurnDown: actor.turn(2); return 0;
      case RouteCmd.TurnLeft: actor.turn(4); return 0;
      case RouteCmd.TurnRight: actor.turn(6); return 0;
      case RouteCmd.TurnUp: actor.turn(8); return 0;
      case RouteCmd.Turn90R: actor.turn(RIGHT[s.direction]); return 0;
      case RouteCmd.Turn90L: actor.turn(LEFT[s.direction]); return 0;
      case RouteCmd.Turn180: actor.turn(reverse(s.direction)); return 0;
      case RouteCmd.TurnRandom: actor.turn(randomDir()); return 0;
      case RouteCmd.TurnToward: actor.turn(towards(s.x, s.y, p.x, p.y)); return 0;
      case RouteCmd.TurnAway: actor.turn(reverse(towards(s.x, s.y, p.x, p.y))); return 0;
      default:
        actor.setting(code, params);
        return 0;
    }
  }

  /**
   * Runs a move route on the player or one of its event copies.
   * A blocked step is retried for a short while (or skipped at once when the
   * route is skippable); a repeating route runs until the player leaves the map.
   */
  private async route(p: PlayerSession, gen: number, target: EventInstance | 'player', route: MoveRoute): Promise<void> {
    const actor = target === 'player' ? this.playerActor(p) : this.eventActor(p, target);
    const list = route.list.filter((c) => c && Number.isInteger(c.code) && c.code !== RouteCmd.End).slice(0, 1000);
    if (list.length === 0) return;
    const active = () => this.world.isLive(p) && p.mapGen === gen && (target === 'player' || p.events.get(target.def.id) === target);
    let i = 0;
    let retries = 0;
    let idle = 0;
    while (active()) {
      if (i >= list.length) {
        if (!route.repeat) break;
        i = 0;
      }
      const cmd = list[i]!;
      const ms = this.routeCommand(p, actor, cmd.code, cmd.parameters ?? []);
      if (ms < 0) {
        if (route.skippable || ++retries > 8) {
          retries = 0;
          i++;
        }
        await sleep(250);
        continue;
      }
      retries = 0;
      i++;
      if (ms > 0) {
        idle = 0;
        await sleep(ms);
      } else if (++idle >= list.length) {
        // A repeating route made of settings only: give the server a breath.
        idle = 0;
        await sleep(100);
      }
    }
  }

  /** Autonomous movement of events (random, towards the player, custom route), for each player. */
  moveEvents(players: Iterable<PlayerSession>): void {
    const now = Date.now();
    for (const p of players) {
      if (!p.socket.connected) continue;
      for (const e of p.events.values()) {
        const page = MapRuntime.page(e);
        if (!page || page.moveType === 0 || e.locked || now < e.nextMoveAt) continue;
        const actor = this.eventActor(p, e);
        const pause = (5 - page.moveFrequency) * 500;
        let ms = 0;
        if (page.moveType === 1) {
          ms = this.routeCommand(p, actor, RouteCmd.MoveRandom, []);
          ms = Math.max(ms, 0) + pause * (0.5 + Math.random());
        } else if (page.moveType === 2) {
          const near = Math.abs(p.x - e.x) + Math.abs(p.y - e.y) <= 1;
          ms = near ? 0 : this.routeCommand(p, actor, Math.random() < 0.75 ? RouteCmd.MoveToward : RouteCmd.MoveRandom, []);
          ms = Math.max(ms, 0) + pause;
        } else {
          const list = page.moveRoute.list.filter((c) => c.code !== RouteCmd.End);
          if (list.length === 0 || (e.routeIndex >= list.length && !page.moveRoute.repeat)) {
            e.nextMoveAt = Number.MAX_SAFE_INTEGER;
            continue;
          }
          if (e.routeIndex >= list.length) e.routeIndex = 0;
          const cmd = list[e.routeIndex]!;
          ms = this.routeCommand(p, actor, cmd.code, cmd.parameters ?? []);
          if (ms >= 0 || page.moveRoute.skippable) e.routeIndex++;
          ms = ms < 0 ? 250 : ms + (cmd.code <= RouteCmd.MoveBackward ? pause : 0);
        }
        e.nextMoveAt = now + Math.max(ms, 50);
      }
    }
  }
}
