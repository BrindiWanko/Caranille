/**
 * @file Character sheet rules: parameters shown in the status window,
 * equipment (slots, class restrictions), distribution of parameter points,
 * discarding items, and the windows opened by events: shops (buy and sell)
 * and the personal bank (items and gold).
 *
 * Every action is checked here and applied in one database transaction
 * (inventory repository), so gold and items cannot be duplicated. Shop and
 * bank actions are only accepted while the corresponding window, opened by an
 * event, is open for that player.
 */
import { freePoints, type BankPayload, type EquippedView, type SheetPayload, type ShopGood, type ShopPayload } from '../../shared/character.js';
import { EQUIP_SLOTS, PARAMS, type EquipSlot, type ParamName } from '../../shared/database.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import type { ItemKind } from '../db/inventory.js';
import { classParams } from './stats.js';
import type { PlayerSession, World } from './world.js';

/** Longest time a shop or bank window may stay open. */
const WINDOW_TIMEOUT_MS = 30 * 60_000;
/** Most items bought, sold or moved at once. */
const MAX_BATCH = 99;

/** Character sheet, equipment, shops and bank. */
export class CharacterSheet {
  constructor(private readonly world: World) {}

  private get ctx() {
    return this.world.ctx;
  }

  private setting<K extends 'statPointsPerLevel' | 'sellRate' | 'bagSize'>(key: K): number {
    return this.ctx.settings.get(key, DEFAULT_SETTINGS[key]);
  }

  // --- Sheet --------------------------------------------------------------------

  /** Everything the status and equipment windows show. */
  sheet(p: PlayerSession): SheetPayload {
    const data = this.ctx.gameData;
    const equipped = this.ctx.progression.equipment(p.characterId);
    const equipment = Object.fromEntries(
      EQUIP_SLOTS.map((slot) => {
        const e = equipped.get(slot);
        const def = e ? (e.kind === 'weapon' ? data.get('weapon', e.id) : data.get('armor', e.id)) : undefined;
        const view: EquippedView | null = e && def ? { kind: e.kind, id: e.id, name: def.name, icon: def.icon, params: def.params } : null;
        return [slot, view];
      }),
    ) as Record<EquipSlot, EquippedView | null>;
    const cls = data.get('class', p.classId);
    return {
      params: this.world.combat.stats(p).params,
      base: classParams(this.ctx, p.classId, p.level),
      allocated: p.allocated,
      freePoints: freePoints(p.level, this.setting('statPointsPerLevel'), p.allocated),
      equipment,
      weaponTypes: this.ctx.settings.get('weaponTypes', DEFAULT_SETTINGS.weaponTypes),
      armorTypes: this.ctx.settings.get('armorTypes', DEFAULT_SETTINGS.armorTypes),
      allowedWeaponTypes: cls?.weaponTypes ?? [],
      allowedArmorTypes: cls?.armorTypes ?? [],
    };
  }

  /** Sends the sheet to the player. */
  push(p: PlayerSession): void {
    if (this.world.isLive(p)) p.socket.emit('sheet', this.sheet(p));
  }

  /** Parameters changed (equipment, points, level): vitals clamped, HUD and sheet refreshed. */
  statsChanged(p: PlayerSession): void {
    this.world.combat.invalidate(p);
    const { maxHp, maxMp } = this.world.maxVitals(p);
    p.hp = Math.min(p.hp, maxHp);
    p.mp = Math.min(p.mp, maxMp);
    p.socket.emit('playerUpdate', { maxHp, maxMp, hp: p.hp, mp: p.mp });
    this.push(p);
  }

  // --- Equipment and points -------------------------------------------------------

  /**
   * Equips an item of the bag in a slot, or empties the slot (`id` 0).
   * @returns A translation key explaining a refusal, or `null`.
   */
  equip(p: PlayerSession, slot: EquipSlot, id: number): string | null {
    if (!EQUIP_SLOTS.includes(slot) || p.combat.dead) return 'error.equip.invalid';
    const data = this.ctx.gameData;
    const cls = data.get('class', p.classId);
    if (id > 0) {
      const kind = slot === 'weapon' ? 'weapon' : 'armor';
      if (kind === 'weapon') {
        const weapon = data.get('weapon', id);
        if (!weapon) return 'error.equip.invalid';
        if (cls && cls.weaponTypes.length > 0 && !cls.weaponTypes.includes(weapon.weaponType)) return 'error.equip.class';
      } else {
        const armor = data.get('armor', id);
        if (!armor || armor.slot !== slot) return 'error.equip.invalid';
        if (cls && cls.armorTypes.length > 0 && !cls.armorTypes.includes(armor.armorType)) return 'error.equip.class';
      }
      if (!this.ctx.progression.equip(p.characterId, slot, { kind, id })) return 'error.item.not_owned';
    } else {
      const current = this.ctx.progression.equipment(p.characterId).get(slot);
      if (!current) return null;
      if (!this.ctx.inventoryService.hasRoomFor(p.characterId, current.kind, current.id)) return 'error.bag.full';
      this.ctx.progression.equip(p.characterId, slot, null);
    }
    this.world.pushInventory(p);
    this.statsChanged(p);
    return null;
  }

  /** Puts one free point in a parameter. */
  allocate(p: PlayerSession, param: ParamName): void {
    if (!PARAMS.includes(param)) return;
    if (freePoints(p.level, this.setting('statPointsPerLevel'), p.allocated) < 1) return;
    p.allocated = { ...p.allocated, [param]: (p.allocated[param] ?? 0) + 1 };
    this.ctx.progression.setAllocated(p.characterId, p.allocated);
    this.statsChanged(p);
  }

  /** Throws items away (key and quest items cannot be discarded). */
  discard(p: PlayerSession, kind: ItemKind, id: number, quantity: number): void {
    if (kind === 'item' && this.ctx.gameData.get('item', id)?.kind !== 'regular') {
      p.socket.emit('notify', { key: 'error.item.cannot_discard' });
      return;
    }
    this.world.changeItems(p, kind, id, -Math.max(1, Math.min(MAX_BATCH, quantity)));
  }

  // --- Shops ----------------------------------------------------------------------------

  /** Definition, name and price of an article. */
  private good(kind: ItemKind, id: number, price: number | null): ShopGood | null {
    const data = this.ctx.gameData;
    if (kind === 'item') {
      const item = data.get('item', id);
      return item ? { kind, id, name: item.name, description: item.description, icon: item.icon, price: price ?? item.price } : null;
    }
    const def = kind === 'weapon' ? data.get('weapon', id) : data.get('armor', id);
    if (!def) return null;
    return { kind, id, name: def.name, description: def.description, icon: def.icon, price: price ?? def.price, params: def.params, slot: 'slot' in def ? def.slot : 'weapon' };
  }

  /** Base price of an owned entry (resale). */
  private basePrice(kind: ItemKind, id: number): number {
    const data = this.ctx.gameData;
    const def = kind === 'item' ? data.get('item', id) : kind === 'weapon' ? data.get('weapon', id) : data.get('armor', id);
    if (!def || (kind === 'item' && (def as { kind: string }).kind !== 'regular')) return 0;
    return def.price;
  }

  /** Opens a shop for the player and resolves when the player closes it. */
  async openShop(p: PlayerSession, goods: { kind: ItemKind; id: number; price: number | null }[], purchaseOnly: boolean): Promise<void> {
    const list = goods.map((g) => this.good(g.kind, g.id, g.price)).filter((g): g is ShopGood => g !== null);
    const payload: ShopPayload = { goods: list, purchaseOnly, sellRate: this.setting('sellRate') };
    await this.openWindow(p, { kind: 'shop', goods: list, purchaseOnly }, () => p.socket.timeout(WINDOW_TIMEOUT_MS).emitWithAck('shopOpen', payload));
  }

  /** Buys `quantity` of the article `index` of the open shop. */
  buy(p: PlayerSession, index: number, quantity: number): void {
    if (p.ui?.kind !== 'shop') return;
    const good = p.ui.goods[index];
    const qty = Math.max(1, Math.min(MAX_BATCH, Math.trunc(quantity)));
    if (!good) return;
    const inv = this.ctx.inventoryService;
    if (!this.ctx.inventory.buy(p.characterId, good.kind, good.id, qty, good.price, inv.maxOf(good.kind, good.id), this.setting('bagSize'))) {
      const key = this.ctx.inventory.gold(p.characterId) < good.price * qty ? 'error.shop.not_enough_gold' : 'error.bag.full';
      p.socket.emit('notify', { key, params: { currency: this.world.currencyName() } });
      return;
    }
    this.ctx.admin.logSale(p.characterId, 'buy', good.kind, good.id, qty, good.price * qty);
    p.socket.emit('notify', { key: 'notify.bought', params: { name: good.name, count: qty, price: good.price * qty, currency: this.world.currencyName() }, icon: good.icon });
    p.socket.emit('playerUpdate', { gold: this.ctx.inventory.gold(p.characterId) });
    this.world.pushInventory(p);
    this.world.refreshEvents(p);
  }

  /** Sells owned items to the open shop. */
  sell(p: PlayerSession, kind: ItemKind, id: number, quantity: number): void {
    if (p.ui?.kind !== 'shop' || p.ui.purchaseOnly) return;
    const price = Math.floor((this.basePrice(kind, id) * this.setting('sellRate')) / 100);
    const qty = Math.max(1, Math.min(MAX_BATCH, Math.trunc(quantity)));
    if (price <= 0) {
      p.socket.emit('notify', { key: 'error.shop.cannot_sell' });
      return;
    }
    if (!this.ctx.inventory.sell(p.characterId, kind, id, qty, price)) return;
    this.ctx.admin.logSale(p.characterId, 'sell', kind, id, qty, price * qty);
    const def = this.good(kind, id, null);
    p.socket.emit('notify', { key: 'notify.sold', params: { name: def?.name ?? '?', count: qty, price: price * qty, currency: this.world.currencyName() }, icon: def?.icon });
    p.socket.emit('playerUpdate', { gold: this.ctx.inventory.gold(p.characterId) });
    this.world.pushInventory(p);
    this.world.refreshEvents(p);
  }

  // --- Bank -------------------------------------------------------------------------------

  /** Contents of the personal bank. */
  bankPayload(p: PlayerSession): BankPayload {
    const entries = this.ctx.inventory.bankList(p.characterId).flatMap((r) => {
      const def = this.good(r.kind, r.id, null);
      return def ? [{ kind: r.kind, id: r.id, quantity: r.quantity, name: def.name, icon: def.icon, description: def.description }] : [];
    });
    return { gold: this.ctx.inventory.bankGold(p.characterId), entries };
  }

  /** Opens the bank for the player and resolves when the player closes it. */
  async openBank(p: PlayerSession): Promise<void> {
    await this.openWindow(p, { kind: 'bank' }, () => p.socket.timeout(WINDOW_TIMEOUT_MS).emitWithAck('bankOpen', this.bankPayload(p)));
  }

  /** Moves items between the bag and the bank. */
  bankMove(p: PlayerSession, kind: ItemKind, id: number, quantity: number, toBank: boolean): void {
    if (p.ui?.kind !== 'bank') return;
    const qty = Math.max(1, Math.min(9999, Math.trunc(quantity)));
    const inv = this.ctx.inventoryService;
    if (!toBank && !inv.hasRoomFor(p.characterId, kind, id)) {
      p.socket.emit('notify', { key: 'error.bag.full' });
      return;
    }
    const max = toBank ? 9999 : inv.maxOf(kind, id);
    if (this.ctx.inventory.moveToBank(p.characterId, kind, id, qty, toBank, max) === 0) return;
    this.world.pushInventory(p);
    p.socket.emit('bank', this.bankPayload(p));
    this.world.refreshEvents(p);
  }

  /** Deposits (positive) or withdraws (negative) gold. */
  bankGold(p: PlayerSession, amount: number): void {
    if (p.ui?.kind !== 'bank' || !this.ctx.inventory.moveBankGold(p.characterId, amount)) return;
    p.socket.emit('playerUpdate', { gold: this.ctx.inventory.gold(p.characterId) });
    this.world.pushInventory(p);
    p.socket.emit('bank', this.bankPayload(p));
  }

  /** Keeps a window open until the client acknowledges its closing (or disconnects). */
  private async openWindow(p: PlayerSession, ui: NonNullable<PlayerSession['ui']>, ask: () => Promise<unknown>): Promise<void> {
    if (!this.world.isLive(p)) return;
    p.ui = ui;
    let onDisconnect = () => undefined as void;
    const disconnected = new Promise<void>((resolve) => {
      onDisconnect = () => resolve();
      p.socket.once('disconnect', onDisconnect);
    });
    try {
      await Promise.race([ask().catch(() => undefined), disconnected]);
    } finally {
      p.socket.off('disconnect', onDisconnect);
      if (p.ui === ui) p.ui = null;
    }
  }
}
