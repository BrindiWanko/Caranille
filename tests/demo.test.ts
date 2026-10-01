/**
 * @file Demonstration content: the starting world contains a village, a
 * forest, a house, an instanced dungeon with a raid boss and the chapter 1
 * quest chain, all valid; and it survives a JSON export / import round trip
 * (maps with their engine block, database records).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { checkStructure } from '../shared/command-blocks.js';
import { normalizeRecord } from '../shared/database-schema.js';
import { DATABASE_TYPES } from '../shared/database.js';
import { validateMap } from '../shared/map-validation.js';
import { DEMO_MAPS } from '../server/db/demo-map.js';
import { convertMap, exportMap } from '../server/importers/project.js';
import { startTestServer, type TestServer } from './helpers/server.js';

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

test('the demo world: village, forest, house, instanced dungeon with a raid, a quest chain', () => {
  const ctx = server.ctx;
  const names = ctx.maps.infos().map((i) => i.id).sort();
  assert.deepEqual(names, [DEMO_MAPS.village, DEMO_MAPS.forest, DEMO_MAPS.house, DEMO_MAPS.dungeon]);
  for (const id of names) {
    const map = ctx.maps.get(id)!;
    assert.equal(validateMap(map, (t) => ctx.gameData.get('tileset', t) !== undefined), null, `map ${id}`);
    for (const e of map.events) for (const page of e?.pages ?? []) assert.equal(checkStructure(page.list), null, `${id}/${e!.name}`);
    for (const s of map.mmo.spawns ?? []) assert.ok(ctx.gameData.get('enemy', s.enemyId), `enemy ${s.enemyId} of map ${id}`);
  }
  assert.equal(ctx.maps.get(DEMO_MAPS.dungeon)!.mmo.instance, true);
  const raid = ctx.gameData.get('raid', 1)!;
  assert.equal(raid.mapId, DEMO_MAPS.dungeon);
  assert.ok(ctx.maps.get(DEMO_MAPS.dungeon)!.mmo.spawns!.some((s) => s.enemyId === raid.bossEnemyId), 'the boss appears in the dungeon');
  // The chain: each quest of chapter 1 requires the previous one.
  const chapter = ctx.gameData.list('quest').filter((q) => q.category.startsWith('Chapitre 1'));
  assert.deepEqual(chapter.map((q) => q.id), [2, 3, 4]);
  assert.deepEqual(chapter.map((q) => q.prerequisite), [0, 2, 3]);
});

test('the demo survives a JSON export and import', () => {
  const ctx = server.ctx;
  for (const info of ctx.maps.infos()) {
    const original = ctx.maps.get(info.id)!;
    const json = JSON.parse(JSON.stringify(exportMap(original))) as Record<string, unknown>;
    const back = convertMap(json, original.tilesetId, (id) => id, new Map());
    assert.deepEqual(back.mmo, original.mmo, `engine block of map ${info.id}`);
    assert.deepEqual(back.data, original.data);
    assert.equal(back.events.filter(Boolean).length, original.events.filter(Boolean).length);
  }
  for (const type of DATABASE_TYPES) {
    for (const record of ctx.gameData.list(type)) {
      const copy = normalizeRecord(type, JSON.parse(JSON.stringify(record)), record.id);
      assert.deepEqual(copy, record, `${type} ${record.id}`);
    }
  }
});
