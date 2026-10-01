/**
 * @file Basic brute-force protection for the login form.
 *
 * Failed attempts are counted per key (the client IP and, separately, the
 * targeted username) inside a sliding window. Once a key reaches the limit, it
 * is locked for a period that doubles with each further lock, up to a cap.
 * Counting per username stops distributed guessing on one account; counting
 * per IP stops one client from sweeping many accounts. State is in memory: it
 * resets on restart, which is acceptable for this level of protection.
 */

interface Entry {
  failures: number[];
  lockedUntil: number;
  locks: number;
}

/** Tunables of the throttle. */
export interface ThrottleOptions {
  /** Failures allowed inside the window before locking. */
  maxFailures: number;
  /** Sliding window length, in ms. */
  windowMs: number;
  /** First lock duration, in ms (doubled on each subsequent lock). */
  lockMs: number;
  /** Maximum lock duration, in ms. */
  maxLockMs: number;
}

const DEFAULTS: ThrottleOptions = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  lockMs: 60 * 1000,
  maxLockMs: 60 * 60 * 1000,
};

/** In-memory failed-attempt counter with escalating lockouts. */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly options: ThrottleOptions;

  /**
   * @param options - Overrides of the default limits.
   * @param now - Clock, injectable for tests.
   */
  constructor(options: Partial<ThrottleOptions> = {}, private readonly now: () => number = Date.now) {
    this.options = { ...DEFAULTS, ...options };
  }

  /**
   * Returns how many milliseconds the keys remain locked (0 when free).
   * @param keys - Keys to check (e.g. `ip:1.2.3.4`, `user:alice`).
   */
  lockedFor(...keys: string[]): number {
    const t = this.now();
    let remaining = 0;
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry && entry.lockedUntil > t) remaining = Math.max(remaining, entry.lockedUntil - t);
    }
    return remaining;
  }

  /** Records a failed attempt for every key, locking those over the limit. */
  fail(...keys: string[]): void {
    const t = this.now();
    for (const key of keys) {
      const entry = this.entries.get(key) ?? { failures: [], lockedUntil: 0, locks: 0 };
      entry.failures = entry.failures.filter((at) => t - at < this.options.windowMs);
      entry.failures.push(t);
      if (entry.failures.length >= this.options.maxFailures) {
        const duration = Math.min(this.options.lockMs * 2 ** entry.locks, this.options.maxLockMs);
        entry.lockedUntil = t + duration;
        entry.locks++;
        entry.failures = [];
      }
      this.entries.set(key, entry);
    }
    this.prune(t);
  }

  /** Clears the counters of the keys after a successful login. */
  succeed(...keys: string[]): void {
    for (const key of keys) this.entries.delete(key);
  }

  /** Drops stale entries so the map cannot grow without bound. */
  private prune(t: number): void {
    if (this.entries.size < 10_000) return;
    for (const [key, entry] of this.entries) {
      const lastFailure = entry.failures.at(-1) ?? 0;
      if (entry.lockedUntil <= t && t - lastFailure > this.options.windowMs) this.entries.delete(key);
    }
  }
}
