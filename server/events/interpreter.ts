/**
 * @file Server-side event command interpreter.
 *
 * Event commands always run on the server; the client only displays their
 * results (messages, choices, movements, effects). The interpreter walks a
 * command list for one player, using the indentation of commands for
 * structure exactly like external project files do: a branch that is not
 * taken skips every following command indented deeper than itself.
 *
 * Supported commands: messages (with face, speaker, choices and number input
 * attached), conditional branches, loops, labels and jumps, exit, common
 * events, switches, variables, self switches, gold, items, weapons, armors,
 * HP / MP / experience / level, recover all, equipment, transfer, move
 * routes and waiting for them, animations, balloons, erase event, wait,
 * sound effects, script (sandboxed) and the engine commands (quests,
 * notification, inn). Shop and battle commands are handed to the host (shop
 * window, enemy appearing next to the player).
 * Unknown commands are skipped, so pages written for later features still run
 * the parts that are supported.
 */
import { BranchType, Cmd, MmoCmd, QuestStatus, SELF_SWITCHES, questStatusMatches, type EventCommand, type MoveRoute, type SelfSwitch } from '../../shared/events.js';
import type { EffectPayload, MessagePayload } from '../../shared/protocol.js';
import type { Direction } from '../../shared/settings.js';
import type { ScriptOp } from './sandbox.js';

/** Kind of inventory entry handled by item commands. */
export type EntryKind = 'item' | 'weapon' | 'armor';

/**
 * Target of character commands: -1 the player, 0 the running event, n the event with id n.
 */
export type CharacterRef = number;

/** What the interpreter needs from the world to run commands for one player. */
export interface InterpreterHost {
  /** Tells whether the run may continue (player connected, still on the map...). */
  isActive(): boolean;
  /**
   * Shows a message (possibly with choices or a number input) and resolves
   * with the player's answer: the choice index (-2 = cancelled), the number
   * entered, or 0 for a plain message.
   */
  showMessage(message: MessagePayload): Promise<number>;
  /** Player's name, for `\P` in texts. */
  playerName(): string;
  /** Currency name, for `\G` in texts. */
  currencyName(): string;

  getSwitch(id: number): boolean;
  setSwitch(id: number, on: boolean): void;
  getVariable(id: number): number;
  setVariable(id: number, value: number): void;
  getSelfSwitch(letter: SelfSwitch): boolean;
  setSelfSwitch(letter: SelfSwitch, on: boolean): void;

  gold(): number;
  level(): number;
  exp(): number;
  vitals(): { hp: number; mp: number };
  itemCount(kind: EntryKind, id: number, includeEquipped: boolean): number;
  mapId(): number;
  /** Position and direction of a character, or `null` if it does not exist. */
  characterState(target: CharacterRef): { x: number; y: number; direction: Direction } | null;
  questStatus(questId: number): { status: number; step: number };

  changeGold(delta: number): void;
  changeItems(kind: EntryKind, id: number, delta: number): void;
  changeHp(delta: number, allowDeath: boolean): void;
  changeMp(delta: number): void;
  recoverAll(): void;
  changeExp(delta: number, showLevelUp: boolean): void;
  changeLevel(delta: number, showLevelUp: boolean): void;
  /** Equips an item in a slot (`itemId` 0 empties it). */
  changeEquipment(slot: number, itemId: number): void;
  /** Moves the player; returns `false` if the destination does not exist. */
  transfer(mapId: number, x: number, y: number, direction: Direction | 0, fade: number): boolean;
  /** Runs a move route; resolves when it is finished. */
  moveRoute(target: CharacterRef, route: MoveRoute): Promise<void>;
  /** Resolves when every move route started by this run is finished. */
  waitForMovement(): Promise<void>;
  /** Plays an animation on a character; resolves when finished if `wait`. */
  showAnimation(target: CharacterRef, animationId: number, wait: boolean): Promise<void>;
  /** Shows a balloon icon over a character; resolves when finished if `wait`. */
  showBalloon(target: CharacterRef, balloonId: number, wait: boolean): Promise<void>;
  /** Hides the running event for this player until the map is entered again. */
  eraseEvent(): void;
  playSe(se: { name: string; volume: number; pitch: number; pan: number }): void;
  wait(ms: number): Promise<void>;
  notify(text: string): void;
  quest(command: 'start' | 'advance' | 'complete', questId: number, step: number): void;
  /** Plays a screen effect (fade, tint, flash, shake); resolves when finished if `wait`. */
  screen(effect: Extract<EffectPayload, { ms: number }>, wait: boolean): Promise<void>;
  inn(price: number): Promise<void>;
  /** Opens the personal bank; resolves when it is closed. */
  bank(): Promise<void>;
  /** Sets the respawn point (`null` = the player's current position). */
  setRespawn(point: { mapId: number; x: number; y: number } | null): void;
  shop(goods: { kind: EntryKind; id: number; price: number | null }[], purchaseOnly: boolean): Promise<void>;
  battle(enemyId: number): Promise<void>;
  /** Commands of a common event, or `null` if it does not exist. */
  commonEvent(id: number): EventCommand[] | null;
  /** Runs a sandboxed script and returns the operations it requested. */
  runScript(code: string): ScriptOp[];
  /** Evaluates a sandboxed expression. */
  evaluate(expression: string): number | boolean | undefined;
}

/** Maximum number of commands run without any pause, to stop runaway loops. */
const MAX_SYNC_STEPS = 10_000;
/** Maximum nesting of common event calls. */
const MAX_DEPTH = 20;
/** Longest wait accepted from one command. */
const MAX_WAIT_MS = 10 * 60_000;

const toDirection = (v: unknown): Direction | 0 => (v === 2 || v === 4 || v === 6 || v === 8 ? v : 0);
const int = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
const letterOf = (v: unknown): SelfSwitch => (SELF_SWITCHES.includes(v as SelfSwitch) ? (v as SelfSwitch) : 'A');
/** Duration of a screen fade out / in. */
const FADE_MS = 500;
/** Converts a duration in frames (60 per second) to milliseconds, capped at one minute. */
const frames = (v: unknown): number => Math.min(60_000, Math.max(0, int(v, 30)) * (1000 / 60));

/**
 * Compares two values with the standard comparison codes.
 * @param op - 0 =, 1 ≥, 2 ≤, 3 >, 4 <, 5 ≠.
 */
export function compare(a: number, b: number, op: number): boolean {
  switch (op) {
    case 0: return a === b;
    case 1: return a >= b;
    case 2: return a <= b;
    case 3: return a > b;
    case 4: return a < b;
    case 5: return a !== b;
    default: return false;
  }
}

/** Replaces the text codes resolved by the server (`\V[n]`, `\P`, `\G`). */
export function resolveText(text: string, host: Pick<InterpreterHost, 'getVariable' | 'playerName' | 'currencyName'>): string {
  return text
    .replace(/\\V\[(\d+)\]/gi, (_, id: string) => String(host.getVariable(Number(id))))
    .replace(/\\P/g, host.playerName())
    .replace(/\\G/g, host.currencyName());
}

/** Runs one command list (a page, or a common event called from it). */
class Interpreter {
  private index = 0;
  /** Result of the last branch at each indentation (conditions and choices). */
  private readonly branch: Record<number, boolean | number> = {};
  private syncSteps = 0;

  constructor(
    private readonly list: readonly EventCommand[],
    private readonly host: InterpreterHost,
    private readonly depth: number,
  ) {}

  /** Runs the list to completion. */
  async run(): Promise<void> {
    while (this.index < this.list.length && this.host.isActive()) {
      if (++this.syncSteps > MAX_SYNC_STEPS) return;
      const command = this.list[this.index]!;
      const paused = await this.execute(command);
      if (paused) this.syncSteps = 0;
    }
  }

  private get current(): EventCommand {
    return this.list[this.index]!;
  }

  /** Skips the commands indented deeper than the current one. */
  private skipBranch(): void {
    const indent = this.current.indent;
    while (this.list[this.index + 1] && this.list[this.index + 1]!.indent > indent) this.index++;
  }

  /** Waits and marks the run as paused. */
  private async pause(promise: Promise<unknown>): Promise<true> {
    await promise;
    return true;
  }

  /**
   * Executes the current command and advances.
   * @returns `true` if the command waited (resets the runaway-loop counter).
   */
  private async execute(c: EventCommand): Promise<boolean> {
    const p = c.parameters;
    const h = this.host;
    let paused = false;
    switch (c.code) {
      case Cmd.ShowText:
        paused = await this.pause(this.showText());
        return paused;
      case Cmd.ShowChoices:
        // Choices without a message before them.
        paused = await this.pause(this.showChoices(c, null));
        return paused;
      case Cmd.InputNumber:
        paused = await this.pause(this.inputNumber(c, null));
        return paused;
      case Cmd.When:
        if (this.branch[c.indent] !== int(p[0])) this.skipBranch();
        break;
      case Cmd.WhenCancel:
        if (this.branch[c.indent] !== -2) this.skipBranch();
        break;
      case Cmd.If: {
        const result = this.condition(p);
        this.branch[c.indent] = result;
        if (!result) this.skipBranch();
        break;
      }
      case Cmd.Else:
        if (this.branch[c.indent] !== false) this.skipBranch();
        break;
      case Cmd.LoopEnd: {
        // Back to the matching loop start.
        let i = this.index - 1;
        while (i >= 0 && !(this.list[i]!.code === Cmd.Loop && this.list[i]!.indent === c.indent)) i--;
        this.index = Math.max(0, i);
        break;
      }
      case Cmd.BreakLoop: {
        let i = this.index + 1;
        while (i < this.list.length && !(this.list[i]!.code === Cmd.LoopEnd && this.list[i]!.indent < c.indent)) i++;
        this.index = i;
        break;
      }
      case Cmd.ExitEvent:
        this.index = this.list.length;
        return false;
      case Cmd.CommonEvent: {
        const list = h.commonEvent(int(p[0]));
        if (list && this.depth < MAX_DEPTH) {
          this.index++;
          await new Interpreter(list, h, this.depth + 1).run();
          return true;
        }
        break;
      }
      case Cmd.JumpToLabel: {
        const name = String(p[0] ?? '');
        const target = this.list.findIndex((cmd) => cmd.code === Cmd.Label && String(cmd.parameters[0] ?? '') === name);
        if (target >= 0) this.index = target;
        break;
      }
      case Cmd.ControlSwitches: {
        const from = int(p[0]);
        const to = Math.min(int(p[1]), from + 999);
        for (let id = Math.max(1, from); id <= to; id++) h.setSwitch(id, int(p[2]) === 0);
        break;
      }
      case Cmd.ControlVariables:
        this.controlVariables(p);
        break;
      case Cmd.ControlSelfSwitch:
        h.setSelfSwitch(letterOf(p[0]), int(p[1]) === 0);
        break;
      case Cmd.ChangeGold:
        h.changeGold((int(p[0]) === 1 ? -1 : 1) * Math.max(0, this.operand(p[1], p[2])));
        break;
      case Cmd.ChangeItems:
      case Cmd.ChangeWeapons:
      case Cmd.ChangeArmors: {
        const kind: EntryKind = c.code === Cmd.ChangeItems ? 'item' : c.code === Cmd.ChangeWeapons ? 'weapon' : 'armor';
        const amount = Math.max(0, this.operand(p[2], p[3]));
        if (int(p[0]) > 0) h.changeItems(kind, int(p[0]), (int(p[1]) === 1 ? -1 : 1) * amount);
        break;
      }
      case Cmd.ChangeHp:
        // [actor type, actor, operation, operand type, operand, allow death]
        h.changeHp((int(p[2]) === 1 ? -1 : 1) * Math.max(0, this.operand(p[3], p[4])), p[5] === true);
        break;
      case Cmd.ChangeMp:
        h.changeMp((int(p[2]) === 1 ? -1 : 1) * Math.max(0, this.operand(p[3], p[4])));
        break;
      case Cmd.RecoverAll:
        h.recoverAll();
        break;
      case Cmd.ChangeExp:
        h.changeExp((int(p[2]) === 1 ? -1 : 1) * Math.max(0, this.operand(p[3], p[4])), p[5] === true);
        break;
      case Cmd.ChangeLevel:
        h.changeLevel((int(p[2]) === 1 ? -1 : 1) * Math.max(0, this.operand(p[3], p[4])), p[5] === true);
        break;
      case Cmd.ChangeEquipment:
        // [actor, slot index, item id]
        h.changeEquipment(int(p[1]), int(p[2]));
        break;
      case Cmd.TransferPlayer: {
        // [designation (0 direct, 1 from variables), map, x, y, direction, fade]
        const fromVars = int(p[0]) === 1;
        const value = (v: unknown) => (fromVars ? h.getVariable(int(v)) : int(v));
        h.transfer(value(p[1]), value(p[2]), value(p[3]), toDirection(p[4]), int(p[5]));
        break;
      }
      case Cmd.SetMoveRoute: {
        const route = p[1] as MoveRoute | undefined;
        if (route && Array.isArray(route.list)) {
          const done = h.moveRoute(int(p[0]), route);
          if (route.wait) {
            this.index++;
            await done;
            return true;
          }
        }
        break;
      }
      case Cmd.WaitForMovement:
        this.index++;
        await h.waitForMovement();
        return true;
      case Cmd.ShowAnimation:
        this.index++;
        await h.showAnimation(int(p[0]), int(p[1]), p[2] === true);
        return p[2] === true;
      case Cmd.ShowBalloon:
        this.index++;
        await h.showBalloon(int(p[0]), int(p[1]), p[2] === true);
        return p[2] === true;
      case Cmd.EraseEvent:
        h.eraseEvent();
        break;
      case Cmd.Wait:
        this.index++;
        await h.wait(Math.min(MAX_WAIT_MS, Math.max(0, int(p[0])) * (1000 / 60)));
        return true;
      case Cmd.PlaySe: {
        const se = (p[0] ?? {}) as { name?: unknown; volume?: unknown; pitch?: unknown; pan?: unknown };
        if (typeof se.name === 'string' && se.name) h.playSe({ name: se.name, volume: int(se.volume, 90), pitch: int(se.pitch, 100), pan: int(se.pan, 0) });
        break;
      }
      case Cmd.ShopProcessing: {
        const goods: { kind: EntryKind; id: number; price: number | null }[] = [];
        const add = (q: unknown[]) => goods.push({ kind: (['item', 'weapon', 'armor'] as const)[int(q[0])] ?? 'item', id: int(q[1]), price: int(q[2]) === 1 ? Math.max(0, int(q[3])) : null });
        add(p);
        const purchaseOnly = p[4] === true;
        while (this.list[this.index + 1]?.code === Cmd.ShopItem) {
          this.index++;
          add(this.current.parameters);
        }
        this.index++;
        await h.shop(goods, purchaseOnly);
        return true;
      }
      case Cmd.BattleProcessing:
        this.index++;
        await h.battle(int(p[1]));
        return true;
      case Cmd.Script: {
        const lines = [String(p[0] ?? '')];
        while (this.list[this.index + 1]?.code === Cmd.ScriptLine) {
          this.index++;
          lines.push(String(this.current.parameters[0] ?? ''));
        }
        this.applyScript(h.runScript(lines.join('\n')));
        break;
      }
      case Cmd.FadeOut:
      case Cmd.FadeIn:
        this.index++;
        await h.screen({ kind: 'screenFade', out: c.code === Cmd.FadeOut, ms: FADE_MS }, true);
        return true;
      case Cmd.TintScreen: {
        // [[red, green, blue, gray], frames, wait]
        const tone = Array.isArray(p[0]) ? p[0] : [];
        const c = (i: number, min: number) => Math.max(min, Math.min(255, int(tone[i])));
        this.index++;
        await h.screen({ kind: 'tint', tone: [c(0, -255), c(1, -255), c(2, -255), c(3, 0)], ms: frames(p[1]) }, p[2] === true);
        return p[2] === true;
      }
      case Cmd.FlashScreen: {
        // [[red, green, blue, intensity], frames, wait]
        const color = Array.isArray(p[0]) ? p[0] : [];
        const c = (i: number) => Math.max(0, Math.min(255, int(color[i], 255)));
        this.index++;
        await h.screen({ kind: 'flash', color: [c(0), c(1), c(2), c(3)], ms: frames(p[1]) }, p[2] === true);
        return p[2] === true;
      }
      case Cmd.ShakeScreen: {
        // [power, speed, frames, wait]
        const level = (v: unknown) => Math.max(1, Math.min(9, int(v, 5)));
        this.index++;
        await h.screen({ kind: 'shake', power: level(p[0]), speed: level(p[1]), ms: frames(p[2]) }, p[3] === true);
        return p[3] === true;
      }
      case MmoCmd.StartQuest:
        h.quest('start', int(p[0]), 0);
        break;
      case MmoCmd.AdvanceQuest:
        h.quest('advance', int(p[0]), int(p[1]));
        break;
      case MmoCmd.CompleteQuest:
        h.quest('complete', int(p[0]), 0);
        break;
      case MmoCmd.Notify:
        h.notify(resolveText(String(p[0] ?? ''), h).slice(0, 300));
        break;
      case MmoCmd.OpenBank:
        this.index++;
        await h.bank();
        return true;
      case MmoCmd.SetRespawn:
        h.setRespawn(int(p[0]) === 1 ? { mapId: int(p[1]), x: int(p[2]), y: int(p[3]) } : null);
        break;
      case MmoCmd.OpenInn:
        this.index++;
        await h.inn(Math.max(0, int(p[0])));
        return true;
      default:
        // Comments, labels, ends of blocks and unsupported commands.
        break;
    }
    this.index++;
    return paused;
  }

  /** Applies the operations requested by a script. */
  private applyScript(ops: ScriptOp[]): void {
    for (const op of ops) {
      if (op.op === 'variable') this.host.setVariable(op.id, op.value);
      else if (op.op === 'switch') this.host.setSwitch(op.id, op.value);
      else if (op.op === 'self') this.host.setSelfSwitch(op.letter, op.value);
      else this.host.notify(op.text);
    }
  }

  /** Value of an operand: type 0 constant, 1 variable. */
  private operand(type: unknown, value: unknown): number {
    return int(type) === 1 ? this.host.getVariable(int(value)) : int(value);
  }

  /** Message block: text lines, then choices or a number input attached to the same window. */
  private async showText(): Promise<void> {
    const [faceName = '', faceIndex = 0, background = 0, position = 2, speaker = ''] = this.current.parameters as [string, number, number, number, string];
    const lines: string[] = [];
    while (this.list[this.index + 1]?.code === Cmd.TextLine) {
      this.index++;
      lines.push(String(this.current.parameters[0] ?? ''));
    }
    const message: MessagePayload = {
      faceName: String(faceName),
      faceIndex: int(faceIndex),
      background: int(background),
      position: Number.isInteger(position) ? Number(position) : 2,
      speaker: resolveText(String(speaker ?? ''), this.host),
      text: resolveText(lines.join('\n'), this.host),
    };
    const next = this.list[this.index + 1];
    if (next?.code === Cmd.ShowChoices) {
      this.index++;
      await this.showChoices(next, message);
      return;
    }
    if (next?.code === Cmd.InputNumber) {
      this.index++;
      await this.inputNumber(next, message);
      return;
    }
    this.index++;
    await this.host.showMessage(message);
  }

  /**
   * Choices `[choices[], cancelType, default, position, background]`:
   * cancelType -2 = cancel branch, -1 = cannot cancel, n = same as choice n.
   */
  private async showChoices(c: EventCommand, message: MessagePayload | null): Promise<void> {
    const choices = (Array.isArray(c.parameters[0]) ? c.parameters[0] : []).slice(0, 8).map((s) => resolveText(String(s), this.host));
    const cancelType = int(c.parameters[1], -2);
    const payload: MessagePayload = {
      ...(message ?? { faceName: '', faceIndex: 0, background: 0, position: 2, speaker: '', text: '' }),
      choices,
      choiceDefault: int(c.parameters[2]),
      choiceCancel: cancelType === -1 ? -1 : cancelType === -2 ? -2 : Math.min(cancelType, choices.length - 1),
    };
    const answer = await this.host.showMessage(payload);
    const valid = Number.isInteger(answer) && ((answer >= 0 && answer < choices.length) || (answer === -2 && cancelType !== -1));
    let result = valid ? answer : Math.max(0, payload.choiceDefault ?? 0);
    // A cancel that maps onto a choice behaves like that choice.
    if (result === -2 && cancelType >= 0) result = payload.choiceCancel ?? 0;
    this.branch[c.indent] = result;
    this.index++;
  }

  /** Number input `[variableId, digits]`. */
  private async inputNumber(c: EventCommand, message: MessagePayload | null): Promise<void> {
    const digits = Math.min(8, Math.max(1, int(c.parameters[1], 1)));
    const payload: MessagePayload = {
      ...(message ?? { faceName: '', faceIndex: 0, background: 0, position: 2, speaker: '', text: '' }),
      numberDigits: digits,
    };
    const answer = await this.host.showMessage(payload);
    const max = 10 ** digits - 1;
    this.host.setVariable(int(c.parameters[0]), Math.min(max, Math.max(0, int(answer))));
    this.index++;
  }

  /** Conditional branch test (see {@link BranchType}). */
  private condition(p: unknown[]): boolean {
    const h = this.host;
    switch (int(p[0], -1)) {
      case BranchType.Switch:
        return h.getSwitch(int(p[1])) === (int(p[2]) === 0);
      case BranchType.Variable: {
        const right = int(p[2]) === 1 ? h.getVariable(int(p[3])) : int(p[3]);
        return compare(h.getVariable(int(p[1])), right, int(p[4]));
      }
      case BranchType.SelfSwitch:
        return h.getSelfSwitch(letterOf(p[1])) === (int(p[2]) === 0);
      case BranchType.Character: {
        const state = h.characterState(int(p[1]));
        return state !== null && state.direction === int(p[2]);
      }
      case BranchType.Gold: {
        const gold = h.gold();
        const amount = int(p[1]);
        return int(p[2]) === 0 ? gold >= amount : int(p[2]) === 1 ? gold <= amount : gold < amount;
      }
      case BranchType.Item:
        return h.itemCount('item', int(p[1]), false) > 0;
      case BranchType.Weapon:
        return h.itemCount('weapon', int(p[1]), p[2] === true) > 0;
      case BranchType.Armor:
        return h.itemCount('armor', int(p[1]), p[2] === true) > 0;
      case BranchType.Script:
        return Boolean(h.evaluate(String(p[1] ?? '')));
      case BranchType.Level:
        return compare(h.level(), int(p[1]), int(p[2], 1));
      case BranchType.Quest: {
        const q = h.questStatus(int(p[1]));
        const status = int(p[2], QuestStatus.InProgress);
        if (!questStatusMatches(q.status, status)) return false;
        return status !== QuestStatus.InProgress || q.step >= int(p[3]);
      }
      default:
        return false;
    }
  }

  /**
   * Control variables `[from, to, operation, operandType, ...operand]`.
   * Operations: 0 set, 1 add, 2 sub, 3 mul, 4 div, 5 mod. Operand types:
   * 0 constant, 1 variable, 2 random [min, max], 3 game data, 4 script.
   */
  private controlVariables(p: unknown[]): void {
    const h = this.host;
    const from = Math.max(1, int(p[0]));
    const to = Math.min(int(p[1]), from + 999);
    for (let id = from; id <= to; id++) {
      let value: number;
      switch (int(p[3])) {
        case 0: value = int(p[4]); break;
        case 1: value = h.getVariable(int(p[4])); break;
        case 2: {
          const min = int(p[4]);
          const max = Math.max(min, int(p[5]));
          value = min + Math.floor(Math.random() * (max - min + 1));
          break;
        }
        case 3: value = this.gameData(int(p[4]), p[5], p[6]); break;
        case 4: value = Number(h.evaluate(String(p[4] ?? ''))) || 0; break;
        default: value = 0;
      }
      const current = h.getVariable(id);
      let result: number;
      switch (int(p[2])) {
        case 1: result = current + value; break;
        case 2: result = current - value; break;
        case 3: result = current * value; break;
        case 4: result = value === 0 ? current : Math.trunc(current / value); break;
        case 5: result = value === 0 ? current : current % value; break;
        default: result = value;
      }
      h.setVariable(id, result);
    }
  }

  /**
   * Game data operand `[type, param1, param2]`: 0/1/2 item/weapon/armor count
   * [id]; 3 player data [_, 0 level | 1 exp | 2 hp | 3 mp]; 5 character
   * [character, 0 x | 1 y | 2 direction]; 7 other [0 map id | 2 gold].
   */
  private gameData(type: number, a: unknown, b: unknown): number {
    const h = this.host;
    switch (type) {
      case 0: return h.itemCount('item', int(a), false);
      case 1: return h.itemCount('weapon', int(a), false);
      case 2: return h.itemCount('armor', int(a), false);
      case 3: {
        const which = int(b);
        if (which === 0) return h.level();
        if (which === 1) return h.exp();
        if (which === 2) return h.vitals().hp;
        if (which === 3) return h.vitals().mp;
        return 0;
      }
      case 5: {
        const s = h.characterState(int(a));
        if (!s) return 0;
        return int(b) === 0 ? s.x : int(b) === 1 ? s.y : s.direction;
      }
      case 7:
        return int(a) === 0 ? h.mapId() : int(a) === 2 ? h.gold() : 0;
      default:
        return 0;
    }
  }
}

/**
 * Runs a command list to completion.
 * @param list - Commands of the event page (or common event).
 * @param host - Player-side effects.
 */
export async function runCommands(list: readonly EventCommand[], host: InterpreterHost): Promise<void> {
  await new Interpreter(list, host, 0).run();
}
