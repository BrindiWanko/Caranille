/**
 * @file Unified input layer.
 *
 * Keyboard, mouse and touch all produce the same abstract actions, so the rest
 * of the engine never needs to know which device is used:
 * - a held direction (`dir4()`: 2, 4, 6, 8 or 0), the most recent one winning;
 * - edge-triggered buttons: `action`, `cancel`, `menu`, `up`, `down`, `left`,
 *   `right` (the last four for navigating windows), read with `consume()`.
 *
 * Keyboard mapping: arrows or the physical W/A/S/D keys (Z/Q/S/D on AZERTY)
 * move; Enter, Space or the physical Z key (QWERTY) confirm; Escape or X cancel.
 * Movement uses physical key codes so both layouts work without settings.
 */
import type { Direction } from '../../shared/settings.js';

/** Abstract buttons. */
export type Button = 'action' | 'cancel' | 'menu' | 'up' | 'down' | 'left' | 'right';

const MOVE_CODES: Record<string, Direction> = {
  ArrowUp: 8, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 6,
  KeyW: 8, KeyS: 2, KeyA: 4, KeyD: 6,
  Numpad8: 8, Numpad2: 2, Numpad4: 4, Numpad6: 6,
};
const ACTION_CODES = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyZ']);
const CANCEL_CODES = new Set(['Escape', 'KeyX', 'Numpad0']);
const NAV_BUTTON: Record<Direction, Button> = { 8: 'up', 2: 'down', 4: 'left', 6: 'right' };

/** Collects input from every device. */
export class Input {
  private readonly heldKeys: Direction[] = [];
  private readonly pressed = new Set<Button>();
  private readonly heldButtons = new Set<Button>();
  /** Direction from the virtual joystick (0 when idle). */
  touchDirection: Direction | 0 = 0;
  /**
   * Direction key pressed since the last frame. A very short tap can be released
   * before the next update runs; remembering it for one frame makes it count.
   */
  private tapped: Direction | 0 = 0;
  /** When `true`, keys are ignored (typing in a text field). */
  private suspended = false;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.clear());
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.suspended || this.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const d = MOVE_CODES[e.code];
    if (d) {
      if (!e.repeat) {
        const i = this.heldKeys.indexOf(d);
        if (i >= 0) this.heldKeys.splice(i, 1);
        this.heldKeys.push(d);
        this.tapped = d;
      }
      this.press(NAV_BUTTON[d], e.repeat);
      e.preventDefault();
    } else if (ACTION_CODES.has(e.code)) {
      if (!e.repeat) this.press('action');
      this.heldButtons.add('action');
      e.preventDefault();
    } else if (CANCEL_CODES.has(e.code)) {
      if (!e.repeat) {
        this.press('cancel');
        this.press('menu');
      }
      e.preventDefault();
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const d = MOVE_CODES[e.code];
    if (d) {
      const i = this.heldKeys.indexOf(d);
      if (i >= 0) this.heldKeys.splice(i, 1);
    }
    if (ACTION_CODES.has(e.code)) this.heldButtons.delete('action');
  }

  /**
   * Registers a button press (from any device).
   * @param button - Button.
   * @param repeat - Key auto-repeat (only navigation buttons repeat).
   */
  press(button: Button, repeat = false): void {
    if (repeat && button !== 'up' && button !== 'down' && button !== 'left' && button !== 'right') return;
    this.pressed.add(button);
  }

  /** Marks a button as held or released (touch buttons). */
  hold(button: Button, down: boolean): void {
    if (down) this.heldButtons.add(button);
    else this.heldButtons.delete(button);
  }

  /** Tells whether a button is currently held. */
  isHeld(button: Button): boolean {
    return this.heldButtons.has(button);
  }

  /** Returns and clears a pending button press. */
  consume(button: Button): boolean {
    const had = this.pressed.has(button);
    this.pressed.delete(button);
    return had;
  }

  /** Drops pending presses (called once per frame after the UI and the map had their turn). */
  endFrame(): void {
    this.pressed.clear();
    this.tapped = 0;
  }

  /** Current held direction, keyboard first then joystick. */
  dir4(): Direction | 0 {
    return this.heldKeys.at(-1) ?? (this.touchDirection || this.tapped);
  }

  /** Releases everything (window lost focus, window opened...). */
  clear(): void {
    this.heldKeys.length = 0;
    this.pressed.clear();
    this.heldButtons.clear();
    this.touchDirection = 0;
    this.tapped = 0;
  }

  /** Ignores the keyboard while a text field is focused elsewhere (chat). */
  setSuspended(value: boolean): void {
    this.suspended = value;
    if (value) this.clear();
  }
}
