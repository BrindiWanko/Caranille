/**
 * @file Sandbox for the "script" event command and script conditions.
 *
 * Scripts are written by administrators in the editor (the only place where
 * events can be authored), and still run isolated: each run gets a fresh
 * context created with `node:vm` that contains no host object at all, only
 * a JSON copy of the player's state and small helper functions defined
 * inside the context. String code generation (eval, Function) is disabled
 * and the run is stopped after a few milliseconds. A script cannot act
 * directly: it returns a list of operations (set a variable, a switch, a
 * self switch, show a notification) that the server validates and applies.
 *
 * Helpers available to scripts:
 *   v(id), setV(id, value)          variables
 *   s(id), setS(id, on)             switches
 *   self(letter), setSelf(letter, on)  self switches of the running event
 *   gold(), level(), item(id)       read-only player data
 *   player                          { name, mapId, x, y }
 *   notify(text)                    notification for the player
 */
import vm from 'node:vm';

/** State exposed to a script (read-only copy). */
export interface ScriptState {
  variables: Record<number, number>;
  switches: Record<number, boolean>;
  selfSwitches: Record<string, boolean>;
  gold: number;
  level: number;
  items: Record<number, number>;
  player: { name: string; mapId: number; x: number; y: number };
}

/** An operation requested by a script. */
export type ScriptOp =
  | { op: 'variable'; id: number; value: number }
  | { op: 'switch'; id: number; value: boolean }
  | { op: 'self'; letter: 'A' | 'B' | 'C' | 'D'; value: boolean }
  | { op: 'notify'; text: string };

/** Time budget of one script run. */
const TIMEOUT_MS = 50;
/** Maximum operations and code size accepted. */
const MAX_OPS = 200;
const MAX_CODE = 20_000;

const PRELUDE = `
const __ops = [];
const __push = (o) => { if (__ops.length < ${MAX_OPS}) __ops.push(o); };
const __int = (n) => (Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0);
const v = (id) => __state.variables[__int(id)] ?? 0;
const setV = (id, value) => { __state.variables[__int(id)] = __int(value); __push({ op: 'variable', id: __int(id), value: __int(value) }); };
const s = (id) => __state.switches[__int(id)] === true;
const setS = (id, on) => { __state.switches[__int(id)] = !!on; __push({ op: 'switch', id: __int(id), value: !!on }); };
const self = (letter) => __state.selfSwitches[String(letter)] === true;
const setSelf = (letter, on) => { __state.selfSwitches[String(letter)] = !!on; __push({ op: 'self', letter: String(letter), value: !!on }); };
const gold = () => __state.gold;
const level = () => __state.level;
const item = (id) => __state.items[__int(id)] ?? 0;
const player = __state.player;
const notify = (text) => __push({ op: 'notify', text: String(text).slice(0, 200) });
`;

function run(code: string, state: ScriptState, expression: boolean): { ops: ScriptOp[]; value: unknown } {
  if (code.length > MAX_CODE) return { ops: [], value: undefined };
  const context = vm.createContext(Object.create(null) as object, { codeGeneration: { strings: false, wasm: false } });
  // The state enters the context as a JSON string parsed inside it: no host object is reachable.
  const body = expression ? `return (${code}\n);` : `${code}\n;return undefined;`;
  const source = `(() => {
const __state = JSON.parse(${JSON.stringify(JSON.stringify(state))});
${PRELUDE}
let __value;
try { __value = (() => { ${body} })(); } catch (e) { __value = undefined; }
return JSON.stringify({ ops: __ops, value: typeof __value === 'number' || typeof __value === 'boolean' ? __value : null });
})()`;
  try {
    const out = new vm.Script(source).runInContext(context, { timeout: TIMEOUT_MS });
    if (typeof out !== 'string') return { ops: [], value: undefined };
    const parsed = JSON.parse(out) as { ops: unknown[]; value: unknown };
    return { ops: parsed.ops.filter(isOp).slice(0, MAX_OPS), value: parsed.value };
  } catch {
    // Syntax errors, timeouts: the script does nothing.
    return { ops: [], value: undefined };
  }
}

function isOp(o: unknown): o is ScriptOp {
  const op = o as ScriptOp;
  if (typeof op !== 'object' || op === null) return false;
  if (op.op === 'variable') return Number.isInteger(op.id) && op.id > 0 && Number.isFinite(op.value);
  if (op.op === 'switch') return Number.isInteger(op.id) && op.id > 0 && typeof op.value === 'boolean';
  if (op.op === 'self') return ['A', 'B', 'C', 'D'].includes(op.letter) && typeof op.value === 'boolean';
  if (op.op === 'notify') return typeof op.text === 'string';
  return false;
}

/**
 * Runs a script and returns the operations it requested.
 * @param code - Script source.
 * @param state - Player state copy.
 */
export function runScript(code: string, state: ScriptState): ScriptOp[] {
  return run(code, state, false).ops;
}

/**
 * Evaluates an expression (script conditions and variable operands).
 * @param expression - Expression source.
 * @param state - Player state copy.
 * @returns A number or boolean, or `undefined` when invalid.
 */
export function evaluateScript(expression: string, state: ScriptState): number | boolean | undefined {
  const value = run(expression, state, true).value;
  return typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
}
