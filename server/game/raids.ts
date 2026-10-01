/**
 * @file Raid rewards: when the boss of a raid dies in its instance, every
 * player inside who is not locked out receives the gold and experience of the
 * raid and is locked out until the end of the period (day or week, UTC). The
 * items of the loot table go to one of them each: in turn, or after a
 * need / greed roll (each eligible player chooses, the highest need roll wins,
 * otherwise the highest greed roll; unanswered rolls count as a pass).
 */
import type { RaidData } from '../../shared/database.js';
import type { Instance } from './instances.js';
import type { PlayerSession, World } from './world.js';

/** Seconds to answer a loot roll. */
const ROLL_SECONDS = 20;

type Choice = 'need' | 'greed' | 'pass';

interface Roll {
  id: number;
  kind: 'item' | 'weapon' | 'armor';
  itemId: number;
  count: number;
  name: string;
  candidates: Set<number>;
  choices: Map<number, Choice>;
  timer: NodeJS.Timeout;
}

/** End of the current lockout period. */
export function lockoutEnd(mode: RaidData['lockout'], now = Date.now()): number {
  if (mode === 'always') return 0;
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  if (mode === 'daily') return midnight;
  // Weekly: until next Monday 00:00 UTC.
  const daysToMonday = (8 - d.getUTCDay()) % 7 || 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToMonday);
}

/** Raid rewards for the whole world. */
export class RaidService {
  private readonly rolls = new Map<number, Roll>();
  private nextRoll = 1;
  /** Next player receiving an item in turn, per instance. */
  private readonly turns = new Map<number, number>();

  constructor(private readonly world: World) {}

  private get db() {
    return this.world.ctx.db;
  }

  /** End of a character's lockout for a raid (0 = free). */
  lockedUntil(characterId: number, raidId: number, now = Date.now()): number {
    const until = this.db.prepare<[number, number], number>('SELECT until FROM character_raid_lockouts WHERE character_id = ? AND raid_id = ?').pluck().get(characterId, raidId) ?? 0;
    return until > now ? until : 0;
  }

  private lock(characterId: number, raidId: number, until: number): void {
    this.db.prepare(`INSERT INTO character_raid_lockouts (character_id, raid_id, until) VALUES (?, ?, ?)
      ON CONFLICT(character_id, raid_id) DO UPDATE SET until = excluded.until`).run(characterId, raidId, until);
  }

  /** The boss of a raid died in an instance: rewards and loot for the players inside. */
  bossDefeated(raid: RaidData, instance: Instance): void {
    if (instance.bossDefeated) return;
    instance.bossDefeated = true;
    const players = this.world.playersOn(instance.mapId, instance.id).filter((p) => this.world.isLive(p));
    const eligible = players.filter((p) => !this.lockedUntil(p.characterId, raid.id));
    for (const p of players) {
      if (!eligible.includes(p)) {
        p.socket.emit('notify', { key: 'notify.raid_locked', params: { name: raid.name } });
        continue;
      }
      p.socket.emit('notify', { key: 'notify.raid_cleared', params: { name: raid.name } });
      if (raid.rewardGold > 0) this.world.changeGold(p, raid.rewardGold);
      if (raid.rewardExp > 0) {
        p.socket.emit('notify', { key: 'notify.exp_gained', params: { amount: raid.rewardExp } });
        this.world.runner.setExp(p, p.xp + raid.rewardExp, true);
      }
      const until = lockoutEnd(raid.lockout);
      if (until) this.lock(p.characterId, raid.id, until);
    }
    if (eligible.length === 0) return;
    for (const r of raid.rewardItems) {
      const itemId = r.kind === 'item' ? r.item : r.kind === 'weapon' ? r.weapon : r.armor;
      if (itemId <= 0) continue;
      if (raid.lootMode === 'need_greed' && eligible.length > 1) this.startRoll(r.kind, itemId, r.count, eligible);
      else {
        const turn = ((this.turns.get(instance.id) ?? -1) + 1) % eligible.length;
        this.turns.set(instance.id, turn);
        this.give(eligible[turn]!, r.kind, itemId, r.count, eligible, null);
      }
    }
  }

  /** Gives an item of the loot table and tells everybody who got it. */
  private give(winner: PlayerSession, kind: Roll['kind'], itemId: number, count: number, audience: PlayerSession[], roll: number | null): void {
    this.world.changeItems(winner, kind, itemId, count);
    const data = this.world.ctx.gameData;
    const def = kind === 'item' ? data.get('item', itemId) : kind === 'weapon' ? data.get('weapon', itemId) : data.get('armor', itemId);
    for (const p of audience) {
      if (this.world.isLive(p)) this.world.social.system(p, roll === null ? 'notify.loot_given' : 'notify.loot_won', { name: winner.name, item: def?.name ?? '?', roll: roll ?? 0 });
    }
  }

  /** Starts a need / greed roll for one item. */
  private startRoll(kind: Roll['kind'], itemId: number, count: number, candidates: PlayerSession[]): void {
    const data = this.world.ctx.gameData;
    const def = kind === 'item' ? data.get('item', itemId) : kind === 'weapon' ? data.get('weapon', itemId) : data.get('armor', itemId);
    const roll: Roll = {
      id: this.nextRoll++, kind, itemId, count, name: def?.name ?? '?',
      candidates: new Set(candidates.map((c) => c.characterId)), choices: new Map(),
      timer: setTimeout(() => this.resolve(roll.id), ROLL_SECONDS * 1000),
    };
    roll.timer.unref();
    this.rolls.set(roll.id, roll);
    for (const p of candidates) p.socket.emit('lootRoll', { id: roll.id, name: roll.name, icon: def?.icon ?? 0, count, seconds: ROLL_SECONDS });
  }

  /** A player answers a roll. */
  choose(p: PlayerSession, rollId: number, choice: Choice): void {
    const roll = this.rolls.get(rollId);
    if (!roll || !roll.candidates.has(p.characterId) || roll.choices.has(p.characterId)) return;
    roll.choices.set(p.characterId, choice);
    if (roll.choices.size === roll.candidates.size) this.resolve(rollId);
  }

  private resolve(rollId: number): void {
    const roll = this.rolls.get(rollId);
    if (!roll) return;
    this.rolls.delete(rollId);
    clearTimeout(roll.timer);
    const audience = [...roll.candidates].map((id) => this.world.player(id)).filter((p): p is PlayerSession => !!p && this.world.isLive(p));
    for (const wanted of ['need', 'greed'] as const) {
      const rolls = audience.filter((p) => roll.choices.get(p.characterId) === wanted).map((p) => ({ p, value: 1 + Math.floor(Math.random() * 100) }));
      if (rolls.length === 0) continue;
      rolls.sort((a, b) => b.value - a.value);
      this.give(rolls[0]!.p, roll.kind, roll.itemId, roll.count, audience, rolls[0]!.value);
      return;
    }
    for (const p of audience) this.world.social.system(p, 'notify.loot_passed', { item: roll.name });
  }
}
