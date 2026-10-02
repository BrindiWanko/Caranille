/**
 * @file Touch controls: floating virtual joystick, Action (A) and Cancel (B)
 * buttons, menu and fullscreen buttons.
 *
 * - The joystick appears where the thumb lands on the left half of the screen;
 *   a dead zone ignores small movements and the direction is snapped to the
 *   four directions by the dominant axis. Holding it keeps walking.
 * - A and B are large buttons on the right; they give visual feedback and a
 *   short vibration when available. Pointer events are tracked per pointer, so
 *   walking with the joystick while pressing A works (multi-touch).
 * - Fullscreen uses the Fullscreen API (with the WebKit prefix) and tries to
 *   lock landscape orientation; on iPhone, where web pages cannot go
 *   fullscreen, a hint suggests adding the game to the home screen instead.
 */
import type { Direction } from '../../shared/settings.js';
import type { Input } from '../engine/input.js';
import { t } from '../i18n.js';
import { el, icon } from './dom.js';
import type { GameOptions } from './options.js';

/** Dead zone radius as a fraction of the joystick radius. */
const DEAD_ZONE = 0.28;

type FullscreenDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => void };

/** Tells whether the page is fullscreen. */
export function isFullscreen(): boolean {
  const d = document as FullscreenDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Tells whether this device can use the Fullscreen API. */
export function fullscreenSupported(): boolean {
  const e = document.documentElement as FullscreenEl;
  return typeof e.requestFullscreen === 'function' || typeof e.webkitRequestFullscreen === 'function';
}

/**
 * Enters or leaves fullscreen.
 * @param onUnsupported - Called when fullscreen is not available (iOS Safari).
 */
export function toggleFullscreen(onUnsupported: () => void): void {
  const d = document as FullscreenDoc;
  if (isFullscreen()) {
    if (d.exitFullscreen) void d.exitFullscreen();
    else d.webkitExitFullscreen?.();
    return;
  }
  const root = document.documentElement as FullscreenEl;
  if (root.requestFullscreen) {
    void root
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => undefined);
  } else if (root.webkitRequestFullscreen) {
    root.webkitRequestFullscreen();
  } else {
    onUnsupported();
  }
}

/** Tells whether the device has a touch screen as primary pointer. */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

/** On-screen controls. */
export class TouchControls {
  readonly element: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private stickPointer: number | null = null;
  /** Skill buttons in an arc around the Action button. */
  private readonly skillArc: HTMLDivElement;
  private originX = 0;
  private originY = 0;

  /**
   * @param layer - Container.
   * @param input - Input layer receiving the abstract actions.
   * @param callbacks - Menu and fullscreen handlers.
   */
  constructor(
    layer: HTMLElement,
    private readonly input: Input,
    callbacks: { onMenu: () => void; onFullscreen: () => void; onChat: () => void },
  ) {
    this.base = el('div', { className: 'stick-base' });
    this.knob = el('div', { className: 'stick-knob' });
    this.zone = el('div', { className: 'stick-zone', attrs: { 'aria-label': t('touch.joystick') } }, [this.base, this.knob]);
    const buttonA = this.button('touch-a', t('touch.action'), 'action');
    const buttonB = this.button('touch-b', t('touch.cancel'), 'cancel');
    const top = el('div', { className: 'touch-top' }, [
      el('button', { className: 'touch-small', title: t('touch.chat'), attrs: { type: 'button', 'aria-label': t('touch.chat') }, on: { click: callbacks.onChat } }, [icon('chat')]),
      el('button', { className: 'touch-small', title: t('touch.menu'), attrs: { type: 'button', 'aria-label': t('touch.menu') }, on: { click: callbacks.onMenu } }, [icon('menu')]),
      el('button', { className: 'touch-small', title: t('touch.fullscreen'), attrs: { type: 'button', 'aria-label': t('touch.fullscreen') }, on: { click: callbacks.onFullscreen } }, [icon('fullscreen')]),
    ]);
    this.skillArc = el('div', { className: 'touch-skills' });
    this.element = el('div', { className: 'touch-controls' }, [this.zone, el('div', { className: 'touch-buttons' }, [buttonB, buttonA, this.skillArc]), top]);
    layer.append(this.element);
    this.bindStick();
    requestAnimationFrame(() => this.resetStick());
    window.addEventListener('resize', () => this.resetStick());
    document.addEventListener('fullscreenchange', () => this.refreshFullscreenIcon());
  }

  /**
   * Shows the first hotbar slots as round buttons around the Action button.
   * @param onUse - Called with the slot index.
   */
  setSkills(entries: ({ icon: number; label: string; disabled?: boolean } | null)[], onUse: (index: number) => void): void {
    this.skillArc.replaceChildren(
      ...entries.slice(0, 4).map((entry, i) => {
        const b = el('button', { className: `touch-skill arc-${i}${entry ? '' : ' empty'}${entry?.disabled ? ' disabled' : ''}`, title: entry?.label ?? '', attrs: { type: 'button', 'aria-label': entry?.label ?? String(i + 1) } }, [
          entry ? icon(entry.icon) : null,
          el('span', { className: 'touch-skill-cooldown' }),
        ]);
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (!entry) return;
          navigator.vibrate?.(10);
          onUse(i);
        });
        return b;
      }),
    );
  }

  /** Remaining cooldown of each skill button (0 = ready, 1 = just used), drawn as a closing pie. */
  setCooldowns(fractions: number[]): void {
    this.skillArc.querySelectorAll<HTMLElement>('.touch-skill-cooldown').forEach((node, i) => {
      const f = fractions[i] ?? 0;
      const value = f > 0 ? `conic-gradient(rgba(0,0,0,0.65) ${Math.round(f * 360)}deg, transparent 0)` : 'none';
      if (node.style.background !== value) node.style.background = value;
    });
  }

  private refreshFullscreenIcon(): void {
    const button = this.element.querySelector('.touch-top button:last-child');
    button?.replaceChildren(icon(isFullscreen() ? 'fullscreen_exit' : 'fullscreen'));
  }

  private button(className: string, label: string, action: 'action' | 'cancel'): HTMLButtonElement {
    const b = el('button', { className: `touch-button ${className}`, title: label, attrs: { type: 'button', 'aria-label': label } });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('pressed');
      this.input.press(action);
      if (action === 'cancel') this.input.press('menu');
      this.input.hold(action, true);
      navigator.vibrate?.(12);
    });
    const release = () => {
      b.classList.remove('pressed');
      this.input.hold(action, false);
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    return b;
  }

  private bindStick(): void {
    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      this.zone.setPointerCapture(e.pointerId);
      // Fixed stick: the origin stays at the idle position, wherever the touch lands in the zone.
      const rest = this.restPosition();
      this.originX = rest.x;
      this.originY = rest.y;
      this.zone.classList.add('active');
      this.zone.dispatchEvent(new PointerEvent('pointermove', { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY }));
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      const rect = this.zone.getBoundingClientRect();
      const radius = this.base.offsetWidth / 2 || 60;
      let dx = e.clientX - rect.left - this.originX;
      let dy = e.clientY - rect.top - this.originY;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      this.placeStick(this.originX, this.originY, dx, dy);
      let dir: Direction | 0 = 0;
      if (len > radius * DEAD_ZONE) dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : dy > 0 ? 2 : 8;
      this.input.touchDirection = dir;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.input.touchDirection = 0;
      this.zone.classList.remove('active');
      this.resetStick();
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
  }

  /** Idle position: bottom-left corner of the zone, clear of the screen edges. */
  private resetStick(): void {
    const { x, y } = this.restPosition();
    this.placeStick(x, y, 0, 0);
  }

  private restPosition(): { x: number; y: number } {
    const radius = (this.base.offsetWidth || 128) / 2;
    return { x: radius + 36, y: this.zone.clientHeight - radius - 36 };
  }

  private placeStick(x: number, y: number, dx: number, dy: number): void {
    this.base.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    this.knob.style.transform = `translate(${x + dx}px, ${y + dy}px) translate(-50%, -50%)`;
  }

  /** Applies visibility, size and opacity options. */
  apply(options: GameOptions): void {
    const visible = options.touchControls === 'on' || (options.touchControls === 'auto' && isTouchDevice());
    this.element.classList.toggle('hidden', !visible);
    document.body.classList.toggle('touch-mode', visible);
    this.element.style.setProperty('--control-scale', String(options.controlSize));
    this.element.style.setProperty('--control-opacity', String(options.controlOpacity));
    requestAnimationFrame(() => this.resetStick());
  }
}
