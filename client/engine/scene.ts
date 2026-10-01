/**
 * @file The map scene: tile renderer, characters (player and events), camera
 * and drawing order.
 *
 * Draw order: parallax background, lower tiles, characters sorted by their vertical
 * position ("below characters" events first, "above" events last), upper
 * (star) tiles, then effects (balloons, animations); the player names overlay
 * is handled by the UI.
 * The camera follows the player and stops at the map edges; maps smaller than
 * the screen are centred.
 */
import { drawCharacterBlock, type CharacterAppearance } from '../../shared/art/character.js';
import { Priority, type EventView } from '../../shared/events.js';
import { isValidPosition } from '../../shared/map.js';
import { canMove, isBush } from '../../shared/passability.js';
import type { ActionView, DamageView, MonsterView } from '../../shared/combat.js';
import type { ClientMap, RemotePlayer } from '../../shared/protocol.js';
import type { TilesetData } from '../../shared/database.js';
import type { Direction } from '../../shared/settings.js';
import { TILESET_SHEETS, type TilesetSheet } from '../../shared/tiles.js';
import { rasterize } from '../art/render.js';
import type { AssetStore, Bitmap } from './assets.js';
import { MapCharacter, sheetFlags } from './character.js';
import { MARKER_SIZE, markerImage } from './markers.js';
import { TilemapRenderer } from './tilemap.js';

/** An event on the scene. */
export interface SceneEvent {
  view: EventView;
  character: MapCharacter;
}

/** Another player on the scene. */
export interface SceneRemote {
  info: RemotePlayer;
  character: MapCharacter;
}

/** A monster on the scene. */
export interface SceneMonster {
  view: MonsterView;
  character: MapCharacter;
  hp: number;
  maxHp: number;
  /** Frames left of the hurt blink. */
  hurt: number;
  /** Frames left of the death fade (the monster is gone when it reaches 0). */
  dying: number;
}

/** Something effects can be drawn on: a character, or a fixed cell. */
export type Anchor = { realX: number; realY: number };

/** A floating number (damage, healing, miss). */
interface Popup {
  anchor: Anchor;
  text: string;
  color: string;
  big: boolean;
  age: number;
}

/** Frames a floating number stays. */
const POPUP_FRAMES = 50;
/** Frames of the death fade of a monster. */
const DYING_FRAMES = 24;

/** A balloon or animation playing over a character (`target`: 0 = the player, an event id, or -1 for other anchors). */
interface SceneEffect {
  target: number;
  /** What the effect follows (resolved from `target` when absent). */
  anchor?: Anchor;
  /** Frames elapsed. */
  age: number;
  /** Total duration in frames. */
  duration: number;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, age: number) => void;
}

/** Balloon sheet layout: 8 frames of 48 px per row, one row per balloon. */
const BALLOON_SIZE = 48;
const BALLOON_FRAMES = 8;
const BALLOON_FRAME_TIME = 8;
const BALLOON_HOLD = 12;

/** Generated sprite sheets, shared between scenes and keyed by appearance. */
const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Returns the sprite sheet of an appearance (generated once, then cached).
 * @param appearance - Character appearance.
 * @param tileSize - Tile size in pixels.
 */
export function appearanceSheet(appearance: CharacterAppearance, tileSize: number): HTMLCanvasElement {
  const key = `${tileSize}:${JSON.stringify(appearance)}`;
  let sheet = spriteCache.get(key);
  if (!sheet) {
    sheet = rasterize(drawCharacterBlock(appearance), tileSize / 16);
    spriteCache.set(key, sheet);
  }
  return sheet;
}

/** Everything drawn for the current map. */
export class MapScene {
  readonly renderer: TilemapRenderer;
  readonly player = new MapCharacter();
  readonly events = new Map<number, SceneEvent>();
  readonly remotes = new Map<number, SceneRemote>();
  readonly monsters = new Map<number, SceneMonster>();
  private popups: Popup[] = [];
  /** Camera top-left, in map pixels. */
  cameraX = 0;
  cameraY = 0;
  private shadow: Bitmap | null = null;
  private balloons: Bitmap | null = null;
  private effects: SceneEffect[] = [];
  /** Background image drawn behind the tiles (transparent cells show it). */
  private parallax: Bitmap | null = null;
  /** Auto-scroll offset of the parallax, in pixels. */
  private parallaxScrollX = 0;
  private parallaxScrollY = 0;
  private viewW = 0;
  private viewH = 0;

  private constructor(
    private readonly assets: AssetStore,
    readonly map: ClientMap,
    readonly tileset: TilesetData,
    sheets: Partial<Record<TilesetSheet, Bitmap>>,
    readonly tileSize: number,
  ) {
    this.renderer = new TilemapRenderer(map, tileset.flags, sheets, tileSize);
  }

  /**
   * Loads every image a map needs and builds the scene.
   * @param assets - Asset store.
   * @param map - Map payload.
   * @param tileset - Tileset of the map.
   * @param events - Event views.
   * @param appearance - Player appearance (its sheet is generated locally).
   * @param tileSize - Tile size in pixels.
   */
  static async load(
    assets: AssetStore,
    map: ClientMap,
    tileset: TilesetData,
    events: EventView[],
    appearance: CharacterAppearance,
    tileSize: number,
  ): Promise<MapScene> {
    const sheets: Partial<Record<TilesetSheet, Bitmap>> = {};
    await Promise.all(
      TILESET_SHEETS.map(async (slot, i) => {
        const name = tileset.tilesetNames[i];
        if (!name) return;
        const image = await assets.image('tilesets', name);
        if (image) sheets[slot] = image;
      }),
    );
    const scene = new MapScene(assets, map, tileset, sheets, tileSize);
    scene.shadow = await assets.image('system', 'Shadow1');
    scene.balloons = await assets.image('system', 'Balloon');
    if (map.parallaxName && map.parallaxShow) scene.parallax = await assets.image('parallaxes', map.parallaxName);
    scene.setPlayerAppearance(appearance);
    await Promise.all(events.map((e) => scene.addEvent(e)));
    return scene;
  }

  /** Builds the player's sprite from its appearance (generated in the browser). */
  setPlayerAppearance(appearance: CharacterAppearance): void {
    this.player.sprite = { image: appearanceSheet(appearance, this.tileSize), single: true, object: false, index: 0 };
  }

  /** Adds (or refreshes) another player. */
  addRemote(info: RemotePlayer): void {
    const character = this.remotes.get(info.id)?.character ?? new MapCharacter();
    character.locate(info.x, info.y);
    character.direction = info.direction;
    character.sprite = { image: appearanceSheet(info.appearance, this.tileSize), single: true, object: false, index: 0 };
    this.remotes.set(info.id, { info, character });
  }

  /** Removes another player. */
  removeRemote(id: number): void {
    this.remotes.delete(id);
  }

  /** Adds (or refreshes) a monster. */
  async addMonster(view: MonsterView): Promise<void> {
    const character = new MapCharacter();
    character.locate(view.x, view.y);
    character.direction = view.direction;
    character.moveSpeed = view.moveSpeed;
    character.stepAnime = true;
    this.monsters.set(view.id, { view, character, hp: view.hp, maxHp: view.maxHp, hurt: 0, dying: 0 });
    const image = view.characterName ? await this.assets.image('characters', view.characterName) : null;
    if (image && this.monsters.get(view.id)?.character === character) character.sprite = { image, ...sheetFlags(view.characterName), index: view.characterIndex };
  }

  /** Moves or turns a monster (one-cell steps are interpolated). */
  moveMonster(id: number, x: number, y: number, direction: Direction): void {
    const m = this.monsters.get(id);
    if (!m || m.dying) return;
    const c = m.character;
    c.direction = direction;
    if (c.x === x && c.y === y) return;
    c.realX = c.x;
    c.realY = c.y;
    if (Math.abs(c.x - x) + Math.abs(c.y - y) === 1) {
      c.x = x;
      c.y = y;
    } else {
      c.locate(x, y);
    }
  }

  /** Removes a monster, fading it out when it was defeated. */
  removeMonster(id: number, died: boolean): void {
    const m = this.monsters.get(id);
    if (!m) return;
    if (died) m.dying = DYING_FRAMES;
    else this.monsters.delete(id);
  }

  /**
   * Character of a combat actor.
   * @param selfId - Character id of the local player.
   */
  combatant(actor: { kind: 'player' | 'monster'; id: number }, selfId: number): MapCharacter | undefined {
    if (actor.kind === 'monster') return this.monsters.get(actor.id)?.character;
    return actor.id === selfId ? this.player : this.remotes.get(actor.id)?.character;
  }

  /**
   * Shows the result of a hit as a floating number (and updates the monster's bar).
   * @param popup - `false` only updates the bar (floating numbers turned off in the options).
   */
  showDamage(anchor: Anchor, view: DamageView, popup = true): void {
    if (view.target.kind === 'monster') {
      const m = this.monsters.get(view.target.id);
      if (m) {
        m.hp = view.hp;
        m.maxHp = view.maxHp;
        if (view.kind === 'hp_damage') m.hurt = 12;
      }
    }
    if (!popup) return;
    const text = view.kind === 'miss' ? 'Miss' : `${view.kind.endsWith('recover') ? '+' : ''}${view.amount}`;
    const color = view.kind === 'miss' ? '#d8d8d8' : view.kind === 'hp_recover' ? '#7dff8a' : view.kind === 'mp_recover' ? '#7fc4ff' : view.kind === 'mp_damage' ? '#c690ff' : view.target.kind === 'player' ? '#ff6a5a' : '#ffffff';
    this.popups.push({ anchor: { realX: anchor.realX, realY: anchor.realY }, text: view.critical ? `${text}!` : text, color: view.critical ? '#ffd23a' : color, big: view.critical, age: 0 });
  }

  /**
   * Marks an area of the ground about to be hit by a boss: a red square of
   * cells that fills up until the blow.
   */
  showTelegraph(x: number, y: number, radius: number, ms: number): void {
    const T = this.tileSize;
    const duration = Math.max(6, Math.round((ms / 1000) * 60));
    this.effects.push({
      target: -1,
      anchor: { realX: x, realY: y },
      age: 0,
      duration,
      draw: (ctx, _x, _y, age) => {
        const t = age / duration;
        const size = (radius * 2 + 1) * T;
        const left = (x - radius) * T;
        const top = (y - radius) * T;
        ctx.save();
        ctx.fillStyle = `rgba(220, 30, 30, ${0.15 + 0.25 * t})`;
        ctx.fillRect(left, top, size, size);
        ctx.strokeStyle = `rgba(255, 90, 60, ${0.6 + 0.4 * Math.sin(age / 3)})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(left + 1.5, top + 1.5, size - 3, size - 3);
        // The inner square grows until the blow.
        const inner = size * t;
        ctx.fillStyle = 'rgba(255, 60, 40, 0.35)';
        ctx.fillRect(left + (size - inner) / 2, top + (size - inner) / 2, inner, inner);
        ctx.restore();
      },
    });
  }

  /**
   * Plays the visual of an attack or skill: a slash in front of melee
   * attackers, a projectile flying to the first target cell for ranged ones.
   */
  showAction(user: MapCharacter, action: ActionView): void {
    const T = this.tileSize;
    const target = action.targets[0];
    if (action.range > 1 && target) {
      const from = { x: user.realX, y: user.realY };
      const dist = Math.max(1, Math.abs(target.x - user.x) + Math.abs(target.y - user.y));
      const duration = Math.min(30, 4 + dist * 3);
      this.effects.push({
        target: -1,
        anchor: { realX: target.x, realY: target.y },
        age: 0,
        duration,
        draw: (ctx, _x, _y, age) => {
          const t = age / duration;
          const px = (from.x + (target.x - from.x) * t) * T + T / 2;
          const py = (from.y + (target.y - from.y) * t) * T + T / 2;
          ctx.save();
          ctx.fillStyle = action.skillId ? '#ffe38a' : '#f4f1e6';
          ctx.shadowColor = action.skillId ? '#ff9a2a' : '#ffffff';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(px, py, action.skillId ? 7 : 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        },
      });
      return;
    }
    const angle = { 2: Math.PI / 2, 4: Math.PI, 6: 0, 8: -Math.PI / 2 }[action.direction];
    this.effects.push({
      target: -1,
      anchor: user,
      age: 0,
      duration: 12,
      draw: (ctx, x, y, age) => {
        const cx = x + Math.cos(angle) * T * 0.55;
        const cy = y + T * 0.95 + Math.sin(angle) * T * 0.55;
        const t = age / 12;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = action.skillId ? '#ffd35a' : '#ffffff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, T * 0.45, angle - 1.1 + t * 0.9, angle + 0.1 + t * 0.9);
        ctx.stroke();
        ctx.restore();
      },
    });
  }

  /**
   * Applies a position update of another player. One-cell steps are
   * interpolated; anything else (teleport, lag spike) snaps.
   */
  moveRemote(id: number, x: number, y: number, direction: Direction): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    const c = remote.character;
    c.direction = direction;
    remote.info = { ...remote.info, x, y, direction };
    if (c.x === x && c.y === y) return;
    // Finish the previous step at once so that steps never blend diagonally.
    c.realX = c.x;
    c.realY = c.y;
    if (Math.abs(c.x - x) + Math.abs(c.y - y) === 1) {
      c.x = x;
      c.y = y;
    } else {
      c.locate(x, y);
    }
  }

  /** Adds or replaces an event. */
  async addEvent(view: EventView): Promise<void> {
    const character = this.events.get(view.id)?.character ?? new MapCharacter();
    character.locate(view.x, view.y);
    this.applyView(character, view);
    this.events.set(view.id, { view, character });
    const name = view.image.characterName;
    if (name && view.image.tileId === 0) {
      const image = await this.assets.image('characters', name);
      if (image) character.sprite = { image, ...sheetFlags(name), index: view.image.characterIndex };
    }
  }

  /** Removes an event (no page applies to the player any more). */
  removeEvent(id: number): void {
    this.events.delete(id);
  }

  /**
   * Updates an event from a new view (move route setting, page change). Its
   * current position is kept when the view only differs by settings.
   */
  async updateEvent(view: EventView): Promise<void> {
    const existing = this.events.get(view.id);
    if (!existing) {
      await this.addEvent(view);
      return;
    }
    const c = existing.character;
    const sameImage = existing.view.image.characterName === view.image.characterName && existing.view.image.characterIndex === view.image.characterIndex && existing.view.image.tileId === view.image.tileId;
    if (c.x !== view.x || c.y !== view.y) c.locate(view.x, view.y);
    this.applyView(c, view);
    existing.view = view;
    if (sameImage) return;
    c.sprite = null;
    const name = view.image.characterName;
    if (name && view.image.tileId === 0) {
      const image = await this.assets.image('characters', name);
      if (image && this.events.get(view.id)?.view === view) c.sprite = { image, ...sheetFlags(name), index: view.image.characterIndex };
    }
  }

  /** Character of an effect target (0 = the player). */
  private targetCharacter(target: number): MapCharacter | undefined {
    return target === 0 ? this.player : this.events.get(target)?.character;
  }

  /** What an effect is drawn on. */
  private effectAnchor(e: SceneEffect): Anchor | undefined {
    return e.anchor ?? this.targetCharacter(e.target);
  }

  /**
   * Shows an emotion balloon over a character.
   * @param target - 0 for the player, otherwise an event id.
   * @param balloon - Balloon number (1 = exclamation...).
   */
  showBalloon(target: number, balloon: number, anchor?: Anchor): void {
    const sheet = this.balloons;
    if (!sheet) return;
    const row = Math.min(balloon, sheet.height / BALLOON_SIZE) - 1;
    this.effects = this.effects.filter((e) => (anchor ? e.anchor !== anchor : e.target !== target) || e.duration !== BALLOON_FRAMES * BALLOON_FRAME_TIME + BALLOON_HOLD);
    this.effects.push({
      target,
      anchor,
      age: 0,
      duration: BALLOON_FRAMES * BALLOON_FRAME_TIME + BALLOON_HOLD,
      draw: (ctx, x, y, age) => {
        const frame = Math.min(BALLOON_FRAMES - 1, Math.floor(age / BALLOON_FRAME_TIME));
        ctx.drawImage(sheet, frame * BALLOON_SIZE, row * BALLOON_SIZE, BALLOON_SIZE, BALLOON_SIZE, Math.round(x - BALLOON_SIZE / 2), Math.round(y - BALLOON_SIZE), BALLOON_SIZE, BALLOON_SIZE);
      },
    });
  }

  /**
   * Plays an animation over a character: frames of the animation sheet (a
   * row of square frames), or a generated sparkle when there is no sheet.
   */
  showAnimation(target: number, sheet: Bitmap | null, frameCount: number, frameSize: number, fps: number, anchor?: Anchor): void {
    const frames = Math.max(1, frameCount);
    const duration = Math.max(10, Math.round((frames / Math.max(1, fps)) * 60));
    const T = this.tileSize;
    this.effects.push({
      target,
      anchor,
      age: 0,
      duration,
      draw: (ctx, x, y, age) => {
        const cy = y + T * 0.85;
        if (sheet) {
          const columns = Math.max(1, Math.floor(sheet.width / frameSize));
          const frame = Math.min(frames - 1, Math.floor((age / duration) * frames));
          const size = Math.round(frameSize * (T / 48));
          ctx.drawImage(sheet, (frame % columns) * frameSize, Math.floor(frame / columns) * frameSize, frameSize, frameSize, Math.round(x - size / 2), Math.round(cy - size / 2), size, size);
          return;
        }
        const t = age / duration;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#fff6c8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, cy, T * (0.2 + t * 0.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffe27a';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + t * 2;
          const r = T * (0.15 + t * 0.55);
          ctx.fillRect(Math.round(x + Math.cos(a) * r) - 2, Math.round(cy + Math.sin(a) * r) - 2, 4, 4);
        }
        ctx.restore();
      },
    });
  }

  private applyView(c: MapCharacter, view: EventView): void {
    c.direction = view.image.direction;
    c.pattern = view.image.pattern;
    c.tileId = view.image.tileId;
    c.walkAnime = view.walkAnime;
    c.stepAnime = view.stepAnime;
    c.directionFix = view.directionFix;
    c.moveSpeed = view.moveSpeed;
  }

  /**
   * Tells whether a solid event (same priority as characters) stands on a cell.
   * @param withSprite - Only events drawn with a character sprite.
   */
  solidEventAt(x: number, y: number, withSprite = false): boolean {
    for (const { view, character } of this.events.values()) {
      if (character.x !== x || character.y !== y || view.priorityType !== Priority.Same) continue;
      if (!withSprite || (character.sprite && character.tileId === 0)) return true;
    }
    return false;
  }

  /** Tells whether a solid event occupies a cell. */
  isBlockedByEvent(x: number, y: number): boolean {
    for (const { view, character } of this.events.values()) {
      if (character.x === x && character.y === y && view.priorityType === Priority.Same && !view.through) return true;
    }
    return false;
  }

  /** Client-side prediction of a step (the server has the final word). */
  canStep(x: number, y: number, d: Direction): boolean {
    if (!canMove(this.map, this.tileset.flags, x, y, d)) return false;
    const nx = x + (d === 4 ? -1 : d === 6 ? 1 : 0);
    const ny = y + (d === 8 ? -1 : d === 2 ? 1 : 0);
    return !this.isBlockedByEvent(nx, ny) && !this.monsterAt(nx, ny);
  }

  /** Tells whether a living monster stands on a cell. */
  monsterAt(x: number, y: number): boolean {
    for (const m of this.monsters.values()) if (!m.dying && m.character.x === x && m.character.y === y) return true;
    return false;
  }

  /** Advances one frame. */
  update(): void {
    this.renderer.animationCount++;
    // Looping parallaxes scroll by themselves (sx/sy are in 1/2 pixel per frame units).
    if (this.map.parallaxLoopX) this.parallaxScrollX += this.map.parallaxSx / 2;
    if (this.map.parallaxLoopY) this.parallaxScrollY += this.map.parallaxSy / 2;
    const flags = this.tileset.flags;
    const others = [...this.events.values(), ...this.remotes.values(), ...this.monsters.values()].map((e) => e.character);
    for (const c of [this.player, ...others]) {
      c.update();
      c.bush = !c.isMoving() && isBush(this.map, flags, c.x, c.y);
    }
    for (const [id, m] of this.monsters) {
      if (m.hurt > 0) m.hurt--;
      if (m.dying > 0 && --m.dying === 0) this.monsters.delete(id);
    }
    for (const e of this.effects) e.age++;
    this.effects = this.effects.filter((e) => e.age < e.duration && this.effectAnchor(e));
    for (const p of this.popups) p.age++;
    this.popups = this.popups.filter((p) => p.age < POPUP_FRAMES);
    this.updateCamera();
  }

  /** Sets the viewport size in CSS pixels (before zoom). */
  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.updateCamera();
  }

  private updateCamera(): void {
    const T = this.tileSize;
    const mapW = this.map.width * T;
    const mapH = this.map.height * T;
    const cx = this.player.realX * T + T / 2 - this.viewW / 2;
    const cy = this.player.realY * T + T / 2 - this.viewH / 2;
    this.cameraX = mapW <= this.viewW ? (mapW - this.viewW) / 2 : Math.min(Math.max(cx, 0), mapW - this.viewW);
    this.cameraY = mapH <= this.viewH ? (mapH - this.viewH) / 2 : Math.min(Math.max(cy, 0), mapH - this.viewH);
  }

  /** Converts a viewport point (CSS pixels, before zoom) to a map cell, or `null` outside. */
  cellAt(px: number, py: number): { x: number; y: number } | null {
    const x = Math.floor((px + this.cameraX) / this.tileSize);
    const y = Math.floor((py + this.cameraY) / this.tileSize);
    return isValidPosition(this.map, x, y) ? { x, y } : null;
  }

  /**
   * Draws the scene.
   * @param ctx - Context already scaled so that one unit = one CSS pixel at zoom 1.
   */
  render(ctx: CanvasRenderingContext2D): void {
    const T = this.tileSize;
    // Snap the camera to whole DEVICE pixels (not CSS pixels): with a zoom or a
    // screen scale such as 125 %, a CSS-pixel offset lands between device
    // pixels and the edges of the cached map chunks show thin dark seams.
    const scale = ctx.getTransform().a || 1;
    const ox = Math.round(this.cameraX * scale) / scale;
    const oy = Math.round(this.cameraY * scale) / scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    if (this.parallax) this.drawParallax(ctx, ox, oy);
    ctx.save();
    ctx.translate(-ox, -oy);
    this.renderer.drawLower(ctx, ox, oy, this.viewW, this.viewH);
    const drawTile = (id: number, dx: number, dy: number) => this.renderer.drawTile(ctx, id, dx, dy, this.renderer.animationFrame);
    const list: { c: MapCharacter; layer: number; monster?: SceneMonster }[] = [{ c: this.player, layer: 1 }];
    for (const { view, character } of this.events.values()) list.push({ c: character, layer: view.priorityType });
    for (const { character } of this.remotes.values()) list.push({ c: character, layer: 1 });
    for (const m of this.monsters.values()) list.push({ c: m.character, layer: 1, monster: m });
    list.sort((a, b) => a.layer - b.layer || a.c.sortY() - b.c.sortY());
    for (const { c, monster } of list) {
      // Skip characters far outside the view.
      if ((c.realX + 2) * T < ox || (c.realX - 1) * T > ox + this.viewW || (c.realY + 1) * T < oy || (c.realY - 2) * T > oy + this.viewH) continue;
      if (monster && (monster.dying || monster.hurt)) {
        ctx.save();
        // Hurt monsters blink; defeated ones fade out while rising a little.
        ctx.globalAlpha = monster.dying ? monster.dying / DYING_FRAMES : monster.hurt % 4 < 2 ? 0.45 : 1;
        if (monster.dying) ctx.translate(0, -(DYING_FRAMES - monster.dying));
        c.draw(ctx, T, this.shadow, drawTile);
        ctx.restore();
      } else {
        c.draw(ctx, T, this.shadow, drawTile);
      }
    }
    this.renderer.drawUpper(ctx, ox, oy, this.viewW, this.viewH);
    this.drawMonsterBars(ctx);
    this.drawMarkers(ctx);
    for (const effect of this.effects) {
      const c = this.effectAnchor(effect);
      if (c) effect.draw(ctx, c.realX * T + T / 2, c.realY * T - T * 0.45, effect.age);
    }
    this.drawPopups(ctx);
    ctx.restore();
  }

  /** HP bars above hurt monsters. */
  private drawMonsterBars(ctx: CanvasRenderingContext2D): void {
    const T = this.tileSize;
    for (const m of this.monsters.values()) {
      if (m.dying || m.hp >= m.maxHp) continue;
      const w = Math.round(T * 0.75);
      const x = Math.round(m.character.realX * T + (T - w) / 2);
      const y = Math.round(m.character.realY * T - T * 0.25);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x - 1, y - 1, w + 2, 6);
      const rate = Math.max(0, m.hp / Math.max(1, m.maxHp));
      ctx.fillStyle = rate > 0.5 ? '#5ad65a' : rate > 0.25 ? '#e6c12e' : '#e0463a';
      ctx.fillRect(x, y, Math.round(w * rate), 4);
    }
  }

  /** Floating numbers, rising and fading. */
  private drawPopups(ctx: CanvasRenderingContext2D): void {
    const T = this.tileSize;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    for (const p of this.popups) {
      const t = p.age / POPUP_FRAMES;
      // A quick bounce, then a slow rise.
      const rise = p.age < 8 ? Math.sin((p.age / 8) * Math.PI) * 10 : (p.age - 8) * 0.5;
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.font = `800 ${p.big ? 22 : 16}px "Segoe UI", system-ui, sans-serif`;
      const x = p.anchor.realX * T + T / 2;
      const y = p.anchor.realY * T - T * 0.1 - rise;
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, y);
    }
    ctx.restore();
  }

  /** Quest markers above events ("!" / "?"), bobbing gently; hidden while a balloon plays. */
  private drawMarkers(ctx: CanvasRenderingContext2D): void {
    const T = this.tileSize;
    const bob = Math.round(Math.sin(performance.now() / 260) * 2);
    for (const { view, character } of this.events.values()) {
      const image = view.marker ? markerImage(view.marker) : null;
      if (!image || this.effects.some((e) => e.target === view.id)) continue;
      const x = Math.round(character.realX * T + T / 2 - MARKER_SIZE / 2);
      const y = Math.round(character.realY * T - T * 0.55 - MARKER_SIZE + bob);
      ctx.drawImage(image, x, y, MARKER_SIZE, MARKER_SIZE);
    }
  }

  /** Tiles the parallax image; it follows the camera at half speed for a sense of depth. */
  private drawParallax(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    const img = this.parallax!;
    const w = img.width;
    const h = img.height;
    const px = (((ox / 2 - this.parallaxScrollX) % w) + w) % w;
    const py = (((oy / 2 - this.parallaxScrollY) % h) + h) % h;
    for (let y = -py; y < this.viewH; y += h) for (let x = -px; x < this.viewW; x += w) ctx.drawImage(img, Math.round(x), Math.round(y));
  }

  /** Screen position (CSS pixels) of a character's head, for names and bubbles. */
  headPosition(c: MapCharacter): { x: number; y: number } {
    const T = this.tileSize;
    return { x: c.realX * T + T / 2 - this.cameraX, y: c.realY * T - T * 0.9 - this.cameraY };
  }
}
