/**
 * @file Dialogs of the map editor: a generic modal, new map, map properties,
 * quick events (teleporter, character with dialogue, sign, or raw JSON for
 * anything else) with a destination picker, and the version history.
 */
import { MAX_SPAWN_COUNT, MAX_SPAWNS, type Spawn } from '../../shared/combat.js';
import { Cmd, Priority, Trigger, createPage, textCommands, type EventCommand, type GameEvent } from '../../shared/events.js';
import type { MapData, MapInfo, MapType } from '../../shared/map.js';
import { MAX_MAP_SIDE, validateEvent } from '../../shared/map-validation.js';
import type { Direction } from '../../shared/settings.js';
import { t, tDynamic } from '../i18n.js';
import { el } from '../ui/dom.js';

/** A dialog button. Returning `false` keeps the dialog open. */
export interface ModalButton {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick?: () => boolean | void | Promise<boolean | void>;
}

/**
 * Opens a modal dialog inside the editor.
 * @param host - Editor root element.
 * @param title - Title.
 * @param content - Body.
 * @param buttons - Buttons (Cancel is not added automatically).
 * @param className - Extra class of the dialog (e.g. `modal-wide`).
 * @returns A function closing the dialog.
 */
export function openModal(host: HTMLElement, title: string, content: HTMLElement, buttons: ModalButton[], className = ''): () => void {
  const error = el('p', { className: 'modal-error hidden', attrs: { role: 'alert' } });
  const close = () => backdrop.remove();
  const footer = el(
    'div',
    { className: 'modal-buttons' },
    buttons.map((b) =>
      el('button', {
        className: `button${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`,
        text: b.label,
        attrs: { type: 'button' },
        on: {
          click: async () => {
            try {
              const keep = (await b.onClick?.()) === false;
              if (!keep) close();
            } catch (err) {
              const key = (err as { key?: string }).key;
              const params = (err as { params?: Record<string, string | number> }).params;
              error.textContent = key ? tDynamic(key, params) : String(err);
              error.classList.remove('hidden');
            }
          },
        },
      }),
    ),
  );
  const dialog = el('div', { className: `skin-window modal ${className}`.trim(), attrs: { role: 'dialog', 'aria-label': title } }, [
    el('div', { className: 'modal-title', text: title }),
    el('div', { className: 'modal-body' }, [content, error]),
    footer,
  ]);
  const backdrop = el('div', { className: 'modal-backdrop' }, [dialog]);
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  host.append(backdrop);
  (dialog.querySelector('input, select, textarea, button') as HTMLElement | null)?.focus();
  return close;
}

/** Labelled form row. */
export function field(label: string, control: HTMLElement): HTMLLabelElement {
  return el('label', { className: 'form-row' }, [el('span', { text: label }), control]);
}

/** Text input. */
export function textInput(value: string, max = 100): HTMLInputElement {
  const input = el('input', { attrs: { type: 'text', maxlength: String(max) } });
  input.value = value;
  return input;
}

/** Number input. */
export function numberInput(value: number, min: number, max: number): HTMLInputElement {
  const input = el('input', { attrs: { type: 'number', min: String(min), max: String(max), step: '1' } });
  input.value = String(value);
  return input;
}

/** Select control. */
export function select(options: [string, string][], value: string): HTMLSelectElement {
  const s = el('select', {}, options.map(([v, label]) => el('option', { text: label, attrs: { value: v } })));
  s.value = value;
  return s;
}

/** Checkbox. */
export function checkbox(checked: boolean): HTMLInputElement {
  const c = el('input', { attrs: { type: 'checkbox' } });
  c.checked = checked;
  return c;
}

/** Reads a bounded integer from an input, throwing a translated error when invalid. */
export function readInt(input: HTMLInputElement, min: number, max: number): number {
  const v = Number(input.value);
  if (!Number.isInteger(v) || v < min || v > max) throw Object.assign(new Error('range'), { key: 'error.editor.number_range', params: { min, max } });
  return v;
}

const MAP_TYPES: MapType[] = ['town', 'field', 'dungeon', 'instance'];

/** Values of the new map dialog. */
export interface NewMapValues {
  name: string;
  width: number;
  height: number;
  tilesetId: number;
  type: MapType;
}

/**
 * Asks for the settings of a new map.
 * @param onCreate - Creates it (may throw an API error shown in the dialog).
 */
export function newMapDialog(host: HTMLElement, tilesets: { id: number; name: string }[], onCreate: (v: NewMapValues) => Promise<void>): void {
  const name = textInput(t('editor.new_map_default'));
  const width = numberInput(25, 1, MAX_MAP_SIDE);
  const height = numberInput(19, 1, MAX_MAP_SIDE);
  const tileset = select(tilesets.map((ts) => [String(ts.id), `${ts.id} — ${ts.name}`]), String(tilesets[0]?.id ?? 1));
  const type = select(MAP_TYPES.map((m) => [m, t(`editor.map_type.${m}` as 'editor.map_type.town')]), 'field');
  openModal(host, t('editor.new_map'), el('div', { className: 'form-grid' }, [
    field(t('editor.map_name'), name),
    field(t('editor.width'), width),
    field(t('editor.height'), height),
    field(t('editor.tileset'), tileset),
    field(t('editor.map_type_label'), type),
  ]), [
    { label: t('common.cancel') },
    {
      label: t('editor.create'),
      primary: true,
      onClick: () =>
        onCreate({
          name: name.value.trim() || t('editor.new_map_default'),
          width: readInt(width, 1, MAX_MAP_SIDE),
          height: readInt(height, 1, MAX_MAP_SIDE),
          tilesetId: Number(tileset.value),
          type: type.value as MapType,
        }),
    },
  ]);
}

/** Resource names available to pickers. */
export interface ResourceLists {
  characters: string[];
  faces: string[];
  parallaxes: string[];
  bgm: string[];
  animations: string[];
  se: string[];
}

/**
 * Map properties dialog. Name and size are applied through `onInfo`; the other
 * properties modify the working copy through `onData`.
 */
export function propertiesDialog(
  host: HTMLElement,
  info: MapInfo,
  map: MapData,
  tilesets: { id: number; name: string }[],
  enemies: { id: number; name: string }[],
  resources: ResourceLists,
  apply: (changes: { name: string; width: number; height: number; data: Partial<MapData> }) => Promise<void>,
): void {
  const name = textInput(info.name);
  const displayName = textInput(map.displayName);
  const width = numberInput(map.width, 1, MAX_MAP_SIDE);
  const height = numberInput(map.height, 1, MAX_MAP_SIDE);
  const tileset = select(tilesets.map((ts) => [String(ts.id), `${ts.id} — ${ts.name}`]), String(map.tilesetId));
  const type = select(MAP_TYPES.map((m) => [m, t(`editor.map_type.${m}` as 'editor.map_type.town')]), map.mmo.type);
  const pvp = checkbox(map.mmo.pvp);
  const instance = checkbox(map.mmo.instance);
  const none: [string, string] = ['', t('editor.none')];
  const bgm = select([none, ...resources.bgm.map((n): [string, string] => [n, n])], map.bgm.name);
  const autoBgm = checkbox(map.autoplayBgm);
  const parallax = select([none, ...resources.parallaxes.map((n): [string, string] => [n, n])], map.parallaxName);
  const loopX = checkbox(map.parallaxLoopX);
  const loopY = checkbox(map.parallaxLoopY);
  const sx = numberInput(map.parallaxSx, -32, 32);
  const sy = numberInput(map.parallaxSy, -32, 32);
  const note = el('textarea', { attrs: { rows: '3', maxlength: '10000' } });
  note.value = map.note;
  // Monster spawns: enemy, count, region (0 = anywhere).
  const spawns: Spawn[] = structuredClone(map.mmo.spawns ?? []);
  const spawnBox = el('div', { className: 'spawn-list' });
  const renderSpawns = () => {
    spawnBox.replaceChildren(
      ...spawns.map((s, i) => {
        const enemy = select(enemies.map((e): [string, string] => [String(e.id), `${e.id} — ${e.name}`]), String(s.enemyId));
        enemy.addEventListener('change', () => (s.enemyId = Number(enemy.value)));
        const count = numberInput(s.count, 1, MAX_SPAWN_COUNT);
        count.addEventListener('input', () => (s.count = readInt(count, 1, MAX_SPAWN_COUNT)));
        const region = numberInput(s.region, 0, 255);
        region.addEventListener('input', () => (s.region = readInt(region, 0, 255)));
        const remove = el('button', { className: 'button small danger', text: '✕', attrs: { type: 'button', title: t('editor.delete') } });
        remove.addEventListener('click', () => {
          spawns.splice(i, 1);
          renderSpawns();
        });
        return el('div', { className: 'spawn-row' }, [field(t('editor.spawn_enemy'), enemy), field(t('editor.spawn_count'), count), field(t('editor.spawn_region'), region), remove]);
      }),
    );
  };
  renderSpawns();
  const addSpawn = el('button', { className: 'button small', text: t('editor.spawn_add'), attrs: { type: 'button' } });
  addSpawn.addEventListener('click', () => {
    if (spawns.length >= MAX_SPAWNS || enemies.length === 0) return;
    spawns.push({ enemyId: enemies[0]!.id, count: 3, region: 0 });
    renderSpawns();
  });
  const spawnSection = el('fieldset', { className: 'db-group spawn-section' }, [
    el('legend', { text: t('editor.spawns') }),
    el('p', { className: 'hint', text: t('editor.spawns_help') }),
    spawnBox,
    addSpawn,
  ]);
  openModal(host, t('editor.map_properties'), el('div', {}, [el('div', { className: 'form-grid two-columns' }, [
    field(t('editor.map_name'), name),
    field(t('editor.display_name'), displayName),
    field(t('editor.width'), width),
    field(t('editor.height'), height),
    field(t('editor.tileset'), tileset),
    field(t('editor.map_type_label'), type),
    field(t('editor.pvp'), pvp),
    field(t('editor.instance'), instance),
    field(t('editor.bgm'), bgm),
    field(t('editor.autoplay_bgm'), autoBgm),
    field(t('editor.parallax'), parallax),
    field(t('editor.parallax_loop_x'), loopX),
    field(t('editor.parallax_loop_y'), loopY),
    field(t('editor.parallax_speed_x'), sx),
    field(t('editor.parallax_speed_y'), sy),
    field(t('editor.note'), note),
  ]), spawnSection]), [
    { label: t('common.cancel') },
    {
      label: t('editor.apply'),
      primary: true,
      onClick: () =>
        apply({
          name: name.value.trim() || info.name,
          width: readInt(width, 1, MAX_MAP_SIDE),
          height: readInt(height, 1, MAX_MAP_SIDE),
          data: {
            displayName: displayName.value,
            tilesetId: Number(tileset.value),
            mmo: { ...map.mmo, type: type.value as MapType, pvp: pvp.checked, instance: instance.checked, spawns },
            bgm: { ...map.bgm, name: bgm.value },
            autoplayBgm: autoBgm.checked && bgm.value !== '',
            parallaxName: parallax.value,
            parallaxLoopX: loopX.checked,
            parallaxLoopY: loopY.checked,
            parallaxSx: readInt(sx, -32, 32),
            parallaxSy: readInt(sy, -32, 32),
            note: note.value,
          },
        }),
    },
  ]);
}

/** Kinds of quick events. */
type QuickKind = 'teleport' | 'npc' | 'sign' | 'chest' | 'json';

/** Recognises which quick form can edit an event (`json` when none fits). */
export function quickKindOf(e: GameEvent): QuickKind {
  if (e.pages.length !== 1) return 'json';
  const list = e.pages[0]!.list.filter((c) => c.code !== Cmd.End);
  if (list.length === 1 && list[0]!.code === Cmd.TransferPlayer && e.pages[0]!.trigger === Trigger.PlayerTouch) return 'teleport';
  if (list.length > 0 && list.every((c) => c.code === Cmd.ChangeItems || c.code === Cmd.ChangeGold)) return 'chest';
  if (list.length > 0 && list.every((c) => c.code === Cmd.ShowText || c.code === Cmd.TextLine)) {
    return e.pages[0]!.image.characterName ? 'npc' : 'sign';
  }
  return 'json';
}

/** Messages of a text-only event, one block per message (lines separated by newlines). */
function messagesOf(list: EventCommand[]): { face: [string, number]; speaker: string; text: string } {
  const blocks: string[] = [];
  let face: [string, number] = ['', 0];
  let speaker = '';
  for (const c of list) {
    if (c.code === Cmd.ShowText) {
      face = [String(c.parameters[0] ?? ''), Number(c.parameters[1] ?? 0)];
      speaker = String(c.parameters[4] ?? '');
      blocks.push('');
    } else if (c.code === Cmd.TextLine) {
      const last = blocks.length - 1;
      blocks[last] = blocks[last] ? `${blocks[last]}\n${String(c.parameters[0])}` : String(c.parameters[0]);
    }
  }
  return { face, speaker, text: blocks.join('\n\n') };
}

/** Builds text commands from blocks separated by blank lines (four lines max per message). */
function commandsFromText(text: string, face: [string, number], speaker: string): EventCommand[] {
  const out: EventCommand[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l, i, all) => l !== '' || i < all.length - 1);
    for (let i = 0; i < lines.length; i += 4) out.push(...textCommands(lines.slice(i, i + 4), face, speaker));
  }
  out.push({ code: Cmd.End, indent: 0, parameters: [] });
  return out;
}

/** Context of the quick event dialog. */
export interface QuickEventContext {
  host: HTMLElement;
  maps: MapInfo[];
  currentMapId: number;
  map: MapData;
  resources: ResourceLists;
  /** Items of the database (for chests). */
  items: { id: number; name: string }[];
  /** Opens the destination picker; resolves with the chosen cell, or `null`. */
  pickCell: (mapId: number) => Promise<{ x: number; y: number } | null>;
  /** Continues in the full event editor with the event as currently filled in. */
  openFullEditor: (event: GameEvent) => void;
}

/**
 * Creates or edits an event with the quick forms.
 * @param ctx - Dialog context.
 * @param x - Cell of the event.
 * @param y - Cell of the event.
 * @param existing - Event to edit, or `null` to create.
 * @param onDone - Receives the finished event, or `null` to delete it.
 */
export function quickEventDialog(ctx: QuickEventContext, x: number, y: number, existing: GameEvent | null, onDone: (e: GameEvent | null) => void): void {
  const id = existing?.id ?? (() => {
    const free = ctx.map.events.findIndex((e, i) => i > 0 && e === null);
    return free > 0 ? free : ctx.map.events.length;
  })();
  let kind: QuickKind = existing ? quickKindOf(existing) : 'npc';
  const name = textInput(existing?.name ?? `EV${String(id).padStart(3, '0')}`);
  const kindSelect = select(
    [['npc', t('editor.quick.npc')], ['teleport', t('editor.quick.teleport')], ['sign', t('editor.quick.sign')], ['chest', t('editor.quick.chest')], ['json', t('editor.quick.json')]],
    kind,
  );
  const body = el('div', { className: 'quick-body' });

  // --- Fields of each kind (created once, shown according to the kind) ---
  const page = existing?.pages[0];
  const transfer = page?.list.find((c) => c.code === Cmd.TransferPlayer)?.parameters as number[] | undefined;
  const destMap = select(ctx.maps.map((m) => [String(m.id), `${m.id} — ${m.name}`]), String(transfer?.[1] ?? ctx.currentMapId));
  const destX = numberInput(transfer?.[2] ?? 0, 0, 255);
  const destY = numberInput(transfer?.[3] ?? 0, 0, 255);
  const dirOptions: [string, string][] = [['0', t('editor.direction.keep')], ['2', t('editor.direction.down')], ['4', t('editor.direction.left')], ['6', t('editor.direction.right')], ['8', t('editor.direction.up')]];
  const destDir = select(dirOptions, String(transfer?.[4] ?? 0));
  const pick = el('button', {
    className: 'button small',
    text: t('editor.pick_on_map'),
    attrs: { type: 'button' },
    on: {
      click: async () => {
        const cell = await ctx.pickCell(Number(destMap.value));
        if (cell) {
          destX.value = String(cell.x);
          destY.value = String(cell.y);
        }
      },
    },
  });

  const msgs = messagesOf(page?.list ?? []);
  const sheet = select([['', t('editor.none')], ...ctx.resources.characters.map((n): [string, string] => [n, n])], page?.image.characterName ?? 'People1');
  const sheetIndex = numberInput(page?.image.characterIndex ?? 0, 0, 7);
  const facing = select(dirOptions.slice(1), String(page?.image.direction ?? 2));
  const faceSheet = select([['', t('editor.none')], ...ctx.resources.faces.map((n): [string, string] => [n, n])], msgs.face[0] || (existing ? '' : 'People1'));
  const faceIndex = numberInput(msgs.face[1], 0, 7);
  const speaker = textInput(msgs.speaker);
  const text = el('textarea', { attrs: { rows: '6', maxlength: '5000', placeholder: t('editor.text_placeholder') } });
  text.value = msgs.text;
  const giveItem = page?.list.find((c) => c.code === Cmd.ChangeItems)?.parameters as number[] | undefined;
  const giveGold = page?.list.find((c) => c.code === Cmd.ChangeGold)?.parameters as number[] | undefined;
  const chestItem = select([['0', t('editor.none')], ...ctx.items.map((i): [string, string] => [String(i.id), `${i.id} — ${i.name}`])], String(giveItem?.[0] ?? ctx.items[0]?.id ?? 0));
  const chestCount = numberInput(giveItem?.[3] ?? 1, 1, 99);
  const chestGold = numberInput(giveGold?.[2] ?? 0, 0, 999_999);
  const json = el('textarea', { className: 'json-area', attrs: { rows: '14', spellcheck: 'false' } });
  json.value = JSON.stringify(existing ?? { id, name: name.value, note: '', x, y, pages: [createPage()] }, null, 2);

  const render = () => {
    kind = kindSelect.value as QuickKind;
    const rows: HTMLElement[] = [];
    if (kind === 'teleport') {
      rows.push(field(t('editor.destination_map'), destMap), field('X', destX), field('Y', destY), field(t('editor.direction_label'), destDir), el('div', { className: 'form-row' }, [el('span'), pick]));
    } else if (kind === 'chest') {
      rows.push(field(t('editor.chest_item'), chestItem), field(t('editor.chest_count'), chestCount), field(t('editor.chest_gold'), chestGold));
      rows.push(el('p', { className: 'hint', text: t('editor.chest_help') }));
    } else if (kind === 'npc' || kind === 'sign') {
      if (kind === 'npc') rows.push(field(t('editor.character_sheet'), sheet), field(t('editor.character_index'), sheetIndex), field(t('editor.direction_label'), facing));
      rows.push(field(t('editor.face_sheet'), faceSheet), field(t('editor.face_index'), faceIndex), field(t('editor.speaker'), speaker), field(t('editor.text'), text));
      rows.push(el('p', { className: 'hint', text: t('editor.text_help') }));
    } else {
      rows.push(el('p', { className: 'hint', text: t('editor.json_help') }), json);
    }
    body.replaceChildren(...rows);
  };
  kindSelect.addEventListener('change', render);
  render();

  const build = (): GameEvent => {
    const base = { id, name: name.value.trim() || `EV${id}`, note: existing?.note ?? '', x, y };
    if (kind === 'teleport') {
      const target = ctx.maps.find((m) => m.id === Number(destMap.value));
      if (!target) throw Object.assign(new Error('map'), { key: 'error.editor.map_not_found' });
      return {
        ...base,
        pages: [createPage({
          priorityType: Priority.Below,
          trigger: Trigger.PlayerTouch,
          list: [
            { code: Cmd.TransferPlayer, indent: 0, parameters: [0, target.id, readInt(destX, 0, 255), readInt(destY, 0, 255), Number(destDir.value), 0] },
            { code: Cmd.End, indent: 0, parameters: [] },
          ],
        })],
      };
    }
    if (kind === 'chest') {
      const list: EventCommand[] = [];
      if (Number(chestItem.value) > 0) list.push({ code: Cmd.ChangeItems, indent: 0, parameters: [Number(chestItem.value), 0, 0, readInt(chestCount, 1, 99)] });
      const gold = readInt(chestGold, 0, 999_999);
      if (gold > 0) list.push({ code: Cmd.ChangeGold, indent: 0, parameters: [0, 0, gold] });
      list.push({ code: Cmd.End, indent: 0, parameters: [] });
      return {
        ...base,
        pages: [createPage({
          priorityType: Priority.Same,
          trigger: Trigger.Action,
          directionFix: true,
          image: { tileId: 0, characterName: '!Objects1', characterIndex: 0, direction: 2, pattern: 1 },
          list,
        })],
      };
    }
    if (kind === 'npc' || kind === 'sign') {
      const face: [string, number] = [faceSheet.value, readInt(faceIndex, 0, 7)];
      return {
        ...base,
        pages: [createPage({
          priorityType: Priority.Same,
          trigger: Trigger.Action,
          image: kind === 'npc'
            ? { tileId: 0, characterName: sheet.value, characterIndex: readInt(sheetIndex, 0, 7), direction: Number(facing.value) as Direction, pattern: 1 }
            : { tileId: 0, characterName: '', characterIndex: 0, direction: 2, pattern: 1 },
          list: commandsFromText(text.value, face, speaker.value.trim()),
        })],
      };
    }
    let parsed: GameEvent;
    try {
      parsed = JSON.parse(json.value) as GameEvent;
    } catch {
      throw Object.assign(new Error('json'), { key: 'error.editor.invalid_json' });
    }
    parsed = { ...parsed, id, x, y };
    const error = validateEvent(parsed, id, ctx.map.width, ctx.map.height);
    if (error) throw Object.assign(new Error(error), { key: 'error.editor.invalid_event', params: { detail: error } });
    return parsed;
  };

  const buttons: ModalButton[] = [{ label: t('common.cancel') }];
  buttons.push({
    label: t('editor.full_editor'),
    onClick: () => {
      let current: GameEvent;
      try {
        current = build();
      } catch {
        current = existing ?? { id, name: name.value.trim() || `EV${id}`, note: '', x, y, pages: [createPage()] };
      }
      ctx.openFullEditor(current);
    },
  });
  if (existing) buttons.push({ label: t('editor.delete'), danger: true, onClick: () => onDone(null) });
  buttons.push({ label: existing ? t('editor.apply') : t('editor.create'), primary: true, onClick: () => onDone(build()) });
  openModal(ctx.host, existing ? t('editor.edit_event', { x, y }) : t('editor.new_event', { x, y }), el('div', { className: 'form-grid' }, [
    field(t('editor.event_name'), name),
    field(t('editor.event_kind'), kindSelect),
    body,
  ]), buttons);
}

/**
 * Version history list.
 * @param versions - Snapshots, newest first.
 * @param onRestore - Restores one version.
 */
export function versionsDialog(host: HTMLElement, versions: { id: number; createdAt: string }[], onRestore: (id: number) => Promise<void>): void {
  const list = el(
    'ul',
    { className: 'versions-list' },
    versions.map((v, i) =>
      el('li', {}, [
        el('span', { text: `${new Date(`${v.createdAt.replace(' ', 'T')}Z`).toLocaleString()}${i === 0 ? ` (${t('editor.current')})` : ''}` }),
        i === 0 ? null : el('button', { className: 'button small', text: t('editor.restore'), attrs: { type: 'button' }, on: { click: () => void onRestore(v.id).then(() => host.querySelector('.modal-backdrop')?.remove()) } }),
      ]),
    ),
  );
  openModal(host, t('editor.versions'), versions.length ? list : el('p', { text: t('editor.no_versions') }), [{ label: t('ui.close') }]);
}
