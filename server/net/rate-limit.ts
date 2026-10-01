/**
 * @file Per-connection rate limit for incoming socket events.
 *
 * Each socket has a token bucket: every event costs one token, tokens refill at
 * a steady rate up to a burst capacity. Events arriving with an empty bucket are
 * dropped (and the client is warned once in a while); a client that keeps
 * flooding is disconnected. Movement has its own, stricter check in the world.
 */

/** Limits of the bucket. */
export interface RateLimitOptions {
  /** Maximum burst of events. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Dropped events tolerated (without refill in between) before disconnecting. */
  maxDropped: number;
}

/** Default limits: generous for normal play (walking + chat + UI), fatal for scripts. */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { capacity: 40, refillPerSecond: 20, maxDropped: 200 };

/** A token bucket. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  private dropped = 0;

  /**
   * @param options - Limits.
   * @param now - Clock (injectable for tests).
   */
  constructor(
    private readonly options: RateLimitOptions = DEFAULT_RATE_LIMIT,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = options.capacity;
    this.last = now();
  }

  /**
   * Takes a token.
   * @returns `'ok'`, `'drop'` (ignore the event) or `'kick'` (disconnect the client).
   */
  take(): 'ok' | 'drop' | 'kick' {
    const t = this.now();
    this.tokens = Math.min(this.options.capacity, this.tokens + ((t - this.last) / 1000) * this.options.refillPerSecond);
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.dropped = 0;
      return 'ok';
    }
    this.dropped++;
    return this.dropped > this.options.maxDropped ? 'kick' : 'drop';
  }

  /** Number of consecutive dropped events. */
  get droppedCount(): number {
    return this.dropped;
  }
}
