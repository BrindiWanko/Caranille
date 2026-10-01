/**
 * @file Quest rules on the server: starting a quest (prerequisites), tracking
 * the objectives of the current step, moving through steps, completing a
 * quest (rewards), the quest markers above NPCs and the journal sent to the
 * player.
 *
 * Objectives are tracked from game facts: talking to an event (end of its
 * run), defeating an enemy (`onKill`), standing in a place (`onMove`), and
 * state checks for items and switches (`check`, called whenever the events
 * of the player are refreshed, which happens after every change of items,
 * switches, level or quests). Counters of the current step are stored with
 * the quest progress, so a quest resumes exactly where it was.
 */
import type { QuestData, QuestObjective } from '../../shared/database.js';
import { MmoCmd, QuestStatus } from '../../shared/events.js';
import type { QuestJournalPayload, QuestObjectiveView, QuestView } from '../../shared/quests.js';
import type { QuestProgress } from '../db/progression.js';
import { MapRuntime, type EventInstance } from './map-runtime.js';
import type { PlayerSession, World } from './world.js';

/** Marker values of {@link EventView.marker}. */
export const Marker = { None: 0, Available: 1, TurnIn: 2 } as const;

/** Quest commands of the interpreter. */
export type QuestCommand = 'start' | 'advance' | 'complete';

/** Quest rules for every player. */
export class QuestService {
  /** Players whose objectives are being checked (re-entrance guard). */
  private readonly checking = new Set<number>();
  /** Last journal sent to each player (unchanged journals are not sent again). */
  private readonly sent = new Map<number, string>();

  constructor(private readonly world: World) {}

  private get ctx() {
    return this.world.ctx;
  }

  private quest(id: number): QuestData | undefined {
    return this.ctx.gameData.get('quest', id);
  }

  // --- Status -----------------------------------------------------------------

  /**
   * Status of a quest for a player, including `Ready` (every step done, not
   * handed in yet).
   */
  status(p: PlayerSession, questId: number): number {
    const q = p.progress.quests.get(questId);
    if (!q) return QuestStatus.NotStarted;
    if (q.status === 2) return QuestStatus.Completed;
    const steps = this.quest(questId)?.steps.length ?? 0;
    return steps > 0 && q.step >= steps ? QuestStatus.Ready : QuestStatus.InProgress;
  }

  /**
   * Why a player cannot start a quest, or `null` when it can.
   * @returns A translation key.
   */
  lockReason(p: PlayerSession, quest: QuestData): string | null {
    if (p.progress.quests.has(quest.id)) return 'notify.quest_already';
    if (p.level < quest.level) return 'notify.quest_locked_level';
    if (quest.prerequisite > 0 && p.progress.quests.get(quest.prerequisite)?.status !== 2) return 'notify.quest_locked_prerequisite';
    return null;
  }

  // --- Commands ---------------------------------------------------------------

  /** Runs a quest command of the interpreter. */
  command(p: PlayerSession, command: QuestCommand, questId: number, step: number): void {
    if (command === 'start') this.start(p, questId);
    else if (command === 'advance') this.advance(p, questId, step);
    else this.complete(p, questId);
  }

  /** Starts a quest when its prerequisites are met. @returns `true` if it started. */
  start(p: PlayerSession, questId: number): boolean {
    const quest = this.quest(questId);
    if (!quest) return false;
    const reason = this.lockReason(p, quest);
    if (reason) {
      if (reason !== 'notify.quest_already') {
        const prerequisite = this.quest(quest.prerequisite);
        p.socket.emit('notify', { key: reason, params: { name: quest.name, level: quest.level, quest: prerequisite?.name ?? '' }, icon: quest.icon });
      }
      return false;
    }
    this.save(p, questId, { status: 1, step: 0, counters: [] });
    p.socket.emit('notify', { key: 'notify.quest_started', params: { name: quest.name }, icon: quest.icon });
    this.changed(p);
    return true;
  }

  /** Moves a quest in progress to a step (0 = the next one). */
  advance(p: PlayerSession, questId: number, step: number): void {
    const quest = this.quest(questId);
    const current = p.progress.quests.get(questId);
    if (!quest || current?.status !== 1) return;
    let next = step > 0 ? step : current.step + 1;
    if (quest.steps.length > 0) next = Math.min(next, quest.steps.length);
    if (next === current.step) return;
    this.save(p, questId, { status: 1, step: next, counters: [] });
    this.announceStep(p, quest, next);
    this.changed(p);
  }

  /** Completes a quest (from any state but completed) and gives its rewards. */
  complete(p: PlayerSession, questId: number): void {
    const quest = this.quest(questId);
    const current = p.progress.quests.get(questId);
    if (!quest || current?.status === 2) return;
    this.save(p, questId, { status: 2, step: current?.step ?? 0, counters: [] });
    p.socket.emit('notify', { key: 'notify.quest_completed', params: { name: quest.name }, icon: quest.icon });
    this.reward(p, quest);
    this.changed(p);
  }

  private save(p: PlayerSession, questId: number, value: Omit<QuestProgress, 'updatedAt'>): void {
    this.ctx.progression.setQuest(p.characterId, p.progress, questId, value);
  }

  /** Tells the player about a new step, or that the quest is ready to hand in. */
  private announceStep(p: PlayerSession, quest: QuestData, step: number): void {
    const ready = quest.steps.length > 0 && step >= quest.steps.length;
    p.socket.emit('notify', { key: ready ? 'notify.quest_ready' : 'notify.quest_updated', params: { name: quest.name }, icon: quest.icon });
  }

  /** Gives the rewards of a completed quest (and takes the collected items if asked). */
  private reward(p: PlayerSession, quest: QuestData): void {
    const w = this.world;
    if (quest.takeItems) {
      for (const s of quest.steps) for (const o of s.objectives) if (o.kind === 'collect') w.changeItems(p, 'item', o.itemId, -o.count);
    }
    if (quest.rewardGold > 0) w.changeGold(p, quest.rewardGold);
    if (quest.rewardExp > 0) {
      p.socket.emit('notify', { key: 'notify.exp_gained', params: { amount: quest.rewardExp } });
      w.runner.setExp(p, p.xp + quest.rewardExp, true);
    }
    for (const r of quest.rewardItems) {
      const id = r.kind === 'item' ? r.item : r.kind === 'weapon' ? r.weapon : r.armor;
      if (id > 0) w.changeItems(p, r.kind, id, r.count);
    }
  }

  /** Something about the player's quests changed: journal, then events and objectives. */
  private changed(p: PlayerSession): void {
    this.push(p);
    this.world.refreshEvents(p);
  }

  // --- Objectives -------------------------------------------------------------

  /** Objectives of the current step of the player's quests in progress. */
  private *activeObjectives(p: PlayerSession): Generator<{ quest: QuestData; progress: QuestProgress; objective: QuestObjective; index: number }> {
    for (const [id, progress] of p.progress.quests) {
      if (progress.status !== 1) continue;
      const quest = this.quest(id);
      const step = quest?.steps[progress.step];
      if (!quest || !step) continue;
      for (let index = 0; index < step.objectives.length; index++) yield { quest, progress, objective: step.objectives[index]!, index };
    }
  }

  /** Current progress of an objective (counters, or live state for items and switches). */
  private objectiveProgress(p: PlayerSession, progress: QuestProgress, o: QuestObjective, index: number): { value: number; count: number } {
    switch (o.kind) {
      case 'collect':
        return { value: Math.min(o.count, this.ctx.inventory.quantity(p.characterId, 'item', o.itemId)), count: o.count };
      case 'switch':
        return { value: this.world.getSwitch(p, o.switchId) ? 1 : 0, count: 1 };
      case 'kill':
        return { value: Math.min(o.count, progress.counters[index] ?? 0), count: o.count };
      default:
        return { value: Math.min(1, progress.counters[index] ?? 0), count: 1 };
    }
  }

  /** Adds to the counter of objectives matching a predicate. */
  private bump(p: PlayerSession, match: (o: QuestObjective) => boolean, amount = 1): void {
    let touched = false;
    for (const { quest, progress, objective, index } of this.activeObjectives(p)) {
      if (!match(objective)) continue;
      const max = objective.kind === 'kill' ? objective.count : 1;
      const before = progress.counters[index] ?? 0;
      if (before >= max) continue;
      const counters = [...progress.counters];
      while (counters.length <= index) counters.push(0);
      counters[index] = Math.min(max, before + amount);
      this.save(p, quest.id, { status: 1, step: progress.step, counters });
      if (objective.kind === 'kill') {
        p.socket.emit('notify', { key: 'notify.quest_progress', params: { name: quest.name, progress: counters[index]!, count: max }, icon: quest.icon });
      }
      touched = true;
    }
    if (touched) {
      this.push(p);
      this.check(p);
    }
  }

  /** The player talked to an event (its run ended). */
  onTalk(p: PlayerSession, mapId: number, eventId: number): void {
    this.bump(p, (o) => o.kind === 'talk' && o.mapId === mapId && o.eventId === eventId);
  }

  /** The player defeated an enemy. */
  onKill(p: PlayerSession, enemyId: number): void {
    this.bump(p, (o) => o.kind === 'kill' && o.enemyId === enemyId);
  }

  /** The player moved or arrived on a map. */
  onMove(p: PlayerSession): void {
    this.bump(p, (o) => o.kind === 'reach' && o.mapId === p.mapId && Math.abs(o.x - p.x) <= o.radius && Math.abs(o.y - p.y) <= o.radius);
  }

  /**
   * Moves quests whose current step is complete to their next step (several
   * steps at once when later objectives are already met), and completes the
   * finished quests set to complete on their own.
   * @returns `true` if a quest changed.
   */
  check(p: PlayerSession): boolean {
    if (this.checking.has(p.characterId)) return false;
    this.checking.add(p.characterId);
    let changed = false;
    try {
      for (let guard = 0; guard < 50; guard++) {
        let advanced = false;
        for (const [id, progress] of [...p.progress.quests]) {
          if (progress.status !== 1) continue;
          const quest = this.quest(id);
          const step = quest?.steps[progress.step];
          if (!quest || !step) continue;
          const done = step.objectives.every((o, i) => {
            const { value, count } = this.objectiveProgress(p, progress, o, i);
            return value >= count;
          });
          if (!done) continue;
          const next = progress.step + 1;
          if (next >= quest.steps.length && quest.autoComplete) {
            this.save(p, id, { status: 2, step: next, counters: [] });
            p.socket.emit('notify', { key: 'notify.quest_completed', params: { name: quest.name }, icon: quest.icon });
            this.reward(p, quest);
          } else {
            this.save(p, id, { status: 1, step: next, counters: [] });
            this.announceStep(p, quest, next);
          }
          advanced = true;
        }
        if (!advanced) break;
        changed = true;
      }
    } finally {
      this.checking.delete(p.characterId);
    }
    if (changed) this.changed(p);
    return changed;
  }

  // --- Markers ----------------------------------------------------------------

  /**
   * Quest marker of an event for a player: "!" when its active page starts a
   * quest the player can take, "?" when it completes a quest ready to hand in
   * or is the target of a talk objective.
   */
  marker(p: PlayerSession, e: EventInstance): number {
    const page = MapRuntime.page(e);
    if (!page) return Marker.None;
    let marker: number = Marker.None;
    for (const c of page.list) {
      const id = Number(c.parameters[0]);
      if (c.code === MmoCmd.CompleteQuest) {
        const quest = this.quest(id);
        const status = this.status(p, id);
        if (status === QuestStatus.Ready || (status === QuestStatus.InProgress && quest?.steps.length === 0)) return Marker.TurnIn;
      } else if (c.code === MmoCmd.StartQuest && marker === Marker.None) {
        const quest = this.quest(id);
        if (quest && this.lockReason(p, quest) === null) marker = Marker.Available;
      }
    }
    for (const { progress, objective, index } of this.activeObjectives(p)) {
      if (objective.kind === 'talk' && objective.mapId === p.mapId && objective.eventId === e.def.id && (progress.counters[index] ?? 0) < 1) return Marker.TurnIn;
    }
    return marker;
  }

  // --- Journal ----------------------------------------------------------------

  /** Name of the target of an objective, for generated texts. */
  private targetName(o: QuestObjective): string {
    const data = this.ctx.gameData;
    switch (o.kind) {
      case 'talk':
        return this.world.mapRuntime(o.mapId)?.definitions().find((e) => e.id === o.eventId)?.name ?? '?';
      case 'kill':
        return data.get('enemy', o.enemyId)?.name ?? '?';
      case 'collect':
        return data.get('item', o.itemId)?.name ?? '?';
      case 'reach': {
        const map = this.world.mapRuntime(o.mapId)?.map;
        return map?.displayName || '?';
      }
      default:
        return '';
    }
  }

  /** Journal entry of one quest. */
  private view(p: PlayerSession, quest: QuestData, progress: QuestProgress): QuestView {
    const status = this.status(p, quest.id);
    const data = this.ctx.gameData;
    const reached = Math.min(quest.steps.length, status === QuestStatus.Completed ? quest.steps.length : progress.step + 1);
    const step = status === QuestStatus.InProgress ? quest.steps[progress.step] : undefined;
    const objectives: QuestObjectiveView[] = (step?.objectives ?? []).map((o, i) => {
      const { value, count } = this.objectiveProgress(p, progress, o, i);
      return { kind: o.kind, label: o.label, target: this.targetName(o), progress: value, count, done: value >= count };
    });
    const items = quest.rewardItems.flatMap((r) => {
      const def = r.kind === 'item' ? data.get('item', r.item) : r.kind === 'weapon' ? data.get('weapon', r.weapon) : data.get('armor', r.armor);
      return def ? [{ name: def.name, icon: def.icon, count: r.count }] : [];
    });
    return {
      id: quest.id,
      name: quest.name,
      description: quest.description,
      icon: quest.icon,
      category: quest.category,
      status,
      steps: quest.steps.slice(0, reached).map((s) => s.description),
      stepCount: quest.steps.length,
      objectives,
      rewards: { gold: quest.rewardGold, exp: quest.rewardExp, items },
      updatedAt: progress.updatedAt,
    };
  }

  /** The journal of a player. */
  payload(p: PlayerSession): QuestJournalPayload {
    const quests: QuestView[] = [];
    for (const [id, progress] of p.progress.quests) {
      const quest = this.quest(id);
      if (quest) quests.push(this.view(p, quest, progress));
    }
    quests.sort((a, b) => b.updatedAt - a.updatedAt || a.id - b.id);
    return { quests };
  }

  /**
   * Sends the journal to the player if it changed since the last time (item
   * and switch objectives change without any quest command).
   */
  push(p: PlayerSession): void {
    if (!this.world.isLive(p)) return;
    const payload = this.payload(p);
    const json = JSON.stringify(payload);
    if (this.sent.get(p.characterId) === json) return;
    this.sent.set(p.characterId, json);
    p.socket.emit('quests', payload);
  }

  /** Sends the journal even if unchanged (entering the world). */
  pushFull(p: PlayerSession): void {
    this.sent.delete(p.characterId);
    this.push(p);
  }

  /** Forgets a player leaving the world. */
  forget(characterId: number): void {
    this.sent.delete(characterId);
    this.checking.delete(characterId);
  }
}
