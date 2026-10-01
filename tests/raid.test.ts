/**
 * @file Instance and raid tests: each party gets its own copy of an
 * instanced map (monsters, chat room, instance switches), raid access
 * conditions, boss phases (adds, marked zone, enrage), rewards with a weekly
 * lockout and loot given in turn, and the cleanup of empty instances.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ChatMessage } from '../shared/social.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { DEMO_MAPS } from '../server/db/demo-map.js';
import type { Monster } from '../server/game/combat.js';
import { lockoutEnd } from '../server/game/raids.js';
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
  notes: string[];
  chat: ChatMessage[];
  telegraphs: number;
  partyInvites: number;
}

async function newPlayer(name: string): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { socket, notes: [], chat: [], telegraphs: 0, partyInvites: 0 } as unknown as Player;
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('chat', (m) => player.chat.push(m));
  socket.on('telegraph', () => player.telegraphs++);
  socket.on('partyInvite', () => player.partyInvites++);
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  player.session = server.ctx.world.player(payload.character.id)!;
  return player;
}

async function party(leader: Player, member: Player): Promise<void> {
  leader.socket.emit('partyInvite', member.session.characterId);
  await until(() => member.partyInvites > 0);
  member.socket.emit('partyRespond', true);
  await until(() => server.ctx.world.party.partyOf(member.session.characterId) !== 0);
}

const boss = (instance: number): Monster => {
  const world = server.ctx.world;
  const view = world.combat.views(DEMO_MAPS.dungeon, instance).find((v) => v.enemyId === 8)!;
  return world.combat.monster(DEMO_MAPS.dungeon, view.id, instance)!;
};

test('lockout periods end at the next UTC midnight or Monday', () => {
  const wednesday = Date.UTC(2026, 8, 30, 15, 0); // Wednesday 30 September 2026
  assert.equal(lockoutEnd('daily', wednesday), Date.UTC(2026, 9, 1));
  assert.equal(lockoutEnd('weekly', wednesday), Date.UTC(2026, 9, 5));
  assert.equal(lockoutEnd('always', wednesday), 0);
});

test('criterion: a party enters the dungeon, defeats the boss and is rewarded; another party has its own instance', async () => {
  const [ada, bea, cid] = [await newPlayer('Ada'), await newPlayer('Bea'), await newPlayer('Cid')];
  const world = server.ctx.world;
  await party(ada, bea);

  // Ada and Bea share an instance; Cid (alone) gets another one.
  for (const p of [ada, bea, cid]) assert.ok(world.transfer(p.session, DEMO_MAPS.dungeon, 12, 19, 8));
  const [a, b, c] = [ada.session, bea.session, cid.session];
  assert.ok(a.instance > 0);
  assert.equal(a.instance, b.instance, 'party members share their instance');
  assert.notEqual(a.instance, c.instance, 'another party has its own instance');
  const bossA = boss(a.instance);
  const bossC = boss(c.instance);
  assert.notEqual(bossA.id, bossC.id, 'each instance has its own boss');

  // The map chat stays inside the instance.
  ada.socket.emit('chat', 'Le boss est au fond !', 'map');
  await until(() => bea.chat.some((m) => m.text === 'Le boss est au fond !'));
  await wait(50);
  assert.ok(!cid.chat.some((m) => m.text === 'Le boss est au fond !'));

  // The fight: phases trigger as the boss loses HP.
  const monstersBefore = world.combat.views(DEMO_MAPS.dungeon, a.instance).length;
  bossA.nextMoveAt = Number.MAX_SAFE_INTEGER;
  a.x = bossA.x;
  a.y = bossA.y + 1;
  a.direction = 8;
  b.x = bossA.x + 1;
  b.y = bossA.y + 1;
  bossA.mode = 'chase';
  bossA.targetId = a.characterId;
  bossA.hp = Math.floor(600 * 0.7);
  world.combat.tick();
  assert.equal(world.combat.views(DEMO_MAPS.dungeon, a.instance).length, monstersBefore + 2, 'adds called at 75 %');
  assert.equal(world.combat.views(DEMO_MAPS.dungeon, c.instance).length, monstersBefore, 'nothing happens in the other instance');
  bossA.hp = Math.floor(600 * 0.45);
  world.combat.tick();
  await until(() => ada.telegraphs > 0 && bea.telegraphs > 0);
  assert.equal(cid.telegraphs, 0);
  bossA.hp = Math.floor(600 * 0.2);
  world.combat.tick();
  assert.equal(bossA.enraged, true);

  // The last blows: raid rewards for both, lockout, loot in turn.
  const goldA = server.ctx.inventory.gold(a.characterId);
  bossA.hp = 1;
  a.hp = 9999;
  for (let i = 0; i < 20 && !bossA.dead; i++) {
    a.combat.nextAttackAt = 0;
    world.combat.attack(a);
  }
  assert.ok(bossA.dead);
  await until(() => ada.notes.includes('notify.raid_cleared') && bea.notes.includes('notify.raid_cleared'));
  assert.ok(server.ctx.inventory.gold(a.characterId) >= goldA + 150);
  const raid = server.ctx.gameData.get('raid', 1)!;
  assert.ok(world.raids.lockedUntil(a.characterId, raid.id) > Date.now(), 'weekly lockout');
  const helmets = server.ctx.inventory.quantity(a.characterId, 'armor', 4) + server.ctx.inventory.quantity(b.characterId, 'armor', 4);
  const elixirs = server.ctx.inventory.quantity(a.characterId, 'item', 3) + server.ctx.inventory.quantity(b.characterId, 'item', 3);
  assert.deepEqual([helmets, elixirs], [1, 1], 'each item of the loot table is given once');
  assert.equal(bossC.dead, false, 'the other boss is untouched');

  // A defeated raid boss does not come back in its instance.
  assert.equal(bossA.respawnAt, Number.MAX_SAFE_INTEGER);
  world.combat.tick();
  assert.equal(world.combat.views(DEMO_MAPS.dungeon, a.instance).some((v) => v.enemyId === 8), false);

  // Leaving: the empty instance is closed after the delay (instances do not survive).
  for (const p of [a, b]) world.transfer(p, DEMO_MAPS.forest, 12, 10, 2);
  const closed = a.instance === 0 ? undefined : a.instance;
  assert.equal(closed, undefined, 'back to the shared world');
  world.instances.cleanup(Date.now());
  world.instances.cleanup(Date.now() + 10 * 60_000);
  assert.equal(world.instances.list().filter((i) => i.mapId === DEMO_MAPS.dungeon).length, 1, 'only Cid’s instance is left');
  for (const p of [ada, bea, cid]) p.socket.close();
});

test('raid access conditions and instance switches', async () => {
  const dee = await newPlayer('Dee');
  const world = server.ctx.world;
  const raid = server.ctx.gameData.get('raid', 1)!;
  server.ctx.gameData.save('raid', { ...raid, minPlayers: 2 });
  assert.equal(world.transfer(dee.session, DEMO_MAPS.dungeon, 12, 19, 8), false);
  await until(() => dee.notes.includes('error.instance.too_few'));
  server.ctx.gameData.save('raid', { ...raid, minPlayers: 1 });
  // Switch 5 declared as an instance switch: shared in the instance only.
  server.ctx.settings.set('switches', [...Array(4)].map(() => ({ name: '', global: false })).concat([{ name: 'Levier', global: false, instance: true } as never]));
  world.systemChanged();
  assert.ok(world.transfer(dee.session, DEMO_MAPS.dungeon, 12, 19, 8));
  world.setSwitch(dee.session, 5, true);
  assert.equal(world.getSwitch(dee.session, 5), true);
  assert.equal(world.instances.of(dee.session)!.switches.has(5), true);
  world.transfer(dee.session, DEMO_MAPS.forest, 12, 10, 2);
  assert.equal(world.getSwitch(dee.session, 5), false, 'outside of the instance');
  dee.socket.close();
});
