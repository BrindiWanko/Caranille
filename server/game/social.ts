/**
 * @file Chat, friends, ignore lists and emotes.
 *
 * Chat channels: map (players of the same map, shown as bubbles too),
 * global (everybody), private (`/w name`, `/r` to answer), party and guild
 * (filled in by the party and guild systems), system (server messages).
 * Commands start with `/`: `/w` `/r` `/s` `/all` `/p` `/g` `/me` `/e`
 * `/friend` `/unfriend` `/ignore` `/unignore` `/who` `/help`.
 *
 * Anti-flood: a small token bucket per player (a burst of 5 messages, then
 * one every 2 seconds) and repeated identical messages are refused. A
 * message is never delivered to a player who ignores its writer. Item names
 * between brackets (`[Potion]`) become item links with their details.
 *
 * Also: inspecting another player (level, class, guild, equipment) and
 * reporting a player to the moderators (stored in the reports log).
 */
import { EQUIP_SLOTS } from '../../shared/database.js';
import { MAX_CHAT_LENGTH, MAX_REPORT_LENGTH, type ChatMessage, type FriendsPayload, type InspectPayload, type ItemLink, type WritableChannel } from '../../shared/social.js';
import type { PlayerSession, World } from './world.js';

/** Burst of messages, and seconds per new message. */
const CHAT_BURST = 5;
const CHAT_REFILL_S = 2;
/** Identical messages in a row allowed. */
const MAX_REPEATS = 2;
/** Delay between two reports of the same player. */
const REPORT_DELAY_MS = 30_000;

/** Social state of a connected player. */
export interface PlayerSocial {
  friends: Set<number>;
  ignored: Set<number>;
  /** Last player who whispered to this one (`/r`). */
  lastWhisper: number;
  tokens: number;
  lastRefill: number;
  lastText: string;
  repeats: number;
  /** Time of the last report sent. */
  lastReport: number;
}

/** A new social state (loaded when entering the world). */
export function emptySocial(): PlayerSocial {
  return { friends: new Set(), ignored: new Set(), lastWhisper: 0, tokens: CHAT_BURST, lastRefill: Date.now(), lastText: '', repeats: 0, lastReport: 0 };
}

/** Chat and friends for the whole world. */
export class SocialService {
  /**
   * Party and guild channels: recipients of a player's party / guild message,
   * or `null` when the player is in none (set by the party and guild systems).
   */
  partyMembers: (p: PlayerSession) => PlayerSession[] | null = () => null;
  guildMembers: (p: PlayerSession) => PlayerSession[] | null = () => null;

  constructor(private readonly world: World) {}

  private get ctx() {
    return this.world.ctx;
  }

  // --- Presence -------------------------------------------------------------------

  /** A player entered the world: lists loaded, friends told. */
  playerJoined(p: PlayerSession): void {
    const repo = this.ctx.social;
    p.social = emptySocial();
    p.social.friends = new Set(repo.friends(p.characterId).map((f) => f.id));
    p.social.ignored = new Set(repo.ignored(p.characterId).map((f) => f.id));
    this.presence(p, true);
  }

  /** A player left the world: friends told. */
  playerLeft(p: PlayerSession): void {
    this.presence(p, false);
  }

  private presence(p: PlayerSession, online: boolean): void {
    for (const id of this.ctx.social.friendOf(p.characterId)) {
      const other = this.world.player(id);
      if (!other || other === p) continue;
      other.socket.emit('notify', { key: online ? 'notify.friend_online' : 'notify.friend_offline', params: { name: p.name } });
      this.pushFriends(other);
    }
  }

  /** The friends window of a player. */
  friendsPayload(p: PlayerSession): FriendsPayload {
    const repo = this.ctx.social;
    return {
      friends: repo.friends(p.characterId).map((f) => {
        const other = this.world.player(f.id);
        const online = !!other && this.world.isLive(other);
        return {
          id: f.id,
          name: f.name,
          online,
          location: online ? this.world.mapRuntime(other!.mapId)?.map.displayName || '' : '',
          level: other?.level ?? this.ctx.characters.findById(f.id)?.level ?? 1,
        };
      }),
      ignored: repo.ignored(p.characterId),
    };
  }

  pushFriends(p: PlayerSession): void {
    if (this.world.isLive(p)) p.socket.emit('friends', this.friendsPayload(p));
  }

  /** Adds a friend by name. */
  addFriend(p: PlayerSession, name: string): void {
    const target = this.ctx.social.findByName(name);
    if (!target || target.id === p.characterId) {
      this.system(p, 'error.social.unknown_player', { name });
      return;
    }
    this.ctx.social.addFriend(p.characterId, target.id);
    p.social.friends.add(target.id);
    this.system(p, 'notify.friend_added', { name: target.name });
    this.pushFriends(p);
  }

  removeFriend(p: PlayerSession, id: number): void {
    this.ctx.social.removeFriend(p.characterId, id);
    p.social.friends.delete(id);
    this.pushFriends(p);
  }

  /** Ignores a player by name (its messages, trade requests and invitations are refused). */
  ignore(p: PlayerSession, name: string): void {
    const target = this.ctx.social.findByName(name);
    if (!target || target.id === p.characterId) {
      this.system(p, 'error.social.unknown_player', { name });
      return;
    }
    this.ctx.social.ignore(p.characterId, target.id);
    p.social.ignored.add(target.id);
    this.system(p, 'notify.ignored', { name: target.name });
    this.pushFriends(p);
  }

  unignore(p: PlayerSession, id: number): void {
    this.ctx.social.unignore(p.characterId, id);
    p.social.ignored.delete(id);
    this.pushFriends(p);
  }

  /** Tells whether `p` ignores `other`. */
  ignores(p: PlayerSession, otherId: number): boolean {
    return p.social.ignored.has(otherId);
  }

  // --- Inspect and report ------------------------------------------------------------

  /** Shows another player's level, class, guild and equipment (it must be in the world and visible). */
  inspect(p: PlayerSession, targetId: number): void {
    const target = this.world.player(targetId);
    if (!target || target.invisible) {
      this.system(p, 'error.social.not_online');
      return;
    }
    const data = this.ctx.gameData;
    const equipped = this.ctx.progression.equipment(target.characterId);
    const equipment: InspectPayload['equipment'] = [];
    for (const slot of EQUIP_SLOTS) {
      const e = equipped.get(slot);
      const def = e ? (e.kind === 'weapon' ? data.get('weapon', e.id) : data.get('armor', e.id)) : undefined;
      if (def) equipment.push({ slot, name: def.name, icon: def.icon });
    }
    p.socket.emit('inspect', {
      id: target.characterId,
      name: target.name,
      level: target.level,
      className: data.get('class', target.classId)?.name ?? '',
      guildTag: this.world.guilds.tagOf(target),
      appearance: target.appearance,
      equipment,
    });
  }

  /** Reports a player: stored for the administration panel, and told to the moderators online. */
  report(p: PlayerSession, targetId: number, reason: string): void {
    const text = reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REPORT_LENGTH);
    const target = this.ctx.characters.findById(targetId);
    if (!target || target.id === p.characterId || !text) return;
    const now = Date.now();
    if (now - p.social.lastReport < REPORT_DELAY_MS) {
      this.system(p, 'error.social.report_wait');
      return;
    }
    p.social.lastReport = now;
    this.ctx.admin.logReport({ id: p.characterId, name: p.name }, { id: target.id, name: target.name }, text);
    this.system(p, 'notify.report_sent', { name: target.name });
    for (const o of this.world.allPlayers()) {
      if (o.socket.data.role === 'moderator' || o.socket.data.role === 'admin') this.system(o, 'notify.report_received', { reporter: p.name, name: target.name, reason: text });
    }
  }

  // --- Chat ------------------------------------------------------------------------

  /** Sends a system message (translation key) to one player. */
  system(p: PlayerSession, key: string, params?: Record<string, string | number>): void {
    p.socket.emit('chat', { channel: 'system', text: '', key, params, at: Date.now() });
  }

  /** Anti-flood check; `true` when the message may go. */
  private allowed(p: PlayerSession, text: string): boolean {
    const s = p.social;
    const now = Date.now();
    s.tokens = Math.min(CHAT_BURST, s.tokens + (now - s.lastRefill) / 1000 / CHAT_REFILL_S);
    s.lastRefill = now;
    if (s.tokens < 1) {
      this.system(p, 'error.chat.flood');
      return false;
    }
    if (text === s.lastText && ++s.repeats > MAX_REPEATS) {
      this.system(p, 'error.chat.repeat');
      return false;
    }
    if (text !== s.lastText) s.repeats = 0;
    s.lastText = text;
    s.tokens -= 1;
    return true;
  }

  /** Item links of a message (`[Name]` of an item, weapon or armor), at most three. */
  private links(text: string): ItemLink[] | undefined {
    const names = [...text.matchAll(/\[([^[\]]{1,60})\]/g)].map((m) => m[1]!.trim().toLowerCase()).slice(0, 3);
    if (names.length === 0) return undefined;
    const data = this.ctx.gameData;
    const all = [...data.list('item'), ...data.list('weapon'), ...data.list('armor')];
    const links = names.flatMap((n) => {
      const found = all.find((d) => d.name.toLowerCase() === n);
      return found ? [{ name: found.name, icon: found.icon, description: found.description }] : [];
    });
    return links.length ? links : undefined;
  }

  /** Delivers a message to players, skipping those who ignore the writer. */
  private deliver(recipients: Iterable<PlayerSession>, message: ChatMessage, writer: PlayerSession): void {
    for (const r of recipients) {
      if (r !== writer && this.ignores(r, writer.characterId)) continue;
      if (this.world.isLive(r)) r.socket.emit('chat', message);
    }
  }

  /** Online player by name (case-insensitive). */
  private online(name: string): PlayerSession | undefined {
    const lower = name.trim().toLowerCase();
    for (const p of this.world.allPlayers()) if (p.name.toLowerCase() === lower && this.world.isLive(p)) return p;
    return undefined;
  }

  /**
   * Handles a line typed in the chat: a command, or a message for the channel.
   * @param channel - Channel of the chat tab the line was typed in.
   */
  chat(p: PlayerSession, raw: string, channel: WritableChannel): void {
    const line = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!line) return;
    if (line.startsWith('/')) {
      this.command(p, line);
      return;
    }
    if (this.muted(p)) return;
    this.say(p, channel, line, false);
  }

  /** Sends a message on a channel. */
  private say(p: PlayerSession, channel: WritableChannel, text: string, action: boolean): void {
    if (!text || this.muted(p) || !this.allowed(p, text)) return;
    const message: ChatMessage = { channel, from: { id: p.characterId, name: p.name }, text, action: action || undefined, links: this.links(text), at: Date.now() };
    if (channel === 'map') this.deliver(this.world.playersOn(p.mapId, p.instance), message, p);
    else if (channel === 'global') this.deliver(this.world.allPlayers(), message, p);
    else {
      const members = channel === 'party' ? this.partyMembers(p) : this.guildMembers(p);
      if (!members) {
        this.system(p, channel === 'party' ? 'error.chat.no_party' : 'error.chat.no_guild');
        return;
      }
      this.deliver(members, message, p);
    }
  }

  /** Tells (and tells the player) whether its account is muted. */
  private muted(p: PlayerSession): boolean {
    if (!this.ctx.admin.isMuted(p.accountId)) return false;
    this.system(p, 'error.chat.muted');
    return true;
  }

  /** Sends a private message. */
  private whisper(p: PlayerSession, target: PlayerSession | undefined, name: string, text: string): void {
    if (this.muted(p)) return;
    if (!target) {
      this.system(p, 'error.chat.offline', { name });
      return;
    }
    if (!text || !this.allowed(p, text)) return;
    const message: ChatMessage = { channel: 'private', from: { id: p.characterId, name: p.name }, to: { id: target.characterId, name: target.name }, text, links: this.links(text), at: Date.now() };
    p.socket.emit('chat', message);
    if (target === p || this.ignores(target, p.characterId)) return;
    target.social.lastWhisper = p.characterId;
    target.socket.emit('chat', message);
  }

  /** Runs a chat command. */
  private command(p: PlayerSession, line: string): void {
    const [head = '', ...rest] = line.slice(1).split(/\s+/);
    const cmd = head.toLowerCase();
    const arg = rest.join(' ').trim();
    const firstWord = rest[0] ?? '';
    const afterFirst = rest.slice(1).join(' ').trim();
    switch (cmd) {
      case 'w':
      case 'tell':
      case 'msg':
        this.whisper(p, this.online(firstWord), firstWord, afterFirst);
        return;
      case 'r': {
        const target = this.world.player(p.social.lastWhisper);
        this.whisper(p, target && this.world.isLive(target) ? target : undefined, target?.name ?? '?', arg);
        return;
      }
      case 's':
      case 'say':
        this.say(p, 'map', arg, false);
        return;
      case 'all':
      case 'y':
        this.say(p, 'global', arg, false);
        return;
      case 'p':
        this.say(p, 'party', arg, false);
        return;
      case 'g':
        this.say(p, 'guild', arg, false);
        return;
      case 'me':
        this.say(p, 'map', arg, true);
        return;
      case 'e':
      case 'emote':
        this.emote(p, Number(arg) || 1);
        return;
      case 'friend':
      case 'ami':
        this.addFriend(p, arg);
        return;
      case 'unfriend': {
        const target = this.ctx.social.findByName(arg);
        if (target) this.removeFriend(p, target.id);
        return;
      }
      case 'ignore':
        this.ignore(p, arg);
        return;
      case 'unignore': {
        const target = this.ctx.social.findByName(arg);
        if (target) this.unignore(p, target.id);
        return;
      }
      case 'who': {
        const names = this.world.playersOn(p.mapId, p.instance).map((o) => o.name);
        this.system(p, 'notify.who', { count: names.length, names: names.slice(0, 30).join(', ') });
        return;
      }
      case 'help':
      case 'aide':
        this.system(p, 'notify.chat_help');
        return;
      default: {
        // Commands of other systems (party, guild) register here.
        const handler = this.commands.get(cmd);
        if (handler) handler(p, arg, rest);
        else this.system(p, 'error.chat.unknown_command', { command: `/${head}` });
      }
    }
  }

  /** Extra chat commands (`/invite`...), registered by other systems. */
  readonly commands = new Map<string, (p: PlayerSession, arg: string, words: string[]) => void>();

  // --- Emotes ---------------------------------------------------------------------

  /** Shows an emotion balloon above the player, for everyone on the map. */
  emote(p: PlayerSession, balloon: number): void {
    if (!this.allowed(p, `\u0000emote${balloon}${Date.now()}`)) return;
    this.world.room(p.mapId, p.instance)?.emit('emote', { id: p.characterId, balloon: Math.max(1, Math.min(10, Math.trunc(balloon))) });
  }
}
