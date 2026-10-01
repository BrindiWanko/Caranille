/**
 * @file Chat, friends and trades as exchanged between the server and the
 * client. Messages are plain text (never HTML); the client displays them as
 * text nodes. System messages carry a translation key instead of a text.
 * Also: what a player shows when inspected, and reports.
 */
import type { CharacterAppearance } from './art/character.js';
import type { EquipSlot } from './database.js';

/** Chat channels. */
export const CHAT_CHANNELS = ['map', 'global', 'private', 'party', 'guild', 'system'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

/** Channels a player can write in without a command. */
export type WritableChannel = 'map' | 'global' | 'party' | 'guild';

/** Longest chat message. */
export const MAX_CHAT_LENGTH = 200;

/** An item named between brackets in a message (`[Potion]`), with its details. */
export interface ItemLink {
  name: string;
  icon: number;
  description: string;
}

/** One chat message. */
export interface ChatMessage {
  channel: ChatChannel;
  from?: { id: number; name: string };
  /** Recipient of a private message (echo sent to the writer). */
  to?: { id: number; name: string };
  text: string;
  /** `/me` action ("Alice waves"). */
  action?: boolean;
  /** System messages: translation key and parameters (then `text` is empty). */
  key?: string;
  params?: Record<string, string | number>;
  links?: ItemLink[];
  /** Server time. */
  at: number;
}

/** A friend as shown in the friends window. */
export interface FriendView {
  id: number;
  name: string;
  online: boolean;
  /** Where the friend is (map display name), when online. */
  location: string;
  level: number;
}

/** Payload of the `friends` event. */
export interface FriendsPayload {
  friends: FriendView[];
  ignored: { id: number; name: string }[];
}

/** An entry offered in a trade (texts are game content). */
export interface TradeItemView {
  kind: 'item' | 'weapon' | 'armor';
  id: number;
  quantity: number;
  name: string;
  icon: number;
}

/** One side of a trade. */
export interface TradeSide {
  items: TradeItemView[];
  gold: number;
  /** The offer is locked (cannot change any more). */
  locked: boolean;
  /** The trade is accepted (only possible once both sides are locked). */
  confirmed: boolean;
}

/** State of the trade window, or `null` when it closes. */
export interface TradeView {
  partner: { id: number; name: string };
  mine: TradeSide;
  theirs: TradeSide;
}

/** Most different entries offered by one side. */
export const MAX_TRADE_ITEMS = 12;

/** Longest reason of a report. */
export const MAX_REPORT_LENGTH = 200;

/** Payload of the `inspect` event: what another player shows of itself. */
export interface InspectPayload {
  id: number;
  name: string;
  level: number;
  /** Class name (game content). */
  className: string;
  guildTag: string;
  appearance: CharacterAppearance;
  /** Equipped items, slot by slot. */
  equipment: { slot: EquipSlot; name: string; icon: number }[];
}
