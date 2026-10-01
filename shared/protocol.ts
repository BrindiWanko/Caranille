/**
 * @file Network protocol shared by the server and the browser client.
 *
 * Every socket.io event exchanged between the two sides is declared here so that
 * both ends are type-checked against the same contract. The server imports these
 * interfaces to type its `Server` instance, the client imports them to type its
 * `Socket`. Payload validation (bounds, shapes) still happens server-side in
 * `server/net/`, because a type annotation is not a runtime guarantee.
 */
import type { CharacterAppearance } from './art/character.js';
import type { ActionView, DamageView, HotbarSlot, MonsterView, SkillsPayload } from './combat.js';
import type { BankPayload, SheetPayload, ShopPayload } from './character.js';
import type { EquipSlot, ParamName, ParamValues } from './database.js';
import type { ChatMessage, FriendsPayload, InspectPayload, TradeView, WritableChannel } from './social.js';
import type { Emblem, GuildView, PartyView } from './guild.js';
import type { TilesetData } from './database.js';
import type { EventView } from './events.js';
import type { MapData } from './map.js';
import type { QuestJournalPayload } from './quests.js';
import type { Direction } from './settings.js';

/** Version of the wire protocol. Bumped whenever an event payload changes shape. */
export const PROTOCOL_VERSION = 1;

/** Events emitted by the server and received by the client. */
export interface ServerToClientEvents {
  /** Sent once right after the connection is accepted. */
  welcome: (payload: WelcomePayload) => void;
  /** The selected character entered the world: everything the client needs to start. */
  enterWorld: (payload: EnterWorldPayload) => void;
  /**
   * The server refused a move: the client snaps back to the authoritative
   * position and adopts the new movement epoch.
   */
  moveRejected: (payload: { x: number; y: number; direction: Direction; epoch: number }) => void;
  /** An event changed (position, direction or appearance). */
  eventUpdate: (payload: EventUpdate) => void;
  /** Another player appeared on the current map. */
  playerJoined: (player: RemotePlayer) => void;
  /** Another player left the current map (or disconnected). */
  playerLeft: (payload: { id: number }) => void;
  /**
   * Positions of players who moved or turned since the last server tick, as
   * compact tuples `[characterId, x, y, direction]` (the receiver ignores its own id).
   */
  playersMoved: (moves: [number, number, number, Direction][]) => void;
  /** The current map was edited: the client rebuilds it in place (the player stays where it is). */
  mapUpdated: (payload: MapPayload) => void;
  /** The player was transferred to another map (or position): everything needed to switch. */
  mapChange: (payload: MapChangePayload) => void;
  /** Full inventory of the player (sent on entering and after every change). */
  inventory: (payload: InventoryPayload) => void;
  /** Changed values of the player's own character (vitals, gold, level...). */
  playerUpdate: (payload: Partial<PlayerCharacterInfo>) => void;
  /** Short notification for the player (item obtained, level up...); `key` is a translation key. */
  notify: (payload: { key: string; params?: Record<string, string | number>; icon?: number }) => void;
  /**
   * Shows a message window (possibly with choices or a number input); the
   * client acknowledges with the answer when the player closes it: the choice
   * index (-2 = cancelled), the number entered, or 0.
   */
  showMessage: (payload: MessagePayload, ack: (answer: number) => void) => void;
  /**
   * Events whose active page changed for this player (switch, quest...):
   * new views, and ids of events no longer shown.
   */
  eventsChanged: (payload: { views: EventView[]; removed: number[] }) => void;
  /** The server moved or turned the player (move route of an event): the client adopts the position and epoch. */
  forceMove: (payload: { x: number; y: number; direction: Direction; epoch: number }) => void;
  /** Visual or sound effect (balloon, animation, sound, screen effects). */
  effect: (payload: EffectPayload) => void;
  /** The player's quest journal (sent on entering and after every quest change). */
  quests: (payload: QuestJournalPayload) => void;
  /** A monster appeared (or reappeared) on the current map. */
  monsterSpawned: (monster: MonsterView) => void;
  /** A monster left the map (`died`: defeated, played with a death effect). */
  monsterRemoved: (payload: { id: number; died: boolean }) => void;
  /** Positions of monsters that moved or turned since the last tick: `[id, x, y, direction]`. */
  monstersMoved: (moves: [number, number, number, Direction][]) => void;
  /** An attack or a skill is performed on the map (animation). */
  combatAction: (action: ActionView) => void;
  /** Results of hits and heals on the map (floating numbers, HP bars). */
  damage: (views: DamageView[]) => void;
  /** The player died; it reappears at its respawn point after `seconds`. */
  playerDied: (payload: { seconds: number }) => void;
  /** Known skills, hotbar and running cooldowns (on entering and when they change). */
  skills: (payload: SkillsPayload) => void;
  /** A skill was used: its cooldown starts. */
  cooldown: (payload: { skillId: number; ms: number }) => void;
  /** Character sheet (parameters, points, equipment), after every change. */
  sheet: (payload: SheetPayload) => void;
  /** An event opens a shop; the client acknowledges when the player closes it. */
  shopOpen: (payload: ShopPayload, ack: () => void) => void;
  /** An event opens the personal bank; the client acknowledges when the player closes it. */
  bankOpen: (payload: BankPayload, ack: () => void) => void;
  /** New contents of the open bank. */
  bank: (payload: BankPayload) => void;
  /** A chat message (or a system message). */
  chat: (message: ChatMessage) => void;
  /** Friends and ignored players (after every change, and when a friend comes or goes). */
  friends: (payload: FriendsPayload) => void;
  /** Another player shows an emotion balloon. */
  emote: (payload: { id: number; balloon: number }) => void;
  /** Level, class, guild and equipment of an inspected player. */
  inspect: (payload: InspectPayload) => void;
  /** Another player asks for a trade. */
  tradeRequest: (payload: { id: number; name: string }) => void;
  /** State of the trade window (`null`: closed). */
  trade: (view: TradeView | null) => void;
  /** Party frames (`null`: not in a party). */
  party: (view: PartyView | null) => void;
  /** Another player invites this one into its party. */
  partyInvite: (payload: { id: number; name: string }) => void;
  /** Guild window (`null`: not in a guild). */
  guild: (view: GuildView | null) => void;
  /** Another player invites this one into its guild. */
  guildInvite: (payload: { id: number; name: string; guild: string }) => void;
  /** The guild tag shown under a player's name changed. */
  playerGuild: (payload: { id: number; tag: string }) => void;
  /** A boss marks an area of the ground: players standing in it when `ms` elapse are hit. */
  telegraph: (payload: { x: number; y: number; radius: number; ms: number }) => void;
  /** An item of a raid is rolled for: need, greed or pass. */
  lootRoll: (payload: { id: number; name: string; icon: number; count: number; seconds: number }) => void;
  /** Generic error notification; `key` is a translation key (e.g. `error.net.rate_limited`). */
  errorMessage: (payload: { key: string; params?: Record<string, string | number> }) => void;
}

/** Events emitted by the client and received by the server. */
export interface ClientToServerEvents {
  /** Latency probe; the server answers through the acknowledgement callback. */
  ping: (sentAt: number, ack: (serverTime: number) => void) => void;
  /**
   * Intent: take one step in a direction. `epoch` is the movement epoch given by
   * the last rejection (0 at start): moves predicted before a rejection arrived
   * carry an old epoch and are ignored, so client and server cannot drift apart.
   */
  move: (direction: Direction, epoch: number) => void;
  /** Intent: face a direction without moving. */
  turn: (direction: Direction) => void;
  /** Intent: press the Action button (talk, examine, open). */
  action: () => void;
  /** Intent: use an item from the bag. */
  useItem: (itemId: number) => void;
  /** Intent: normal attack in the direction the player faces. */
  attack: () => void;
  /** Intent: use a known skill. */
  useSkill: (skillId: number) => void;
  /** Saves the hotbar (skills and items in slots 1 to 8). */
  setHotbar: (slots: HotbarSlot[]) => void;
  /** Equips an item of the bag in a slot (`id` 0 empties the slot). */
  equip: (slot: EquipSlot, id: number) => void;
  /** Puts a free parameter point in a parameter. */
  allocate: (param: ParamName) => void;
  /** Throws items away. */
  discard: (kind: 'item' | 'weapon' | 'armor', id: number, quantity: number) => void;
  /** Buys articles of the open shop. */
  shopBuy: (index: number, quantity: number) => void;
  /** Sells items to the open shop. */
  shopSell: (kind: 'item' | 'weapon' | 'armor', id: number, quantity: number) => void;
  /** Moves items between the bag and the open bank. */
  bankMove: (kind: 'item' | 'weapon' | 'armor', id: number, quantity: number, toBank: boolean) => void;
  /** Deposits (positive) or withdraws (negative) gold in the open bank. */
  bankGold: (amount: number) => void;
  /** A line typed in the chat (message for the channel of the tab, or a `/` command). */
  chat: (text: string, channel: WritableChannel) => void;
  /** Shows an emotion balloon. */
  emote: (balloon: number) => void;
  friendAdd: (name: string) => void;
  friendRemove: (id: number) => void;
  ignore: (name: string) => void;
  unignore: (id: number) => void;
  /** Asks to see another player's level, class, guild and equipment (player in the world). */
  inspect: (characterId: number) => void;
  /** Reports a player to the moderators. */
  report: (characterId: number, reason: string) => void;
  /** Asks a player of the map for a trade. */
  tradeRequest: (characterId: number) => void;
  tradeRespond: (accept: boolean) => void;
  /** Replaces the player's offer. */
  tradeOffer: (offer: { items: { kind: 'item' | 'weapon' | 'armor'; id: number; quantity: number }[]; gold: number }) => void;
  tradeLock: () => void;
  tradeConfirm: () => void;
  tradeCancel: () => void;
  partyInvite: (characterId: number) => void;
  partyRespond: (accept: boolean) => void;
  partyLeave: () => void;
  partyKick: (characterId: number) => void;
  partyPromote: (characterId: number) => void;
  partyLoot: (loot: 'personal' | 'shared') => void;
  partyRaid: (raid: boolean) => void;
  lootChoice: (rollId: number, choice: 'need' | 'greed' | 'pass') => void;
  guildCreate: (name: string, tag: string, emblem: Emblem) => void;
  guildInvite: (characterId: number) => void;
  guildRespond: (accept: boolean) => void;
  guildLeave: () => void;
  guildKick: (characterId: number) => void;
  guildSetRank: (characterId: number, rank: number) => void;
  guildEditRank: (rank: number, name: string, permissions: number) => void;
  guildMotd: (motd: string) => void;
  guildBank: (kind: 'item' | 'weapon' | 'armor', id: number, quantity: number, deposit: boolean) => void;
  guildGold: (amount: number) => void;
}

/** Events exchanged between server instances (unused while running a single process). */
export interface InterServerEvents {}

/** Per-socket data attached by the server after authentication. */
export interface SocketData {
  accountId: number;
  username: string;
  role: AccountRole;
  /** Character played through this socket. */
  characterId: number;
}

/** Account roles, from least to most privileged. */
export type AccountRole = 'player' | 'moderator' | 'admin';

/** The player's own character, as known by the client. */
export interface PlayerCharacterInfo {
  id: number;
  name: string;
  classId: number;
  className: string;
  level: number;
  xp: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  gold: number;
  appearance: CharacterAppearance;
  mapId: number;
  x: number;
  y: number;
  direction: Direction;
  /** Icons of the active states (poison...). */
  states?: number[];
  /** Tag of the character's guild. */
  guildTag?: string;
  /** Experience at the start of the current level and needed for the next one (0 at the maximum level). */
  xpFloor?: number;
  xpNext?: number;
}

/** A map as sent to clients: everything but the event definitions (sent as views). */
export type ClientMap = Omit<MapData, 'events'> & { id: number };

/** Another player as seen by a client. */
export interface RemotePlayer {
  /** Character id. */
  id: number;
  name: string;
  appearance: CharacterAppearance;
  x: number;
  y: number;
  direction: Direction;
  /** Tag of its guild (shown under its name). */
  guild?: string;
}

/** Everything describing the map a player is on. */
export interface MapPayload {
  map: ClientMap;
  tileset: TilesetData;
  /** Events of the map, with the page active for this player resolved. */
  events: EventView[];
  /** Other players on the map. */
  players: RemotePlayer[];
  /** Monsters on the map. */
  monsters: MonsterView[];
}

/** Payload of the `mapChange` event. */
export interface MapChangePayload extends MapPayload {
  x: number;
  y: number;
  direction: Direction;
  /** New movement epoch (moves predicted on the previous map are void). */
  epoch: number;
  /** 0 black fade, 1 white fade, 2 no fade. */
  fade: number;
}

/** Payload of the `enterWorld` event. */
export interface EnterWorldPayload extends MapPayload {
  character: PlayerCharacterInfo;
  /** Game content shown by the interface (currency name...). */
  system: { currencyName: string; params: Record<ParamName, string>; bagSize: number; sellRate: number; guildCreationCost: number };
  /** Role of the account (the client shows the admin button only for admins; the server re-checks every action). */
  role: AccountRole;
}

/** One inventory entry with what the client needs to display it (texts are game content). */
export interface InventoryEntry {
  kind: 'item' | 'weapon' | 'armor';
  id: number;
  quantity: number;
  name: string;
  description: string;
  icon: number;
  /** Item category: regular, key or quest (weapons and armors: their slot). */
  category: string;
  /** Can be used from the bag now. */
  usable: boolean;
  /** Price in shops (0 = cannot be sold). */
  price: number;
  /** Equipment: slot, parameters and weapon / armor type. */
  slot?: EquipSlot;
  params?: ParamValues;
  equipType?: number;
}

/** Payload of the `inventory` event. */
export interface InventoryPayload {
  gold: number;
  entries: InventoryEntry[];
}

/** Change of an event, as seen by one client. */
export interface EventUpdate {
  id: number;
  x?: number;
  y?: number;
  direction?: Direction;
  /** Full view when the active page changed. */
  view?: EventView | null;
}

/**
 * A visual or sound effect. `target` is 0 for the player, otherwise an event id.
 */
export type EffectPayload =
  | { kind: 'balloon'; target: number; balloon: number }
  | { kind: 'animation'; target: number; sheet: string; frameCount: number; frameSize: number; fps: number; sound: string }
  | { kind: 'se'; name: string; volume: number; pitch: number; pan: number }
  /** Fades out and back in (inn). */
  | { kind: 'fade'; ms: number }
  /** Screen goes black (or back) and stays so, across map changes, until the opposite command. */
  | { kind: 'screenFade'; out: boolean; ms: number }
  /** Screen colour tone: red, green, blue (-255..255) and gray (0..255). */
  | { kind: 'tint'; tone: [number, number, number, number]; ms: number }
  /** Flash of a colour (red, green, blue, intensity 0..255) fading out. */
  | { kind: 'flash'; color: [number, number, number, number]; ms: number }
  /** Shakes the screen (power and speed 1..9). */
  | { kind: 'shake'; power: number; speed: number; ms: number };

/** A message window request. */
export interface MessagePayload {
  faceName: string;
  faceIndex: number;
  /** 0 window, 1 dim, 2 transparent. */
  background: number;
  /** 0 top, 1 middle, 2 bottom. */
  position: number;
  speaker: string;
  /** Text with control codes (\C[n], \I[n], \., \|, \!); \P, \V[n] and \G are resolved by the server. */
  text: string;
  /** Choices shown with (or without) the text. */
  choices?: string[];
  /** Choice selected at first. */
  choiceDefault?: number;
  /** What cancelling does: -1 not allowed, -2 answer -2, n answer choice n. */
  choiceCancel?: number;
  /** Number input with this many digits. */
  numberDigits?: number;
}

/** Payload of the `welcome` event. */
export interface WelcomePayload {
  protocol: number;
  serverTime: number;
}
