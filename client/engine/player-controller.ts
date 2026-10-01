/**
 * @file Turns input into player movement and server intents.
 *
 * The client predicts its own moves for responsiveness: when the player is
 * standing on a cell and a direction is held, the step starts immediately if
 * the local rules allow it, and a `move` intent is sent. The server validates
 * every step; a rejection makes the client snap back to the authoritative
 * position. Clicking/tapping a cell computes an A* path that is followed one
 * step at a time (any manual direction cancels it).
 */
import { findPath } from '../../shared/passability.js';
import type { Direction } from '../../shared/settings.js';
import type { Input } from './input.js';
import type { MapScene } from './scene.js';

/** Messages the controller sends to the server. */
export interface IntentSink {
  move(direction: Direction, epoch: number): void;
  turn(direction: Direction): void;
  action(): void;
}

/** Player movement controller. */
export class PlayerController {
  private epoch = 0;
  private path: Direction[] = [];
  /** When `true` (message or menu open), the player does not move. */
  frozen = false;

  constructor(
    private scene: MapScene,
    private readonly input: Input,
    private readonly sink: IntentSink,
  ) {}

  /** Uses a new scene (map change). */
  setScene(scene: MapScene): void {
    this.scene = scene;
    this.path = [];
  }

  /** Walks to a cell with pathfinding. */
  walkTo(x: number, y: number): void {
    const p = this.scene.player;
    // Clicking a neighbouring cell that cannot be entered (NPC, chest, sign): face it and interact.
    if (Math.abs(p.x - x) + Math.abs(p.y - y) === 1) {
      const d: Direction = x < p.x ? 4 : x > p.x ? 6 : y < p.y ? 8 : 2;
      if (!this.scene.canStep(p.x, p.y, d)) {
        this.path = [];
        this.face(d);
        this.sink.action();
        return;
      }
    }
    const path = findPath(this.scene.map, this.scene.tileset.flags, { x: p.x, y: p.y }, { x, y }, (cx, cy) => this.scene.isBlockedByEvent(cx, cy));
    this.path = (path ?? []) as Direction[];
    // Clicking an adjacent solid thing (NPC, sign): face it and interact.
    if (this.path.length === 0 && Math.abs(p.x - x) + Math.abs(p.y - y) === 1) {
      const d: Direction = x < p.x ? 4 : x > p.x ? 6 : y < p.y ? 8 : 2;
      this.face(d);
      this.sink.action();
    }
  }

  /** Stops path following. */
  cancelPath(): void {
    this.path = [];
  }

  private face(d: Direction): void {
    const p = this.scene.player;
    if (p.direction !== d) {
      p.setDirection(d);
      this.sink.turn(d);
    }
  }

  /** Called every frame, before the scene update. */
  update(): void {
    const p = this.scene.player;
    if (this.frozen || p.isMoving()) return;
    if (this.input.consume('action')) {
      this.path = [];
      this.sink.action();
      return;
    }
    const held = this.input.dir4();
    if (held) this.path = [];
    const d = held || this.path.shift();
    if (!d) return;
    if (this.scene.canStep(p.x, p.y, d)) {
      p.moveStraight(d);
      this.sink.move(d, this.epoch);
    } else {
      this.face(d);
      this.path = [];
    }
  }

  /**
   * Applies a move decided by the server (move route): a one-cell move is
   * animated, anything else snaps. The new movement epoch is adopted.
   */
  force(x: number, y: number, direction: Direction, epoch: number): void {
    this.epoch = epoch;
    this.path = [];
    const p = this.scene.player;
    p.realX = p.x;
    p.realY = p.y;
    if (Math.abs(p.x - x) + Math.abs(p.y - y) === 1) {
      p.x = x;
      p.y = y;
    } else if (p.x !== x || p.y !== y) {
      p.locate(x, y);
    }
    p.direction = direction;
  }

  /** Applies a server correction and adopts the new movement epoch. */
  reject(x: number, y: number, direction: Direction, epoch: number): void {
    this.epoch = epoch;
    const p = this.scene.player;
    p.locate(x, y);
    p.direction = direction;
    this.path = [];
  }
}
