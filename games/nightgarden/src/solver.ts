import { litCells, type LightModel } from './light';
import { BLOOM_HEIGHT, BRAZIER_RANGE, LAMP_RANGE, groundLevel, type Room, type Thing } from './model';
import { groundText } from './scene';

/**
 * The rules of a Nightgarden room as a small state machine, and a search over it. What is lit is decided by the same
 * light rule the game's Room script runs (src/light.ts); every solution it finds is then played
 * button by button in the real game (see replay.ts), which is what proves a room can be finished.
 */

export type Dir = 'E' | 'W' | 'S' | 'N';
export const DIRS: Record<Dir, [number, number]> = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
export type Action = { kind: 'move'; dir: Dir } | { kind: 'push'; dir: Dir } | { kind: 'toggle'; dir: Dir };

export interface State {
  px: number;
  py: number;
  /** Cell index (y * w + x) of every pushable, in the room's order. */
  push: number[];
  /** Which hand lamps are lit. */
  lamps: boolean[];
  /** Which blooms are up. */
  grown: boolean[];
  /** Which channels are on. */
  chan: boolean[];
  /** Which gates are shut. */
  shut: boolean[];
  /** Which moonstones are sending. */
  stone: boolean[];
  fly: boolean;
}

export class Rules {
  readonly w: number;
  readonly h: number;
  readonly ground: string;
  readonly level: number[];
  readonly open: boolean[];
  readonly pushables: Thing[];
  readonly handLamps: Thing[];
  readonly otherLamps: Thing[];
  readonly blooms: Thing[];
  readonly plates: Thing[];
  readonly stones: Thing[];
  readonly gates: Thing[];
  readonly exit: Thing;
  readonly firefly: Thing | undefined;
  readonly player: Thing;
  private readonly lampAt = new Map<number, Thing>();
  private readonly bloomAt = new Map<number, number>();
  private readonly gateAt = new Map<number, number>();
  private readonly plateAt = new Map<number, number>();
  private readonly settled = new Map<string, Pick<State, 'grown' | 'chan' | 'shut' | 'stone'> | null>();

  constructor(readonly room: Room) {
    this.w = room.w;
    this.h = room.h;
    this.ground = groundText(room);
    this.level = [];
    this.open = [];
    for (let y = 0; y < room.h; y++) {
      for (let x = 0; x < room.w; x++) {
        const g = room.ground[y]![x]!;
        this.level.push(groundLevel(g));
        this.open.push(g === 'floor' || g === 'trench' || g === 'terrace');
      }
    }
    const of = (k: Thing['kind']): Thing[] => room.things.filter((t) => t.kind === k);
    this.pushables = room.things.filter((t) => t.kind === 'crate' || t.kind === 'brazier' || t.kind === 'screen');
    this.handLamps = of('lamp').filter((t) => t.mode === 'hand');
    this.otherLamps = of('lamp').filter((t) => t.mode !== 'hand');
    this.blooms = of('bloom');
    this.plates = of('plate');
    this.stones = of('stone');
    this.gates = of('gate');
    this.exit = of('exit')[0]!;
    this.firefly = of('firefly')[0];
    this.player = of('player')[0]!;
    for (const l of of('lamp')) this.lampAt.set(this.idx(l.x, l.y), l);
    this.blooms.forEach((b, i) => this.bloomAt.set(this.idx(b.x, b.y), i));
    this.gates.forEach((g, i) => this.gateAt.set(this.idx(g.x, g.y), i));
    this.plates.forEach((p, i) => this.plateAt.set(this.idx(p.x, p.y), i));
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  initial(): State {
    const s: State = {
      px: this.player.x,
      py: this.player.y,
      push: this.pushables.map((p) => this.idx(p.x, p.y)),
      lamps: this.handLamps.map((l) => l.flag === true),
      grown: this.blooms.map(() => false),
      chan: Array.from({ length: 10 }, () => false),
      shut: this.gates.map((g) => g.flag !== true),
      stone: this.stones.map(() => false),
      fly: false,
    };
    const out = this.settle(s);
    if (!out) throw new Error(`Room ${this.room.id}: the room does not come to rest at the start (lights and blooms keep changing each other).`);
    return out;
  }

  key(s: State): string {
    const bits = (b: boolean[]): string => b.map((v) => (v ? '1' : '0')).join('');
    return `${s.px},${s.py}|${s.push.join(',')}|${bits(s.lamps)}|${bits(s.grown)}|${bits(s.chan)}|${bits(s.shut)}|${bits(s.stone)}|${s.fly ? 1 : 0}`;
  }

  pushableAt(s: State, cell: number): number {
    return s.push.indexOf(cell);
  }

  /** The height of the highest thing to stand on in a cell. */
  top(s: State, x: number, y: number): number {
    const c = this.idx(x, y);
    const base = this.level[c]!;
    const p = this.pushableAt(s, c);
    if (p >= 0) return base + (this.pushables[p]!.kind === 'screen' ? 2 : 1);
    if (this.lampAt.has(c)) return base + 1;
    const g = this.gateAt.get(c);
    if (g !== undefined && s.shut[g]) return base + 2;
    const b = this.bloomAt.get(c);
    if (b !== undefined && s.grown[b]) return base + BLOOM_HEIGHT;
    return base;
  }

  playerHeight(s: State): number {
    return this.top(s, s.px, s.py);
  }

  /** Work out the lights, blooms, moonstones and gates until nothing changes. Null if they never come to rest. */
  settle(s: State): State | null {
    const pc = this.idx(s.px, s.py);
    const standingLow = this.pushableAt(s, pc) < 0; // on the ground of the cell (not on top of a crate)
    const special = standingLow && (this.plateAt.has(pc) || this.gateAt.has(pc)) ? pc : -1;
    const k = `${special}|${s.push.join(',')}|${s.lamps.map((v) => (v ? 1 : 0)).join('')}|${s.grown.map((v) => (v ? 1 : 0)).join('')}|${s.chan.map((v) => (v ? 1 : 0)).join('')}|${s.shut.map((v) => (v ? 1 : 0)).join('')}|${s.stone.map((v) => (v ? 1 : 0)).join('')}`;
    let r = this.settled.get(k);
    if (r === undefined) {
      r = this.settleNow(s, special);
      this.settled.set(k, r);
    }
    return r ? { ...s, grown: r.grown, chan: r.chan, shut: r.shut, stone: r.stone } : null;
  }

  private settleNow(s: State, special: number): Pick<State, 'grown' | 'chan' | 'shut' | 'stone'> | null {
    let grown = s.grown;
    let chan = s.chan;
    let shut = s.shut;
    let stoneOn = s.stone;
    const seen = new Set<string>();
    for (let round = 0; round < 40; round++) {
      // plates and moonstones feed the channels
      const nextChan = Array.from({ length: 10 }, () => false);
      this.plates.forEach((p) => {
        const c = this.idx(p.x, p.y);
        if (special === c || s.push.includes(c)) nextChan[p.channel!] = true;
      });
      this.stones.forEach((st, i) => {
        if (stoneOn[i]) nextChan[st.channel!] = true;
      });
      const nextShut = this.gates.map((g) => {
        const c = this.idx(g.x, g.y);
        const wantOpen = nextChan[g.channel!] !== (g.flag === true);
        return !wantOpen && special !== c && !s.push.includes(c);
      });
      const lit = this.litTest({ ...s, grown, chan: nextChan, shut: nextShut });
      const nextGrown = this.blooms.map((b) => (b.bloom === 'moonbloom') === lit(b.x, b.y, 0));
      const nextStone = this.stones.map((st) => lit(st.x, st.y, 0) !== (st.flag === true));
      const same = (a: boolean[], b: boolean[]): boolean => a.every((v, i) => v === b[i]);
      const done = same(grown, nextGrown) && same(chan, nextChan) && same(shut, nextShut) && same(stoneOn, nextStone);
      grown = nextGrown;
      chan = nextChan;
      shut = nextShut;
      stoneOn = nextStone;
      if (done) return { grown, chan, shut, stone: stoneOn };
      const sig = JSON.stringify([grown, chan, shut, stoneOn]);
      if (seen.has(sig)) return null; // going round in circles
      seen.add(sig);
    }
    return null;
  }

  /** A test "is this cell lit?" for a state, by the game's own light rule (src/light.ts). */
  litTest(s: State): (x: number, y: number, h: number) => boolean {
    const cells = this.litCells(s);
    return (x, y) => cells[this.idx(x, y)] === true;
  }

  /** Every lit cell of a state. */
  litCells(s: State): boolean[] {
    const tall: number[] = this.level.map(() => 0);
    this.pushables.forEach((p, i) => {
      if (p.kind === 'screen') tall[s.push[i]!] = 2;
    });
    this.gates.forEach((g, i) => {
      if (s.shut[i]) tall[this.idx(g.x, g.y)] = 2;
    });
    this.blooms.forEach((b, i) => {
      if (s.grown[i]) tall[this.idx(b.x, b.y)] = BLOOM_HEIGHT;
    });
    const lights: LightModel['lights'] = [];
    this.handLamps.forEach((l, i) => {
      if (s.lamps[i]) lights.push({ x: l.x, y: l.y, range: LAMP_RANGE });
    });
    for (const l of this.otherLamps) if (l.mode === 'fixed' || s.chan[l.channel!] !== (l.flag === true)) lights.push({ x: l.x, y: l.y, range: LAMP_RANGE });
    this.pushables.forEach((p, i) => {
      if (p.kind === 'brazier') lights.push({ x: s.push[i]! % this.w, y: Math.floor(s.push[i]! / this.w), range: BRAZIER_RANGE });
    });
    return litCells({ w: this.w, h: this.h, ground: this.ground, tall, lights });
  }

  /** What an action leads to, or null when it cannot be done. */
  apply(s: State, a: Action): State | null {
    const [dx, dy] = DIRS[a.dir];
    const bx = s.px + dx;
    const by = s.py + dy;
    if (!this.inside(bx, by)) return null;
    const b = this.idx(bx, by);
    const ph = this.playerHeight(s);
    if (a.kind === 'toggle') {
      const lamp = this.lampAt.get(b);
      const i = lamp ? this.handLamps.indexOf(lamp) : -1;
      if (i < 0 || Math.abs(ph - this.level[b]!) > 1.3) return null;
      const lamps = s.lamps.slice();
      lamps[i] = !lamps[i];
      return this.settle({ ...s, lamps });
    }
    if (!this.open[b]) return null;
    const p = this.pushableAt(s, b);
    if (a.kind === 'push') {
      if (p < 0 || ph !== this.level[b]) return null;
      const cx = bx + dx;
      const cy = by + dy;
      if (!this.inside(cx, cy)) return null;
      const c = this.idx(cx, cy);
      if (!this.open[c] || this.level[c] !== this.level[b]) return null;
      if (this.pushableAt(s, c) >= 0 || this.lampAt.has(c) || this.bloomAt.has(c)) return null;
      const g = this.gateAt.get(c);
      if (g !== undefined && s.shut[g]) return null;
      // the crate slides on and the gardener walks into the cell it left
      const push = s.push.slice();
      push[p] = c;
      const walked: State = { ...s, push, px: bx, py: by };
      const fl = this.firefly;
      if (fl && !s.fly && bx === fl.x && by === fl.y) walked.fly = true;
      return this.settle(walked);
    }
    // a move: onto anything whose top is not above the feet (dropping down is fine); a crate at foot level is pushed, not entered
    if (p >= 0 && ph === this.level[b]) return null;
    if (this.top(s, bx, by) > ph) return null;
    const moved: State = { ...s, px: bx, py: by };
    const f = this.firefly;
    if (f && !s.fly && bx === f.x && by === f.y && this.top(s, bx, by) === this.level[b]) moved.fly = true;
    return this.settle(moved);
  }

  won(s: State): boolean {
    return s.px === this.exit.x && s.py === this.exit.y && this.playerHeight(s) === this.level[this.idx(s.px, s.py)];
  }

  actions(): Action[] {
    const out: Action[] = [];
    for (const dir of Object.keys(DIRS) as Dir[]) out.push({ kind: 'move', dir }, { kind: 'push', dir }, { kind: 'toggle', dir });
    return out;
  }
}

export interface Solution {
  actions: Action[];
  /** How many different situations the search looked at. */
  states: number;
}

/** The shortest way to the way out (or, with `firefly`, the shortest way that catches the firefly first). Null if there is none. */
export function solve(rules: Rules, opts: { firefly?: boolean; maxStates?: number } = {}): Solution | null {
  const start = rules.initial();
  const acts = rules.actions();
  const from = new Map<string, { prev: string; a: Action } | null>([[rules.key(start), null]]);
  let frontier: State[] = [start];
  const max = opts.maxStates ?? 2_000_000;
  const goal = (s: State): boolean => rules.won(s) && (!opts.firefly || s.fly);
  const path = (k: string): Action[] => {
    const out: Action[] = [];
    for (let at = from.get(k); at; at = from.get(at.prev)) out.push(at.a);
    return out.reverse();
  };
  if (goal(start)) return { actions: [], states: 1 };
  while (frontier.length > 0) {
    const next: State[] = [];
    for (const s of frontier) {
      const k = rules.key(s);
      // the way out ends the room: nothing is done from it
      if (rules.won(s)) continue;
      for (const a of acts) {
        const t = rules.apply(s, a);
        if (!t) continue;
        const tk = rules.key(t);
        if (from.has(tk)) continue;
        from.set(tk, { prev: k, a });
        if (goal(t)) return { actions: path(tk), states: from.size };
        next.push(t);
      }
      if (from.size > max) throw new Error(`Room ${rules.room.id}: the search passed ${max} situations; the room is too open to check.`);
    }
    frontier = next;
  }
  return null;
}

/** Every cell the gardener can ever stand in, over everything that can be done in the room (bounded). */
export function reachableCells(rules: Rules, maxStates = 200_000): Set<number> {
  const start = rules.initial();
  const seen = new Set<string>([rules.key(start)]);
  const cells = new Set<number>([rules.idx(start.px, start.py)]);
  let frontier = [start];
  const acts = rules.actions();
  while (frontier.length > 0 && seen.size < maxStates) {
    const next: State[] = [];
    for (const s of frontier) {
      if (rules.won(s)) continue;
      for (const a of acts) {
        const t = rules.apply(s, a);
        if (!t) continue;
        const k = rules.key(t);
        if (seen.has(k)) continue;
        seen.add(k);
        cells.add(rules.idx(t.px, t.py));
        for (const c of t.push) cells.add(c);
        next.push(t);
      }
    }
    frontier = next;
  }
  return cells;
}

export function describe(actions: Action[]): string {
  return actions.map((a) => (a.kind === 'move' ? a.dir.toLowerCase() : a.kind === 'push' ? a.dir : `!${a.dir}`)).join(' ');
}
