/**
 * @file Full event editor: pages with their conditions, appearance, options,
 * trigger and autonomous movement, and the visual command list.
 *
 * The command list shows every command as an indented row, the way the
 * interpreter reads it. Selecting a row selects its whole block (a message
 * and its lines, a branch and its body...). Commands are inserted before the
 * selected row, at its indentation, from a picker grouped by theme; double
 * click (or Enter) edits a command, Delete removes it, Ctrl+C / Ctrl+X /
 * Ctrl+V copy, cut and paste blocks, even between events and maps.
 */
import { blockRange, insertBlock, isEmptyRow, removeBlock, reindent, updateChoices, updateIf } from '../../shared/command-blocks.js';
import { Cmd, Priority, QuestStatus, SELF_SWITCHES, Trigger, createPage, emptyConditions, type EventCommand, type EventPage, type GameEvent } from '../../shared/events.js';
import type { MapData } from '../../shared/map.js';
import { validateEvent } from '../../shared/map-validation.js';
import type { Direction } from '../../shared/settings.js';
import type { AssetStore } from '../engine/assets.js';
import { sheetFlags } from '../engine/character.js';
import { t, tDynamic } from '../i18n.js';
import { el } from '../ui/dom.js';
import { COMMAND_GROUPS, COMMAND_SPECS, QUEST_STATUS_OPTIONS, commandName, rowText, specOf, type CommandLookups } from './command-specs.js';
import { checkbox, field, numberInput, openModal, select, textInput } from './dialogs.js';
import { editRoute } from './route-editor.js';

/** Everything the event editor needs. */
export interface EventEditorContext extends CommandLookups {
  host: HTMLElement;
  map: MapData;
  assets: AssetStore;
}

/** Commands copied with Ctrl+C / Ctrl+X (shared by every event editor). */
let commandClipboard: EventCommand[] | null = null;
/** Page copied with the "copy page" button. */
let pageClipboard: EventPage | null = null;

const pad = (id: number) => String(id).padStart(4, '0');

/**
 * Opens the command editor of one command list (used by event pages and common events).
 * @param ctx - Lookups and host.
 * @param list - Commands (modified in place).
 * @param onChange - Called after every change.
 */
export class CommandListEditor {
  readonly element: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private selected = 0;

  constructor(
    private readonly ctx: EventEditorContext | (CommandLookups & { host: HTMLElement }),
    private list: EventCommand[],
    private readonly onChange: () => void = () => undefined,
  ) {
    if (this.list.length === 0 || this.list.at(-1)!.code !== Cmd.End) this.list.push({ code: Cmd.End, indent: 0, parameters: [] });
    this.rows = el('div', { className: 'cmd-list', attrs: { tabindex: '0', role: 'listbox', 'aria-label': t('ev.commands') } });
    this.rows.addEventListener('keydown', (e) => this.onKey(e));
    const button = (label: string, action: () => void, title?: string) => el('button', { className: 'button small', text: label, attrs: { type: 'button', title: title ?? label }, on: { click: action } });
    const toolbar = el('div', { className: 'cmd-toolbar' }, [
      button(t('ev.insert'), () => this.insert()),
      button(t('ev.edit'), () => this.edit()),
      button(t('editor.delete'), () => this.remove()),
      button(t('ev.copy'), () => this.copy()),
      button(t('ev.cut'), () => this.cut()),
      button(t('ev.paste'), () => this.paste()),
    ]);
    this.element = el('div', { className: 'cmd-editor' }, [toolbar, this.rows, el('p', { className: 'hint', text: t('ev.list_help') })]);
    this.render();
  }

  /** Replaces the edited list (page change). */
  setList(list: EventCommand[]): void {
    this.list = list;
    if (this.list.length === 0 || this.list.at(-1)!.code !== Cmd.End) this.list.push({ code: Cmd.End, indent: 0, parameters: [] });
    this.selected = 0;
    this.render();
  }

  private render(): void {
    const [start, end] = blockRange(this.list, this.selected);
    this.rows.replaceChildren(
      ...this.list.map((c, i) => {
        const row = el('div', {
          className: `cmd-row code-${c.code}${i >= start && i < end ? ' selected' : ''}`,
          text: rowText(this.list, i, this.ctx),
          attrs: { role: 'option', 'aria-selected': String(i >= start && i < end) },
          on: {
            mousedown: () => {
              this.selected = i;
              this.render();
              this.rows.focus();
            },
            dblclick: () => {
              this.selected = i;
              if (isEmptyRow(c)) this.insert();
              else this.edit();
            },
          },
        });
        row.style.paddingLeft = `${8 + c.indent * 20}px`;
        return row;
      }),
    );
    this.rows.children[this.selected]?.scrollIntoView({ block: 'nearest' });
  }

  private changed(): void {
    this.onChange();
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'ArrowDown') this.selected = Math.min(this.list.length - 1, blockRange(this.list, this.selected)[1]);
    else if (e.key === 'ArrowUp') this.selected = Math.max(0, blockRange(this.list, Math.max(0, blockRange(this.list, this.selected)[0] - 1))[0]);
    else if (e.key === 'Enter' || e.key === ' ') {
      if (isEmptyRow(this.list[this.selected]!)) this.insert();
      else this.edit();
    } else if (e.key === 'Insert') this.insert();
    else if (e.key === 'Delete') this.remove();
    else if (ctrl && e.key.toLowerCase() === 'c') this.copy();
    else if (ctrl && e.key.toLowerCase() === 'x') this.cut();
    else if (ctrl && e.key.toLowerCase() === 'v') this.paste();
    else return;
    e.preventDefault();
    e.stopPropagation();
    this.render();
  }

  /** Opens the command picker and inserts the chosen command before the selection. */
  insert(): void {
    const at = blockRange(this.list, this.selected)[0];
    const groups = COMMAND_GROUPS.map((g) =>
      el('section', { className: 'cmd-group' }, [
        el('h3', { text: tDynamic(`ev.group.${g}`) }),
        ...COMMAND_SPECS.filter((s) => s.group === g).map((spec) =>
          el('button', {
            className: 'button small cmd-pick',
            text: commandName(spec.code),
            attrs: { type: 'button' },
            on: {
              click: () => {
                close();
                if (!spec.form) {
                  this.selected = insertBlock(this.list, at, [{ code: spec.code, indent: 0, parameters: [] }]);
                  this.changed();
                  return;
                }
                this.openForm(spec.code, null, (block) => {
                  this.selected = insertBlock(this.list, at, block);
                  this.changed();
                });
              },
            },
          }),
        ),
      ]),
    );
    const close = openModal(this.ctx.host, t('ev.pick_command'), el('div', { className: 'cmd-picker' }, groups), [{ label: t('common.cancel') }]);
  }

  /** Edits the selected block. */
  edit(): void {
    const [start, end] = blockRange(this.list, this.selected);
    const head = this.list[start];
    if (!head || isEmptyRow(head)) return;
    const block = this.list.slice(start, end);
    const spec = specOf(head.code);
    if (!spec) {
      this.editJson(start, end);
      return;
    }
    if (!spec.form) return;
    this.openForm(head.code, reindent(block, 0), (result) => {
      if (head.code === Cmd.If) updateIf(this.list, start, result[0]!.parameters, result.some((c) => c.code === Cmd.Else));
      else if (head.code === Cmd.ShowChoices) updateChoices(this.list, start, result[0]!.parameters);
      else this.list.splice(start, end - start, ...reindent(result, head.indent));
      this.selected = start;
      this.changed();
    });
  }

  /** Commands without a form of their own (from imported projects) are edited as JSON. */
  private editJson(start: number, end: number): void {
    const area = el('textarea', { className: 'json-area', attrs: { rows: '12', spellcheck: 'false' } });
    area.value = JSON.stringify(reindent(this.list.slice(start, end), 0), null, 1);
    openModal(this.ctx.host, t('ev.edit_json'), el('div', {}, [el('p', { className: 'hint', text: t('ev.json_block_help') }), area]), [
      { label: t('common.cancel') },
      {
        label: t('editor.apply'),
        primary: true,
        onClick: () => {
          let parsed: EventCommand[];
          try {
            parsed = JSON.parse(area.value) as EventCommand[];
            if (!Array.isArray(parsed) || parsed.some((c) => !Number.isInteger(c.code) || !Array.isArray(c.parameters))) throw new Error('shape');
          } catch {
            throw Object.assign(new Error('json'), { key: 'error.editor.invalid_json' });
          }
          this.list.splice(start, end - start, ...reindent(parsed.map((c) => ({ code: c.code, indent: Number(c.indent) || 0, parameters: c.parameters })), this.list[start]!.indent));
          this.changed();
        },
      },
    ]);
  }

  private openForm(code: number, block: EventCommand[] | null, done: (block: EventCommand[]) => void): void {
    const form = specOf(code)!.form!(this.ctx, block);
    openModal(this.ctx.host, commandName(code), el('div', { className: 'cmd-form' }, [form.element]), [
      { label: t('common.cancel') },
      { label: t('editor.apply'), primary: true, onClick: () => done(form.read()) },
    ]);
  }

  remove(): void {
    if (removeBlock(this.list, this.selected).length > 0) {
      this.selected = Math.min(this.selected, this.list.length - 1);
      this.selected = blockRange(this.list, this.selected)[0];
      this.changed();
    }
  }

  copy(): void {
    const [start, end] = blockRange(this.list, this.selected);
    if (isEmptyRow(this.list[start]!)) return;
    commandClipboard = reindent(this.list.slice(start, end), 0);
  }

  cut(): void {
    this.copy();
    this.remove();
  }

  paste(): void {
    if (!commandClipboard) return;
    const at = blockRange(this.list, this.selected)[0];
    insertBlock(this.list, at, commandClipboard);
    this.selected = at + commandClipboard.length;
    this.changed();
  }
}

/** Draws the appearance of a page (first frame of the character, or nothing). */
async function drawPreview(canvas: HTMLCanvasElement, assets: AssetStore, name: string, index: number, direction: Direction, pattern: number): Promise<void> {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!name) return;
  const image = await assets.image('characters', name);
  if (!image) return;
  const { single } = sheetFlags(name);
  const fw = image.width / (single ? 3 : 12);
  const fh = image.height / (single ? 4 : 8);
  const bx = single ? 0 : (index % 4) * 3;
  const by = single ? 0 : Math.floor(index / 4) * 4;
  const scale = Math.min(canvas.width / fw, canvas.height / fh, 1.5);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, (bx + Math.min(2, pattern)) * fw, (by + (direction - 2) / 2) * fh, fw, fh, (canvas.width - fw * scale) / 2, canvas.height - fh * scale, fw * scale, fh * scale);
}

/**
 * Opens the full event editor.
 * @param ctx - Lookups, host, map and assets.
 * @param x - Cell of the event.
 * @param y - Cell of the event.
 * @param initial - Event to start from, or `null` for a blank one.
 * @param onDone - Receives the finished event, or `null` to delete it.
 * @param existing - The event is already on the map (offers deletion).
 */
export function openEventEditor(ctx: EventEditorContext, x: number, y: number, initial: GameEvent | null, onDone: (e: GameEvent | null) => void, existing = initial !== null): void {
  const id = initial?.id ?? (() => {
    const free = ctx.map.events.findIndex((e, i) => i > 0 && e === null);
    return free > 0 ? free : ctx.map.events.length;
  })();
  const event: GameEvent = initial ? structuredClone(initial) : { id, name: `EV${pad(id).slice(1)}`, note: '', x, y, pages: [createPage()] };
  let pageIndex = 0;
  const name = textInput(event.name, 100);
  const note = textInput(event.note, 500);
  const tabs = el('div', { className: 'page-tabs', attrs: { role: 'tablist' } });
  const pagePanel = el('div', { className: 'page-panel' });
  const commands = new CommandListEditor(ctx, event.pages[0]!.list);

  const renderTabs = () => {
    tabs.replaceChildren(
      ...event.pages.map((_, i) =>
        el('button', {
          className: `page-tab${i === pageIndex ? ' active' : ''}`,
          text: String(i + 1),
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(i === pageIndex) },
          on: { click: () => selectPage(i) },
        }),
      ),
      el('span', { className: 'page-tools' }, [
        el('button', { className: 'button small', text: t('ev.page.new'), attrs: { type: 'button' }, on: { click: () => addPage(createPage()) } }),
        el('button', { className: 'button small', text: t('ev.page.copy'), attrs: { type: 'button' }, on: { click: () => (pageClipboard = structuredClone(event.pages[pageIndex]!)) } }),
        el('button', { className: 'button small', text: t('ev.page.paste'), attrs: { type: 'button' }, on: { click: () => pageClipboard && addPage(structuredClone(pageClipboard)) } }),
        el('button', { className: 'button small danger', text: t('ev.page.delete'), attrs: { type: 'button' }, on: { click: deletePage } }),
      ]),
    );
  };
  const addPage = (page: EventPage) => {
    if (event.pages.length >= 20) return;
    event.pages.splice(pageIndex + 1, 0, page);
    selectPage(pageIndex + 1);
  };
  function deletePage(): void {
    if (event.pages.length <= 1) return;
    event.pages.splice(pageIndex, 1);
    selectPage(Math.min(pageIndex, event.pages.length - 1));
  }
  const selectPage = (i: number) => {
    pageIndex = i;
    renderTabs();
    renderPage();
    commands.setList(event.pages[i]!.list);
  };

  const renderPage = () => {
    const page = event.pages[pageIndex]!;
    const c = { ...emptyConditions(), ...page.conditions };
    page.conditions = c;
    const bind = <E extends HTMLInputElement | HTMLSelectElement>(control: E, apply: (control: E) => void): E => {
      control.addEventListener('change', () => apply(control));
      return control;
    };
    const condRow = (enabled: boolean, onToggle: (v: boolean) => void, label: string, controls: HTMLElement[]) =>
      el('div', { className: 'cond-row' }, [
        el('label', { className: 'inline-check' }, [bind(checkbox(enabled), (cb) => onToggle(cb.checked)), el('span', { text: label })]),
        ...controls,
      ]);
    const dataOptions = (list: { name: string; global: boolean }[], value: number): [string, string][] => {
      const count = Math.max(list.length + 10, 20, value);
      return Array.from({ length: count }, (_, i): [string, string] => [String(i + 1), `#${pad(i + 1)} ${list[i]?.name ?? ''}${list[i]?.global ? ` [${t('ev.global')}]` : ''}`]);
    };
    const entries = (list: { id: number; name: string }[], value: number) => {
      const options = list.map((e): [string, string] => [String(e.id), `${pad(e.id)} ${e.name}`]);
      if (!options.some(([v]) => Number(v) === value)) options.push([String(value), pad(value)]);
      return select(options, String(value));
    };
    const conditions = el('fieldset', { className: 'ev-box' }, [
      el('legend', { text: t('ev.conditions') }),
      condRow(c.switch1Valid, (v) => (c.switch1Valid = v), t('ev.field.switch'), [bind(select(dataOptions(ctx.switches, c.switch1Id), String(c.switch1Id)), (s) => (c.switch1Id = Number(s.value)))]),
      condRow(c.switch2Valid, (v) => (c.switch2Valid = v), t('ev.field.switch'), [bind(select(dataOptions(ctx.switches, c.switch2Id), String(c.switch2Id)), (s) => (c.switch2Id = Number(s.value)))]),
      condRow(c.variableValid, (v) => (c.variableValid = v), t('ev.field.variable'), [
        bind(select(dataOptions(ctx.variables, c.variableId), String(c.variableId)), (s) => (c.variableId = Number(s.value))),
        el('span', { text: '≥' }),
        bind(numberInput(c.variableValue, -99_999_999, 99_999_999), (n) => (c.variableValue = Number(n.value) || 0)),
      ]),
      condRow(c.selfSwitchValid, (v) => (c.selfSwitchValid = v), t('ev.field.self_switch'), [bind(select(SELF_SWITCHES.map((l): [string, string] => [l, l]), c.selfSwitchCh), (s) => (c.selfSwitchCh = s.value as 'A'))]),
      condRow(c.itemValid, (v) => (c.itemValid = v), t('ev.field.item_owned'), [bind(entries(ctx.items, c.itemId), (s) => (c.itemId = Number(s.value)))]),
      condRow(c.levelValid === true, (v) => (c.levelValid = v), t('ev.field.level_min'), [bind(numberInput(c.level ?? 1, 1, 999), (n) => (c.level = Math.max(1, Number(n.value) || 1)))]),
      condRow(c.questValid === true, (v) => (c.questValid = v), t('ev.field.quest'), [
        bind(entries(ctx.quests, c.questId ?? 1), (s) => (c.questId = Number(s.value))),
        bind(select(QUEST_STATUS_OPTIONS(), String(c.questStatus ?? 1)), (s) => (c.questStatus = Number(s.value))),
        el('span', { text: `${t('ev.field.step')} ≥` }),
        bind(numberInput(c.questStep ?? 0, 0, 99), (n) => (c.questStep = Math.max(0, Number(n.value) || 0))),
      ]),
      el('p', { className: 'hint', text: t('ev.conditions_help') }),
    ]);

    const preview = el('canvas', { className: 'ev-preview', attrs: { width: '72', height: '96' } });
    const redraw = () => void drawPreview(preview, ctx.assets, page.image.characterName, page.image.characterIndex, page.image.direction, page.image.pattern);
    const appearance = el('fieldset', { className: 'ev-box' }, [
      el('legend', { text: t('ev.appearance') }),
      el('div', { className: 'ev-appearance' }, [
        preview,
        el('div', { className: 'form-grid' }, [
          field(t('editor.character_sheet'), bind(select([['', t('editor.none')], ...ctx.resources.characters.map((n): [string, string] => [n, n])], page.image.characterName), (s) => ((page.image.characterName = s.value), (page.image.tileId = 0), redraw()))),
          field(t('editor.character_index'), bind(numberInput(page.image.characterIndex, 0, 7), (n) => ((page.image.characterIndex = Math.max(0, Math.min(7, Number(n.value) || 0))), redraw()))),
          field(t('editor.direction_label'), bind(select([['2', t('editor.direction.down')], ['4', t('editor.direction.left')], ['6', t('editor.direction.right')], ['8', t('editor.direction.up')]], String(page.image.direction)), (s) => ((page.image.direction = Number(s.value) as Direction), redraw()))),
          field(t('ev.field.pattern'), bind(numberInput(page.image.pattern, 0, 2), (n) => ((page.image.pattern = Math.max(0, Math.min(2, Number(n.value) || 0))), redraw()))),
        ]),
      ]),
    ]);
    redraw();

    const flag = (label: string, key: 'walkAnime' | 'stepAnime' | 'directionFix' | 'through') =>
      el('label', { className: 'inline-check' }, [bind(checkbox(page[key]), (cb) => (page[key] = cb.checked)), el('span', { text: label })]);
    const options = el('fieldset', { className: 'ev-box' }, [
      el('legend', { text: t('ev.options') }),
      el('div', { className: 'ev-flags' }, [flag(t('ev.flag.walk'), 'walkAnime'), flag(t('ev.flag.step'), 'stepAnime'), flag(t('ev.flag.dir_fix'), 'directionFix'), flag(t('ev.flag.through'), 'through')]),
      el('div', { className: 'form-grid' }, [
        field(t('ev.field.priority'), bind(select([[String(Priority.Below), t('ev.priority.below')], [String(Priority.Same), t('ev.priority.same')], [String(Priority.Above), t('ev.priority.above')]], String(page.priorityType)), (s) => (page.priorityType = Number(s.value)))),
        field(t('ev.field.trigger'), bind(select([Trigger.Action, Trigger.PlayerTouch, Trigger.EventTouch, Trigger.Autorun, Trigger.Parallel].map((tr): [string, string] => [String(tr), tDynamic(`ev.trigger.${tr}`)]), String(page.trigger)), (s) => (page.trigger = Number(s.value)))),
      ]),
    ]);

    const routeButton = el('button', {
      className: 'button small',
      text: t('ev.edit_route'),
      attrs: { type: 'button' },
      on: {
        click: async () => {
          const route = await editRoute(ctx.host, page.moveRoute, ctx.resources, false);
          if (route) page.moveRoute = route;
        },
      },
    });
    const moveType = bind(select([0, 1, 2, 3].map((m): [string, string] => [String(m), tDynamic(`ev.move.${m}`)]), String(page.moveType)), (s) => {
      page.moveType = Number(s.value);
      routeButton.classList.toggle('hidden', page.moveType !== 3);
    });
    routeButton.classList.toggle('hidden', page.moveType !== 3);
    const movement = el('fieldset', { className: 'ev-box' }, [
      el('legend', { text: t('ev.movement') }),
      el('div', { className: 'form-grid' }, [
        field(t('ev.field.move_type'), moveType),
        field(t('ev.field.speed'), bind(select([1, 2, 3, 4, 5, 6].map((s): [string, string] => [String(s), tDynamic(`ev.speed.${s}`)]), String(page.moveSpeed)), (s) => (page.moveSpeed = Number(s.value)))),
        field(t('ev.field.frequency'), bind(select([1, 2, 3, 4, 5].map((f): [string, string] => [String(f), tDynamic(`ev.freq.${f}`)]), String(page.moveFrequency)), (s) => (page.moveFrequency = Number(s.value)))),
        el('div', { className: 'form-row' }, [el('span'), routeButton]),
      ]),
    ]);
    pagePanel.replaceChildren(el('div', { className: 'page-settings' }, [conditions, appearance, options, movement]), commands.element);
  };

  renderTabs();
  renderPage();

  const buttons = [{ label: t('common.cancel') }] as { label: string; primary?: boolean; danger?: boolean; onClick?: () => boolean | void }[];
  if (existing) buttons.push({ label: t('editor.delete'), danger: true, onClick: () => onDone(null) });
  buttons.push({
    label: existing ? t('editor.apply') : t('editor.create'),
    primary: true,
    onClick: () => {
      const result: GameEvent = { ...event, name: name.value.trim() || `EV${pad(id).slice(1)}`, note: note.value };
      const error = validateEvent(result, id, ctx.map.width, ctx.map.height);
      if (error) throw Object.assign(new Error(error), { key: 'error.editor.invalid_event', params: { detail: error } });
      onDone(result);
    },
  });
  openModal(
    ctx.host,
    existing ? t('editor.edit_event', { x, y }) : t('editor.new_event', { x, y }),
    el('div', { className: 'event-editor' }, [
      el('div', { className: 'ev-header' }, [field(t('editor.event_name'), name), field(t('editor.note'), note)]),
      tabs,
      pagePanel,
    ]),
    buttons,
    'modal-wide',
  );
}
