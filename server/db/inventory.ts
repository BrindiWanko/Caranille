/**
 * @file Repository of character inventories and gold.
 *
 * Every change runs inside a transaction and checks quantities in SQL, so an
 * item can never be spent twice or go negative, even with concurrent
 * requests; later features (trades, shops, loot, guild banks) build on these
 * primitives.
 */
import type { Statement } from 'better-sqlite3';
import type { Db } from './database.js';

/** Kinds of inventory entries. */
export type ItemKind = 'item' | 'weapon' | 'armor';

/** One inventory row. */
export interface InventoryRow {
  kind: ItemKind;
  id: number;
  quantity: number;
}

/** Largest amount of gold a character can hold. */
export const MAX_GOLD = 999_999_999;

/** Data access for inventories. */
export class InventoryRepository {
  private readonly listStmt: Statement<[number], { item_kind: ItemKind; item_id: number; quantity: number }>;
  private readonly quantityStmt: Statement<[number, string, number], number>;
  private readonly upsertStmt: Statement<[number, string, number, number]>;
  private readonly setStmt: Statement<[number, number, string, number]>;
  private readonly deleteStmt: Statement<[number, string, number]>;
  private readonly goldStmt: Statement<[number], number>;
  private readonly setGoldStmt: Statement<[number, number]>;

  constructor(private readonly db: Db) {
    this.listStmt = db.prepare('SELECT item_kind, item_id, quantity FROM character_items WHERE character_id = ? ORDER BY item_kind, item_id');
    this.quantityStmt = db.prepare<[number, string, number], number>(
      'SELECT quantity FROM character_items WHERE character_id = ? AND item_kind = ? AND item_id = ?',
    ).pluck();
    this.upsertStmt = db.prepare(`INSERT INTO character_items (character_id, item_kind, item_id, quantity) VALUES (?, ?, ?, ?)
      ON CONFLICT(character_id, item_kind, item_id) DO UPDATE SET quantity = excluded.quantity`);
    this.setStmt = db.prepare('UPDATE character_items SET quantity = ? WHERE character_id = ? AND item_kind = ? AND item_id = ?');
    this.deleteStmt = db.prepare('DELETE FROM character_items WHERE character_id = ? AND item_kind = ? AND item_id = ?');
    this.goldStmt = db.prepare<[number], number>('SELECT gold FROM characters WHERE id = ?').pluck();
    this.setGoldStmt = db.prepare('UPDATE characters SET gold = ? WHERE id = ?');
  }

  /** Everything a character owns. */
  list(characterId: number): InventoryRow[] {
    return this.listStmt.all(characterId).map((r) => ({ kind: r.item_kind, id: r.item_id, quantity: r.quantity }));
  }

  /** Quantity owned of one entry. */
  quantity(characterId: number, kind: ItemKind, id: number): number {
    return this.quantityStmt.get(characterId, kind, id) ?? 0;
  }

  /**
   * Adds items, up to a maximum held quantity.
   * @returns The quantity actually added.
   */
  add(characterId: number, kind: ItemKind, id: number, amount: number, max: number): number {
    return this.db.transaction(() => {
      const current = this.quantity(characterId, kind, id);
      const next = Math.min(max, current + Math.max(0, amount));
      if (next > current) this.upsertStmt.run(characterId, kind, id, next);
      return next - current;
    })();
  }

  /**
   * Removes items.
   * @param partial - When `true`, removes as many as possible; otherwise nothing is removed if not enough are owned.
   * @returns The quantity actually removed.
   */
  remove(characterId: number, kind: ItemKind, id: number, amount: number, partial = false): number {
    return this.db.transaction(() => {
      const current = this.quantity(characterId, kind, id);
      if (!partial && current < amount) return 0;
      const removed = Math.min(current, Math.max(0, amount));
      if (removed === 0) return 0;
      if (current - removed === 0) this.deleteStmt.run(characterId, kind, id);
      else this.setStmt.run(current - removed, characterId, kind, id);
      return removed;
    })();
  }

  /** Number of different entries a character holds (bag slots used). */
  entryCount(characterId: number): number {
    return this.db.prepare<[number], number>('SELECT COUNT(*) FROM character_items WHERE character_id = ?').pluck().get(characterId) ?? 0;
  }

  /** Items kept in the personal bank. */
  bankList(characterId: number): InventoryRow[] {
    return this.db
      .prepare<[number], { item_kind: ItemKind; item_id: number; quantity: number }>('SELECT item_kind, item_id, quantity FROM character_bank WHERE character_id = ? ORDER BY item_kind, item_id')
      .all(characterId)
      .map((r) => ({ kind: r.item_kind, id: r.item_id, quantity: r.quantity }));
  }

  /** Gold kept in the personal bank. */
  bankGold(characterId: number): number {
    return this.db.prepare<[number], number>('SELECT bank_gold FROM characters WHERE id = ?').pluck().get(characterId) ?? 0;
  }

  /**
   * Moves items between the bag and the bank in one transaction.
   * @param toBank - Direction (true: bag → bank).
   * @param max - Largest quantity the destination may hold.
   * @returns The quantity moved (0 if not enough items, or the destination is full).
   */
  moveToBank(characterId: number, kind: ItemKind, id: number, amount: number, toBank: boolean, max: number): number {
    return this.db.transaction(() => {
      const bagQty = this.quantity(characterId, kind, id);
      const bankRow = this.db.prepare<[number, string, number], number>('SELECT quantity FROM character_bank WHERE character_id = ? AND item_kind = ? AND item_id = ?').pluck();
      const bankQty = bankRow.get(characterId, kind, id) ?? 0;
      const from = toBank ? bagQty : bankQty;
      const to = toBank ? bankQty : bagQty;
      const moved = Math.min(amount, from, Math.max(0, max - to));
      if (moved <= 0) return 0;
      const setBag = (q: number) => (q > 0 ? this.upsertStmt.run(characterId, kind, id, q) : this.deleteStmt.run(characterId, kind, id));
      const setBank = (q: number) =>
        q > 0
          ? this.db.prepare(`INSERT INTO character_bank (character_id, item_kind, item_id, quantity) VALUES (?, ?, ?, ?)
              ON CONFLICT(character_id, item_kind, item_id) DO UPDATE SET quantity = excluded.quantity`).run(characterId, kind, id, q)
          : this.db.prepare('DELETE FROM character_bank WHERE character_id = ? AND item_kind = ? AND item_id = ?').run(characterId, kind, id);
      setBag(toBank ? bagQty - moved : bagQty + moved);
      setBank(toBank ? bankQty + moved : bankQty - moved);
      return moved;
    })();
  }

  /**
   * Moves gold between the purse and the bank (positive = deposit) in one transaction.
   * @returns `false` when there is not enough gold on the giving side.
   */
  moveBankGold(characterId: number, amount: number): boolean {
    return this.db.transaction(() => {
      const purse = this.gold(characterId);
      const bank = this.bankGold(characterId);
      const a = Math.trunc(amount);
      if (a === 0 || (a > 0 && purse < a) || (a < 0 && bank < -a) || purse - a > MAX_GOLD || bank + a > MAX_GOLD) return false;
      this.setGoldStmt.run(purse - a, characterId);
      this.db.prepare('UPDATE characters SET bank_gold = ? WHERE id = ?').run(bank + a, characterId);
      return true;
    })();
  }

  /**
   * Buys items: pays and receives them in one transaction.
   * @returns `false` when the price cannot be paid or the items do not fit.
   */
  buy(characterId: number, kind: ItemKind, id: number, amount: number, unitPrice: number, max: number, bagSize: number): boolean {
    return this.db.transaction(() => {
      const current = this.quantity(characterId, kind, id);
      if (amount < 1 || current + amount > max) return false;
      if (current === 0 && this.entryCount(characterId) >= bagSize) return false;
      if (!this.spendGold(characterId, unitPrice * amount)) return false;
      this.upsertStmt.run(characterId, kind, id, current + amount);
      return true;
    })();
  }

  /**
   * Sells items: removes them and pays in one transaction.
   * @returns `false` when not enough items are owned.
   */
  sell(characterId: number, kind: ItemKind, id: number, amount: number, unitPrice: number): boolean {
    return this.db.transaction(() => {
      if (amount < 1 || this.remove(characterId, kind, id, amount) !== amount) return false;
      this.changeGold(characterId, unitPrice * amount);
      return true;
    })();
  }

  /** Gold of a character. */
  gold(characterId: number): number {
    return this.goldStmt.get(characterId) ?? 0;
  }

  /**
   * Changes gold, clamped between 0 and `MAX_GOLD`.
   * @returns The new amount.
   */
  changeGold(characterId: number, delta: number): number {
    return this.db.transaction(() => {
      const next = Math.min(MAX_GOLD, Math.max(0, this.gold(characterId) + Math.trunc(delta)));
      this.setGoldStmt.run(next, characterId);
      return next;
    })();
  }

  /**
   * Spends gold only if the character has enough (shops, guild creation).
   * @returns `true` when paid.
   */
  spendGold(characterId: number, amount: number): boolean {
    return this.db.transaction(() => {
      const gold = this.gold(characterId);
      if (amount < 0 || gold < amount) return false;
      this.setGoldStmt.run(gold - amount, characterId);
      return true;
    })();
  }
}
