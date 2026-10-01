/**
 * @file Quest tests: the demo's first chapter played from start to end over
 * sockets (quest markers, talk / reach / collect objectives, steps, rewards,
 * prerequisites, the cinematic's screen effects, automatic completion), and a
 * quest with a kill objective built entirely through the editor API.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { defaultRecord } from '../shared/database-schema.js';
import type { QuestData } from '../shared/database.js';
import { Cmd, MmoCmd, createPage, textCommands, type EventView, type GameEvent } from '../shared/events.js';
import type { MapData } from '../shared/map.js';
import type { ClientToServerEvents, EffectPayload, EnterWorldPayload, MessagePayload, ServerToClientEvents } from '../shared/protocol.js';
import type { QuestJournalPayload } from '../shared/quests.js';
import { DEMO_EVENTS, DEMO_MAPS } from '../server/db/demo-map.js';
import { Marker } from '../server/game/quests.js';
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

interface Player {
  socket: ClientSocket;
  client: TestClient;
  session: PlayerSession;
  messages: MessagePayload[];
  answers: number[];
  notes: string[];
  effects: EffectPayload[];
  /** Page and marker of each event of the current map, as last told by the server. */
  views: Map<number, EventView | null>;
  journal: QuestJournalPayload;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(10);
  }
}

async function account(name: string) {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  const csrf = await client.csrf('/characters');
  const api = async <T>(method: string, path: string, body?: unknown) => {
    const res = await client.request(`/api/editor${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { client, api };
}

async function newPlayer(name: string): Promise<Player> {
  const { client } = await account(name);
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name: `${name}Hero`, classId: '1' });
  const characterId = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${characterId}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { socket, client, messages: [], answers: [], notes: [], effects: [], views: new Map(), journal: { quests: [] } } as unknown as Player;
  const track = (views: EventView[]) => views.forEach((v) => player.views.set(v.id, v));
  socket.on('showMessage', (m, ack) => {
    player.messages.push(m);
    ack(player.answers.shift() ?? 0);
  });
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('effect', (e) => player.effects.push(e));
  socket.on('quests', (j) => (player.journal = j));
  socket.on('eventsChanged', ({ views, removed }) => {
    track(views);
    removed.forEach((id) => player.views.set(id, null));
  });
  socket.on('mapChange', (payload) => {
    player.views.clear();
    track(payload.events);
  });
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  track(payload.events);
  player.session = server.ctx.world.player(payload.character.id)!;
  return player;
}

const markerOf = (player: Player, id: number) => player.views.get(id)?.marker ?? Marker.None;
const pageOf = (player: Player, id: number) => player.views.get(id)?.page ?? -1;
const quest = (player: Player, id: number) => player.journal.quests.find((q) => q.id === id);

/** Stands below an event of the player's map, faces it and presses Action; waits for the run to end. */
async function actOn(player: Player, eventId: number, ms = 3000): Promise<void> {
  const p = player.session;
  const def = server.ctx.maps.get(p.mapId)!.events.find((e) => e?.id === eventId)!;
  p.x = def.x;
  p.y = def.y + 1;
  p.direction = 8;
  server.ctx.world.action(p);
  await wait(30);
  await until(() => !p.busy, ms);
  await wait(30);
}

function goTo(player: Player, mapId: number, x: number, y: number): void {
  assert.ok(server.ctx.world.transfer(player.session, mapId, x, y, 8));
}

test('the demo events used by the chapter 1 quests have the expected ids', () => {
  const name = (mapId: number, id: number) => server.ctx.maps.get(mapId)!.events.find((e) => e?.id === id)?.name;
  assert.equal(name(DEMO_MAPS.village, DEMO_EVENTS.guard), 'Garde');
  assert.equal(name(DEMO_MAPS.village, DEMO_EVENTS.sage), 'Sage');
  assert.equal(name(DEMO_MAPS.forest, DEMO_EVENTS.borin), 'Bûcheron');
});

test('criterion: chapter 1 is playable from start to end (markers, objectives, steps, rewards, cinematic)', async () => {
  const eve = await newPlayer('Eve');
  const p = eve.session;
  const inv = server.ctx.inventory;
  const { sage, guard, borin } = DEMO_EVENTS;
  await until(() => markerOf(eve, sage) === Marker.Available);
  assert.equal(markerOf(eve, guard), Marker.None);

  // Quest 2 is locked for quest 3's prerequisite.
  assert.equal(server.ctx.world.quests.start(p, 3), false);
  await until(() => eve.notes.includes('notify.quest_locked_prerequisite'));

  // The sage gives quest 2 (tutorial message, then the offer with choices).
  eve.answers.push(0, 0);
  await actOn(eve, sage);
  assert.deepEqual(eve.messages.find((m) => m.choices)?.choices, ['J’y vais !', 'Plus tard']);
  await until(() => quest(eve, 2)?.status === 1);
  assert.deepEqual(quest(eve, 2)!.objectives.map((o) => [o.kind, o.target, o.done]), [['talk', 'Garde', false]]);
  await until(() => markerOf(eve, sage) === Marker.None);
  await until(() => markerOf(eve, guard) === Marker.TurnIn); // the NPC to talk to is marked

  // Step 1: talk to the guard.
  await actOn(eve, guard);
  assert.match(eve.messages.at(-1)!.text, /forêt de Bruyère/);
  await until(() => quest(eve, 2)!.objectives[0]?.kind === 'reach');
  assert.equal(quest(eve, 2)!.steps.length, 2);
  await until(() => markerOf(eve, guard) === Marker.None);

  // Step 2: reach the forest; the herbs appear for this player.
  goTo(eve, DEMO_MAPS.forest, 14, 28);
  await until(() => quest(eve, 2)!.objectives[0]?.kind === 'collect');
  const herbs = server.ctx.maps.get(DEMO_MAPS.forest)!.events.filter((e): e is GameEvent => e?.name === 'Herbe médicinale').map((e) => e.id);
  assert.equal(herbs.length, 3);
  await until(() => herbs.every((id) => pageOf(eve, id) === 1));

  // Step 3: pick two herbs; the quest becomes ready to hand in.
  await actOn(eve, herbs[0]!);
  assert.equal(inv.quantity(p.characterId, 'item', 4), 1);
  await until(() => pageOf(eve, herbs[0]!) === 2);
  assert.equal(quest(eve, 2)!.objectives[0]!.progress, 1);
  await actOn(eve, herbs[0]!);
  assert.equal(inv.quantity(p.characterId, 'item', 4), 1, 'a herb is picked once');
  await actOn(eve, herbs[1]!);
  await until(() => quest(eve, 2)?.status === 3);
  await until(() => eve.notes.includes('notify.quest_ready'));
  await until(() => pageOf(eve, herbs[2]!) === 1, 1000);

  // Back to the sage: rewards, collected herbs taken, next quest offered.
  goTo(eve, DEMO_MAPS.village, 12, 13);
  await until(() => markerOf(eve, sage) === Marker.TurnIn);
  const gold = inv.gold(p.characterId);
  const potions = inv.quantity(p.characterId, 'item', 1);
  await actOn(eve, sage);
  await until(() => quest(eve, 2)?.status === 2);
  assert.equal(inv.gold(p.characterId), gold + 80);
  assert.equal(inv.quantity(p.characterId, 'item', 1), potions + 2);
  assert.equal(inv.quantity(p.characterId, 'item', 4), 0, 'the collected herbs were handed in');
  assert.equal(p.xp, 60);
  assert.equal(p.level, 2, 'the experience reward levels up');
  await until(() => markerOf(eve, sage) === Marker.Available, 1000);

  // Quest 3: accepted from the sage, then Borin's cinematic in the forest.
  eve.answers.push(0);
  await actOn(eve, sage);
  await until(() => quest(eve, 3)?.status === 1);
  goTo(eve, DEMO_MAPS.forest, 12, 18);
  await until(() => markerOf(eve, borin) === Marker.TurnIn);
  eve.effects.length = 0;
  await actOn(eve, borin, 10_000);
  const kinds = eve.effects.map((e) => (e.kind === 'screenFade' ? `fade-${e.out ? 'out' : 'in'}` : e.kind));
  for (const k of ['shake', 'flash', 'balloon', 'tint', 'fade-out', 'fade-in']) assert.ok(kinds.includes(k), k);
  assert.ok(kinds.indexOf('fade-out') < kinds.indexOf('fade-in'));
  await until(() => quest(eve, 3)!.objectives[0]?.label === 'Prévenir le vieux sage');

  // Telling the sage completes the quest on its own (automatic completion).
  goTo(eve, DEMO_MAPS.village, 12, 13);
  await until(() => markerOf(eve, sage) === Marker.TurnIn);
  await actOn(eve, sage);
  await until(() => quest(eve, 3)?.status === 2);
  assert.equal(inv.quantity(p.characterId, 'item', 3), 1, 'reward of quest 3');
  await until(() => markerOf(eve, sage) === Marker.None);
  assert.deepEqual(eve.journal.quests.map((q) => [q.id, q.status]).sort(), [[2, 2], [3, 2]]);

  // Progress (steps and counters included) is stored.
  const stored = server.ctx.progression.load(p.characterId).quests;
  assert.equal(stored.get(2)?.status, 2);
  assert.equal(stored.get(3)?.status, 2);
  eve.socket.close();
});

test('a quest built through the editor: kill objective, prerequisite level, rewards', async () => {
  const admin = await account('QuestAdmin');
  // The first account of this server is the administrator (Eve's account came first, so promote this one).
  server.ctx.accounts.setRole(server.ctx.accounts.findByUsername('QuestAdmin')!.id, 'admin');
  const record: QuestData = {
    ...defaultRecord('quest', 0),
    name: 'Chasse aux slimes',
    level: 1,
    autoComplete: true,
    steps: [{ description: 'Battez deux slimes.', objectives: [{ kind: 'kill', mapId: 1, eventId: 1, enemyId: 1, itemId: 1, switchId: 1, x: 0, y: 0, radius: 0, count: 2, label: '' }] }],
    rewardGold: 25,
    rewardItems: [{ kind: 'weapon', item: 1, weapon: 1, armor: 1, count: 1 }],
  };
  const created = await admin.api<{ record: QuestData }>('POST', '/db/quest', {});
  assert.equal(created.status, 200);
  const questId = created.body.record.id;
  const saved = await admin.api<{ record: QuestData }>('PUT', `/db/quest/${questId}`, { record: { ...record, id: questId } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.record.steps[0]!.objectives[0]!.count, 2);

  // An NPC giving the quest, added to the village with the map editor.
  assert.equal((await admin.api('POST', '/maps/1/lock')).status, 200);
  const { body } = await admin.api<{ map: MapData }>('GET', '/maps/1');
  const map = body.map;
  const id = map.events.length;
  map.events.push({ id, name: 'Chasseur', note: '', x: 5, y: 20, pages: [createPage({ image: { tileId: 0, characterName: 'People1', characterIndex: 0, direction: 2, pattern: 1 }, list: [...textCommands(['Les slimes envahissent les champs !']), { code: MmoCmd.StartQuest, indent: 0, parameters: [questId] }, { code: Cmd.End, indent: 0, parameters: [] }] })] });
  assert.equal((await admin.api('PUT', '/maps/1', { map })).status, 200);

  const finn = await newPlayer('Finn');
  await until(() => markerOf(finn, id) === Marker.Available);
  await actOn(finn, id);
  await until(() => quest(finn, questId)?.status === 1);
  assert.equal(quest(finn, questId)!.objectives[0]!.target, 'Slime bleu');
  const world = server.ctx.world;
  world.quests.onKill(finn.session, 2);
  world.quests.onKill(finn.session, 1);
  await until(() => quest(finn, questId)!.objectives[0]!.progress === 1);
  await until(() => finn.notes.includes('notify.quest_progress'));
  const gold = server.ctx.inventory.gold(finn.session.characterId);
  world.quests.onKill(finn.session, 1);
  await until(() => quest(finn, questId)?.status === 2);
  assert.equal(server.ctx.inventory.gold(finn.session.characterId), gold + 25);
  assert.equal(server.ctx.inventory.quantity(finn.session.characterId, 'weapon', 1), 1);
  assert.equal(markerOf(finn, id), Marker.None, 'no marker once the quest is done');
  finn.socket.close();
});
