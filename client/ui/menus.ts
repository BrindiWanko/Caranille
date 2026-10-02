/**
 * @file Game menus in the classic layout: the main menu (command list on the
 * left, character sheet with portrait and gauges on the right, gold and play
 * time at the bottom), the status window, the world map, the options and the
 * administration entry point.
 */
import { drawFace } from '../../shared/art/face.js';
import type { Locale } from '../../shared/i18n.js';
import type { PlayerCharacterInfo } from '../../shared/protocol.js';
import { rasterize } from '../art/render.js';
import { getLocale, setLocale, t } from '../i18n.js';
import { Gauge, el, icon } from './dom.js';
import type { OptionsStore } from './options.js';
import { GameWindow, type ListItem } from './windows.js';

/** Actions the menus can trigger in the game. */
export interface MenuHost {
  player(): PlayerCharacterInfo;
  playTimeSeconds(): number;
  openStatus(): void;
  openEquipment(): void;
  openBag(): void;
  openQuests(): void;
  openSkills(): void;
  currency(): string;
  openOptions(): void;
  openMap(): void;
  /** Social windows and the admin window (also reached from the menu bar, hidden on phones). */
  openWindow(id: 'friends' | 'guild' | 'party' | 'admin'): void;
  isAdmin(): boolean;
  isStaff(): boolean;
  logout(): void;
  isFullscreen(): boolean;
  toggleFullscreen(): void;
}

function portrait(c: PlayerCharacterInfo): HTMLCanvasElement {
  const canvas = rasterize(drawFace(c.appearance), 2);
  canvas.className = 'menu-face';
  return canvas;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Character card used by the main menu and the status window. */
function characterCard(c: PlayerCharacterInfo): HTMLElement {
  const hp = new Gauge(t('hud.hp'), 'hp');
  const mp = new Gauge(t('hud.mp'), 'mp');
  hp.set(c.hp, c.maxHp);
  mp.set(c.mp, c.maxMp);
  return el('div', { className: 'character-card-menu' }, [
    portrait(c),
    el('div', { className: 'character-card-info' }, [
      el('div', { className: 'card-name', text: c.name }),
      el('div', { className: 'card-class', text: `${c.className} — ${t('hud.level', { level: c.level })}` }),
      hp.element,
      mp.element,
    ]),
  ]);
}

/** Main menu (Cancel / Escape outside dialogues). */
export class MainMenu extends GameWindow {
  private readonly listArea = el('div', { className: 'main-menu-commands' });
  private readonly sheetArea = el('div', { className: 'main-menu-sheet' });
  private readonly footer = el('div', { className: 'main-menu-footer' });

  constructor(private readonly host: MenuHost) {
    super('main-menu', t('menu.title'), { className: 'main-menu', draggable: false });
    this.body.append(el('div', { className: 'main-menu-layout' }, [this.listArea, this.sheetArea]), this.footer);
  }

  override onOpen(): void {
    this.setTitle(t('menu.title'));
    const items: ListItem[] = [
      { label: t('menu.items'), icon: 'bag', onSelect: () => this.host.openBag() },
      { label: t('menu.skills'), icon: 'skills', onSelect: () => this.host.openSkills() },
      { label: t('menu.equipment'), icon: 'armor', onSelect: () => this.host.openEquipment() },
      { label: t('menu.status'), icon: 'character', onSelect: () => this.host.openStatus() },
      { label: t('menu.quests'), icon: 'quests', onSelect: () => this.host.openQuests() },
      { label: t('hud.menu.friends'), icon: 'friends', onSelect: () => this.host.openWindow('friends') },
      { label: t('hud.menu.guild'), icon: 'guild', onSelect: () => this.host.openWindow('guild') },
      { label: t('hud.menu.party'), icon: 'party', onSelect: () => this.host.openWindow('party') },
      { label: t('menu.map'), icon: 'map', onSelect: () => this.host.openMap() },
      { label: t('menu.options'), icon: 'options', onSelect: () => this.host.openOptions() },
      ...(this.host.isStaff() ? [{ label: t(this.host.isAdmin() ? 'hud.menu.admin' : 'hud.menu.moderation'), icon: 'admin' as const, onSelect: () => this.host.openWindow('admin') }] : []),
      { label: t('menu.logout'), icon: 'close', onSelect: () => this.host.logout() },
    ];
    this.setList(items, this.listArea);
    const c = this.host.player();
    this.sheetArea.replaceChildren(characterCard(c));
    this.footer.replaceChildren(
      el('span', { className: 'menu-gold' }, [icon('gold'), el('span', { text: `${c.gold} ${this.host.currency()}` })]),
      el('span', { className: 'menu-time', text: t('menu.play_time', { time: formatTime(this.host.playTimeSeconds()) }) }),
    );
  }
}

/** World map (larger version of the minimap). */
export class MapWindow extends GameWindow {
  constructor(private readonly render: () => HTMLCanvasElement | null, private readonly mapName: () => string) {
    super('world-map', t('menu.map'), { className: 'map-window' });
  }

  override onOpen(): void {
    this.setTitle(`${t('menu.map')} — ${this.mapName()}`);
    const canvas = this.render();
    this.body.replaceChildren(canvas ? Object.assign(canvas, { className: 'big-map' }) : el('p', { text: '—' }));
  }
}

/** Options window. */
export class OptionsWindow extends GameWindow {
  constructor(
    private readonly options: OptionsStore,
    private readonly host: MenuHost,
    private readonly onLanguage: () => void,
  ) {
    super('options', t('menu.options'), { className: 'options-window' });
  }

  private row(label: string, control: HTMLElement): HTMLElement {
    return el('label', { className: 'option-line' }, [el('span', { text: label }), control]);
  }

  private selectControl<T extends string | number>(value: T, choices: [T, string][], onChange: (v: T) => void): HTMLSelectElement {
    const select = el('select', {}, choices.map(([v, label]) => el('option', { text: label, attrs: { value: String(v) } })));
    select.value = String(value);
    select.addEventListener('change', () => {
      const raw = select.value;
      const match = choices.find(([v]) => String(v) === raw);
      if (match) onChange(match[0]);
    });
    return select;
  }

  private range(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
    const input = el('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step) } });
    input.value = String(value);
    input.addEventListener('input', () => onChange(Number(input.value)));
    return input;
  }

  override onOpen(): void {
    this.setTitle(t('menu.options'));
    const o = this.options.values;
    const lang = this.selectControl<Locale>(getLocale(), [['fr', 'Français'], ['en', 'English']], (v) => {
      void setLocale(v).then(() => {
        this.onLanguage();
        this.onOpen();
      });
    });
    const touch = this.selectControl(o.touchControls, [['auto', t('options.touch_auto')], ['on', t('options.on')], ['off', t('options.off')]], (v) =>
      this.options.update({ touchControls: v }),
    );
    const zoom = this.selectControl<number>(o.zoom, [[0, t('options.zoom_auto')], [1, '×1'], [2, '×2'], [3, '×3']], (v) =>
      this.options.update({ zoom: v as 0 | 1 | 2 | 3 }),
    );
    const check = (key: 'showNames' | 'showBubbles' | 'showDamage' | 'chatTimestamps') => {
      const box = el('input', { attrs: { type: 'checkbox' } });
      box.checked = o[key];
      box.addEventListener('change', () => this.options.update({ [key]: box.checked }));
      return box;
    };
    const fullscreen = el('button', {
      className: 'button small',
      text: this.host.isFullscreen() ? t('options.fullscreen_exit') : t('options.fullscreen_enter'),
      attrs: { type: 'button' },
      on: {
        click: () => {
          this.host.toggleFullscreen();
          window.setTimeout(() => this.onOpen(), 300);
        },
      },
    });
    this.body.replaceChildren(
      el('div', { className: 'options-grid' }, [
        this.row(t('common.language'), lang),
        this.row(t('options.volume'), this.range(o.volume, 0, 1, 0.05, (v) => this.options.update({ volume: v }))),
        this.row(t('options.zoom'), zoom),
        this.row(t('options.show_names'), check('showNames')),
        this.row(t('options.show_bubbles'), check('showBubbles')),
        this.row(t('options.show_damage'), check('showDamage')),
        this.row(t('options.chat_timestamps'), check('chatTimestamps')),
        this.row(t('options.chat_opacity'), this.range(o.chatOpacity, 0.3, 1, 0.05, (v) => this.options.update({ chatOpacity: v }))),
        this.row(t('options.touch_controls'), touch),
        this.row(t('options.control_size'), this.range(o.controlSize, 0.7, 1.5, 0.05, (v) => this.options.update({ controlSize: v }))),
        this.row(t('options.control_opacity'), this.range(o.controlOpacity, 0.2, 1, 0.05, (v) => this.options.update({ controlOpacity: v }))),
        this.row(t('options.fullscreen'), fullscreen),
      ]),
      el('p', { className: 'options-help', text: t('options.keys_help') }),
    );
  }
}

/** Entry point of the administration tools. */
export class AdminWindow extends GameWindow {
  constructor(private readonly openEditor: () => void, private readonly isAdmin: () => boolean) {
    super('admin', t('admin.title'), { className: 'admin-window' });
  }

  override onOpen(): void {
    // Moderators only get the panel (the server limits it to their tools).
    if (!this.isAdmin()) {
      this.setTitle(t('admin.mod_title'));
      this.setList([{ label: t('admin.mod_panel_link'), icon: 'admin', onSelect: () => window.open('/admin', '_blank', 'noopener') }]);
      return;
    }
    this.setTitle(t('admin.title'));
    this.setList([
      { label: t('admin.open_editor'), icon: 'map', onSelect: () => this.openEditor() },
      { label: t('admin.resources_link'), icon: 'info', onSelect: () => window.open('/dev/assets', '_blank', 'noopener') },
      { label: t('admin.panel_link'), icon: 'admin', onSelect: () => window.open('/admin', '_blank', 'noopener') },
    ]);
  }
}
