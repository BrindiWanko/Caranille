/**
 * @file Tests of accounts and authentication: validation, first-admin rule,
 * duplicates, login, brute-force throttling and bans.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthService, isBanned } from '../server/auth/service.js';
import { LoginThrottle } from '../server/auth/throttle.js';
import { AccountRepository } from '../server/db/accounts.js';
import { openDatabase } from '../server/db/database.js';
import { migrate } from '../server/db/migrate.js';
import { PATHS } from '../server/paths.js';
import { validateRegistration } from '../shared/accounts.js';

function setup(throttle = new LoginThrottle()) {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  const accounts = new AccountRepository(db);
  return { db, accounts, auth: new AuthService(accounts, 4, throttle) };
}

const input = (username: string, email = `${username}@example.com`) => ({
  username,
  email,
  password: 'correct horse',
  passwordConfirm: 'correct horse',
});

test('registration validation returns translation keys', () => {
  assert.equal(validateRegistration(input('ab')), 'error.auth.username_invalid');
  assert.equal(validateRegistration(input('1abc')), 'error.auth.username_invalid');
  assert.equal(validateRegistration({ ...input('alice'), email: 'nope' }), 'error.auth.email_invalid');
  assert.equal(validateRegistration({ ...input('alice'), password: 'short', passwordConfirm: 'short' }), 'error.auth.password_too_short');
  const long = 'é'.repeat(40); // 80 bytes in UTF-8
  assert.equal(validateRegistration({ ...input('alice'), password: long, passwordConfirm: long }), 'error.auth.password_too_long');
  assert.equal(validateRegistration({ ...input('alice'), passwordConfirm: 'other pass' }), 'error.auth.password_mismatch');
  assert.equal(validateRegistration(input('alice')), null);
});

test('the first account is admin, the next ones are players', async () => {
  const { auth } = setup();
  const first = await auth.register(input('Alice'), 'fr');
  const second = await auth.register(input('Bob'), 'en');
  assert.ok(first.ok && second.ok);
  assert.equal(first.account.role, 'admin');
  assert.equal(first.account.locale, 'fr');
  assert.equal(second.account.role, 'player');
});

test('simultaneous first registrations produce exactly one admin', async () => {
  const { auth, accounts } = setup();
  const results = await Promise.all(['Ann', 'Ben', 'Cid', 'Dee'].map((name) => auth.register(input(name), 'en')));
  assert.ok(results.every((r) => r.ok));
  const admins = ['Ann', 'Ben', 'Cid', 'Dee'].filter((n) => accounts.findByUsername(n)?.role === 'admin');
  assert.equal(admins.length, 1);
});

test('usernames and e-mails are unique regardless of case', async () => {
  const { auth } = setup();
  await auth.register(input('Alice'), 'en');
  const sameName = await auth.register(input('alice', 'other@example.com'), 'en');
  const sameMail = await auth.register(input('Alicia', 'ALICE@example.com'), 'en');
  assert.deepEqual(sameName, { ok: false, errorKey: 'error.auth.username_taken' });
  assert.deepEqual(sameMail, { ok: false, errorKey: 'error.auth.email_taken' });
});

test('login accepts valid credentials case-insensitively and rejects wrong ones', async () => {
  const { auth } = setup();
  await auth.register(input('Alice'), 'en');
  const ok = await auth.login('alice', 'correct horse', '1.1.1.1');
  assert.ok(ok.ok);
  assert.ok(ok.account.lastLogin !== undefined);
  assert.deepEqual(await auth.login('Alice', 'wrong password', '1.1.1.1'), { ok: false, errorKey: 'error.auth.invalid_credentials' });
  assert.deepEqual(await auth.login('Nobody', 'correct horse', '1.1.1.1'), { ok: false, errorKey: 'error.auth.invalid_credentials' });
});

test('repeated failures lock the account and the address with escalating delays', async () => {
  let now = 1_000_000;
  const throttle = new LoginThrottle({ maxFailures: 3, lockMs: 1000 }, () => now);
  const { auth } = setup(throttle);
  await auth.register(input('Alice'), 'en');
  for (let i = 0; i < 3; i++) await auth.login('Alice', 'bad password', '2.2.2.2');
  const locked = await auth.login('Alice', 'correct horse', '3.3.3.3');
  assert.equal(locked.ok, false);
  assert.equal(!locked.ok && locked.errorKey, 'error.auth.too_many_attempts');
  now += 1001;
  assert.ok((await auth.login('Alice', 'correct horse', '3.3.3.3')).ok, 'unlocked after the delay');
  // Second lock lasts twice as long.
  for (let i = 0; i < 3; i++) throttle.fail('user:bob');
  assert.equal(throttle.lockedFor('user:bob'), 1000);
  now += 1001;
  for (let i = 0; i < 3; i++) throttle.fail('user:bob');
  assert.equal(throttle.lockedFor('user:bob'), 2000);
});

test('banned accounts cannot log in until the ban expires', async () => {
  const { auth, db, accounts } = setup();
  await auth.register(input('Alice'), 'en');
  db.prepare("UPDATE accounts SET banned_until = datetime('now', '+1 day') WHERE username = 'Alice'").run();
  const result = await auth.login('Alice', 'correct horse', '4.4.4.4');
  assert.equal(!result.ok && result.errorKey, 'error.auth.banned');
  db.prepare("UPDATE accounts SET banned_until = datetime('now', '-1 minute') WHERE username = 'Alice'").run();
  assert.equal(isBanned(accounts.findByUsername('Alice')!), false);
  assert.ok((await auth.login('Alice', 'correct horse', '4.4.4.4')).ok);
});
