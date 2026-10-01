/**
 * @file The map editor application, opened full screen over the game by
 * administrators.
 *
 * Layout: toolbar at the top (save, undo/redo, tools, modes, layer, zoom,
 * grid, tileset editor, versions, close), map tree and tile palette on the
 * left, the map canvas in the centre and a status bar at the bottom.
 *
 * Editing works on a local copy of the map. Saving sends the whole map to the
 * server, which validates it, keeps a snapshot in the history and updates the
 * players on the map immediately. Opening a map takes its edit lock; when
 * another administrator holds it, the map opens read-only.
 */
import { tilesetSheetNames } from '../../shared/conversions.js';
import type { TilesetData } from '../../shared/database.js';
import type { GameEvent } from '../../shared/events.js';
import type { MapData, MapInfo } from '../../shared/map.js';
import { TILESET_SHEETS, type TilesetSheet } from '../../shared/tiles.js';
import type { SystemSettings } from '../../shared/settings.js';
import type { AssetStore, Bitmap } from '../engine/assets.js';
import { TilemapRenderer } from '../engine/tilemap.js';
import { t, tDynamic } from '../i18n.js';
import { el } from '../ui/dom.js';
import { EditorApi, EditorApiError } from './api.js';
import { newMapDialog, openModal, propertiesDialog, quickEventDialog, quickKindOf, versionsDialog, type ResourceLists } from './dialogs.js';
import { openEventEditor, type EventEditorContext } from './event-editor.js';
import { editRoute } from './route-editor.js';
import { MapEditor, applyChanges, type CellChange, type Stamp } from './edit-ops.js';
import { MapView, type Mode, type Tool } from './map-view.js';
import { TilePalette } from './palette.js';
import { DatabaseEditor } from './database-editor.js';
import { openImportDialog, openResourceManager } from './resources-dialog.js';
import { openTilesetEditor } from './tileset-editor.js';

/** Undo history entry. */
type HistoryEntry =
  | { kind: 'cells'; changes: CellChange[] }
  | { kind: 'events'; before: string; after: string }
  | { kind: 'props'; before: string; after: string };

/** Options to open the editor. */
export interface EditorOptions {
  /** Element the editor is appended to. */
  container: HTMLElement;
  csrf: string;
  assets: AssetStore;
  /** Map opened first (the map the administrator is on). */
  startMapId: number;
  onClose: () => void;
}

interface TilesetSummary {
  id: number;
  name: string;
  mode: number;
  tilesetNames: string[];
}

const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The editor application. */
export class MapEditorApp {
  private readonly root: HTMLDivElement;
  private readonly api: EditorApi;
  private readonly treeEl = el('ul', { className: 'map-tree', attrs: { role: 'tree' } });
  private readonly paletteHost = el('div', { className: 'palette-host' });
  private readonly viewHost = el('div', { className: 'view-host' });
  private readonly status = el('div', { className: 'editor-status' });
  private readonly titleEl = el('span', { className: 'editor-map-title' });
  private readonly saveButton: HTMLButtonElement;
  private infos: MapInfo[] = [];
  private tilesets: TilesetSummary[] = [];
  private resources: ResourceLists = { characters: [], faces: [], parallaxes: [], bgm: [], animations: [], se: [] };
  private tilesetImages: string[] = [];
  private info: MapInfo | null = null;
  private map: MapData | null = null;
  private tileset: TilesetData | null = null;
  private sheets: Partial<Record<TilesetSheet, Bitmap>> = {};
  private view: MapView | null = null;
  private palette: TilePalette | null = null;
  private dirty = false;
  private readOnly = false;
  private lockHolder = '';
  private tool: Tool = 'pencil';
  private mode: Mode = 'tiles';
  private grid = true;
  private forcedLayer: number | null = null;
  /** Show only the forced layer. */
  private onlyLayer = false;
  private stamp: Stamp = { tiles: [[0]] };
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private clipboard: number[][][] | null = null;
  private eventClipboard: GameEvent | null = null;
  private readonly eventImages = new Map<string, Bitmap | null>();
  private lockTimer = 0;
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);

  private constructor(private readonly options: EditorOptions) {
    this.api = new EditorApi(options.csrf);
    this.saveButton = this.button(t('editor.save'), () => void this.save(), 'primary');
    this.root = el('div', { className: 'editor', attrs: { role: 'application', 'aria-label': t('editor.title') } });
    options.container.append(this.root);
    document.body.classList.add('editor-open');
    window.addEventListener('keydown', this.keyHandler, true);
  }

  /**
   * Opens the editor.
   * @param options - Container, credentials and callbacks.
   */
  static async open(options: EditorOptions): Promise<MapEditorApp> {
    const app = new MapEditorApp(options);
    await app.init();
    return app;
  }

  private button(label: string, onClick: () => void, extra = '', title?: string): HTMLButtonElement {
    return el('button', { className: `button small ${extra}`, text: label, title: title ?? label, attrs: { type: 'button' }, on: { click: onClick } });
  }

  private async init(): Promise<void> {
    const boot = await this.api.get<{ maps: MapInfo[]; tilesets: TilesetSummary[] }>('/bootstrap');
    this.infos = boot.maps;
    this.tilesets = boot.tilesets;
    await this.loadResourceLists();
    this.buildLayout();
    const first = this.infos.find((i) => i.id === this.options.startMapId) ?? this.infos[0];
    if (first) await this.loadMap(first.id);
    this.lockTimer = window.setInterval(() => void this.refreshLock(), 60_000);
  }

  /** Reads the resource manifest into the pickers' lists (after uploads too). */
  private async loadResourceLists(): Promise<void> {
    const manifest = await fetch('/api/resources', { credentials: 'same-origin' }).then(
      (r) => r.json() as Promise<{ resources: { kind: string; name: string; format: string; width: number | null; height: number | null }[] }>,
    );
    const of = (kind: string) => manifest.resources.filter((r) => r.kind === kind);
    const names = (kind: string) => of(kind).map((r) => r.name);
    this.resources = { characters: names('characters'), faces: names('faces'), parallaxes: names('parallaxes'), bgm: names('bgm'), animations: names('animations'), se: names('se') };
    this.tilesetImages = of('tilesets').flatMap((r) => tilesetSheetNames(r.name, r.format, r.width ?? 0, r.height ?? 0));
  }

  // --- Layout ------------------------------------------------------------------

  private buildLayout(): void {
    const toolDefs: [Tool, string, string][] = [
      ['pencil', '✎', t('editor.tool.pencil')],
      ['rect', '▭', t('editor.tool.rect')],
      ['ellipse', '◯', t('editor.tool.ellipse')],
      ['fill', '▨', t('editor.tool.fill')],
      ['picker', '⌖', t('editor.tool.picker')],
      ['eraser', '⌫', t('editor.tool.eraser')],
      ['select', '⬚', t('editor.tool.select')],
    ];
    const modeDefs: [Mode, string][] = [
      ['tiles', t('editor.mode.tiles')],
      ['shadow', t('editor.mode.shadow')],
      ['region', t('editor.mode.region')],
      ['events', t('editor.mode.events')],
      ['passage', t('editor.mode.passage')],
    ];
    const group = (cls: string, items: HTMLElement[]) => el('div', { className: `toolbar-group ${cls}` }, items);
    const tools = group('tools', toolDefs.map(([id, symbol, label]) => {
      const b = this.button(symbol, () => this.setTool(id), 'tool', label);
      b.dataset.tool = id;
      return b;
    }));
    const modes = group('modes', modeDefs.map(([id, label]) => {
      const b = this.button(label, () => this.setMode(id), 'mode');
      b.dataset.mode = id;
      return b;
    }));
    const layer = el('select', { title: t('editor.layer'), attrs: { 'aria-label': t('editor.layer') } }, [
      el('option', { text: t('editor.layer_auto'), attrs: { value: '' } }),
      ...[1, 2, 3, 4].map((n) => el('option', { text: t('editor.layer_n', { n }), attrs: { value: String(n - 1) } })),
    ]);
    const onlyLayer = el('label', { className: 'toolbar-check', title: t('editor.only_layer_hint') }, [el('input', { attrs: { type: 'checkbox' } }), el('span', { text: t('editor.only_layer') })]);
    const applyLayerView = () => {
      const only = (onlyLayer.querySelector('input') as HTMLInputElement).checked;
      this.onlyLayer = only;
      this.view?.renderer.showOnlyLayer(only ? this.forcedLayer : null);
      this.view?.requestDraw();
    };
    onlyLayer.querySelector('input')!.addEventListener('change', applyLayerView);
    layer.addEventListener('change', () => {
      this.forcedLayer = layer.value === '' ? null : Number(layer.value);
      applyLayerView();
    });
    const zoom = el('select', { title: t('editor.zoom'), attrs: { 'aria-label': t('editor.zoom') } }, [0.25, 0.5, 0.75, 1, 2].map((z) => el('option', { text: `${z * 100} %`, attrs: { value: String(z) } })));
    zoom.value = '0.5';
    zoom.addEventListener('change', () => this.view?.setZoom(Number(zoom.value)));
    const grid = el('label', { className: 'toolbar-check' }, [el('input', { attrs: { type: 'checkbox', checked: '' } }), el('span', { text: t('editor.grid') })]);
    grid.querySelector('input')!.addEventListener('change', (e) => {
      this.grid = (e.target as HTMLInputElement).checked;
      this.view?.requestDraw();
    });
    const toolbar = el('div', { className: 'editor-toolbar' }, [
      group('file', [
        this.saveButton,
        this.button('↶', () => this.undo(), '', `${t('editor.undo')} (Ctrl+Z)`),
        this.button('↷', () => this.redo(), '', `${t('editor.redo')} (Ctrl+Y)`),
      ]),
      tools,
      modes,
      group('view', [layer, onlyLayer, zoom, grid]),
      group('extra', [
        this.button(t('editor.properties'), () => void this.openProperties()),
        this.button(t('editor.tilesets'), () => void this.openTilesets()),
        this.button(t('db.button'), () => void new DatabaseEditor(this.root, this.api, { ...this.resources }, () => (this.map ? this.eventLookups(this.map).then((l) => ({ ...l, events: [] })) : Promise.reject(new Error('no map'))), this.options.assets).open().catch((e) => this.showError(e))),
        this.button(t('editor.versions'), () => void this.openVersions()),
        this.button(t('editor.resources.button'), () => openResourceManager(this.root, this.api, () => void this.loadResourceLists())),
        this.button(t('editor.import.button'), () => openImportDialog(this.root, this.api, () => void this.reloadTree())),
        this.button(t('editor.export'), () => this.exportMap()),
        this.button('✕', () => void this.close(), 'danger', t('editor.close')),
      ]),
    ]);
    const treeTools = el('div', { className: 'tree-tools' }, [
      this.button('+', () => this.newMap(), '', t('editor.new_map')),
      this.button('↑', () => void this.reorder(-1), '', t('editor.move_up')),
      this.button('↓', () => void this.reorder(1), '', t('editor.move_down')),
      this.button('←', () => void this.outdent(), '', t('editor.outdent')),
      this.button('→', () => void this.indent(), '', t('editor.indent')),
      this.button('🗑', () => void this.deleteMap(), 'danger', t('editor.delete_map')),
    ]);
    const sidebar = el('div', { className: 'editor-sidebar' }, [
      el('div', { className: 'editor-panel tree-panel' }, [el('div', { className: 'panel-title' }, [el('span', { text: t('editor.maps') }), treeTools]), this.treeEl]),
      el('div', { className: 'editor-panel palette-panel' }, [el('div', { className: 'panel-title', text: t('editor.palette') }), this.paletteHost]),
    ]);
    this.root.replaceChildren(
      el('div', { className: 'editor-header' }, [el('span', { className: 'editor-title', text: t('editor.title') }), this.titleEl]),
      toolbar,
      el('div', { className: 'editor-main' }, [sidebar, this.viewHost]),
      this.status,
    );
    this.setTool('pencil');
    this.setMode('tiles');
    this.renderTree();
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.classList.toggle('active', b.dataset.mode === mode);
    if (mode === 'region' && this.palette && this.palette.currentTab !== 'R') this.palette.setTab('R');
    if (mode === 'tiles' && this.palette?.currentTab === 'R') this.palette.setTab('A');
    this.view?.requestDraw();
  }

  private renderTree(): void {
    const children = (parentId: number): HTMLElement[] =>
      this.infos
        .filter((i) => i.parentId === parentId)
        .sort((a, b) => a.order - b.order || a.id - b.id)
        .map((info) => {
          const kids = children(info.id);
          const toggle = el('button', {
            className: 'tree-toggle',
            text: kids.length ? (info.expanded ? '▾' : '▸') : '',
            attrs: { type: 'button', 'aria-label': t('editor.expand') },
            on: {
              click: () => {
                info.expanded = !info.expanded;
                void this.api.patch(`/maps/${info.id}/info`, { expanded: info.expanded });
                this.renderTree();
              },
            },
          });
          const label = el('button', {
            className: `tree-label${info.id === this.info?.id ? ' current' : ''}`,
            text: `${info.id} · ${info.name}`,
            attrs: { type: 'button', role: 'treeitem' },
            on: { click: () => void this.switchMap(info.id) },
          });
          return el('li', {}, [el('div', { className: 'tree-row' }, [toggle, label]), kids.length && info.expanded ? el('ul', {}, kids) : null]);
        });
    this.treeEl.replaceChildren(...children(0));
  }

  private setStatus(extra = ''): void {
    const lock = this.readOnly ? ` — ${t('editor.read_only', { name: this.lockHolder })}` : '';
    const dirty = this.dirty ? ` — ${t('editor.unsaved')}` : '';
    this.status.textContent = `${extra}${lock}${dirty}`;
    this.saveButton.disabled = this.readOnly || !this.dirty;
    this.titleEl.textContent = this.info ? `${this.info.name}${this.dirty ? ' *' : ''}` : '';
  }

  private notify(text: string): void {
    const toast = el('div', { className: 'skin-window editor-toast', text });
    this.root.append(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  private showError(err: unknown): void {
    if (err instanceof EditorApiError) this.notify(tDynamic(err.key, err.params));
    else {
      console.error(err);
      this.notify(t('error.http.server'));
    }
  }

  // --- Maps ----------------------------------------------------------------------

  private async loadSheets(tileset: TilesetData): Promise<Partial<Record<TilesetSheet, Bitmap>>> {
    const sheets: Partial<Record<TilesetSheet, Bitmap>> = {};
    await Promise.all(
      TILESET_SHEETS.map(async (slot, i) => {
        const name = tileset.tilesetNames[i];
        const img = name ? await this.options.assets.image('tilesets', name) : null;
        if (img) sheets[slot] = img;
      }),
    );
    return sheets;
  }

  /** Asks what to do with unsaved changes; resolves `true` when it is fine to continue. */
  private confirmDiscard(): Promise<boolean> {
    if (!this.dirty) return Promise.resolve(true);
    return new Promise((resolve) => {
      openModal(this.root, t('editor.unsaved_title'), el('p', { text: t('editor.unsaved_question') }), [
        { label: t('common.cancel'), onClick: () => resolve(false) },
        { label: t('editor.discard'), danger: true, onClick: () => resolve(true) },
        {
          label: t('editor.save'),
          primary: true,
          onClick: async () => {
            const ok = await this.save();
            resolve(ok);
          },
        },
      ]);
    });
  }

  private async switchMap(id: number): Promise<void> {
    if (id === this.info?.id) return;
    if (!(await this.confirmDiscard())) return;
    if (this.info && !this.readOnly) void this.api.delete(`/maps/${this.info.id}/lock`).catch(() => undefined);
    await this.loadMap(id);
  }

  private async loadMap(id: number): Promise<void> {
    try {
      const { info, map } = await this.api.get<{ info: MapInfo; map: MapData }>(`/maps/${id}`);
      this.readOnly = false;
      this.lockHolder = '';
      try {
        await this.api.post(`/maps/${id}/lock`);
      } catch (err) {
        if (err instanceof EditorApiError && err.key === 'error.editor.locked') {
          this.readOnly = true;
          this.lockHolder = String(err.params.name ?? '?');
        } else throw err;
      }
      const tileset = (await this.api.get<{ tileset: TilesetData }>(`/tilesets/${map.tilesetId}`)).tileset;
      this.info = info;
      this.map = map;
      this.tileset = tileset;
      this.sheets = await this.loadSheets(tileset);
      this.undoStack = [];
      this.redoStack = [];
      this.dirty = false;
      this.mountView();
      this.renderTree();
      this.setStatus();
    } catch (err) {
      this.showError(err);
    }
  }

  private mountView(): void {
    const map = this.map!;
    const tileset = this.tileset!;
    const renderer = new TilemapRenderer({ width: 1, height: 1, data: [0, 0, 0, 0, 0, 0] }, tileset.flags, this.sheets, 48);
    if (!this.palette) {
      this.palette = new TilePalette(renderer, tileset.tilesetNames, (s) => {
        this.stamp = s;
        if (s.region && this.mode !== 'region') this.setMode('region');
        if (!s.region && this.mode === 'region') this.setMode('tiles');
      });
      this.paletteHost.replaceChildren(this.palette.element);
    } else {
      this.palette.setTileset(renderer, tileset.tilesetNames);
    }
    const zoom = this.view?.zoom ?? 0.5;
    this.view = new MapView(map, tileset.flags, this.sheets, {
      tool: () => this.tool,
      mode: () => this.mode,
      stamp: () => this.stamp,
      forcedLayer: () => this.forcedLayer,
      readOnly: () => this.readOnly,
      showGrid: () => this.grid,
      onEdit: (changes) => this.pushHistory({ kind: 'cells', changes }),
      onPassageEdit: (before, after) => this.pushHistory({ kind: 'props', before, after }),
      onPick: (id) => {
        this.palette?.selectTile(id);
        if (this.tool === 'picker') this.setTool('pencil');
      },
      onCursor: (x, y) => this.setStatus(`${x}, ${y}`),
      onEventSelect: () => undefined,
      onEventOpen: (x, y, id) => void this.openEvent(x, y, id),
      onEventMove: (id, x, y) => this.editEvents(() => {
        const e = this.map!.events[id];
        if (e) {
          e.x = x;
          e.y = y;
        }
      }),
      eventImage: (name) => this.eventImage(name),
    });
    this.view.zoom = zoom;
    if (this.onlyLayer) this.view.renderer.showOnlyLayer(this.forcedLayer);
    this.viewHost.replaceChildren(this.view.element);
    this.view.setZoom(zoom);
  }

  private eventImage(name: string): Bitmap | null {
    if (this.eventImages.has(name)) return this.eventImages.get(name) ?? null;
    this.eventImages.set(name, null);
    void this.options.assets.image('characters', name).then((img) => {
      this.eventImages.set(name, img);
      this.view?.requestDraw();
    });
    return null;
  }

  private async refreshLock(): Promise<void> {
    if (!this.info || this.readOnly) return;
    try {
      await this.api.post(`/maps/${this.info.id}/lock`);
    } catch (err) {
      if (err instanceof EditorApiError && err.key === 'error.editor.locked') {
        this.readOnly = true;
        this.lockHolder = String(err.params.name ?? '?');
        this.setStatus();
      }
    }
  }

  /** Saves the map; resolves `true` on success. */
  private async save(): Promise<boolean> {
    if (!this.info || !this.map || this.readOnly) return false;
    try {
      await this.api.put(`/maps/${this.info.id}`, { map: this.map });
      this.dirty = false;
      this.setStatus();
      this.notify(t('editor.saved'));
      return true;
    } catch (err) {
      this.showError(err);
      return false;
    }
  }

  /** Reloads the map tree and resource lists (after a project import). */
  private async reloadTree(): Promise<void> {
    const boot = await this.api.get<{ maps: MapInfo[]; tilesets: TilesetSummary[] }>('/bootstrap');
    this.infos = boot.maps;
    this.tilesets = boot.tilesets;
    await this.loadResourceLists();
    this.renderTree();
  }

  /** Downloads the current map in the external map file layout. */
  private exportMap(): void {
    if (!this.info) return;
    const link = el('a', { attrs: { href: `/api/editor/maps/${this.info.id}/export`, download: `Map${String(this.info.id).padStart(3, '0')}.json` } });
    this.root.append(link);
    link.click();
    link.remove();
  }

  private newMap(): void {
    newMapDialog(this.root, this.tilesets, async (v) => {
      const { info } = await this.api.post<{ info: MapInfo }>('/maps', { ...v, parentId: this.info?.parentId ?? 0 });
      this.infos.push(info);
      this.renderTree();
      await this.switchMap(info.id);
    });
  }

  private async reorder(delta: number): Promise<void> {
    const info = this.info;
    if (!info) return;
    const siblings = this.infos.filter((i) => i.parentId === info.parentId).sort((a, b) => a.order - b.order || a.id - b.id);
    const index = siblings.findIndex((i) => i.id === info.id);
    const other = siblings[index + delta];
    if (!other) return;
    siblings.forEach((s, i) => (s.order = i + 1));
    [info.order, other.order] = [other.order, info.order];
    await Promise.all([this.api.patch(`/maps/${info.id}/info`, { order: info.order }), this.api.patch(`/maps/${other.id}/info`, { order: other.order })]).catch((e) => this.showError(e));
    this.renderTree();
  }

  private async outdent(): Promise<void> {
    const info = this.info;
    if (!info || info.parentId === 0) return;
    const parent = this.infos.find((i) => i.id === info.parentId);
    await this.moveTo(info, parent?.parentId ?? 0);
  }

  private async indent(): Promise<void> {
    const info = this.info;
    if (!info) return;
    const siblings = this.infos.filter((i) => i.parentId === info.parentId).sort((a, b) => a.order - b.order || a.id - b.id);
    const previous = siblings[siblings.findIndex((i) => i.id === info.id) - 1];
    if (previous) await this.moveTo(info, previous.id);
  }

  private async moveTo(info: MapInfo, parentId: number): Promise<void> {
    try {
      const res = await this.api.patch<{ info: MapInfo }>(`/maps/${info.id}/info`, { parentId, order: 9999 });
      Object.assign(info, res.info);
      this.renderTree();
    } catch (err) {
      this.showError(err);
    }
  }

  private async deleteMap(): Promise<void> {
    const info = this.info;
    if (!info) return;
    openModal(this.root, t('editor.delete_map'), el('p', { text: t('editor.delete_map_confirm', { name: info.name }) }), [
      { label: t('common.cancel') },
      {
        label: t('editor.delete'),
        danger: true,
        onClick: async () => {
          await this.api.delete(`/maps/${info.id}`);
          this.infos = this.infos.filter((i) => i.id !== info.id);
          this.dirty = false;
          this.info = null;
          const next = this.infos[0];
          if (next) await this.loadMap(next.id);
          this.renderTree();
        },
      },
    ]);
  }

  private async openProperties(): Promise<void> {
    const info = this.info;
    const map = this.map;
    if (!info || !map) return;
    const enemies = await this.api.get<{ records: { id: number; name: string }[] }>('/db/enemy').then((r) => r.records.map((e) => ({ id: e.id, name: e.name })), () => []);
    propertiesDialog(this.root, info, map, this.tilesets, enemies, this.resources, async ({ name, width, height, data }) => {
      if (this.readOnly) throw new EditorApiError('error.editor.lock_required');
      const resized = width !== map.width || height !== map.height;
      if (resized && this.dirty && !(await this.save())) return;
      if (name !== info.name || resized) {
        const res = await this.api.patch<{ info: MapInfo; map: MapData }>(`/maps/${info.id}/info`, { name, width, height });
        Object.assign(info, res.info);
        if (resized) {
          this.map = res.map;
          this.undoStack = [];
          this.redoStack = [];
        }
        this.renderTree();
      }
      const before = JSON.stringify(this.pickProps(this.map!));
      Object.assign(this.map!, data);
      const after = JSON.stringify(this.pickProps(this.map!));
      if (before !== after) this.pushHistory({ kind: 'props', before, after });
      if (data.tilesetId !== undefined && data.tilesetId !== this.tileset?.id) {
        this.tileset = (await this.api.get<{ tileset: TilesetData }>(`/tilesets/${data.tilesetId}`)).tileset;
        this.sheets = await this.loadSheets(this.tileset);
      }
      this.mountView();
      this.setStatus();
    });
  }

  private pickProps(map: MapData): Partial<MapData> {
    const { data: _d, events: _e, width: _w, height: _h, ...props } = map;
    return props;
  }

  private async openTilesets(): Promise<void> {
    try {
      await openTilesetEditor(this.root, this.api, this.options.assets, this.tilesets, this.tilesetImages, this.map?.tilesetId ?? 1, (saved) => {
        const summary = this.tilesets.find((ts) => ts.id === saved.id);
        if (summary) Object.assign(summary, { name: saved.name, mode: saved.mode, tilesetNames: saved.tilesetNames });
        if (this.map && saved.id === this.map.tilesetId) {
          this.tileset = saved;
          void this.loadSheets(saved).then((sheets) => {
            this.sheets = sheets;
            this.mountView();
          });
        }
        this.notify(t('editor.saved'));
      });
    } catch (err) {
      this.showError(err);
    }
  }

  private async openVersions(): Promise<void> {
    const info = this.info;
    if (!info) return;
    try {
      const { versions } = await this.api.get<{ versions: { id: number; createdAt: string }[] }>(`/maps/${info.id}/versions`);
      versionsDialog(this.root, versions, async (versionId) => {
        const { map } = await this.api.post<{ map: MapData }>(`/maps/${info.id}/versions/${versionId}/restore`);
        this.map = map;
        this.undoStack = [];
        this.redoStack = [];
        this.dirty = false;
        this.mountView();
        this.setStatus();
        this.notify(t('editor.restored'));
      });
    } catch (err) {
      this.showError(err);
    }
  }

  // --- Events ------------------------------------------------------------------------

  /** Applies a change to the event list, recording it in the history. */
  private editEvents(change: () => void): void {
    if (!this.map || this.readOnly) return;
    const before = JSON.stringify(this.map.events);
    change();
    // Trailing deleted slots are dropped so ids stay compact.
    while (this.map.events.length > 1 && this.map.events.at(-1) === null) this.map.events.pop();
    const after = JSON.stringify(this.map.events);
    if (before !== after) this.pushHistory({ kind: 'events', before, after });
    this.view?.requestDraw();
  }

  /** Loads what the event forms offer to pick from (database entries, switch names...). */
  private async eventLookups(map: MapData): Promise<EventEditorContext> {
    type Named = { id: number; name: string };
    const list = (type: string) => this.api.get<{ records: Named[] }>(`/db/${type}`).then((r) => r.records.map((e) => ({ id: e.id, name: e.name })));
    const [system, items, weapons, armors, commonEvents, animations, quests, enemies] = await Promise.all([
      this.api.get<{ system: SystemSettings }>('/system').then((r) => r.system),
      list('item'), list('weapon'), list('armor'), list('commonEvent'), list('animation'), list('quest'), list('enemy'),
    ]);
    return {
      host: this.root,
      map,
      assets: this.options.assets,
      switches: system.switches,
      variables: system.variables,
      items, weapons, armors, commonEvents, animations, quests, enemies,
      maps: this.infos.map((m) => ({ id: m.id, name: m.name })),
      mapId: this.info!.id,
      events: map.events.filter((e): e is GameEvent => e !== null).map((e) => ({ id: e.id, name: e.name })),
      resources: this.resources,
      pickCell: (mapId) => this.pickCell(mapId),
      editRoute: (route) => editRoute(this.root, route, this.resources),
    };
  }

  private async openEvent(x: number, y: number, id: number | null): Promise<void> {
    const map = this.map;
    if (!map || this.readOnly) return;
    const look = await this.eventLookups(map);
    const existing = id !== null ? map.events[id] ?? null : null;
    const done = (event: GameEvent | null) =>
      this.editEvents(() => {
        if (event === null && existing) map.events[existing.id] = null;
        else if (event) map.events[event.id] = event;
      });
    // Events the quick forms cannot represent open in the full editor directly.
    if (existing && quickKindOf(existing) === 'json') {
      openEventEditor(look, x, y, existing, done);
      return;
    }
    quickEventDialog(
      {
        host: this.root,
        maps: this.infos,
        currentMapId: this.info!.id,
        map,
        resources: this.resources,
        items: look.items,
        pickCell: (mapId) => this.pickCell(mapId),
        openFullEditor: (event) => openEventEditor(look, x, y, event, done, existing !== null),
      },
      x,
      y,
      existing,
      done,
    );
  }

  /** Shows a map preview and resolves with the clicked cell. */
  private async pickCell(mapId: number): Promise<{ x: number; y: number } | null> {
    const { map } = mapId === this.info?.id && this.map ? { map: this.map } : await this.api.get<{ map: MapData }>(`/maps/${mapId}`);
    const tileset = map.tilesetId === this.tileset?.id ? this.tileset : (await this.api.get<{ tileset: TilesetData }>(`/tilesets/${map.tilesetId}`)).tileset;
    const sheets = await this.loadSheets(tileset);
    const renderer = new TilemapRenderer(map, tileset.flags, sheets, 48);
    const scale = Math.min(1, 720 / (map.width * 48), 480 / (map.height * 48));
    const canvas = el('canvas', { className: 'pick-canvas' });
    canvas.width = Math.round(map.width * 48 * scale);
    canvas.height = Math.round(map.height * 48 * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.scale(scale, scale);
    renderer.drawLower(ctx, 0, 0, map.width * 48, map.height * 48);
    renderer.drawUpper(ctx, 0, 0, map.width * 48, map.height * 48);
    return new Promise((resolve) => {
      let close: () => void = () => undefined;
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(((e.clientX - rect.left) / rect.width) * map.width);
        const y = Math.floor(((e.clientY - rect.top) / rect.height) * map.height);
        close();
        resolve({ x, y });
      });
      close = openModal(this.root, t('editor.pick_on_map'), el('div', { className: 'pick-body' }, [el('p', { className: 'hint', text: t('editor.pick_help') }), canvas]), [
        { label: t('common.cancel'), onClick: () => resolve(null) },
      ]);
    });
  }

  // --- History -------------------------------------------------------------------------

  private pushHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.setStatus();
  }

  private applyEntry(entry: HistoryEntry, undo: boolean): void {
    const map = this.map!;
    if (entry.kind === 'cells') applyChanges(map, entry.changes, undo);
    else if (entry.kind === 'events') map.events = JSON.parse(undo ? entry.before : entry.after) as MapData['events'];
    else Object.assign(map, JSON.parse(undo ? entry.before : entry.after) as Partial<MapData>);
    this.dirty = true;
    this.view?.refresh();
    this.setStatus();
  }

  private undo(): void {
    const entry = this.undoStack.pop();
    if (!entry || this.readOnly) return;
    this.applyEntry(entry, true);
    this.redoStack.push(entry);
  }

  private redo(): void {
    const entry = this.redoStack.pop();
    if (!entry || this.readOnly) return;
    this.applyEntry(entry, false);
    this.undoStack.push(entry);
  }

  // --- Keyboard ------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (!this.root.isConnected) return;
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    // (The game underneath ignores the keyboard while the editor is open.)
    if (typing || this.root.querySelector('.modal-backdrop')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 's') {
      e.preventDefault();
      void this.save();
    } else if (ctrl && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.redo();
    } else if (ctrl && (key === 'c' || key === 'x')) {
      e.preventDefault();
      this.copy(key === 'x');
    } else if (ctrl && key === 'v') {
      e.preventDefault();
      this.paste();
    } else if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      this.deleteSelection();
    } else if (key === 'enter' && this.mode === 'events' && this.view?.selectedEvent != null && this.map) {
      // Keyboard alternative to double-clicking an event.
      e.preventDefault();
      const ev = this.map.events[this.view.selectedEvent];
      if (ev) void this.openEvent(ev.x, ev.y, ev.id);
    } else if (!ctrl) {
      const tools: Record<string, Tool> = { p: 'pencil', r: 'rect', e: 'ellipse', f: 'fill', i: 'picker', g: 'eraser', s: 'select' };
      if (tools[key]) this.setTool(tools[key]);
    }
  }

  private copy(cut: boolean): void {
    const view = this.view;
    const map = this.map;
    if (!view || !map) return;
    if (this.mode === 'events' && view.selectedEvent !== null) {
      this.eventClipboard = deepCopy(map.events[view.selectedEvent] ?? null);
      if (cut) this.deleteSelection();
      return;
    }
    const s = view.selection;
    if (!s) return;
    const editor = new MapEditor(map);
    this.clipboard = editor.copy(s.x0, s.y0, s.x1, s.y1);
    if (cut && !this.readOnly) {
      editor.clear(s.x0, s.y0, s.x1, s.y1);
      this.pushHistory({ kind: 'cells', changes: editor.commit() });
      view.refresh();
    }
  }

  private paste(): void {
    const view = this.view;
    const map = this.map;
    const cell = view?.hoverCell ?? (view?.selection ? { x: view.selection.x0, y: view.selection.y0 } : null);
    if (!view || !map || !cell || this.readOnly) return;
    if (this.mode === 'events' && this.eventClipboard) {
      const clip = this.eventClipboard;
      this.editEvents(() => {
        const free = map.events.findIndex((e, i) => i > 0 && e === null);
        const id = free > 0 ? free : map.events.length;
        map.events[id] = { ...deepCopy(clip), id, x: cell.x, y: cell.y };
      });
      return;
    }
    if (!this.clipboard) return;
    const editor = new MapEditor(map);
    editor.paste(cell.x, cell.y, this.clipboard);
    const changes = editor.commit();
    if (changes.length) this.pushHistory({ kind: 'cells', changes });
    view.refresh();
  }

  private deleteSelection(): void {
    const view = this.view;
    const map = this.map;
    if (!view || !map || this.readOnly) return;
    if (this.mode === 'events' && view.selectedEvent !== null) {
      const id = view.selectedEvent;
      this.editEvents(() => {
        map.events[id] = null;
      });
      view.selectedEvent = null;
      return;
    }
    const s = view.selection;
    if (!s) return;
    const editor = new MapEditor(map);
    editor.clear(s.x0, s.y0, s.x1, s.y1);
    const changes = editor.commit();
    if (changes.length) this.pushHistory({ kind: 'cells', changes });
    view.refresh();
  }

  /** Closes the editor (asking about unsaved changes). */
  async close(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    if (this.info && !this.readOnly) void this.api.delete(`/maps/${this.info.id}/lock`).catch(() => undefined);
    window.clearInterval(this.lockTimer);
    window.removeEventListener('keydown', this.keyHandler, true);
    document.body.classList.remove('editor-open');
    this.root.remove();
    this.options.onClose();
  }
}
