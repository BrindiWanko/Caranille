/**
 * @file Party and guild tests: party invitation, frames, chat and shared
 * rewards; and the step criterion: create a guild (paid), invite a player,
 * manage ranks and permissions, use the bank (with its log), guild chat,
 * message of the day, tag under names, guild experience.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { GuildView, PartyView } from '../shared/guild.js';
import { emblemSvg } from '../shared/art/emblem.js';
import type { ChatMessage } from '../shared/social.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { DEMO_MAPS } from '../server/db/demo-map.js';
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
  client: TestClient;
  socket: ClientSocket;
  session: PlayerSession;
  notes: string[];
  chat: ChatMessage[];
  party: PartyView | null;
  guild: GuildView | null;
  partyInvites: number;
  guildInvites: number;
  tags: Map<number, string>;
}

async function newPlayer(name: string): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { client, socket, notes: [], chat: [], party: null, guild: null, partyInvites: 0, guildInvites: 0, tags: new Map() } as unknown as Player;
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('chat', (m) => player.chat.push(m));
  socket.on('party', (v) => (player.party = v));
  socket.on('guild', (v) => (player.guild = v));
  socket.on('partyInvite', () => player.partyInvites++);
  socket.on('guildInvite', () => player.guildInvites++);
  socket.on('playerGuild', ({ id: pid, tag }) => player.tags.set(pid, tag));
  socket.on('playerJoined', (r) => r.guild && player.tags.set(r.id, r.guild));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  player.session = server.ctx.world.player(payload.character.id)!;
  return player;
}

test('parties: invitation, frames, party chat, shared experience and gold', async () => {
  const ann = await newPlayer('Ann');
  const ben = await newPlayer('Ben');
  const world = server.ctx.world;
  ann.socket.emit('chat', '/invite ben', 'map');
  await until(() => ben.partyInvites === 1);
  ben.socket.emit('partyRespond', true);
  await until(() => ann.party?.members.length === 2 && ben.party?.members.length === 2);
  assert.equal(ben.party!.leader, ann.session.characterId);
  ben.socket.emit('chat', 'On y va ?', 'party');
  await until(() => ann.chat.some((m) => m.channel === 'party' && m.text === 'On y va ?'));

  // Both in the forest: Ann defeats a slime, the experience and gold are split.
  world.transfer(ann.session, DEMO_MAPS.forest, 14, 27, 8);
  world.transfer(ben.session, DEMO_MAPS.forest, 15, 27, 8);
  const slimeView = world.combat.views(DEMO_MAPS.forest).find((v) => v.enemyId === 1)!;
  const slime = world.combat.monster(DEMO_MAPS.forest, slimeView.id)!;
  slime.nextMoveAt = Number.MAX_SAFE_INTEGER;
  const a = ann.session;
  a.x = slime.x;
  a.y = slime.y + 1;
  a.direction = 8;
  const goldA = server.ctx.inventory.gold(a.characterId);
  const goldB = server.ctx.inventory.gold(ben.session.characterId);
  for (let i = 0; i < 20 && !slime.dead; i++) {
    a.combat.nextAttackAt = 0;
    world.combat.attack(a);
  }
  assert.ok(slime.dead);
  assert.equal(a.xp, 4, '8 × 1.1 / 2');
  assert.equal(ben.session.xp, 4);
  assert.equal(server.ctx.inventory.gold(a.characterId), goldA + 2);
  assert.equal(server.ctx.inventory.gold(ben.session.characterId), goldB + 2);

  // The leader changes the loot rule; a member leaves: the party of one ends.
  ann.socket.emit('partyLoot', 'shared');
  await until(() => ben.party?.loot === 'shared');
  ben.socket.emit('partyLeave');
  await until(() => ann.party === null && ben.party === null);
  ann.socket.close();
  ben.socket.close();
});

test('criterion: create a guild, invite a player, manage ranks, use the bank', async () => {
  const cara = await newPlayer('Cara');
  const dan = await newPlayer('Dan');
  const eli = await newPlayer('Eli');
  const world = server.ctx.world;
  const inv = server.ctx.inventory;
  const emblem = { shape: 1, pattern: 2, primary: 0, secondary: 3, symbol: 4, symbolColor: 7 };
  assert.match(emblemSvg(emblem), /^<svg[\s\S]*<\/svg>$/);

  // Creation is paid (1000); not enough gold at first.
  cara.socket.emit('guildCreate', 'Les Lames', 'LAM', emblem);
  await until(() => cara.notes.includes('error.guild.not_enough_gold'));
  world.changeGold(cara.session, 1200);
  cara.socket.emit('guildCreate', 'Les Lames', 'LAM', emblem);
  await until(() => cara.guild !== null);
  assert.equal(cara.guild!.myRank, 0);
  assert.equal(inv.gold(cara.session.characterId), 50 + 1200 - 1000);
  assert.equal(eli.tags.get(cara.session.characterId), 'LAM', 'the tag is shown to the players of the map');
  dan.socket.emit('guildCreate', 'les lames', 'XYZ', emblem);
  await until(() => dan.notes.includes('error.guild.not_enough_gold') || dan.notes.includes('error.guild.name_taken'));

  // Invitation: Dan joins at the lowest rank.
  cara.socket.emit('guildInvite', dan.session.characterId);
  await until(() => dan.guildInvites === 1);
  dan.socket.emit('guildRespond', true);
  await until(() => dan.guild?.members.length === 2);
  assert.equal(dan.guild!.myRank, 3);
  dan.socket.emit('guildInvite', eli.session.characterId);
  await until(() => dan.notes.includes('error.guild.permission'), 2000);

  // Guild chat and message of the day.
  dan.socket.emit('chat', '/g Merci !', 'map');
  await until(() => cara.chat.some((m) => m.channel === 'guild' && m.text === 'Merci !'));
  assert.ok(!eli.chat.some((m) => m.channel === 'guild'), 'only members read the guild chat');
  cara.socket.emit('guildMotd', 'Rendez-vous à la forêt ce soir');
  await until(() => dan.guild?.motd === 'Rendez-vous à la forêt ce soir');

  // Ranks: a recruit cannot deposit; promoted to member (deposit), then officer (withdraw).
  world.changeItems(dan.session, 'item', 1, 3);
  dan.socket.emit('guildBank', 'item', 1, 2, true);
  await until(() => dan.notes.filter((k) => k === 'error.guild.permission').length === 2);
  cara.socket.emit('guildSetRank', dan.session.characterId, 2);
  await until(() => dan.guild?.myRank === 2);
  dan.socket.emit('guildBank', 'item', 1, 2, true);
  await until(() => (cara.guild?.bank.items.find((i) => i.id === 1)?.quantity ?? 0) === 2);
  assert.equal(inv.quantity(dan.session.characterId, 'item', 1), 1);
  dan.socket.emit('guildBank', 'item', 1, 1, false);
  await until(() => dan.notes.filter((k) => k === 'error.guild.permission').length === 3);
  cara.socket.emit('guildSetRank', dan.session.characterId, 1);
  await until(() => dan.guild?.myRank === 1);
  dan.socket.emit('guildBank', 'item', 1, 1, false);
  await until(() => inv.quantity(dan.session.characterId, 'item', 1) === 2);
  dan.socket.emit('guildGold', 5);
  await until(() => cara.guild?.bank.gold === 5);

  // The officer edits a lower rank but cannot touch its own or the leader.
  dan.socket.emit('guildEditRank', 3, 'Aspirant', 63);
  await until(() => cara.guild?.ranks[3]?.name === 'Aspirant');
  assert.equal(cara.guild!.ranks[3]!.permissions, 63, 'an officer holds every permission here');
  dan.socket.emit('guildKick', cara.session.characterId);
  await until(() => dan.notes.filter((k) => k === 'error.guild.permission').length === 4);

  // The log keeps the bank moves; the leader cannot leave while others remain.
  const actions = cara.guild!.log.map((l) => l.action);
  for (const a of ['created', 'joined', 'deposit', 'withdraw', 'deposit_gold', 'rank_edit']) assert.ok(actions.includes(a), a);
  cara.socket.emit('guildLeave');
  await until(() => cara.notes.includes('error.guild.leader_leave'));

  // Guild experience comes from the members' experience.
  world.runner.setExp(dan.session, 200, false);
  await wait(50);
  assert.equal(server.ctx.guilds.get(cara.guild!.id)!.xp, 20);

  // The leader removes the officer; the tag disappears.
  cara.socket.emit('guildKick', dan.session.characterId);
  await until(() => dan.guild === null);
  await until(() => eli.tags.get(dan.session.characterId) === '');
  for (const p of [cara, dan, eli]) p.socket.close();
});

test('deleting a guild leader hands the lead over; a character in the game cannot be deleted', async () => {
  const boss = await newPlayer('Founder');
  const heir = await newPlayer('Heir');
  const repo = server.ctx.guilds;
  const created = repo.create(boss.session.characterId, 'Héritiers', 'HER', { shape: 0, pattern: 0, primary: 1, secondary: 2, symbol: 0, symbolColor: 3 }, 0);
  assert.ok(created.ok);
  const guildId = created.guild.id;
  assert.ok(repo.addMember(guildId, heir.session.characterId, 2));
  server.ctx.world.guilds.playerJoined(heir.session);

  const id = boss.session.characterId;
  const refused = await boss.client.post(`/characters/${id}/delete`, { _csrf: await boss.client.csrf('/characters'), confirmName: 'Founder' });
  assert.equal(refused.status, 409, 'refused while playing');
  boss.socket.close();
  await until(() => !server.ctx.world.player(id));
  const done = await boss.client.post(`/characters/${id}/delete`, { _csrf: await boss.client.csrf('/characters'), confirmName: 'Founder' });
  assert.equal(done.status, 303);
  assert.equal(server.ctx.characters.findById(id), undefined);
  assert.deepEqual(repo.membership(heir.session.characterId), { guildId, rank: 0 }, 'the heir leads');
  assert.equal(heir.session.guild?.rank, 0);
  assert.deepEqual(repo.logLines(guildId).slice(0, 2).map((l) => l.action), ['new_leader', 'deleted']);

  // The last member's character goes: the guild ends.
  heir.socket.close();
  await until(() => !server.ctx.world.player(heir.session.characterId));
  server.ctx.world.guilds.characterDeleted(heir.session.characterId, 'Heir');
  assert.equal(repo.get(guildId), undefined);
});

test('the last member cannot end the guild while its bank still holds something', async () => {
  const solo = await newPlayer('Solo');
  const repo = server.ctx.guilds;
  server.ctx.world.changeGold(solo.session, 1200);
  solo.socket.emit('guildCreate', 'Les Seuls', 'SOL', { shape: 0, pattern: 0, primary: 1, secondary: 2, symbol: 0, symbolColor: 3 });
  await until(() => solo.guild !== null);
  const guildId = solo.guild!.id;
  solo.socket.emit('guildGold', 100);
  await until(() => solo.guild?.bank.gold === 100);

  solo.socket.emit('guildLeave');
  await until(() => solo.notes.includes('error.guild.bank_not_empty'));
  assert.ok(repo.get(guildId), 'the guild is still there');
  assert.equal(repo.get(guildId)!.gold, 100, 'and so is its gold');

  solo.socket.emit('guildGold', -100);
  await until(() => solo.guild?.bank.gold === 0);
  solo.socket.emit('guildLeave');
  await until(() => solo.guild === null);
  assert.equal(repo.get(guildId), undefined, 'an empty guild ends with its last member');
  solo.socket.close();
});
