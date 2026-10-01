/**
 * @file Combat tests: damage formulas (parsing, safety), and the step
 * criterion over sockets: fighting monsters for experience, gold and items up
 * to a level up, skills with cost and cooldown, aggressive monsters, being
 * knocked out and reappearing, and the validation of map spawns.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { DamageView } from '../shared/combat.js';
import { checkFormula, evalFormula } from '../shared/formula.js';
import { validateMap } from '../shared/map-validation.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { buildDemoForest, DEMO_MAPS } from '../server/db/demo-map.js';
import type { Monster } from '../server/game/combat.js';
import { attackElement, elementRate, stateRate, traitSum } from '../server/game/stats.js';
import type { PlayerSession } from '../server/game/world.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

test('formulas: arithmetic, parameters, functions, and nothing else', () => {
  const a = { atk: 20, def: 5, level: 3, hp: 50 };
  const b = { atk: 10, def: 8 };
  assert.equal(evalFormula('a.atk * 4 - b.def * 2', a, b), 64);
  assert.equal(evalFormula('(a.atk + 2) * 2 % 7', a, b), 2);
  assert.equal(evalFormula('Math.max(1, a.level * 10 - b.atk)', a, b), 20);
  assert.equal(evalFormula('a.hp < 60 ? 100 : 0', a, b), 100);
  assert.equal(evalFormula('v[3] + 1', a, b, (id) => id * 10), 31);
  assert.equal(evalFormula('-a.def + +2', a, b), -3);
  assert.equal(evalFormula('a.atk / 0', a, b), 0, 'division by zero gives 0');
  for (const bad of ['process.exit()', 'a.constructor', 'this', 'a.atk; 1', 'eval("1")', 'a[0]', '1 +', 'x = 2']) {
    assert.notEqual(checkFormula(bad), null, bad);
    assert.equal(evalFormula(bad, a, b), 0);
  }
  assert.equal(checkFormula('a.mat * 3 + 20'), null);
});

test('battle parameters: element rates, attack element, additive traits, state resistance', () => {
  const traits = [
    { kind: 'element_rate' as const, target: '2', value: 2 },
    { kind: 'element_rate' as const, target: '2', value: 0.5 },
    { kind: 'element_rate' as const, target: '3', value: 0 },
    { kind: 'attack_element' as const, target: '2', value: 1 },
    { kind: 'critical' as const, target: '', value: 0.1 },
    { kind: 'critical' as const, target: '', value: 0.05 },
    { kind: 'state_resist' as const, target: '1', value: 0.5 },
  ];
  assert.equal(elementRate(traits, 2), 1, 'rates multiply');
  assert.equal(elementRate(traits, 3), 0, 'immunity');
  assert.equal(elementRate(traits, 0), 1, 'no element');
  assert.equal(attackElement(traits), 2);
  assert.ok(Math.abs(traitSum(traits, 'critical') - 0.15) < 1e-9);
  assert.equal(stateRate(traits, 1), 0.5);
  assert.equal(stateRate(traits, 2), 1);
});

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
  damage: DamageView[];
  died: number;
  payload: EnterWorldPayload;
}

async function newPlayer(name: string, classId = 1): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name: `${name}Hero`, classId: String(classId) });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { socket, notes: [], damage: [], died: 0 } as unknown as Player;
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('damage', (views) => player.damage.push(...views));
  socket.on('playerDied', () => player.died++);
  player.payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  player.session = server.ctx.world.player(player.payload.character.id)!;
  return player;
}

/** Living monsters of the forest with a given enemy id, frozen in place. */
function monsters(enemyId: number): Monster[] {
  const world = server.ctx.world;
  return world.combat
    .views(DEMO_MAPS.forest)
    .filter((v) => v.enemyId === enemyId)
    .map((v) => world.combat.monster(DEMO_MAPS.forest, v.id)!)
    .filter((m) => !m.dead);
}

/** Puts the player right below a monster, facing it, and freezes the monster. */
function faceMonster(p: PlayerSession, m: Monster): void {
  m.nextMoveAt = Number.MAX_SAFE_INTEGER;
  m.nextActionAt = Number.MAX_SAFE_INTEGER;
  // Free the cell below the monster if another monster stands there.
  p.x = m.x;
  p.y = m.y + 1;
  p.direction = 8;
}

test('criterion: fight monsters, gain experience, gold and items, level up', async () => {
  const eve = await newPlayer('Warrior');
  const p = eve.session;
  const world = server.ctx.world;
  assert.ok(world.transfer(p, DEMO_MAPS.forest, 14, 28, 8));
  assert.equal(monsters(1).length, 4, 'the forest spawns four slimes');
  assert.equal(p.level, 1);
  const gold = server.ctx.inventory.gold(p.characterId);
  let kills = 0;
  for (const slime of monsters(1)) {
    faceMonster(p, slime);
    for (let i = 0; i < 20 && !slime.dead; i++) {
      p.combat.nextAttackAt = 0;
      world.combat.attack(p);
    }
    assert.ok(slime.dead, 'the slime is defeated');
    kills++;
  }
  assert.equal(kills, 4);
  await until(() => eve.damage.some((d) => d.target.kind === 'monster' && d.kind === 'hp_damage'));
  assert.equal(p.xp, 32, '4 × 8 experience');
  assert.equal(p.level, 2, 'level up after 30 experience');
  await until(() => eve.notes.includes('notify.level_up'));
  assert.equal(server.ctx.inventory.gold(p.characterId), gold + 20, '4 × 5 gold');
  assert.equal(monsters(1).length, 0);
  // Defeated monsters come back after their respawn delay.
  const dead = world.combat.views(DEMO_MAPS.forest).length;
  for (const m of [...Array(20).keys()].map((i) => world.combat.monster(DEMO_MAPS.forest, i + 1)).filter((x): x is Monster => !!x && x.dead)) m.respawnAt = 0;
  world.combat.tick();
  assert.ok(world.combat.views(DEMO_MAPS.forest).length > dead, 'respawned');
  eve.socket.close();
});

test('skills cost MP and have a cooldown; a knocked out player reappears at its respawn point', async () => {
  const bob = await newPlayer('Fighter');
  const p = bob.session;
  const world = server.ctx.world;
  world.transfer(p, DEMO_MAPS.forest, 14, 28, 8);
  const slime = monsters(1)[0] ?? monsters(6)[0]!;
  faceMonster(p, slime);
  const mp = p.mp;
  world.combat.useSkill(p, 1);
  assert.equal(p.mp, mp - 3, 'Coup puissant costs 3 MP');
  p.combat.globalReadyAt = 0;
  world.combat.useSkill(p, 1);
  assert.equal(p.mp, mp - 3, 'still in cooldown');
  world.combat.useSkill(p, 3);
  assert.equal(p.mp, mp - 3, 'a skill of another class is refused');

  // An aggressive bat attacks a player standing near it.
  const bat = monsters(2)[0]!;
  bat.nextActionAt = 0;
  bat.nextMoveAt = 0;
  bat.mode = 'chase';
  bat.targetId = p.characterId;
  p.x = bat.x;
  p.y = bat.y + 1;
  const hp = p.hp;
  await until(() => p.hp < hp || bob.damage.some((d) => d.target.kind === 'player' && d.kind === 'miss'), 8000);

  // Knocked out: back to the start position of the village after the delay.
  p.hp = 1;
  p.combat.states.clear();
  const bats = monsters(2);
  for (const b of bats) {
    b.nextActionAt = 0;
    b.mode = 'chase';
    b.targetId = p.characterId;
  }
  await until(() => bob.died > 0, 8000);
  assert.equal(p.combat.dead, true);
  world.move(p, 2, p.epoch);
  await until(() => p.mapId === DEMO_MAPS.village, 6000);
  assert.equal(p.combat.dead, false);
  assert.ok(p.hp > 1, 'full HP after reappearing');
  bob.socket.close();
});

test('map spawns are validated; the hotbar is stored', async () => {
  const forest = buildDemoForest();
  assert.equal(validateMap(forest, () => true), null);
  assert.equal(validateMap({ ...forest, mmo: { ...forest.mmo, spawns: [{ enemyId: 1, count: 999, region: 0 }] } }, () => true), 'mmo.spawns');
  const cat = await newPlayer('Keeper');
  const p = cat.session;
  assert.deepEqual(p.combat.hotbar[0], { kind: 'skill', id: 1 }, 'known skills fill an empty hotbar');
  server.ctx.world.combat.setHotbar(p, [{ kind: 'item', id: 1 }, null, { kind: 'skill', id: 1 }, { kind: 'bogus', id: 3 } as never]);
  assert.deepEqual(server.ctx.progression.hotbar(p.characterId).slice(0, 4), [{ kind: 'item', id: 1 }, null, { kind: 'skill', id: 1 }, null]);
  cat.socket.close();
});

test('the event command "Battle" makes the enemy appear next to the player and attack it', async () => {
  const hero = await newPlayer('Ambushed');
  const spawned: number[] = [];
  hero.socket.on('monsterSpawned', (m) => spawned.push(m.id));
  await server.ctx.world.runner.runCommonList(hero.session, [{ code: 301, indent: 0, parameters: [0, 2, false, false] }, { code: 0, indent: 0, parameters: [] }]);
  await until(() => spawned.length === 1);
  const m = server.ctx.world.combat.monster(hero.session.mapId, spawned[0]!, hero.session.instance)!;
  assert.equal(m.def.id, 2);
  assert.equal(m.summoned, true, 'removed for good once defeated');
  assert.equal(m.mode, 'chase');
  assert.equal(m.targetId, hero.session.characterId);
  assert.ok(Math.abs(m.x - hero.session.x) <= 3 && Math.abs(m.y - hero.session.y) <= 3);
  hero.socket.close();
});
