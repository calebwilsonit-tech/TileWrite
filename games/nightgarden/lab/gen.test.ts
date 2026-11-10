import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseRoom } from '../src/model';
import { Rules, describe, reachableCells, solve } from '../src/solver';

/**
 * A helper for designing rooms: it changes a room at random, keeps changes that make the shortest way out longer, and then
 * takes away everything the way out does not need. What it prints are drafts: rooms are chosen, tidied and named by hand
 * (src/rooms), and every room that ships is checked like any other.
 *
 *   NG_GEN="w=7,h=6,things=lbbLc,ground=#^,seed=3,iters=1500" npx vitest run ... lab/gen
 */
interface Opts { w: number; h: number; things: string; ground: string; seed: number; iters: number; runs: number; minLamps: number }

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Grid = string[][]; // tokens: ground + thing + channel

const rows = (g: Grid): string[] => g.map((r) => r.map((t) => t.padEnd(3)).join(' ').trimEnd());
const STAND = '.^~';

/** Things of one kind share a limit: lamps (l L), blooms (b d), and each other letter by itself. */
const CLASS = (t: string): string => (t === 'l' || t === 'L' ? 'lamp' : t === 'b' || t === 'd' ? 'bloom' : t);
function withinLimits(g: Grid, o: Opts): boolean {
  const limit = new Map<string, number>();
  for (const t of o.things) limit.set(CLASS(t), (limit.get(CLASS(t)) ?? 0) + 1);
  const have = new Map<string, number>();
  for (const tok of g.flat()) if (tok.length > 1 && tok[1] !== '@' && tok[1] !== 'E') have.set(CLASS(tok[1]!), (have.get(CLASS(tok[1]!)) ?? 0) + 1);
  for (const [k, n] of have) if (n > (limit.get(k) ?? 0)) return false;
  return true;
}

function score(g: Grid, o: Opts): { value: number; steps: number; lamps: number; pushes: number; states: number; sol: string } | null {
  if (!withinLimits(g, o)) return null;
  let rules: Rules;
  try {
    rules = new Rules(parseRoom({ id: 'gen', name: 'gen', rows: rows(g) }));
  } catch {
    return null;
  }
  let out: ReturnType<typeof solve>;
  try {
    out = solve(rules, { maxStates: 150_000 });
  } catch {
    return null;
  }
  if (!out) return null;
  const used = new Set(out.actions.map((a, i) => (a.kind === 'toggle' ? `${i}` : '')).filter(Boolean)).size;
  const pushes = out.actions.filter((a) => a.kind === 'push').length;
  const things = g.flat().filter((t) => t.length > 1 && t[1] !== '@' && t[1] !== 'E').length;
  if (used < o.minLamps) return { value: out.actions.length * 0.2, steps: out.actions.length, lamps: used, pushes, states: out.states, sol: describe(out.actions) };
  return { value: out.actions.length + Math.min(used, 6) * 2 + pushes * 1.5 - things * 0.4, steps: out.actions.length, lamps: used, pushes, states: out.states, sol: describe(out.actions) };
}

function mutate(g: Grid, o: Opts, r: () => number): Grid {
  const n = g.map((row) => row.slice());
  const cell = (): [number, number] => [Math.floor(r() * o.w), Math.floor(r() * o.h)];
  const pick = <T,>(a: readonly T[] | string): T => a[Math.floor(r() * a.length)] as T;
  const kind = r();
  const [x, y] = cell();
  const tok = n[y]![x]!;
  if (kind < 0.3) {
    // change the ground of a cell that has nothing on it
    if (tok.length === 1) n[y]![x] = pick<string>(`....${o.ground}`);
  } else if (kind < 0.55) {
    // put a thing on an empty cell, or take one away
    if (tok.length === 1 && STAND.includes(tok)) {
      const t = pick<string>(o.things);
      n[y]![x] = tok + t;
    } else if (tok.length > 1 && tok[1] !== '@' && tok[1] !== 'E') n[y]![x] = tok[0]!;
  } else {
    // move a thing (the gardener and the way out too) to an empty cell
    const [x2, y2] = cell();
    const to = n[y2]![x2]!;
    if (tok.length > 1 && to.length === 1 && STAND.includes(to)) {
      n[y2]![x2] = to + tok.slice(1);
      n[y]![x] = tok[0]!;
    }
  }
  return n;
}

/** Take away, one at a time, everything the shortest way out does not need (things first, then hedges become path). */
function prune(g: Grid, o: Opts): Grid {
  let cur = g;
  let base = score(cur, o);
  if (!base) return g;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < o.h; y++) {
      for (let x = 0; x < o.w; x++) {
        const tok = cur[y]![x]!;
        if (tok[1] === '@' || tok[1] === 'E' || tok === '.') continue;
        const n = cur.map((row) => row.slice());
        n[y]![x] = tok.length > 1 ? tok[0]! : '.'; // a thing is taken away; bare hedge, terrace or pond becomes path
        const s = score(n, o);
        if (s && s.steps >= base.steps && s.lamps >= base.lamps) {
          cur = n;
          base = s;
        }
      }
    }
  }
  return cur;
}

/** Ground nobody can ever stand on becomes nothing (it only made the room look bigger), unless it is a hedge that casts a needed shadow. */
function tidy(g: Grid, o: Opts): Grid {
  const base = score(g, o);
  if (!base) return g;
  const rules = new Rules(parseRoom({ id: 'gen', name: 'gen', rows: rows(g) }));
  const reach = reachableCells(rules);
  let cur = g.map((row) => row.slice());
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      const tok = cur[y]![x]!;
      if (reach.has(y * o.w + x) || tok.length > 1 || tok === '_') continue;
      const n = cur.map((row) => row.slice());
      n[y]![x] = '_';
      const s = score(n, o);
      if (s && s.steps === base.steps && s.sol === base.sol) cur = n;
    }
  }
  return cur;
}

it('search for room drafts', () => {
  const spec = process.env.NG_GEN;
  if (!spec) return;
  const kv = Object.fromEntries(spec.split(',').map((p) => p.split('=')));
  const o: Opts = { w: Number(kv.w ?? 7), h: Number(kv.h ?? 6), things: kv.things ?? 'lLbb', ground: kv.ground ?? '#^', seed: Number(kv.seed ?? 1), iters: Number(kv.iters ?? 1200), runs: Number(kv.runs ?? 4), minLamps: Number(kv.lamps ?? 2) };
  const out: string[] = [];
  for (let run = 0; run < o.runs; run++) {
    const r = rng(o.seed * 1000 + run);
    let g: Grid = Array.from({ length: o.h }, () => Array.from({ length: o.w }, () => '.'));
    g[Math.floor(r() * o.h)]![0] = '.@';
    g[Math.floor(r() * o.h)]![o.w - 1] = kv.exit === 'high' ? '^E' : '.E';
    let best = score(g, o);
    for (let i = 0; i < o.iters; i++) {
      let n = mutate(g, o, r);
      if (r() < 0.3) n = mutate(n, o, r);
      const s = score(n, o);
      if (s && (!best || s.value >= best.value)) {
        g = n;
        best = s;
      }
    }
    g = tidy(prune(g, o), o);
    best = score(g, o);
    out.push(`// run ${run}: ${best?.steps} steps, ${best?.lamps} lamps, ${best?.pushes} pushes, ${best?.states} states\n//   ${best?.sol}\n${rows(g).map((l) => `        '${l}',`).join('\n')}\n`);
  }
  const text = out.join('\n');
  fs.writeFileSync(path.join(__dirname, `gen-${o.seed}.txt`), text);
  process.stdout.write(text + '\n');
});
