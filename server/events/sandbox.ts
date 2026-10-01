/**
 * @file Sandbox for the "script" event command and script conditions.
 *
 * Scripts are written by administrators in the editor (the only place where
 * events can be authored) or come from imported projects, so they still run
 * isolated: each run gets a fresh context created with `node:vm` that
 * contains no host object at all, only a JSON copy of the player's state and
 * small helper functions defined inside the context. String code generation
 * (eval, Function) is disabled and the run is stopped after a few
 * milliseconds. A script cannot act directly: it returns a list of operations
 * (set a variable, a switch, a self switch, show a notification) that the
 * server validates and applies.
 *
 * The contexts live in a worker thread with a memory cap, not in the game's
 * thread: `vm` timeouts do not cover promise jobs (an endless `.then()` chain
 * would freeze the server) nor memory use. The game thread waits for the
 * answer synchronously, and a worker that runs late, still has work queued
 * after answering, or dies is terminated and replaced.
 *
 * Helpers available to scripts:
 *   v(id), setV(id, value)          variables
 *   s(id), setS(id, on)             switches
 *   self(letter), setSelf(letter, on)  self switches of the running event
 *   gold(), level(), item(id)       read-only player data
 *   player                          { name, mapId, x, y }
 *   notify(text)                    notification for the player
 */
import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';

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
/** Longest wait for the worker's answer (includes starting a new worker). */
const WAIT_MS = 2000;
/** Delay after which a worker still busy after answering is terminated. */
const IDLE_CHECK_MS = 200;
/** Wait for a worker finishing its previous run (it answers before going idle). */
const IDLE_WAIT_MS = 20;
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

/**
 * Code of the worker. `signal[0]` is set when an answer was posted, `signal[1]`
 * once the worker is idle again (its leftover promise jobs, if any, are done).
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const signal = new Int32Array(workerData.buffer);
const replies = workerData.port;
parentPort.on('message', (source) => {
  let out = null;
  try {
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    const result = new vm.Script(source).runInContext(context, { timeout: ${TIMEOUT_MS} });
    if (typeof result === 'string') out = result;
  } catch {}
  replies.postMessage(out);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
  setImmediate(() => {
    Atomics.store(signal, 1, 1);
    Atomics.notify(signal, 1);
  });
});
`;

interface SandboxWorker {
  worker: Worker;
  replies: MessagePort;
  signal: Int32Array;
}

let current: SandboxWorker | undefined;

function stop(w: SandboxWorker): void {
  if (current === w) current = undefined;
  w.replies.close();
  void w.worker.terminate();
}

function start(): SandboxWorker {
  const buffer = new SharedArrayBuffer(8);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { buffer, port: port2 },
    transferList: [port2],
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
  });
  const w: SandboxWorker = { worker, replies: port1, signal: new Int32Array(buffer) };
  Atomics.store(w.signal, 1, 1);
  // The worker never keeps the process alive; out of memory or a crash simply discards it.
  worker.unref();
  port1.unref();
  worker.on('error', () => stop(w));
  worker.on('exit', () => {
    if (current === w) current = undefined;
  });
  return w;
}

/** Runs a source in the worker and returns its JSON answer, or `null`. */
function execute(source: string): string | null {
  if (current && Atomics.wait(current.signal, 1, 0, IDLE_WAIT_MS) === 'timed-out') stop(current);
  const w = (current ??= start());
  Atomics.store(w.signal, 0, 0);
  Atomics.store(w.signal, 1, 0);
  w.worker.postMessage(source);
  Atomics.wait(w.signal, 0, 0, WAIT_MS);
  const reply = receiveMessageOnPort(w.replies);
  if (!reply) {
    stop(w);
    return null;
  }
  setTimeout(() => {
    if (current === w && Atomics.load(w.signal, 1) !== 1) stop(w);
  }, IDLE_CHECK_MS).unref();
  return typeof reply.message === 'string' ? reply.message : null;
}

function run(code: string, state: ScriptState, expression: boolean): { ops: ScriptOp[]; value: unknown } {
  if (code.length > MAX_CODE) return { ops: [], value: undefined };
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
    const out = execute(source);
    if (out === null) return { ops: [], value: undefined };
    const parsed = JSON.parse(out) as { ops: unknown[]; value: unknown };
    return { ops: parsed.ops.filter(isOp).slice(0, MAX_OPS), value: parsed.value };
  } catch {
    // Syntax errors, timeouts, malformed answers: the script does nothing.
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
