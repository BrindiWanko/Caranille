/**
 * @file Tests of the shared translation primitives: locale negotiation, key
 * lookup, interpolation and fallback.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranslator, interpolate, lookup, negotiateLocale } from '../shared/i18n.js';

test('negotiateLocale honours q-weights and region subtags', () => {
  assert.equal(negotiateLocale('fr-FR,fr;q=0.9,en;q=0.8'), 'fr');
  assert.equal(negotiateLocale('de-DE,en;q=0.5,fr;q=0.7'), 'fr');
  assert.equal(negotiateLocale('de,es'), 'en');
  assert.equal(negotiateLocale(undefined), 'en');
});

test('lookup resolves dotted keys to strings only', () => {
  const dict = { a: { b: 'x', c: { d: 'y' } } };
  assert.equal(lookup(dict, 'a.b'), 'x');
  assert.equal(lookup(dict, 'a.c.d'), 'y');
  assert.equal(lookup(dict, 'a.c'), undefined);
  assert.equal(lookup(dict, 'a.b.z'), undefined);
});

test('interpolate replaces known placeholders and keeps unknown ones', () => {
  assert.equal(interpolate('Hi {{name}}, {{ n }} new', { name: 'Ana', n: 3 }), 'Hi Ana, 3 new');
  assert.equal(interpolate('Hi {{who}}', { name: 'Ana' }), 'Hi {{who}}');
});

test('translator falls back to the secondary dictionary, then to the key', () => {
  const t = createTranslator({ site: { login: 'Connexion' } }, { site: { login: 'Log in', register: 'Sign up' } });
  assert.equal(t('site.login'), 'Connexion');
  assert.equal(t('site.register'), 'Sign up');
  assert.equal(t('common.loading'), 'common.loading');
});

test('translation keys are type-checked against the English dictionary', () => {
  const t = createTranslator({});
  // @ts-expect-error - unknown keys must be rejected at compile time.
  assert.equal(t('site.this_key_does_not_exist'), 'site.this_key_does_not_exist');
});
