/**
 * @file Repository of the `characters` table.
 *
 * Creation enforces two rules inside one IMMEDIATE transaction: the name must
 * be free (case-insensitive) and the account must be below its character
 * limit, so two simultaneous requests cannot bypass either rule.
 */
import type { Statement } from 'better-sqlite3';
import { sanitizeAppearance, type CharacterAppearance } from '../../shared/art/character.js';
import type { Direction } from '../../shared/settings.js';
import type { Db } from './database.js';

/** A character as used by the server. */
export interface Character {
  id: number;
  accountId: number;
  name: string;
  classId: number;
  appearance: CharacterAppearance;
  level: number;
  xp: number;
  hp: number;
  mp: number;
  gold: number;
  mapId: number;
  x: number;
  y: number;
  direction: Direction;
  playTime: number;
  createdAt: string;
  lastPlayed: string | null;
}

interface CharacterRow {
  id: number;
  account_id: number;
  name: string;
  class_id: number;
  appearance: string;
  level: number;
  xp: number;
  hp: number;
  mp: number;
  gold: number;
  map_id: number;
  x: number;
  y: number;
  direction: number;
  play_time: number;
  created_at: string;
  last_played: string | null;
}

function toCharacter(row: CharacterRow): Character {
  const direction = [2, 4, 6, 8].includes(row.direction) ? (row.direction as Direction) : 2;
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    classId: row.class_id,
    appearance: sanitizeAppearance(JSON.parse(row.appearance)),
    level: row.level,
    xp: row.xp,
    hp: row.hp,
    mp: row.mp,
    gold: row.gold,
    mapId: row.map_id,
    x: row.x,
    y: row.y,
    direction,
    playTime: row.play_time,
    createdAt: row.created_at,
    lastPlayed: row.last_played,
  };
}

/** Fields of a new character. */
export interface NewCharacter {
  accountId: number;
  name: string;
  classId: number;
  appearance: CharacterAppearance;
  hp: number;
  mp: number;
  gold: number;
  mapId: number;
  x: number;
  y: number;
  direction: Direction;
}

/** Why a creation was refused. */
export class CharacterCreationError extends Error {
  constructor(public readonly key: 'error.character.name_taken' | 'error.character.limit_reached') {
    super(key);
  }
}

/** Position and vitals persisted by the world's periodic saves. */
export interface CharacterState {
  mapId: number;
  x: number;
  y: number;
  direction: Direction;
  hp: number;
  mp: number;
  playTimeDelta: number;
}

/** Data access for characters. */
export class CharacterRepository {
  private readonly byId: Statement<[number], CharacterRow>;
  private readonly byName: Statement<[string], CharacterRow>;
  private readonly byAccount: Statement<[number], CharacterRow>;
  private readonly countByAccountStmt: Statement<[number], number>;
  private readonly insertStmt: Statement<
    [number, string, number, string, number, number, number, number, number, number, number]
  >;
  private readonly deleteStmt: Statement<[number, number]>;
  private readonly touchStmt: Statement<[number]>;
  private readonly saveStateStmt: Statement<[number, number, number, number, number, number, number, number]>;

  constructor(private readonly db: Db) {
    this.byId = db.prepare('SELECT * FROM characters WHERE id = ?');
    this.byName = db.prepare('SELECT * FROM characters WHERE name = ?');
    this.byAccount = db.prepare('SELECT * FROM characters WHERE account_id = ? ORDER BY created_at, id');
    this.countByAccountStmt = db.prepare<[number], number>('SELECT COUNT(*) FROM characters WHERE account_id = ?').pluck();
    this.insertStmt = db.prepare(`INSERT INTO characters
      (account_id, name, class_id, appearance, hp, mp, gold, map_id, x, y, direction)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.deleteStmt = db.prepare('DELETE FROM characters WHERE id = ? AND account_id = ?');
    this.touchStmt = db.prepare("UPDATE characters SET last_played = datetime('now') WHERE id = ?");
    this.saveStateStmt = db.prepare(`UPDATE characters SET map_id = ?, x = ?, y = ?, direction = ?, hp = ?, mp = ?,
      play_time = play_time + ? WHERE id = ?`);
  }

  /** Finds a character by id. */
  findById(id: number): Character | undefined {
    const row = this.byId.get(id);
    return row && toCharacter(row);
  }

  /** Characters of an account, oldest first. */
  listByAccount(accountId: number): Character[] {
    return this.byAccount.all(accountId).map(toCharacter);
  }

  /** Number of characters of an account. */
  countByAccount(accountId: number): number {
    return this.countByAccountStmt.get(accountId)!;
  }

  /**
   * Creates a character.
   * @param data - Validated fields.
   * @param maxPerAccount - Character limit of the account.
   * @throws {CharacterCreationError} When the name is taken or the limit reached.
   */
  create(data: NewCharacter, maxPerAccount: number): Character {
    const insert = this.db.transaction((): number => {
      if (this.byName.get(data.name)) throw new CharacterCreationError('error.character.name_taken');
      if (this.countByAccountStmt.get(data.accountId)! >= maxPerAccount) {
        throw new CharacterCreationError('error.character.limit_reached');
      }
      return Number(
        this.insertStmt.run(
          data.accountId, data.name, data.classId, JSON.stringify(data.appearance),
          data.hp, data.mp, data.gold, data.mapId, data.x, data.y, data.direction,
        ).lastInsertRowid,
      );
    });
    return this.findById(insert.immediate())!;
  }

  /**
   * Deletes a character owned by an account.
   * @returns `true` if a row was deleted.
   */
  delete(id: number, accountId: number): boolean {
    return this.deleteStmt.run(id, accountId).changes > 0;
  }

  /** Records that the character was just played. */
  touchPlayed(id: number): void {
    this.touchStmt.run(id);
  }

  /**
   * Persists the hot state of several characters in one transaction (batch save).
   * @param states - Character id and state pairs.
   */
  saveStates(states: readonly (readonly [number, CharacterState])[]): void {
    this.db.transaction(() => {
      for (const [id, s] of states) this.saveStateStmt.run(s.mapId, s.x, s.y, s.direction, s.hp, s.mp, s.playTimeDelta, id);
    })();
  }
}
