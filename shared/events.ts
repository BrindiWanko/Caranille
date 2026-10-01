/**
 * @file Map event format and event command codes.
 *
 * An event is a map object (NPC, chest, door, teleporter...) with one or more
 * pages. The last page whose conditions are met is active; it defines the
 * appearance, how the event is triggered and the list of commands it runs.
 * Commands are `{ code, indent, parameters }`; the standard codes below are
 * the ones used by external project files, and the multiplayer-specific
 * commands use the dedicated range 1000–1999.
 */

/** How an active page is started. */
export const Trigger = {
  /** The player presses Action while facing (or standing on) the event. */
  Action: 0,
  /** The player walks into the event. */
  PlayerTouch: 1,
  /** The event walks into the player. */
  EventTouch: 2,
  /** Runs as soon as the page becomes active, blocking the player. */
  Autorun: 3,
  /** Runs repeatedly in the background. */
  Parallel: 4,
} as const;

/** Drawing / collision priority of an event relative to characters. */
export const Priority = { Below: 0, Same: 1, Above: 2 } as const;

/** Standard command codes (subset grows with the interpreter). */
export const Cmd = {
  End: 0,
  FadeOut: 221,
  FadeIn: 222,
  TintScreen: 223,
  FlashScreen: 224,
  ShakeScreen: 225,
  ShowText: 101,
  TextLine: 401,
  ShowChoices: 102,
  When: 402,
  WhenCancel: 403,
  ChoicesEnd: 404,
  InputNumber: 103,
  Comment: 108,
  CommentLine: 408,
  If: 111,
  Else: 411,
  IfEnd: 412,
  Loop: 112,
  LoopEnd: 413,
  BreakLoop: 113,
  ExitEvent: 115,
  CommonEvent: 117,
  Label: 118,
  JumpToLabel: 119,
  ControlSwitches: 121,
  ControlVariables: 122,
  ControlSelfSwitch: 123,
  ChangeGold: 125,
  ChangeItems: 126,
  ChangeWeapons: 127,
  ChangeArmors: 128,
  TransferPlayer: 201,
  SetMoveRoute: 205,
  MoveRouteLine: 505,
  WaitForMovement: 209,
  Wait: 230,
  ShowAnimation: 212,
  ShowBalloon: 213,
  EraseEvent: 214,
  PlaySe: 250,
  ShopProcessing: 302,
  ShopItem: 605,
  ChangeHp: 311,
  ChangeMp: 312,
  RecoverAll: 314,
  ChangeExp: 315,
  ChangeLevel: 316,
  ChangeEquipment: 319,
  BattleProcessing: 301,
  Script: 355,
  ScriptLine: 655,
} as const;

/**
 * Multiplayer command codes (dedicated range 1000–1999).
 *
 * - `StartQuest` `[questId]`: the quest becomes "in progress" at step 0.
 * - `AdvanceQuest` `[questId, step]`: moves to `step` (0 = the next step).
 * - `CompleteQuest` `[questId]`: the quest becomes "completed".
 * - `Notify` `[text]`: a notification shown to the player (content text).
 * - `OpenInn` `[price]`: pays and fully recovers (refused without enough gold).
 * - `OpenBank` `[]`: opens the personal bank (items and gold).
 * - `SetRespawn` `[mode, mapId, x, y]`: where the player reappears after being
 *   knocked out; mode 0 = its current position, 1 = the given cell.
 */
export const MmoCmd = {
  StartQuest: 1001,
  AdvanceQuest: 1002,
  CompleteQuest: 1003,
  Notify: 1010,
  OpenInn: 1020,
  OpenBank: 1021,
  SetRespawn: 1030,
} as const;

/**
 * Condition types of the conditional branch (code 111), first parameter.
 * Standard ones:
 * - `Switch` `[0, id, 0 on | 1 off]`
 * - `Variable` `[1, id, 0 constant | 1 variable, operand, compare]` (compare: 0 =, 1 ≥, 2 ≤, 3 >, 4 <, 5 ≠)
 * - `SelfSwitch` `[2, 'A'..'D', 0 on | 1 off]`
 * - `Character` `[6, character (-1 player, 0 this event, n event), direction]`
 * - `Gold` `[7, amount, 0 ≥ | 1 ≤ | 2 <]`
 * - `Item` / `Weapon` / `Armor` `[8|9|10, id]` (owned)
 * - `Script` `[12, expression]`
 * Engine-specific ones:
 * - `Level` `[100, level, compare]`
 * - `Quest` `[101, questId, QuestStatus]`
 */
export const BranchType = {
  Switch: 0,
  Variable: 1,
  SelfSwitch: 2,
  Character: 6,
  Gold: 7,
  Item: 8,
  Weapon: 9,
  Armor: 10,
  Script: 12,
  Level: 100,
  Quest: 101,
} as const;

/**
 * Progress of a quest for one character. `Ready` is a kind of "in progress":
 * every step is done and the quest waits to be handed in, so a condition on
 * `InProgress` also holds for a ready quest.
 */
export const QuestStatus = { NotStarted: 0, InProgress: 1, Completed: 2, Ready: 3 } as const;

/**
 * Tells whether an actual quest status satisfies a wanted one in conditions
 * and branches (`InProgress` accepts `Ready`).
 */
export function questStatusMatches(actual: number, wanted: number): boolean {
  return actual === wanted || (wanted === QuestStatus.InProgress && actual === QuestStatus.Ready);
}

/**
 * Move route command codes (inside `MoveRoute.list`).
 * Moves 1–4 (down, left, right, up), 9 random, 10 toward player, 11 away from
 * player, 12 forward, 13 backward; 15 wait `[frames]`; turns 16–19 (down,
 * left, right, up), 20 right 90°, 21 left 90°, 22 180°, 24 random, 25 toward
 * player, 26 away from player; 29 speed `[1-6]`; 31/32 walk animation on/off;
 * 33/34 stepping animation on/off; 35/36 direction fix on/off; 37/38 through
 * on/off; 41 change image `[sheet, index]`; 44 play sound `[{ name }]`.
 */
export const RouteCmd = {
  End: 0,
  MoveDown: 1,
  MoveLeft: 2,
  MoveRight: 3,
  MoveUp: 4,
  MoveRandom: 9,
  MoveToward: 10,
  MoveAway: 11,
  MoveForward: 12,
  MoveBackward: 13,
  Wait: 15,
  TurnDown: 16,
  TurnLeft: 17,
  TurnRight: 18,
  TurnUp: 19,
  Turn90R: 20,
  Turn90L: 21,
  Turn180: 22,
  TurnRandom: 24,
  TurnToward: 25,
  TurnAway: 26,
  Speed: 29,
  WalkAnimeOn: 31,
  WalkAnimeOff: 32,
  StepAnimeOn: 33,
  StepAnimeOff: 34,
  DirFixOn: 35,
  DirFixOff: 36,
  ThroughOn: 37,
  ThroughOff: 38,
  Image: 41,
  PlaySe: 44,
} as const;

/** Self switch letters. */
export const SELF_SWITCHES = ['A', 'B', 'C', 'D'] as const;
export type SelfSwitch = (typeof SELF_SWITCHES)[number];

/** One command of an event page. */
export interface EventCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

/** Appearance of an event page. */
export interface EventImage {
  /** Tile id drawn instead of a character (0 = use the character sheet). */
  tileId: number;
  characterName: string;
  characterIndex: number;
  direction: 2 | 4 | 6 | 8;
  pattern: number;
}

/**
 * Page activation conditions. All enabled conditions must hold. The standard
 * fields come from external project files; `level*` and `quest*` are
 * engine-specific and optional in stored data (missing means disabled).
 * Switches and variables are personal or global depending on their
 * declaration in the System settings.
 */
export interface EventConditions {
  switch1Valid: boolean;
  switch1Id: number;
  switch2Valid: boolean;
  switch2Id: number;
  variableValid: boolean;
  variableId: number;
  variableValue: number;
  selfSwitchValid: boolean;
  selfSwitchCh: 'A' | 'B' | 'C' | 'D';
  itemValid: boolean;
  itemId: number;
  actorValid: boolean;
  actorId: number;
  /** Character level at least `level`. */
  levelValid?: boolean;
  level?: number;
  /** Quest `questId` has exactly the status `questStatus` (and, in progress, at least step `questStep`). */
  questValid?: boolean;
  questId?: number;
  questStatus?: number;
  questStep?: number;
}

/** Movement route. */
export interface MoveRoute {
  list: { code: number; parameters?: unknown[] }[];
  repeat: boolean;
  skippable: boolean;
  wait: boolean;
}

/** One event page. */
export interface EventPage {
  conditions: EventConditions;
  image: EventImage;
  /** 0 fixed, 1 random, 2 approach, 3 custom. */
  moveType: number;
  moveSpeed: number;
  moveFrequency: number;
  moveRoute: MoveRoute;
  walkAnime: boolean;
  stepAnime: boolean;
  directionFix: boolean;
  through: boolean;
  priorityType: number;
  trigger: number;
  list: EventCommand[];
}

/** A map event. */
export interface GameEvent {
  id: number;
  name: string;
  note: string;
  x: number;
  y: number;
  pages: EventPage[];
}

/** Default (all off) page conditions. */
export function emptyConditions(): EventConditions {
  return {
    switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
    variableValid: false, variableId: 1, variableValue: 0,
    selfSwitchValid: false, selfSwitchCh: 'A',
    itemValid: false, itemId: 1, actorValid: false, actorId: 1,
    levelValid: false, level: 1, questValid: false, questId: 1, questStatus: 1, questStep: 0,
  };
}

/**
 * Creates an event page with sensible defaults.
 * @param overrides - Fields to set.
 */
export function createPage(overrides: Partial<EventPage> = {}): EventPage {
  return {
    conditions: emptyConditions(),
    image: { tileId: 0, characterName: '', characterIndex: 0, direction: 2, pattern: 1 },
    moveType: 0,
    moveSpeed: 3,
    moveFrequency: 3,
    moveRoute: { list: [{ code: 0 }], repeat: true, skippable: false, wait: false },
    walkAnime: true,
    stepAnime: false,
    directionFix: false,
    through: false,
    priorityType: Priority.Same,
    trigger: Trigger.Action,
    list: [{ code: Cmd.End, indent: 0, parameters: [] }],
    ...overrides,
  };
}

/**
 * Builds the commands of a "show text" block.
 * @param lines - Text lines (control codes allowed).
 * @param face - Face sheet name and index.
 * @param speaker - Speaker name shown above the window.
 * @param indent - Nesting level.
 */
export function textCommands(lines: string[], face: [string, number] = ['', 0], speaker = '', indent = 0): EventCommand[] {
  return [
    { code: Cmd.ShowText, indent, parameters: [face[0], face[1], 0, 2, speaker] },
    ...lines.map((line) => ({ code: Cmd.TextLine, indent, parameters: [line] })),
  ];
}

/** State of an event as sent to one client (its active page resolved for that player). */
export interface EventView {
  id: number;
  /** Index of the active page. */
  page: number;
  x: number;
  y: number;
  image: EventImage;
  priorityType: number;
  through: boolean;
  walkAnime: boolean;
  stepAnime: boolean;
  directionFix: boolean;
  moveSpeed: number;
  trigger: number;
  /** Quest marker above the event for this player: 0 none, 1 "!" (quest to take), 2 "?" (quest to hand in or talk objective). */
  marker?: number;
}
