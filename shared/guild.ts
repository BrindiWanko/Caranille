/**
 * @file Parties and guilds as exchanged between the server and the client:
 * guild identity and emblem, ranks and permissions, members, bank and log,
 * and the party frames.
 */

/** Guild permissions (bit flags of a rank). */
export const GuildPermission = {
  Invite: 1,
  Kick: 2,
  Motd: 4,
  Deposit: 8,
  Withdraw: 16,
  /** Promote / demote members of lower ranks, rename lower ranks and change their permissions. */
  Ranks: 32,
} as const;
export const ALL_PERMISSIONS = 63;
export const PERMISSION_KEYS = ['Invite', 'Kick', 'Motd', 'Deposit', 'Withdraw', 'Ranks'] as const;

/** Number of ranks of a guild (0 = leader). */
export const GUILD_RANKS = 4;

/** Default ranks of a new guild. */
export const DEFAULT_RANKS: { name: string; permissions: number }[] = [
  { name: 'Chef', permissions: ALL_PERMISSIONS },
  { name: 'Officier', permissions: GuildPermission.Invite | GuildPermission.Kick | GuildPermission.Motd | GuildPermission.Deposit | GuildPermission.Withdraw | GuildPermission.Ranks },
  { name: 'Membre', permissions: GuildPermission.Deposit },
  { name: 'Recrue', permissions: 0 },
];

/** Emblem choices. */
export const EMBLEM_SHAPES = ['shield', 'round', 'banner', 'diamond'] as const;
export const EMBLEM_PATTERNS = ['plain', 'halves', 'quarters', 'stripe', 'chevron'] as const;
export const EMBLEM_SYMBOLS = ['star', 'sword', 'crown', 'tree', 'moon', 'flame', 'key', 'wing'] as const;
export const EMBLEM_COLORS = ['#b3262d', '#e0852c', '#e6c12e', '#3a8e4c', '#2a6fc0', '#5c3a9e', '#202433', '#f2efe6', '#7a4a26', '#1f8f8f'] as const;

/** A guild emblem (indices in the lists above). */
export interface Emblem {
  shape: number;
  pattern: number;
  primary: number;
  secondary: number;
  symbol: number;
  symbolColor: number;
}

/** Coerces an untrusted emblem. */
export function sanitizeEmblem(raw: unknown): Emblem {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = (key: string, count: number, fallback: number) => {
    const v = Number(src[key]);
    return Number.isInteger(v) && v >= 0 && v < count ? v : fallback;
  };
  return {
    shape: pick('shape', EMBLEM_SHAPES.length, 0),
    pattern: pick('pattern', EMBLEM_PATTERNS.length, 0),
    primary: pick('primary', EMBLEM_COLORS.length, 4),
    secondary: pick('secondary', EMBLEM_COLORS.length, 2),
    symbol: pick('symbol', EMBLEM_SYMBOLS.length, 0),
    symbolColor: pick('symbolColor', EMBLEM_COLORS.length, 7),
  };
}

/** Rules of guild names and tags. */
export const GUILD_NAME = /^[\p{L}\p{N}' -]{3,24}$/u;
export const GUILD_TAG = /^[\p{L}\p{N}]{2,5}$/u;

/** Experience a guild needs to go from `level` to the next one. */
export function guildLevelXp(level: number): number {
  return 1000 * level;
}

/** Bank slots of a guild at a level. */
export function guildBankSlots(level: number): number {
  return 20 + 10 * (level - 1);
}

/** A guild member as listed in the guild window. */
export interface GuildMemberView {
  id: number;
  name: string;
  rank: number;
  level: number;
  online: boolean;
  /** Last connection (ISO date), for offline members. */
  lastSeen: string | null;
}

/** A guild log line (details are shown by the client from the action). */
export interface GuildLogView {
  action: string;
  who: string;
  details: Record<string, string | number>;
  at: string;
}

/** Payload of the `guild` event (null: not in a guild). */
export interface GuildView {
  id: number;
  name: string;
  tag: string;
  emblem: Emblem;
  motd: string;
  level: number;
  xp: number;
  xpNext: number;
  ranks: { name: string; permissions: number }[];
  members: GuildMemberView[];
  /** The player's own rank. */
  myRank: number;
  bank: { gold: number; slots: number; items: { kind: 'item' | 'weapon' | 'armor'; id: number; quantity: number; name: string; icon: number }[] };
  log: GuildLogView[];
}

/** A party member as shown by the party frames. */
export interface PartyMemberView {
  id: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** On the same map as the viewer. */
  near: boolean;
  online: boolean;
}

/** Payload of the `party` event (null: not in a party). */
export interface PartyView {
  leader: number;
  members: PartyMemberView[];
  /** Loot sharing: each member rolls its own drops, or drops go in turn to one member. */
  loot: 'personal' | 'shared';
  /** Raid: a larger party (up to the raid size of the System settings). */
  raid: boolean;
}
