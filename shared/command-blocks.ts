/**
 * @file Structure of command lists, used by the visual command editor.
 *
 * A command list is flat; its structure comes from the indentation and from
 * continuation commands: a message is a 101 followed by its 401 lines, a
 * conditional branch is a 111, its body (indented one level deeper and ended
 * by an empty command), an optional 411 "else" with its own body, and a 412
 * "end". The editor works on blocks: selecting any row of a block selects the
 * whole block, deleting or copying it takes every row of it (and the commands
 * nested inside), and new commands are inserted as complete blocks.
 */
import { Cmd, type EventCommand } from './events.js';

/** Continuation codes and the code of the command that starts their block. */
export const CONTINUATION_OF: Readonly<Record<number, number>> = {
  [Cmd.TextLine]: Cmd.ShowText,
  [Cmd.When]: Cmd.ShowChoices,
  [Cmd.WhenCancel]: Cmd.ShowChoices,
  [Cmd.ChoicesEnd]: Cmd.ShowChoices,
  [Cmd.CommentLine]: Cmd.Comment,
  [Cmd.Else]: Cmd.If,
  [Cmd.IfEnd]: Cmd.If,
  [Cmd.LoopEnd]: Cmd.Loop,
  [Cmd.MoveRouteLine]: Cmd.SetMoveRoute,
  [Cmd.ShopItem]: Cmd.ShopProcessing,
  [Cmd.ScriptLine]: Cmd.Script,
};

/** Codes whose continuation rows directly follow them (no nested body). */
const LINE_BLOCKS: Readonly<Record<number, number>> = {
  [Cmd.ShowText]: Cmd.TextLine,
  [Cmd.Comment]: Cmd.CommentLine,
  [Cmd.SetMoveRoute]: Cmd.MoveRouteLine,
  [Cmd.ShopProcessing]: Cmd.ShopItem,
  [Cmd.Script]: Cmd.ScriptLine,
};

/** Codes of blocks with nested bodies, and the code that closes them. */
const NESTED_BLOCKS: Readonly<Record<number, number>> = {
  [Cmd.ShowChoices]: Cmd.ChoicesEnd,
  [Cmd.If]: Cmd.IfEnd,
  [Cmd.Loop]: Cmd.LoopEnd,
};

/** Tells whether a row is an empty command (end of a body, or of the list). */
export const isEmptyRow = (c: EventCommand): boolean => c.code === Cmd.End;

/**
 * Index of the command starting the block a row belongs to.
 * @param list - Command list.
 * @param index - Any row.
 */
export function blockStart(list: readonly EventCommand[], index: number): number {
  const row = list[index];
  if (!row) return index;
  const parent = CONTINUATION_OF[row.code];
  if (parent === undefined) return index;
  for (let i = index - 1; i >= 0; i--) {
    const c = list[i]!;
    if (c.indent < row.indent) break;
    if (c.indent === row.indent && c.code === parent) return i;
  }
  return index;
}

/**
 * Index just after the last row of the block starting at `start`.
 * @param list - Command list.
 * @param start - First row of the block.
 */
export function blockEnd(list: readonly EventCommand[], start: number): number {
  const first = list[start];
  if (!first) return start;
  const line = LINE_BLOCKS[first.code];
  if (line !== undefined) {
    let i = start + 1;
    while (list[i]?.code === line && list[i]!.indent === first.indent) i++;
    return i;
  }
  const closing = NESTED_BLOCKS[first.code];
  if (closing !== undefined) {
    for (let i = start + 1; i < list.length; i++) {
      const c = list[i]!;
      if (c.indent < first.indent) return i;
      if (c.indent === first.indent && c.code === closing) return i + 1;
    }
    return list.length;
  }
  return start + 1;
}

/** Range `[start, end)` of the block a row belongs to. */
export function blockRange(list: readonly EventCommand[], index: number): [number, number] {
  const start = blockStart(list, index);
  return [start, blockEnd(list, start)];
}

/** Copy of commands with their indentation shifted so the first one is at `indent`. */
export function reindent(commands: readonly EventCommand[], indent: number): EventCommand[] {
  const base = commands[0]?.indent ?? 0;
  return commands.map((c) => ({ code: c.code, indent: Math.max(0, c.indent - base + indent), parameters: structuredClone(c.parameters) }));
}

/**
 * Removes the block containing a row. Empty rows (ends of bodies) cannot be removed.
 * @returns The removed commands, or an empty array.
 */
export function removeBlock(list: EventCommand[], index: number): EventCommand[] {
  const row = list[index];
  if (!row || isEmptyRow(row)) return [];
  const [start, end] = blockRange(list, index);
  return list.splice(start, end - start);
}

/**
 * Inserts commands before a row, at that row's indentation.
 * @returns The index of the first inserted command.
 */
export function insertBlock(list: EventCommand[], index: number, commands: readonly EventCommand[]): number {
  const at = Math.max(0, Math.min(index, list.length));
  const indent = list[at]?.indent ?? 0;
  list.splice(at, 0, ...reindent(commands, indent));
  return at;
}

/** Empty body row. */
const empty = (indent: number): EventCommand => ({ code: Cmd.End, indent, parameters: [] });

/**
 * Builds a complete conditional branch block.
 * @param params - Condition parameters.
 * @param withElse - Adds an "else" branch.
 */
export function ifBlock(params: unknown[], withElse: boolean): EventCommand[] {
  const out: EventCommand[] = [{ code: Cmd.If, indent: 0, parameters: params }, empty(1)];
  if (withElse) out.push({ code: Cmd.Else, indent: 0, parameters: [] }, empty(1));
  out.push({ code: Cmd.IfEnd, indent: 0, parameters: [] });
  return out;
}

/** Builds a complete loop block. */
export function loopBlock(): EventCommand[] {
  return [{ code: Cmd.Loop, indent: 0, parameters: [] }, empty(1), { code: Cmd.LoopEnd, indent: 0, parameters: [] }];
}

/**
 * Builds a complete choices block with an empty branch per choice.
 * @param params - `[choices, cancelType, default, position, background]`.
 */
export function choicesBlock(params: unknown[]): EventCommand[] {
  const choices = (params[0] as string[]) ?? [];
  const out: EventCommand[] = [{ code: Cmd.ShowChoices, indent: 0, parameters: params }];
  choices.forEach((text, i) => out.push({ code: Cmd.When, indent: 0, parameters: [i, text] }, empty(1)));
  if (params[1] === -2) out.push({ code: Cmd.WhenCancel, indent: 0, parameters: [6, null] }, empty(1));
  out.push({ code: Cmd.ChoicesEnd, indent: 0, parameters: [] });
  return out;
}

/**
 * Changes the condition of an existing conditional branch, adding or removing
 * its "else" branch (removing it drops the commands it contained).
 * @param list - Command list (modified).
 * @param start - Index of the 111 command.
 */
export function updateIf(list: EventCommand[], start: number, params: unknown[], withElse: boolean): void {
  const head = list[start]!;
  head.parameters = params;
  const end = blockEnd(list, start);
  const elseIndex = list.findIndex((c, i) => i > start && i < end && c.code === Cmd.Else && c.indent === head.indent);
  if (withElse && elseIndex < 0) {
    list.splice(end - 1, 0, { code: Cmd.Else, indent: head.indent, parameters: [] }, empty(head.indent + 1));
  } else if (!withElse && elseIndex >= 0) {
    list.splice(elseIndex, end - 1 - elseIndex);
  }
}

/**
 * Changes the choices of an existing choices block: branch texts are updated,
 * branches are added or removed to match (a removed branch drops its
 * commands), and the cancel branch follows the cancel setting.
 * @param list - Command list (modified).
 * @param start - Index of the 102 command.
 */
export function updateChoices(list: EventCommand[], start: number, params: unknown[]): void {
  const head = list[start]!;
  const indent = head.indent;
  const end = blockEnd(list, start);
  const branches: { key: number | 'cancel'; body: EventCommand[] }[] = [];
  let current: { key: number | 'cancel'; body: EventCommand[] } | null = null;
  for (let i = start + 1; i < end - 1; i++) {
    const c = list[i]!;
    if (c.indent === indent && (c.code === Cmd.When || c.code === Cmd.WhenCancel)) {
      current = { key: c.code === Cmd.When ? Number(c.parameters[0]) : 'cancel', body: [] };
      branches.push(current);
    } else if (current) {
      current.body.push(c);
    }
  }
  const choices = (params[0] as string[]) ?? [];
  const rebuilt: EventCommand[] = [{ ...head, parameters: params }];
  choices.forEach((text, i) => {
    rebuilt.push({ code: Cmd.When, indent, parameters: [i, text] });
    rebuilt.push(...(branches.find((b) => b.key === i)?.body ?? [empty(indent + 1)]));
  });
  if (params[1] === -2) {
    rebuilt.push({ code: Cmd.WhenCancel, indent, parameters: [6, null] });
    rebuilt.push(...(branches.find((b) => b.key === 'cancel')?.body ?? [empty(indent + 1)]));
  }
  rebuilt.push({ code: Cmd.ChoicesEnd, indent, parameters: [] });
  list.splice(start, end - start, ...rebuilt);
}

/**
 * Checks the structure of a command list: every nested block is closed at
 * its own indentation and the list ends with an empty command at indent 0.
 * @returns `null` when valid, otherwise the index of the first problem.
 */
export function checkStructure(list: readonly EventCommand[]): number | null {
  if (list.length === 0 || list.at(-1)!.code !== Cmd.End || list.at(-1)!.indent !== 0) return list.length;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (i > 0 && c.indent > list[i - 1]!.indent + 1) return i;
    if (NESTED_BLOCKS[c.code] !== undefined) {
      const end = blockEnd(list, i);
      if (list[end - 1]?.code !== NESTED_BLOCKS[c.code]) return i;
    }
  }
  return null;
}
