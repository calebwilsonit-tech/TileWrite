import type { VariableValue } from '../project/schema';
import { fillValues, resolveValue, type ValueSource } from './values';

/**
 * Small arithmetic for values typed into event rows and the UI: `{gold} - {Buildings.house.cost}`, `({a} + 2) * 3`,
 * `min({hp}, 10)`. Numbers, + - * / %, brackets, unary minus and the functions min, max, floor, ceil, round, abs, sqrt. No
 * variables of its own and nothing that can run code: names are filled in first, then the result is worked out.
 */

type Token = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'id'; v: string };

function tokenize(s: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) i++;
    else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j]!)) j++;
      const n = Number(s.slice(i, j));
      if (!Number.isFinite(n)) return null;
      out.push({ t: 'num', v: n });
      i = j;
    } else if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z]/.test(s[j]!)) j++;
      out.push({ t: 'id', v: s.slice(i, j) });
      i = j;
    } else if ('+-*/%(),'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
    } else return null;
  }
  return out;
}

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  sqrt: Math.sqrt,
};

/** The value of an arithmetic expression, or null when the text is not one. */
export function evalExpression(text: string): number | null {
  const found = tokenize(text);
  if (!found || found.length === 0) return null;
  const tokens: Token[] = found;
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (v: string): boolean => {
    const t = peek();
    return t?.t === 'op' && t.v === v;
  };
  let failed = false;
  const fail = (): number => {
    failed = true;
    return 0;
  };
  const primary = (): number => {
    const t = tokens[pos++];
    if (!t) return fail();
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') {
      const v = sum();
      if (!isOp(')')) return fail();
      pos++;
      return v;
    }
    if (t.t === 'op' && t.v === '-') return -unary();
    if (t.t === 'op' && t.v === '+') return unary();
    if (t.t === 'id') {
      const fn = FUNCTIONS[t.v];
      if (!fn || !isOp('(')) return fail();
      pos++;
      const args: number[] = [];
      if (!isOp(')')) {
        args.push(sum());
        while (isOp(',')) {
          pos++;
          args.push(sum());
        }
      }
      if (!isOp(')')) return fail();
      pos++;
      return fn(...args);
    }
    return fail();
  };
  const unary = (): number => primary();
  const product = (): number => {
    let v = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (tokens[pos++] as { v: string }).v;
      const r = unary();
      v = op === '*' ? v * r : op === '/' ? (r === 0 ? 0 : v / r) : r === 0 ? 0 : v % r;
    }
    return v;
  };
  function sum(): number {
    let v = product();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { v: string }).v;
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const result = sum();
  if (failed || pos !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}

/**
 * What a typed value means: a number, true/false, or text. Names in `{braces}` are filled in from variables, table cells and
 * object fields; text that is then plain arithmetic is worked out (`{gold} - 5`).
 */
export function evalValue(src: ValueSource, raw: string): VariableValue {
  const whole = /^\{([^{}]+)\}$/.exec(raw.trim());
  if (whole) {
    const v = resolveValue(src, whole[1]!.trim());
    if (v !== undefined) return v;
  }
  const filled = raw.includes('{') ? fillValues(raw, src) : raw;
  if (filled !== '' && !Number.isNaN(Number(filled))) return Number(filled);
  if (filled === 'true') return true;
  if (filled === 'false') return false;
  if (/[-+*/%(]/.test(filled.trim().slice(1)) || /^[A-Za-z]+\(/.test(filled.trim())) {
    const n = evalExpression(filled);
    if (n !== null) return n;
  }
  return filled;
}
