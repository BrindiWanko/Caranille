/**
 * @file Catalogue of the event commands offered by the visual command editor:
 * for each command, its group in the command picker, the form editing its
 * parameters and the one-line summary shown in the command list.
 *
 * Forms return complete blocks (the command and its continuation rows, at
 * indentation 0); the editor re-indents them where they are inserted. The
 * parameter layouts are the standard ones documented in shared/events.ts.
 */
import { choicesBlock, ifBlock, loopBlock } from '../../shared/command-blocks.js';
import { EQUIP_SLOTS } from '../../shared/database.js';
import { BranchType, Cmd, MmoCmd, QuestStatus, RouteCmd, SELF_SWITCHES, type EventCommand, type MoveRoute } from '../../shared/events.js';
import type { DataName } from '../../shared/settings.js';
import { t, tDynamic } from '../i18n.js';
import { el } from '../ui/dom.js';
import { checkbox, field, numberInput, readInt, select, textInput, type ResourceLists } from './dialogs.js';

/** A database entry shown in pickers. */
export interface Named {
  id: number;
  name: string;
}

/** Everything the command forms need to offer choices. */
export interface CommandLookups {
  switches: DataName[];
  variables: DataName[];
  items: Named[];
  weapons: Named[];
  armors: Named[];
  commonEvents: Named[];
  animations: Named[];
  quests: Named[];
  enemies: Named[];
  maps: Named[];
  /** Map being edited and its events (character targets). */
  mapId: number;
  events: Named[];
  resources: ResourceLists;
  /** Opens the destination picker on a map. */
  pickCell(mapId: number): Promise<{ x: number; y: number } | null>;
  /** Opens the move route editor. */
  editRoute(route: MoveRoute): Promise<MoveRoute | null>;
}

/** Groups of the command picker. */
export const COMMAND_GROUPS = ['message', 'flow', 'progress', 'player', 'movement', 'effects', 'scene'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

/** A form editing one command. */
export interface CommandForm {
  element: HTMLElement;
  /** Reads the block (throws a translated error when a value is invalid). */
  read(): EventCommand[];
}

/** Declaration of one command of the editor. */
export interface CommandSpec {
  code: number;
  group: CommandGroup;
  /** Builds the form; `block` is the existing block, or `null` for a new command. Absent: no parameters. */
  form?: (look: CommandLookups, block: EventCommand[] | null) => CommandForm;
  /** Summary shown after the command name. */
  summary?: (c: EventCommand, look: CommandLookups) => string;
}

// --- Small helpers -------------------------------------------------------------

const int = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
const pad = (id: number) => String(id).padStart(4, '0');
const cmd = (code: number, parameters: unknown[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const grid = (rows: (HTMLElement | null)[]) => el('div', { className: 'form-grid' }, rows);

/** Label of a database entry. */
function entryName(list: Named[], id: number): string {
  const found = list.find((e) => e.id === id);
  return `${pad(id)}${found?.name ? ` ${found.name}` : ''}`;
}

/** Label of a switch or variable, with its scope. */
function dataLabel(list: DataName[], id: number): string {
  const d = list[id - 1];
  const scope = d?.global ? ` [${t('ev.global')}]` : '';
  return `#${pad(id)}${d?.name ? ` ${d.name}` : ''}${scope}`;
}

/** Select of database entries. */
function entrySelect(list: Named[], value: number, none = false): HTMLSelectElement {
  const options: [string, string][] = list.map((e) => [String(e.id), entryName(list, e.id)]);
  if (none) options.unshift(['0', t('editor.none')]);
  if (!options.some(([v]) => Number(v) === value) && value > 0) options.push([String(value), pad(value)]);
  return select(options, String(value || (none ? 0 : list[0]?.id ?? 1)));
}

/** Select of switches or variables (declared ones plus a few free ids). */
function dataSelect(list: DataName[], value: number): HTMLSelectElement {
  const count = Math.max(list.length + 10, 20, value);
  const options: [string, string][] = [];
  for (let id = 1; id <= count; id++) options.push([String(id), dataLabel(list, id)]);
  return select(options, String(Math.max(1, value)));
}

/** Select of character targets: player, this event, other events of the map. */
function characterSelect(look: CommandLookups, value: number, withPlayer = true): HTMLSelectElement {
  const options: [string, string][] = [];
  if (withPlayer) options.push(['-1', t('ev.char.player')]);
  options.push(['0', t('ev.char.this')]);
  for (const e of look.events) options.push([String(e.id), `${pad(e.id)} ${e.name}`]);
  return select(options, String(value));
}

function characterName(look: CommandLookups, ref: number): string {
  if (ref < 0) return t('ev.char.player');
  if (ref === 0) return t('ev.char.this');
  return entryName(look.events, ref);
}

const onOff = (value: number) => select([['0', t('ev.on')], ['1', t('ev.off')]], String(value));
const onOffName = (value: unknown) => (int(value) === 0 ? t('ev.on') : t('ev.off'));
const COMPARE = ['=', '≥', '≤', '>', '<', '≠'];
const compareSelect = (value: number) => select(COMPARE.map((c, i): [string, string] => [String(i), c]), String(value));
const directionSelect = (value: number, keep = false) =>
  select(
    [...(keep ? ([['0', t('editor.direction.keep')]] as [string, string][]) : []), ['2', t('editor.direction.down')], ['4', t('editor.direction.left')], ['6', t('editor.direction.right')], ['8', t('editor.direction.up')]],
    String(value),
  );
const directionName = (d: number) => ({ 2: t('editor.direction.down'), 4: t('editor.direction.left'), 6: t('editor.direction.right'), 8: t('editor.direction.up') })[d] ?? t('editor.direction.keep');
const resourceSelect = (names: string[], value: string, none = true) => select([...(none ? ([['', t('editor.none')]] as [string, string][]) : []), ...names.map((n): [string, string] => [n, n])], value);

/** Constant-or-variable operand. */
function operandInput(look: CommandLookups, type: number, value: number, min: number, max: number) {
  const kind = select([['0', t('ev.operand.constant')], ['1', t('ev.operand.variable')]], String(type));
  const constant = numberInput(type === 0 ? value : 0, min, max);
  const variable = dataSelect(look.variables, type === 1 ? value : 1);
  const box = el('div', { className: 'inline-row' }, [kind, constant, variable]);
  const sync = () => {
    constant.classList.toggle('hidden', kind.value !== '0');
    variable.classList.toggle('hidden', kind.value !== '1');
  };
  kind.addEventListener('change', sync);
  sync();
  return {
    element: box,
    read: (): [number, number] => (kind.value === '0' ? [0, readInt(constant, min, max)] : [1, Number(variable.value)]),
  };
}

function operandText(look: CommandLookups, type: unknown, value: unknown): string {
  return int(type) === 1 ? dataLabel(look.variables, int(value)) : String(int(value));
}

/** Increase / decrease select. */
const opSelect = (value: number) => select([['0', t('ev.increase')], ['1', t('ev.decrease')]], String(value));
const opSign = (v: unknown) => (int(v) === 1 ? '−' : '+');

/** Multi-line text area. */
function textArea(value: string, rows = 4, max = 5000): HTMLTextAreaElement {
  const area = el('textarea', { attrs: { rows: String(rows), maxlength: String(max) } });
  area.value = value;
  return area;
}

/** Lines of a text area, trailing empty lines removed. */
function linesOf(area: HTMLTextAreaElement): string[] {
  const lines = area.value.replace(/\r/g, '').split('\n');
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** Block made of a first row and continuation rows holding one text line each. */
function linesBlock(code: number, lineCode: number, lines: string[], first: unknown[] = []): EventCommand[] {
  if (code === Cmd.ShowText) return [cmd(code, first), ...lines.map((l) => cmd(lineCode, [l]))];
  const [head = '', ...rest] = lines;
  return [cmd(code, [head]), ...rest.map((l) => cmd(lineCode, [l]))];
}

/** Rows after the head of a block, as text. */
const blockLines = (block: EventCommand[] | null, from = 1) => (block ?? []).slice(from).map((c) => String(c.parameters[0] ?? ''));

// --- Conditional branch --------------------------------------------------------

const BRANCH_TYPES = [
  BranchType.Switch, BranchType.Variable, BranchType.SelfSwitch, BranchType.Item, BranchType.Weapon, BranchType.Armor,
  BranchType.Gold, BranchType.Level, BranchType.Quest, BranchType.Character, BranchType.Script,
] as const;

/** Choices of quest status (conditions and branches). */
export const QUEST_STATUS_OPTIONS = (): [string, string][] => [
  [String(QuestStatus.NotStarted), t('ev.quest.not_started')],
  [String(QuestStatus.InProgress), t('ev.quest.in_progress')],
  [String(QuestStatus.Ready), t('ev.quest.ready')],
  [String(QuestStatus.Completed), t('ev.quest.completed')],
];

function questStatusSelect(value: number): HTMLSelectElement {
  return select(QUEST_STATUS_OPTIONS(), String(value));
}

/** Form part editing the condition of a branch `[type, ...]`. */
function conditionForm(look: CommandLookups, params: unknown[]) {
  const type = select(BRANCH_TYPES.map((b): [string, string] => [String(b), tDynamic(`ev.branch.${b}`)]), String(params[0] ?? 0));
  const body = el('div', { className: 'form-grid' });
  let read: () => unknown[] = () => [];
  const same = (b: number) => int(params[0], -1) === b;
  const render = () => {
    const b = Number(type.value);
    const p = same(b) ? params : [];
    if (b === BranchType.Switch) {
      const s = dataSelect(look.switches, int(p[1], 1));
      const v = onOff(int(p[2]));
      body.replaceChildren(field(t('ev.field.switch'), s), field(t('ev.field.value'), v));
      read = () => [b, Number(s.value), Number(v.value)];
    } else if (b === BranchType.Variable) {
      const v = dataSelect(look.variables, int(p[1], 1));
      const c = compareSelect(int(p[4], 1));
      const operand = operandInput(look, int(p[2]), int(p[3]), -99_999_999, 99_999_999);
      body.replaceChildren(field(t('ev.field.variable'), v), field(t('ev.field.compare'), c), field(t('ev.field.operand'), operand.element));
      read = () => {
        const [ot, ov] = operand.read();
        return [b, Number(v.value), ot, ov, Number(c.value)];
      };
    } else if (b === BranchType.SelfSwitch) {
      const l = select(SELF_SWITCHES.map((x): [string, string] => [x, x]), String(p[1] ?? 'A'));
      const v = onOff(int(p[2]));
      body.replaceChildren(field(t('ev.field.self_switch'), l), field(t('ev.field.value'), v));
      read = () => [b, l.value, Number(v.value)];
    } else if (b === BranchType.Item || b === BranchType.Weapon || b === BranchType.Armor) {
      const list = b === BranchType.Item ? look.items : b === BranchType.Weapon ? look.weapons : look.armors;
      const s = entrySelect(list, int(p[1], list[0]?.id ?? 1));
      const eq = checkbox(p[2] === true);
      body.replaceChildren(...[field(t('ev.field.entry'), s), ...(b === BranchType.Item ? [] : [field(t('ev.field.include_equipped'), eq)])]);
      read = () => (b === BranchType.Item ? [b, Number(s.value)] : [b, Number(s.value), eq.checked]);
    } else if (b === BranchType.Gold) {
      const amount = numberInput(int(p[1]), 0, 999_999_999);
      const c = select([['0', '≥'], ['1', '≤'], ['2', '<']], String(int(p[2])));
      body.replaceChildren(field(t('ev.field.compare'), c), field(t('ev.field.amount'), amount));
      read = () => [b, readInt(amount, 0, 999_999_999), Number(c.value)];
    } else if (b === BranchType.Level) {
      const c = compareSelect(int(p[2], 1));
      const level = numberInput(int(p[1], 1), 1, 999);
      body.replaceChildren(field(t('ev.field.compare'), c), field(t('ev.field.level'), level));
      read = () => [b, readInt(level, 1, 999), Number(c.value)];
    } else if (b === BranchType.Quest) {
      const q = entrySelect(look.quests, int(p[1], look.quests[0]?.id ?? 1));
      const status = questStatusSelect(int(p[2], QuestStatus.InProgress));
      const step = numberInput(int(p[3]), 0, 99);
      body.replaceChildren(field(t('ev.field.quest'), q), field(t('ev.field.quest_status'), status), field(t('ev.field.quest_step_min'), step));
      read = () => [b, Number(q.value), Number(status.value), readInt(step, 0, 99)];
    } else if (b === BranchType.Character) {
      const c = characterSelect(look, int(p[1], -1));
      const d = directionSelect(int(p[2], 2));
      body.replaceChildren(field(t('ev.field.character'), c), field(t('ev.field.facing'), d));
      read = () => [b, Number(c.value), Number(d.value)];
    } else {
      const code = textInput(String(p[1] ?? ''), 1000);
      body.replaceChildren(field(t('ev.field.expression'), code), el('p', { className: 'hint', text: t('ev.script_help') }));
      read = () => [b, code.value];
    }
  };
  type.addEventListener('change', render);
  render();
  return { element: el('div', {}, [grid([field(t('ev.field.condition'), type)]), body]), read: () => read() };
}

/** Summary of a branch condition. */
function conditionText(p: unknown[], look: CommandLookups): string {
  const b = int(p[0], -1);
  switch (b) {
    case BranchType.Switch: return `${dataLabel(look.switches, int(p[1]))} = ${onOffName(p[2])}`;
    case BranchType.Variable: return `${dataLabel(look.variables, int(p[1]))} ${COMPARE[int(p[4])] ?? '='} ${operandText(look, p[2], p[3])}`;
    case BranchType.SelfSwitch: return `${t('ev.field.self_switch')} ${String(p[1])} = ${onOffName(p[2])}`;
    case BranchType.Item: return `${t('ev.owns')} ${entryName(look.items, int(p[1]))}`;
    case BranchType.Weapon: return `${t('ev.owns')} ${entryName(look.weapons, int(p[1]))}`;
    case BranchType.Armor: return `${t('ev.owns')} ${entryName(look.armors, int(p[1]))}`;
    case BranchType.Gold: return `${t('ev.gold')} ${['≥', '≤', '<'][int(p[2])] ?? '≥'} ${int(p[1])}`;
    case BranchType.Level: return `${t('ev.field.level')} ${COMPARE[int(p[2], 1)] ?? '≥'} ${int(p[1])}`;
    case BranchType.Quest: {
      const status = [t('ev.quest.not_started'), t('ev.quest.in_progress'), t('ev.quest.completed')][int(p[2], 1)] ?? '';
      const step = int(p[2], 1) === QuestStatus.InProgress && int(p[3]) > 0 ? ` (${t('ev.field.step')} ≥ ${int(p[3])})` : '';
      return `${entryName(look.quests, int(p[1]))} : ${status}${step}`;
    }
    case BranchType.Character: return `${characterName(look, int(p[1]))} → ${directionName(int(p[2]))}`;
    case BranchType.Script: return `${t('ev.branch.12')} : ${String(p[1] ?? '')}`;
    default: return '?';
  }
}

// --- Move routes ---------------------------------------------------------------

/** One-line description of a route command. */
export function routeCommandText(c: { code: number; parameters?: unknown[] }): string {
  const p = c.parameters ?? [];
  const name = tDynamic(`ev.route.${c.code}`);
  if (c.code === RouteCmd.Wait) return `${name} : ${int(p[0])}`;
  if (c.code === RouteCmd.Speed) return `${name} : ${int(p[0])}`;
  if (c.code === RouteCmd.Image) return `${name} : ${String(p[0] ?? '')} (${int(p[1])})`;
  if (c.code === RouteCmd.PlaySe) return `${name} : ${String((p[0] as { name?: string } | undefined)?.name ?? '')}`;
  return name;
}

/** Continuation rows listing a route (shown in the command list, ignored when running). */
function routeRows(route: MoveRoute): EventCommand[] {
  return route.list.filter((r) => r.code !== RouteCmd.End).map((r) => cmd(Cmd.MoveRouteLine, [{ code: r.code, parameters: r.parameters ?? [] }]));
}

// --- Specs ---------------------------------------------------------------------

/** Every command offered by the editor, in picker order. */
export const COMMAND_SPECS: CommandSpec[] = [
  // Messages
  {
    code: Cmd.ShowText,
    group: 'message',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? ['', 0, 0, 2, ''];
      const face = resourceSelect(look.resources.faces, String(p[0] ?? ''));
      const faceIndex = numberInput(int(p[1]), 0, 7);
      const speaker = textInput(String(p[4] ?? ''), 60);
      const background = select([['0', t('ev.bg.window')], ['1', t('ev.bg.dim')], ['2', t('ev.bg.transparent')]], String(int(p[2])));
      const position = select([['0', t('ev.pos.top')], ['1', t('ev.pos.middle')], ['2', t('ev.pos.bottom')]], String(int(p[3], 2)));
      const text = textArea(blockLines(block).join('\n'), 5);
      return {
        element: el('div', {}, [
          grid([field(t('editor.face_sheet'), face), field(t('editor.face_index'), faceIndex), field(t('editor.speaker'), speaker), field(t('ev.field.background'), background), field(t('ev.field.position'), position), field(t('editor.text'), text)]),
          el('p', { className: 'hint', text: t('ev.text_codes') }),
        ]),
        read: () => linesBlock(Cmd.ShowText, Cmd.TextLine, linesOf(text), [face.value, readInt(faceIndex, 0, 7), Number(background.value), Number(position.value), speaker.value.trim()]),
      };
    },
    summary: (c) => {
      const p = c.parameters;
      const face = p[0] ? `${String(p[0])}(${int(p[1])})` : t('editor.none');
      return `${face}${p[4] ? `, ${String(p[4])}` : ''}`;
    },
  },
  {
    code: Cmd.ShowChoices,
    group: 'message',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [[t('ev.default_yes'), t('ev.default_no')], 1, 0, 2, 0];
      const choices = textArea(((p[0] as string[]) ?? []).join('\n'), 4, 600);
      const cancel = select([['-2', t('ev.cancel.branch')], ['-1', t('ev.cancel.forbidden')], ['0', t('ev.cancel.choice', { n: 1 })], ['1', t('ev.cancel.choice', { n: 2 })], ['2', t('ev.cancel.choice', { n: 3 })], ['3', t('ev.cancel.choice', { n: 4 })]], String(int(p[1], -2)));
      const def = select([['0', '1'], ['1', '2'], ['2', '3'], ['3', '4'], ['4', '5'], ['5', '6']], String(int(p[2])));
      return {
        element: el('div', {}, [grid([field(t('ev.field.choices'), choices), field(t('ev.field.cancel'), cancel), field(t('ev.field.default_choice'), def)]), el('p', { className: 'hint', text: t('ev.choices_help') })]),
        read: () => {
          const list = linesOf(choices).map((l) => l.trim()).filter((l) => l !== '').slice(0, 6);
          if (list.length === 0) throw Object.assign(new Error('choices'), { key: 'ev.error.no_choice' });
          const cancelType = Math.min(Number(cancel.value), list.length - 1);
          return choicesBlock([list, cancelType, Math.min(Number(def.value), list.length - 1), 2, 0]);
        },
      };
    },
    summary: (c) => ((c.parameters[0] as string[]) ?? []).join(', '),
  },
  {
    code: Cmd.InputNumber,
    group: 'message',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [1, 2];
      const v = dataSelect(look.variables, int(p[0], 1));
      const digits = numberInput(int(p[1], 2), 1, 8);
      return { element: grid([field(t('ev.field.variable'), v), field(t('ev.field.digits'), digits)]), read: () => [cmd(Cmd.InputNumber, [Number(v.value), readInt(digits, 1, 8)])] };
    },
    summary: (c, look) => `${dataLabel(look.variables, int(c.parameters[0]))}, ${int(c.parameters[1])} ${t('ev.field.digits').toLowerCase()}`,
  },
  {
    code: MmoCmd.Notify,
    group: 'message',
    form: (_look, block) => {
      const text = textInput(String(block?.[0]?.parameters[0] ?? ''), 300);
      return { element: grid([field(t('editor.text'), text)]), read: () => [cmd(MmoCmd.Notify, [text.value])] };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },
  {
    code: Cmd.Comment,
    group: 'message',
    form: (_look, block) => {
      const text = textArea([String(block?.[0]?.parameters[0] ?? ''), ...blockLines(block)].join('\n'), 4);
      return { element: grid([field(t('ev.field.comment'), text)]), read: () => linesBlock(Cmd.Comment, Cmd.CommentLine, linesOf(text)) };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },

  // Flow
  {
    code: Cmd.If,
    group: 'flow',
    form: (look, block) => {
      const cond = conditionForm(look, block?.[0]?.parameters ?? [0, 1, 0]);
      const withElse = checkbox(block ? block.some((c) => c.code === Cmd.Else && c.indent === block[0]!.indent) : false);
      return { element: el('div', {}, [cond.element, grid([field(t('ev.field.else_branch'), withElse)])]), read: () => ifBlock(cond.read(), withElse.checked) };
    },
    summary: (c, look) => conditionText(c.parameters, look),
  },
  { code: Cmd.Loop, group: 'flow', form: () => ({ element: el('p', { className: 'hint', text: t('ev.loop_help') }), read: () => loopBlock() }) },
  { code: Cmd.BreakLoop, group: 'flow' },
  { code: Cmd.ExitEvent, group: 'flow' },
  {
    code: Cmd.CommonEvent,
    group: 'flow',
    form: (look, block) => {
      const s = entrySelect(look.commonEvents, int(block?.[0]?.parameters[0], look.commonEvents[0]?.id ?? 1));
      return { element: grid([field(t('ev.field.common_event'), s)]), read: () => [cmd(Cmd.CommonEvent, [Number(s.value)])] };
    },
    summary: (c, look) => entryName(look.commonEvents, int(c.parameters[0])),
  },
  {
    code: Cmd.Label,
    group: 'flow',
    form: (_look, block) => {
      const name = textInput(String(block?.[0]?.parameters[0] ?? ''), 60);
      return { element: grid([field(t('ev.field.label'), name)]), read: () => [cmd(Cmd.Label, [name.value.trim()])] };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },
  {
    code: Cmd.JumpToLabel,
    group: 'flow',
    form: (_look, block) => {
      const name = textInput(String(block?.[0]?.parameters[0] ?? ''), 60);
      return { element: grid([field(t('ev.field.label'), name)]), read: () => [cmd(Cmd.JumpToLabel, [name.value.trim()])] };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },
  {
    code: Cmd.Wait,
    group: 'flow',
    form: (_look, block) => {
      const frames = numberInput(int(block?.[0]?.parameters[0], 60), 1, 36_000);
      return { element: el('div', {}, [grid([field(t('ev.field.frames'), frames)]), el('p', { className: 'hint', text: t('ev.frames_help') })]), read: () => [cmd(Cmd.Wait, [readInt(frames, 1, 36_000)])] };
    },
    summary: (c) => `${int(c.parameters[0])} ${t('ev.frames_unit')}`,
  },

  // Progress
  {
    code: Cmd.ControlSwitches,
    group: 'progress',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [1, 1, 0];
      const from = dataSelect(look.switches, int(p[0], 1));
      const to = dataSelect(look.switches, int(p[1], 1));
      const value = onOff(int(p[2]));
      return {
        element: el('div', {}, [grid([field(t('ev.field.switch'), from), field(t('ev.field.range_end'), to), field(t('ev.field.value'), value)]), el('p', { className: 'hint', text: t('ev.scope_help') })]),
        read: () => [cmd(Cmd.ControlSwitches, [Number(from.value), Math.max(Number(from.value), Number(to.value)), Number(value.value)])],
      };
    },
    summary: (c, look) => {
      const [a, b] = [int(c.parameters[0]), int(c.parameters[1])];
      return `${a === b ? dataLabel(look.switches, a) : `#${pad(a)}..#${pad(b)}`} = ${onOffName(c.parameters[2])}`;
    },
  },
  {
    code: Cmd.ControlVariables,
    group: 'progress',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [1, 1, 0, 0, 0];
      const from = dataSelect(look.variables, int(p[0], 1));
      const to = dataSelect(look.variables, int(p[1], 1));
      const op = select([['0', t('ev.varop.set')], ['1', t('ev.varop.add')], ['2', t('ev.varop.sub')], ['3', t('ev.varop.mul')], ['4', t('ev.varop.div')], ['5', t('ev.varop.mod')]], String(int(p[2])));
      const kind = select([['0', t('ev.operand.constant')], ['1', t('ev.operand.variable')], ['2', t('ev.operand.random')], ['3', t('ev.operand.game_data')], ['4', t('ev.operand.script')]], String(int(p[3])));
      const extra = el('div', { className: 'form-grid' });
      let read: () => unknown[] = () => [0];
      const render = () => {
        const k = Number(kind.value);
        const q = int(p[3]) === k ? p : [];
        if (k === 0) {
          const v = numberInput(int(q[4]), -99_999_999, 99_999_999);
          extra.replaceChildren(field(t('ev.field.value'), v));
          read = () => [0, readInt(v, -99_999_999, 99_999_999)];
        } else if (k === 1) {
          const v = dataSelect(look.variables, int(q[4], 1));
          extra.replaceChildren(field(t('ev.field.variable'), v));
          read = () => [1, Number(v.value)];
        } else if (k === 2) {
          const min = numberInput(int(q[4]), -99_999_999, 99_999_999);
          const max = numberInput(int(q[5], 10), -99_999_999, 99_999_999);
          extra.replaceChildren(field(t('ev.field.min'), min), field(t('ev.field.max'), max));
          read = () => [2, readInt(min, -99_999_999, 99_999_999), readInt(max, -99_999_999, 99_999_999)];
        } else if (k === 3) {
          const data = select(
            [['0:0', t('ev.gamedata.item')], ['3:0', t('ev.gamedata.level')], ['3:1', t('ev.gamedata.exp')], ['3:2', t('ev.gamedata.hp')], ['3:3', t('ev.gamedata.mp')], ['7:2', t('ev.gamedata.gold')], ['7:0', t('ev.gamedata.map')], ['5:0', t('ev.gamedata.x')], ['5:1', t('ev.gamedata.y')]],
            q.length ? `${int(q[4])}:${int(q[4]) === 0 ? 0 : int(q[4]) === 7 ? int(q[5]) : int(q[6])}` : '3:0',
          );
          const item = entrySelect(look.items, int(q[5], look.items[0]?.id ?? 1));
          const who = characterSelect(look, int(q[5], -1));
          const itemRow = field(t('ev.field.entry'), item);
          const whoRow = field(t('ev.field.character'), who);
          const sync = () => {
            itemRow.classList.toggle('hidden', data.value !== '0:0');
            whoRow.classList.toggle('hidden', !data.value.startsWith('5:'));
          };
          data.addEventListener('change', sync);
          sync();
          extra.replaceChildren(field(t('ev.field.data'), data), itemRow, whoRow);
          read = () => {
            const [type, sub] = data.value.split(':').map(Number) as [number, number];
            if (type === 0) return [3, 0, Number(item.value), 0];
            if (type === 5) return [3, 5, Number(who.value), sub];
            if (type === 7) return [3, 7, sub, 0];
            return [3, 3, 0, sub];
          };
        } else {
          const code = textInput(String(q[4] ?? ''), 1000);
          extra.replaceChildren(field(t('ev.field.expression'), code), el('p', { className: 'hint', text: t('ev.script_help') }));
          read = () => [4, code.value];
        }
      };
      kind.addEventListener('change', render);
      render();
      return {
        element: el('div', {}, [grid([field(t('ev.field.variable'), from), field(t('ev.field.range_end'), to), field(t('ev.field.operation'), op), field(t('ev.field.operand'), kind)]), extra, el('p', { className: 'hint', text: t('ev.scope_help') })]),
        read: () => [cmd(Cmd.ControlVariables, [Number(from.value), Math.max(Number(from.value), Number(to.value)), Number(op.value), ...read()])],
      };
    },
    summary: (c, look) => {
      const p = c.parameters;
      const target = int(p[0]) === int(p[1]) ? dataLabel(look.variables, int(p[0])) : `#${pad(int(p[0]))}..#${pad(int(p[1]))}`;
      const op = ['=', '+=', '-=', '*=', '/=', '%='][int(p[2])] ?? '=';
      const k = int(p[3]);
      const value = k === 0 ? String(int(p[4])) : k === 1 ? dataLabel(look.variables, int(p[4])) : k === 2 ? `${t('ev.operand.random')} ${int(p[4])}..${int(p[5])}` : k === 3 ? t('ev.operand.game_data') : String(p[4] ?? '');
      return `${target} ${op} ${value}`;
    },
  },
  {
    code: Cmd.ControlSelfSwitch,
    group: 'progress',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? ['A', 0];
      const l = select(SELF_SWITCHES.map((x): [string, string] => [x, x]), String(p[0] ?? 'A'));
      const v = onOff(int(p[1]));
      return { element: el('div', {}, [grid([field(t('ev.field.self_switch'), l), field(t('ev.field.value'), v)]), el('p', { className: 'hint', text: t('ev.self_help') })]), read: () => [cmd(Cmd.ControlSelfSwitch, [l.value, Number(v.value)])] };
    },
    summary: (c) => `${String(c.parameters[0])} = ${onOffName(c.parameters[1])}`,
  },
  ...([MmoCmd.StartQuest, MmoCmd.AdvanceQuest, MmoCmd.CompleteQuest] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'progress',
      form: (look, block) => {
        const q = entrySelect(look.quests, int(block?.[0]?.parameters[0], look.quests[0]?.id ?? 1));
        const step = numberInput(int(block?.[0]?.parameters[1]), 0, 99);
        const rows = [field(t('ev.field.quest'), q)];
        if (code === MmoCmd.AdvanceQuest) rows.push(field(t('ev.field.step'), step));
        return {
          element: el('div', {}, [grid(rows), code === MmoCmd.AdvanceQuest ? el('p', { className: 'hint', text: t('ev.step_help') }) : null]),
          read: () => [cmd(code, code === MmoCmd.AdvanceQuest ? [Number(q.value), readInt(step, 0, 99)] : [Number(q.value)])],
        };
      },
      summary: (c, look) => `${entryName(look.quests, int(c.parameters[0]))}${c.code === MmoCmd.AdvanceQuest ? ` → ${int(c.parameters[1]) > 0 ? int(c.parameters[1]) : t('ev.next_step')}` : ''}`,
    }),
  ),

  // Player
  {
    code: Cmd.ChangeGold,
    group: 'player',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, 0, 10];
      const op = opSelect(int(p[0]));
      const operand = operandInput(look, int(p[1]), int(p[2]), 0, 999_999_999);
      return { element: grid([field(t('ev.field.operation'), op), field(t('ev.field.amount'), operand.element)]), read: () => [cmd(Cmd.ChangeGold, [Number(op.value), ...operand.read()])] };
    },
    summary: (c, look) => `${opSign(c.parameters[0])} ${operandText(look, c.parameters[1], c.parameters[2])}`,
  },
  ...([Cmd.ChangeItems, Cmd.ChangeWeapons, Cmd.ChangeArmors] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'player',
      form: (look, block) => {
        const list = code === Cmd.ChangeItems ? look.items : code === Cmd.ChangeWeapons ? look.weapons : look.armors;
        const p = block?.[0]?.parameters ?? [list[0]?.id ?? 1, 0, 0, 1];
        const entry = entrySelect(list, int(p[0], 1));
        const op = opSelect(int(p[1]));
        const operand = operandInput(look, int(p[2]), int(p[3], 1), 1, 99);
        return {
          element: grid([field(t('ev.field.entry'), entry), field(t('ev.field.operation'), op), field(t('ev.field.quantity'), operand.element)]),
          read: () => [cmd(code, [Number(entry.value), Number(op.value), ...operand.read(), ...(code === Cmd.ChangeItems ? [] : [false])])],
        };
      },
      summary: (c, look) => {
        const list = c.code === Cmd.ChangeItems ? look.items : c.code === Cmd.ChangeWeapons ? look.weapons : look.armors;
        return `${entryName(list, int(c.parameters[0]))} ${opSign(c.parameters[1])} ${operandText(look, c.parameters[2], c.parameters[3])}`;
      },
    }),
  ),
  ...([Cmd.ChangeHp, Cmd.ChangeMp, Cmd.ChangeExp, Cmd.ChangeLevel] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'player',
      form: (look, block) => {
        const p = block?.[0]?.parameters ?? [0, 0, 0, 0, code === Cmd.ChangeLevel ? 1 : 10, code === Cmd.ChangeExp || code === Cmd.ChangeLevel];
        const op = opSelect(int(p[2]));
        const operand = operandInput(look, int(p[3]), int(p[4], 1), 0, 9_999_999);
        const flag = checkbox(p[5] === true);
        const rows = [field(t('ev.field.operation'), op), field(t('ev.field.amount'), operand.element)];
        if (code === Cmd.ChangeHp) rows.push(field(t('ev.field.allow_ko'), flag));
        if (code === Cmd.ChangeExp || code === Cmd.ChangeLevel) rows.push(field(t('ev.field.show_level_up'), flag));
        return { element: grid(rows), read: () => [cmd(code, [0, 0, Number(op.value), ...operand.read(), ...(code === Cmd.ChangeMp ? [] : [flag.checked])])] };
      },
      summary: (c, look) => `${opSign(c.parameters[2])} ${operandText(look, c.parameters[3], c.parameters[4])}`,
    }),
  ),
  { code: Cmd.RecoverAll, group: 'player', form: () => ({ element: el('p', { className: 'hint', text: t('ev.recover_help') }), read: () => [cmd(Cmd.RecoverAll, [0, 0])] }) },
  {
    code: Cmd.ChangeEquipment,
    group: 'player',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, 0, 0];
      const slot = select(EQUIP_SLOTS.map((s, i): [string, string] => [String(i), tDynamic(`db.option.${s}`)]), String(int(p[1])));
      const itemBox = el('div');
      let item = entrySelect(look.weapons, int(p[2]), true);
      const sync = () => {
        const list = slot.value === '0' ? look.weapons : look.armors;
        item = entrySelect(list, Number(item.value), true);
        itemBox.replaceChildren(item);
      };
      slot.addEventListener('change', sync);
      sync();
      return { element: el('div', {}, [grid([field(t('ev.field.slot'), slot), field(t('ev.field.entry'), itemBox)]), el('p', { className: 'hint', text: t('ev.equip_help') })]), read: () => [cmd(Cmd.ChangeEquipment, [0, Number(slot.value), Number(item.value)])] };
    },
    summary: (c, look) => {
      const slot = EQUIP_SLOTS[int(c.parameters[1])] ?? 'weapon';
      const id = int(c.parameters[2]);
      return `${tDynamic(`db.option.${slot}`)} = ${id ? entryName(slot === 'weapon' ? look.weapons : look.armors, id) : t('editor.none')}`;
    },
  },

  // Movement
  {
    code: Cmd.TransferPlayer,
    group: 'movement',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, look.mapId, 0, 0, 0, 0];
      const byVars = checkbox(int(p[0]) === 1);
      const map = entrySelect(look.maps, int(p[1], look.mapId));
      const x = numberInput(int(p[2]), 0, 255);
      const y = numberInput(int(p[3]), 0, 255);
      const vMap = dataSelect(look.variables, int(p[0]) === 1 ? int(p[1], 1) : 1);
      const vX = dataSelect(look.variables, int(p[0]) === 1 ? int(p[2], 1) : 1);
      const vY = dataSelect(look.variables, int(p[0]) === 1 ? int(p[3], 1) : 1);
      const dir = directionSelect(int(p[4]), true);
      const fade = select([['0', t('ev.fade.black')], ['1', t('ev.fade.white')], ['2', t('ev.fade.none')]], String(int(p[5])));
      const pick = el('button', {
        className: 'button small',
        text: t('editor.pick_on_map'),
        attrs: { type: 'button' },
        on: {
          click: async () => {
            const cell = await look.pickCell(Number(map.value));
            if (cell) {
              x.value = String(cell.x);
              y.value = String(cell.y);
            }
          },
        },
      });
      const direct = grid([field(t('editor.destination_map'), map), field('X', x), field('Y', y), el('div', { className: 'form-row' }, [el('span'), pick])]);
      const fromVars = grid([field(t('ev.field.map_variable'), vMap), field(t('ev.field.x_variable'), vX), field(t('ev.field.y_variable'), vY)]);
      const sync = () => {
        direct.classList.toggle('hidden', byVars.checked);
        fromVars.classList.toggle('hidden', !byVars.checked);
      };
      byVars.addEventListener('change', sync);
      sync();
      return {
        element: el('div', {}, [grid([field(t('ev.field.from_variables'), byVars)]), direct, fromVars, grid([field(t('editor.direction_label'), dir), field(t('ev.field.fade'), fade)])]),
        read: () =>
          byVars.checked
            ? [cmd(Cmd.TransferPlayer, [1, Number(vMap.value), Number(vX.value), Number(vY.value), Number(dir.value), Number(fade.value)])]
            : [cmd(Cmd.TransferPlayer, [0, Number(map.value), readInt(x, 0, 255), readInt(y, 0, 255), Number(dir.value), Number(fade.value)])],
      };
    },
    summary: (c, look) => {
      const p = c.parameters;
      if (int(p[0]) === 1) return `${dataLabel(look.variables, int(p[1]))} (${dataLabel(look.variables, int(p[2]))}, ${dataLabel(look.variables, int(p[3]))})`;
      return `${entryName(look.maps, int(p[1]))} (${int(p[2])}, ${int(p[3])})`;
    },
  },
  {
    code: Cmd.SetMoveRoute,
    group: 'movement',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, { list: [{ code: 0 }], repeat: false, skippable: false, wait: true }];
      const who = characterSelect(look, int(p[0]));
      let route = structuredClone((p[1] as MoveRoute | undefined) ?? { list: [{ code: 0 }], repeat: false, skippable: false, wait: true });
      const preview = el('ol', { className: 'route-preview' });
      const renderPreview = () => {
        const rows = route.list.filter((r) => r.code !== RouteCmd.End);
        preview.replaceChildren(...(rows.length ? rows.map((r) => el('li', { text: routeCommandText(r) })) : [el('li', { className: 'hint', text: t('ev.route_empty') })]));
      };
      renderPreview();
      const edit = el('button', {
        className: 'button small',
        text: t('ev.edit_route'),
        attrs: { type: 'button' },
        on: {
          click: async () => {
            const result = await look.editRoute(route);
            if (result) {
              route = result;
              renderPreview();
            }
          },
        },
      });
      return {
        element: el('div', {}, [grid([field(t('ev.field.character'), who)]), preview, edit]),
        read: () => [cmd(Cmd.SetMoveRoute, [Number(who.value), route]), ...routeRows(route)],
      };
    },
    summary: (c, look) => {
      const route = c.parameters[1] as MoveRoute | undefined;
      const flags = [route?.repeat ? t('ev.route.repeat') : '', route?.wait ? t('ev.route.wait') : ''].filter(Boolean).join(', ');
      return `${characterName(look, int(c.parameters[0]))}${flags ? ` (${flags})` : ''}`;
    },
  },
  { code: Cmd.WaitForMovement, group: 'movement' },

  // Effects
  ...([Cmd.ShowAnimation, Cmd.ShowBalloon] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'effects',
      form: (look, block) => {
        const p = block?.[0]?.parameters ?? [0, 1, false];
        const who = characterSelect(look, int(p[0]));
        const what =
          code === Cmd.ShowAnimation
            ? entrySelect(look.animations, int(p[1], look.animations[0]?.id ?? 1))
            : select(Array.from({ length: 10 }, (_, i): [string, string] => [String(i + 1), tDynamic(`ev.balloon.${i + 1}`)]), String(int(p[1], 1)));
        const wait = checkbox(p[2] === true);
        return {
          element: grid([field(t('ev.field.character'), who), field(code === Cmd.ShowAnimation ? t('ev.field.animation') : t('ev.field.balloon'), what), field(t('ev.field.wait_end'), wait)]),
          read: () => [cmd(code, [Number(who.value), Number(what.value), wait.checked])],
        };
      },
      summary: (c, look) => `${characterName(look, int(c.parameters[0]))}, ${c.code === Cmd.ShowAnimation ? entryName(look.animations, int(c.parameters[1])) : tDynamic(`ev.balloon.${int(c.parameters[1], 1)}`)}`,
    }),
  ),
  { code: Cmd.EraseEvent, group: 'effects' },
  {
    code: Cmd.PlaySe,
    group: 'effects',
    form: (look, block) => {
      const se = (block?.[0]?.parameters[0] ?? { name: '', volume: 90, pitch: 100, pan: 0 }) as { name: string; volume: number; pitch: number; pan: number };
      const name = resourceSelect(look.resources.se, se.name, false);
      const volume = numberInput(int(se.volume, 90), 0, 100);
      const pitch = numberInput(int(se.pitch, 100), 50, 150);
      const note = look.resources.se.length === 0 ? el('p', { className: 'hint', text: t('ev.no_se') }) : null;
      return {
        element: el('div', {}, [grid([field(t('ev.field.sound'), name), field(t('ev.field.volume'), volume), field(t('ev.field.pitch'), pitch)]), note]),
        read: () => [cmd(Cmd.PlaySe, [{ name: name.value, volume: readInt(volume, 0, 100), pitch: readInt(pitch, 50, 150), pan: 0 }])],
      };
    },
    summary: (c) => String((c.parameters[0] as { name?: string } | undefined)?.name ?? ''),
  },

  { code: Cmd.FadeOut, group: 'effects' },
  { code: Cmd.FadeIn, group: 'effects' },
  {
    code: Cmd.TintScreen,
    group: 'effects',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [[0, 0, 0, 0], 60, true];
      const tone = Array.isArray(p[0]) ? (p[0] as unknown[]) : [0, 0, 0, 0];
      const presets: [string, number[]][] = [
        [t('ev.tone.normal'), [0, 0, 0, 0]],
        [t('ev.tone.night'), [-68, -68, 0, 68]],
        [t('ev.tone.dusk'), [68, -34, -34, 0]],
        [t('ev.tone.dark'), [-120, -120, -120, 0]],
        [t('ev.tone.sepia'), [34, -34, -68, 170]],
      ];
      const inputs = [0, 1, 2, 3].map((i) => numberInput(int(tone[i]), i === 3 ? 0 : -255, 255));
      const preset = select([['', '—'], ...presets.map(([label], i): [string, string] => [String(i), label])], '');
      preset.addEventListener('change', () => {
        const values = presets[Number(preset.value)]?.[1];
        if (values) values.forEach((v, i) => (inputs[i]!.value = String(v)));
      });
      const frames = numberInput(int(p[1], 60), 0, 3600);
      const wait = checkbox(p[2] === true);
      return {
        element: grid([
          field(t('ev.field.preset'), preset),
          field(t('ev.field.red'), inputs[0]!),
          field(t('ev.field.green'), inputs[1]!),
          field(t('ev.field.blue'), inputs[2]!),
          field(t('ev.field.gray'), inputs[3]!),
          field(t('ev.field.frames'), frames),
          field(t('ev.field.wait_end'), wait),
        ]),
        read: () => [cmd(Cmd.TintScreen, [inputs.map((input, i) => readInt(input, i === 3 ? 0 : -255, 255)), readInt(frames, 0, 3600), wait.checked])],
      };
    },
    summary: (c) => `(${(Array.isArray(c.parameters[0]) ? (c.parameters[0] as unknown[]) : []).map((v) => int(v)).join(', ')}), ${int(c.parameters[1])} ${t('ev.frames_unit')}${c.parameters[2] === true ? ` (${t('ev.wait_short')})` : ''}`,
  },
  {
    code: Cmd.FlashScreen,
    group: 'effects',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [[255, 255, 255, 170], 30, true];
      const color = Array.isArray(p[0]) ? (p[0] as unknown[]) : [255, 255, 255, 170];
      const hex = (i: number) => int(color[i], 255).toString(16).padStart(2, '0');
      const picker = el('input', { attrs: { type: 'color' } });
      picker.value = `#${hex(0)}${hex(1)}${hex(2)}`;
      const strength = numberInput(int(color[3], 170), 0, 255);
      const frames = numberInput(int(p[1], 30), 1, 3600);
      const wait = checkbox(p[2] === true);
      return {
        element: grid([field(t('ev.field.color'), picker), field(t('ev.field.intensity'), strength), field(t('ev.field.frames'), frames), field(t('ev.field.wait_end'), wait)]),
        read: () => {
          const v = picker.value.replace('#', '');
          const rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0);
          return [cmd(Cmd.FlashScreen, [[...rgb, readInt(strength, 0, 255)], readInt(frames, 1, 3600), wait.checked])];
        },
      };
    },
    summary: (c) => `${int(c.parameters[1])} ${t('ev.frames_unit')}${c.parameters[2] === true ? ` (${t('ev.wait_short')})` : ''}`,
  },
  {
    code: Cmd.ShakeScreen,
    group: 'effects',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [5, 5, 60, true];
      const power = numberInput(int(p[0], 5), 1, 9);
      const speed = numberInput(int(p[1], 5), 1, 9);
      const frames = numberInput(int(p[2], 60), 1, 3600);
      const wait = checkbox(p[3] === true);
      return {
        element: grid([field(t('ev.field.power'), power), field(t('ev.field.speed'), speed), field(t('ev.field.frames'), frames), field(t('ev.field.wait_end'), wait)]),
        read: () => [cmd(Cmd.ShakeScreen, [readInt(power, 1, 9), readInt(speed, 1, 9), readInt(frames, 1, 3600), wait.checked])],
      };
    },
    summary: (c) => `${t('ev.field.power')} ${int(c.parameters[0], 5)}, ${int(c.parameters[2])} ${t('ev.frames_unit')}${c.parameters[3] === true ? ` (${t('ev.wait_short')})` : ''}`,
  },

  // Scene
  {
    code: Cmd.ShopProcessing,
    group: 'scene',
    form: (look, block) => {
      const goods = (block ?? []).filter((c) => c.code === Cmd.ShopProcessing || c.code === Cmd.ShopItem).map((c) => c.parameters);
      const purchaseOnly = checkbox(block?.[0]?.parameters[4] === true);
      const rows = el('div', { className: 'shop-rows' });
      const addRow = (q: unknown[]) => {
        const kind = select([['0', t('db.tab.item')], ['1', t('db.tab.weapon')], ['2', t('db.tab.armor')]], String(int(q[0])));
        const itemBox = el('span');
        let entry = entrySelect(look.items, int(q[1], look.items[0]?.id ?? 1));
        const sync = () => {
          const list = kind.value === '0' ? look.items : kind.value === '1' ? look.weapons : look.armors;
          entry = entrySelect(list, Number(entry.value));
          itemBox.replaceChildren(entry);
        };
        kind.addEventListener('change', sync);
        sync();
        const custom = checkbox(int(q[2]) === 1);
        const price = numberInput(int(q[3]), 0, 99_999_999);
        const row = el('div', { className: 'inline-row shop-row' }, [
          kind, itemBox, el('label', { className: 'inline-check' }, [custom, el('span', { text: t('ev.field.custom_price') })]), price,
          el('button', { className: 'button small danger', text: '×', attrs: { type: 'button', title: t('editor.delete') }, on: { click: () => row.remove() } }),
        ]);
        (row as HTMLElement & { read?: () => unknown[] }).read = () => [Number(kind.value), Number(entry.value), custom.checked ? 1 : 0, custom.checked ? readInt(price, 0, 99_999_999) : 0];
        rows.append(row);
      };
      (goods.length ? goods : [[0, look.items[0]?.id ?? 1, 0, 0]]).forEach(addRow);
      const add = el('button', { className: 'button small', text: t('ev.add_good'), attrs: { type: 'button' }, on: { click: () => addRow([0, look.items[0]?.id ?? 1, 0, 0]) } });
      return {
        element: el('div', {}, [rows, add, grid([field(t('ev.field.purchase_only'), purchaseOnly)]), el('p', { className: 'hint', text: t('ev.later_shop') })]),
        read: () => {
          const list = [...rows.children].map((r) => (r as HTMLElement & { read: () => unknown[] }).read());
          if (list.length === 0) throw Object.assign(new Error('goods'), { key: 'ev.error.no_goods' });
          return [cmd(Cmd.ShopProcessing, [...list[0]!, purchaseOnly.checked]), ...list.slice(1).map((q) => cmd(Cmd.ShopItem, q))];
        },
      };
    },
    summary: (c, look) => {
      const list = [look.items, look.weapons, look.armors][int(c.parameters[0])] ?? look.items;
      return entryName(list, int(c.parameters[1]));
    },
  },
  {
    code: MmoCmd.SetRespawn,
    group: 'player',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, look.mapId, 0, 0];
      const mode = select([['0', t('ev.respawn_here')], ['1', t('ev.respawn_cell')]], String(int(p[0])));
      const map = entrySelect(look.maps, int(p[1], look.mapId));
      const x = numberInput(int(p[2]), 0, 255);
      const y = numberInput(int(p[3]), 0, 255);
      const pick = el('button', { className: 'button small', text: t('db.pick_cell'), attrs: { type: 'button' } });
      pick.addEventListener('click', () => {
        void look.pickCell(Number(map.value)).then((cell) => {
          if (!cell) return;
          x.value = String(cell.x);
          y.value = String(cell.y);
          mode.value = '1';
        });
      });
      return {
        element: grid([field(t('ev.field.respawn_mode'), mode), field(t('editor.destination_map'), map), field('X', x), field('Y', y), el('div', { className: 'form-row' }, [el('span'), pick])]),
        read: () => [cmd(MmoCmd.SetRespawn, [Number(mode.value), Number(map.value), readInt(x, 0, 255), readInt(y, 0, 255)])],
      };
    },
    summary: (c, look) => (int(c.parameters[0]) === 1 ? `${entryName(look.maps, int(c.parameters[1]))} (${int(c.parameters[2])}, ${int(c.parameters[3])})` : t('ev.respawn_here')),
  },
  { code: MmoCmd.OpenBank, group: 'scene' },
  {
    code: MmoCmd.OpenInn,
    group: 'scene',
    form: (_look, block) => {
      const price = numberInput(int(block?.[0]?.parameters[0], 20), 0, 99_999_999);
      return { element: el('div', {}, [grid([field(t('ev.field.price'), price)]), el('p', { className: 'hint', text: t('ev.inn_help') })]), read: () => [cmd(MmoCmd.OpenInn, [readInt(price, 0, 99_999_999)])] };
    },
    summary: (c) => `${int(c.parameters[0])}`,
  },
  {
    code: Cmd.BattleProcessing,
    group: 'scene',
    form: (look, block) => {
      const enemy = entrySelect(look.enemies, int(block?.[0]?.parameters[1], look.enemies[0]?.id ?? 1));
      return { element: el('div', {}, [grid([field(t('ev.field.enemy'), enemy)]), el('p', { className: 'hint', text: t('ev.battle_help') })]), read: () => [cmd(Cmd.BattleProcessing, [0, Number(enemy.value), false, false])] };
    },
    summary: (c, look) => entryName(look.enemies, int(c.parameters[1])),
  },
  {
    code: Cmd.Script,
    group: 'scene',
    form: (_look, block) => {
      const code = textArea([String(block?.[0]?.parameters[0] ?? ''), ...blockLines(block)].join('\n'), 8, 20_000);
      code.classList.add('json-area');
      code.spellcheck = false;
      return { element: el('div', {}, [grid([field(t('ev.field.script'), code)]), el('p', { className: 'hint', text: t('ev.script_api') })]), read: () => linesBlock(Cmd.Script, Cmd.ScriptLine, linesOf(code)) };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },
];

/** Spec of a command code. */
export function specOf(code: number): CommandSpec | undefined {
  return COMMAND_SPECS.find((s) => s.code === code);
}

/** Name of a command code (translated), or a generic label for unknown codes. */
export function commandName(code: number): string {
  return specOf(code) ? tDynamic(`ev.cmd.${code}`) : t('ev.cmd.unknown', { code });
}

/**
 * Text of one row of the command list (continuation rows included).
 * @param list - Command list.
 * @param index - Row.
 * @param look - Lookups for names.
 */
export function rowText(list: readonly EventCommand[], index: number, look: CommandLookups): string {
  const c = list[index]!;
  const p = c.parameters;
  switch (c.code) {
    case Cmd.End: return '◆';
    case Cmd.TextLine: return `: ${String(p[0] ?? '')}`;
    case Cmd.CommentLine: return `: ${String(p[0] ?? '')}`;
    case Cmd.ScriptLine: return `: ${String(p[0] ?? '')}`;
    case Cmd.When: return `: ${t('ev.row.when')} ${String(p[1] ?? '')}`;
    case Cmd.WhenCancel: return `: ${t('ev.row.when_cancel')}`;
    case Cmd.ChoicesEnd: return `: ${t('ev.row.end')}`;
    case Cmd.Else: return `: ${t('ev.row.else')}`;
    case Cmd.IfEnd: return `: ${t('ev.row.end')}`;
    case Cmd.LoopEnd: return `: ${t('ev.row.repeat')}`;
    case Cmd.MoveRouteLine: return `: ◇ ${routeCommandText((p[0] ?? { code: 0 }) as { code: number; parameters?: unknown[] })}`;
    case Cmd.ShopItem: {
      const list = [look.items, look.weapons, look.armors][int(p[0])] ?? look.items;
      return `: ${entryName(list, int(p[1]))}`;
    }
    default: {
      const spec = specOf(c.code);
      const summary = spec?.summary?.(c, look) ?? '';
      return `◆ ${commandName(c.code)}${summary ? ` : ${summary}` : ''}`;
    }
  }
}
