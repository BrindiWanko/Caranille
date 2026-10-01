/**
 * @file Shop and bank windows, opened by events on the server.
 *
 * - Shop: Buy / Sell tabs, the articles with their price, the details of the
 *   highlighted article (with the comparison against the equipped item for
 *   equipment), a quantity and the gold left.
 * - Bank: the bag and the bank side by side; an entry moves to the other side
 *   with the chosen quantity; gold can be deposited or withdrawn.
 *
 * Closing the window tells the server (the event that opened it goes on).
 * Every action is a request checked by the server in one transaction.
 */
import type { BankPayload, SheetPayload, ShopGood, ShopPayload } from '../../shared/character.js';
import { PARAMS } from '../../shared/database.js';
import type { InventoryEntry, InventoryPayload } from '../../shared/protocol.js';
import { t } from '../i18n.js';
import { el, icon } from './dom.js';
import { GameWindow, type ListItem } from './windows.js';

/** What the windows need from the game. */
export interface CommerceHost {
  inventory(): InventoryPayload;
  sheet(): SheetPayload | null;
  currencyName(): string;
  paramName(param: string): string;
  buy(index: number, quantity: number): void;
  sell(entry: InventoryEntry, quantity: number): void;
  bankMove(entry: { kind: 'item' | 'weapon' | 'armor'; id: number }, quantity: number, toBank: boolean): void;
  bankGold(amount: number): void;
}

/** Quantity input 1..max. */
function quantityInput(max: number): HTMLInputElement {
  const input = el('input', { className: 'qty-input', attrs: { type: 'number', min: '1', max: String(Math.max(1, max)), step: '1' } });
  input.value = '1';
  return input;
}
const readQty = (input: HTMLInputElement, max: number) => Math.max(1, Math.min(max, Math.trunc(Number(input.value)) || 1));

/** A shop. */
export class ShopWindow extends GameWindow {
  private payload: ShopPayload = { goods: [], purchaseOnly: true, sellRate: 50 };
  private tab: 'buy' | 'sell' = 'buy';
  private onDone: (() => void) | null = null;
  private readonly tabs = el('div', { className: 'bag-tabs' });
  private readonly listArea = el('div', { className: 'shop-list' });
  private readonly details = el('div', { className: 'shop-details' });
  private readonly goldEl = el('div', { className: 'bag-gold' });

  constructor(private readonly host: CommerceHost) {
    super('shop', t('shop.title'), { className: 'shop-window' });
    this.body.append(this.tabs, el('div', { className: 'shop-layout' }, [this.listArea, this.details]), this.goldEl);
  }

  /** Shows a shop; `done` is called when the player closes it. */
  show(payload: ShopPayload, done: () => void): void {
    this.payload = payload;
    this.tab = 'buy';
    this.onDone = done;
  }

  /** Inventory or gold changed. */
  refresh(): void {
    if (this.manager?.isOpen(this)) this.render(true);
  }

  override onOpen(): void {
    this.setTitle(t('shop.title'));
    this.render(false);
  }

  override onClose(): void {
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  override handleInput(input: Parameters<GameWindow['handleInput']>[0]): boolean {
    if (!this.payload.purchaseOnly && (input.consume('left') || input.consume('right'))) {
      this.tab = this.tab === 'buy' ? 'sell' : 'buy';
      this.render(false);
      return true;
    }
    return super.handleInput(input);
  }

  private render(keep: boolean): void {
    const tabs: ('buy' | 'sell')[] = this.payload.purchaseOnly ? ['buy'] : ['buy', 'sell'];
    this.tabs.replaceChildren(
      ...tabs.map((tab) =>
        el('button', {
          className: `bag-tab${tab === this.tab ? ' active' : ''}`,
          text: t(tab === 'buy' ? 'shop.buy' : 'shop.sell'),
          attrs: { type: 'button' },
          on: {
            click: () => {
              this.tab = tab;
              this.render(false);
            },
          },
        }),
      ),
    );
    const inventory = this.host.inventory();
    const currency = this.host.currencyName();
    this.goldEl.replaceChildren(icon('gold'), el('span', { text: `${inventory.gold} ${currency}` }));
    const owned = (kind: string, id: number) => inventory.entries.find((e) => e.kind === kind && e.id === id)?.quantity ?? 0;
    let items: ListItem[];
    if (this.tab === 'buy') {
      items = this.payload.goods.map((g, i) => ({
        label: g.name,
        icon: g.icon,
        suffix: `${g.price} ${currency}`,
        enabled: g.price <= inventory.gold,
        onFocus: () => this.showGood(g, i, owned(g.kind, g.id)),
        onSelect: () => this.showGood(g, i, owned(g.kind, g.id), true),
      }));
    } else {
      items = inventory.entries
        .filter((e) => e.price > 0)
        .map((e) => {
          const price = Math.floor((e.price * this.payload.sellRate) / 100);
          return { label: e.name, icon: e.icon, suffix: `×${e.quantity} · ${price} ${currency}`, onFocus: () => this.showSale(e, price), onSelect: () => this.showSale(e, price, true) };
        });
    }
    if (items.length === 0) {
      this.listArea.replaceChildren(el('p', { className: 'bag-empty', text: t(this.tab === 'buy' ? 'shop.nothing' : 'shop.nothing_to_sell') }));
      this.details.replaceChildren();
      return;
    }
    this.setList(items, this.listArea, keep);
  }

  /** Details of an article, with the comparison for equipment. */
  private showGood(g: ShopGood, index: number, owned: number, focus = false): void {
    const currency = this.host.currencyName();
    const rows: HTMLElement[] = [el('div', { className: 'bag-details-title' }, [icon(g.icon), el('strong', { text: g.name })]), el('p', { text: g.description })];
    rows.push(el('p', { className: 'hint', text: t('shop.owned', { count: owned }) }));
    if (g.params && g.slot) {
      const worn = this.host.sheet()?.equipment[g.slot];
      const lines = PARAMS.filter((p) => g.params![p] !== 0 || (worn?.params[p] ?? 0) !== 0).map((p) => {
        const delta = g.params![p] - (worn?.params[p] ?? 0);
        return el('div', { className: 'equip-param' }, [el('span', { text: this.host.paramName(p) }), el('strong', { text: String(g.params![p]) }), delta ? el('span', { className: delta > 0 ? 'better' : 'worse', text: `${delta > 0 ? '+' : ''}${delta}` }) : el('span')]);
      });
      rows.push(el('div', { className: 'hint', text: worn ? t('shop.compared_to', { name: worn.name }) : t('shop.nothing_worn') }), el('div', { className: 'equip-params' }, lines));
    }
    const max = Math.max(1, Math.min(99, Math.floor(this.host.inventory().gold / Math.max(1, g.price))));
    const qty = quantityInput(max);
    const total = el('span', { className: 'shop-total', text: `${g.price} ${currency}` });
    qty.addEventListener('input', () => (total.textContent = `${g.price * readQty(qty, max)} ${currency}`));
    const buy = el('button', { className: 'button primary', text: t('shop.buy'), attrs: { type: 'button' }, on: { click: () => this.host.buy(index, readQty(qty, max)) } });
    rows.push(el('div', { className: 'shop-action' }, [qty, total, buy]));
    this.details.replaceChildren(...rows);
    if (focus) buy.focus();
  }

  /** Details of an owned entry to sell. */
  private showSale(e: InventoryEntry, price: number, focus = false): void {
    const currency = this.host.currencyName();
    const qty = quantityInput(Math.min(99, e.quantity));
    const total = el('span', { className: 'shop-total', text: `${price} ${currency}` });
    qty.addEventListener('input', () => (total.textContent = `${price * readQty(qty, Math.min(99, e.quantity))} ${currency}`));
    const sell = el('button', { className: 'button primary', text: t('shop.sell'), attrs: { type: 'button' }, on: { click: () => this.host.sell(e, readQty(qty, Math.min(99, e.quantity))) } });
    this.details.replaceChildren(
      el('div', { className: 'bag-details-title' }, [icon(e.icon), el('strong', { text: e.name }), el('span', { text: `×${e.quantity}` })]),
      el('p', { text: e.description }),
      el('div', { className: 'shop-action' }, [qty, total, sell]),
    );
    if (focus) sell.focus();
  }
}

/** The personal bank. */
export class BankWindow extends GameWindow {
  private bank: BankPayload = { gold: 0, entries: [] };
  private onDone: (() => void) | null = null;

  constructor(private readonly host: CommerceHost) {
    super('bank', t('bank.title'), { className: 'bank-window' });
  }

  /** Shows the bank; `done` is called when the player closes it. */
  show(bank: BankPayload, done: () => void): void {
    this.bank = bank;
    this.onDone = done;
  }

  /** New bank contents or inventory. */
  update(bank?: BankPayload): void {
    if (bank) this.bank = bank;
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.setTitle(t('bank.title'));
    this.render();
  }

  override onClose(): void {
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  private column(title: string, entries: { kind: 'item' | 'weapon' | 'armor'; id: number; quantity: number; name: string; icon: number }[], toBank: boolean): HTMLElement {
    const rows = entries.map((e) => {
      const qty = quantityInput(e.quantity);
      qty.value = String(e.quantity);
      return el('div', { className: 'bank-row' }, [
        icon(e.icon),
        el('span', { className: 'bank-name', text: `${e.name} ×${e.quantity}` }),
        qty,
        el('button', { className: 'button small', text: toBank ? '→' : '←', title: t(toBank ? 'bank.deposit' : 'bank.withdraw'), attrs: { type: 'button' }, on: { click: () => this.host.bankMove(e, readQty(qty, e.quantity), toBank) } }),
      ]);
    });
    return el('section', { className: 'bank-column' }, [el('h4', { text: title }), ...(rows.length ? rows : [el('p', { className: 'bag-empty', text: t('bank.empty') })])]);
  }

  private render(): void {
    const inventory = this.host.inventory();
    const currency = this.host.currencyName();
    const amount = el('input', { className: 'qty-input', attrs: { type: 'number', min: '1', step: '1' } });
    amount.value = '10';
    const read = () => Math.max(0, Math.trunc(Number(amount.value)) || 0);
    this.body.replaceChildren(
      el('div', { className: 'bank-layout' }, [this.column(t('bank.bag'), inventory.entries, true), this.column(t('bank.vault'), this.bank.entries, false)]),
      el('div', { className: 'bank-gold' }, [
        el('span', {}, [icon('gold'), el('span', { text: `${t('bank.purse')} ${inventory.gold} ${currency}` })]),
        amount,
        el('button', { className: 'button small', text: t('bank.deposit'), attrs: { type: 'button' }, on: { click: () => read() > 0 && this.host.bankGold(read()) } }),
        el('button', { className: 'button small', text: t('bank.withdraw'), attrs: { type: 'button' }, on: { click: () => read() > 0 && this.host.bankGold(-read()) } }),
        el('span', {}, [icon('gold'), el('span', { text: `${t('bank.vault')} ${this.bank.gold} ${currency}` })]),
      ]),
    );
  }
}
