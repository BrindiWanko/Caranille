/**
 * @file Repository of the administration panel: account search, roles,
 * bans and mutes, password resets, and the logs (connections, administrator
 * actions, sales, rare drops; trades live in the social repository).
 */
import type { AccountRole } from '../../shared/protocol.js';
import type { Db } from './database.js';

/** Date format stored by SQLite (`YYYY-MM-DD HH:MM:SS`, UTC). */
export function sqlDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** A permanent sanction ends in this far date. */
export const PERMANENT = '9999-12-31 23:59:59';

/** Log types readable in the panel. */
export const LOG_TYPES = ['connections', 'admin', 'trades', 'sales', 'drops', 'reports'] as const;
export type LogType = (typeof LOG_TYPES)[number];

/** An account row as listed in the panel. */
export interface AccountSummary {
  id: number;
  username: string;
  email: string;
  role: AccountRole;
  createdAt: string;
  lastLogin: string | null;
  bannedUntil: string | null;
  banReason: string | null;
  mutedUntil: string | null;
  muteReason: string | null;
}

/** One log line (columns depend on the log type). */
export type LogLine = Record<string, string | number | null>;

/** Data access for administration. */
export class AdminRepository {
  constructor(private readonly db: Db) {}

  private static readonly SUMMARY = `SELECT id, username, email, role, created_at AS createdAt, last_login AS lastLogin, banned_until AS bannedUntil,
    ban_reason AS banReason, muted_until AS mutedUntil, mute_reason AS muteReason FROM accounts`;

  /** Accounts whose name, email or character name contains `query`. */
  searchAccounts(query: string, limit = 50): AccountSummary[] {
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return this.db
      .prepare<[string, string, string, number], AccountSummary>(
        `${AdminRepository.SUMMARY} WHERE username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'
          OR id IN (SELECT account_id FROM characters WHERE name LIKE ? ESCAPE '\\') ORDER BY id LIMIT ?`,
      )
      .all(like, like, like, limit);
  }

  account(id: number): AccountSummary | undefined {
    return this.db.prepare<[number], AccountSummary>(`${AdminRepository.SUMMARY} WHERE id = ?`).get(id);
  }

  setRole(id: number, role: AccountRole): void {
    this.db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, id);
  }

  /** Bans until a date (`null` lifts the ban). */
  setBan(id: number, until: string | null, reason: string | null): void {
    this.db.prepare('UPDATE accounts SET banned_until = ?, ban_reason = ? WHERE id = ?').run(until, reason, id);
  }

  /** Mutes until a date (`null` lifts the mute). */
  setMute(id: number, until: string | null, reason: string | null): void {
    this.db.prepare('UPDATE accounts SET muted_until = ?, mute_reason = ? WHERE id = ?').run(until, reason, id);
  }

  /** Tells whether an account may not write in the chat now. */
  isMuted(id: number, now = Date.now()): boolean {
    const until = this.db.prepare<[number], string | null>('SELECT muted_until FROM accounts WHERE id = ?').pluck().get(id);
    return !!until && until > sqlDate(now);
  }

  setPasswordHash(id: number, hash: string): void {
    this.db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, id);
  }

  // --- Logs ------------------------------------------------------------------------

  logConnection(accountId: number, characterId: number | null, event: 'login' | 'logout', ip: string): void {
    this.db.prepare('INSERT INTO connection_log (account_id, character_id, event, ip) VALUES (?, ?, ?, ?)').run(accountId, characterId, event, ip.slice(0, 64));
  }

  logAdmin(adminId: number, action: string, target: string, details: Record<string, unknown> = {}): void {
    this.db.prepare('INSERT INTO admin_log (admin_id, action, target, details) VALUES (?, ?, ?, ?)').run(adminId, action, target, JSON.stringify(details));
  }

  logSale(characterId: number, action: 'buy' | 'sell', kind: string, itemId: number, quantity: number, price: number): void {
    this.db.prepare('INSERT INTO sale_log (character_id, action, item_kind, item_id, quantity, price) VALUES (?, ?, ?, ?, ?, ?)').run(characterId, action, kind, itemId, quantity, price);
  }

  logDrop(characterId: number, enemyId: number, kind: string, itemId: number, chance: number): void {
    this.db.prepare('INSERT INTO drop_log (character_id, enemy_id, item_kind, item_id, chance) VALUES (?, ?, ?, ?, ?)').run(characterId, enemyId, kind, itemId, chance);
  }

  logReport(reporter: { id: number; name: string }, target: { id: number; name: string }, reason: string): void {
    this.db.prepare('INSERT INTO report_log (reporter_id, reporter_name, target_id, target_name, reason) VALUES (?, ?, ?, ?, ?)').run(reporter.id, reporter.name, target.id, target.name, reason);
  }

  /**
   * Latest lines of a log, optionally for one account (its characters).
   * @param accountId - Account filter (0 = everyone).
   */
  logs(type: LogType, accountId = 0, limit = 100): LogLine[] {
    const byAccount = accountId > 0;
    const chars = '(SELECT id FROM characters WHERE account_id = @account)';
    const sql: Record<LogType, string> = {
      connections: `SELECT l.id, l.created_at AS at, a.username AS account, c.name AS character, l.event, l.ip FROM connection_log l
        JOIN accounts a ON a.id = l.account_id LEFT JOIN characters c ON c.id = l.character_id ${byAccount ? 'WHERE l.account_id = @account' : ''}`,
      admin: `SELECT l.id, l.created_at AS at, a.username AS admin, l.action, l.target, l.details FROM admin_log l
        JOIN accounts a ON a.id = l.admin_id ${byAccount ? "WHERE l.target = 'account:' || @account OR l.target IN (SELECT 'character:' || id FROM characters WHERE account_id = @account)" : ''}`,
      trades: `SELECT t.id, t.created_at AS at, ca.name AS a, cb.name AS b, t.a_items AS aItems, t.b_items AS bItems, t.a_gold AS aGold, t.b_gold AS bGold FROM trade_log t
        LEFT JOIN characters ca ON ca.id = t.a_id LEFT JOIN characters cb ON cb.id = t.b_id ${byAccount ? `WHERE t.a_id IN ${chars} OR t.b_id IN ${chars}` : ''}`,
      sales: `SELECT s.id, s.created_at AS at, c.name AS character, s.action, s.item_kind AS kind, s.item_id AS item, s.quantity, s.price FROM sale_log s
        LEFT JOIN characters c ON c.id = s.character_id ${byAccount ? `WHERE s.character_id IN ${chars}` : ''}`,
      drops: `SELECT d.id, d.created_at AS at, c.name AS character, d.enemy_id AS enemy, d.item_kind AS kind, d.item_id AS item, d.chance FROM drop_log d
        LEFT JOIN characters c ON c.id = d.character_id ${byAccount ? `WHERE d.character_id IN ${chars}` : ''}`,
      reports: `SELECT r.id, r.created_at AS at, r.reporter_name AS reporter, r.target_name AS target, r.reason FROM report_log r
        ${byAccount ? `WHERE r.target_id IN ${chars}` : ''}`,
    };
    return this.db.prepare(`${sql[type]} ORDER BY 1 DESC LIMIT @limit`).all({ account: accountId, limit }) as LogLine[];
  }
}
