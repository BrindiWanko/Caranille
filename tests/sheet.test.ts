/**
 * @file Character sheet tests, and the step criterion over sockets: the
 * whole item cycle (pick up from a chest, buy, equip, sell) is persistent;
 * equipment changes the parameters (and maximum HP), class restrictions and
 * slots are enforced, points are distributed, and the bank keeps items and
 * gold with the bag, never duplicating anything.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { BankPayload, SheetPayload, ShopPayload } from '../shared/character.js';
import type { GameEvent } from '../shared/events.js';
import type { ClientToServerEvents, EnterWorldPayload, InventoryPayload, ServerToClientEvents } from '../shared/protocol.js';
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
  client: TestClient;
  session: PlayerSession;
  notes: string[];
  sheet: SheetPayload | null;
  inventory: InventoryPayload;
  shop: { payload: ShopPayload; close: () => void } | null;
  bank: { payload: BankPayload; close: () => void } | null;
  payload: EnterWorldPayload;
}

async function connectPlayer(client: TestClient, characterId: number): Promise<Player> {
  await client.post(`/characters/${characterId}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { socket, client, notes: [], sheet: null, inventory: { gold: 0, entries: [] }, shop: null, bank: null } as unknown as Player;
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('sheet', (s) => (player.sheet = s));
  socket.on('inventory', (i) => (player.inventory = i));
  socket.on('showMessage', (_m, ack) => ack(0));
  socket.on('shopOpen', (payload, ack) => (player.shop = { payload, close: () => ack() }));
  socket.on('bankOpen', (payload, ack) => (player.bank = { payload, close: () => ack() }));
  socket.on('bank', (payload) => player.bank && (player.bank.payload = payload));
  player.payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  player.session = server.ctx.world.player(player.payload.character.id)!;
  return player;
}

async function newPlayer(name: string, classId = 1): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name: `${name}Hero`, classId: String(classId) });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  return connectPlayer(client, id);
}

/** Stands below a village event, faces it and presses Action (does not wait for the run). */
function actOn(player: Player, name: string): void {
  const def = server.ctx.maps.get(1)!.events.find((e) => e?.name === name) as GameEvent;
  const p = player.session;
  p.x = def.x;
  p.y = def.y + 1;
  p.direction = 8;
  server.ctx.world.action(p);
}

const qty = (player: Player, kind: string, id: number) => server.ctx.inventory.quantity(player.session.characterId, kind as 'item', id);

test('criterion: pick up, buy, equip, sell — persistent, with parameters and restrictions', async () => {
  const eve = await newPlayer('Buyer');
  const p = eve.session;
  const world = server.ctx.world;
  await until(() => eve.sheet !== null);
  const baseAtk = eve.sheet!.params.atk;
  const baseHp = p.hp;

  // Pick up: the village chest gives 2 potions and 30 gold.
  actOn(eve, 'Coffre');
  await until(() => !p.busy && qty(eve, 'item', 1) === 2);

  // Buy a short sword from Gaspard.
  world.changeGold(p, 250);
  actOn(eve, 'Marchand');
  await until(() => eve.shop !== null);
  const goods = eve.shop!.payload.goods;
  const sword = goods.findIndex((g) => g.kind === 'weapon' && g.id === 1);
  const bow = goods.findIndex((g) => g.kind === 'weapon' && g.id === 3);
  assert.ok(sword >= 0 && bow >= 0);
  const gold = server.ctx.inventory.gold(p.characterId);
  eve.socket.emit('shopBuy', sword, 1);
  await until(() => qty(eve, 'weapon', 1) === 1);
  assert.equal(server.ctx.inventory.gold(p.characterId), gold - 100);
  eve.socket.emit('shopBuy', bow, 5);
  await until(() => eve.notes.includes('error.shop.not_enough_gold'));
  assert.equal(qty(eve, 'weapon', 3), 0, 'nothing bought without the gold');
  eve.shop!.close();
  await until(() => !p.busy);
  assert.equal(p.ui, null, 'shop actions stop once it is closed');
  eve.socket.emit('shopBuy', sword, 1);
  await wait(100);
  assert.equal(qty(eve, 'weapon', 1), 1);

  // Equip the sword: attack goes up; a bow (archer weapon) is refused to a warrior.
  eve.socket.emit('equip', 'weapon', 1);
  await until(() => eve.sheet!.equipment.weapon?.id === 1);
  assert.equal(eve.sheet!.params.atk, baseAtk + 8);
  assert.equal(qty(eve, 'weapon', 1), 0, 'the equipped sword left the bag');
  world.changeItems(p, 'weapon', 3, 1);
  eve.socket.emit('equip', 'weapon', 3);
  await until(() => eve.notes.includes('error.equip.class'));
  eve.socket.emit('equip', 'head', 1);
  await until(() => eve.notes.includes('error.equip.invalid'));
  world.changeItems(p, 'armor', 5, 1);
  eve.socket.emit('equip', 'accessory', 5);
  await until(() => eve.sheet!.equipment.accessory?.id === 5);
  assert.equal(world.maxVitals(p).maxHp, baseHp + 30, 'the ring raises maximum HP');

  // Distribute points after a level up.
  world.runner.setExp(p, 30, false);
  await until(() => (eve.sheet?.freePoints ?? 0) === 3);
  eve.socket.emit('allocate', 'atk');
  await until(() => eve.sheet!.freePoints === 2);
  assert.equal(eve.sheet!.allocated.atk, 1);

  // Sell: the sword back to the bag, then to Gaspard at half price.
  eve.socket.emit('equip', 'weapon', 0);
  await until(() => qty(eve, 'weapon', 1) === 1);
  actOn(eve, 'Marchand');
  await until(() => eve.shop !== null && p.ui?.kind === 'shop');
  const before = server.ctx.inventory.gold(p.characterId);
  eve.socket.emit('shopSell', 'weapon', 1, 1);
  await until(() => qty(eve, 'weapon', 1) === 0);
  assert.equal(server.ctx.inventory.gold(p.characterId), before + 50);
  eve.socket.emit('shopSell', 'weapon', 1, 1);
  await wait(100);
  assert.equal(server.ctx.inventory.gold(p.characterId), before + 50, 'cannot sell what is not owned');
  eve.shop!.close();
  await until(() => !p.busy);

  // Everything survives a reconnection.
  const id = p.characterId;
  eve.socket.close();
  await wait(100);
  const again = await connectPlayer(eve.client, id);
  await until(() => again.sheet !== null);
  assert.equal(again.sheet!.equipment.accessory?.id, 5);
  assert.equal(again.sheet!.allocated.atk, 1);
  assert.equal(server.ctx.inventory.gold(id), before + 50);
  assert.equal(again.payload.character.maxHp, world.maxVitals(again.session).maxHp);
  again.socket.close();
});

test('the bank keeps items and gold; the inn heals and sets the respawn point', async () => {
  const bob = await newPlayer('Saver');
  const p = bob.session;
  const world = server.ctx.world;
  world.changeItems(p, 'item', 1, 5);
  actOn(bob, 'Banquière');
  await until(() => bob.bank !== null);
  bob.socket.emit('bankMove', 'item', 1, 3, true);
  await until(() => bob.bank!.payload.entries.some((e) => e.id === 1 && e.quantity === 3));
  assert.equal(qty(bob, 'item', 1), 2);
  bob.socket.emit('bankMove', 'item', 1, 10, false);
  await until(() => qty(bob, 'item', 1) === 5);
  assert.equal(bob.bank!.payload.entries.length, 0, 'all withdrawn, nothing duplicated');
  const gold = server.ctx.inventory.gold(p.characterId);
  bob.socket.emit('bankGold', 20);
  await until(() => bob.bank!.payload.gold === 20);
  assert.equal(server.ctx.inventory.gold(p.characterId), gold - 20);
  bob.socket.emit('bankGold', 999);
  await wait(100);
  assert.equal(bob.bank!.payload.gold, 20, 'cannot deposit more than owned');
  bob.bank!.close();
  await until(() => !p.busy);

  // The inn: pays, heals, and becomes the respawn point.
  p.hp = 10;
  actOn(bob, 'Aubergiste');
  await until(() => !p.busy && p.hp > 10, 6000);
  assert.deepEqual(server.ctx.progression.respawn(p.characterId), { mapId: 1, x: 10, y: 25 });
  assert.equal(server.ctx.inventory.gold(p.characterId), gold - 20 - 20);
  bob.socket.close();
});
