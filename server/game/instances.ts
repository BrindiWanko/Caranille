/**
 * @file Instanced maps (dungeons, raids).
 *
 * A map marked "instance" in its properties gets a private copy for each
 * party (or each player without a party): its own monsters, its own instance
 * switches, its own chat room. Players of the same party entering the map
 * join the same copy. A raid defined in the database on that map also sets
 * access conditions (level, party size). Instances without players are closed
 * after the delay of the System settings.
 */
import type { RaidData } from '../../shared/database.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import type { PlayerSession, World } from './world.js';

/** One copy of an instanced map. */
export interface Instance {
  id: number;
  mapId: number;
  /** Owner key: party or player. */
  owner: string;
  /** Instance switches (shared by the players of this copy). */
  switches: Set<number>;
  createdAt: number;
  emptySince: number;
  /** The boss of the raid was defeated in this copy. */
  bossDefeated: boolean;
}

/** Instances for the whole world. */
export class InstanceService {
  private readonly instances = new Map<number, Instance>();
  /** Instance of each owner on each map: `mapId:owner` → instance id. */
  private readonly byOwner = new Map<string, number>();
  private nextId = 1;

  constructor(private readonly world: World) {
    const timer = setInterval(() => this.cleanup(), 30_000);
    timer.unref();
  }

  /** Raid defined on a map, if any. */
  raidOn(mapId: number): RaidData | undefined {
    return this.world.ctx.gameData.list('raid').find((r) => r.mapId === mapId);
  }

  /** The instance a player is in. */
  of(p: PlayerSession): Instance | undefined {
    return p.instance ? this.instances.get(p.instance) : undefined;
  }

  get(id: number): Instance | undefined {
    return this.instances.get(id);
  }

  /** Open instances (administration). */
  list(): Instance[] {
    return [...this.instances.values()];
  }

  /**
   * Instance a player enters on an instanced map (created if needed).
   * @returns The instance id, or a translation key explaining a refusal.
   */
  enter(p: PlayerSession, mapId: number): number | string {
    const raid = this.raidOn(mapId);
    const party = this.world.party.info(p);
    if (raid) {
      const size = party?.members.length ?? 1;
      if (p.level < raid.minLevel) return 'error.instance.level';
      if (size < raid.minPlayers) return 'error.instance.too_few';
      if (size > raid.maxPlayers) return 'error.instance.too_many';
    }
    const owner = party ? `p${party.id}` : `c${p.characterId}`;
    const key = `${mapId}:${owner}`;
    const existing = this.byOwner.get(key);
    if (existing && this.instances.has(existing)) return existing;
    const instance: Instance = { id: this.nextId++, mapId, owner, switches: new Set(), createdAt: Date.now(), emptySince: 0, bossDefeated: false };
    this.instances.set(instance.id, instance);
    this.byOwner.set(key, instance.id);
    return instance.id;
  }

  /** Players inside an instance. */
  players(instance: Instance): PlayerSession[] {
    return this.world.playersOn(instance.mapId, instance.id);
  }

  /** Closes the instances left empty for too long. */
  cleanup(now = Date.now()): void {
    const idle = this.world.ctx.settings.get('instanceIdleMinutes', DEFAULT_SETTINGS.instanceIdleMinutes) * 60_000;
    for (const [id, instance] of this.instances) {
      if (this.players(instance).length > 0) {
        instance.emptySince = 0;
        continue;
      }
      instance.emptySince ||= now;
      if (now - instance.emptySince < idle) continue;
      this.instances.delete(id);
      this.byOwner.delete(`${instance.mapId}:${instance.owner}`);
      this.world.combat.dropZone(instance.mapId, id);
    }
  }
}
