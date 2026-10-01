/**
 * @file Repository of friend lists, ignore lists and trades.
 *
 * A trade moves items and gold between two characters in one transaction
 * that re-checks every quantity, the gold of both sides and the room in both
 * bags: either everything is exchanged or nothing is, so an item can never
 * be duplicated or lost, even if the offers changed at the last moment.
 */
import type { Db } from './database.js';
import { MAX_GOLD, type ItemKind } from './inventory.js';

/** A character reference. */
export interface CharacterName {
  id: number;
  name: string;
}

/** Items and gold offered by one side of a trade. */
export interface TradeOffer {
  items: { kind: ItemKind; id: number; quantity: number }[];
  gold: number;
}

/** Why a trade could not be executed (translation key), or `null` on success. */
export type TradeResult = null | 'error.trade.changed' | 'error.trade.bag_full' | 'error.trade.too_many';

/** A logged trade. */
export interface TradeLogEntry {
  id: number;
  aId: number;
  bId: number;
  aItems: TradeOffer['items'];
  bItems: TradeOffer['items'];
  aGold: number;
  bGold: number;
  createdAt: string;
}

/** Data access for social features. */
export class SocialRepository {
  constructor(private readonly db: Db) {}

  /** Character by name (case-insensitive). */
  findByName(name: string): CharacterName | undefined {
    return this.db.prepare<[string], CharacterName>('SELECT id, name FROM characters WHERE name = ? COLLATE NOCASE').get(name.trim());
  }

  /** Friends of a character. */
  friends(characterId: number): CharacterName[] {
    return this.db
      .prepare<[number], CharacterName>('SELECT c.id, c.name FROM character_friends f JOIN characters c ON c.id = f.friend_id WHERE f.character_id = ? ORDER BY c.name')
      .all(characterId);
  }

  /** Characters who have `characterId` as a friend (to tell them it came online). */
  friendOf(characterId: number): number[] {
    return this.db.prepare<[number], number>('SELECT character_id FROM character_friends WHERE friend_id = ?').pluck().all(characterId);
  }

  addFriend(characterId: number, friendId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO character_friends (character_id, friend_id) VALUES (?, ?)').run(characterId, friendId);
  }

  removeFriend(characterId: number, friendId: number): void {
    this.db.prepare('DELETE FROM character_friends WHERE character_id = ? AND friend_id = ?').run(characterId, friendId);
  }

  /** Characters ignored by a character. */
  ignored(characterId: number): CharacterName[] {
    return this.db
      .prepare<[number], CharacterName>('SELECT c.id, c.name FROM character_ignores i JOIN characters c ON c.id = i.ignored_id WHERE i.character_id = ? ORDER BY c.name')
      .all(characterId);
  }

  ignore(characterId: number, ignoredId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO character_ignores (character_id, ignored_id) VALUES (?, ?)').run(characterId, ignoredId);
  }

  unignore(characterId: number, ignoredId: number): void {
    this.db.prepare('DELETE FROM character_ignores WHERE character_id = ? AND ignored_id = ?').run(characterId, ignoredId);
  }

  /**
   * Executes a trade in one transaction.
   * @param maxOf - Largest quantity of an entry a character may hold.
   * @param bagSize - Number of different entries a bag can hold.
   */
  trade(aId: number, bId: number, a: TradeOffer, b: TradeOffer, maxOf: (kind: ItemKind, id: number) => number, bagSize: number): TradeResult {
    const quantity = this.db.prepare<[number, string, number], number>('SELECT quantity FROM character_items WHERE character_id = ? AND item_kind = ? AND item_id = ?').pluck();
    const entries = this.db.prepare<[number], number>('SELECT COUNT(*) FROM character_items WHERE character_id = ?').pluck();
    const gold = this.db.prepare<[number], number>('SELECT gold FROM characters WHERE id = ?').pluck();
    const setQty = this.db.prepare(`INSERT INTO character_items (character_id, item_kind, item_id, quantity) VALUES (?, ?, ?, ?)
      ON CONFLICT(character_id, item_kind, item_id) DO UPDATE SET quantity = excluded.quantity`);
    const del = this.db.prepare('DELETE FROM character_items WHERE character_id = ? AND item_kind = ? AND item_id = ?');
    const setGold = this.db.prepare('UPDATE characters SET gold = ? WHERE id = ?');
    const run = this.db.transaction((): TradeResult => {
      // Everything offered is still owned.
      for (const [owner, offer] of [[aId, a], [bId, b]] as const) {
        for (const it of offer.items) if ((quantity.get(owner, it.kind, it.id) ?? 0) < it.quantity) return 'error.trade.changed';
        if ((gold.get(owner) ?? 0) < offer.gold) return 'error.trade.changed';
      }
      // Everything received fits (stack limits and bag slots, counting the slots freed by what leaves).
      for (const [receiver, given, gets] of [[bId, b, a], [aId, a, b]] as const) {
        let slots = entries.get(receiver) ?? 0;
        for (const it of given.items) if ((quantity.get(receiver, it.kind, it.id) ?? 0) === it.quantity) slots--;
        for (const it of gets.items) {
          const current = quantity.get(receiver, it.kind, it.id) ?? 0;
          const leaving = given.items.find((x) => x.kind === it.kind && x.id === it.id)?.quantity ?? 0;
          if (current - leaving + it.quantity > maxOf(it.kind, it.id)) return 'error.trade.too_many';
          if (current - leaving === 0) slots++;
        }
        if (slots > bagSize) return 'error.trade.bag_full';
        if ((gold.get(receiver) ?? 0) - given.gold + gets.gold > MAX_GOLD) return 'error.trade.too_many';
      }
      const move = (from: number, to: number, it: TradeOffer['items'][number]) => {
        const left = (quantity.get(from, it.kind, it.id) ?? 0) - it.quantity;
        if (left > 0) setQty.run(from, it.kind, it.id, left);
        else del.run(from, it.kind, it.id);
        setQty.run(to, it.kind, it.id, (quantity.get(to, it.kind, it.id) ?? 0) + it.quantity);
      };
      for (const it of a.items) move(aId, bId, it);
      for (const it of b.items) move(bId, aId, it);
      setGold.run((gold.get(aId) ?? 0) - a.gold + b.gold, aId);
      setGold.run((gold.get(bId) ?? 0) - b.gold + a.gold, bId);
      this.db
        .prepare('INSERT INTO trade_log (a_id, b_id, a_items, b_items, a_gold, b_gold) VALUES (?, ?, ?, ?, ?, ?)')
        .run(aId, bId, JSON.stringify(a.items), JSON.stringify(b.items), a.gold, b.gold);
      return null;
    });
    return run.immediate();
  }

  /** Trades of a character, most recent first. */
  tradeLog(characterId: number, limit = 100): TradeLogEntry[] {
    type Row = { id: number; a_id: number; b_id: number; a_items: string; b_items: string; a_gold: number; b_gold: number; created_at: string };
    return this.db
      .prepare<[number, number, number], Row>('SELECT * FROM trade_log WHERE a_id = ? OR b_id = ? ORDER BY id DESC LIMIT ?')
      .all(characterId, characterId, limit)
      .map((r) => ({ id: r.id, aId: r.a_id, bId: r.b_id, aItems: JSON.parse(r.a_items), bItems: JSON.parse(r.b_items), aGold: r.a_gold, bGold: r.b_gold, createdAt: r.created_at }));
  }
}
