/**
 * @file Tileset editor (database tab "Tilesets"): assigns the nine sheets
 * (A1–E), the mode, and edits tile flags by clicking tiles in the palette:
 * - passage: cycles ○ (passable) → × (impassable) → ☆ (drawn above characters);
 * - passage (4 directions): click near an edge to block/unblock that side;
 * - ladder, bush, counter, damage: toggles the flag;
 * - terrain tag: cycles 0–7.
 * Changing an autotile applies to its 48 shapes. Saving updates the live maps
 * that use the tileset.
 */
import type { TilesetData } from '../../shared/database.js';
import {
  AUTOTILE_SHAPES,
  FLAG_BUSH,
  FLAG_COUNTER,
  FLAG_DAMAGE,
  FLAG_IMPASSABLE,
  FLAG_LADDER,
  FLAG_STAR,
  TERRAIN_TAG_SHIFT,
  TILESET_SHEETS,
  isAutotile,
  terrainTag,
  type TilesetSheet,
} from '../../shared/tiles.js';
import type { AssetStore, Bitmap } from '../engine/assets.js';
import { TilemapRenderer } from '../engine/tilemap.js';
import { t } from '../i18n.js';
import { el } from '../ui/dom.js';
import type { EditorApi } from './api.js';
import { field, openModal, select, textInput } from './dialogs.js';
import { TilePalette, type FlagView } from './palette.js';

const FLAG_VIEWS: FlagView[] = ['passage', 'passage4', 'ladder', 'bush', 'counter', 'damage', 'terrain'];

/**
 * Opens the tileset editor.
 * @param host - Editor root.
 * @param api - Editor API.
 * @param assets - Asset store (sheets).
 * @param tilesetIds - Tilesets to choose from.
 * @param sheetNames - Names of all tileset images.
 * @param startId - Tileset shown first.
 * @param onSaved - Called after a successful save.
 */
export async function openTilesetEditor(
  host: HTMLElement,
  api: EditorApi,
  assets: AssetStore,
  tilesetIds: { id: number; name: string }[],
  sheetNames: string[],
  startId: number,
  onSaved: (tileset: TilesetData) => void,
): Promise<void> {
  let tileset: TilesetData = (await api.get<{ tileset: TilesetData }>(`/tilesets/${startId}`)).tileset;
  let view: FlagView = 'passage';
  const flags = [...tileset.flags];

  const loadSheets = async (): Promise<Partial<Record<TilesetSheet, Bitmap>>> => {
    const sheets: Partial<Record<TilesetSheet, Bitmap>> = {};
    await Promise.all(
      TILESET_SHEETS.map(async (slot, i) => {
        const name = sheetSelects[i]!.value;
        const img = name ? await assets.image('tilesets', name) : null;
        if (img) sheets[slot] = img;
      }),
    );
    return sheets;
  };

  const setFlag = (id: number, f: (old: number) => number) => {
    if (id === 0) return; // the empty tile always stays "star"
    const ids = isAutotile(id) ? Array.from({ length: AUTOTILE_SHAPES }, (_, s) => id + s) : [id];
    for (const i of ids) flags[i] = f(flags[i] ?? 0) & 0xffff;
  };

  const onCellClick = (id: number, fx: number, fy: number) => {
    switch (view) {
      case 'passage':
        setFlag(id, (old) => {
          if (old & FLAG_STAR) return old & ~FLAG_STAR & ~FLAG_IMPASSABLE;
          if ((old & FLAG_IMPASSABLE) === FLAG_IMPASSABLE) return (old & ~FLAG_IMPASSABLE) | FLAG_STAR;
          return old | FLAG_IMPASSABLE;
        });
        break;
      case 'passage4': {
        const bit = fy < 0.33 ? 0x8 : fy > 0.66 ? 0x1 : fx < 0.5 ? 0x2 : 0x4;
        setFlag(id, (old) => old ^ bit);
        break;
      }
      case 'ladder':
        setFlag(id, (old) => old ^ FLAG_LADDER);
        break;
      case 'bush':
        setFlag(id, (old) => old ^ FLAG_BUSH);
        break;
      case 'counter':
        setFlag(id, (old) => old ^ FLAG_COUNTER);
        break;
      case 'damage':
        setFlag(id, (old) => old ^ FLAG_DAMAGE);
        break;
      case 'terrain':
        setFlag(id, (old) => (old & ~(0xf << TERRAIN_TAG_SHIFT)) | (((terrainTag(old) + 1) % 8) << TERRAIN_TAG_SHIFT));
        break;
      default:
        break;
    }
    palette.setFlags(flags);
  };

  const name = textInput(tileset.name);
  const mode = select([['0', t('editor.tileset_mode.world')], ['1', t('editor.tileset_mode.area')], ['2', t('editor.tileset_mode.legacy')]], String(tileset.mode));
  const sheetSelects = TILESET_SHEETS.map((slot, i) => {
    const s = select([['', t('editor.none')], ...sheetNames.map((n): [string, string] => [n, n])], tileset.tilesetNames[i] ?? '');
    s.dataset.slot = slot;
    return s;
  });
  const sheets = await loadSheets();
  const renderer = new TilemapRenderer({ width: 1, height: 1, data: [0, 0, 0, 0, 0, 0] }, flags, sheets, 48);
  const palette = new TilePalette(renderer, sheetSelects.map((s) => s.value), () => undefined, onCellClick);
  palette.flagView = view;
  palette.setTileset(renderer, sheetSelects.map((s) => s.value), flags);
  for (const s of sheetSelects) {
    s.addEventListener('change', () => {
      void loadSheets().then((loaded) => {
        const r = new TilemapRenderer({ width: 1, height: 1, data: [0, 0, 0, 0, 0, 0] }, flags, loaded, 48);
        palette.setTileset(r, sheetSelects.map((x) => x.value), flags);
      });
    });
  }
  const viewButtons = el(
    'div',
    { className: 'flag-views', attrs: { role: 'tablist' } },
    FLAG_VIEWS.map((v) =>
      el('button', {
        className: `button small${v === view ? ' primary' : ''}`,
        text: t(`editor.flag.${v}` as 'editor.flag.passage'),
        attrs: { type: 'button', 'data-view': String(v) },
        on: {
          click: (e) => {
            view = v;
            palette.flagView = v;
            palette.draw();
            for (const b of viewButtons.querySelectorAll('button')) b.classList.toggle('primary', b === e.currentTarget);
          },
        },
      }),
    ),
  );
  const tilesetSelect = select(tilesetIds.map((ts) => [String(ts.id), `${ts.id} — ${ts.name}`]), String(tileset.id));
  tilesetSelect.addEventListener('change', () => {
    host.querySelector('.modal-backdrop')?.remove();
    void openTilesetEditor(host, api, assets, tilesetIds, sheetNames, Number(tilesetSelect.value), onSaved);
  });

  openModal(host, t('editor.tileset_editor'), el('div', { className: 'tileset-editor' }, [
    el('div', { className: 'tileset-fields form-grid' }, [
      field(t('editor.tileset'), tilesetSelect),
      field(t('editor.tileset_name'), name),
      field(t('editor.tileset_mode_label'), mode),
      ...sheetSelects.map((s) => field(s.dataset.slot!, s)),
    ]),
    el('div', { className: 'tileset-flags' }, [viewButtons, palette.element, el('p', { className: 'hint', text: t('editor.flag_help') })]),
  ]), [
    { label: t('common.cancel') },
    {
      label: t('editor.save'),
      primary: true,
      onClick: async () => {
        tileset = { ...tileset, name: name.value.trim() || tileset.name, mode: Number(mode.value), tilesetNames: sheetSelects.map((s) => s.value), flags };
        await api.put(`/tilesets/${tileset.id}`, { tileset });
        onSaved(tileset);
      },
    },
  ]);
}
