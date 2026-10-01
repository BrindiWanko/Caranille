/**
 * @file Window system of the interface.
 *
 * Every window uses the window skin (blue gradient background, light frame),
 * can be closed, and on desktop can be dragged by its title bar; on small
 * screens windows are shown as bottom sheets. Open windows form a stack: the
 * top window receives the navigation buttons (up/down to move the cursor,
 * Action to confirm, Cancel to close), which keeps keyboard and gamepad-style
 * play possible, while mouse and touch simply click items.
 *
 * Window positions are remembered per character in `localStorage`.
 */
import type { UiAudio } from '../engine/audio.js';
import type { Input } from '../engine/input.js';
import { t } from '../i18n.js';
import { el, icon } from './dom.js';
import type { IconName } from '../../shared/icons.js';

/** One entry of a selectable list. */
export interface ListItem {
  label: string;
  icon?: IconName | number;
  enabled?: boolean;
  hint?: string;
  /** Longer text shown under the list while the item is highlighted. */
  description?: string;
  /** Text shown on the right of the label (quantity, price...). */
  suffix?: string;
  onSelect?: () => void;
  /** Called when the item becomes highlighted (details panels). */
  onFocus?: () => void;
}

/** Base class of interface windows. */
export class GameWindow {
  readonly element: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  protected manager: WindowManager | null = null;
  private items: { item: ListItem; node: HTMLElement }[] = [];
  private cursor = 0;
  private help: HTMLElement | null = null;

  /**
   * @param id - Stable id (used to remember the position).
   * @param title - Title text.
   * @param options - `closable` shows a close button; `className` adds a CSS class.
   */
  constructor(
    readonly id: string,
    title: string,
    options: { closable?: boolean; className?: string; draggable?: boolean } = {},
  ) {
    this.titleEl = el('span', { className: 'window-title', text: title });
    const header = el('div', { className: 'window-header' }, [this.titleEl]);
    if (options.closable !== false) {
      header.append(
        el('button', { className: 'window-close', title: t('ui.close'), attrs: { type: 'button', 'aria-label': t('ui.close') }, on: { click: () => this.close() } }, [icon('close')]),
      );
    }
    this.body = el('div', { className: 'window-body' });
    this.element = el('div', { className: `skin-window game-window ${options.className ?? ''}`, attrs: { role: 'dialog', 'aria-label': title } }, [header, this.body]);
    if (options.draggable !== false) makeDraggable(this.element, header, id);
  }

  /** Changes the title. */
  setTitle(title: string): void {
    this.titleEl.textContent = title;
    this.element.setAttribute('aria-label', title);
  }

  /** Called by the manager when opened. */
  attach(manager: WindowManager): void {
    this.manager = manager;
  }

  /** Closes the window. */
  close(): void {
    this.manager?.close(this);
  }

  /**
   * Fills the body with a selectable list.
   * @param keepCursor - Keeps the highlighted position (refresh of the same list).
   * @param cursor - Position to highlight at first.
   */
  setList(items: ListItem[], container: HTMLElement = this.body, keepCursor = false, cursor?: number): void {
    const previous = this.cursor;
    const list = el('ul', { className: 'command-list', attrs: { role: 'menu' } });
    this.items = items.map((item, index) => {
      const node = el(
        'li',
        {
          className: `command${item.enabled === false ? ' disabled' : ''}`,
          title: item.hint,
          attrs: { role: 'menuitem', 'aria-disabled': String(item.enabled === false) },
          on: {
            click: () => {
              this.cursor = index;
              this.refreshCursor();
              this.select();
            },
            pointerenter: () => {
              this.cursor = index;
              this.refreshCursor();
            },
          },
        },
        [item.icon !== undefined ? icon(item.icon) : null, el('span', { className: 'command-label', text: item.label }), item.suffix ? el('span', { className: 'command-suffix', text: item.suffix }) : null],
      );
      list.append(node);
      return { item, node };
    });
    this.help = items.some((i) => i.description !== undefined) ? el('div', { className: 'command-help' }) : null;
    container.replaceChildren(list, ...(this.help ? [this.help] : []));
    const wanted = cursor ?? (keepCursor ? previous : undefined);
    this.cursor = wanted !== undefined ? Math.min(wanted, Math.max(0, this.items.length - 1)) : Math.max(0, this.items.findIndex((i) => i.item.enabled !== false));
    this.focused = -1;
    this.refreshCursor();
  }

  /** Index of the item whose `onFocus` ran last. */
  private focused = -1;

  private refreshCursor(): void {
    this.items.forEach(({ node }, i) => node.classList.toggle('selected', i === this.cursor));
    if (this.help) this.help.textContent = this.items[this.cursor]?.item.description ?? '';
    if (this.focused !== this.cursor) {
      this.focused = this.cursor;
      this.items[this.cursor]?.item.onFocus?.();
    }
  }

  private select(): void {
    const entry = this.items[this.cursor];
    if (!entry) return;
    if (entry.item.enabled === false) {
      this.manager?.audio.play('buzzer');
      return;
    }
    this.manager?.audio.play('ok');
    entry.item.onSelect?.();
  }

  /**
   * Handles navigation buttons when this window is on top.
   * @returns `true` if the input was used.
   */
  handleInput(input: Input): boolean {
    if (input.consume('cancel')) {
      this.manager?.audio.play('cancel');
      this.close();
      return true;
    }
    if (this.items.length > 0) {
      const move = input.consume('down') ? 1 : input.consume('up') ? -1 : 0;
      if (move) {
        this.cursor = (this.cursor + move + this.items.length) % this.items.length;
        this.manager?.audio.play('cursor');
        this.refreshCursor();
        return true;
      }
      if (input.consume('action')) {
        this.select();
        return true;
      }
    }
    input.consume('action');
    return true;
  }

  /** Called when the window becomes visible (refresh contents). */
  onOpen(): void {}

  /** Called after the window was removed. */
  onClose(): void {}
}

/** Keeps the stack of open windows. */
export class WindowManager {
  private readonly stack: GameWindow[] = [];

  /**
   * @param layer - DOM container of windows.
   * @param audio - Interface sounds.
   * @param onChange - Called whenever the stack changes (to freeze the player).
   */
  constructor(
    private readonly layer: HTMLElement,
    readonly audio: UiAudio,
    private readonly onChange: () => void = () => {},
  ) {}

  /** Tells whether any window is open. */
  get hasOpen(): boolean {
    return this.stack.length > 0;
  }

  /** Tells whether a window is open. */
  isOpen(w: GameWindow): boolean {
    return this.stack.includes(w);
  }

  /** Opens (or brings to front) a window. */
  open(w: GameWindow): void {
    const i = this.stack.indexOf(w);
    if (i >= 0) this.stack.splice(i, 1);
    this.stack.push(w);
    w.attach(this);
    this.layer.append(w.element);
    w.onOpen();
    this.onChange();
  }

  /** Closes a window. */
  close(w: GameWindow): void {
    const i = this.stack.indexOf(w);
    if (i < 0) return;
    this.stack.splice(i, 1);
    w.element.remove();
    w.onClose();
    this.onChange();
  }

  /** Toggles a window. */
  toggle(w: GameWindow): void {
    if (this.stack.at(-1) === w) this.close(w);
    else this.open(w);
  }

  /** Closes every window. */
  closeAll(): void {
    for (const w of [...this.stack]) this.close(w);
  }

  /**
   * Routes navigation input to the top window.
   * @returns `true` when a window consumed the input.
   */
  handleInput(input: Input): boolean {
    const top = this.stack.at(-1);
    return top ? top.handleInput(input) : false;
  }
}

/** Remembered window positions, per character. */
let positionsKey = 'caranille.windows';

/** Sets the storage key used for window positions (one per character). */
export function setWindowStorageKey(characterId: number): void {
  positionsKey = `caranille.windows.${characterId}`;
}

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(positionsKey) ?? '{}') as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}

function makeDraggable(win: HTMLElement, handle: HTMLElement, id: string): void {
  const saved = loadPositions()[id];
  if (saved) {
    win.style.left = `${saved.x}px`;
    win.style.top = `${saved.y}px`;
    win.classList.add('positioned');
  }
  handle.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || window.matchMedia('(max-width: 640px)').matches) return;
    const rect = win.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - offX));
      const y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - offY));
      win.style.left = `${x}px`;
      win.style.top = `${y}px`;
      win.classList.add('positioned');
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      const positions = loadPositions();
      positions[id] = { x: Number.parseFloat(win.style.left), y: Number.parseFloat(win.style.top) };
      try {
        localStorage.setItem(positionsKey, JSON.stringify(positions));
      } catch {
        /* storage unavailable: positions are simply not remembered */
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
