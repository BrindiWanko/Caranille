/**
 * @file Browser-side translations.
 *
 * Pages embed the active dictionary in `<script id="i18n-data">` (rendered by the
 * server), so `t()` works synchronously from the first line of client code. The
 * English dictionary is fetched lazily as a fallback only if a key is missing.
 * `setLocale()` switches language at runtime: it asks the server to remember the
 * choice (cookie + account) and loads the new dictionary.
 *
 * Every interface string of the client must go through `t()`.
 */
import {
  DEFAULT_LOCALE,
  createTranslator,
  isLocale,
  type Dictionary,
  type Locale,
  type TranslationKey,
  type TranslationParams,
} from '../shared/i18n.js';

let currentLocale: Locale = DEFAULT_LOCALE;
let dictionary: Dictionary = {};
let translate = createTranslator(dictionary);
const listeners = new Set<(locale: Locale) => void>();

/** Reads the dictionary embedded by the server in the page. */
function readEmbedded(): void {
  const el = document.getElementById('i18n-data');
  if (!el) return;
  const locale = el.dataset.locale;
  if (isLocale(locale)) currentLocale = locale;
  try {
    dictionary = JSON.parse(el.textContent ?? '{}') as Dictionary;
  } catch {
    dictionary = {};
  }
  translate = createTranslator(dictionary);
}
readEmbedded();

/**
 * Translates an interface key.
 * @param key - Dotted translation key (type-checked against `locales/en.json`).
 * @param params - Values for `{{name}}` placeholders.
 * @returns The translated string, or the key itself when missing.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  return translate(key, params);
}

/**
 * Translates a key that is only known at runtime (e.g. an error key sent by the server).
 * Unknown keys are returned unchanged.
 * @param key - Untrusted key string.
 * @param params - Placeholder values.
 */
export function tDynamic(key: string, params?: TranslationParams): string {
  return translate(key as TranslationKey, params);
}

/** Returns the active locale. */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Registers a callback run after every language change (to re-render windows).
 * @returns A function that unregisters the callback.
 */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function fetchDictionary(locale: Locale): Promise<Dictionary> {
  const response = await fetch(`/locales/${locale}.json`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Cannot load dictionary "${locale}" (${response.status})`);
  return (await response.json()) as Dictionary;
}

/**
 * Switches the interface language without reloading the page.
 * @param locale - New locale.
 */
export async function setLocale(locale: Locale): Promise<void> {
  const [dict, fallback] = await Promise.all([
    fetchDictionary(locale),
    locale === DEFAULT_LOCALE ? Promise.resolve(undefined) : fetchDictionary(DEFAULT_LOCALE),
  ]);
  // Persist the choice server-side (cookie, and account when logged in).
  await fetch(`/lang/${locale}?next=/healthz`, { credentials: 'same-origin', redirect: 'manual' });
  currentLocale = locale;
  dictionary = dict;
  translate = createTranslator(dict, fallback);
  document.documentElement.lang = locale;
  for (const listener of listeners) listener(locale);
}
