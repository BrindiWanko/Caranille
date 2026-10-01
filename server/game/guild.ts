/**
 * @file Guilds: creation (cost from the System settings), name, tag and
 * emblem, ranks with permissions, invitations, removal, message of the day,
 * guild chat, guild bank (items and gold) with its log, and the guild level
 * (members earn guild experience as they gain experience; each level adds
 * bank slots).
 *
 * Rank 0 is the leader. A member may only act on members and ranks strictly
 * below its own rank, and only with the permissions of its rank. The tag of a
 * member's guild is shown under its name to the other players.
 */
import { GUILD_NAME, GUILD_RANKS, GUILD_TAG, GuildPermission, guildBankSlots, guildLevelXp, sanitizeEmblem, type GuildView } from '../../shared/guild.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import type { ItemKind } from '../db/inventory.js';
import type { PlayerSession, World } from './world.js';

/** An invitation expires after this delay. */
const INVITE_MS = 60_000;
/** Guild experience per point of experience gained by a member. */
const GUILD_XP_RATE = 0.1;

/** Guilds for the whole world. */
export class GuildService {
  private readonly invites = new Map<number, { guildId: number; from: number; at: number }>();

  constructor(private readonly world: World) {
    world.social.guildMembers = (p) => (p.guild ? this.onlineMembers(p.guild.id) : null);
    world.social.commands.set('ginvite', (p, arg) => {
      const lower = arg.trim().toLowerCase();
      const target = [...world.allPlayers()].find((o) => o.name.toLowerCase() === lower && world.isLive(o));
      if (target) this.invite(p, target.characterId);
      else world.social.system(p, 'error.chat.offline', { name: arg });
    });
  }

  private get repo() {
    return this.world.ctx.guilds;
  }

  private notify(p: PlayerSession, key: string, params?: Record<string, string | number>): void {
    p.socket.emit('notify', { key, params });
  }

  /** Online members of a guild. */
  onlineMembers(guildId: number): PlayerSession[] {
    return [...this.world.allPlayers()].filter((m) => m.guild?.id === guildId && this.world.isLive(m));
  }

  /** Tag shown under a player's name (empty without a guild). */
  tagOf(p: PlayerSession): string {
    return p.guild ? (this.repo.get(p.guild.id)?.tag ?? '') : '';
  }

  /** Tells whether a member has a permission. */
  private can(p: PlayerSession, permission: number): boolean {
    if (!p.guild) return false;
    const rank = this.repo.ranks(p.guild.id)[p.guild.rank];
    return p.guild.rank === 0 || ((rank?.permissions ?? 0) & permission) !== 0;
  }

  // --- Presence ----------------------------------------------------------------------

  /** A player entered the world: its guild is loaded. */
  playerJoined(p: PlayerSession): void {
    const m = this.repo.membership(p.characterId);
    p.guild = m ? { id: m.guildId, rank: m.rank } : null;
  }

  /** The guild window of a player. */
  view(p: PlayerSession): GuildView | null {
    if (!p.guild) return null;
    const guild = this.repo.get(p.guild.id);
    if (!guild) return null;
    const data = this.world.ctx.gameData;
    const items = this.repo.bankItems(guild.id).flatMap((r) => {
      const def = r.kind === 'item' ? data.get('item', r.id) : r.kind === 'weapon' ? data.get('weapon', r.id) : data.get('armor', r.id);
      return def ? [{ ...r, name: def.name, icon: def.icon }] : [];
    });
    const logNames = (d: Record<string, string | number>) => {
      if (typeof d.kind === 'string' && typeof d.id === 'number') {
        const def = d.kind === 'item' ? data.get('item', d.id) : d.kind === 'weapon' ? data.get('weapon', d.id) : data.get('armor', d.id);
        return { ...d, item: def?.name ?? '?' };
      }
      return d;
    };
    return {
      id: guild.id,
      name: guild.name,
      tag: guild.tag,
      emblem: guild.emblem,
      motd: guild.motd,
      level: guild.level,
      xp: guild.xp,
      xpNext: guildLevelXp(guild.level),
      ranks: this.repo.ranks(guild.id),
      members: this.repo.members(guild.id).map((m) => {
        const online = this.world.player(m.characterId);
        return { id: m.characterId, name: m.name, rank: m.rank, level: online?.level ?? m.level, online: !!online && this.world.isLive(online), lastSeen: m.lastPlayed };
      }),
      myRank: p.guild.rank,
      bank: { gold: guild.gold, slots: guildBankSlots(guild.level), items },
      log: this.repo.logLines(guild.id).map((l) => ({ ...l, details: logNames(l.details) })),
    };
  }

  /** Sends the guild window to a player. */
  push(p: PlayerSession): void {
    if (this.world.isLive(p)) p.socket.emit('guild', this.view(p));
  }

  /** Sends the guild window to every online member. */
  private pushAll(guildId: number): void {
    for (const m of this.onlineMembers(guildId)) this.push(m);
  }

  /** Tells the players of a map about a changed tag. */
  private tagChanged(p: PlayerSession): void {
    this.world.room(p.mapId, p.instance)?.emit('playerGuild', { id: p.characterId, tag: this.tagOf(p) });
  }

  // --- Creation and membership --------------------------------------------------------

  /** Founds a guild. */
  create(p: PlayerSession, name: string, tag: string, emblem: unknown): void {
    const n = name.trim().replace(/\s+/g, ' ');
    const t = tag.trim();
    if (!GUILD_NAME.test(n) || !GUILD_TAG.test(t)) return this.notify(p, 'error.guild.invalid_name');
    const cost = this.world.ctx.settings.get('guildCreationCost', DEFAULT_SETTINGS.guildCreationCost);
    const result = this.repo.create(p.characterId, n, t, sanitizeEmblem(emblem), cost);
    if (!result.ok) return this.notify(p, result.error, { cost, currency: this.world.currencyName() });
    p.guild = { id: result.guild.id, rank: 0 };
    p.socket.emit('playerUpdate', { gold: this.world.ctx.inventory.gold(p.characterId) });
    this.world.pushInventory(p);
    this.notify(p, 'notify.guild_created', { name: n });
    this.push(p);
    this.tagChanged(p);
  }

  /** Invites a player into the guild. */
  invite(p: PlayerSession, targetId: number): void {
    const target = this.world.player(targetId);
    if (!p.guild || !this.can(p, GuildPermission.Invite)) return this.notify(p, 'error.guild.permission');
    if (!target || target === p || !this.world.isLive(target) || this.world.social.ignores(target, p.characterId)) return this.notify(p, 'error.guild.unavailable');
    if (target.guild) return this.notify(p, 'error.guild.target_in_guild', { name: target.name });
    const guild = this.repo.get(p.guild.id)!;
    this.invites.set(target.characterId, { guildId: guild.id, from: p.characterId, at: Date.now() });
    target.socket.emit('guildInvite', { id: p.characterId, name: p.name, guild: guild.name });
    this.notify(p, 'notify.guild_invited', { name: target.name });
  }

  /** Answers an invitation. */
  respond(p: PlayerSession, accept: boolean): void {
    const invite = this.invites.get(p.characterId);
    this.invites.delete(p.characterId);
    if (!invite || Date.now() - invite.at > INVITE_MS || p.guild) return;
    const from = this.world.player(invite.from);
    if (!accept) {
      if (from) this.notify(from, 'notify.guild_declined', { name: p.name });
      return;
    }
    if (!this.repo.get(invite.guildId) || !this.repo.addMember(invite.guildId, p.characterId, GUILD_RANKS - 1)) return;
    p.guild = { id: invite.guildId, rank: GUILD_RANKS - 1 };
    this.repo.log(invite.guildId, p.characterId, 'joined');
    for (const m of this.onlineMembers(invite.guildId)) this.notify(m, 'notify.guild_joined', { name: p.name });
    this.pushAll(invite.guildId);
    this.tagChanged(p);
  }

  /** Leaves the guild (the leader must hand over the lead first, unless it is alone: the guild ends). */
  leave(p: PlayerSession): void {
    if (!p.guild) return;
    const guildId = p.guild.id;
    const members = this.repo.members(guildId);
    if (p.guild.rank === 0 && members.length > 1) return this.notify(p, 'error.guild.leader_leave');
    if (members.length <= 1) this.repo.disband(guildId);
    else {
      this.repo.removeMember(p.characterId);
      this.repo.log(guildId, p.characterId, 'left');
    }
    p.guild = null;
    this.push(p);
    this.tagChanged(p);
    this.pushAll(guildId);
  }

  /**
   * A character is about to be deleted: it leaves its guild. A leader hands the
   * lead to the highest-ranked remaining member; a guild left empty ends.
   */
  characterDeleted(characterId: number, name: string): void {
    const membership = this.repo.membership(characterId);
    if (!membership) return;
    const { guildId } = membership;
    const heir = this.repo.members(guildId).find((m) => m.characterId !== characterId);
    if (!heir) {
      this.repo.disband(guildId);
      return;
    }
    this.repo.removeMember(characterId);
    this.repo.log(guildId, null, 'deleted', { name });
    if (membership.rank === 0) {
      this.repo.setRank(heir.characterId, 0);
      this.repo.log(guildId, null, 'new_leader', { name: heir.name });
      const online = this.world.player(heir.characterId);
      if (online?.guild) online.guild.rank = 0;
    }
    this.pushAll(guildId);
  }

  /** Removes a member of a lower rank. */
  kick(p: PlayerSession, targetId: number): void {
    const target = this.memberBelow(p, targetId, GuildPermission.Kick);
    if (!target || !p.guild) return;
    this.repo.removeMember(targetId);
    this.repo.log(p.guild.id, p.characterId, 'kicked', { name: target.name });
    const online = this.world.player(targetId);
    if (online) {
      online.guild = null;
      this.notify(online, 'notify.guild_kicked');
      this.push(online);
      this.tagChanged(online);
    }
    this.pushAll(p.guild.id);
  }

  /** A member of a lower rank, if the player has the permission. */
  private memberBelow(p: PlayerSession, targetId: number, permission: number): { name: string; rank: number } | null {
    if (!p.guild || !this.can(p, permission)) {
      this.notify(p, 'error.guild.permission');
      return null;
    }
    const target = this.repo.members(p.guild.id).find((m) => m.characterId === targetId);
    if (!target || target.rank <= p.guild.rank) {
      this.notify(p, 'error.guild.permission');
      return null;
    }
    return target;
  }

  /** Moves a member of a lower rank to another rank below the player's own. */
  setMemberRank(p: PlayerSession, targetId: number, rank: number): void {
    if (!p.guild || !Number.isInteger(rank) || rank < 0 || rank >= GUILD_RANKS) return;
    // The leader hands over the lead: it becomes second.
    if (rank === 0 && p.guild.rank === 0) {
      const target = this.repo.members(p.guild.id).find((m) => m.characterId === targetId);
      if (!target || targetId === p.characterId) return;
      this.repo.setRank(targetId, 0);
      this.repo.setRank(p.characterId, 1);
      p.guild.rank = 1;
      const online = this.world.player(targetId);
      if (online?.guild) online.guild.rank = 0;
      this.repo.log(p.guild.id, p.characterId, 'leader', { name: target.name });
      this.pushAll(p.guild.id);
      return;
    }
    const target = this.memberBelow(p, targetId, GuildPermission.Ranks);
    if (!target || rank <= p.guild.rank) return;
    this.repo.setRank(targetId, rank);
    const online = this.world.player(targetId);
    if (online?.guild) online.guild.rank = rank;
    this.repo.log(p.guild.id, p.characterId, 'rank', { name: target.name, rank });
    this.pushAll(p.guild.id);
  }

  /** Renames a rank below the player's and sets its permissions. */
  editRank(p: PlayerSession, rank: number, name: string, permissions: number): void {
    if (!p.guild || !this.can(p, GuildPermission.Ranks) || !Number.isInteger(rank) || rank <= p.guild.rank || rank >= GUILD_RANKS) return this.notify(p, 'error.guild.permission');
    const n = name.trim().slice(0, 20) || `#${rank}`;
    // A rank never gets permissions its editor does not have.
    const mine = p.guild.rank === 0 ? 63 : (this.repo.ranks(p.guild.id)[p.guild.rank]?.permissions ?? 0);
    this.repo.setRankInfo(p.guild.id, rank, n, (permissions & 63) & mine);
    this.repo.log(p.guild.id, p.characterId, 'rank_edit', { rank, name: n });
    this.pushAll(p.guild.id);
  }

  /** Changes the message of the day. */
  setMotd(p: PlayerSession, motd: string): void {
    if (!p.guild || !this.can(p, GuildPermission.Motd)) return this.notify(p, 'error.guild.permission');
    this.repo.setMotd(p.guild.id, motd.replace(/[\u0000-\u001f]/g, ' ').slice(0, 300));
    this.repo.log(p.guild.id, p.characterId, 'motd');
    this.pushAll(p.guild.id);
  }

  // --- Bank ----------------------------------------------------------------------------

  /** Deposits or withdraws items. */
  bankItems(p: PlayerSession, kind: ItemKind, id: number, quantity: number, deposit: boolean): void {
    if (!p.guild || !this.can(p, deposit ? GuildPermission.Deposit : GuildPermission.Withdraw)) return this.notify(p, 'error.guild.permission');
    if (kind === 'item' && this.world.ctx.gameData.get('item', id)?.kind !== 'regular') return this.notify(p, 'error.item.cannot_discard');
    const guild = this.repo.get(p.guild.id)!;
    const inv = this.world.ctx.inventoryService;
    const moved = this.repo.moveItems(guild.id, p.characterId, kind, id, Math.max(1, Math.min(9999, quantity)), deposit, guildBankSlots(guild.level), inv.maxOf(kind, id), inv.hasRoomFor(p.characterId, kind, id));
    if (moved === 0) return this.notify(p, deposit ? 'error.guild.bank_full' : 'error.bag.full');
    this.world.pushInventory(p);
    this.pushAll(guild.id);
  }

  /** Deposits (positive) or withdraws (negative) gold. */
  bankGold(p: PlayerSession, amount: number): void {
    if (!p.guild || !this.can(p, amount > 0 ? GuildPermission.Deposit : GuildPermission.Withdraw)) return this.notify(p, 'error.guild.permission');
    if (!this.repo.moveGold(p.guild.id, p.characterId, Math.trunc(amount))) return;
    p.socket.emit('playerUpdate', { gold: this.world.ctx.inventory.gold(p.characterId) });
    this.world.pushInventory(p);
    this.pushAll(p.guild.id);
  }

  // --- Level ---------------------------------------------------------------------------

  /** A member gained experience: part of it goes to the guild. */
  memberGainedExp(p: PlayerSession, exp: number): void {
    if (!p.guild || exp <= 0) return;
    const guild = this.repo.get(p.guild.id);
    if (!guild) return;
    let xp = guild.xp + Math.max(1, Math.floor(exp * GUILD_XP_RATE));
    let level = guild.level;
    while (xp >= guildLevelXp(level)) {
      xp -= guildLevelXp(level);
      level++;
    }
    this.repo.setProgress(guild.id, level, xp);
    if (level > guild.level) {
      this.repo.log(guild.id, null, 'level', { level });
      for (const m of this.onlineMembers(guild.id)) this.notify(m, 'notify.guild_level', { level });
      this.pushAll(guild.id);
    }
  }
}
