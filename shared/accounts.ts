/**
 * @file Account field rules shared by the registration form (instant feedback)
 * and the server (authoritative validation). Error values are translation keys.
 */

/** Username: 3-20 characters, letters, digits, `_` and `-`, starting with a letter. */
export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,19}$/;

/** Minimum password length, in characters. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Maximum password length, in UTF-8 bytes. The hashing algorithm ignores
 * everything past 72 bytes, so longer passwords are refused rather than
 * silently truncated.
 */
export const PASSWORD_MAX_BYTES = 72;

/** Pragmatic e-mail shape check (the address is not verified by mail). */
export const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/** Translation keys of registration validation errors. */
export type AccountFieldError =
  | 'error.auth.username_invalid'
  | 'error.auth.email_invalid'
  | 'error.auth.password_too_short'
  | 'error.auth.password_too_long'
  | 'error.auth.password_mismatch';

/** Raw registration input. */
export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  passwordConfirm: string;
}

/**
 * Validates registration fields.
 * @param input - Untrusted form values (already trimmed except passwords).
 * @returns The first error key found, or `null` when everything is valid.
 */
export function validateRegistration(input: RegistrationInput): AccountFieldError | null {
  if (!USERNAME_PATTERN.test(input.username)) return 'error.auth.username_invalid';
  if (input.email.length > 254 || !EMAIL_PATTERN.test(input.email)) return 'error.auth.email_invalid';
  if ([...input.password].length < PASSWORD_MIN_LENGTH) return 'error.auth.password_too_short';
  if (new TextEncoder().encode(input.password).length > PASSWORD_MAX_BYTES) return 'error.auth.password_too_long';
  if (input.password !== input.passwordConfirm) return 'error.auth.password_mismatch';
  return null;
}
