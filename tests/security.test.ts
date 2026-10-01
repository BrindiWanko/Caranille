/**
 * @file Robustness, security and performance tests: HTTP security headers,
 * session cookie flags, CSRF on API writes, anti-cheat checks (speed, attack
 * reach, items not owned), the area of interest of movements, automatic
 * backups, and a short load test.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { backupNow } from '../server/db/backups.js';
import type { PlayerSession } from '../server/game/world.js';
import { runLoadTest } from '../scripts/load-test.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Player {
  socket: ClientSocket;
  client: TestClient;
  session: PlayerSession;
  moved: Map<number, [number, number]>;
  rejected: number;
  notes: string[];
}

async function newPlayer(name: string): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const p = { socket, client, moved: new Map(), rejected: 0, notes: [] } as unknown as Player;
  socket.on('playersMoved', (moves) => moves.forEach(([pid, x, y]) => p.moved.set(pid, [x, y])));
  socket.on('moveRejected', () => p.rejected++);
  socket.on('notify', (n) => p.notes.push(n.key));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  p.session = server.ctx.world.player(payload.character.id)!;
  return p;
}

test('security headers, cookie flags and CSRF on API writes', async () => {
  const client = new TestClient(server.url);
  const res = await client.request('/login');
  assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-powered-by'), null);
  const cookie = res.headers.getSetCookie().join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  // A logged-in administrator without the CSRF header cannot write.
  const admin = await newPlayer('Root');
  const noCsrf = await admin.client.request('/api/admin/tools/announce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) });
  assert.equal(noCsrf.status, 403);
  const formNoCsrf = await admin.client.post('/characters', { name: 'Sneaky', classId: '1' });
  assert.equal(formNoCsrf.status, 403);
  admin.socket.close();
});

test('anti-cheat: walking speed, attack reach and items are checked by the server', async () => {
  const cheat = await newPlayer('Speedy');
  const p = cheat.session;
  const world = server.ctx.world;
  world.transfer(p, 1, 20, 20, 2);
  const before = p.y;
  // Ten steps at once: only the burst allowance goes through.
  for (let i = 0; i < 10; i++) cheat.socket.emit('move', 2, p.epoch);
  await wait(200);
  assert.ok(p.y - before <= 3, `moved ${p.y - before} cells`);
  assert.ok(cheat.rejected > 0);
  // A melee attack does not reach a monster 3 cells away.
  world.transfer(p, 2, 14, 27, 8);
  const view = world.combat.views(2).find((v) => v.enemyId === 1)!;
  const slime = world.combat.monster(2, view.id)!;
  slime.nextMoveAt = Number.MAX_SAFE_INTEGER;
  p.x = slime.x;
  p.y = slime.y + 3;
  p.direction = 8;
  const hp = slime.hp;
  p.combat.nextAttackAt = 0;
  world.combat.attack(p);
  assert.equal(slime.hp, hp);
  // Using or selling an item not owned does nothing.
  cheat.socket.emit('useItem', 3);
  await wait(100);
  assert.ok(cheat.notes.includes('error.item.not_owned'));
  cheat.socket.close();
});

test('area of interest: far players are not sent, and appear when they come close', async () => {
  const far = await newPlayer('Faraway');
  const near = await newPlayer('Nearby');
  const world = server.ctx.world;
  world.transfer(far.session, 1, 1, 15, 2);
  world.transfer(near.session, 1, 38, 15, 2);
  await wait(150);
  near.moved.clear();
  world.forceMove(far.session, 1, 16, 2);
  await wait(150);
  assert.equal(near.moved.has(far.session.characterId), false, 'beyond the area of interest');
  world.forceMove(near.session, 20, 15, 4);
  await wait(150);
  assert.deepEqual(near.moved.get(far.session.characterId), [1, 16], 'its position is sent once it is close');
  far.socket.close();
  near.socket.close();
});

test('automatic backups keep the latest copies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'caranille-backups-'));
  try {
    for (let i = 0; i < 4; i++) await backupNow(server.ctx.db, dir, 2, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    assert.deepEqual(readdirSync(dir).sort(), ['caranille-20260101-000002.db', 'caranille-20260101-000003.db']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('criterion (short): dozens of clients without noticeable degradation', async () => {
  const report = await runLoadTest(30, 3);
  assert.ok(report.accepted > 0);
  assert.ok(report.lagP95 <= 100, `event loop lag p95 ${report.lagP95} ms`);
  assert.ok(report.tickP95 <= 25, `tick p95 ${report.tickP95} ms`);
});
