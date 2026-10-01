/**
 * @file Map rules and world tests: passability (layers, star tiles,
 * directional bits), A* pathfinding, autotile refresh, message code parsing,
 * and the server-side movement validation / dialogue flow over a socket.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { refreshAllAutotiles } from '../shared/autotile-shapes.js';
import { createMap, setTileAt, tileAt } from '../shared/map.js';
import { canMove, checkPassage, findPath, setPassageOverride } from '../shared/passability.js';
import { resizeMap, validateMap } from '../shared/map-validation.js';
import type { ClientToServerEvents, EnterWorldPayload, MessagePayload, ServerToClientEvents } from '../shared/protocol.js';
import { FLAG_BLOCK_DOWN, FLAG_IMPASSABLE, FLAG_STAR, TILE_ID_A2, autotileShape } from '../shared/tiles.js';
import { parseMessage } from '../client/ui/text-codes.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

const GROUND = TILE_ID_A2;
const WALL = 5; // B tile used as an obstacle
const STAR_TILE = 6;
const ONE_WAY = 7; // cannot be left downwards

function smallMap() {
  const map = createMap(6, 5, 1);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) setTileAt(map, x, y, 0, GROUND);
  const flags = new Array<number>(8192).fill(0);
  flags[0] = FLAG_STAR;
  flags[WALL] = FLAG_IMPASSABLE;
  flags[STAR_TILE] = FLAG_STAR | FLAG_IMPASSABLE;
  flags[ONE_WAY] = FLAG_BLOCK_DOWN;
  return { map, flags };
}

test('passability: impassable tiles block, star tiles are ignored, direction bits apply', () => {
  const { map, flags } = smallMap();
  setTileAt(map, 2, 1, 2, WALL);
  setTileAt(map, 3, 1, 2, STAR_TILE);
  setTileAt(map, 4, 1, 2, ONE_WAY);
  assert.equal(canMove(map, flags, 1, 1, 6), false, 'cannot enter a wall');
  assert.equal(canMove(map, flags, 3, 0, 2), true, 'a star tile above never blocks');
  assert.equal(canMove(map, flags, 4, 1, 2), false, 'one-way tile cannot be left downwards');
  assert.equal(canMove(map, flags, 4, 2, 8), false, 'the blocked bottom edge also stops entering from below');
  assert.equal(canMove(map, flags, 4, 0, 2), true, 'entering from above is allowed');
  assert.equal(canMove(map, flags, 0, 0, 8), false, 'map edge');
});

test('pathfinding goes around obstacles and stops next to unreachable goals', () => {
  const { map, flags } = smallMap();
  for (let y = 0; y < 4; y++) setTileAt(map, 3, y, 2, WALL);
  const path = findPath(map, flags, { x: 1, y: 1 }, { x: 5, y: 1 })!;
  assert.ok(path);
  let x = 1;
  let y = 1;
  for (const d of path) {
    assert.ok(canMove(map, flags, x, y, d));
    x += d === 4 ? -1 : d === 6 ? 1 : 0;
    y += d === 8 ? -1 : d === 2 ? 1 : 0;
  }
  assert.deepEqual([x, y], [5, 1]);
  const toWall = findPath(map, flags, { x: 1, y: 1 }, { x: 3, y: 1 })!;
  assert.equal(toWall.length, 1, 'walks to the closest reachable cell');
});

test('autotile refresh gives edges to patch borders and fill to the inside', () => {
  const map = createMap(5, 5, 1);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) setTileAt(map, x, y, 1, GROUND);
  refreshAllAutotiles(map);
  assert.equal(autotileShape(tileAt(map, 2, 2, 1)), 0, 'centre is fully surrounded');
  assert.equal(autotileShape(tileAt(map, 1, 1, 1)), 34, 'top-left corner');
  assert.equal(autotileShape(tileAt(map, 3, 3, 1)), 38, 'bottom-right corner');
});

test('message control codes are parsed', () => {
  assert.deepEqual(parseMessage('Hi \\C[2]there\\C[0]!\\.\nNext \\I[16] \\\\'), [
    { type: 'text', text: 'Hi ' },
    { type: 'color', index: 2 },
    { type: 'text', text: 'there' },
    { type: 'color', index: 0 },
    { type: 'text', text: '!' },
    { type: 'pause', frames: 15 },
    { type: 'newline' },
    { type: 'text', text: 'Next ' },
    { type: 'icon', index: 16 },
    { type: 'text', text: ' \\' },
  ]);
});

// --- Server world --------------------------------------------------------------

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

async function playerSocket(name: string): Promise<{ socket: ClientSocket; payload: EnterWorldPayload; client: TestClient }> {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: name,
    email: `${name.toLowerCase()}@example.com`,
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name: `${name}Hero`, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, payload, client };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('entering the world sends the map, its tileset and the event views', async () => {
  const { socket, payload } = await playerSocket('Mapper');
  assert.equal(payload.map.id, 1);
  assert.equal(payload.map.data.length, payload.map.width * payload.map.height * 6);
  assert.equal(payload.tileset.flags.length, 8192);
  assert.ok(payload.events.some((e) => e.image.characterName === 'People1'));
  assert.deepEqual([payload.character.x, payload.character.y], [20, 17]);
  socket.close();
});

test('the server applies valid steps, rejects blocked or too fast ones, and saves the position', async () => {
  const { socket, payload } = await playerSocket('Runner');
  const id = payload.character.id;
  const rejections: { x: number; y: number; epoch: number }[] = [];
  socket.on('moveRejected', (r) => rejections.push(r));

  socket.emit('move', 8, 0); // (20,16), free plaza
  await wait(300);
  assert.deepEqual([server.ctx.world.player(id)?.x, server.ctx.world.player(id)?.y], [20, 16]);

  // The well occupies (22..23, 11..12); its top row is the roof (star tile, walkable),
  // its bottom row is solid: stand next to the solid part and bump into it.
  const p = server.ctx.world.player(id)!;
  p.x = 21;
  p.y = 12;
  socket.emit('move', 6, 0);
  await wait(100);
  assert.equal(rejections.length, 1, 'blocked step is rejected');
  assert.deepEqual([rejections[0]!.x, rejections[0]!.y], [21, 12]);
  const epoch = rejections[0]!.epoch;

  // A stale epoch is ignored silently.
  socket.emit('move', 2, 0);
  await wait(100);
  assert.deepEqual([p.x, p.y], [21, 12]);

  // Speed hack: 10 instant steps; only the burst allowance passes.
  for (let i = 0; i < 10; i++) socket.emit('move', 2, epoch);
  await wait(200);
  assert.ok(p.y - 12 <= 3, `moved ${p.y - 12} cells instantly`);
  assert.ok(rejections.length >= 2);

  socket.close();
  await wait(150);
  const saved = server.ctx.characters.findById(id)!;
  assert.deepEqual([saved.x, saved.y], [p.x, p.y], 'position saved at disconnection');
});

test('talking to an NPC runs its dialogue and freezes the player until acknowledged', async () => {
  const { socket, payload } = await playerSocket('Talker');
  const p = server.ctx.world.player(payload.character.id)!;
  // Tomas stands at (17,16): face him from (18,16).
  p.x = 18;
  p.y = 16;
  socket.emit('turn', 4);
  await wait(50);
  const messages: MessagePayload[] = [];
  const turned = new Promise<number>((resolve) => socket.on('eventUpdate', (u) => u.direction && resolve(u.direction)));
  socket.on('showMessage', (m, ack) => {
    messages.push(m);
    setTimeout(() => ack(0), 50);
  });
  socket.emit('action');
  assert.equal(await turned, 6, 'the NPC turns to face the player');
  await wait(100);
  assert.equal(p.busy, true);
  socket.emit('move', 8, 0);
  await wait(50);
  assert.deepEqual([p.x, p.y], [18, 16], 'cannot walk away during the dialogue');
  await wait(300);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.speaker, 'Tomas');
  assert.equal(messages[0]!.faceName, 'People1');
  assert.equal(p.busy, false);
  socket.close();
});

test('a second connection with the same character replaces the first', async () => {
  const { socket, client, payload } = await playerSocket('Twin');
  const kicked = new Promise<string>((resolve) => socket.on('errorMessage', (e) => resolve(e.key)));
  const second: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  await new Promise((r) => second.on('enterWorld', r));
  assert.equal(await kicked, 'error.net.replaced');
  await wait(100);
  assert.equal(server.ctx.world.player(payload.character.id)?.socket.connected, true);
  second.close();
});

test('passability mode: cells blocked or opened by hand, whatever their tiles', () => {
  const { map, flags } = smallMap();
  setTileAt(map, 3, 2, 2, WALL);
  // A free cell blocked by hand, then clicked again: back to its tiles.
  setPassageOverride(map, flags, 1, 1, 'blocked');
  assert.deepEqual(map.mmo.blocked, [1 * 6 + 1]);
  assert.equal(canMove(map, flags, 0, 1, 6), false, 'cannot enter the blocked cell');
  assert.equal(canMove(map, flags, 1, 0, 2), false);
  setPassageOverride(map, flags, 1, 1, 'open');
  assert.equal(map.mmo.blocked, undefined, 'asking for what the tiles give removes the override');
  assert.equal(canMove(map, flags, 0, 1, 6), true);
  // A wall opened by hand.
  setPassageOverride(map, flags, 3, 2, 'open');
  assert.deepEqual(map.mmo.opened, [2 * 6 + 3]);
  assert.equal(canMove(map, flags, 2, 2, 6), true, 'the opened wall can be walked on');
  assert.equal(checkPassage(map, flags, 3, 2, 0x8), true);
  assert.equal(validateMap(map, () => true), null);
  assert.equal(validateMap({ ...map, mmo: { ...map.mmo, blocked: [999] } }, () => true), 'mmo.passage');
  // Resizing keeps the overrides on their cells.
  setPassageOverride(map, flags, 5, 4, 'blocked');
  const smaller = resizeMap(map, 4, 3);
  assert.deepEqual(smaller.mmo.opened, [2 * 4 + 3]);
  assert.equal(smaller.mmo.blocked, undefined, 'the cell cut off is dropped');
});
