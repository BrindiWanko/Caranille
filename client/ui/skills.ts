/**
 * @file Skills window (K): the skills the character knows and the items it
 * can use, each of which can be placed on a hotbar slot (keys 1 to 8, or the
 * skill buttons around the Action button on touch screens): pick a slot from
 * the list, or drag the entry onto the bar. Using a skill
 * only sends a request; the server checks cost, cooldown and targets.
 */
import { HOTBAR_SIZE, type HotbarSlot, type SkillsPayload } from '../../shared/combat.js';
import type { InventoryPayload } from '../../shared/protocol.js';
import { t } from '../i18n.js';
import { el, icon } from './dom.js';
import { makeHotbarDraggable } from './hud.js';
import { GameWindow, type ListItem } from './windows.js';

/** What the window needs from the game. */
export interface SkillsHost {
  skills(): SkillsPayload;
  inventory(): InventoryPayload;
  /** Saves a new hotbar. */
  setHotbar(slots: HotbarSlot[]): void;
  /** Uses a skill now. */
  useSkill(id: number): void;
}

/** The skills window. */
export class SkillsWindow extends GameWindow {
  /** Entry waiting for a slot, or null while browsing the list. */
  private placing: { slot: HotbarSlot & object; label: string } | null = null;

  constructor(private readonly host: SkillsHost) {
    super('skills', t('skills.title'), { className: 'skills-window' });
  }

  override onOpen(): void {
    this.setTitle(t('skills.title'));
    this.placing = null;
    this.render();
  }

  /** Refreshes the window if it is open (new skill, inventory change). */
  refresh(): void {
    if (this.manager?.isOpen(this) && !this.placing) this.render();
  }

  override handleInput(input: Parameters<GameWindow['handleInput']>[0]): boolean {
    if (this.placing && input.consume('cancel')) {
      this.placing = null;
      this.render();
      return true;
    }
    return super.handleInput(input);
  }

  private render(): void {
    const { skills, hotbar } = this.host.skills();
    const slotOf = (kind: 'skill' | 'item', id: number) => hotbar.findIndex((s) => s?.kind === kind && s.id === id);
    const items: ListItem[] = skills.map((s) => {
      const slot = slotOf('skill', s.id);
      return {
        label: s.name,
        icon: s.icon,
        suffix: `${s.mpCost > 0 ? `${t('skills.mp', { mp: s.mpCost })} · ` : ''}${s.cooldown > 0 ? t('skills.cooldown', { seconds: s.cooldown }) : ''}${slot >= 0 ? ` [${slot + 1}]` : ''}`,
        description: s.description || ' ',
        onSelect: () => this.startPlacing({ kind: 'skill', id: s.id }, s.name),
      };
    });
    const usable = this.host.inventory().entries.filter((e) => e.kind === 'item' && e.usable);
    for (const e of usable) {
      const slot = slotOf('item', e.id);
      items.push({ label: e.name, icon: e.icon, suffix: `×${e.quantity}${slot >= 0 ? ` [${slot + 1}]` : ''}`, description: e.description || ' ', onSelect: () => this.startPlacing({ kind: 'item', id: e.id }, e.name) });
    }
    if (items.length === 0) {
      this.body.replaceChildren(el('p', { className: 'bag-empty', text: t('skills.none') }));
      return;
    }
    this.setList(items, this.body, true);
    const slots: (HotbarSlot & object)[] = [...skills.map((s) => ({ kind: 'skill' as const, id: s.id })), ...usable.map((e) => ({ kind: 'item' as const, id: e.id }))];
    this.body.querySelectorAll<HTMLElement>('.command-list > li').forEach((node, i) => slots[i] && makeHotbarDraggable(node, slots[i]));
    this.body.prepend(el('p', { className: 'hint skills-hint', text: t('skills.help') }));
  }

  /** Shows the slot picker for an entry. */
  private startPlacing(slot: HotbarSlot & object, label: string): void {
    this.placing = { slot, label };
    const hotbar = this.host.skills().hotbar;
    const names = (s: HotbarSlot) => {
      if (!s) return t('skills.empty_slot');
      if (s.kind === 'skill') return this.host.skills().skills.find((k) => k.id === s.id)?.name ?? '?';
      return this.host.inventory().entries.find((e) => e.kind === 'item' && e.id === s.id)?.name ?? '?';
    };
    const place = (index: number | null) => {
      const next = hotbar.map((s) => (s?.kind === slot.kind && s.id === slot.id ? null : s));
      if (index !== null) next[index] = slot;
      this.host.setHotbar(next);
      this.placing = null;
      this.render();
    };
    const items: ListItem[] = Array.from({ length: HOTBAR_SIZE }, (_, i) => ({ label: `${i + 1} — ${names(hotbar[i] ?? null)}`, onSelect: () => place(i) }));
    items.push({ label: t('skills.remove'), icon: 'close', onSelect: () => place(null) });
    this.setList(items, this.body);
    this.body.prepend(el('div', { className: 'skills-placing' }, [icon(slot.kind === 'skill' ? 'skills' : 'bag'), el('strong', { text: t('skills.choose_slot', { name: label }) })]));
  }
}
