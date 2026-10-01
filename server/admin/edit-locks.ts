/**
 * @file Edit locks: only one administrator edits a given map at a time.
 *
 * Opening a map in the editor takes its lock; the editor refreshes it
 * periodically and releases it when switching maps or closing. A lock that is
 * not refreshed expires, so a crashed browser never blocks a map forever.
 * Locks are kept in memory: a server restart simply frees them all.
 */

/** Current holder of a lock. */
export interface EditLock {
  accountId: number;
  username: string;
  expiresAt: number;
}

/** Lock lifetime without refresh. */
export const LOCK_TTL_MS = 2 * 60_000;

/** In-memory lock table. */
export class EditLocks {
  private readonly locks = new Map<number, EditLock>();

  /** @param now - Clock (injectable for tests). */
  constructor(private readonly now: () => number = Date.now) {}

  /** Returns the valid lock of a map, dropping it if expired. */
  holder(mapId: number): EditLock | undefined {
    const lock = this.locks.get(mapId);
    if (lock && lock.expiresAt <= this.now()) {
      this.locks.delete(mapId);
      return undefined;
    }
    return lock;
  }

  /**
   * Takes or refreshes a lock.
   * @returns `true` if the account now holds the lock, `false` if someone else does.
   */
  acquire(mapId: number, accountId: number, username: string): boolean {
    const current = this.holder(mapId);
    if (current && current.accountId !== accountId) return false;
    this.locks.set(mapId, { accountId, username, expiresAt: this.now() + LOCK_TTL_MS });
    return true;
  }

  /** Tells whether an account holds the lock of a map. */
  isHeldBy(mapId: number, accountId: number): boolean {
    return this.holder(mapId)?.accountId === accountId;
  }

  /** Releases a lock held by an account. */
  release(mapId: number, accountId: number): void {
    if (this.holder(mapId)?.accountId === accountId) this.locks.delete(mapId);
  }

  /** Releases every lock of an account (logout, disconnection). */
  releaseAll(accountId: number): void {
    for (const [mapId, lock] of this.locks) if (lock.accountId === accountId) this.locks.delete(mapId);
  }
}
