/**
 * @file Quest journal as sent to a player: the quests it has started, with
 * their current step, the progress of each objective and the rewards.
 *
 * Quest texts (names, descriptions, labels) are game content; objectives
 * without a label are described by the client from their kind and target
 * name, in the player's language.
 */
import type { ObjectiveKind } from './database.js';

/** One objective of the current step. */
export interface QuestObjectiveView {
  kind: ObjectiveKind;
  /** Label written by the creator (may be empty). */
  label: string;
  /** Name of the target (NPC, enemy, item, place) for generated texts. */
  target: string;
  progress: number;
  count: number;
  done: boolean;
}

/** One quest of the journal. */
export interface QuestView {
  id: number;
  name: string;
  description: string;
  icon: number;
  /** Chapter name (may be empty). */
  category: string;
  /** 1 in progress, 2 completed, 3 ready to hand in. */
  status: number;
  /** Descriptions of the steps reached so far (the last one is the current step unless the quest is ready or completed). */
  steps: string[];
  stepCount: number;
  objectives: QuestObjectiveView[];
  rewards: { gold: number; exp: number; items: { name: string; icon: number; count: number }[] };
  /** Time of the last change (most recent first in lists). */
  updatedAt: number;
}

/** Payload of the `quests` event. */
export interface QuestJournalPayload {
  quests: QuestView[];
}

/**
 * Translation key and parameters describing an objective without a label.
 * @param o - Objective view.
 */
export function objectiveText(o: QuestObjectiveView): { key: string; params: Record<string, string | number> } {
  return { key: `quest.objective.${o.kind}`, params: { target: o.target, count: o.count } };
}
