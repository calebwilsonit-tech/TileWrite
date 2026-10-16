import { cellWalkable, stepAllowed, type PrefabMap, type SceneData, type TileMap } from '@tilewright/runtime';
import { cellKey, fixedCells, prepare, solidCells, type LevelIssue } from './analysis';

/**
 * Crate puzzles ("Sokoban"): can the crates be pushed onto the plates, and can a push make that impossible
 * (a crate in a corner)? Searches every arrangement of the crates the player can bring about, so it is meant for
 * small rooms. The player only pushes (never pulls), one cell at a time, from behind.
 */

export interface PushPuzzle {
  map: TileMap;
  width: number;
  /** Cells nothing can ever enter (fixed scenery, closed gates). */
  blocked: Set<string>;
  crates: { id: string; name: string; x: number; y: number }[];
  /** Cells that need a crate on them. */
  targets: { x: number; y: number; id: string; name: string }[];
  player: { x: number; y: number };
}

export interface PushMove {
  /** Cell the crate is in before the push. */
  from: [number, number];
  dir: [number, number];
}

export interface PushResult {
  solvable: boolean;
  /** Pushes that solve it (shortest first found), when solvable. */
  moves: PushMove[];
  /** Arrangements the player can bring about. */
  states: number;
  /** The search stopped early, so "dead states" may be incomplete. */
  capped: boolean;
  /** Arrangements the player can reach from which the puzzle can no longer be solved. */
  deadStates: number;
  /** A push that leads into a dead arrangement (to show the designer), if any. */
  trap?: { crate: string; at: [number, number]; dir: [number, number] };
}

export function extractPushPuzzle(scene: SceneData, prefabs: PrefabMap = new Map()): PushPuzzle | null {
  const prep = prepare(scene, prefabs);
  if (!prep.player) return null;
  const crates = prep.entities.filter((e) => e.components.pushable !== undefined && e.components.transform !== undefined);
  const targets = prep.entities.filter((e) => {
    const p = e.components.pressurePlate as { activatedBy?: string } | undefined;
    return p !== undefined && (p.activatedBy === 'crates' || p.activatedBy === 'anyone');
  });
  if (crates.length === 0 || targets.length === 0) return null;
  const at = (e: { components: Record<string, unknown> }): { x: number; y: number } => {
    const t = e.components.transform as { x: number; y: number };
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  };
  const blocked = fixedCells(prep.entities);
  for (const c of solidCells(prep.entities.filter((e) => e.components.gate !== undefined), () => true)) blocked.add(c);
  const pt = prep.player.components.transform as { x: number; y: number };
  return {
    map: prep.map,
    width: prep.map.width,
    blocked,
    crates: crates.map((e) => ({ id: e.id, name: e.name, ...at(e) })),
    targets: targets.map((e) => ({ id: e.id, name: e.name, ...at(e) })),
    player: { x: Math.floor(pt.x), y: Math.floor(pt.y) },
  };
}

const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function solvePush(p: PushPuzzle, opts: { maxStates?: number } = {}): PushResult {
  const maxStates = opts.maxStates ?? 60000;
  const W = p.width;
  const H = p.map.height;
  const idx = (x: number, y: number): number => y * W + x;
  const free = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && cellWalkable(p.map, x, y) && !p.blocked.has(cellKey(x, y));
  const walk = new Map<number, [number, number][]>(); // neighbour cache: where the player can step from a cell
  const neighbours = (x: number, y: number): [number, number][] => {
    const k = idx(x, y);
    let n = walk.get(k);
    if (!n) {
      n = [];
      for (const [dx, dy] of DIRS) if (free(x + dx, y + dy) && stepAllowed(p.map, x, y, x + dx, y + dy, 0.35, 3)) n.push([x + dx, y + dy]);
      walk.set(k, n);
    }
    return n;
  };
  const slides = (x: number, y: number, dx: number, dy: number): boolean => free(x + dx, y + dy) && stepAllowed(p.map, x, y, x + dx, y + dy, 0.35, 0.4);

  const targets = p.targets.map((t) => idx(t.x, t.y));
  if (p.crates.length < new Set(targets).size) return { solvable: false, moves: [], states: 1, capped: false, deadStates: 0 };
  const isGoal = (crates: number[]): boolean => targets.every((t) => crates.includes(t));

  interface Node {
    crates: number[];
    player: number;
  }
  const flood = (crates: number[], from: number): Set<number> => {
    const taken = new Set(crates);
    const seen = new Set<number>([from]);
    const queue = [from];
    while (queue.length > 0) {
      const c = queue.pop()!;
      const x = c % W;
      const y = (c - x) / W;
      for (const [nx, ny] of neighbours(x, y)) {
        const k = idx(nx, ny);
        if (taken.has(k) || seen.has(k)) continue;
        seen.add(k);
        queue.push(k);
      }
    }
    return seen;
  };
  const keyOf = (n: Node): string => `${n.crates.join(',')}|${Math.min(...flood(n.crates, n.player))}`;

  const start: Node = { crates: p.crates.map((c) => idx(c.x, c.y)).sort((a, b) => a - b), player: idx(p.player.x, p.player.y) };
  const startKey = keyOf(start);
  const nodes = new Map<string, Node>([[startKey, start]]);
  const parent = new Map<string, { key: string; move: PushMove }>();
  const succ = new Map<string, string[]>();
  const queue = [startKey];
  const goals: string[] = [];
  let capped = false;
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head]!;
    const node = nodes.get(key)!;
    if (isGoal(node.crates)) goals.push(key);
    const reach = flood(node.crates, node.player);
    const out: string[] = [];
    for (let ci = 0; ci < node.crates.length; ci++) {
      const c = node.crates[ci]!;
      const cx = c % W;
      const cy = (c - cx) / W;
      for (const [dx, dy] of DIRS) {
        const behind = idx(cx - dx, cy - dy);
        if (!reach.has(behind)) continue;
        const ax = cx + dx;
        const ay = cy + dy;
        if (!slides(cx, cy, dx, dy) || node.crates.includes(idx(ax, ay))) continue;
        const crates = [...node.crates];
        crates[ci] = idx(ax, ay);
        crates.sort((a, b) => a - b);
        const next: Node = { crates, player: c };
        const nk = keyOf(next);
        out.push(nk);
        if (!nodes.has(nk)) {
          if (nodes.size >= maxStates) {
            capped = true;
            continue;
          }
          nodes.set(nk, next);
          parent.set(nk, { key, move: { from: [cx, cy], dir: [dx, dy] } });
          queue.push(nk);
        }
      }
    }
    succ.set(key, out);
  }

  const moves: PushMove[] = [];
  if (goals.length > 0) {
    for (let k = goals[0]!; k !== startKey; ) {
      const par = parent.get(k)!;
      moves.unshift(par.move);
      k = par.key;
    }
  }
  // arrangements that can still reach a goal (walk the edges backwards)
  const back = new Map<string, string[]>();
  for (const [from, tos] of succ) for (const to of tos) (back.get(to) ?? back.set(to, []).get(to)!).push(from);
  const alive = new Set<string>(goals);
  const stack = [...goals];
  while (stack.length > 0) {
    const k = stack.pop()!;
    for (const prev of back.get(k) ?? []) {
      if (alive.has(prev)) continue;
      alive.add(prev);
      stack.push(prev);
    }
  }
  const dead = [...nodes.keys()].filter((k) => !alive.has(k) && succ.has(k));
  let trap: PushResult['trap'];
  if (!capped && goals.length > 0) {
    // the first push (in search order) that walks from a live arrangement into a dead one
    for (const [from, tos] of succ) {
      if (!alive.has(from)) continue;
      const bad = tos.find((t) => !alive.has(t));
      if (bad === undefined) continue;
      const par = parent.get(bad);
      if (par) {
        const crateIdx = p.crates.findIndex((c) => idx(c.x, c.y) === idx(par.move.from[0], par.move.from[1]));
        trap = { crate: p.crates[crateIdx]?.name ?? 'a crate', at: par.move.from, dir: par.move.dir };
        break;
      }
    }
  }
  return { solvable: goals.length > 0, moves, states: nodes.size, capped, deadStates: capped ? 0 : dead.length, trap };
}

/** Problems with crate puzzles in a scene, in plain English. */
export function analysePushPuzzles(scene: SceneData, prefabs: PrefabMap = new Map()): LevelIssue[] {
  const p = extractPushPuzzle(scene, prefabs);
  if (!p) return [];
  const r = solvePush(p);
  const names = p.targets.map((t) => `"${t.name}"`).join(', ');
  if (!r.solvable && r.capped) return [{ id: 'push-too-big', severity: 'warning', message: `The crate puzzle is too big to check completely (it looked at ${r.states} arrangements without solving it).` }];
  if (!r.solvable) {
    return [{ id: 'push-unsolvable', severity: 'error', message: `The crate puzzle cannot be solved: the crates cannot all be pushed onto ${names} (walls, corners or too few crates).`, entity: p.targets[0]!.id }];
  }
  if (r.deadStates > 0 && r.trap) {
    return [
      {
        id: 'push-softlock',
        severity: 'warning',
        message: `The crate puzzle can be soft-locked: pushing ${r.trap.crate} from cell (${r.trap.at[0]}, ${r.trap.at[1]}) ${dirName(r.trap.dir)} leaves a position where it can never be solved. Give the player a way to recover (more room around the crates, or a reset lever).`,
        x: r.trap.at[0],
        y: r.trap.at[1],
      },
    ];
  }
  return [];
}

const dirName = (d: [number, number]): string => (d[0] === 1 ? 'east' : d[0] === -1 ? 'west' : d[1] === 1 ? 'south' : 'north');
