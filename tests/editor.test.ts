/**
 * @file Map editor tests: painting rules (automatic layers, stacking, fill,
 * undo data, shadows, clipboard) and the editor API (permissions, CSRF, locks,
 * validation, live update, versions, and the full "new map + teleporter" flow).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { MapEditor, applyChanges, autoLayer, pickTile } from '../client/editor/edit-ops.js';
import { Cmd, Priority, Trigger, createPage } from '../shared/events.js';
import { createMap, tileAt, type MapData, type MapInfo } from '../shared/map.js';
import type { ClientToServerEvents, EnterWorldPayload, MapChangePayload, MapPayload, ServerToClientEvents } from '../shared/protocol.js';
import { TILE_ID_A1, TILE_ID_A2, autotileShape, plainTileId } from '../shared/tiles.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

const GRASS = TILE_ID_A2; // A2 base kind 16
const PATH = TILE_ID_A2 + 4 * 48; // A2 overlay kind 20
const WATER = TILE_ID_A1; // A1 kind 0
const TREE = plainTileId(0, 0, 3);
const FLOWER = plainTileId(0, 0, 1);

test('automatic layers: grounds on 0, overlays on 1, objects on 2 then 3', () => {
  assert.equal(autoLayer(GRASS), 0);
  assert.equal(autoLayer(WATER), 0);
  assert.equal(autoLayer(PATH), 1);
  assert.equal(autoLayer(TREE), 2);
  const map = createMap(4, 4, 1);
  const ed = new MapEditor(map);
  ed.placeTile(1, 1, GRASS);
  ed.placeTile(1, 1, PATH);
  ed.placeTile(1, 1, TREE);
  ed.placeTile(1, 1, FLOWER);
  assert.deepEqual([0, 1, 2, 3].map((z) => tileAt(map, 1, 1, z)), [GRASS, PATH, TREE, FLOWER]);
  ed.placeTile(1, 1, WATER);
  assert.equal(tileAt(map, 1, 1, 1), 0, 'a new ground removes the overlay');
  ed.placeTile(1, 1, 0);
  assert.deepEqual([tileAt(map, 1, 1, 2), tileAt(map, 1, 1, 3)], [0, 0], 'the empty tile clears objects');
});

test('painting records changes that undo and redo exactly, autotile shapes included', () => {
  const map = createMap(5, 5, 1);
  const ed = new MapEditor(map);
  ed.rectangle(0, 0, 4, 4, { tiles: [[GRASS]] });
  ed.commit();
  const snapshot = [...map.data];
  ed.rectangle(1, 1, 3, 3, { tiles: [[WATER]] });
  const changes = ed.commit();
  assert.equal(autotileShape(tileAt(map, 2, 2, 0)), 0, 'centre of the pond');
  assert.notEqual(autotileShape(tileAt(map, 1, 1, 0)), 0, 'pond corner has an edge shape');
  const painted = [...map.data];
  applyChanges(map, changes, true);
  assert.deepEqual(map.data, snapshot);
  applyChanges(map, changes, false);
  assert.deepEqual(map.data, painted);
});

test('fill stops at different tiles; eyedropper returns autotile kinds; shadows and clipboard', () => {
  const map = createMap(6, 3, 1);
  const ed = new MapEditor(map);
  ed.rectangle(0, 0, 5, 2, { tiles: [[GRASS]] });
  ed.rectangle(3, 0, 3, 2, { tiles: [[WATER]] });
  ed.commit();
  ed.fill(0, 0, { tiles: [[PATH]] });
  ed.commit();
  assert.ok(tileAt(map, 2, 1, 1) !== 0, 'overlay fill covers the grass area');
  assert.equal(tileAt(map, 4, 1, 1), 0, 'but does not cross the pond');
  assert.equal(tileAt(map, 3, 1, 1), 0, 'nor cover the water');
  assert.equal(pickTile(map, 3, 1), WATER, 'eyedropper gives the kind, not the shape');
  ed.shadow(0, 0, 3, true);
  ed.commit();
  assert.equal(tileAt(map, 0, 0, 4), 8);
  const clip = ed.copy(3, 0, 3, 2);
  ed.paste(0, 0, clip);
  ed.commit();
  assert.equal(pickTile(map, 0, 1), WATER);
});

// --- API --------------------------------------------------------------------------

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Session {
  client: TestClient;
  csrf: string;
  api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
}

async function account(name: string): Promise<Session> {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: name,
    email: `${name.toLowerCase()}@example.com`,
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  const csrf = await client.csrf('/characters');
  return {
    client,
    csrf,
    async api<T>(method: string, path: string, body?: unknown) {
      const res = await client.request(`/api/editor${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as T };
    },
  };
}

async function enter(session: Session, name: string): Promise<{ socket: ClientSocket; payload: EnterWorldPayload }> {
  await session.client.post('/characters', { _csrf: await session.client.csrf('/characters/new'), name, classId: '1' });
  const html = await (await session.client.request('/characters')).text();
  const id = /action="\/characters\/(\d+)\/play"/.exec(html)![1]!;
  await session.client.post(`/characters/${id}/play`, { _csrf: await session.client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: session.client.cookieHeader() } });
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, payload };
}

let admin: Session;

test('the editor API is reserved to administrators and requires the CSRF header', async () => {
  admin = await account('Admin');
  const player = await account('Player');
  assert.equal((await player.api('GET', '/bootstrap')).status, 403);
  assert.equal((await admin.api('GET', '/bootstrap')).status, 200);
  const noToken = await admin.client.request('/api/editor/maps/1/lock', { method: 'POST' });
  assert.equal(noToken.status, 403);
});

test('locks, validation, live update of players and version history', async () => {
  const second = await account('Second');
  server.ctx.accounts.setRole(server.ctx.accounts.findByUsername('Second')!.id, 'admin');
  const player = await account('Watcher');
  const { socket } = await enter(player, 'Watcher');

  assert.equal((await admin.api('POST', '/maps/1/lock')).status, 200);
  const conflict = await second.api<{ error: string; params: { name: string } }>('POST', '/maps/1/lock');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.params.name, 'Admin');

  const { body } = await admin.api<{ map: MapData }>('GET', '/maps/1');
  const bad = await admin.api<{ error: string }>('PUT', '/maps/1', { map: { ...body.map, data: [1, 2, 3] } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'error.editor.invalid_map');
  assert.equal((await second.api('PUT', '/maps/1', { map: body.map })).status, 409, 'saving needs the lock');

  const updated = new Promise<MapPayload>((resolve) => socket.on('mapUpdated', resolve));
  const edited = { ...body.map, displayName: 'Village rénové' };
  assert.equal((await admin.api('PUT', '/maps/1', { map: edited })).status, 200);
  assert.equal((await updated).map.displayName, 'Village rénové', 'players on the map receive the new version');

  const versions = await admin.api<{ versions: { id: number }[] }>('GET', '/maps/1/versions');
  assert.ok(versions.body.versions.length >= 1);
  socket.close();
  await admin.api('DELETE', '/maps/1/lock');
});

test('an admin creates a map, draws it, places a teleporter, and a player goes there at once', async () => {
  const created = await admin.api<{ info: MapInfo; map: MapData }>('POST', '/maps', { name: 'Clairière', width: 12, height: 10, tilesetId: 1, parentId: 0 });
  assert.equal(created.status, 200);
  const newId = created.body.info.id;
  assert.equal(tileAt(created.body.map, 5, 5, 0) >= TILE_ID_A2, true, 'new maps start with a ground');

  // Draw a pond and a return teleporter on the new map.
  assert.equal((await admin.api('POST', `/maps/${newId}/lock`)).status, 200);
  const map = created.body.map;
  const ed = new MapEditor(map);
  ed.rectangle(7, 1, 10, 4, { tiles: [[WATER]] });
  ed.commit();
  map.events = [null, {
    id: 1, name: 'Retour', note: '', x: 5, y: 9,
    pages: [createPage({ priorityType: Priority.Below, trigger: Trigger.PlayerTouch, list: [{ code: Cmd.TransferPlayer, indent: 0, parameters: [0, 1, 20, 17, 2, 0] }, { code: 0, indent: 0, parameters: [] }] })],
  }];
  assert.equal((await admin.api('PUT', `/maps/${newId}`, { map })).status, 200);

  // Place a teleporter on the village plaza towards the new map.
  await admin.api('POST', '/maps/1/lock');
  const village = (await admin.api<{ map: MapData }>('GET', '/maps/1')).body.map;
  village.events.push({
    id: village.events.length, name: 'Vers la clairière', note: '', x: 18, y: 12,
    pages: [createPage({ priorityType: Priority.Below, trigger: Trigger.PlayerTouch, list: [{ code: Cmd.TransferPlayer, indent: 0, parameters: [0, newId, 5, 8, 8, 0] }, { code: 0, indent: 0, parameters: [] }] })],
  });
  assert.equal((await admin.api('PUT', '/maps/1', { map: village })).status, 200);

  // A player already in the village walks onto the new teleporter.
  const traveller = await account('Traveller');
  const { socket, payload } = await enter(traveller, 'Traveller');
  const p = server.ctx.world.player(payload.character.id)!;
  p.x = 18;
  p.y = 13;
  const changed = new Promise<MapChangePayload>((resolve) => socket.on('mapChange', resolve));
  socket.emit('move', 8, 0);
  const change = await changed;
  assert.equal(change.map.id, newId);
  assert.equal(change.map.displayName, 'Clairière');
  assert.deepEqual([change.x, change.y], [5, 8]);
  assert.ok(tileAt(change.map, 8, 2, 0) >= TILE_ID_A1 && tileAt(change.map, 8, 2, 0) < TILE_ID_A2, 'the drawn pond is there');
  socket.close();
});

test('maps can be deleted, except the starting map', async () => {
  const start = await admin.api<{ error: string }>('DELETE', '/maps/1');
  assert.equal(start.body.error, 'error.editor.delete_start_map');
  const tmp = await admin.api<{ info: MapInfo }>('POST', '/maps', { name: 'Temp', width: 5, height: 5, tilesetId: 1 });
  assert.equal((await admin.api('DELETE', `/maps/${tmp.body.info.id}`)).status, 200);
  assert.equal(server.ctx.maps.get(tmp.body.info.id), undefined);
});
