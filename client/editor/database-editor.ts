/**
 * @file Database window of the editor: one tab per record type (classes,
 * skills, items, weapons, armors, enemies, states, animations, common
 * events, quests), plus the System and Terms settings and the declaration of
 * switches and variables (with their personal or global scope). Common
 * events are edited with the same visual command list as map events.
 *
 * Each tab shows the list of records on the left and, on the right, a form
 * generated from the shared schema (`shared/database-schema.ts`), so the form
 * always matches what the server accepts. Saving sends the record to the
 * server, which normalises it and makes it available in game at once.
 * The whole database can be exported to and imported from a JSON file.
 */
import { drawCharacterFrame, HAIR_STYLES, sanitizeAppearance, type CharacterAppearance } from '../../shared/art/character.js';
import { HAIR_RAMPS, OUTFIT_RAMPS } from '../../shared/art/palette.js';
import { SCHEMAS, type Field } from '../../shared/database-schema.js';
import { DATABASE_TYPES, PARAMS, paramAt, type DatabaseType, type ParamCurve } from '../../shared/database.js';
import { ICON_COLUMNS } from '../../shared/icons.js';
import type { SystemSettings } from '../../shared/settings.js';
import { rasterize } from '../art/render.js';
import type { AssetStore } from '../engine/assets.js';
import { sheetFlags } from '../engine/character.js';
import { t, tDynamic } from '../i18n.js';
import { confirmDialog } from '../ui/dialog.js';
import { el, icon } from '../ui/dom.js';
import { EditorApiError, type EditorApi } from './api.js';
import type { CommandLookups } from './command-specs.js';
import { openModal } from './dialogs.js';
import { CommandListEditor } from './event-editor.js';
import type { EventCommand } from '../../shared/events.js';

type AnyRecord = { id: number; name: string } & Record<string, unknown>;
type Tab = DatabaseType | 'system' | 'terms' | 'switches';

/** Tabs holding settings rather than records. */
const isSettingsTab = (tab: Tab): tab is 'system' | 'terms' | 'switches' => tab === 'system' || tab === 'terms' || tab === 'switches';

/** Lists shared by the forms (references to other records, resources). */
interface Lookups {
  records: Partial<Record<DatabaseType, AnyRecord[]>>;
  resources: Record<string, string[]>;
  system: SystemSettings | null;
  /** Image store, to preview sprites. */
  assets?: AssetStore;
  /** Lookups of the command editor (loaded for the common events and quests tabs: maps, cell picker). */
  commands?: CommandLookups & { host: HTMLElement };
  /** Events of a map, for event pickers. */
  mapEvents?: (mapId: number) => Promise<{ id: number; name: string }[]>;
}

const label = (key: string) => tDynamic(`db.field.${key}`);
const option = (value: string) => tDynamic(`db.option.${value}`);

/** Reads a value at a path of nested keys. */
function getPath(obj: Record<string, unknown>, path: (string | number)[]): unknown {
  return path.reduce<unknown>((v, k) => (v as Record<string | number, unknown> | undefined)?.[k], obj);
}

/** Writes a value at a path of nested keys. */
function setPath(obj: Record<string, unknown>, path: (string | number)[], value: unknown): void {
  let cur = obj as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]!] as Record<string | number, unknown>;
  cur[path.at(-1)!] = value;
}

/** Icon picker: grid of the icon sheet in a small dialog. */
function pickIcon(host: HTMLElement, current: number, onPick: (index: number) => void): void {
  const grid = el('div', { className: 'icon-grid' });
  for (let i = 0; i < ICON_COLUMNS * 8; i++) {
    const cell = el('button', { className: `icon-cell${i === current ? ' selected' : ''}`, title: String(i), attrs: { type: 'button' } }, [icon(i)]);
    cell.addEventListener('click', () => {
      onPick(i);
      host.querySelector('.modal-backdrop:last-child')?.remove();
    });
    grid.append(cell);
  }
  openModal(host, t('db.pick_icon'), grid, [{ label: t('common.cancel') }]);
}

/** Renders a form for a record (fields are generated from the schema). */
class RecordForm {
  readonly element = el('div', { className: 'db-form' });

  constructor(
    private readonly host: HTMLElement,
    private readonly fields: Field[],
    private readonly record: Record<string, unknown>,
    private readonly lookups: Lookups,
    private readonly onChange: () => void,
  ) {
    this.element.append(...fields.map((f) => this.fieldRow(f, [f.key])));
    if (fields.some((f) => f.key === 'characterName') && fields.some((f) => f.key === 'characterIndex')) this.addSpritePreview();
  }

  private spriteRedraw: (() => void) | null = null;

  /** Adds a preview of the chosen character sheet and index, right after the index field. */
  private addSpritePreview(): void {
    const canvas = el('canvas', { className: 'appearance-preview', attrs: { width: '96', height: '96' } });
    this.spriteRedraw = () => {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const name = String(this.record.characterName ?? '');
      const index = Number(this.record.characterIndex) || 0;
      const assets = this.lookups.assets;
      if (!name || !assets) return;
      void assets.image('characters', name).then((image) => {
        if (!image || name !== this.record.characterName || index !== (Number(this.record.characterIndex) || 0)) return;
        const { single } = sheetFlags(name);
        const fw = image.width / (single ? 3 : 12);
        const fh = image.height / (single ? 4 : 8);
        const bx = single ? 0 : (index % 4) * 3;
        const by = single ? 0 : Math.floor(index / 4) * 4;
        const scale = Math.min(canvas.width / fw, canvas.height / fh);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, (bx + 1) * fw, by * fh, fw, fh, (canvas.width - fw * scale) / 2, canvas.height - fh * scale, fw * scale, fh * scale);
      });
    };
    this.spriteRedraw();
    const row = el('div', { className: 'db-row wide' }, [el('span', { className: 'db-label', text: '' }), canvas]);
    const after = [...this.element.children].find((c) => c.querySelector('input[type="number"][max="7"]'));
    if (after) after.after(row);
    else this.element.append(row);
  }

  private change(path: (string | number)[], value: unknown): void {
    setPath(this.record, path, value);
    if (path[0] === 'characterName' || path[0] === 'characterIndex') this.spriteRedraw?.();
    this.onChange();
  }

  private fieldRow(field: Field, path: (string | number)[]): HTMLElement {
    const control = this.control(field, path, () => undefined);
    const wide = ['group', 'list', 'params', 'curves', 'commands', 'appearance'].includes(field.type) || (field.type === 'text' && field.multiline);
    return el('div', { className: `db-row${wide ? ' wide' : ''}` }, [el('span', { className: 'db-label', text: label(field.key) }), control]);
  }

  /**
   * Builds the control of a field.
   * @param refresh - Re-renders the enclosing list row (a field other fields depend on changed).
   */
  private control(field: Field, path: (string | number)[], refresh: () => void): HTMLElement {
    const value = getPath(this.record, path);
    const sibling = (key: string) => getPath(this.record, [...path.slice(0, -1), key]);
    switch (field.type) {
      case 'text': {
        const input = field.multiline ? el('textarea', { attrs: { rows: '3', maxlength: String(field.max ?? 200) } }) : el('input', { attrs: { type: 'text', maxlength: String(field.max ?? 200) } });
        input.value = String(value ?? '');
        input.addEventListener('input', () => this.change(path, input.value));
        return input;
      }
      case 'int':
      case 'number': {
        const input = el('input', { attrs: { type: 'number', min: String(field.min), max: String(field.max), step: field.type === 'int' ? '1' : 'any' } });
        input.value = String(value ?? field.min);
        input.addEventListener('input', () => this.change(path, Number(input.value)));
        return input;
      }
      case 'bool': {
        const input = el('input', { attrs: { type: 'checkbox' } });
        input.checked = value === true;
        input.addEventListener('change', () => this.change(path, input.checked));
        return input;
      }
      case 'select': {
        const s = el('select', {}, field.options.map((o) => el('option', { text: option(o), attrs: { value: o } })));
        s.value = String(value);
        s.addEventListener('change', () => {
          this.change(path, s.value);
          refresh();
        });
        return s;
      }
      case 'map': {
        const maps = this.lookups.commands?.maps ?? [];
        const s = el('select', {}, maps.map((m) => el('option', { text: `${m.id} — ${m.name}`, attrs: { value: String(m.id) } })));
        if (!maps.some((m) => m.id === Number(value))) s.append(el('option', { text: `#${String(value)}`, attrs: { value: String(value) } }));
        s.value = String(value ?? 1);
        s.addEventListener('change', () => {
          this.change(path, Number(s.value));
          refresh();
        });
        return s;
      }
      case 'event': {
        const s = el('select', {}, [el('option', { text: `#${String(value)}`, attrs: { value: String(value) } })]);
        s.value = String(value);
        void this.lookups.mapEvents?.(Number(sibling(field.mapKey)) || 1).then((events) => {
          s.replaceChildren(...events.map((e) => el('option', { text: `${e.id} — ${e.name}`, attrs: { value: String(e.id) } })));
          if (!events.some((e) => e.id === Number(value))) s.append(el('option', { text: `#${String(value)}`, attrs: { value: String(value) } }));
          s.value = String(value);
        });
        s.addEventListener('change', () => this.change(path, Number(s.value)));
        return s;
      }
      case 'cell': {
        const pick = this.lookups.commands?.pickCell;
        return el('button', {
          className: 'button small',
          text: t('db.pick_cell'),
          attrs: { type: 'button', ...(pick ? {} : { disabled: '' }) },
          on: {
            click: () =>
              void pick?.(Number(sibling(field.mapKey)) || 1).then((cell) => {
                if (!cell) return;
                const base = path.slice(0, -1);
                setPath(this.record, [...base, 'x'], cell.x);
                setPath(this.record, [...base, 'y'], cell.y);
                this.onChange();
                refresh();
              }),
          },
        });
      }
      case 'icon': {
        const preview = el('span', { className: 'icon-preview' }, [icon(Number(value) || 0)]);
        const input = el('input', { attrs: { type: 'number', min: '0', max: '9999' } });
        input.value = String(value ?? 0);
        const update = (n: number) => {
          input.value = String(n);
          preview.replaceChildren(icon(n));
          this.change(path, n);
        };
        input.addEventListener('input', () => update(Number(input.value) || 0));
        return el('div', { className: 'icon-field' }, [
          preview,
          input,
          el('button', { className: 'button small', text: t('db.choose'), attrs: { type: 'button' }, on: { click: () => pickIcon(this.host, Number(input.value) || 0, update) } }),
        ]);
      }
      case 'resource': {
        const names = this.lookups.resources[field.kind] ?? [];
        const s = el('select', {}, [el('option', { text: t('editor.none'), attrs: { value: '' } }), ...names.map((n) => el('option', { text: n, attrs: { value: n } }))]);
        s.value = String(value ?? '');
        s.addEventListener('change', () => this.change(path, s.value));
        return s;
      }
      case 'ref': {
        const list = this.lookups.records[field.ref] ?? [];
        const s = el('select', {}, [
          ...(field.allowNone ? [el('option', { text: t('editor.none'), attrs: { value: '0' } })] : []),
          ...list.map((r) => el('option', { text: `${r.id} — ${r.name}`, attrs: { value: String(r.id) } })),
        ]);
        s.value = String(value ?? 0);
        s.addEventListener('change', () => this.change(path, Number(s.value)));
        return s;
      }
      case 'params': {
        const box = el('div', { className: 'param-grid' });
        for (const p of PARAMS) {
          const input = el('input', { attrs: { type: 'number', step: '1' } });
          input.value = String((value as Record<string, number>)?.[p] ?? 0);
          input.addEventListener('input', () => this.change([...path, p], Number(input.value)));
          box.append(el('label', {}, [el('span', { text: this.paramName(p) }), input]));
        }
        return box;
      }
      case 'curves': {
        const table = el('table', { className: 'curve-table' });
        table.append(el('tr', {}, [el('th'), el('th', { text: t('db.curve.base') }), el('th', { text: t('db.curve.growth') }), el('th', { text: t('db.curve.preview') })]));
        for (const p of PARAMS) {
          const curve = (value as Record<string, ParamCurve>)[p]!;
          const preview = el('td', { className: 'curve-preview' });
          const refresh = () => (preview.textContent = [1, 10, 50, 99].map((l) => `${l}: ${paramAt(curve, l)}`).join(' · '));
          const base = el('input', { attrs: { type: 'number', min: '1' } });
          base.value = String(curve.base);
          base.addEventListener('input', () => {
            curve.base = Number(base.value);
            refresh();
            this.onChange();
          });
          const growth = el('input', { attrs: { type: 'number', min: '0', step: '0.1' } });
          growth.value = String(curve.growth);
          growth.addEventListener('input', () => {
            curve.growth = Number(growth.value);
            refresh();
            this.onChange();
          });
          refresh();
          table.append(el('tr', {}, [el('th', { text: this.paramName(p) }), el('td', {}, [base]), el('td', {}, [growth]), preview]));
        }
        return table;
      }
      case 'group': {
        const box = el('fieldset', { className: 'db-group' });
        box.append(...field.fields.map((f) => this.fieldRow(f, [...path, f.key])));
        return box;
      }
      case 'list': {
        const box = el('div', { className: 'db-list' });
        const render = () => {
          const items = (getPath(this.record, path) as Record<string, unknown>[]) ?? [];
          box.replaceChildren(
            ...items.map((row, i) =>
              el('div', { className: 'db-list-item' }, [
                ...field.fields
                  // Fields depending on another one (objective kind...) are shown only when they apply.
                  .filter((f) => !f.when || f.when.values.includes(String(row[f.when.key])))
                  .map((f) => {
                    const control = this.control(f, [...path, i, f.key], render);
                    const nested = f.type === 'list';
                    return el(nested ? 'div' : 'label', { className: nested ? 'db-sublist' : '' }, [el('span', { text: label(f.key) }), control]);
                  }),
                el('button', {
                  className: 'button small danger',
                  text: '✕',
                  title: t('editor.delete'),
                  attrs: { type: 'button' },
                  on: {
                    click: () => {
                      items.splice(i, 1);
                      this.onChange();
                      render();
                    },
                  },
                }),
              ]),
            ),
            el('button', {
              className: 'button small',
              text: t('db.add_row'),
              attrs: { type: 'button' },
              on: {
                click: () => {
                  if (items.length >= field.max) return;
                  const row: Record<string, unknown> = {};
                  for (const f of field.fields) {
                    if (f.type === 'select') row[f.key] = f.options[0];
                    else if (f.type === 'text') row[f.key] = '';
                    else if (f.type === 'bool') row[f.key] = false;
                    else if (f.type === 'ref') row[f.key] = this.lookups.records[f.ref]?.[0]?.id ?? 1;
                    else if (f.type === 'list') row[f.key] = [];
                    else if (f.type === 'map') row[f.key] = this.lookups.commands?.mapId ?? 1;
                    else if (f.type === 'event') row[f.key] = 1;
                    else if (f.type === 'cell') continue;
                    else row[f.key] = 'min' in f ? Math.max(f.min, f.type === 'int' && f.key === 'count' ? 1 : 0) : 0;
                  }
                  items.push(row);
                  setPath(this.record, path, items);
                  this.onChange();
                  render();
                },
              },
            }),
          );
        };
        render();
        return box;
      }
      case 'intList': {
        const input = el('input', { attrs: { type: 'text', placeholder: '1, 2, 3' } });
        input.value = ((value as number[]) ?? []).join(', ');
        input.addEventListener('input', () =>
          this.change(path, input.value.split(/[,;\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= field.min && n <= field.max)),
        );
        return input;
      }
      case 'appearance':
        return this.appearanceControl(path);
      case 'commands': {
        if (this.lookups.commands) {
          const list = structuredClone((value ?? []) as EventCommand[]);
          return new CommandListEditor(this.lookups.commands, list, () => this.change(path, list)).element;
        }
        const area = el('textarea', { className: 'json-area', attrs: { rows: '10', spellcheck: 'false' } });
        area.value = JSON.stringify(value ?? [], null, 1);
        area.addEventListener('input', () => {
          try {
            this.change(path, JSON.parse(area.value) as unknown);
            area.classList.remove('invalid');
          } catch {
            area.classList.add('invalid');
          }
        });
        return el('div', {}, [area, el('p', { className: 'hint', text: t('db.commands_help') })]);
      }
    }
  }

  private paramName(p: string): string {
    return this.lookups.system?.terms.params[p as keyof SystemSettings['terms']['params']] || p.toUpperCase();
  }

  private appearanceControl(path: (string | number)[]): HTMLElement {
    const current = () => sanitizeAppearance(getPath(this.record, path));
    const canvas = el('canvas', { className: 'appearance-preview' });
    const draw = () => {
      const img = rasterize(drawCharacterFrame(current(), 'down', 1), 2);
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
    };
    const set = (patch: Partial<CharacterAppearance>) => {
      this.change(path, { ...current(), ...patch });
      draw();
    };
    const a = current();
    const sel = (options: [string, string][], v: string, on: (v: string) => void) => {
      const s = el('select', {}, options.map(([value, text]) => el('option', { text, attrs: { value } })));
      s.value = v;
      s.addEventListener('change', () => on(s.value));
      return s;
    };
    const range = (n: number, prefix: string): [string, string][] => Array.from({ length: n }, (_, i) => [String(i), `${prefix} ${i + 1}`]);
    draw();
    return el('div', { className: 'appearance-field' }, [
      canvas,
      el('div', { className: 'appearance-controls' }, [
        sel([['male', t('character_new.body_male')], ['female', t('character_new.body_female')]], a.body, (v) => set({ body: v as 'male' | 'female' })),
        sel(range(4, t('character_new.skin')), String(a.skin), (v) => set({ skin: Number(v) })),
        sel(HAIR_STYLES.map((h): [string, string] => [h, tDynamic(`character_new.hair_style.${h}`)]), a.hair, (v) => set({ hair: v as CharacterAppearance['hair'] })),
        sel(range(HAIR_RAMPS.length, t('character_new.hair_color')), String(a.hairColor), (v) => set({ hairColor: Number(v) })),
        sel(range(OUTFIT_RAMPS.length, t('character_new.outfit_color')), String(a.outfitColor), (v) => set({ outfitColor: Number(v) })),
      ]),
    ]);
  }
}

/** The database window. */
export class DatabaseEditor {
  private tab: Tab = 'item';
  private records: AnyRecord[] = [];
  private selected: AnyRecord | null = null;
  private dirty = false;
  private readonly listEl = el('ul', { className: 'db-records' });
  private readonly formHost = el('div', { className: 'db-form-host' });
  private readonly tabsEl = el('div', { className: 'db-tabs', attrs: { role: 'tablist' } });
  private readonly status = el('span', { className: 'db-status' });
  private readonly lookups: Lookups = { records: {}, resources: {}, system: null };
  private close: () => void = () => undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: EditorApi,
    resources: Record<string, string[]>,
    private readonly loadCommandLookups?: () => Promise<CommandLookups>,
    assets?: AssetStore,
  ) {
    this.lookups.resources = resources;
    this.lookups.assets = assets;
    const events = new Map<number, Promise<{ id: number; name: string }[]>>();
    this.lookups.mapEvents = (mapId) => {
      let list = events.get(mapId);
      if (!list) {
        list = this.api
          .get<{ map: { events: ({ id: number; name: string } | null)[] } }>(`/maps/${mapId}`)
          .then((r) => r.map.events.filter((e): e is { id: number; name: string } => e !== null).map((e) => ({ id: e.id, name: e.name })))
          .catch(() => []);
        events.set(mapId, list);
      }
      return list;
    };
  }

  /** Opens the window. */
  async open(): Promise<void> {
    this.lookups.system = (await this.api.get<{ system: SystemSettings }>('/system')).system;
    const body = el('div', { className: 'db-editor' }, [
      this.tabsEl,
      el('div', { className: 'db-main' }, [
        el('div', { className: 'db-side' }, [
          el('div', { className: 'db-side-tools' }, [
            el('button', { className: 'button small', text: t('db.new'), attrs: { type: 'button' }, on: { click: () => void this.create() } }),
            el('button', { className: 'button small', text: t('db.duplicate'), attrs: { type: 'button' }, on: { click: () => void this.create(true) } }),
            el('button', { className: 'button small danger', text: t('editor.delete'), attrs: { type: 'button' }, on: { click: () => void this.remove() } }),
          ]),
          this.listEl,
        ]),
        this.formHost,
      ]),
    ]);
    this.close = openModal(this.host, t('db.title'), body, [
      { label: t('db.export'), onClick: () => this.exportAll() },
      { label: t('db.import'), onClick: () => this.importAll() },
      { label: t('ui.close') },
      { label: t('editor.save'), primary: true, onClick: async () => { await this.save(); return false; } },
    ]);
    body.closest('.modal')?.classList.add('db-modal');
    this.renderTabs();
    await this.showTab('item');
  }

  private renderTabs(): void {
    const tabs: Tab[] = [...DATABASE_TYPES, 'switches', 'system', 'terms'];
    this.tabsEl.replaceChildren(
      ...tabs.map((tab) =>
        el('button', {
          className: `palette-tab${tab === this.tab ? ' active' : ''}`,
          text: tDynamic(`db.tab.${tab}`),
          attrs: { type: 'button', role: 'tab' },
          on: { click: () => void this.showTab(tab) },
        }),
      ),
    );
  }

  private async loadType(type: DatabaseType): Promise<AnyRecord[]> {
    const { records } = await this.api.get<{ records: AnyRecord[] }>(`/db/${type}`);
    this.lookups.records[type] = records;
    return records;
  }

  private async showTab(tab: Tab): Promise<void> {
    if (this.dirty && !(await this.confirmDiscard())) return;
    this.dirty = false;
    this.tab = tab;
    this.renderTabs();
    // References used by forms (skills in classes and enemies, animations, quest targets...).
    await Promise.all((['skill', 'animation', 'item', 'state', 'weapon', 'armor', 'enemy', 'quest'] as DatabaseType[]).map((ty) => this.loadType(ty)));
    if ((tab === 'commonEvent' || tab === 'quest' || tab === 'raid') && this.loadCommandLookups && !this.lookups.commands) {
      this.lookups.commands = { ...(await this.loadCommandLookups()), host: this.host };
    }
    if (isSettingsTab(tab)) {
      this.listEl.replaceChildren();
      this.selected = null;
      if (tab === 'switches') this.renderSwitches();
      else this.renderSystem(tab);
      return;
    }
    this.records = await this.loadType(tab);
    await this.select(this.records[0] ?? null);
  }

  private renderList(): void {
    this.listEl.replaceChildren(
      ...this.records.map((r) =>
        el('li', {}, [
          el('button', {
            className: `tree-label${r.id === this.selected?.id ? ' current' : ''}`,
            text: `${String(r.id).padStart(3, '0')} ${r.name}`,
            attrs: { type: 'button' },
            on: { click: () => void this.select(r) },
          }),
        ]),
      ),
    );
  }

  /** Asks whether the unsaved changes of the current entry can be dropped. */
  private confirmDiscard(): Promise<boolean> {
    return confirmDialog({ title: t('editor.unsaved_title'), message: t('db.discard_question'), ok: t('editor.discard'), danger: true });
  }

  private async select(record: AnyRecord | null): Promise<void> {
    if (this.dirty && record !== this.selected && !(await this.confirmDiscard())) return;
    this.dirty = false;
    this.selected = record ? (JSON.parse(JSON.stringify(record)) as AnyRecord) : null;
    this.renderList();
    if (!this.selected || isSettingsTab(this.tab)) {
      this.formHost.replaceChildren(el('p', { className: 'hint', text: t('db.empty') }));
      return;
    }
    const form = new RecordForm(this.host, SCHEMAS[this.tab], this.selected, this.lookups, () => {
      this.dirty = true;
      this.status.textContent = t('editor.unsaved');
    });
    this.status.textContent = '';
    this.formHost.replaceChildren(el('div', { className: 'db-form-title' }, [el('strong', { text: `#${this.selected.id}` }), this.status]), form.element);
  }

  private renderSystem(tab: 'system' | 'terms'): void {
    const sys = this.lookups.system!;
    const fields: Field[] =
      tab === 'system'
        ? [
            { key: 'gameTitle', type: 'text', max: 100 },
            { key: 'currencyName', type: 'text', max: 30 },
            { key: 'startingGold', type: 'int', min: 0, max: 99_999_999 },
            { key: 'statPointsPerLevel', type: 'int', min: 0, max: 20 },
            { key: 'sellRate', type: 'int', min: 0, max: 100 },
            { key: 'bagSize', type: 'int', min: 10, max: 200 },
            { key: 'maxLevel', type: 'int', min: 1, max: 999 },
            { key: 'maxPartySize', type: 'int', min: 2, max: 40 },
            { key: 'maxRaidSize', type: 'int', min: 2, max: 40 },
            { key: 'instanceIdleMinutes', type: 'int', min: 1, max: 1440 },
            { key: 'guildCreationCost', type: 'int', min: 0, max: 99_999_999 },
            { key: 'startPosition', type: 'group', fields: [{ key: 'mapId', type: 'int', min: 1, max: 1_000_000 }, { key: 'x', type: 'int', min: 0, max: 255 }, { key: 'y', type: 'int', min: 0, max: 255 }] },
          ]
        : [
            { key: 'terms', type: 'group', fields: [{ key: 'level', type: 'text', max: 30 }, { key: 'hp', type: 'text', max: 30 }, { key: 'mp', type: 'text', max: 30 }, { key: 'xp', type: 'text', max: 30 }] },
          ];
    const form = new RecordForm(this.host, fields, sys as unknown as Record<string, unknown>, this.lookups, () => {
      this.dirty = true;
      this.status.textContent = t('editor.unsaved');
    });
    const extra: HTMLElement[] = [];
    const listEditor = (key: 'elements' | 'weaponTypes' | 'armorTypes') => {
      const area = el('textarea', { attrs: { rows: '5' } });
      area.value = sys[key].join('\n');
      area.addEventListener('input', () => {
        sys[key] = area.value.split('\n').map((s) => s.trim()).filter((s, i) => s !== '' || i === 0);
        this.dirty = true;
      });
      return el('div', { className: 'db-row wide' }, [el('span', { className: 'db-label', text: label(key) }), area, el('p', { className: 'hint', text: t('db.one_per_line') })]);
    };
    if (tab === 'system') extra.push(listEditor('elements'), listEditor('weaponTypes'), listEditor('armorTypes'));
    else {
      const box = el('div', { className: 'param-grid' });
      for (const p of PARAMS) {
        const input = el('input', { attrs: { type: 'text', maxlength: '30' } });
        input.value = sys.terms.params[p];
        input.addEventListener('input', () => {
          sys.terms.params[p] = input.value;
          this.dirty = true;
        });
        box.append(el('label', {}, [el('span', { text: p.toUpperCase() }), input]));
      }
      extra.push(el('div', { className: 'db-row wide' }, [el('span', { className: 'db-label', text: label('params') }), box]));
    }
    this.formHost.replaceChildren(el('div', { className: 'db-form-title' }, [el('strong', { text: tDynamic(`db.tab.${tab}`) }), this.status]), form.element, ...extra);
  }

  /** Switch and variable declarations: name and scope of each id. */
  private renderSwitches(): void {
    const sys = this.lookups.system!;
    const column = (key: 'switches' | 'variables') => {
      const box = el('div', { className: 'data-names' });
      const render = () => {
        box.replaceChildren(
          ...sys[key].map((d, i) => {
            const name = el('input', { attrs: { type: 'text', maxlength: '60', 'aria-label': `#${i + 1}` } });
            name.value = d.name;
            name.addEventListener('input', () => {
              d.name = name.value;
              this.dirty = true;
              this.status.textContent = t('editor.unsaved');
            });
            const global = el('input', { attrs: { type: 'checkbox' } });
            global.checked = d.global;
            global.addEventListener('change', () => {
              d.global = global.checked;
              this.dirty = true;
              this.status.textContent = t('editor.unsaved');
            });
            const instance = el('input', { attrs: { type: 'checkbox' } });
            instance.checked = d.instance === true;
            instance.addEventListener('change', () => {
              d.instance = instance.checked;
              if (instance.checked) {
                d.global = false;
                global.checked = false;
              }
              this.dirty = true;
              this.status.textContent = t('editor.unsaved');
            });
            return el('div', { className: 'data-name-row' }, [
              el('span', { className: 'data-id', text: `#${String(i + 1).padStart(4, '0')}` }),
              name,
              el('label', { className: 'inline-check' }, [global, el('span', { text: t('db.global') })]),
              // Instance scope exists for switches only.
              key === 'switches' ? el('label', { className: 'inline-check', title: t('db.instance_help') }, [instance, el('span', { text: t('db.instance') })]) : el('span'),
            ]);
          }),
        );
      };
      render();
      const add = el('button', {
        className: 'button small',
        text: key === 'switches' ? t('db.add_switch') : t('db.add_variable'),
        attrs: { type: 'button' },
        on: {
          click: () => {
            sys[key].push({ name: '', global: false });
            this.dirty = true;
            render();
          },
        },
      });
      // Only the last declaration can be removed, so ids used by events never shift.
      const removeLast = el('button', {
        className: 'button small danger',
        text: '−',
        attrs: { type: 'button', title: t('editor.delete') },
        on: {
          click: () => {
            sys[key].pop();
            this.dirty = true;
            render();
          },
        },
      });
      return el('section', { className: 'data-column' }, [el('h3', { text: t(key === 'switches' ? 'db.switches' : 'db.variables') }), box, el('div', { className: 'inline-row' }, [add, removeLast])]);
    };
    this.formHost.replaceChildren(
      el('div', { className: 'db-form-title' }, [el('strong', { text: t('db.tab.switches') }), this.status]),
      el('p', { className: 'hint', text: t('db.switches_help') }),
      el('div', { className: 'data-columns' }, [column('switches'), column('variables')]),
    );
  }

  private async save(): Promise<void> {
    if (isSettingsTab(this.tab)) {
      this.lookups.system = (await this.api.put<{ system: SystemSettings }>('/system', { system: this.lookups.system })).system;
    } else if (this.selected) {
      const { record } = await this.api.put<{ record: AnyRecord }>(`/db/${this.tab}/${this.selected.id}`, { record: this.selected });
      this.records = this.records.map((r) => (r.id === record.id ? record : r));
      this.selected = JSON.parse(JSON.stringify(record)) as AnyRecord;
      this.renderList();
    }
    this.dirty = false;
    this.status.textContent = t('db.saved');
  }

  private async create(copy = false): Promise<void> {
    if (isSettingsTab(this.tab)) return;
    const { record } = await this.api.post<{ record: AnyRecord }>(`/db/${this.tab}`, copy && this.selected ? { copyOf: this.selected.id } : {});
    this.records.push(record);
    this.dirty = false;
    await this.select(record);
  }

  private async remove(): Promise<void> {
    if (!this.selected || isSettingsTab(this.tab)) return;
    if (!(await confirmDialog({ title: t('editor.delete'), message: t('db.delete_confirm', { name: this.selected.name }), ok: t('editor.delete'), danger: true }))) return;
    try {
      await this.api.delete(`/db/${this.tab}/${this.selected.id}`);
      const id = this.selected.id;
      this.records = this.records.filter((r) => r.id !== id);
      this.dirty = false;
      await this.select(this.records[0] ?? null);
    } catch (err) {
      this.status.textContent = err instanceof EditorApiError ? tDynamic(err.key, err.params) : String(err);
    }
  }

  private exportAll(): boolean {
    const link = el('a', { attrs: { href: '/api/editor/db-export', download: 'database.json' } });
    this.host.append(link);
    link.click();
    link.remove();
    return false;
  }

  private importAll(): boolean {
    const input = el('input', { attrs: { type: 'file', accept: '.json,application/json' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!(await confirmDialog({ title: t('db.import'), message: t('db.import_confirm'), ok: t('db.import'), danger: true }))) return;
      try {
        const data = JSON.parse(await file.text()) as unknown;
        await this.api.post('/db-import', data);
        this.status.textContent = t('db.imported');
        await this.showTab(this.tab);
      } catch (err) {
        this.status.textContent = err instanceof EditorApiError ? tDynamic(err.key, err.params) : t('error.editor.invalid_json');
      }
    });
    input.click();
    return false;
  }

  /** Closes the window. */
  dispose(): void {
    this.close();
  }
}

