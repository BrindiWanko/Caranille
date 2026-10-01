/**
 * @file Status and equipment windows.
 *
 * - Status (C): portrait, gauges, experience to the next level, the eight
 *   parameters with the part given by the equipment and the distributed
 *   points, and "+" buttons while points are left to distribute.
 * - Equipment: the five slots with the character drawn in its outfit; choosing
 *   a slot lists the items of the bag it can wear there, with the change of
 *   each parameter, and a choice to empty the slot.
 *
 * Both display the `sheet` sent by the server; actions are requests.
 */
import { drawCharacterFrame } from '../../shared/art/character.js';
import { drawFace } from '../../shared/art/face.js';
import { POINT_GAIN, type SheetPayload } from '../../shared/character.js';
import { EQUIP_SLOTS, PARAMS, type EquipSlot, type ParamName, type ParamValues } from '../../shared/database.js';
import type { InventoryEntry, InventoryPayload, PlayerCharacterInfo } from '../../shared/protocol.js';
import { rasterize } from '../art/render.js';
import { t, tDynamic } from '../i18n.js';
import { Gauge, el, icon } from './dom.js';
import { GameWindow, type ListItem } from './windows.js';

/** What the windows need from the game. */
export interface SheetHost {
  player(): PlayerCharacterInfo;
  sheet(): SheetPayload | null;
  inventory(): InventoryPayload;
  paramName(param: string): string;
  allocate(param: ParamName): void;
  equip(slot: EquipSlot, id: number): void;
}

const zero = (): ParamValues => ({ mhp: 0, mmp: 0, atk: 0, def: 0, mat: 0, mdf: 0, agi: 0, luk: 0 });

/** Character status. */
export class StatusWindow extends GameWindow {
  constructor(private readonly host: SheetHost) {
    super('status', t('menu.status'), { className: 'status-window' });
  }

  /** Refreshes the window if open. */
  refresh(): void {
    if (this.manager?.isOpen(this)) this.onOpen();
  }

  override onOpen(): void {
    this.setTitle(t('menu.status'));
    const c = this.host.player();
    const sheet = this.host.sheet();
    const face = rasterize(drawFace(c.appearance), 2);
    face.className = 'menu-face';
    const hp = new Gauge(t('hud.hp'), 'hp');
    const mp = new Gauge(t('hud.mp'), 'mp');
    const xp = new Gauge(t('hud.xp'), 'xp');
    hp.set(c.hp, c.maxHp);
    mp.set(c.mp, c.maxMp);
    const floor = c.xpFloor ?? 0;
    const next = c.xpNext ?? 0;
    if (next > floor) xp.set(c.xp - floor, next - floor, false);
    else xp.set(1, 1, false);
    const header = el('div', { className: 'character-card-menu' }, [
      face,
      el('div', { className: 'character-card-info' }, [
        el('div', { className: 'card-name', text: c.name }),
        el('div', { className: 'card-class', text: `${c.className} — ${t('hud.level', { level: c.level })}` }),
        hp.element,
        mp.element,
        xp.element,
        el('div', { className: 'status-xp', text: next > floor ? t('status.to_next', { xp: next - c.xp }) : t('status.max_level') }),
      ]),
    ]);
    const rows: HTMLElement[] = [];
    if (sheet) {
      const equipBonus = zero();
      for (const e of Object.values(sheet.equipment)) if (e) for (const p of PARAMS) equipBonus[p] += e.params[p];
      for (const p of PARAMS) {
        const points = (sheet.allocated[p] ?? 0) * POINT_GAIN[p];
        const extra = [equipBonus[p] ? t('status.from_equipment', { value: signed(equipBonus[p]) }) : '', points ? t('status.from_points', { value: signed(points) }) : ''].filter(Boolean).join(' ');
        const plus = sheet.freePoints > 0
          ? el('button', { className: 'button small status-plus', text: `+${POINT_GAIN[p]}`, title: t('status.add_point'), attrs: { type: 'button' }, on: { click: () => this.host.allocate(p) } })
          : null;
        rows.push(el('div', { className: 'status-param' }, [el('span', { className: 'status-name', text: this.host.paramName(p) }), el('strong', { text: String(sheet.params[p]) }), el('span', { className: 'status-extra', text: extra }), plus]));
      }
    }
    this.body.replaceChildren(
      header,
      sheet && sheet.freePoints > 0 ? el('p', { className: 'status-points', text: t('status.free_points', { points: sheet.freePoints }) }) : el('span'),
      el('div', { className: 'status-params' }, rows),
      el('p', { className: 'status-gold' }, [icon('gold'), el('span', { text: String(c.gold) })]),
    );
  }
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** Equipment by slot. */
export class EquipmentWindow extends GameWindow {
  private slot: EquipSlot | null = null;
  private readonly preview = el('div', { className: 'equip-preview' });
  private readonly listArea = el('div', { className: 'equip-list' });

  constructor(private readonly host: SheetHost) {
    super('equipment', t('equip.title'), { className: 'equipment-window' });
    this.body.append(el('div', { className: 'equip-layout' }, [this.listArea, this.preview]));
  }

  refresh(): void {
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.setTitle(t('equip.title'));
    this.slot = null;
    this.render();
  }

  override handleInput(input: Parameters<GameWindow['handleInput']>[0]): boolean {
    if (this.slot && input.consume('cancel')) {
      this.slot = null;
      this.render();
      return true;
    }
    return super.handleInput(input);
  }

  /** Items of the bag wearable in a slot by this class. */
  private candidates(slot: EquipSlot, sheet: SheetPayload): InventoryEntry[] {
    return this.host.inventory().entries.filter((e) => {
      if (e.slot !== slot || e.kind === 'item') return false;
      const allowed = e.kind === 'weapon' ? sheet.allowedWeaponTypes : sheet.allowedArmorTypes;
      return allowed.length === 0 || allowed.includes(e.equipType ?? 0);
    });
  }

  private render(): void {
    const sheet = this.host.sheet();
    if (!sheet) return;
    if (!this.slot) {
      const items: ListItem[] = EQUIP_SLOTS.map((slot) => {
        const e = sheet.equipment[slot];
        return {
          label: `${tDynamic(`equip.slot.${slot}`)} : ${e ? e.name : t('equip.none')}`,
          icon: e ? e.icon : slot === 'weapon' ? 'sword' : 'armor',
          onSelect: () => {
            this.slot = slot;
            this.render();
          },
          onFocus: () => this.showPreview(sheet, null),
        };
      });
      this.setList(items, this.listArea, true);
      return;
    }
    const slot = this.slot;
    const current = sheet.equipment[slot];
    const items: ListItem[] = this.candidates(slot, sheet).map((e) => ({
      label: e.name,
      icon: e.icon,
      suffix: e.quantity > 1 ? `×${e.quantity}` : '',
      onSelect: () => {
        this.host.equip(slot, e.id);
        this.slot = null;
      },
      onFocus: () => this.showPreview(sheet, diff(e.params ?? zero(), current?.params ?? zero())),
    }));
    if (current) {
      items.push({
        label: t('equip.remove'),
        icon: 'close',
        onSelect: () => {
          this.host.equip(slot, 0);
          this.slot = null;
        },
        onFocus: () => this.showPreview(sheet, diff(zero(), current.params)),
      });
    }
    if (items.length === 0) {
      this.listArea.replaceChildren(el('p', { className: 'bag-empty', text: t('equip.nothing') }));
      this.showPreview(sheet, null);
      return;
    }
    this.setList(items, this.listArea);
    this.listArea.prepend(el('div', { className: 'equip-slot-title', text: tDynamic(`equip.slot.${slot}`) }));
  }

  /** The character drawn in its outfit and its parameters (with the change of the highlighted item). */
  private showPreview(sheet: SheetPayload, change: ParamValues | null): void {
    const sprite = rasterize(drawCharacterFrame(this.host.player().appearance, 'down', 1), 3);
    sprite.className = 'equip-sprite';
    const rows = PARAMS.map((p) => {
      const delta = change?.[p] ?? 0;
      return el('div', { className: 'equip-param' }, [
        el('span', { text: this.host.paramName(p) }),
        el('strong', { text: String(sheet.params[p]) }),
        delta ? el('span', { className: delta > 0 ? 'better' : 'worse', text: `→ ${sheet.params[p] + delta}` }) : el('span'),
      ]);
    });
    this.preview.replaceChildren(sprite, el('div', { className: 'equip-params' }, rows));
  }
}

/** Parameter changes when replacing `before` with `after`. */
function diff(after: ParamValues, before: ParamValues): ParamValues {
  const out = zero();
  for (const p of PARAMS) out[p] = after[p] - before[p];
  return out;
}
