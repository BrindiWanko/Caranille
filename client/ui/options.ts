/**
 * @file Player options (per character, stored in the browser): touch controls,
 * control size and opacity, zoom, names display and volume. The interface
 * language is stored on the account by the server.
 */

/** Option values. */
export interface GameOptions {
  /** `auto` shows touch controls on touch screens only. */
  touchControls: 'auto' | 'on' | 'off';
  /** Size multiplier of touch controls (0.7–1.5). */
  controlSize: number;
  /** Opacity of touch controls (0.2–1). */
  controlOpacity: number;
  /** Rendering zoom: 0 = automatic (2 on large screens), 1, 2 or 3. */
  zoom: 0 | 1 | 2 | 3;
  showNames: boolean;
  /** Chat bubbles above the characters. */
  showBubbles: boolean;
  /** Floating damage and healing numbers. */
  showDamage: boolean;
  /** Time of each chat message. */
  chatTimestamps: boolean;
  /** Opacity of the chat box when not in use (0.3–1). */
  chatOpacity: number;
  /** Interface sounds volume (0–1). */
  volume: number;
}

/** Defaults for a new character. */
export const DEFAULT_OPTIONS: GameOptions = {
  touchControls: 'auto',
  controlSize: 1,
  controlOpacity: 0.75,
  zoom: 0,
  showNames: true,
  showBubbles: true,
  showDamage: true,
  chatTimestamps: true,
  chatOpacity: 0.88,
  volume: 0.5,
};

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Loads and saves options for one character. */
export class OptionsStore {
  private readonly key: string;
  values: GameOptions;
  private readonly listeners = new Set<(o: GameOptions) => void>();

  constructor(characterId: number) {
    this.key = `caranille.options.${characterId}`;
    let raw: Partial<GameOptions> = {};
    try {
      raw = JSON.parse(localStorage.getItem(this.key) ?? '{}') as Partial<GameOptions>;
    } catch {
      raw = {};
    }
    this.values = {
      touchControls: raw.touchControls === 'on' || raw.touchControls === 'off' ? raw.touchControls : 'auto',
      controlSize: clamp(raw.controlSize, 0.7, 1.5, DEFAULT_OPTIONS.controlSize),
      controlOpacity: clamp(raw.controlOpacity, 0.2, 1, DEFAULT_OPTIONS.controlOpacity),
      zoom: ([0, 1, 2, 3] as const).includes(raw.zoom as 0) ? (raw.zoom as GameOptions['zoom']) : 0,
      showNames: raw.showNames !== false,
      showBubbles: raw.showBubbles !== false,
      showDamage: raw.showDamage !== false,
      chatTimestamps: raw.chatTimestamps !== false,
      chatOpacity: clamp(raw.chatOpacity, 0.3, 1, DEFAULT_OPTIONS.chatOpacity),
      volume: clamp(raw.volume, 0, 1, DEFAULT_OPTIONS.volume),
    };
  }

  /** Changes some options, saves and notifies listeners. */
  update(patch: Partial<GameOptions>): void {
    this.values = { ...this.values, ...patch };
    try {
      localStorage.setItem(this.key, JSON.stringify(this.values));
    } catch {
      /* storage unavailable: options last for this session only */
    }
    for (const fn of this.listeners) fn(this.values);
  }

  /** Subscribes to changes. */
  onChange(fn: (o: GameOptions) => void): void {
    this.listeners.add(fn);
  }
}
