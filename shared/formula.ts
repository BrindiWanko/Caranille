/**
 * @file Damage formulas of skills and items, such as `a.atk * 4 - b.def * 2`.
 *
 * Formulas are written by game creators, so they are never given to `eval`:
 * this module parses them into a small tree and evaluates the tree. Allowed:
 * numbers, `a.<stat>` (user) and `b.<stat>` (target) where stat is a
 * parameter (`mhp`, `mmp`, `atk`, `def`, `mat`, `mdf`, `agi`, `luk`), `hp`,
 * `mp` or `level`, `v[n]` (variables of the user when known), the operators
 * `+ - * / %`, comparisons, `&& || !`, `? :`, parentheses and the functions
 * `min max floor ceil round abs sqrt pow random` (also written `Math.min`...).
 * Compiled formulas are cached.
 */

/** Values a formula can read about a battler. */
export type FormulaBattler = Readonly<Record<string, number>>;

type Node =
  | { k: 'num'; v: number }
  | { k: 'stat'; who: 'a' | 'b'; name: string }
  | { k: 'var'; index: Node }
  | { k: 'unary'; op: string; arg: Node }
  | { k: 'binary'; op: string; left: Node; right: Node }
  | { k: 'cond'; test: Node; yes: Node; no: Node }
  | { k: 'call'; fn: string; args: Node[] };

const STATS = new Set(['mhp', 'mmp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk', 'hp', 'mp', 'level']);
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  sqrt: (x) => Math.sqrt(Math.max(0, x)),
  pow: (x, y) => Math.pow(x, Math.min(10, y)),
  random: () => Math.random(),
};
const MAX_LENGTH = 300;

/** Error raised for an invalid formula, with the position of the problem. */
export class FormulaError extends Error {
  constructor(readonly position: number) {
    super(`formula error at ${position}`);
  }
}

/** Tokenizer + recursive descent parser. */
class Parser {
  private readonly tokens: { t: string; pos: number }[] = [];
  private i = 0;

  constructor(source: string) {
    const re = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z_0-9]*|&&|\|\||[<>=!]=|[-+*/%()?:<>!.,[\]])/y;
    let pos = 0;
    while (pos < source.length) {
      re.lastIndex = pos;
      const m = re.exec(source);
      if (!m) {
        if (/^\s*$/.test(source.slice(pos))) break;
        throw new FormulaError(pos);
      }
      this.tokens.push({ t: m[1]!, pos: m.index + m[0].length - m[1]!.length });
      pos = re.lastIndex;
    }
  }

  private peek(): string | undefined {
    return this.tokens[this.i]?.t;
  }

  private next(): string {
    const tok = this.tokens[this.i++];
    if (!tok) throw new FormulaError(Number.MAX_SAFE_INTEGER);
    return tok.t;
  }

  private expect(t: string): void {
    const pos = this.tokens[this.i]?.pos ?? Number.MAX_SAFE_INTEGER;
    if (this.next() !== t) throw new FormulaError(pos);
  }

  parse(): Node {
    const node = this.ternary();
    if (this.i < this.tokens.length) throw new FormulaError(this.tokens[this.i]!.pos);
    return node;
  }

  private ternary(): Node {
    const test = this.binary(0);
    if (this.peek() !== '?') return test;
    this.next();
    const yes = this.ternary();
    this.expect(':');
    return { k: 'cond', test, yes, no: this.ternary() };
  }

  private static readonly LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

  private binary(level: number): Node {
    if (level >= Parser.LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    while (Parser.LEVELS[level]!.includes(this.peek() ?? '')) {
      const op = this.next();
      left = { k: 'binary', op, left, right: this.binary(level + 1) };
    }
    return left;
  }

  private unary(): Node {
    const t = this.peek();
    if (t === '-' || t === '+' || t === '!') {
      this.next();
      return { k: 'unary', op: t, arg: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const pos = this.tokens[this.i]?.pos ?? Number.MAX_SAFE_INTEGER;
    const t = this.next();
    if (/^\d/.test(t)) return { k: 'num', v: Number(t) };
    if (t === '(') {
      const node = this.ternary();
      this.expect(')');
      return node;
    }
    if (t === 'a' || t === 'b') {
      this.expect('.');
      const name = this.next();
      if (!STATS.has(name)) throw new FormulaError(pos);
      return { k: 'stat', who: t, name };
    }
    if (t === 'v') {
      this.expect('[');
      const index = this.ternary();
      this.expect(']');
      return { k: 'var', index };
    }
    let fn = t;
    if (fn === 'Math') {
      this.expect('.');
      fn = this.next();
    }
    if (fn in FUNCTIONS) {
      this.expect('(');
      const args: Node[] = [];
      if (this.peek() !== ')') {
        args.push(this.ternary());
        while (this.peek() === ',') {
          this.next();
          args.push(this.ternary());
        }
      }
      this.expect(')');
      return { k: 'call', fn, args };
    }
    throw new FormulaError(pos);
  }
}

function evaluate(n: Node, a: FormulaBattler, b: FormulaBattler, v: (id: number) => number): number {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'stat':
      return (n.who === 'a' ? a : b)[n.name] ?? 0;
    case 'var':
      return v(Math.trunc(evaluate(n.index, a, b, v)));
    case 'unary': {
      const x = evaluate(n.arg, a, b, v);
      return n.op === '-' ? -x : n.op === '!' ? Number(!x) : x;
    }
    case 'cond':
      return evaluate(n.test, a, b, v) ? evaluate(n.yes, a, b, v) : evaluate(n.no, a, b, v);
    case 'call':
      return FUNCTIONS[n.fn]!(...n.args.map((x) => evaluate(x, a, b, v)));
    case 'binary': {
      const l = evaluate(n.left, a, b, v);
      if (n.op === '&&') return l ? evaluate(n.right, a, b, v) : l;
      if (n.op === '||') return l ? l : evaluate(n.right, a, b, v);
      const r = evaluate(n.right, a, b, v);
      switch (n.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? 0 : l / r;
        case '%': return r === 0 ? 0 : l % r;
        case '<': return Number(l < r);
        case '>': return Number(l > r);
        case '<=': return Number(l <= r);
        case '>=': return Number(l >= r);
        case '==': return Number(l === r);
        default: return Number(l !== r);
      }
    }
  }
}

const cache = new Map<string, Node | FormulaError>();

/**
 * Checks a formula.
 * @returns `null` when valid, otherwise the position of the error.
 */
export function checkFormula(source: string): number | null {
  const compiled = compile(source);
  return compiled instanceof FormulaError ? compiled.position : null;
}

function compile(source: string): Node | FormulaError {
  let compiled = cache.get(source);
  if (!compiled) {
    try {
      if (source.length > MAX_LENGTH) throw new FormulaError(MAX_LENGTH);
      compiled = new Parser(source).parse();
    } catch (err) {
      compiled = err instanceof FormulaError ? err : new FormulaError(0);
    }
    if (cache.size > 2000) cache.clear();
    cache.set(source, compiled);
  }
  return compiled;
}

/**
 * Evaluates a formula; invalid formulas and non-finite results give 0.
 * @param source - Formula text.
 * @param a - User of the skill or item.
 * @param b - Target.
 * @param variables - Reads a variable of the user (`v[n]`).
 */
export function evalFormula(source: string, a: FormulaBattler, b: FormulaBattler, variables: (id: number) => number = () => 0): number {
  const compiled = compile(source);
  if (compiled instanceof FormulaError) return 0;
  const value = evaluate(compiled, a, b, variables);
  return Number.isFinite(value) ? value : 0;
}
