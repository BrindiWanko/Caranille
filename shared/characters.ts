/**
 * @file Character rules shared by the creation form and the server, and the
 * character summary sent to the selection screen.
 */
import type { CharacterAppearance } from './art/character.js';

/**
 * Character name: 3–16 characters, letters (any alphabet, accents allowed),
 * digits, spaces, apostrophes and hyphens, starting with a letter, no double spaces.
 */
export const CHARACTER_NAME_PATTERN = /^\p{L}(?:[\p{L}\p{N}'-]| (?! ))*$/u;
export const CHARACTER_NAME_MIN = 3;
export const CHARACTER_NAME_MAX = 16;

/**
 * Validates a character name.
 * @param name - Candidate (already trimmed).
 * @returns An error translation key, or `null` when valid.
 */
export function validateCharacterName(name: string): 'error.character.name_invalid' | null {
  const length = [...name].length;
  if (length < CHARACTER_NAME_MIN || length > CHARACTER_NAME_MAX) return 'error.character.name_invalid';
  if (!CHARACTER_NAME_PATTERN.test(name) || name.endsWith(' ')) return 'error.character.name_invalid';
  return null;
}

/** What the selection screen shows for each character. */
export interface CharacterSummary {
  id: number;
  name: string;
  classId: number;
  className: string;
  level: number;
  appearance: CharacterAppearance;
  lastPlayed: string | null;
}
