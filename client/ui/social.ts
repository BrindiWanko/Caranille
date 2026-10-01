/**
 * @file Friends window (online status, location, private message, removal,
 * ignored players), trade window (two columns, offer from the bag and gold,
 * lock then confirm on both sides) and the small windows answering a trade
 * request or offering actions on a player clicked in the world, and the
 * window showing an inspected player.
 */
import { drawCharacterFrame } from '../../shared/art/character.js';
import type { FriendsPayload, InspectPayload, TradeView } from '../../shared/social.js';
import type { InventoryPayload } from '../../shared/protocol.js';
import { rasterize } from '../art/render.js';
import { t, tDynamic } from '../i18n.js';
import { el, icon } from './dom.js';
import { GameWindow, type ListItem } from './windows.js';

/** Friends window actions. */
export interface FriendsHost {
  whisper(name: string): void;
  addFriend(name: string): void;
  removeFriend(id: number): void;
  unignore(id: number): void;
}

/** The friends window. */
export class FriendsWindow extends GameWindow {
  private data: FriendsPayload = { friends: [], ignored: [] };

  constructor(private readonly host: FriendsHost) {
    super('friends', t('friends.title'), { className: 'friends-window' });
  }

  set(data: FriendsPayload): void {
    this.data = data;
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.setTitle(t('friends.title'));
    this.render();
  }

  private render(): void {
    const input = el('input', { attrs: { type: 'text', maxlength: '40', placeholder: t('friends.name'), 'aria-label': t('friends.name') } });
    const add = el('button', { className: 'button small', text: t('friends.add'), attrs: { type: 'button' }, on: { click: () => input.value.trim() && this.host.addFriend(input.value.trim()) } });
    const friends = [...this.data.friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    const rows = friends.map((f) =>
      el('div', { className: `friend-row${f.online ? ' online' : ''}` }, [
        el('span', { className: 'friend-dot', title: f.online ? t('friends.online') : t('friends.offline') }),
        el('span', { className: 'friend-name', text: `${f.name} (${t('hud.level', { level: f.level })})` }),
        el('span', { className: 'friend-location', text: f.online ? f.location : t('friends.offline') }),
        f.online ? el('button', { className: 'button small', text: '✉', title: t('chat.menu.whisper'), attrs: { type: 'button' }, on: { click: () => this.host.whisper(f.name) } }) : el('span'),
        el('button', { className: 'button small danger', text: '✕', title: t('friends.remove'), attrs: { type: 'button' }, on: { click: () => this.host.removeFriend(f.id) } }),
      ]),
    );
    const ignored = this.data.ignored.map((i) =>
      el('div', { className: 'friend-row' }, [
        el('span', { className: 'friend-name', text: i.name }),
        el('button', { className: 'button small', text: t('friends.unignore'), attrs: { type: 'button' }, on: { click: () => this.host.unignore(i.id) } }),
      ]),
    );
    this.body.replaceChildren(
      el('div', { className: 'friend-add' }, [input, add]),
      el('div', { className: 'friend-list' }, rows.length ? rows : [el('p', { className: 'bag-empty', text: t('friends.none') })]),
      ...(ignored.length ? [el('h4', { text: t('friends.ignored') }), el('div', { className: 'friend-list' }, ignored)] : []),
    );
  }
}

/** Trade window actions. */
export interface TradeHost {
  inventory(): InventoryPayload;
  currencyName(): string;
  offer(items: { kind: 'item' | 'weapon' | 'armor'; id: number; quantity: number }[], gold: number): void;
  lock(): void;
  confirm(): void;
  cancel(): void;
}

/** The trade window. */
export class TradeWindow extends GameWindow {
  private view: TradeView | null = null;
  /** Closed by the server: do not send a cancel back. */
  private closing = false;

  constructor(private readonly host: TradeHost) {
    super('trade', t('trade.title'), { className: 'trade-window' });
  }

  /** New state (null: the trade ended). */
  set(view: TradeView | null): void {
    this.view = view;
    if (!view) {
      this.closing = true;
      this.close();
      this.closing = false;
      return;
    }
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.render();
  }

  override onClose(): void {
    if (!this.closing && this.view) this.host.cancel();
  }

  private side(title: string, side: TradeView['mine'], editable: boolean): HTMLElement {
    const currency = this.host.currencyName();
    const status = side.confirmed ? t('trade.confirmed') : side.locked ? t('trade.locked') : t('trade.open');
    const rows = side.items.map((it, i) =>
      el('div', { className: 'trade-row' }, [
        icon(it.icon),
        el('span', { className: 'bank-name', text: `${it.name} ×${it.quantity}` }),
        editable && !side.locked
          ? el('button', { className: 'button small danger', text: '✕', attrs: { type: 'button' }, on: { click: () => this.sendOffer(side.items.filter((_, j) => j !== i), side.gold) } })
          : el('span'),
      ]),
    );
    return el('section', { className: `trade-side${side.locked ? ' locked' : ''}${side.confirmed ? ' confirmed' : ''}` }, [
      el('h4', { text: `${title} — ${status}` }),
      ...(rows.length ? rows : [el('p', { className: 'bag-empty', text: t('trade.nothing') })]),
      el('div', { className: 'trade-gold' }, [icon('gold'), el('span', { text: `${side.gold} ${currency}` })]),
    ]);
  }

  private sendOffer(items: TradeView['mine']['items'], gold: number): void {
    this.host.offer(items.map((i) => ({ kind: i.kind, id: i.id, quantity: i.quantity })), gold);
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    this.setTitle(t('trade.with', { name: v.partner.name }));
    const inventory = this.host.inventory();
    const controls: HTMLElement[] = [];
    if (!v.mine.locked) {
      const choice = el('select', { attrs: { 'aria-label': t('trade.add') } }, inventory.entries.filter((e) => e.kind !== 'item' || e.category === 'regular').map((e) => el('option', { text: `${e.name} ×${e.quantity}`, attrs: { value: `${e.kind}:${e.id}` } })));
      const qty = el('input', { className: 'qty-input', attrs: { type: 'number', min: '1', step: '1' } });
      qty.value = '1';
      const add = el('button', {
        className: 'button small',
        text: t('trade.add'),
        attrs: { type: 'button' },
        on: {
          click: () => {
            const [kind, id] = choice.value.split(':') as ['item' | 'weapon' | 'armor', string];
            if (!kind) return;
            const quantity = Math.max(1, Math.trunc(Number(qty.value)) || 1);
            const others = v.mine.items.filter((i) => !(i.kind === kind && i.id === Number(id)));
            this.host.offer([...others.map((i) => ({ kind: i.kind, id: i.id, quantity: i.quantity })), { kind, id: Number(id), quantity }], v.mine.gold);
          },
        },
      });
      const gold = el('input', { className: 'qty-input', attrs: { type: 'number', min: '0', step: '1', 'aria-label': t('trade.gold') } });
      gold.value = String(v.mine.gold);
      const setGold = el('button', { className: 'button small', text: t('trade.set_gold'), attrs: { type: 'button' }, on: { click: () => this.sendOffer(v.mine.items, Math.max(0, Math.trunc(Number(gold.value)) || 0)) } });
      controls.push(el('div', { className: 'trade-controls' }, [choice, qty, add]), el('div', { className: 'trade-controls' }, [gold, setGold]));
    }
    const lock = el('button', { className: 'button', text: t('trade.lock'), attrs: { type: 'button', ...(v.mine.locked ? { disabled: '' } : {}) }, on: { click: () => this.host.lock() } });
    const confirm = el('button', { className: 'button primary', text: t('trade.confirm'), attrs: { type: 'button', ...(v.mine.locked && v.theirs.locked && !v.mine.confirmed ? {} : { disabled: '' }) }, on: { click: () => this.host.confirm() } });
    const cancel = el('button', { className: 'button danger', text: t('common.cancel'), attrs: { type: 'button' }, on: { click: () => this.close() } });
    this.body.replaceChildren(
      el('div', { className: 'trade-layout' }, [this.side(t('trade.you'), v.mine, true), this.side(v.partner.name, v.theirs, false)]),
      ...controls,
      el('p', { className: 'hint', text: t('trade.help') }),
      el('div', { className: 'trade-buttons' }, [lock, confirm, cancel]),
    );
  }
}

/** A question with a few answers (trade request, actions on a player). */
export class ChoiceWindow extends GameWindow {
  private choices: ListItem[] = [];
  private text = '';

  constructor(id: string) {
    super(id, '', { className: 'choice-window' });
  }

  /** Sets the question and its answers (then open the window). */
  ask(title: string, text: string, items: ListItem[]): void {
    this.setTitle(title);
    this.text = text;
    this.choices = items.map((i) => ({ ...i, onSelect: () => (this.close(), i.onSelect?.()) }));
  }

  override onOpen(): void {
    const list = el('div');
    this.body.replaceChildren(...(this.text ? [el('p', { text: this.text })] : []), list);
    this.setList(this.choices, list);
  }
}

/** Another player's level, class, guild and equipment. */
export class InspectWindow extends GameWindow {
  private data: InspectPayload | null = null;

  constructor() {
    super('inspect', t('inspect.title'), { className: 'inspect-window' });
  }

  /** Shows a player (opening is left to the caller). */
  set(data: InspectPayload): void {
    this.data = data;
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.render();
  }

  private render(): void {
    const d = this.data;
    this.setTitle(d ? `${t('inspect.title')} — ${d.name}` : t('inspect.title'));
    if (!d) return;
    const sprite = rasterize(drawCharacterFrame(d.appearance, 'down', 1), 3);
    sprite.className = 'inspect-sprite';
    this.body.replaceChildren(
      el('div', { className: 'inspect-head' }, [
        sprite,
        el('div', {}, [
          el('strong', { text: d.name }),
          el('div', { text: t('inspect.level_class', { level: d.level, className: d.className }) }),
          el('div', { className: 'hint', text: d.guildTag ? `<${d.guildTag}>` : t('inspect.no_guild') }),
        ]),
      ]),
      d.equipment.length
        ? el('ul', { className: 'inspect-equipment' }, d.equipment.map((e) => el('li', {}, [icon(e.icon), el('span', { className: 'hint', text: `${tDynamic(`equip.slot.${e.slot}`)} : ` }), el('span', { text: e.name })])))
        : el('p', { className: 'bag-empty', text: t('inspect.no_equipment') }),
    );
  }
}
