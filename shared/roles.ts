/**
 * @file Account role helpers shared by the server (authorization) and the client
 * (deciding which UI elements to show). The client-side check is cosmetic only:
 * every privileged action is re-checked by the server.
 */
import type { AccountRole } from './protocol.js';

/** Ordered list of roles; a higher index means more privileges. */
export const ROLES: readonly AccountRole[] = ['player', 'moderator', 'admin'];

/**
 * Tells whether `role` grants at least the privileges of `required`.
 * @param role - Role held by the account.
 * @param required - Minimum role needed.
 * @returns `true` when `role` is equal to or above `required`.
 */
export function hasRole(role: AccountRole, required: AccountRole): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(required);
}

/**
 * Type guard for untrusted role strings (e.g. read back from the database).
 * @param value - Any value.
 */
export function isRole(value: unknown): value is AccountRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
