/**
 * @file Inventory rules: giving and taking items, gold, and using items.
 *
 * Using an item is decided entirely by the server: it checks that the item
 * exists in the database, is owned, can be used now, then applies its effects
 * to the character's vitals and consumes it. The client only asks.
 */
import type { Effect } from '../../shared/database.js';
import type { InventoryEntry, InventoryPayload } from '../../shared/protocol.js';
import type { GameDataRepository } from '../db/game-data.js';
import type { InventoryRepository, ItemKind } from '../db/inventory.js';

/** What using an item needs from the character. */
export interface Vitals {
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
}

/** Outcome of using an item. */
export type UseResult = { ok: true; hp: number; mp: number } | { ok: false; errorKey: string };

/** Inventory use-cases. */
export class InventoryService {
  /**
   * @param bagSize - Number of different entries a bag can hold (System settings).
   */
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly data: GameDataRepository,
    private readonly bagSize: () => number = () => Number.MAX_SAFE_INTEGER,
  ) {}

  /** Tells whether a new kind of entry still fits in the bag. */
  hasRoomFor(characterId: number, kind: ItemKind, id: number): boolean {
    return this.inventory.quantity(characterId, kind, id) > 0 || this.inventory.entryCount(characterId) < this.bagSize();
  }

  /** Maximum quantity of an entry a character may hold. */
  maxOf(kind: ItemKind, id: number): number {
    if (kind === 'item') return this.data.get('item', id)?.maxStack ?? 0;
    return (kind === 'weapon' ? this.data.get('weapon', id) : this.data.get('armor', id)) ? 99 : 0;
  }

  /**
   * Inventory as sent to the client, with names and icons from the database.
   * Entries whose definition was deleted are left out.
   */
  payload(characterId: number): InventoryPayload {
    const entries: InventoryEntry[] = [];
    for (const row of this.inventory.list(characterId)) {
      if (row.kind === 'item') {
        const item = this.data.get('item', row.id);
        if (!item) continue;
        entries.push({
          kind: 'item', id: row.id, quantity: row.quantity, name: item.name, description: item.description, icon: item.icon,
          category: item.kind, usable: item.kind === 'regular' && (item.occasion === 'always' || item.occasion === 'menu') && item.effects.length > 0,
          price: item.kind === 'regular' ? item.price : 0,
        });
      } else {
        const def = row.kind === 'weapon' ? this.data.get('weapon', row.id) : this.data.get('armor', row.id);
        if (!def) continue;
        entries.push({
          kind: row.kind, id: row.id, quantity: row.quantity, name: def.name, description: def.description, icon: def.icon,
          category: 'slot' in def ? def.slot : 'weapon', usable: false,
          price: def.price, slot: 'slot' in def ? def.slot : 'weapon', params: def.params, equipType: 'slot' in def ? def.armorType : def.weaponType,
        });
      }
    }
    return { gold: this.inventory.gold(characterId), entries };
  }

  /**
   * Gives (positive) or takes (negative) items.
   * @returns The quantity actually added or removed (signed).
   */
  change(characterId: number, kind: ItemKind, id: number, delta: number): number {
    if (delta > 0) return this.hasRoomFor(characterId, kind, id) ? this.inventory.add(characterId, kind, id, delta, this.maxOf(kind, id)) : 0;
    if (delta < 0) return -this.inventory.remove(characterId, kind, id, -delta, true);
    return 0;
  }

  /** Changes gold; returns the new amount. */
  changeGold(characterId: number, delta: number): number {
    return this.inventory.changeGold(characterId, delta);
  }

  /**
   * Uses one item from the bag.
   * @param characterId - Owner.
   * @param itemId - Item to use.
   * @param v - Current vitals (not modified; new values are returned).
   */
  use(characterId: number, itemId: number, v: Vitals): UseResult {
    const item = this.data.get('item', itemId);
    if (!item) return { ok: false, errorKey: 'error.item.unknown' };
    if (item.kind !== 'regular' || (item.occasion !== 'always' && item.occasion !== 'menu') || item.effects.length === 0) {
      return { ok: false, errorKey: 'error.item.not_usable' };
    }
    if (this.inventory.quantity(characterId, 'item', itemId) < 1) return { ok: false, errorKey: 'error.item.not_owned' };
    const { maxHp, maxMp } = v;
    // Values above the maximum (after a class change...) count as full.
    const startHp = Math.min(v.hp, maxHp);
    const startMp = Math.min(v.mp, maxMp);
    let hp = startHp;
    let mp = startMp;
    const amount = (e: Effect, max: number) => e.value + Math.floor((max * e.percent) / 100);
    for (const e of item.effects) {
      if (e.kind === 'recover_hp') hp = Math.min(maxHp, hp + amount(e, maxHp));
      else if (e.kind === 'recover_mp') mp = Math.min(maxMp, mp + amount(e, maxMp));
    }
    const nothingToDo = hp === startHp && mp === startMp && item.effects.every((e) => e.kind === 'recover_hp' || e.kind === 'recover_mp');
    if (nothingToDo) return { ok: false, errorKey: 'error.item.no_effect' };
    if (item.consumable && this.inventory.remove(characterId, 'item', itemId, 1) !== 1) return { ok: false, errorKey: 'error.item.not_owned' };
    return { ok: true, hp, mp };
  }
}
