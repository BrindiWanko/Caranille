/**
 * @file Character use-cases (list, create, delete, select), independent of
 * Express. New characters start at the position configured in the system
 * settings, with full HP/MP computed from their class at level 1.
 */
import { sanitizeAppearance, type CharacterAppearance } from '../../shared/art/character.js';
import { validateCharacterName, type CharacterSummary } from '../../shared/characters.js';
import { paramAt } from '../../shared/database.js';
import { DEFAULT_SETTINGS, type StartPosition } from '../../shared/settings.js';
import { CharacterCreationError, type Character, type CharacterRepository } from '../db/characters.js';
import type { GameDataRepository } from '../db/game-data.js';
import type { SettingsRepository } from '../db/settings.js';

/** Raw creation input from the form. */
export interface CharacterInput {
  name: string;
  classId: number;
  appearance: unknown;
}

/** Outcome of a use-case. */
export type CharacterResult = { ok: true; character: Character } | { ok: false; errorKey: string };

/** Character management. */
export class CharacterService {
  constructor(
    private readonly characters: CharacterRepository,
    private readonly data: GameDataRepository,
    private readonly settings: SettingsRepository,
    private readonly maxPerAccount: number,
  ) {}

  /** Summaries shown on the selection screen. */
  list(accountId: number): CharacterSummary[] {
    return this.characters.listByAccount(accountId).map((c) => ({
      id: c.id,
      name: c.name,
      classId: c.classId,
      className: this.data.get('class', c.classId)?.name ?? '?',
      level: c.level,
      appearance: c.appearance,
      lastPlayed: c.lastPlayed,
    }));
  }

  /** Tells whether the account may create another character. */
  canCreate(accountId: number): boolean {
    return this.characters.countByAccount(accountId) < this.maxPerAccount;
  }

  /** Character limit per account. */
  get limit(): number {
    return this.maxPerAccount;
  }

  /**
   * Creates a character after validation. The outfit is imposed by the class;
   * other appearance fields are sanitised.
   * @param accountId - Owner.
   * @param input - Form values.
   */
  create(accountId: number, input: CharacterInput): CharacterResult {
    const name = input.name.trim().replace(/\s+/g, ' ');
    const invalid = validateCharacterName(name);
    if (invalid) return { ok: false, errorKey: invalid };
    const cls = this.data.get('class', input.classId);
    if (!cls) return { ok: false, errorKey: 'error.character.class_invalid' };
    const appearance: CharacterAppearance = { ...sanitizeAppearance(input.appearance, [cls.outfit]), beard: false };
    const start = this.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition);
    try {
      const character = this.characters.create(
        {
          accountId,
          name,
          classId: cls.id,
          appearance,
          hp: paramAt(cls.params.mhp, 1),
          mp: paramAt(cls.params.mmp, 1),
          gold: this.settings.get('startingGold', DEFAULT_SETTINGS.startingGold),
          mapId: start.mapId,
          x: start.x,
          y: start.y,
          direction: start.direction,
        },
        this.maxPerAccount,
      );
      return { ok: true, character };
    } catch (err) {
      if (err instanceof CharacterCreationError) return { ok: false, errorKey: err.key };
      throw err;
    }
  }

  /**
   * Deletes a character; the owner must retype its exact name to confirm.
   * @param beforeDelete - Called once confirmed, before the row goes (guild succession).
   * @returns An error key, or `null` on success.
   */
  delete(accountId: number, characterId: number, confirmName: string, beforeDelete?: (character: { id: number; name: string }) => void): string | null {
    const character = this.characters.findById(characterId);
    if (!character || character.accountId !== accountId) return 'error.character.not_found';
    if (confirmName.trim() !== character.name) return 'error.character.delete_confirm';
    beforeDelete?.(character);
    this.characters.delete(characterId, accountId);
    return null;
  }

  /**
   * Returns a character only if it belongs to the account.
   * @param accountId - Account claiming the character.
   * @param characterId - Character id (untrusted).
   */
  owned(accountId: number, characterId: unknown): Character | undefined {
    if (!Number.isInteger(characterId)) return undefined;
    const character = this.characters.findById(characterId as number);
    return character?.accountId === accountId ? character : undefined;
  }
}
