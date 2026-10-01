/**
 * @file Quest journal window and on-screen quest tracker.
 *
 * The journal lists the player's quests in two tabs (in progress,
 * completed), grouped by chapter, with the details of the highlighted quest:
 * description, steps reached, objectives of the current step with their
 * progress, and rewards. Selecting a quest in progress toggles whether it is
 * followed by the tracker, which shows the objectives of up to three followed
 * quests on the side of the screen. Everything comes from the server
 * (`quests` event); the client only displays it.
 */
import { objectiveText, type QuestJournalPayload, type QuestObjectiveView, type QuestView } from '../../shared/quests.js';
import { t, tDynamic } from '../i18n.js';
import { el, icon } from './dom.js';
import { GameWindow, type ListItem } from './windows.js';

/** Quest statuses as sent by the server. */
const IN_PROGRESS = 1;
const COMPLETED = 2;
const READY = 3;
/** Number of quests shown by the tracker. */
const TRACKED_MAX = 3;

type Tab = 'active' | 'done';

/** Text of an objective: the creator's label, or a text generated from its kind. */
export function objectiveLabel(o: QuestObjectiveView): string {
  if (o.label) return o.label;
  const { key, params } = objectiveText(o);
  return tDynamic(key, params);
}

/** Progress suffix of an objective ("1/2", or nothing for yes/no objectives). */
function progressText(o: QuestObjectiveView): string {
  return o.count > 1 ? ` ${o.progress}/${o.count}` : '';
}

/** Quests the player chose not to follow, remembered per character in the browser. */
class FollowedQuests {
  private hidden = new Set<number>();

  constructor(private readonly key: string) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
      if (Array.isArray(raw)) this.hidden = new Set(raw.filter((n): n is number => Number.isInteger(n)));
    } catch {
      // Storage unavailable: every quest is followed.
    }
  }

  isFollowed(id: number): boolean {
    return !this.hidden.has(id);
  }

  toggle(id: number): void {
    if (this.hidden.has(id)) this.hidden.delete(id);
    else this.hidden.add(id);
    try {
      localStorage.setItem(this.key, JSON.stringify([...this.hidden]));
    } catch {
      // Not persisted.
    }
  }
}

/** Shared state of the journal and the tracker. */
export class QuestLog {
  journal: QuestJournalPayload = { quests: [] };
  readonly followed: FollowedQuests;
  private readonly listeners: (() => void)[] = [];

  constructor(characterId: number) {
    this.followed = new FollowedQuests(`caranille.quests.hidden.${characterId}`);
  }

  /** Replaces the journal and refreshes the views. */
  set(journal: QuestJournalPayload): void {
    this.journal = journal;
    this.changed();
  }

  /** Registers a view to refresh on changes. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  changed(): void {
    for (const l of this.listeners) l();
  }

  /** Quests in progress (ready ones included), most recent first. */
  active(): QuestView[] {
    return this.journal.quests.filter((q) => q.status === IN_PROGRESS || q.status === READY);
  }

  completed(): QuestView[] {
    return this.journal.quests.filter((q) => q.status === COMPLETED);
  }
}

/** Objective lines of a quest (or the hand-in hint once it is ready). */
function objectiveLines(q: QuestView, className: string): HTMLElement[] {
  if (q.status === READY) return [el('li', { className: `${className} ready`, text: t('quest.ready_hint') })];
  return q.objectives.map((o) => el('li', { className: `${className}${o.done ? ' done' : ''}`, text: `${objectiveLabel(o)}${progressText(o)}` }));
}

/** The quest journal window (J). */
export class QuestWindow extends GameWindow {
  private tab: Tab = 'active';
  private selectedId = 0;
  private readonly tabs = el('div', { className: 'bag-tabs', attrs: { role: 'tablist' } });
  private readonly listArea = el('div', { className: 'quest-list' });
  private readonly details = el('div', { className: 'quest-details' });

  constructor(private readonly log: QuestLog) {
    super('quests', t('quest.title'), { className: 'quest-window' });
    this.body.append(this.tabs, el('div', { className: 'quest-layout' }, [this.listArea, this.details]));
    log.onChange(() => {
      if (this.manager?.isOpen(this)) this.render(true);
    });
  }

  override onOpen(): void {
    this.setTitle(t('quest.title'));
    this.render(false);
  }

  /** Left / right switch tabs; the list handles the rest. */
  override handleInput(input: Parameters<GameWindow['handleInput']>[0]): boolean {
    if (input.consume('right') || input.consume('left')) {
      this.tab = this.tab === 'active' ? 'done' : 'active';
      this.manager?.audio.play('cursor');
      this.render(false);
      return true;
    }
    return super.handleInput(input);
  }

  private render(keepCursor: boolean): void {
    const tabs: Tab[] = ['active', 'done'];
    this.tabs.replaceChildren(
      ...tabs.map((tab) =>
        el('button', {
          className: `bag-tab${tab === this.tab ? ' active' : ''}`,
          text: t(tab === 'active' ? 'quest.tab.active' : 'quest.tab.done'),
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(tab === this.tab) },
          on: {
            click: () => {
              this.tab = tab;
              this.render(false);
            },
          },
        }),
      ),
    );
    const quests = this.tab === 'active' ? this.log.active() : this.log.completed();
    // Group by chapter, keeping the most recent chapter first.
    const chapters = [...new Set(quests.map((q) => q.category))];
    const ordered = chapters.flatMap((c) => quests.filter((q) => q.category === c));
    if (ordered.length === 0) {
      this.listArea.replaceChildren(el('p', { className: 'bag-empty', text: t(this.tab === 'active' ? 'quest.none_active' : 'quest.none_done') }));
      this.details.replaceChildren();
      return;
    }
    const items: ListItem[] = ordered.map((q) => ({
      label: q.name,
      icon: q.icon,
      suffix: q.status === READY ? '✔' : this.tab === 'active' && !this.log.followed.isFollowed(q.id) ? '—' : '',
      hint: this.tab === 'active' ? t('quest.follow_hint') : undefined,
      onFocus: () => this.showDetails(q),
      onSelect: () => {
        if (this.tab !== 'active') return;
        this.log.followed.toggle(q.id);
        this.log.changed();
      },
    }));
    const previous = ordered.findIndex((q) => q.id === this.selectedId);
    this.setList(items, this.listArea, keepCursor || previous >= 0, previous >= 0 ? previous : undefined);
  }

  private showDetails(q: QuestView): void {
    this.selectedId = q.id;
    const status = q.status === COMPLETED ? t('quest.status.completed') : q.status === READY ? t('quest.status.ready') : t('quest.status.in_progress');
    const steps = q.steps.map((s, i) => {
      const current = i === q.steps.length - 1 && q.status === IN_PROGRESS;
      return el('li', { className: current ? 'current' : 'done', text: s });
    });
    const rewards: HTMLElement[] = [];
    if (q.rewards.gold > 0) rewards.push(el('li', {}, [icon('gold'), el('span', { text: String(q.rewards.gold) })]));
    if (q.rewards.exp > 0) rewards.push(el('li', { text: t('quest.reward_exp', { amount: q.rewards.exp }) }));
    for (const item of q.rewards.items) rewards.push(el('li', {}, [icon(item.icon), el('span', { text: `${item.name} ×${item.count}` })]));
    this.details.replaceChildren(
      el('div', { className: 'quest-details-title' }, [icon(q.icon), el('strong', { text: q.name })]),
      el('div', { className: 'quest-details-meta', text: q.category ? `${q.category} — ${status}` : status }),
      el('p', { className: 'quest-description', text: q.description }),
      ...(steps.length ? [el('h4', { text: t('quest.steps') }), el('ol', { className: 'quest-steps' }, steps)] : []),
      ...(q.status !== COMPLETED && (q.objectives.length || q.status === READY) ? [el('h4', { text: t('quest.objectives') }), el('ul', { className: 'quest-objectives' }, objectiveLines(q, 'objective'))] : []),
      ...(rewards.length ? [el('h4', { text: t('quest.rewards') }), el('ul', { className: 'quest-rewards' }, rewards)] : []),
    );
  }
}

/** Objectives of the followed quests, on the side of the screen. */
export class QuestTracker {
  readonly element = el('div', { className: 'quest-tracker', attrs: { 'aria-live': 'polite', 'aria-label': t('quest.tracker') } });

  constructor(private readonly log: QuestLog, private readonly onOpen: () => void) {
    log.onChange(() => this.render());
    this.render();
  }

  render(): void {
    const quests = this.log.active().filter((q) => this.log.followed.isFollowed(q.id)).slice(0, TRACKED_MAX);
    this.element.classList.toggle('empty', quests.length === 0);
    this.element.replaceChildren(
      ...quests.map((q) =>
        el('div', { className: 'tracked-quest', on: { click: () => this.onOpen() } }, [
          el('div', { className: 'tracked-name', text: q.name }),
          el('ul', {}, objectiveLines(q, 'tracked-objective')),
        ]),
      ),
    );
  }
}
