/**
 * @file Tests of the storage foundations: pragmas, migrations bookkeeping,
 * idempotent seed (including default tilesets added later) and the settings
 * repository.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../server/db/database.js';
import { GameDataRepository } from '../server/db/game-data.js';
import { listMigrations, migrate } from '../server/db/migrate.js';
import { seed } from '../server/db/seed.js';
import { SettingsRepository } from '../server/db/settings.js';
import { PATHS } from '../server/paths.js';
import { DEFAULT_SETTINGS } from '../shared/settings.js';
import { TILE_ID_C, TILE_ID_D } from '../shared/tiles.js';

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

test('new default tilesets and sheets reach older databases once', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db);
  const data = new GameDataRepository(db);
  const settings = new SettingsRepository(db);
  const byName = (name: string) => data.list('tileset').find((t) => t.name === name);
  assert.ok(byName('Jungle') && byName('Sea'), 'biome tilesets are seeded');
  assert.equal(byName('Inside')!.tilesetNames[6], 'Inside_C');

  // A database created before the biomes and the furniture sheet.
  const inside = byName('Inside')!;
  const furnitureFlags = inside.flags.slice(TILE_ID_C, TILE_ID_D);
  data.save('tileset', { ...inside, tilesetNames: inside.tilesetNames.map((n, i) => (i === 6 ? '' : n)), flags: inside.flags.map((f, i) => (i >= TILE_ID_C && i < TILE_ID_D ? 0 : f)) });
  data.remove('tileset', byName('Jungle')!.id);
  settings.set('seededTilesets', []);
  seed(db);
  assert.ok(byName('Jungle'), 'the missing biome is added');
  assert.equal(byName('Inside')!.tilesetNames[6], 'Inside_C', 'the furniture sheet fills the empty slot');
  assert.deepEqual(byName('Inside')!.flags.slice(TILE_ID_C, TILE_ID_D), furnitureFlags);

  // Once offered, a deleted tileset stays deleted.
  data.remove('tileset', byName('Jungle')!.id);
  seed(db);
  assert.equal(byName('Jungle'), undefined);
});
