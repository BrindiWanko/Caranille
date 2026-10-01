/**
 * @file Database tests: schema normalisation, experience curve, database API
 * (permissions, create / save / delete, system settings, export / import),
 * inventory rules, and the step criterion: an item created in the editor is
 * immediately usable in game.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { SchemaError, defaultRecord, normalizeRecord } from '../shared/database-schema.js';
import { expForLevel, type ItemData } from '../shared/database.js';
import { Cmd, Priority, Trigger, createPage } from '../shared/events.js';
import type { ClientToServerEvents, EnterWorldPayload, InventoryPayload, ServerToClientEvents } from '../shared/protocol.js';
import { importDatabase } from '../server/importers/database.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

test('records are normalised: missing fields filled, values clamped, garbage refused', () => {
  const item = normalizeRecord('item', { name: 'X'.repeat(500), price: 1e12, occasion: 'sometimes', effects: [{ kind: 'recover_hp', value: '25', percent: 150 }] }, 3);
  assert.equal(item.id, 3);
  assert.equal(item.name.length, 100);
  assert.equal(item.price, 9_999_999);
  assert.equal(item.occasion, 'always');
  assert.deepEqual(item.effects, [{ kind: 'recover_hp', value: 25, percent: 100 }]);
  assert.equal(item.damage.type, 'none');
  assert.throws(() => normalizeRecord('item', { price: 'lots' }, 1), SchemaError);
  const cls = defaultRecord('class', 9);
  assert.equal(cls.params.mhp.base >= 1, true);
  assert.deepEqual(cls.learnings, []);
  assert.equal(expForLevel({ expBase: 30, expGrowth: 25 }, 1), 0);
  assert.equal(expForLevel({ expBase: 30, expGrowth: 25 }, 3), 30 + 38);
});

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

async function account(name: string) {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: name,
    email: `${name.toLowerCase()}@example.com`,
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  const csrf = await client.csrf('/characters');
  const api = async <T>(method: string, path: string, body?: unknown) => {
    const res = await client.request(`/api/editor${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { client, api };
}

async function enter(client: TestClient, name: string) {
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const html = await (await client.request('/characters')).text();
  const id = /action="\/characters\/(\d+)\/play"/.exec(html)![1]!;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const inventories: InventoryPayload[] = [];
  socket.on('inventory', (inv) => inventories.push(inv));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, payload, inventories };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('default content is seeded and old records are completed on read', () => {
  assert.ok(server.ctx.gameData.list('item').some((i) => i.name === 'Potion'));
  assert.ok(server.ctx.gameData.list('enemy').length >= 6);
  // A class stored without the newer fields still reads with complete defaults.
  server.ctx.db.prepare("UPDATE game_data SET data = json_remove(data, '$.learnings', '$.expBase') WHERE type = 'class' AND id = 1").run();
  server.ctx.gameData.save('class', { ...server.ctx.gameData.get('class', 1)! });
  const cls = server.ctx.gameData.get('class', 1)!;
  assert.ok(Array.isArray(cls.learnings));
});

let admin: Awaited<ReturnType<typeof account>>;

test('the database API: permissions, create, save, delete, system settings', async () => {
  admin = await account('DbAdmin');
  const player = await account('DbPlayer');
  assert.equal((await player.api('GET', '/db/item')).status, 403);

  const created = await admin.api<{ record: ItemData }>('POST', '/db/item', {});
  assert.equal(created.status, 200);
  const id = created.body.record.id;
  const saved = await admin.api<{ record: ItemData }>('PUT', `/db/item/${id}`, {
    record: { ...created.body.record, name: 'Super potion', effects: [{ kind: 'recover_hp', value: 100, percent: 0 }] },
  });
  assert.equal(saved.body.record.name, 'Super potion');
  assert.equal(server.ctx.gameData.get('item', id)?.name, 'Super potion', 'visible to the game at once');
  const bad = await admin.api<{ error: string }>('PUT', `/db/item/${id}`, { record: { price: 'many' } });
  assert.equal(bad.body.error, 'error.db.invalid_field');

  const dup = await admin.api<{ record: ItemData }>('POST', '/db/item', { copyOf: id });
  assert.equal(dup.body.record.name, 'Super potion (2)');
  assert.equal((await admin.api('DELETE', `/db/item/${dup.body.record.id}`)).status, 200);

  const sys = await admin.api<{ system: { currencyName: string; elements: string[] } }>('PUT', '/system', { system: { currencyName: 'Écus', elements: ['—', 'Feu'] } });
  assert.equal(sys.body.system.currencyName, 'Écus');
  assert.deepEqual(sys.body.system.elements, ['—', 'Feu']);
});

test('database export and import round trip; invalid exports are refused', async () => {
  const exported = await admin.api<{ version: number; database: Record<string, unknown[]> }>('GET', '/db-export');
  assert.equal(exported.body.version, 1);
  const itemCount = exported.body.database.item!.length;
  (exported.body.database.item as { name: string }[])[0]!.name = 'Potion importée';
  const imported = await admin.api<{ ok: boolean }>('POST', '/db-import', exported.body);
  assert.equal(imported.status, 200);
  assert.equal(server.ctx.gameData.list('item').length, itemCount);
  assert.equal(server.ctx.gameData.get('item', 1)?.name, 'Potion importée');
  assert.equal((await admin.api('POST', '/db-import', { version: 99 })).status, 400);
  assert.equal((await admin.api('POST', '/db-import', { version: 1, database: { class: [] } })).status, 400, 'at least one class');
});

test('an item created in the editor is immediately usable in game (chest → bag → use)', async () => {
  const created = await admin.api<{ record: ItemData }>('POST', '/db/item', {});
  const id = created.body.record.id;
  await admin.api('PUT', `/db/item/${id}`, { record: { ...created.body.record, name: 'Tisane', effects: [{ kind: 'recover_hp', value: 30, percent: 0 }] } });

  // A chest giving the item, placed on the village with the editor API.
  await admin.api('POST', '/maps/1/lock');
  const village = (await admin.api<{ map: import('../shared/map.js').MapData }>('GET', '/maps/1')).body.map;
  village.events.push({
    id: village.events.length, name: 'Coffre', note: '', x: 18, y: 12,
    pages: [createPage({ priorityType: Priority.Same, trigger: Trigger.Action, list: [{ code: Cmd.ChangeItems, indent: 0, parameters: [id, 0, 0, 2] }, { code: Cmd.ChangeGold, indent: 0, parameters: [0, 0, 15] }, { code: 0, indent: 0, parameters: [] }] })],
  });
  assert.equal((await admin.api('PUT', '/maps/1', { map: village })).status, 200);

  const { socket, payload, inventories } = await enter(admin.client, 'Healer');
  await wait(100);
  assert.equal(inventories[0]?.gold, server.ctx.settings.get('startingGold', 0), 'starting gold');
  const p = server.ctx.world.player(payload.character.id)!;
  p.x = 18;
  p.y = 13;
  const notes: string[] = [];
  socket.on('notify', (n) => notes.push(n.key));
  socket.emit('turn', 8);
  await wait(50);
  socket.emit('action');
  await wait(200);
  const inv = inventories.at(-1)!;
  assert.equal(inv.entries.find((e) => e.id === id)?.quantity, 2);
  assert.equal(inv.entries.find((e) => e.id === id)?.usable, true);
  assert.ok(notes.includes('notify.item_gained') && notes.includes('notify.gold_gained'));

  // Use it while hurt: HP goes up, one is consumed.
  p.hp = 10;
  const updated = new Promise<{ hp?: number }>((resolve) => socket.on('playerUpdate', (u) => u.hp !== undefined && resolve(u)));
  socket.emit('useItem', id);
  assert.equal((await updated).hp, 40);
  await wait(100);
  assert.equal(inventories.at(-1)!.entries.find((e) => e.id === id)?.quantity, 1);

  // A key item cannot be used; a full-health character does not waste potions.
  server.ctx.world.changeItems(p, 'item', 6, 1);
  socket.emit('useItem', 6);
  p.hp = 9999;
  socket.emit('useItem', id);
  await wait(150);
  assert.ok(notes.includes('error.item.not_usable'));
  assert.ok(notes.includes('error.item.no_effect'));
  assert.equal(server.ctx.inventory.quantity(p.characterId, 'item', id), 1);
  socket.close();
});

test('external database files are imported under new ids with references remapped', () => {
  const files: Record<string, unknown> = {
    States: [null, { id: 1, name: 'Sommeil', iconIndex: 5, restriction: 4, minTurns: 2 }],
    Skills: [null, { id: 1, name: 'Berceuse', mpCost: 4, scope: 1, damage: { type: 0, formula: '0' }, effects: [{ code: 21, dataId: 1, value1: 0.5 }] }],
    Items: [null, { id: 1, name: 'Tonique', itypeId: 1, occasion: 0, scope: 7, effects: [{ code: 11, value1: 0.2, value2: 10 }] }],
    Enemies: [null, { id: 1, name: 'Rat', battlerName: 'Rat', params: [30, 0, 5, 3, 1, 1, 6, 4], exp: 3, gold: 2, dropItems: [{ kind: 1, dataId: 1, denominator: 4 }], actions: [{ skillId: 1, rating: 5 }] }],
    Classes: [null, { id: 1, name: 'Barde', params: Array.from({ length: 8 }, () => Array.from({ length: 100 }, (_, l) => 10 + l)), learnings: [{ level: 2, skillId: 1 }], expParams: [25, 30, 30, 30] }],
  };
  const warnings: { key: string }[] = [];
  const counts = importDatabase(server.ctx, (name) => files[name], warnings);
  assert.deepEqual(counts, { state: 1, skill: 1, item: 1, enemy: 1, class: 1 });
  const skill = server.ctx.gameData.list('skill').find((s) => s.name === 'Berceuse')!;
  const state = server.ctx.gameData.list('state').find((s) => s.name === 'Sommeil')!;
  assert.deepEqual(skill.effects[0], { kind: 'add_state', value: state.id, percent: 50 });
  const tonic = server.ctx.gameData.list('item').find((i) => i.name === 'Tonique')!;
  assert.deepEqual(tonic.effects[0], { kind: 'recover_hp', value: 10, percent: 20 });
  const rat = server.ctx.gameData.list('enemy').find((e) => e.name === 'Rat')!;
  assert.deepEqual(rat.drops[0], { kind: 'item', id: tonic.id, chance: 25 });
  assert.equal(rat.actions[0]!.skillId, skill.id);
  const bard = server.ctx.gameData.list('class').find((c) => c.name === 'Barde')!;
  assert.equal(bard.params.atk.base, 11);
  assert.equal(bard.learnings[0]!.skillId, skill.id);
  assert.ok(warnings.some((w) => w.key === 'import.warning.enemy_sprite'));
});
