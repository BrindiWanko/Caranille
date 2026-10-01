/**
 * @file Social tests: chat channels, private messages and answers, ignore
 * list, anti-flood, item links, friends (online status, location), emotes,
 * and the step criterion: two players talk and trade an item and gold, with
 * no possible duplication (locked offers, changed offers, missing items,
 * one transaction, log).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ChatMessage, FriendsPayload, TradeView } from '../shared/social.js';
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

interface Player {
  socket: ClientSocket;
  session: PlayerSession;
  chat: ChatMessage[];
  notes: string[];
  friends: FriendsPayload;
  trade: TradeView | null;
  requests: { id: number; name: string }[];
  emotes: number[];
}

async function newPlayer(name: string): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { socket, chat: [], notes: [], friends: { friends: [], ignored: [] }, trade: null, requests: [], emotes: [] } as unknown as Player;
  socket.on('chat', (m) => player.chat.push(m));
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('friends', (f) => (player.friends = f));
  socket.on('trade', (v) => (player.trade = v));
  socket.on('tradeRequest', (r) => player.requests.push(r));
  socket.on('emote', (e) => player.emotes.push(e.balloon));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  player.session = server.ctx.world.player(payload.character.id)!;
  return player;
}

const texts = (p: Player) => p.chat.map((m) => m.text || m.key);

test('chat: map, world and private channels, answers, ignore list, flood, links, emotes', async () => {
  const alice = await newPlayer('Alice');
  const bob = await newPlayer('Bob');
  alice.socket.emit('chat', 'Bonjour à tous', 'map');
  await until(() => texts(bob).includes('Bonjour à tous'));
  assert.equal(bob.chat.at(-1)!.from!.name, 'Alice');
  alice.socket.emit('chat', '/all Salut le monde', 'map');
  await until(() => bob.chat.some((m) => m.channel === 'global' && m.text === 'Salut le monde'));

  // Private message and answer.
  alice.socket.emit('chat', '/w bob Tu as une [Potion] ?', 'map');
  await until(() => bob.chat.some((m) => m.channel === 'private'));
  const whisper = bob.chat.find((m) => m.channel === 'private')!;
  assert.equal(whisper.to!.name, 'Bob');
  assert.deepEqual(whisper.links?.map((l) => l.name), ['Potion'], 'item link resolved');
  assert.ok(alice.chat.some((m) => m.channel === 'private' && m.to?.name === 'Bob'), 'echo to the writer');
  bob.socket.emit('chat', '/r Oui !', 'map');
  await until(() => alice.chat.some((m) => m.channel === 'private' && m.text === 'Oui !'));
  alice.socket.emit('chat', '/w Nobody coucou', 'map');
  await until(() => alice.chat.some((m) => m.key === 'error.chat.offline'));
  alice.socket.emit('chat', '/p salut', 'map');
  await until(() => alice.chat.some((m) => m.key === 'error.chat.no_party'));
  alice.socket.emit('chat', '/dance', 'map');
  await until(() => alice.chat.some((m) => m.key === 'error.chat.unknown_command'));

  // Ignore list.
  bob.socket.emit('ignore', 'alice');
  await until(() => bob.friends.ignored.some((i) => i.name === 'Alice'));
  const before = bob.chat.length;
  alice.session.social.tokens = 5;
  alice.socket.emit('chat', 'Tu m’entends ?', 'map');
  alice.socket.emit('chat', '/w Bob allô ?', 'map');
  await wait(200);
  assert.equal(bob.chat.length, before, 'nothing from an ignored player');
  bob.socket.emit('unignore', alice.session.characterId);
  await until(() => bob.friends.ignored.length === 0);

  // Anti-flood: a burst, then refusals.
  alice.session.social.tokens = 5;
  for (let i = 0; i < 8; i++) alice.socket.emit('chat', `spam ${i}`, 'map');
  await until(() => alice.chat.some((m) => m.key === 'error.chat.flood'));
  assert.ok(texts(bob).filter((t) => t?.startsWith('spam')).length <= 5);

  // Emotes reach the players of the map.
  alice.session.social.tokens = 5;
  alice.socket.emit('emote', 3);
  await until(() => bob.emotes.includes(3));
  alice.socket.close();
  bob.socket.close();
});

test('friends: online status and location, told when a friend comes and goes', async () => {
  const carol = await newPlayer('Carol');
  const dave = await newPlayer('Dave');
  carol.socket.emit('friendAdd', 'dave');
  await until(() => carol.friends.friends.some((f) => f.name === 'Dave' && f.online));
  assert.equal(carol.friends.friends[0]!.location, 'Village de Caranille');
  carol.socket.emit('friendAdd', 'Personne');
  await until(() => carol.chat.some((m) => m.key === 'error.social.unknown_player'));
  dave.socket.close();
  await until(() => carol.notes.includes('notify.friend_offline'));
  await until(() => carol.friends.friends.some((f) => f.name === 'Dave' && !f.online));
  carol.socket.close();
});

test('criterion: two players trade an item and gold, and nothing can be duplicated', async () => {
  const erin = await newPlayer('Erin');
  const finn = await newPlayer('Finn');
  const world = server.ctx.world;
  const inv = server.ctx.inventory;
  const [e, f] = [erin.session, finn.session];
  world.changeItems(e, 'item', 1, 3);
  const erinGold = inv.gold(e.characterId);
  const finnGold = inv.gold(f.characterId);
  f.x = e.x + 1;
  f.y = e.y;

  erin.socket.emit('tradeRequest', f.characterId);
  await until(() => finn.requests.length === 1);
  finn.socket.emit('tradeRespond', true);
  await until(() => erin.trade !== null && finn.trade !== null);
  assert.equal(erin.trade!.partner.name, 'Finn');

  // Offers: 2 potions (more than 3 owned is clamped) against 30 gold.
  erin.socket.emit('tradeOffer', { items: [{ kind: 'item', id: 1, quantity: 2 }, { kind: 'item', id: 6, quantity: 1 }], gold: 0 });
  finn.socket.emit('tradeOffer', { items: [], gold: 30 });
  await until(() => finn.trade!.theirs.items.length === 1 && erin.trade!.theirs.gold === 30);
  assert.equal(finn.trade!.theirs.items[0]!.quantity, 2, 'items not owned are left out');

  // Confirming before both locks does nothing; a change after a lock unlocks both.
  erin.socket.emit('tradeConfirm');
  erin.socket.emit('tradeLock');
  await until(() => finn.trade!.theirs.locked);
  finn.socket.emit('tradeOffer', { items: [], gold: 40 });
  await until(() => !finn.trade!.theirs.locked && erin.trade!.theirs.gold === 40);
  erin.socket.emit('tradeOffer', { items: [{ kind: 'item', id: 1, quantity: 5 }], gold: 0 });
  erin.socket.emit('tradeLock');
  finn.socket.emit('tradeLock');
  await until(() => erin.trade!.mine.locked && erin.trade!.theirs.locked);
  erin.socket.emit('tradeOffer', { items: [], gold: 0 });
  await wait(100);
  assert.equal(finn.trade!.theirs.items[0]!.quantity, 3, 'a locked offer cannot change');

  // The items leave Erin's bag before the trade: nothing moves at all.
  world.changeItems(e, 'item', 1, -1);
  erin.socket.emit('tradeConfirm');
  finn.socket.emit('tradeConfirm');
  await until(() => erin.notes.includes('error.trade.changed'));
  assert.equal(inv.quantity(e.characterId, 'item', 1), 2);
  assert.equal(inv.quantity(f.characterId, 'item', 1), 0);
  assert.equal(inv.gold(f.characterId), finnGold);

  // Fixed offers: the trade goes through, once.
  erin.socket.emit('tradeOffer', { items: [{ kind: 'item', id: 1, quantity: 2 }], gold: 0 });
  await until(() => finn.trade!.theirs.items[0]?.quantity === 2 && !erin.trade!.theirs.locked);
  for (const s of [erin, finn]) s.socket.emit('tradeLock');
  await until(() => erin.trade!.mine.locked && erin.trade!.theirs.locked);
  erin.socket.emit('tradeConfirm');
  finn.socket.emit('tradeConfirm');
  finn.socket.emit('tradeConfirm');
  await until(() => erin.trade === null && finn.trade === null);
  assert.equal(inv.quantity(e.characterId, 'item', 1), 0);
  assert.equal(inv.quantity(f.characterId, 'item', 1), 2);
  assert.equal(inv.gold(e.characterId), erinGold + 40);
  assert.equal(inv.gold(f.characterId), finnGold - 40);
  const log = server.ctx.social.tradeLog(e.characterId);
  assert.equal(log.length, 1, 'exactly one trade logged');
  assert.deepEqual(log[0]!.aItems, [{ kind: 'item', id: 1, quantity: 2 }]);

  // Leaving cancels a trade in progress for the other player.
  erin.socket.emit('tradeRequest', f.characterId);
  await until(() => finn.requests.length === 2);
  finn.socket.emit('tradeRespond', true);
  await until(() => finn.trade !== null);
  erin.socket.close();
  await until(() => finn.trade === null && finn.notes.includes('notify.trade_partner_left'));
  finn.socket.close();
});

test('inspect another player; report a player to the moderators', async () => {
  const viewer = await newPlayer('Viewer');
  const shown = await newPlayer('Shown');
  server.ctx.inventory.add(shown.session.characterId, 'weapon', 1, 1, 99);
  server.ctx.world.sheet.equip(shown.session, 'weapon', 1);
  const inspected = new Promise<import('../shared/social.js').InspectPayload>((resolve) => viewer.socket.once('inspect', resolve));
  viewer.socket.emit('inspect', shown.session.characterId);
  const view = await inspected;
  assert.equal(view.name, 'Shown');
  assert.equal(view.level, shown.session.level);
  assert.equal(view.className, server.ctx.gameData.get('class', 1)!.name);
  assert.deepEqual(view.equipment.map((e) => e.slot), ['weapon']);

  viewer.socket.emit('report', shown.session.characterId, '  insults   in the chat ');
  await until(() => viewer.chat.some((m) => m.key === 'notify.report_sent'));
  const line = server.ctx.admin.logs('reports')[0]!;
  assert.equal(line.reporter, 'Viewer');
  assert.equal(line.target, 'Shown');
  assert.equal(line.reason, 'insults in the chat');
  assert.deepEqual(server.ctx.admin.logs('reports', shown.session.accountId).length, 1, 'filtered by the reported account');
  viewer.socket.emit('report', shown.session.characterId, 'again');
  await until(() => viewer.chat.some((m) => m.key === 'error.social.report_wait'));
  assert.equal(server.ctx.admin.logs('reports').length, 1);
  viewer.socket.close();
  shown.socket.close();
});
