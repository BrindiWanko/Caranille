/**
 * @file The live game world: loaded maps, connected players, the server tick.
 *
 * The server is authoritative: clients send intents (step, turn, action) and
 * the world validates each of them against the map rules before applying it.
 * Every map is a socket.io room (`map:<id>`); what happens on a map is sent to
 * that room only. Position changes are collected and flushed to each room at
 * the tick rate (20 Hz) as compact tuples, which keeps traffic low when many
 * players walk around.
 *
 * Hot state (positions, directions, vitals) lives in memory and is written to
 * SQLite in batches: periodically, when a player leaves, and at shutdown.
 * Story progress is written through at once by the progression repository.
 *
 * Movement validation: a step must go to an adjacent passable cell, and steps
 * are rate-limited with a small token bucket (one token per step, refilled
 * slightly faster than the normal walking speed) so that network jitter is
 * tolerated but speed hacks are not. Moves predicted by a client before it
 * learnt of a rejection carry an old movement epoch and are dropped.
 *
 * Events: every player has its own copy of the events of its map, with the
 * page resolved from its own progress (see map-runtime.ts). Event commands
 * run on the server for that player only (events.ts). The world re-resolves
 * pages whenever something they depend on changes and sends the player the
 * events that look different.
 */
import type { Server, Socket } from 'socket.io';
import { Trigger } from '../../shared/events.js';
import { isValidPosition } from '../../shared/map.js';
import { isCounter } from '../../shared/passability.js';
import type {
  AccountRole,
  ClientToServerEvents,
  EnterWorldPayload,
  InterServerEvents,
  MapPayload,
  RemotePlayer,
  ServerToClientEvents,
  SocketData,
} from '../../shared/protocol.js';
import { DEFAULT_SETTINGS, type DataName, type Direction, type StartPosition } from '../../shared/settings.js';
import type { CharacterAppearance } from '../../shared/art/character.js';
import type { ServerContext } from '../context.js';
import type { Character } from '../db/characters.js';
import type { ItemKind } from '../db/inventory.js';
import type { CharacterProgress, GlobalProgress } from '../db/progression.js';
import type { HotbarSlot } from '../../shared/combat.js';
import type { ShopGood } from '../../shared/character.js';
import type { ParamName } from '../../shared/database.js';
import { CharacterSheet } from './character-sheet.js';
import { SocialService, emptySocial, type PlayerSocial } from './social.js';
import { TradeService } from './trade.js';
import { PartyService } from './party.js';
import { GuildService } from './guild.js';
import { InstanceService } from './instances.js';
import { RaidService } from './raids.js';
import { CombatSystem } from './combat.js';
import type { ActiveStates, BattlerStats } from './stats.js';
import { EventRunner } from './events.js';
import { MapRuntime, offset, type EventInstance, type EventSet } from './map-runtime.js';
import { playerInfo } from './player-info.js';
import { QuestService } from './quests.js';

/** Typed server-side socket. */
export type PlayerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
/** Typed socket.io server. */
export type WorldIo = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** Milliseconds per step at the normal walking speed (4 → 16 frames at 60 fps). */
export const STEP_MS = 1000 / 3.75;
/** Token bucket capacity: steps that may arrive in a burst after network jitter. */
const STEP_BURST = 3;
/** Refill interval: 15 % faster than walking, to absorb timer drift. */
const STEP_REFILL_MS = STEP_MS * 0.85;
/** Server tick rate. */
export const TICK_HZ = 20;
/**
 * Area of interest: a player only receives the movements of the players and
 * monsters within this many cells (larger than any screen).
 */
export const AOI_RADIUS = 24;
/** Autosave period. */
const AUTOSAVE_MS = 60_000;

/** A connected player. */
export interface PlayerSession {
  characterId: number;
  accountId: number;
  name: string;
  appearance: CharacterAppearance;
  socket: PlayerSocket;
  mapId: number;
  x: number;
  y: number;
  direction: Direction;
  hp: number;
  mp: number;
  classId: number;
  level: number;
  xp: number;
  /** Running an event (dialogue...): movement is frozen for this player only. */
  busy: boolean;
  stepTokens: number;
  lastRefill: number;
  /** Movement epoch, bumped at each rejection, transfer or forced move. */
  epoch: number;
  /** Time of the last save, for play time accounting. */
  savedAt: number;
  /** Personal story progress. */
  progress: CharacterProgress;
  /** Events of the current map as seen by this player. */
  events: EventSet;
  /** Bumped at every map change: runs started on a previous map stop. */
  mapGen: number;
  /** Instance of an instanced map (0 = the shared world). */
  instance: number;
  /** Combat state (see combat.ts). */
  combat: PlayerCombat;
  /** Parameter points distributed by the player. */
  allocated: Partial<Record<ParamName, number>>;
  /** Window opened by an event (shop, bank): its actions are accepted only while it is open. */
  ui: PlayerUi | null;
  /** Friends, ignore list, chat flood state. */
  social: PlayerSocial;
  /** Guild and rank (null: no guild). */
  guild: { id: number; rank: number } | null;
  /** Hidden from the other players (administrator tool). */
  invisible?: boolean;
  /** Entities (`p<id>` players, `m<id>` monsters) whose position this client knows, within its area of interest. */
  aoi: Set<string>;
}

/** Shop or bank opened by an event. */
export type PlayerUi = { kind: 'shop'; goods: ShopGood[]; purchaseOnly: boolean } | { kind: 'bank' };

/** Combat state of a player. */
export interface PlayerCombat {
  dead: boolean;
  states: ActiveStates;
  /** Cached battle parameters (null = to compute). */
  stats: BattlerStats | null;
  nextAttackAt: number;
  globalReadyAt: number;
  /** Time each skill is ready again. */
  cooldowns: Map<number, number>;
  hotbar: HotbarSlot[];
  /** Last time the player was hurt (regeneration starts a while after). */
  lastHurt: number;
}

/** Name of the socket.io room of a map (or of one instance of an instanced map). */
export const mapRoom = (mapId: number, instance = 0): string => (instance ? `map:${mapId}:${instance}` : `map:${mapId}`);

/** Tells whether two players are in the same place (same map and same instance). */
export const sameZone = (a: { mapId: number; instance: number }, b: { mapId: number; instance: number }): boolean => a.mapId === b.mapId && a.instance === b.instance;

/** The game world. */
export class World {
  private readonly maps = new Map<number, MapRuntime>();
  private readonly players = new Map<number, PlayerSession>();
  /** Characters made invisible by an administrator: they stay hidden when they reconnect (until visible again or a restart). */
  private readonly invisibleIds = new Set<number>();
  /** Positions to broadcast at the next tick, per map. */
  private readonly pendingMoves = new Map<string, { mapId: number; instance: number; moves: Map<number, [number, number, number, Direction]> }>();
  private readonly timers: NodeJS.Timeout[] = [];
  private io: WorldIo | null = null;
  /** Server-wide switches and variables. */
  readonly global: GlobalProgress;
  /** Ids of the switches / variables declared global in the System settings. */
  private globalSwitchIds = new Set<number>();
  private globalVariableIds = new Set<number>();
  private instanceSwitchIds = new Set<number>();
  /** Runs events, move routes and autonomous movements. */
  readonly runner: EventRunner;
  /** Quest rules (objectives, rewards, markers, journal). */
  readonly quests: QuestService;
  /** Monsters and fights. */
  readonly combat: CombatSystem;
  /** Character sheet, equipment, shops and bank. */
  readonly sheet: CharacterSheet;
  /** Chat, friends, emotes. */
  readonly social: SocialService;
  /** Trades between players. */
  readonly trade: TradeService;
  /** Parties. */
  readonly party: PartyService;
  /** Guilds. */
  readonly guilds: GuildService;
  /** Instanced maps. */
  readonly instances: InstanceService;
  /** Raid rewards and loot. */
  readonly raids: RaidService;

  constructor(readonly ctx: ServerContext) {
    this.global = ctx.progression.loadGlobal();
    this.runner = new EventRunner(this);
    this.quests = new QuestService(this);
    this.combat = new CombatSystem(this);
    this.sheet = new CharacterSheet(this);
    this.social = new SocialService(this);
    this.trade = new TradeService(this);
    this.party = new PartyService(this);
    this.guilds = new GuildService(this);
    this.instances = new InstanceService(this);
    this.raids = new RaidService(this);
    this.loadScopes();
    // A failing round is logged and skipped: one bad map or monster must not stop the world.
    const every = (ms: number, name: string, run: () => void) =>
      setInterval(() => {
        try {
          run();
        } catch (err) {
          console.error(`[caranille] ${name} failed`, err);
        }
      }, ms);
    this.timers.push(
      every(AUTOSAVE_MS, 'autosave', () => this.saveAll()),
      every(1000 / TICK_HZ, 'world tick', () => this.tick()),
      every(100, 'event movement', () => this.runner.moveEvents(this.players.values())),
      every(CombatSystem.TICK_MS, 'combat tick', () => this.combat.tick()),
    );
    for (const t of this.timers) t.unref();
  }

  /** Connects the socket.io server used for room broadcasts. */
  attach(io: WorldIo): void {
    this.io = io;
  }

  /** Broadcast target of a map room (`undefined` before the socket server is attached). */
  room(mapId: number, instance = 0) {
    return this.io?.to(mapRoom(mapId, instance));
  }

  /** Number of connected players. */
  get playerCount(): number {
    return this.players.size;
  }

  /** Returns the runtime of a map, loading it on first use. */
  mapRuntime(id: number): MapRuntime | undefined {
    let runtime = this.maps.get(id);
    if (!runtime) {
      const map = this.ctx.maps.get(id);
      if (!map) return undefined;
      const tileset = this.ctx.gameData.get('tileset', map.tilesetId);
      runtime = new MapRuntime(id, map, tileset?.flags ?? []);
      this.maps.set(id, runtime);
    }
    return runtime;
  }

  /** A connected player, by character id. */
  player(characterId: number): PlayerSession | undefined {
    return this.players.get(characterId);
  }

  /** Every connected player. */
  allPlayers(): IterableIterator<PlayerSession> {
    return this.players.values();
  }

  /** Players currently on a map. */
  playersOn(mapId: number, instance?: number): PlayerSession[] {
    return [...this.players.values()].filter((p) => p.mapId === mapId && (instance === undefined || p.instance === instance));
  }

  /** Tells whether a player session is still the live one. */
  isLive(p: PlayerSession): boolean {
    return p.socket.connected && this.players.get(p.characterId) === p;
  }

  private remote(p: PlayerSession): RemotePlayer {
    const guild = this.guilds.tagOf(p);
    return { id: p.characterId, name: p.name, appearance: p.appearance, x: p.x, y: p.y, direction: p.direction, ...(guild ? { guild } : {}) };
  }

  // --- Switches and variables -------------------------------------------------

  /** Reads which switches and variables are global. */
  private loadScopes(): void {
    const ids = (list: DataName[]) => new Set(list.flatMap((d, i) => (d.global ? [i + 1] : [])));
    const switches = this.ctx.settings.get<DataName[]>('switches', DEFAULT_SETTINGS.switches);
    this.globalSwitchIds = ids(switches);
    this.instanceSwitchIds = new Set(switches.flatMap((d, i) => (d.instance ? [i + 1] : [])));
    this.globalVariableIds = ids(this.ctx.settings.get<DataName[]>('variables', DEFAULT_SETTINGS.variables));
  }

  /** The System settings changed (switch scopes...): re-read them and refresh every player's events. */
  systemChanged(): void {
    this.loadScopes();
    for (const p of this.players.values()) this.refreshEvents(p);
  }

  /** Tells whether a switch is global. */
  isGlobalSwitch(id: number): boolean {
    return this.globalSwitchIds.has(id);
  }

  /** Tells whether a variable is global. */
  isGlobalVariable(id: number): boolean {
    return this.globalVariableIds.has(id);
  }

  /** Value of a switch for a player (personal, global, or of its instance). */
  getSwitch(p: PlayerSession, id: number): boolean {
    if (this.instanceSwitchIds.has(id)) return this.instances.of(p)?.switches.has(id) ?? false;
    return this.isGlobalSwitch(id) ? this.global.switches.has(id) : p.progress.switches.has(id);
  }

  /** Value of a variable for a player (personal or global). */
  getVariable(p: PlayerSession, id: number): number {
    return (this.isGlobalVariable(id) ? this.global.variables.get(id) : p.progress.variables.get(id)) ?? 0;
  }

  /** Sets a switch; a global one refreshes every player's events. */
  setSwitch(p: PlayerSession, id: number, on: boolean): void {
    if (id < 1 || this.getSwitch(p, id) === on) return;
    if (this.instanceSwitchIds.has(id)) {
      const instance = this.instances.of(p);
      if (!instance) return;
      if (on) instance.switches.add(id);
      else instance.switches.delete(id);
      for (const other of this.instances.players(instance)) this.refreshEvents(other);
      return;
    }
    if (this.isGlobalSwitch(id)) {
      this.ctx.progression.setGlobalSwitch(this.global, id, on);
      for (const other of this.players.values()) this.refreshEvents(other);
    } else {
      this.ctx.progression.setSwitch(p.characterId, p.progress, id, on);
      this.refreshEvents(p);
    }
  }

  /** Sets a variable; a global one refreshes every player's events. */
  setVariable(p: PlayerSession, id: number, value: number): void {
    if (id < 1) return;
    const before = this.getVariable(p, id);
    if (this.isGlobalVariable(id)) {
      this.ctx.progression.setGlobalVariable(this.global, id, value);
      if (this.getVariable(p, id) !== before) for (const other of this.players.values()) this.refreshEvents(other);
    } else {
      this.ctx.progression.setVariable(p.characterId, p.progress, id, value);
      if (this.getVariable(p, id) !== before) this.refreshEvents(p);
    }
  }

  // --- Events of a player -----------------------------------------------------

  /** Builds the player's copies of the events of its map and resolves their pages. */
  private setupEvents(p: PlayerSession, runtime: MapRuntime): void {
    p.mapGen++;
    p.aoi.clear();
    p.events = runtime.instantiate();
    for (const e of p.events.values()) {
      const index = MapRuntime.resolvePage(e, (c) => this.runner.conditionsHold(p, e, c));
      MapRuntime.applyPage(e, index);
    }
    for (const e of p.events.values()) e.marker = this.quests.marker(p, e);
  }

  /**
   * Re-resolves the pages of the player's events, sends the ones that changed,
   * then starts the automatic and parallel events that became active.
   */
  refreshEvents(p: PlayerSession): void {
    if (!this.isLive(p)) return;
    // Item and switch objectives depend on what just changed; a quest moving
    // to its next step refreshes the events again by itself.
    if (this.quests.check(p)) return;
    const views = [];
    const removed: number[] = [];
    for (const e of p.events.values()) {
      const index = MapRuntime.resolvePage(e, (c) => this.runner.conditionsHold(p, e, c));
      const pageChanged = index !== e.pageIndex;
      if (pageChanged) MapRuntime.applyPage(e, index);
      const marker = this.quests.marker(p, e);
      if (!pageChanged && marker === e.marker) continue;
      e.marker = marker;
      const view = MapRuntime.view(e);
      if (view) views.push(view);
      else if (pageChanged) removed.push(e.def.id);
    }
    if (views.length || removed.length) p.socket.emit('eventsChanged', { views, removed });
    this.quests.push(p);
    this.runner.startTriggers(p);
  }

  // --- Rooms and entering -----------------------------------------------------

  /** Map description sent to a player entering it. */
  private mapPayload(p: PlayerSession, runtime: MapRuntime): MapPayload {
    const { events: _events, ...mapWithoutEvents } = runtime.map;
    return {
      map: { ...mapWithoutEvents, id: runtime.id },
      tileset: this.ctx.gameData.get('tileset', runtime.map.tilesetId) ?? { id: 0, name: '', mode: 1, tilesetNames: [], flags: [] },
      events: MapRuntime.views(p.events),
      players: this.playersOn(runtime.id, p.instance).filter((o) => o !== p && !o.invisible).map((o) => this.remote(o)),
      monsters: this.combat.views(runtime.id, p.instance),
    };
  }

  /** Places a player in a map room and tells the others. */
  private enterRoom(p: PlayerSession): void {
    void p.socket.join(mapRoom(p.mapId, p.instance));
    if (!p.invisible) p.socket.to(mapRoom(p.mapId, p.instance)).emit('playerJoined', this.remote(p));
  }

  /** Removes a player from its map room and tells the others. */
  private leaveRoom(p: PlayerSession): void {
    this.pendingMoves.get(mapRoom(p.mapId, p.instance))?.moves.delete(p.characterId);
    p.socket.to(mapRoom(p.mapId, p.instance)).emit('playerLeft', { id: p.characterId });
    void p.socket.leave(mapRoom(p.mapId, p.instance));
  }

  /**
   * Puts a character into the world for a socket. A second connection with the
   * same character replaces the first one (the old socket is disconnected).
   * @returns The payload to send to the client, or `null` when no valid map exists.
   */
  join(socket: PlayerSocket, character: Character): EnterWorldPayload | null {
    const previous = this.players.get(character.id);
    if (previous && previous.socket.id !== socket.id) {
      this.leave(character.id);
      previous.socket.emit('errorMessage', { key: 'error.net.replaced' });
      previous.socket.disconnect(true);
    }
    let { mapId, x, y, direction } = character;
    let runtime = this.mapRuntime(mapId);
    // A deleted map, an invalid saved position or an instanced map (instances do not
    // survive a disconnection) sends the character back to the start.
    if (!runtime || !isValidPosition(runtime.map, x, y) || runtime.map.mmo.instance) {
      const start = this.ctx.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition);
      ({ mapId, x, y, direction } = start);
      runtime = this.mapRuntime(mapId);
      if (!runtime) return null;
    }
    const now = Date.now();
    const p: PlayerSession = {
      characterId: character.id,
      accountId: character.accountId,
      name: character.name,
      appearance: character.appearance,
      socket,
      mapId,
      x,
      y,
      direction,
      hp: character.hp,
      mp: character.mp,
      classId: character.classId,
      level: character.level,
      xp: character.xp,
      busy: false,
      stepTokens: STEP_BURST,
      lastRefill: now,
      epoch: 0,
      savedAt: now,
      progress: this.ctx.progression.load(character.id),
      events: new Map(),
      mapGen: 0,
      instance: 0,
      aoi: new Set(),
      combat: { dead: false, states: new Map(), stats: null, nextAttackAt: 0, globalReadyAt: 0, cooldowns: new Map(), hotbar: [], lastHurt: 0 },
      allocated: this.ctx.progression.allocated(character.id),
      ui: null,
      social: emptySocial(),
      guild: null,
      invisible: this.invisibleIds.has(character.id),
    };
    this.players.set(character.id, p);
    this.guilds.playerJoined(p);
    this.combat.playerJoined(p);
    // Equipment and points change the maximum vitals given by the class.
    const vitals = this.maxVitals(p);
    p.hp = Math.min(p.hp, vitals.maxHp);
    p.mp = Math.min(p.mp, vitals.maxMp);
    this.setupEvents(p, runtime);
    const payload: EnterWorldPayload = {
      ...this.mapPayload(p, runtime),
      character: { ...playerInfo(this.ctx, character), mapId, x, y, direction, ...this.maxVitals(p), hp: p.hp, mp: p.mp, guildTag: this.guilds.tagOf(p) },
      role: socket.data.role,
      system: {
        currencyName: this.currencyName(),
        params: this.ctx.settings.get('terms', DEFAULT_SETTINGS.terms).params,
        bagSize: this.ctx.settings.get('bagSize', DEFAULT_SETTINGS.bagSize),
        sellRate: this.ctx.settings.get('sellRate', DEFAULT_SETTINGS.sellRate),
        guildCreationCost: this.ctx.settings.get('guildCreationCost', DEFAULT_SETTINGS.guildCreationCost),
      },
    };
    this.enterRoom(p);
    return payload;
  }

  /** Called once the client received `enterWorld`: sends the journal and starts automatic events. */
  afterEnter(p: PlayerSession): void {
    this.quests.pushFull(p);
    this.combat.pushSkills(p);
    this.sheet.push(p);
    this.social.playerJoined(p);
    this.social.pushFriends(p);
    this.guilds.push(p);
    this.quests.onMove(p);
    this.runner.startTriggers(p);
  }

  /** Removes a player and saves its state. */
  leave(characterId: number): void {
    const p = this.players.get(characterId);
    if (!p) return;
    this.trade.cancel(p, 'notify.trade_partner_left');
    this.party.playerLeft(p);
    this.leaveRoom(p);
    this.save([p]);
    p.mapGen++;
    this.players.delete(characterId);
    this.quests.forget(characterId);
    this.social.playerLeft(p);
  }

  /** Start position of the System settings. */
  startPosition(): StartPosition {
    return this.ctx.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition);
  }

  /** Disconnects every session of an account (ban, kick, password reset). */
  /**
   * Applies a new role to the connected characters of an account, so that it
   * takes effect without logging in again (the web pages and APIs already read
   * the role from the database on every request).
   */
  setAccountRole(accountId: number, role: AccountRole): void {
    for (const p of this.players.values()) {
      if (p.accountId !== accountId) continue;
      p.socket.data.role = role;
      p.socket.emit('roleChanged', { role });
    }
    if (role !== 'admin') this.ctx.editLocks.releaseAll(accountId);
  }

  kickAccount(accountId: number, key: string): void {
    for (const p of [...this.players.values()]) {
      if (p.accountId !== accountId) continue;
      p.socket.emit('errorMessage', { key });
      this.leave(p.characterId);
      p.socket.disconnect(true);
    }
  }

  /** Server announcement: a notification and a system chat line for everyone. */
  announce(text: string): void {
    for (const p of this.players.values()) {
      if (!this.isLive(p)) continue;
      p.socket.emit('notify', { key: 'notify.announce', params: { text } });
      this.social.system(p, 'notify.announce', { text });
    }
  }

  /** Hides a player from the others (or shows it again). */
  setInvisible(p: PlayerSession, on: boolean): void {
    if (on) this.invisibleIds.add(p.characterId);
    else this.invisibleIds.delete(p.characterId);
    if (Boolean(p.invisible) === on) return;
    const room = p.socket.to(mapRoom(p.mapId, p.instance));
    if (on) {
      room.emit('playerLeft', { id: p.characterId });
      p.invisible = true;
    } else {
      p.invisible = false;
      room.emit('playerJoined', this.remote(p));
    }
  }

  /** Maximum HP and MP of a player (class, equipment, points, states). */
  maxVitals(p: PlayerSession): { maxHp: number; maxMp: number } {
    const { params } = this.combat.stats(p);
    return { maxHp: params.mhp, maxMp: params.mmp };
  }

  /** Currency name from the System settings. */
  currencyName(): string {
    return this.ctx.settings.get('currencyName', DEFAULT_SETTINGS.currencyName);
  }

  // --- Movement ---------------------------------------------------------------

  /** Queues a position broadcast for the next tick. */
  queueMove(p: PlayerSession): void {
    if (p.invisible) return;
    const key = mapRoom(p.mapId, p.instance);
    let zone = this.pendingMoves.get(key);
    if (!zone) {
      zone = { mapId: p.mapId, instance: p.instance, moves: new Map() };
      this.pendingMoves.set(key, zone);
    }
    zone.moves.set(p.characterId, [p.characterId, p.x, p.y, p.direction]);
  }

  /** Server tick: flushes queued position changes to each map room. */
  tick(): void {
    if (!this.io) return;
    const monsterMoves = new Map<string, Set<number>>();
    for (const [mapId, instance, moves] of this.combat.flushMoves()) monsterMoves.set(mapRoom(mapId, instance), new Set(moves.map((m) => m[0])));
    // Players grouped by zone; each one gets the moves within its area of
    // interest, plus the position of anything that just came into it.
    const zones = new Map<string, PlayerSession[]>();
    for (const p of this.players.values()) {
      const key = mapRoom(p.mapId, p.instance);
      const list = zones.get(key);
      if (list) list.push(p);
      else zones.set(key, [p]);
    }
    for (const [key, viewers] of zones) {
      const moved = this.pendingMoves.get(key)?.moves;
      const first = viewers[0]!;
      const monsters = this.combat.positions(first.mapId, first.instance);
      const movedMonsters = monsterMoves.get(key);
      for (const viewer of viewers) {
        if (!this.isLive(viewer)) continue;
        const near = (x: number, y: number) => Math.abs(x - viewer.x) <= AOI_RADIUS && Math.abs(y - viewer.y) <= AOI_RADIUS;
        const known = new Set<string>();
        const players: [number, number, number, Direction][] = [];
        for (const o of viewers) {
          if (o === viewer || o.invisible || !near(o.x, o.y)) continue;
          const id = `p${o.characterId}`;
          known.add(id);
          if (moved?.has(o.characterId) || !viewer.aoi.has(id)) players.push([o.characterId, o.x, o.y, o.direction]);
        }
        const mons: [number, number, number, Direction][] = [];
        for (const m of monsters) {
          if (!near(m[1], m[2])) continue;
          const id = `m${m[0]}`;
          known.add(id);
          if (movedMonsters?.has(m[0]) || !viewer.aoi.has(id)) mons.push(m);
        }
        viewer.aoi = known;
        if (players.length) viewer.socket.emit('playersMoved', players);
        if (mons.length) viewer.socket.emit('monstersMoved', mons);
      }
    }
    this.pendingMoves.clear();
  }

  /** Touch-triggered event at a cell for a player (`solid`: same priority as characters). */
  private touchEventAt(p: PlayerSession, x: number, y: number, solid: boolean): EventInstance | undefined {
    return MapRuntime.eventsAt(p.events, x, y).find((e) => {
      const page = MapRuntime.page(e);
      return page && (page.priorityType === 1) === solid && (page.trigger === Trigger.PlayerTouch || page.trigger === Trigger.EventTouch);
    });
  }

  /**
   * Handles a step intent.
   * @param epoch - Movement epoch the client predicted this step in.
   * @returns `true` if the step was accepted.
   */
  move(p: PlayerSession, direction: Direction, epoch: number): boolean {
    // Steps predicted before the client learnt of a rejection are dropped silently.
    if (epoch !== p.epoch) return false;
    const runtime = this.mapRuntime(p.mapId);
    const now = Date.now();
    p.stepTokens = Math.min(STEP_BURST, p.stepTokens + (now - p.lastRefill) / STEP_REFILL_MS);
    p.lastRefill = now;
    p.direction = direction;
    const reject = () => {
      p.epoch++;
      p.socket.emit('moveRejected', { x: p.x, y: p.y, direction: p.direction, epoch: p.epoch });
      this.queueMove(p);
      return false;
    };
    if (!runtime || p.busy || p.stepTokens < 1 || !this.combat.canMove(p)) return reject();
    const { dx, dy } = offset(direction);
    if (this.combat.occupied(p.mapId, p.x + dx, p.y + dy, p.instance)) return reject();
    if (!runtime.canStep(p.events, p.x, p.y, direction)) {
      // Walking into a touch-triggered event starts it (doors, traps...).
      const bumped = this.touchEventAt(p, p.x + dx, p.y + dy, true);
      reject();
      if (bumped) void this.runner.run(p, bumped);
      return false;
    }
    p.stepTokens -= 1;
    p.x += dx;
    p.y += dy;
    this.queueMove(p);
    this.quests.onMove(p);
    this.trade.moved(p);
    // Stepping onto a touch-triggered event drawn below/above characters (teleporters...).
    const touched = this.touchEventAt(p, p.x, p.y, false);
    if (touched) void this.runner.run(p, touched);
    return true;
  }

  /** Handles a turn intent. */
  turn(p: PlayerSession, direction: Direction): void {
    if (p.busy || p.direction === direction || p.combat.dead) return;
    p.direction = direction;
    this.queueMove(p);
  }

  /**
   * Handles the Action button: starts the event in front of the player (or
   * under it for events drawn below/above characters). Counters let the
   * player reach the event one cell further. With no event to start, the
   * player attacks in the direction it faces.
   */
  action(p: PlayerSession): void {
    const runtime = this.mapRuntime(p.mapId);
    if (!runtime || p.busy || p.combat.dead) return;
    const here = MapRuntime.eventsAt(p.events, p.x, p.y).find((e) => {
      const page = MapRuntime.page(e);
      return page && page.priorityType !== 1 && page.trigger === Trigger.Action;
    });
    if (here) {
      void this.runner.run(p, here);
      return;
    }
    const { dx, dy } = offset(p.direction);
    let fx = p.x + dx;
    let fy = p.y + dy;
    const facing = (x: number, y: number) =>
      MapRuntime.eventsAt(p.events, x, y).find((e) => {
        const page = MapRuntime.page(e);
        return page && page.priorityType === 1 && page.trigger <= Trigger.EventTouch;
      });
    let target = facing(fx, fy);
    if (!target && isCounter(runtime.map, runtime.flags, fx, fy)) {
      fx += dx;
      fy += dy;
      target = facing(fx, fy);
    }
    if (target) void this.runner.run(p, target);
    else this.combat.attack(p);
  }

  /**
   * Moves a player to another map or position.
   * @param fade - Fade type forwarded to the client (0 black, 1 white, 2 none).
   * @returns `false` when the destination is invalid.
   */
  transfer(p: PlayerSession, mapId: number, x: number, y: number, direction: Direction | 0, fade = 0): boolean {
    const runtime = this.mapRuntime(mapId);
    if (!runtime || !isValidPosition(runtime.map, x, y)) return false;
    // Instanced map: the copy of the player's party (created if needed), if allowed.
    let instance = 0;
    if (runtime.map.mmo.instance) {
      const entered = mapId === p.mapId && p.instance ? p.instance : this.instances.enter(p, mapId);
      if (typeof entered === 'string') {
        p.socket.emit('notify', { key: entered });
        return false;
      }
      instance = entered;
    }
    if (mapId !== p.mapId || instance !== p.instance) this.trade.cancel(p);
    this.leaveRoom(p);
    p.instance = instance;
    p.mapId = mapId;
    p.x = x;
    p.y = y;
    if (direction) p.direction = direction;
    p.epoch++;
    p.stepTokens = STEP_BURST;
    this.setupEvents(p, runtime);
    p.socket.emit('mapChange', { ...this.mapPayload(p, runtime), x, y, direction: p.direction, epoch: p.epoch, fade });
    this.enterRoom(p);
    this.quests.onMove(p);
    // Automatic events of the new map start once the current run (if any) is over.
    setImmediate(() => this.runner.startTriggers(p));
    return true;
  }

  /**
   * Moves or turns a player on its map by server decision (move routes):
   * the client adopts the new position, the others see a normal move.
   */
  forceMove(p: PlayerSession, x: number, y: number, direction: Direction): void {
    const moved = p.x !== x || p.y !== y;
    p.x = x;
    p.y = y;
    p.direction = direction;
    p.epoch++;
    p.socket.emit('forceMove', { x, y, direction, epoch: p.epoch });
    this.queueMove(p);
    if (moved) this.quests.onMove(p);
  }

  /**
   * Reloads a map after an edit and pushes the new version to the players on it.
   * Players standing outside the new bounds are moved inside.
   */
  reloadMap(mapId: number): void {
    this.maps.delete(mapId);
    this.combat.reloadMap(mapId);
    const runtime = this.mapRuntime(mapId);
    if (!runtime) return;
    for (const p of this.playersOn(mapId)) {
      p.x = Math.min(p.x, runtime.map.width - 1);
      p.y = Math.min(p.y, runtime.map.height - 1);
      this.setupEvents(p, runtime);
      p.socket.emit('mapUpdated', this.mapPayload(p, runtime));
      if (!p.busy) this.runner.startTriggers(p);
    }
  }

  /** Reloads every loaded map drawn with a tileset (its flags or sheets changed). */
  reloadMapsUsingTileset(tilesetId: number): void {
    for (const [id, runtime] of [...this.maps]) if (runtime.map.tilesetId === tilesetId) this.reloadMap(id);
  }

  /** Sends every player of a map to the start position (the map is being deleted). */
  evacuateMap(mapId: number): void {
    const start = this.ctx.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition);
    for (const p of this.playersOn(mapId)) this.transfer(p, start.mapId, start.x, start.y, start.direction);
    this.maps.delete(mapId);
  }

  // --- Inventory and character ------------------------------------------------

  /** Sends the player its current inventory. */
  pushInventory(p: PlayerSession): void {
    // Equipment may have changed with the bag.
    this.combat.invalidate(p);
    p.socket.emit('inventory', this.ctx.inventoryService.payload(p.characterId));
  }

  /**
   * Gives (positive) or takes (negative) gold, and tells the player.
   * @returns The new amount.
   */
  changeGold(p: PlayerSession, delta: number): number {
    const gold = this.ctx.inventoryService.changeGold(p.characterId, delta);
    p.socket.emit('playerUpdate', { gold });
    if (delta !== 0) p.socket.emit('notify', { key: delta > 0 ? 'notify.gold_gained' : 'notify.gold_lost', params: { amount: Math.abs(delta), currency: this.currencyName() } });
    this.pushInventory(p);
    return gold;
  }

  /**
   * Gives or takes items, and tells the player what changed.
   * @returns The signed quantity actually changed.
   */
  changeItems(p: PlayerSession, kind: ItemKind, id: number, delta: number): number {
    const changed = this.ctx.inventoryService.change(p.characterId, kind, id, delta);
    if (delta > 0 && changed === 0 && !this.ctx.inventoryService.hasRoomFor(p.characterId, kind, id)) p.socket.emit('notify', { key: 'error.bag.full' });
    if (changed !== 0) {
      const def = kind === 'item' ? this.ctx.gameData.get('item', id) : kind === 'weapon' ? this.ctx.gameData.get('weapon', id) : this.ctx.gameData.get('armor', id);
      p.socket.emit('notify', {
        key: changed > 0 ? 'notify.item_gained' : 'notify.item_lost',
        params: { name: def?.name ?? '?', count: Math.abs(changed) },
        icon: def?.icon,
      });
      this.pushInventory(p);
      // Pages may depend on owning an item.
      this.refreshEvents(p);
    }
    return changed;
  }

  /** Uses an item from the player's bag (effects are computed by the server). */
  useItem(p: PlayerSession, itemId: number): void {
    if (p.busy) return;
    const result = this.ctx.inventoryService.use(p.characterId, itemId, { hp: p.hp, mp: p.mp, ...this.maxVitals(p) });
    if (!result.ok) {
      p.socket.emit('notify', { key: result.errorKey });
      return;
    }
    p.hp = result.hp;
    p.mp = result.mp;
    p.socket.emit('playerUpdate', { hp: p.hp, mp: p.mp });
    this.pushInventory(p);
    this.refreshEvents(p);
  }

  // --- Saving -----------------------------------------------------------------

  /** Writes the state of some players to the database in one transaction. */
  private save(list: readonly PlayerSession[]): void {
    if (list.length === 0) return;
    const now = Date.now();
    this.ctx.characters.saveStates(
      list.map((p) => {
        const delta = Math.floor((now - p.savedAt) / 1000);
        p.savedAt += delta * 1000;
        return [p.characterId, { mapId: p.mapId, x: p.x, y: p.y, direction: p.direction, hp: p.hp, mp: p.mp, playTimeDelta: delta }] as const;
      }),
    );
  }

  /** Saves every connected player (autosave and shutdown). */
  saveAll(): void {
    this.save([...this.players.values()]);
  }

  /** Stops timers and saves everyone. */
  close(): void {
    for (const t of this.timers) clearInterval(t);
    this.saveAll();
  }
}
