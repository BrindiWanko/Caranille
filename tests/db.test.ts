/**
 * @file Tests of the storage foundations: pragmas, migrations bookkeeping,
 * idempotent seed and the settings repository.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../server/db/database.js';
import { listMigrations, migrate } from '../server/db/migrate.js';
import { seed } from '../server/db/seed.js';
import { SettingsRepository } from '../server/db/settings.js';
import { PATHS } from '../server/paths.js';
import { DEFAULT_SETTINGS } from '../shared/settings.js';

test('migrations apply once and are recorded', () => {
  const db = openDatabase(':memory:');
  const first = migrate(db, PATHS.migrations);
  assert.deepEqual(first, listMigrations(PATHS.migrations).map((m) => m.version));
  assert.deepEqual(migrate(db, PATHS.migrations), [], 'second run applies nothing');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('seed fills defaults without overwriting edited values', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db);
  const settings = new SettingsRepository(db);
  assert.equal(settings.get('gameTitle', ''), DEFAULT_SETTINGS.gameTitle);
  settings.set('gameTitle', 'My World');
  seed(db);
  assert.equal(settings.get('gameTitle', ''), 'My World');
});

test('secrets are generated once and stable', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  const settings = new SettingsRepository(db);
  const a = settings.secret('session');
  assert.ok(a.length >= 32);
  assert.equal(settings.secret('session'), a);
});
