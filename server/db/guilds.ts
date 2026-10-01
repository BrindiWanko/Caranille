/**
 * @file Repository of guilds: creation (paid in one transaction), members
 * and ranks, message of the day, experience and level, bank (items and gold
 * moved with the member's bag in one transaction) and the guild log.
 */
import { DEFAULT_RANKS, sanitizeEmblem, type Emblem } from '../../shared/guild.js';
import type { Db } from './database.js';
import { MAX_GOLD, type InventoryRow, type ItemKind } from './inventory.js';

/** A guild row. */
export interface Guild {
  id: number;
  name: string;
  tag: string;
  emblem: Emblem;
  motd: string;
  level: number;
  xp: number;
  gold: number;
}

/** A member row. */
export interface GuildMember {
  characterId: number;
  name: string;
  rank: number;
  level: number;
  lastPlayed: string | null;
}

type GuildRow = Omit<Guild, 'emblem'> & { emblem: string };

/** Why a guild could not be created (translation key). */
export type CreateResult = { ok: true; guild: Guild } | { ok: false; error: 'error.guild.name_taken' | 'error.guild.not_enough_gold' | 'error.guild.already' };

/** Data access for guilds. */
export class GuildRepository {
  constructor(private readonly db: Db) {}

  private toGuild(r: GuildRow | undefined): Guild | undefined {
    return r ? { ...r, emblem: sanitizeEmblem(JSON.parse(r.emblem)) } : undefined;
  }

  get(id: number): Guild | undefined {
    return this.toGuild(this.db.prepare<[number], GuildRow>('SELECT id, name, tag, emblem, motd, level, xp, gold FROM guilds WHERE id = ?').get(id));
  }

  /** Guild and rank of a character, or `null`. */
  membership(characterId: number): { guildId: number; rank: number } | null {
    const r = this.db.prepare<[number], { guild_id: number; rank: number }>('SELECT guild_id, rank FROM guild_members WHERE character_id = ?').get(characterId);
    return r ? { guildId: r.guild_id, rank: r.rank } : null;
  }

  members(guildId: number): GuildMember[] {
    return this.db
      .prepare<[number], { character_id: number; name: string; rank: number; level: number; last_played: string | null }>(
        'SELECT m.character_id, c.name, m.rank, c.level, c.last_played FROM guild_members m JOIN characters c ON c.id = m.character_id WHERE m.guild_id = ? ORDER BY m.rank, c.name',
      )
      .all(guildId)
      .map((r) => ({ characterId: r.character_id, name: r.name, rank: r.rank, level: r.level, lastPlayed: r.last_played }));
  }

  ranks(guildId: number): { name: string; permissions: number }[] {
    return this.db.prepare<[number], { name: string; permissions: number }>('SELECT name, permissions FROM guild_ranks WHERE guild_id = ? ORDER BY rank').all(guildId);
  }

  /**
   * Creates a guild: pays the cost from the founder's gold, creates the ranks
   * and makes the founder its leader, all in one transaction.
   */
  create(founderId: number, name: string, tag: string, emblem: Emblem, cost: number): CreateResult {
    return this.db.transaction((): CreateResult => {
      if (this.membership(founderId)) return { ok: false, error: 'error.guild.already' };
      const taken = this.db.prepare<[string, string], number>('SELECT COUNT(*) FROM guilds WHERE name = ? COLLATE NOCASE OR tag = ? COLLATE NOCASE').pluck().get(name, tag) ?? 0;
      if (taken > 0) return { ok: false, error: 'error.guild.name_taken' };
      const gold = this.db.prepare<[number], number>('SELECT gold FROM characters WHERE id = ?').pluck().get(founderId) ?? 0;
      if (gold < cost) return { ok: false, error: 'error.guild.not_enough_gold' };
      this.db.prepare('UPDATE characters SET gold = ? WHERE id = ?').run(gold - cost, founderId);
      const id = Number(this.db.prepare('INSERT INTO guilds (name, tag, emblem) VALUES (?, ?, ?)').run(name, tag, JSON.stringify(emblem)).lastInsertRowid);
      DEFAULT_RANKS.forEach((r, i) => this.db.prepare('INSERT INTO guild_ranks (guild_id, rank, name, permissions) VALUES (?, ?, ?, ?)').run(id, i, r.name, r.permissions));
      this.db.prepare('INSERT INTO guild_members (character_id, guild_id, rank) VALUES (?, ?, 0)').run(founderId, id);
      this.log(id, founderId, 'created', { name });
      return { ok: true, guild: this.get(id)! };
    }).immediate();
  }

  /** Adds a member at the lowest rank (fails if already in a guild). */
  addMember(guildId: number, characterId: number, rank: number): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO guild_members (character_id, guild_id, rank) VALUES (?, ?, ?)').run(characterId, guildId, rank).changes === 1;
  }

  removeMember(characterId: number): void {
    this.db.prepare('DELETE FROM guild_members WHERE character_id = ?').run(characterId);
  }

  setRank(characterId: number, rank: number): void {
    this.db.prepare('UPDATE guild_members SET rank = ? WHERE character_id = ?').run(rank, characterId);
  }

  setRankInfo(guildId: number, rank: number, name: string, permissions: number): void {
    this.db.prepare('UPDATE guild_ranks SET name = ?, permissions = ? WHERE guild_id = ? AND rank = ?').run(name, permissions, guildId, rank);
  }

  setMotd(guildId: number, motd: string): void {
    this.db.prepare('UPDATE guilds SET motd = ? WHERE id = ?').run(motd, guildId);
  }

  /** Deletes a guild (its members, ranks, bank and log go with it). */
  disband(guildId: number): void {
    this.db.prepare('DELETE FROM guilds WHERE id = ?').run(guildId);
  }

  /** Stores level and experience. */
  setProgress(guildId: number, level: number, xp: number): void {
    this.db.prepare('UPDATE guilds SET level = ?, xp = ? WHERE id = ?').run(level, xp, guildId);
  }

  // --- Bank ----------------------------------------------------------------------

  bankItems(guildId: number): InventoryRow[] {
    return this.db
      .prepare<[number], { item_kind: ItemKind; item_id: number; quantity: number }>('SELECT item_kind, item_id, quantity FROM guild_bank_items WHERE guild_id = ? ORDER BY item_kind, item_id')
      .all(guildId)
      .map((r) => ({ kind: r.item_kind, id: r.item_id, quantity: r.quantity }));
  }

  /**
   * Moves items between a member's bag and the guild bank in one transaction.
   * @param slots - Different entries the bank may hold.
   * @param bagMax - Largest quantity the bag may hold of this entry; `bagRoom` whether a new entry fits in the bag.
   * @returns The quantity moved.
   */
  moveItems(guildId: number, characterId: number, kind: ItemKind, id: number, amount: number, deposit: boolean, slots: number, bagMax: number, bagRoom: boolean): number {
    return this.db.transaction(() => {
      const bagQ = this.db.prepare<[number, string, number], number>('SELECT quantity FROM character_items WHERE character_id = ? AND item_kind = ? AND item_id = ?').pluck();
      const bankQ = this.db.prepare<[number, string, number], number>('SELECT quantity FROM guild_bank_items WHERE guild_id = ? AND item_kind = ? AND item_id = ?').pluck();
      const inBag = bagQ.get(characterId, kind, id) ?? 0;
      const inBank = bankQ.get(guildId, kind, id) ?? 0;
      let moved: number;
      if (deposit) {
        const entries = this.db.prepare<[number], number>('SELECT COUNT(*) FROM guild_bank_items WHERE guild_id = ?').pluck().get(guildId) ?? 0;
        if (inBank === 0 && entries >= slots) return 0;
        moved = Math.min(amount, inBag, 9999 - inBank);
      } else {
        if (inBag === 0 && !bagRoom) return 0;
        moved = Math.min(amount, inBank, bagMax - inBag);
      }
      if (moved <= 0) return 0;
      const bag = deposit ? inBag - moved : inBag + moved;
      const bank = deposit ? inBank + moved : inBank - moved;
      if (bag > 0) this.db.prepare(`INSERT INTO character_items (character_id, item_kind, item_id, quantity) VALUES (?, ?, ?, ?) ON CONFLICT(character_id, item_kind, item_id) DO UPDATE SET quantity = excluded.quantity`).run(characterId, kind, id, bag);
      else this.db.prepare('DELETE FROM character_items WHERE character_id = ? AND item_kind = ? AND item_id = ?').run(characterId, kind, id);
      if (bank > 0) this.db.prepare(`INSERT INTO guild_bank_items (guild_id, item_kind, item_id, quantity) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, item_kind, item_id) DO UPDATE SET quantity = excluded.quantity`).run(guildId, kind, id, bank);
      else this.db.prepare('DELETE FROM guild_bank_items WHERE guild_id = ? AND item_kind = ? AND item_id = ?').run(guildId, kind, id);
      this.log(guildId, characterId, deposit ? 'deposit' : 'withdraw', { kind, id, quantity: moved });
      return moved;
    })();
  }

  /** Moves gold between a member and the guild bank (positive = deposit). */
  moveGold(guildId: number, characterId: number, amount: number): boolean {
    return this.db.transaction(() => {
      const purse = this.db.prepare<[number], number>('SELECT gold FROM characters WHERE id = ?').pluck().get(characterId) ?? 0;
      const bank = this.db.prepare<[number], number>('SELECT gold FROM guilds WHERE id = ?').pluck().get(guildId) ?? 0;
      if (amount === 0 || (amount > 0 && purse < amount) || (amount < 0 && bank < -amount) || purse - amount > MAX_GOLD || bank + amount > MAX_GOLD) return false;
      this.db.prepare('UPDATE characters SET gold = ? WHERE id = ?').run(purse - amount, characterId);
      this.db.prepare('UPDATE guilds SET gold = ? WHERE id = ?').run(bank + amount, guildId);
      this.log(guildId, characterId, amount > 0 ? 'deposit_gold' : 'withdraw_gold', { amount: Math.abs(amount) });
      return true;
    })();
  }

  // --- Log -----------------------------------------------------------------------

  log(guildId: number, characterId: number | null, action: string, details: Record<string, string | number> = {}): void {
    this.db.prepare('INSERT INTO guild_log (guild_id, character_id, action, details) VALUES (?, ?, ?, ?)').run(guildId, characterId, action, JSON.stringify(details));
  }

  /** Latest log lines. */
  logLines(guildId: number, limit = 50): { action: string; who: string; details: Record<string, string | number>; at: string }[] {
    return this.db
      .prepare<[number, number], { action: string; name: string | null; details: string; created_at: string }>(
        'SELECT l.action, c.name, l.details, l.created_at FROM guild_log l LEFT JOIN characters c ON c.id = l.character_id WHERE l.guild_id = ? ORDER BY l.id DESC LIMIT ?',
      )
      .all(guildId, limit)
      .map((r) => ({ action: r.action, who: r.name ?? '?', details: JSON.parse(r.details) as Record<string, string | number>, at: r.created_at }));
  }
}
