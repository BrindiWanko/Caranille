/**
 * @file Authentication use-cases (register, log in), independent of Express so
 * they can be unit-tested. Results carry translation keys for the client.
 */
import bcrypt from 'bcrypt';
import { validateRegistration, type RegistrationInput } from '../../shared/accounts.js';
import type { Locale } from '../../shared/i18n.js';
import { DuplicateAccountError, type Account, type AccountRepository } from '../db/accounts.js';
import { LoginThrottle } from './throttle.js';

/** Outcome of a use-case: the account, or a translation key describing the error. */
export type AuthResult =
  | { ok: true; account: Account }
  | { ok: false; errorKey: string; params?: Record<string, string | number> };

/**
 * Tells whether an account is currently banned.
 * @param account - Account to check.
 * @param now - Current time (injectable for tests).
 */
export function isBanned(account: Account, now = new Date()): boolean {
  // SQLite datetime('now') values are UTC without a zone suffix.
  return account.bannedUntil !== null && new Date(`${account.bannedUntil.replace(' ', 'T')}Z`) > now;
}

/** Registration and login logic. */
export class AuthService {
  /** Hash compared against when the username does not exist, so timing does not reveal it. */
  private readonly dummyHash: string;

  /**
   * @param accounts - Account repository.
   * @param bcryptRounds - Hashing cost (lower it only in tests).
   * @param throttle - Brute-force limiter.
   */
  constructor(
    private readonly accounts: AccountRepository,
    private readonly bcryptRounds = 11,
    readonly throttle = new LoginThrottle(),
  ) {
    this.dummyHash = bcrypt.hashSync('caranille-dummy-password', bcryptRounds);
  }

  /**
   * Creates an account after validation.
   * @param input - Raw form values.
   * @param locale - Interface language to store in the account.
   */
  async register(input: RegistrationInput, locale: Locale): Promise<AuthResult> {
    const clean = { ...input, username: input.username.trim(), email: input.email.trim() };
    const invalid = validateRegistration(clean);
    if (invalid) return { ok: false, errorKey: invalid };
    // Cheap pre-check so a taken name does not cost a hash; `create` re-checks atomically.
    if (this.accounts.findByUsername(clean.username)) return { ok: false, errorKey: 'error.auth.username_taken' };
    const passwordHash = await bcrypt.hash(clean.password, this.bcryptRounds);
    try {
      const account = this.accounts.create({ username: clean.username, email: clean.email, passwordHash, locale });
      return { ok: true, account };
    } catch (err) {
      if (err instanceof DuplicateAccountError) {
        return { ok: false, errorKey: err.field === 'username' ? 'error.auth.username_taken' : 'error.auth.email_taken' };
      }
      throw err;
    }
  }

  /**
   * Checks credentials.
   * @param username - Submitted username.
   * @param password - Submitted password.
   * @param ip - Client address, used for throttling.
   */
  async login(username: string, password: string, ip: string): Promise<AuthResult> {
    const name = username.trim().toLowerCase();
    const keys = [`ip:${ip}`, `user:${name}`];
    const locked = this.throttle.lockedFor(...keys);
    if (locked > 0) {
      return { ok: false, errorKey: 'error.auth.too_many_attempts', params: { seconds: Math.ceil(locked / 1000) } };
    }
    const account = name ? this.accounts.findByUsername(name) : undefined;
    // Always run one hash comparison so response time is the same whether the account exists or not.
    const valid = await bcrypt.compare(password.slice(0, 256), account?.passwordHash ?? this.dummyHash);
    if (!account || !valid) {
      this.throttle.fail(...keys);
      return { ok: false, errorKey: 'error.auth.invalid_credentials' };
    }
    this.throttle.succeed(...keys);
    if (isBanned(account)) {
      return { ok: false, errorKey: 'error.auth.banned', params: { until: account.bannedUntil ?? '' } };
    }
    this.accounts.touchLogin(account.id);
    return { ok: true, account };
  }
}
