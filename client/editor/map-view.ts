/**
 * @file The editor's map canvas: draws the map being edited with the game's
 * tile renderer plus editor overlays (grid, events, passability, regions,
 * selections), and turns pointer gestures into painting operations.
 *
 * The canvas is virtual: only the visible part of the map is drawn, into a
 * canvas that stays in place while a spacer element provides the scroll area,
 * so even the largest maps stay cheap to display.
 *
 * Gestures: left button paints with the current tool; right button picks the
 * tile under the cursor (eyedropper); in event mode, click selects, drag moves
 * and double-click creates or edits an event.
 */
import { SHADOW_LAYER, REGION_LAYER, tileAt, type MapData } from '../../shared/map.js';
import { checkPassage, passageOverride, setPassageOverride } from '../../shared/passability.js';
import { FLAG_STAR } from '../../shared/tiles.js';
import type { Bitmap } from '../engine/assets.js';
import { sheetFlags } from '../engine/character.js';
import { TilemapRenderer } from '../engine/tilemap.js';
import { el } from '../ui/dom.js';
import { MapEditor, pickTile, type CellChange, type Stamp } from './edit-ops.js';
import { regionColor } from './palette.js';

/** Painting tools. */
export type Tool = 'pencil' | 'rect' | 'ellipse' | 'fill' | 'picker' | 'eraser' | 'select';
/** Editing modes. */
export type Mode = 'tiles' | 'shadow' | 'region' | 'events' | 'passage';

/** What the view needs from the editor. */
export interface MapViewHost {
  tool(): Tool;
  mode(): Mode;
  stamp(): Stamp;
  forcedLayer(): number | null;
  readOnly(): boolean;
  showGrid(): boolean;
  /** An operation finished: record it in the history. */
  onEdit(changes: CellChange[]): void;
  /** Hand-made passability changed (`mmo` block before and after, as JSON). */
  onPassageEdit(before: string, after: string): void;
  onPick(id: number): void;
  onCursor(x: number, y: number): void;
  onEventSelect(id: number | null): void;
  onEventOpen(x: number, y: number, id: number | null): void;
  onEventMove(id: number, x: number, y: number): void;
  eventImage(name: string): Bitmap | null;
}

/** Merges change lists of one operation (first "before", last "after" per cell). */
function mergeChanges(into: Map<number, CellChange>, list: CellChange[]): void {
  for (const c of list) {
    const existing = into.get(c.index);
    into.set(c.index, { index: c.index, before: existing ? existing.before : c.before, after: c.after });
  }
}

/** Map canvas. */
export class MapView {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly spacer: HTMLDivElement;
  renderer: TilemapRenderer;
  zoom = 0.5;
  /** Selected rectangle of the select tool (cells, inclusive). */
  selection: { x0: number; y0: number; x1: number; y1: number } | null = null;
  selectedEvent: number | null = null;
  private hover: { x: number; y: number } | null = null;
  private drag: {
    kind: 'paint' | 'shape' | 'select' | 'shadow' | 'event' | 'passage';
    start: { x: number; y: number };
    /** Passability mode: state given to the cells dragged over, and the map block before. */
    passage?: 'blocked' | 'open';
    before?: string;
    editor?: MapEditor;
    changes?: Map<number, CellChange>;
    lastCell?: string;
    shadowOn?: boolean;
    eventId?: number;
  } | null = null;
  private frame = 0;

  constructor(
    private map: MapData,
    private flags: readonly number[],
    sheets: ConstructorParameters<typeof TilemapRenderer>[2],
    private readonly host: MapViewHost,
  ) {
    this.renderer = new TilemapRenderer(map, flags, sheets, 48);
    this.canvas = el('canvas', { className: 'map-view-canvas' });
    this.spacer = el('div', { className: 'map-view-spacer' });
    this.element = el('div', { className: 'map-view', attrs: { tabindex: '0' } }, [this.canvas, this.spacer]);
    this.element.addEventListener('scroll', () => this.requestDraw());
    new ResizeObserver(() => this.requestDraw()).observe(this.element);
    this.bindPointer();
    this.layout();
  }

  /** Replaces the map shown (after loading or undo of a resize). */
  setMap(map: MapData, flags: readonly number[], sheets: ConstructorParameters<typeof TilemapRenderer>[2]): void {
    this.map = map;
    this.flags = flags;
    this.renderer = new TilemapRenderer(map, flags, sheets, 48);
    this.selection = null;
    this.selectedEvent = null;
    this.layout();
  }

  /** Invalidates the whole map (after undo/redo or paste). */
  refresh(): void {
    this.renderer.invalidate(0, 0, this.map.width - 1, this.map.height - 1);
    this.requestDraw();
  }

  /** Sets the zoom factor, keeping the view centre. */
  setZoom(zoom: number): void {
    const cx = (this.element.scrollLeft + this.element.clientWidth / 2) / this.zoom;
    const cy = (this.element.scrollTop + this.element.clientHeight / 2) / this.zoom;
    this.zoom = zoom;
    this.layout();
    this.element.scrollLeft = cx * zoom - this.element.clientWidth / 2;
    this.element.scrollTop = cy * zoom - this.element.clientHeight / 2;
  }

  private layout(): void {
    this.spacer.style.width = `${this.map.width * 48 * this.zoom}px`;
    this.spacer.style.height = `${this.map.height * 48 * this.zoom}px`;
    this.requestDraw();
  }

  /** Schedules a redraw on the next animation frame. */
  requestDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
    // Fallback when animation frames are suspended (hidden window).
    window.setTimeout(() => {
      if (this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.draw();
      }
    }, 100);
  }

  private cellFromEvent(e: PointerEvent | MouseEvent): { x: number; y: number; fx: number; fy: number } {
    const rect = this.element.getBoundingClientRect();
    const mx = (e.clientX - rect.left + this.element.scrollLeft) / this.zoom;
    const my = (e.clientY - rect.top + this.element.scrollTop) / this.zoom;
    return { x: Math.floor(mx / 48), y: Math.floor(my / 48), fx: (mx % 48) / 48, fy: (my % 48) / 48 };
  }

  private inMap(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height;
  }

  private eventAt(x: number, y: number): number | null {
    for (let id = this.map.events.length - 1; id > 0; id--) {
      const e = this.map.events[id];
      if (e && e.x === x && e.y === y) return id;
    }
    return null;
  }

  private bindPointer(): void {
    this.element.addEventListener('contextmenu', (e) => e.preventDefault());
    // Double click opens (or creates) the event of a cell. The native event is used because
    // browsers do not report the click count on pointer events.
    this.element.addEventListener('dblclick', (e) => {
      if (this.host.mode() !== 'events') return;
      const cell = this.cellFromEvent(e);
      if (!this.inMap(cell.x, cell.y)) return;
      this.drag = null;
      this.host.onEventOpen(cell.x, cell.y, this.eventAt(cell.x, cell.y));
    });
    this.element.addEventListener('pointerdown', (e) => {
      const cell = this.cellFromEvent(e);
      if (!this.inMap(cell.x, cell.y)) return;
      this.element.focus();
      if (e.button === 2) {
        this.host.onPick(pickTile(this.map, cell.x, cell.y));
        return;
      }
      if (e.button !== 0) return;
      // Capture keeps drags working outside the element; it can fail for synthetic pointers.
      try {
        this.element.setPointerCapture(e.pointerId);
      } catch {
        /* painting still works without capture */
      }
      const mode = this.host.mode();
      if (mode === 'events') {
        const id = this.eventAt(cell.x, cell.y);
        this.selectedEvent = id;
        this.host.onEventSelect(id);
        if (id !== null && !this.host.readOnly()) this.drag = { kind: 'event', start: cell, eventId: id };
        this.requestDraw();
        return;
      }
      if (this.host.readOnly()) return;
      const editor = new MapEditor(this.map, this.host.forcedLayer());
      if (mode === 'shadow') {
        const quarter = (cell.fx >= 0.5 ? 1 : 0) + (cell.fy >= 0.5 ? 2 : 0);
        const on = (tileAt(this.map, cell.x, cell.y, SHADOW_LAYER) & (1 << quarter)) === 0;
        this.drag = { kind: 'shadow', start: cell, editor, changes: new Map(), shadowOn: on };
        this.applyShadow(cell);
        return;
      }
      // Passability mode never paints tiles: a click blocks a passable cell or
      // opens a blocked one (dragging gives the same state to every cell).
      if (mode === 'passage') {
        const open = [0x1, 0x2, 0x4, 0x8].every((bit) => checkPassage(this.map, this.flags, cell.x, cell.y, bit));
        this.drag = { kind: 'passage', start: cell, passage: open ? 'blocked' : 'open', before: JSON.stringify({ mmo: this.map.mmo }) };
        this.applyPassage(cell);
        return;
      }
      const tool = this.host.tool();
      if (tool === 'picker') {
        this.host.onPick(pickTile(this.map, cell.x, cell.y));
        return;
      }
      if (tool === 'fill') {
        editor.fill(cell.x, cell.y, this.effectiveStamp());
        this.finish(editor.commit());
        return;
      }
      if (tool === 'select') {
        this.drag = { kind: 'select', start: cell };
        this.selection = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
        this.requestDraw();
        return;
      }
      if (tool === 'rect' || tool === 'ellipse') {
        this.drag = { kind: 'shape', start: cell, editor };
        this.requestDraw();
        return;
      }
      this.drag = { kind: 'paint', start: cell, editor, changes: new Map() };
      this.paintAt(cell);
    });
    this.element.addEventListener('pointermove', (e) => {
      const cell = this.cellFromEvent(e);
      const key = `${cell.x},${cell.y}`;
      if (!this.hover || this.hover.x !== cell.x || this.hover.y !== cell.y) {
        this.hover = this.inMap(cell.x, cell.y) ? { x: cell.x, y: cell.y } : null;
        if (this.hover) this.host.onCursor(cell.x, cell.y);
        this.requestDraw();
      }
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'paint' && d.lastCell !== key && this.inMap(cell.x, cell.y)) this.paintAt(cell);
      else if (d.kind === 'shadow' && this.inMap(cell.x, cell.y)) this.applyShadow(cell);
      else if (d.kind === 'passage' && this.inMap(cell.x, cell.y)) this.applyPassage(cell);
      else if (d.kind === 'select') {
        this.selection = {
          x0: Math.min(d.start.x, cell.x), y0: Math.min(d.start.y, cell.y),
          x1: Math.max(d.start.x, cell.x), y1: Math.max(d.start.y, cell.y),
        };
        this.clampSelection();
        this.requestDraw();
      }
    });
    this.element.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      const cell = this.cellFromEvent(e);
      if (d.kind === 'passage') {
        const after = JSON.stringify({ mmo: this.map.mmo });
        if (after !== d.before) this.host.onPassageEdit(d.before!, after);
      } else if (d.kind === 'paint' || d.kind === 'shadow') {
        this.finish([...d.changes!.values()].filter((c) => c.before !== c.after));
      } else if (d.kind === 'shape') {
        const x = Math.max(0, Math.min(this.map.width - 1, cell.x));
        const y = Math.max(0, Math.min(this.map.height - 1, cell.y));
        if (this.host.tool() === 'rect') d.editor!.rectangle(d.start.x, d.start.y, x, y, this.effectiveStamp());
        else d.editor!.ellipse(d.start.x, d.start.y, x, y, this.effectiveStamp());
        this.finish(d.editor!.commit());
      } else if (d.kind === 'event' && (cell.x !== d.start.x || cell.y !== d.start.y) && this.inMap(cell.x, cell.y) && this.eventAt(cell.x, cell.y) === null) {
        this.host.onEventMove(d.eventId!, cell.x, cell.y);
      }
      this.requestDraw();
    });
    this.element.addEventListener('pointerleave', () => {
      this.hover = null;
      this.requestDraw();
    });
  }

  /** The stamp to paint: in region mode the palette holds region ids. */
  private effectiveStamp(): Stamp {
    return this.host.stamp();
  }

  private paintAt(cell: { x: number; y: number }): void {
    const d = this.drag!;
    d.lastCell = `${cell.x},${cell.y}`;
    if (this.host.tool() === 'eraser') d.editor!.erase(cell.x, cell.y);
    else d.editor!.stamp(cell.x, cell.y, this.effectiveStamp());
    mergeChanges(d.changes!, d.editor!.commit());
    this.renderer.invalidate(cell.x - 1, cell.y - 1, cell.x + (this.effectiveStamp().tiles[0]?.length ?? 1), cell.y + this.effectiveStamp().tiles.length);
    this.requestDraw();
  }

  private applyShadow(cell: { x: number; y: number; fx: number; fy: number }): void {
    const d = this.drag!;
    const quarter = (cell.fx >= 0.5 ? 1 : 0) + (cell.fy >= 0.5 ? 2 : 0);
    d.editor!.shadow(cell.x, cell.y, quarter, d.shadowOn!);
    mergeChanges(d.changes!, d.editor!.commit());
    this.renderer.invalidate(cell.x, cell.y, cell.x, cell.y);
    this.requestDraw();
  }

  /** Gives the passability state of the current drag to a cell. */
  private applyPassage(cell: { x: number; y: number }): void {
    setPassageOverride(this.map, this.flags, cell.x, cell.y, this.drag!.passage!);
    this.requestDraw();
  }

  private finish(changes: CellChange[]): void {
    if (changes.length > 0) this.host.onEdit(changes);
    this.refresh();
  }

  private clampSelection(): void {
    if (!this.selection) return;
    const s = this.selection;
    s.x0 = Math.max(0, s.x0);
    s.y0 = Math.max(0, s.y0);
    s.x1 = Math.min(this.map.width - 1, s.x1);
    s.y1 = Math.min(this.map.height - 1, s.y1);
  }

  /** Cell under the pointer, if any (paste target). */
  get hoverCell(): { x: number; y: number } | null {
    return this.hover;
  }

  /** Draws the visible part of the map and the overlays. */
  draw(): void {
    const w = this.element.clientWidth;
    const h = this.element.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.style.transform = `translate(${this.element.scrollLeft}px, ${this.element.scrollTop}px)`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#15101c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const z = this.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const ox = this.element.scrollLeft / this.zoom;
    const oy = this.element.scrollTop / this.zoom;
    const vw = w / this.zoom;
    const vh = h / this.zoom;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.map.width * 48, this.map.height * 48);
    this.renderer.drawLower(ctx, ox, oy, vw, vh);
    this.drawEvents(ctx);
    this.renderer.drawUpper(ctx, ox, oy, vw, vh);
    this.drawOverlays(ctx, ox, oy, vw, vh);
  }

  private drawEvents(ctx: CanvasRenderingContext2D): void {
    const mode = this.host.mode();
    for (const e of this.map.events) {
      if (!e) continue;
      const page = e.pages[0];
      const px = e.x * 48;
      const py = e.y * 48;
      const img = page?.image;
      let drawn = false;
      if (img && img.tileId > 0) {
        this.renderer.drawTile(ctx, img.tileId, px, py, 0);
        drawn = true;
      } else if (img?.characterName) {
        const sheet = this.host.eventImage(img.characterName);
        if (sheet) {
          const { single } = sheetFlags(img.characterName);
          const fw = sheet.width / (single ? 3 : 12);
          const fh = sheet.height / (single ? 4 : 8);
          const bx = single ? 0 : (img.characterIndex % 4) * 3;
          const by = single ? 0 : Math.floor(img.characterIndex / 4) * 4;
          ctx.drawImage(sheet, (bx + img.pattern) * fw, (by + (img.direction - 2) / 2) * fh, fw, fh, px + 24 - fw / 2, py + 48 - fh - 6, fw, fh);
          drawn = true;
        }
      }
      if (mode === 'events' || !drawn) {
        ctx.fillStyle = drawn ? 'rgba(255, 255, 255, 0.12)' : 'rgba(80, 140, 255, 0.35)';
        ctx.fillRect(px + 3, py + 3, 42, 42);
        ctx.lineWidth = 2;
        ctx.strokeStyle = e.id === this.selectedEvent ? '#ffe070' : 'rgba(255, 255, 255, 0.85)';
        ctx.strokeRect(px + 3, py + 3, 42, 42);
      }
    }
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, ox: number, oy: number, vw: number, vh: number): void {
    const T = 48;
    const x0 = Math.max(0, Math.floor(ox / T));
    const y0 = Math.max(0, Math.floor(oy / T));
    const x1 = Math.min(this.map.width - 1, Math.floor((ox + vw) / T));
    const y1 = Math.min(this.map.height - 1, Math.floor((oy + vh) / T));
    const mode = this.host.mode();
    if (mode === 'region') {
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const r = tileAt(this.map, x, y, REGION_LAYER);
          if (!r) continue;
          ctx.fillStyle = regionColor(r);
          ctx.fillRect(x * T, y * T, T, T);
          ctx.fillStyle = '#fff';
          ctx.fillText(String(r), x * T + T / 2, y * T + T / 2);
        }
      }
    }
    if (mode === 'passage') {
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const bits = [0x1, 0x2, 0x4, 0x8].map((b) => checkPassage(this.map, this.flags, x, y, b));
          const all = bits.every(Boolean);
          const none = bits.every((b) => !b);
          const star = [0, 1, 2, 3].some((z) => {
            const id = tileAt(this.map, x, y, z);
            return id !== 0 && ((this.flags[id] ?? 0) & FLAG_STAR) !== 0;
          });
          const text = none ? '×' : all ? (star ? '☆' : '○') : '◇';
          // Hand-made cells get a frame, so they can be told from the tile rules.
          if (passageOverride(this.map, x, y) !== undefined) {
            ctx.strokeStyle = none ? '#ff5050' : '#80c0ff';
            ctx.strokeRect(x * T + 4, y * T + 4, T - 8, T - 8);
          }
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.strokeText(text, x * T + T / 2, y * T + T / 2);
          ctx.fillStyle = none ? '#ff5050' : all ? '#80c0ff' : '#ffd060';
          ctx.fillText(text, x * T + T / 2, y * T + T / 2);
        }
      }
    }
    if (this.host.showGrid()) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 1; x++) {
        ctx.moveTo(x * T, y0 * T);
        ctx.lineTo(x * T, (y1 + 1) * T);
      }
      for (let y = y0; y <= y1 + 1; y++) {
        ctx.moveTo(x0 * T, y * T);
        ctx.lineTo((x1 + 1) * T, y * T);
      }
      ctx.stroke();
    }
    if (this.selection) {
      const s = this.selection;
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 3 / this.zoom;
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(s.x0 * T, s.y0 * T, (s.x1 - s.x0 + 1) * T, (s.y1 - s.y0 + 1) * T);
      ctx.setLineDash([]);
    }
    const d = this.drag;
    if (d?.kind === 'shape' && this.hover) {
      const xa = Math.min(d.start.x, this.hover.x);
      const ya = Math.min(d.start.y, this.hover.y);
      ctx.fillStyle = 'rgba(255, 224, 112, 0.25)';
      ctx.fillRect(xa * T, ya * T, (Math.abs(d.start.x - this.hover.x) + 1) * T, (Math.abs(d.start.y - this.hover.y) + 1) * T);
    }
    if (this.hover && mode !== 'events') {
      const stamp = this.host.stamp();
      const sw = mode === 'tiles' || mode === 'region' ? (stamp.tiles[0]?.length ?? 1) : 1;
      const sh = mode === 'tiles' || mode === 'region' ? stamp.tiles.length || 1 : 1;
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeStyle = this.host.readOnly() ? '#ff6060' : '#ffe070';
      ctx.strokeRect(this.hover.x * T, this.hover.y * T, sw * T, sh * T);
    }
  }
}
