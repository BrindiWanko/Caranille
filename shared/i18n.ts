/**
 * @file Translation primitives shared by the server and the browser client.
 *
 * Dictionaries live in `locales/<locale>.json` as nested objects; a key is the
 * dotted path to a string leaf (e.g. `auth.login.title`). Parameters use the
 * `{{name}}` placeholder syntax, identical on both sides so that the same
 * dictionary renders the same way in EJS pages and in the client.
 *
 * `TranslationKey` is derived from the English dictionary at compile time, so a
 * typo in a key is a type error. `npm run i18n:check` guarantees that every
 * locale defines the same keys as English.
 */
import type enDictionary from '../locales/en.json';

/** Locales supported by the engine interface. */
export const SUPPORTED_LOCALES = ['fr', 'en'] as const;

/** A supported locale code. */
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Locale used when nothing better can be determined. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Name of the cookie remembering the visitor's language before (and besides) login. */
export const LOCALE_COOKIE = 'lang';

/** Nested dictionary as stored in `locales/*.json`. */
export interface Dictionary {
  [key: string]: string | Dictionary;
}

/** Dotted paths of every string leaf of a dictionary type. */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every valid translation key, derived from the English dictionary. */
export type TranslationKey = Leaves<typeof enDictionary>;

/** Parameters substituted into `{{name}}` placeholders. */
export type TranslationParams = Record<string, string | number>;

/**
 * Type guard for untrusted locale strings (cookies, query strings, database).
 * @param value - Any value.
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from an `Accept-Language` header value.
 * Entries are sorted by their `q` weight; region subtags are ignored (`fr-CA` -> `fr`).
 * @param header - Raw header value, possibly undefined.
 * @returns A supported locale, or `DEFAULT_LOCALE` if none matches.
 */
export function negotiateLocale(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { lang: tag.toLowerCase().split('-')[0], weight: q ? Number(q.slice(2)) || 0 : 1, index };
    })
    // Stable ordering: equal weights keep the order the browser sent.
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of ranked) if (isLocale(entry.lang)) return entry.lang;
  return DEFAULT_LOCALE;
}

/**
 * Resolves a dotted key in a nested dictionary.
 * @param dict - Dictionary to search.
 * @param key - Dotted key.
 * @returns The string, or `undefined` if the key does not lead to a string.
 */
export function lookup(dict: Dictionary, key: string): string | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Replaces `{{name}}` placeholders. Unknown placeholders are left visible so that
 * a missing parameter is noticed during testing instead of silently vanishing.
 * @param template - Translated string.
 * @param params - Values to substitute.
 */
export function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/**
 * Builds a translate function over a primary dictionary with a fallback one.
 * A missing key returns the key itself, which makes gaps obvious on screen.
 * @param dict - Dictionary of the active locale.
 * @param fallback - Dictionary used when `dict` lacks a key (usually English).
 */
export function createTranslator(
  dict: Dictionary,
  fallback?: Dictionary,
): (key: TranslationKey, params?: TranslationParams) => string {
  return (key, params) => interpolate(lookup(dict, key) ?? (fallback && lookup(fallback, key)) ?? key, params);
}
