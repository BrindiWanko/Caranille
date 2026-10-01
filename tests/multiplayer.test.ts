/**
 * @file Shared world tests: players see each other appear, move and leave;
 * teleporters move players between maps (and rooms); flood protection.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, EnterWorldPayload, MapChangePayload, RemotePlayer, ServerToClientEvents } from '../shared/protocol.js';
import { RateLimiter } from '../server/net/rate-limit.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function join(name: string): Promise<{ socket: ClientSocket; payload: EnterWorldPayload }> {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: name,
    email: `${name.toLowerCase()}@example.com`,
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '3' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, payload };
}

test('two players see each other join, move in real time and leave', async () => {
  const alice = await join('Alice');
  const joined = new Promise<RemotePlayer>((r) => alice.socket.on('playerJoined', r));
  const bob = await join('Bobby');
  const seen = await joined;
  assert.equal(seen.name, 'Bobby');
  assert.ok(bob.payload.players.some((p) => p.name === 'Alice'), 'the newcomer receives the players already there');

  const moves: [number, number, number, number][] = [];
  alice.socket.on('playersMoved', (list) => moves.push(...list));
  bob.socket.emit('move', 8, 0);
  // Sent at the next tick (50 ms); wait for it rather than a fixed delay (slow machines).
  for (let t = 0; t < 300 && !moves.some(([id]) => id === bob.payload.character.id); t++) await wait(10);
  const bobMove = moves.find(([id]) => id === bob.payload.character.id);
  assert.ok(bobMove, 'Alice receives Bob’s step within a tick');
  assert.deepEqual(bobMove.slice(1), [bob.payload.character.x, bob.payload.character.y - 1, 8]);

  const left = new Promise<{ id: number }>((r) => alice.socket.on('playerLeft', r));
  bob.socket.close();
  assert.equal((await left).id, bob.payload.character.id);
  alice.socket.close();
});

test('a teleporter sends the player to another map and room', async () => {
  const walker = await join('Walker');
  const watcher = await join('Watcher');
  const p = server.ctx.world.player(walker.payload.character.id)!;
  // Stand just south of the northern exit of the village; its teleporters are at (19..20, 0).
  p.x = 19;
  p.y = 1;
  const changed = new Promise<MapChangePayload>((r) => walker.socket.on('mapChange', r));
  const left = new Promise<{ id: number }>((r) => watcher.socket.on('playerLeft', r));
  walker.socket.emit('move', 8, 0);
  const change = await changed;
  assert.equal(change.map.id, 2);
  assert.equal(change.map.displayName, 'Forêt de Bruyère');
  assert.deepEqual([change.x, change.y, change.direction], [14, 28, 8]);
  assert.ok(change.epoch > 0, 'moves predicted on the old map are void');
  assert.equal((await left).id, walker.payload.character.id, 'players of the old map see the traveller leave');
  assert.deepEqual([p.mapId, p.x, p.y], [2, 14, 28]);

  // Moves are now validated on the forest map.
  walker.socket.emit('move', 8, change.epoch);
  await wait(100);
  assert.deepEqual([p.x, p.y], [14, 27]);
  walker.socket.close();
  watcher.socket.close();
});

test('the house door leads inside and back out', async () => {
  const guest = await join('Guest');
  const p = server.ctx.world.player(guest.payload.character.id)!;
  p.x = 8;
  p.y = 10;
  const inside = new Promise<MapChangePayload>((r) => guest.socket.once('mapChange', r));
  guest.socket.emit('move', 8, 0);
  const house = await inside;
  assert.equal(house.map.id, 3);
  assert.equal(house.tileset.name, 'Inside');
  // Walk back to the exit (6,9) from (6,8).
  const outside = new Promise<MapChangePayload>((r) => guest.socket.once('mapChange', r));
  await wait(300);
  guest.socket.emit('move', 2, house.epoch);
  const back = await outside;
  assert.deepEqual([back.map.id, back.x, back.y], [1, 8, 10]);
  guest.socket.close();
});

test('the rate limiter drops floods and eventually asks to disconnect', () => {
  let now = 0;
  const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 10, maxDropped: 3 }, () => now);
  for (let i = 0; i < 5; i++) assert.equal(limiter.take(), 'ok');
  assert.equal(limiter.take(), 'drop');
  now += 100; // one token refilled
  assert.equal(limiter.take(), 'ok');
  assert.equal(limiter.take(), 'drop');
  assert.equal(limiter.take(), 'drop');
  assert.equal(limiter.take(), 'drop');
  assert.equal(limiter.take(), 'kick');
});
