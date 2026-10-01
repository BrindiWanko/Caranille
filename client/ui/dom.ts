/**
 * @file Small DOM helpers for the interface. Text is always set through
 * `textContent`, never `innerHTML`, so names and messages written by players
 * or creators cannot inject markup.
 */
import { ICON_COLUMNS, iconIndex, type IconName } from '../../shared/icons.js';

/** Attributes accepted by `el()`. */
export interface ElementProps {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

/**
 * Creates an element.
 * @param tag - Tag name.
 * @param props - Class, text, attributes and listeners.
 * @param children - Child nodes.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: (Node | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [type, fn] of Object.entries(props.on ?? {})) node.addEventListener(type, fn as EventListener);
  for (const child of children) if (child) node.append(child);
  return node;
}

/**
 * Creates an icon element showing one cell of the icon sheet.
 * @param icon - Icon name or index.
 */
export function icon(icon: IconName | number): HTMLSpanElement {
  const index = typeof icon === 'number' ? icon : iconIndex(icon);
  const span = el('span', { className: 'icon', attrs: { 'aria-hidden': 'true' } });
  span.style.setProperty('--ix', String(index % ICON_COLUMNS));
  span.style.setProperty('--iy', String(Math.floor(index / ICON_COLUMNS)));
  return span;
}

/** A gauge (HP/MP/XP bar) with a label and value text. */
export class Gauge {
  readonly element: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly value: HTMLSpanElement;

  /**
   * @param label - Short label (e.g. "PV").
   * @param kind - CSS modifier: `hp`, `mp` or `xp`.
   */
  constructor(label: string, kind: 'hp' | 'mp' | 'xp') {
    this.fill = el('div', { className: 'gauge-fill' });
    this.value = el('span', { className: 'gauge-value' });
    this.element = el('div', { className: `gauge gauge-${kind}` }, [
      el('span', { className: 'gauge-label', text: label }),
      el('div', { className: 'gauge-track' }, [this.fill]),
      this.value,
    ]);
  }

  /** Updates the bar. */
  set(current: number, max: number, showValue = true): void {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    this.fill.style.width = `${ratio * 100}%`;
    this.value.textContent = showValue ? `${current}/${max}` : '';
  }

  /** Changes the label (language switch). */
  setLabel(label: string): void {
    this.element.querySelector('.gauge-label')!.textContent = label;
  }
}
