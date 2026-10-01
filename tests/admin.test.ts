/**
 * @file Administration panel tests: rights (players refused, moderators
 * limited), the step criterion (a moderator mutes and bans a player and reads
 * its trade history), game tools, logs, and backups.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ChatMessage } from '../shared/social.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import type { PlayerSession } from '../server/game/world.js';
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
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(10);
  }
}

interface Account {
  client: TestClient;
  id: number;
  api: <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
}

async function account(name: string): Promise<Account> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  const csrf = await client.csrf('/characters');
  const api = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await client.request(`/api/admin${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const isJson = res.headers.get('content-type')?.includes('json');
    return { status: res.status, body: (isJson ? await res.json() : await res.arrayBuffer()) as T };
  };
  return { client, id: server.ctx.accounts.findByUsername(name)!.id, api };
}

interface Player {
  socket: ClientSocket;
  session: PlayerSession;
  chat: ChatMessage[];
  errors: string[];
  disconnected: boolean;
}

async function play(a: Account, name: string): Promise<Player> {
  await a.client.post('/characters', { _csrf: await a.client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(a.id)[0]!.id;
  await a.client.post(`/characters/${id}/play`, { _csrf: await a.client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: a.client.cookieHeader() } });
  const p = { socket, chat: [], errors: [], disconnected: false } as unknown as Player;
  socket.on('chat', (m) => p.chat.push(m));
  socket.on('errorMessage', (e) => p.errors.push(e.key));
  socket.on('disconnect', () => (p.disconnected = true));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  p.session = server.ctx.world.player(payload.character.id)!;
  return p;
}

test('criterion: a moderator moderates a player and reads its trade history', async () => {
  const admin = await account('Boss'); // first account: administrator
  const mod = await account('Modo');
  const bad = await account('Troll');
  const buddy = await account('Buddy');
  server.ctx.accounts.setRole(mod.id, 'moderator');

  // A player cannot use the panel.
  assert.equal((await bad.api('GET', '/dashboard')).status, 403);
  const page = await bad.client.request('/admin');
  assert.notEqual(page.status, 200);

  // The troll trades with a buddy (logged), then is reported.
  const troll = await play(bad, 'Troll');
  const friend = await play(buddy, 'Buddy');
  server.ctx.world.changeItems(troll.session, 'item', 1, 2);
  assert.equal(server.ctx.social.trade(troll.session.characterId, friend.session.characterId, { items: [{ kind: 'item', id: 1, quantity: 2 }], gold: 0 }, { items: [], gold: 10 }, () => 99, 48), null);

  // Dashboard and search.
  const dash = await mod.api<{ players: { name: string }[]; server: { accounts: number } }>('GET', '/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.body.players.some((p) => p.name === 'Troll'));
  const found = await mod.api<{ accounts: { id: number }[] }>('GET', '/accounts?q=trol');
  assert.deepEqual(found.body.accounts.map((a) => a.id), [bad.id]);

  // Mute: the chat is refused.
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/mute`, { minutes: 30, reason: 'insultes' })).status, 200);
  troll.socket.emit('chat', 'bla bla', 'map');
  await until(() => troll.chat.some((m) => m.key === 'error.chat.muted'));
  await wait(50);
  assert.ok(!friend.chat.some((m) => m.text === 'bla bla'));

  // The account page shows the trade history (and the connections).
  const detail = await mod.api<{ logs: Record<string, Record<string, unknown>[]>; account: { mutedUntil: string } }>('GET', `/accounts/${bad.id}`);
  assert.ok(detail.body.account.mutedUntil);
  assert.equal(detail.body.logs.trades!.length, 1);
  assert.equal(detail.body.logs.trades![0]!.a, 'Troll');
  assert.ok(detail.body.logs.connections!.some((l) => l.event === 'login'));

  // A moderator cannot ban for good, nor sanction an administrator.
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/ban`, { permanent: true })).status, 403);
  assert.equal((await mod.api('POST', `/accounts/${admin.id}/mute`, { minutes: 5 })).status, 403);
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/role`, { role: 'admin' })).status, 403);

  // A one-day ban: kicked at once, refused at the next connection.
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/ban`, { minutes: 1440, reason: 'récidive' })).status, 200);
  await until(() => troll.disconnected);
  assert.ok(troll.errors.includes('error.auth.banned'));
  const again = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: bad.client.cookieHeader() } });
  const refusal = await new Promise<string>((resolve) => again.on('connect_error', (e) => resolve(e.message)));
  assert.match(refusal, /error\.(auth\.banned|auth\.not_authenticated)/);
  again.close();

  // Every action is in the administrator log.
  const adminLog = await admin.api<{ lines: { action: string }[] }>('GET', '/logs/admin');
  assert.deepEqual(adminLog.body.lines.map((l) => l.action).slice(0, 2), ['ban', 'mute']);
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/unban`)).status, 200);
  friend.socket.close();
});

test('game tools, sales log and backups (administrators)', async () => {
  const boss2 = await account('Boss3');
  server.ctx.accounts.setRole(boss2.id, 'admin');
  const mod = await account('Modo2');
  server.ctx.accounts.setRole(mod.id, 'moderator');
  const user = await account('Player1');
  const p = await play(user, 'Player1');
  const me = await play(boss2, 'Boss3');
  const world = server.ctx.world;

  // Tools are for administrators only.
  assert.equal((await mod.api('POST', '/tools/give', { characterId: p.session.characterId, gold: 100 })).status, 403);
  const gold = server.ctx.inventory.gold(p.session.characterId);
  assert.equal((await boss2.api('POST', '/tools/give', { characterId: p.session.characterId, kind: 'item', id: 1, quantity: 3, gold: 100 })).status, 200);
  assert.equal(server.ctx.inventory.gold(p.session.characterId), gold + 100);
  assert.equal(server.ctx.inventory.quantity(p.session.characterId, 'item', 1), 3);
  assert.equal((await boss2.api('POST', '/tools/progress', { characterId: p.session.characterId, switchId: 7, switchValue: true, variableId: 3, variableValue: 42 })).status, 200);
  assert.equal(world.getSwitch(p.session, 7), true);
  assert.equal(world.getVariable(p.session, 3), 42);
  assert.equal((await boss2.api('POST', '/tools/teleport', { characterId: p.session.characterId, mapId: 2, x: 14, y: 27 })).status, 200);
  assert.equal(p.session.mapId, 2);
  assert.equal((await boss2.api('POST', '/tools/teleport', { characterId: 'self', toCharacterId: p.session.characterId })).status, 200);
  assert.equal(me.session.mapId, 2);
  assert.equal((await boss2.api('POST', '/tools/invisible', { on: true })).status, 200);
  assert.equal(me.session.invisible, true);
  assert.equal((await boss2.api('POST', '/tools/announce', { text: 'Maintenance à 22 h' })).status, 200);
  await until(() => p.chat.some((m) => m.key === 'notify.announce'));

  // Shop sales are logged.
  server.ctx.admin.logSale(p.session.characterId, 'sell', 'item', 1, 1, 15);
  const sales = await mod.api<{ lines: unknown[] }>('GET', `/logs/sales?account=${user.id}`);
  assert.equal(sales.body.lines.length, 1);

  // Backup: a SQLite file; restore refuses anything else.
  assert.equal((await mod.api('GET', '/backup')).status, 403);
  const backup = await boss2.api<ArrayBuffer>('GET', '/backup');
  assert.equal(backup.status, 200);
  assert.equal(Buffer.from(backup.body).subarray(0, 15).toString('latin1'), 'SQLite format 3');
  const junk = await boss2.client.request('/api/admin/restore', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': await boss2.client.csrf('/characters') }, body: 'not a database' });
  assert.equal(junk.status, 400);
  p.socket.close();
  me.socket.close();
});
