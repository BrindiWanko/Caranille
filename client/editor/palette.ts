/**
 * @file Tile palette of the editor.
 *
 * Tabs: A (animated water, grounds, buildings, walls, then plain A5 tiles),
 * B, C, D, E (object sheets) and R (region numbers). Tiles are laid out eight
 * per row; autotiles appear once per kind, drawn with their preview; rows of
 * empty sheet slots are hidden. A
 * rectangle of cells can be selected by dragging; the selection becomes the
 * stamp used by the painting tools.
 *
 * The same component draws flag overlays for the tileset editor.
 */
import {
  AUTOTILE_SHAPES,
  FLAG_BUSH,
  FLAG_COUNTER,
  FLAG_DAMAGE,
  FLAG_LADDER,
  FLAG_STAR,
  TILE_ID_A1,
  TILE_ID_A5,
  TILESET_SHEETS,
  isTileA1,
  isWaterfallKind,
  isWallTypeAutotile,
  autotileKind,
  terrainTag,
} from '../../shared/tiles.js';
import type { TilemapRenderer } from '../engine/tilemap.js';
import { el } from '../ui/dom.js';
import type { Stamp } from './edit-ops.js';

/** Palette tabs. */
export type PaletteTab = 'A' | 'B' | 'C' | 'D' | 'E' | 'R';

/** What the tileset editor overlays on tiles. */
export type FlagView = 'passage' | 'passage4' | 'ladder' | 'bush' | 'counter' | 'damage' | 'terrain' | null;

const COLS = 8;
/** Display size of a palette cell in CSS pixels. */
const CELL = 36;

/** Colour of a region number (stable hue per id). */
export function regionColor(id: number): string {
  return `hsl(${(id * 47) % 360} 70% 50% / 0.55)`;
}

/**
 * Tile ids of a tab in display order (eight per row); `-1` marks an empty cell.
 * @param tab - Tab.
 * @param tilesetNames - Sheet names of the tileset (A1..E); tabs of missing sheets are empty.
 */
export function paletteEntries(tab: PaletteTab, tilesetNames: readonly string[]): number[] {
  const has = (sheet: string) => Boolean(tilesetNames[TILESET_SHEETS.indexOf(sheet as (typeof TILESET_SHEETS)[number])]);
  const out: number[] = [];
  if (tab === 'R') {
    for (let i = 0; i < 256; i++) out.push(i);
    return out;
  }
  if (tab === 'A') {
    const kinds = (from: number, to: number) => {
      for (let k = from; k < to; k++) out.push(TILE_ID_A1 + k * AUTOTILE_SHAPES);
    };
    if (has('A1')) kinds(0, 16);
    if (has('A2')) kinds(16, 48);
    if (has('A3')) kinds(48, 80);
    if (has('A4')) kinds(80, 128);
    if (has('A5')) for (let i = 0; i < 128; i++) out.push(TILE_ID_A5 + i);
    return out;
  }
  const sheetIndex = 'BCDE'.indexOf(tab);
  if (!has(tab)) return out;
  for (let i = 0; i < 256; i++) out.push(sheetIndex * 256 + i);
  return out;
}

/** Id drawn to preview an autotile kind in the palette. */
function previewId(id: number): number {
  if (id < TILE_ID_A1) return id;
  if (isTileA1(id) && isWaterfallKind(autotileKind(id))) return id + 3;
  if (isWallTypeAutotile(id)) return id + 15;
  return id + 47;
}

/** The palette component. */
export class TilePalette {
  readonly element: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scroller: HTMLDivElement;
  private tab: PaletteTab = 'A';
  private entries: number[] = [];
  private selStart: { c: number; r: number } | null = null;
  private selection = { c0: 0, r0: 0, c1: 0, r1: 0 };
  /** Flag overlay (tileset editor). */
  flagView: FlagView = null;
  private flags: readonly number[] = [];

  /**
   * @param renderer - Renderer providing sheet drawing.
   * @param tilesetNames - Sheet names of the tileset.
   * @param onSelect - Called with the new stamp after a selection.
   * @param onCellClick - Called on click in flag mode, with tile id and relative position inside the cell.
   */
  constructor(
    private renderer: TilemapRenderer,
    private tilesetNames: readonly string[],
    private readonly onSelect: (stamp: Stamp) => void,
    private readonly onCellClick?: (id: number, fx: number, fy: number) => void,
  ) {
    this.tabs = el('div', { className: 'palette-tabs', attrs: { role: 'tablist' } });
    this.canvas = el('canvas', { className: 'palette-canvas' });
    this.scroller = el('div', { className: 'palette-scroller' }, [this.canvas]);
    this.element = el('div', { className: 'palette' }, [this.tabs, this.scroller]);
    this.bindPointer();
    this.setTab('A');
  }

  /** Changes the tileset shown. */
  setTileset(renderer: TilemapRenderer, tilesetNames: readonly string[], flags: readonly number[] = []): void {
    this.renderer = renderer;
    this.tilesetNames = tilesetNames;
    this.flags = flags;
    this.setTab(this.tab);
  }

  /** Updates the flags drawn in flag mode. */
  setFlags(flags: readonly number[]): void {
    this.flags = flags;
    this.draw();
  }

  /** Current tab. */
  get currentTab(): PaletteTab {
    return this.tab;
  }

  /** Switches tab (and resets the selection to the first cell). */
  setTab(tab: PaletteTab, regionTabAllowed = true): void {
    this.tab = tab;
    this.entries = tab === 'R' ? paletteEntries(tab, this.tilesetNames) : this.withoutBlankRows(paletteEntries(tab, this.tilesetNames));
    const tabs: PaletteTab[] = regionTabAllowed && !this.onCellClick ? ['A', 'B', 'C', 'D', 'E', 'R'] : ['A', 'B', 'C', 'D', 'E'];
    this.tabs.replaceChildren(
      ...tabs.map((name) =>
        el('button', {
          className: `palette-tab${name === tab ? ' active' : ''}`,
          text: name,
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(name === tab) },
          on: { click: () => this.setTab(name, regionTabAllowed) },
        }),
      ),
    );
    this.selection = { c0: 0, r0: 0, c1: 0, r1: 0 };
    this.draw();
    if (!this.onCellClick) this.emit();
  }

  /**
   * Drops the rows whose eight cells draw nothing. A sheet has a fixed number
   * of slots (e.g. 32 wall types in A3), and a tileset often fills only some
   * of them: the empty rows would show as gaps. Tile ids are unchanged; the
   * first row of B (the eraser tile) is always kept. When nothing is drawn at
   * all (images still loading), the layout is left as is.
   */
  private withoutBlankRows(entries: number[]): number[] {
    const T = this.renderer.tileSize;
    const probe = document.createElement('canvas');
    probe.width = T;
    probe.height = T;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return entries;
    const drawn = (id: number) => {
      if (id < 0) return false;
      ctx.clearRect(0, 0, T, T);
      this.renderer.drawTile(ctx, previewId(id), 0, 0, 0);
      const data = ctx.getImageData(0, 0, T, T).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
      return false;
    };
    const out: number[] = [];
    for (let i = 0; i < entries.length; i += COLS) {
      const row = entries.slice(i, i + COLS);
      if (row.includes(0) || row.some(drawn)) out.push(...row);
    }
    return out.length > 0 ? out : entries;
  }

  /** Selects a single tile id (eyedropper), switching to its tab. */
  selectTile(id: number): void {
    const tab: PaletteTab = id >= TILE_ID_A5 ? 'A' : (['B', 'C', 'D', 'E'] as const)[Math.floor(id / 256)] ?? 'A';
    if (tab !== this.tab) this.setTab(tab);
    const index = this.entries.indexOf(id);
    if (index < 0) return;
    const c = index % COLS;
    const r = Math.floor(index / COLS);
    this.selection = { c0: c, r0: r, c1: c, r1: r };
    this.draw();
    this.emit();
    this.scroller.scrollTop = Math.max(0, r * CELL - 60);
  }

  private emit(): void {
    const { c0, r0, c1, r1 } = this.selection;
    const tiles: number[][] = [];
    for (let r = r0; r <= r1; r++) {
      const row: number[] = [];
      for (let c = c0; c <= c1; c++) row.push(Math.max(0, this.entries[r * COLS + c] ?? 0));
      tiles.push(row);
    }
    this.onSelect({ tiles, region: this.tab === 'R' });
  }

  private cellAt(e: PointerEvent): { c: number; r: number; fx: number; fy: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (rect.width / (COLS * CELL));
    const y = (e.clientY - rect.top) / (rect.height / (Math.ceil(this.entries.length / COLS) * CELL || 1));
    const c = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
    const r = Math.max(0, Math.floor(y / CELL));
    return { c, r, fx: (x % CELL) / CELL, fy: (y % CELL) / CELL };
  }

  private bindPointer(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      const cell = this.cellAt(e);
      if (this.onCellClick) {
        const id = this.entries[cell.r * COLS + cell.c];
        if (id !== undefined && id >= 0) this.onCellClick(id, cell.fx, cell.fy);
        return;
      }
      // Capture keeps drags working outside the element; it can fail for synthetic pointers.
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* painting still works without capture */
      }
      this.selStart = cell;
      this.selection = { c0: cell.c, r0: cell.r, c1: cell.c, r1: cell.r };
      this.draw();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.selStart) return;
      const cell = this.cellAt(e);
      this.selection = {
        c0: Math.min(this.selStart.c, cell.c),
        r0: Math.min(this.selStart.r, cell.r),
        c1: Math.max(this.selStart.c, cell.c),
        r1: Math.max(this.selStart.r, cell.r),
      };
      this.draw();
    });
    this.canvas.addEventListener('pointerup', () => {
      if (!this.selStart) return;
      this.selStart = null;
      this.emit();
    });
  }

  /** Redraws the palette. */
  draw(): void {
    const rows = Math.max(1, Math.ceil(this.entries.length / COLS));
    const T = this.renderer.tileSize;
    this.canvas.width = COLS * T;
    this.canvas.height = rows * T;
    this.canvas.style.width = `${COLS * CELL}px`;
    this.canvas.style.height = `${rows * CELL}px`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#20182a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Checkerboard behind tiles so transparent parts are visible.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#3a3046' : '#443a52';
        ctx.fillRect(c * T, r * T, T, T);
      }
    }
    this.entries.forEach((id, i) => {
      if (id < 0) return;
      const x = (i % COLS) * T;
      const y = Math.floor(i / COLS) * T;
      if (this.tab === 'R') {
        if (id === 0) return;
        ctx.fillStyle = regionColor(id);
        ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(T * 0.38)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(id), x + T / 2, y + T / 2);
        return;
      }
      this.renderer.drawTile(ctx, previewId(id), x, y, 0);
      if (this.flagView) this.drawFlag(ctx, this.flags[id] ?? 0, x, y, T);
    });
    if (!this.onCellClick) {
      const { c0, r0, c1, r1 } = this.selection;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(c0 * T + 1.5, r0 * T + 1.5, (c1 - c0 + 1) * T - 3, (r1 - r0 + 1) * T - 3);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(c0 * T + 3.5, r0 * T + 3.5, (c1 - c0 + 1) * T - 7, (r1 - r0 + 1) * T - 7);
    }
  }

  /** Draws the symbol of a flag view on a tile. */
  private drawFlag(ctx: CanvasRenderingContext2D, flag: number, x: number, y: number, T: number): void {
    const mid = { x: x + T / 2, y: y + T / 2 };
    ctx.save();
    ctx.lineWidth = Math.max(2, T / 16);
    ctx.font = `bold ${Math.round(T * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const symbol = (text: string, color: string) => {
      ctx.strokeStyle = '#000';
      ctx.strokeText(text, mid.x, mid.y);
      ctx.fillStyle = color;
      ctx.fillText(text, mid.x, mid.y);
    };
    switch (this.flagView) {
      case 'passage':
        if (flag & FLAG_STAR) symbol('☆', '#ffe070');
        else if ((flag & 0xf) === 0xf) symbol('×', '#ff6060');
        else symbol('○', '#80c0ff');
        break;
      case 'passage4': {
        const arrows: [number, number, number, string][] = [[0x8, 0, -1, '↑'], [0x1, 0, 1, '↓'], [0x2, -1, 0, '←'], [0x4, 1, 0, '→']];
        ctx.font = `bold ${Math.round(T * 0.32)}px sans-serif`;
        for (const [bit, dx, dy, ch] of arrows) {
          const px = mid.x + dx * T * 0.3;
          const py = mid.y + dy * T * 0.3;
          ctx.strokeStyle = '#000';
          ctx.strokeText(flag & bit ? '·' : ch, px, py);
          ctx.fillStyle = flag & bit ? '#ff6060' : '#fff';
          ctx.fillText(flag & bit ? '·' : ch, px, py);
        }
        break;
      }
      case 'ladder':
        symbol(flag & FLAG_LADDER ? '○' : '·', flag & FLAG_LADDER ? '#80ff80' : '#aaa');
        break;
      case 'bush':
        symbol(flag & FLAG_BUSH ? '○' : '·', flag & FLAG_BUSH ? '#80ff80' : '#aaa');
        break;
      case 'counter':
        symbol(flag & FLAG_COUNTER ? '○' : '·', flag & FLAG_COUNTER ? '#80ff80' : '#aaa');
        break;
      case 'damage':
        symbol(flag & FLAG_DAMAGE ? '○' : '·', flag & FLAG_DAMAGE ? '#ff8080' : '#aaa');
        break;
      case 'terrain':
        symbol(String(terrainTag(flag)), '#fff');
        break;
      default:
        break;
    }
    ctx.restore();
  }
}
