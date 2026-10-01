/**
 * @file Repository for the `accounts` table.
 *
 * Only prepared statements are used. The "first account becomes admin" rule is
 * enforced here, inside an IMMEDIATE transaction, so that the count and the
 * insert cannot interleave with another registration.
 */
import type { Statement } from 'better-sqlite3';
import type { AccountRole } from '../../shared/protocol.js';
import { isRole } from '../../shared/roles.js';
import type { Db } from './database.js';

/** An account row as used by the server (the password hash included). */
export interface Account {
  id: number;
  username: string;
  email: string;
  passwordHash: string;
  role: AccountRole;
  locale: string;
  createdAt: string;
  lastLogin: string | null;
  bannedUntil: string | null;
  banReason: string | null;
}

interface AccountRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  locale: string;
  created_at: string;
  last_login: string | null;
  banned_until: string | null;
  ban_reason: string | null;
}

function toAccount(row: AccountRow): Account {
  // The CHECK constraint guarantees this; the guard protects against a hand-edited database.
  if (!isRole(row.role)) throw new Error(`Account ${row.id} has invalid role "${row.role}"`);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    locale: row.locale,
    createdAt: row.created_at,
    lastLogin: row.last_login,
    bannedUntil: row.banned_until,
    banReason: row.ban_reason,
  };
}

/** Fields required to create an account. */
export interface NewAccount {
  username: string;
  email: string;
  passwordHash: string;
  locale: string;
}

/** Thrown when a unique column (username or email) is already taken. */
export class DuplicateAccountError extends Error {
  constructor(public readonly field: 'username' | 'email') {
    super(`Account ${field} already exists`);
  }
}

/** Data access for accounts. */
export class AccountRepository {
  private readonly byId: Statement<[number], AccountRow>;
  private readonly byUsername: Statement<[string], AccountRow>;
  private readonly byEmail: Statement<[string], AccountRow>;
  private readonly countStmt: Statement<[], number>;
  private readonly insertStmt: Statement<[string, string, string, string, string]>;
  private readonly touchLoginStmt: Statement<[number]>;
  private readonly setLocaleStmt: Statement<[string, number]>;
  private readonly setRoleStmt: Statement<[string, number]>;

  constructor(private readonly db: Db) {
    this.byId = db.prepare('SELECT * FROM accounts WHERE id = ?');
    this.byUsername = db.prepare('SELECT * FROM accounts WHERE username = ?');
    this.byEmail = db.prepare('SELECT * FROM accounts WHERE email = ?');
    this.countStmt = db.prepare<[], number>('SELECT COUNT(*) FROM accounts').pluck();
    this.insertStmt = db.prepare(
      'INSERT INTO accounts (username, email, password_hash, role, locale) VALUES (?, ?, ?, ?, ?)',
    );
    this.touchLoginStmt = db.prepare("UPDATE accounts SET last_login = datetime('now') WHERE id = ?");
    this.setLocaleStmt = db.prepare('UPDATE accounts SET locale = ? WHERE id = ?');
    this.setRoleStmt = db.prepare('UPDATE accounts SET role = ? WHERE id = ?');
  }

  /** Finds an account by id. */
  findById(id: number): Account | undefined {
    const row = this.byId.get(id);
    return row && toAccount(row);
  }

  /** Finds an account by username (case-insensitive). */
  findByUsername(username: string): Account | undefined {
    const row = this.byUsername.get(username);
    return row && toAccount(row);
  }

  /** Number of accounts. */
  count(): number {
    return this.countStmt.get()!;
  }

  /**
   * Creates an account. The very first account of the server receives the
   * `admin` role, every later one `player`.
   *
   * The transaction is IMMEDIATE: it takes the database write lock before
   * counting, so two simultaneous registrations (even from two processes)
   * cannot both observe an empty table and both become admin.
   *
   * @param data - Validated account fields with an already-computed hash.
   * @returns The created account.
   * @throws {DuplicateAccountError} If the username or email is taken.
   */
  create(data: NewAccount): Account {
    const insert = this.db.transaction((): number => {
      if (this.byUsername.get(data.username)) throw new DuplicateAccountError('username');
      if (this.byEmail.get(data.email)) throw new DuplicateAccountError('email');
      const role: AccountRole = this.countStmt.get() === 0 ? 'admin' : 'player';
      return Number(this.insertStmt.run(data.username, data.email, data.passwordHash, role, data.locale).lastInsertRowid);
    });
    return this.findById(insert.immediate())!;
  }

  /** Records a successful login time. */
  touchLogin(id: number): void {
    this.touchLoginStmt.run(id);
  }

  /** Saves the interface language chosen by the account. */
  setLocale(id: number, locale: string): void {
    this.setLocaleStmt.run(locale, id);
  }

  /** Changes the role of an account (admin panel). */
  setRole(id: number, role: AccountRole): void {
    this.setRoleStmt.run(role, id);
  }
}
