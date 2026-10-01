/**
 * @file Live state of one map on the server: its cells, the tileset flags,
 * and the per-player copies of its events.
 *
 * Events are seen through the progress of each player: a chest opened by one
 * character stays closed for the others, an NPC says something else once a
 * quest is done. So every player on a map has its own {@link EventInstance}
 * of each event, holding the page active for that player, the position and
 * the appearance changes made by move routes. The map runtime only holds the
 * shared definitions and the rules working on a set of instances.
 */
import type { EventConditions, EventPage, EventView, GameEvent } from '../../shared/events.js';
import { Priority } from '../../shared/events.js';
import type { MapData } from '../../shared/map.js';
import { canMove } from '../../shared/passability.js';
import type { Direction } from '../../shared/settings.js';

/** One event as seen by one player. */
export interface EventInstance {
  def: GameEvent;
  /** Index of the active page, or -1 when no page applies (event not shown). */
  pageIndex: number;
  /** Hidden by the "erase event" command until the map is entered again. */
  erased: boolean;
  x: number;
  y: number;
  direction: Direction;
  /** Appearance and movement settings (from the page, changed by move routes). */
  characterName: string;
  characterIndex: number;
  tileId: number;
  moveSpeed: number;
  walkAnime: boolean;
  stepAnime: boolean;
  directionFix: boolean;
  through: boolean;
  /** Running for its player (autonomous movement pauses). */
  locked: boolean;
  /** Time of the next autonomous movement. */
  nextMoveAt: number;
  /** Position in the page's custom move route. */
  routeIndex: number;
  /** Quest marker shown to the player (see quests.ts). */
  marker: number;
}

/** Events of one map as seen by one player, by event id. */
export type EventSet = Map<number, EventInstance>;

/** Offset of a direction. */
export function offset(d: Direction): { dx: number; dy: number } {
  return { dx: d === 4 ? -1 : d === 6 ? 1 : 0, dy: d === 8 ? -1 : d === 2 ? 1 : 0 };
}

/** One loaded map. */
export class MapRuntime {
  /**
   * @param id - Map id.
   * @param map - Map content.
   * @param flags - Tileset flags.
   */
  constructor(
    readonly id: number,
    readonly map: MapData,
    readonly flags: readonly number[],
  ) {}

  /** Event definitions of the map. */
  definitions(): GameEvent[] {
    return this.map.events.filter((e): e is GameEvent => e !== null);
  }

  /** Fresh copies of every event for a player entering the map (no page resolved yet). */
  instantiate(): EventSet {
    const set: EventSet = new Map();
    for (const def of this.definitions()) {
      set.set(def.id, {
        def, pageIndex: -1, erased: false, x: def.x, y: def.y, direction: 2,
        characterName: '', characterIndex: 0, tileId: 0, moveSpeed: 3, walkAnime: true, stepAnime: false, directionFix: false, through: false,
        locked: false, nextMoveAt: 0, routeIndex: 0, marker: 0,
      });
    }
    return set;
  }

  /**
   * Resolves the active page of an event: the last page whose conditions hold.
   * @param e - Event instance.
   * @param holds - Tells whether a page's conditions are met for the player.
   * @returns The page index, or -1.
   */
  static resolvePage(e: EventInstance, holds: (c: EventConditions) => boolean): number {
    if (e.erased) return -1;
    for (let i = e.def.pages.length - 1; i >= 0; i--) if (holds(e.def.pages[i]!.conditions)) return i;
    return -1;
  }

  /** Switches an instance to a page, taking its appearance and settings. */
  static applyPage(e: EventInstance, index: number): void {
    e.pageIndex = index;
    const page = e.def.pages[index];
    if (!page) return;
    e.direction = page.image.direction;
    e.characterName = page.image.characterName;
    e.characterIndex = page.image.characterIndex;
    e.tileId = page.image.tileId;
    e.moveSpeed = page.moveSpeed;
    e.walkAnime = page.walkAnime;
    e.stepAnime = page.stepAnime;
    e.directionFix = page.directionFix;
    e.through = page.through;
    e.routeIndex = 0;
  }

  /** Active page of an instance. */
  static page(e: EventInstance): EventPage | undefined {
    return e.pageIndex >= 0 ? e.def.pages[e.pageIndex] : undefined;
  }

  /** View of an instance as sent to its player (`null` when not shown). */
  static view(e: EventInstance): EventView | null {
    const page = MapRuntime.page(e);
    if (!page) return null;
    return {
      id: e.def.id,
      page: e.pageIndex,
      x: e.x,
      y: e.y,
      image: { tileId: e.tileId, characterName: e.characterName, characterIndex: e.characterIndex, direction: e.direction, pattern: page.image.pattern },
      priorityType: page.priorityType,
      through: e.through,
      walkAnime: e.walkAnime,
      stepAnime: e.stepAnime,
      directionFix: e.directionFix,
      moveSpeed: e.moveSpeed,
      trigger: page.trigger,
      marker: e.marker,
    };
  }

  /** Views of every shown event of a set. */
  static views(set: EventSet): EventView[] {
    return [...set.values()].map((e) => MapRuntime.view(e)).filter((v): v is EventView => v !== null);
  }

  /** Shown events at a cell. */
  static eventsAt(set: EventSet, x: number, y: number): EventInstance[] {
    return [...set.values()].filter((e) => e.x === x && e.y === y && e.pageIndex >= 0);
  }

  /** Tells whether a solid event (same priority as characters, not "through") occupies a cell. */
  static isBlockedByEvent(set: EventSet, x: number, y: number, except?: EventInstance): boolean {
    return MapRuntime.eventsAt(set, x, y).some((e) => e !== except && !e.through && MapRuntime.page(e)?.priorityType === Priority.Same);
  }

  /**
   * Tells whether a character can step from (x, y) towards `d`: tile rules plus solid events.
   * @param set - Events as seen by the moving player.
   */
  canStep(set: EventSet, x: number, y: number, d: Direction): boolean {
    if (!canMove(this.map, this.flags, x, y, d)) return false;
    const { dx, dy } = offset(d);
    return !MapRuntime.isBlockedByEvent(set, x + dx, y + dy);
  }

  /**
   * Tells whether an event can step towards `d` (move routes): tile rules,
   * other solid events and the player, unless the event is "through".
   */
  canEventStep(set: EventSet, e: EventInstance, d: Direction, player: { x: number; y: number }): boolean {
    const { dx, dy } = offset(d);
    const nx = e.x + dx;
    const ny = e.y + dy;
    if (nx < 0 || ny < 0 || nx >= this.map.width || ny >= this.map.height) return false;
    if (e.through) return true;
    if (!canMove(this.map, this.flags, e.x, e.y, d)) return false;
    if (MapRuntime.page(e)?.priorityType !== Priority.Same) return true;
    if (player.x === nx && player.y === ny) return false;
    return !MapRuntime.isBlockedByEvent(set, nx, ny, e);
  }
}
