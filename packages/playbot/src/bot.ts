import {
  C,
  InputRecorder,
  findPath,
  type ActionSnapshot,
  type Body,
  type Cell2,
  type Collider,
  type Entity,
  type InputRecording,
  type TransformIso,
} from '@tilewright/runtime';
import { healthOf } from '@tilewright/behaviors';
import { Game } from './game';
import type { PushMove } from './push-solver';

/** A bot sees the game only through the buttons it presses: no teleporting, no editing the world. */

export type ReportKind = 'reached' | 'stuck' | 'timeout' | 'blocked' | 'died';

export interface PlayReport {
  ok: boolean;
  kind: ReportKind;
  seconds: number;
  message: string;
  at?: { x: number; y: number };
}

export function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m${String(Math.round(seconds - m * 60)).padStart(2, '0')}s`;
}

const KEYS = {
  px: { move_right: 1, move_down: 1 },
  nx: { move_left: 1, move_up: 1 },
  py: { move_left: 1, move_down: 1 },
  ny: { move_right: 1, move_up: 1 },
} as const;

export interface WalkOptions {
  maxSeconds?: number;
  /** How close counts as there (cells). */
  arrive?: number;
  /** Words for the report ("the exit"). */
  label?: string;
  /** Hold the run button. */
  run?: boolean;
}

export class Bot {
  private readonly recorder = new InputRecorder();

  constructor(readonly game: Game) {}

  /** Everything the bot has pressed so far, as a recording (for saving a playthrough). */
  recording(): InputRecording {
    return this.recorder.finish();
  }

  /** The only way the bot acts: press these buttons for one tick. */
  step(actions: ActionSnapshot = {}): void {
    this.recorder.record(actions);
    this.game.step(actions);
  }

  wait(seconds: number): void {
    for (let i = 0; i < Math.round(seconds * 60); i++) this.step();
  }

  /** Press a button for a moment, then let go (so it counts as one press). */
  press(action: string, ticks = 1): void {
    for (let i = 0; i < ticks; i++) this.step({ [action]: 1 });
    this.step();
  }

  private pos(): { x: number; y: number } {
    return this.game.position;
  }

  /** Cells the bot must walk around (solid objects that are not people). */
  private obstacles(): Set<string> {
    const out = new Set<string>();
    for (const o of this.game.sim.world.query(C.Transform, C.Collider)) {
      if (o.has(C.Body)) continue;
      const c = o.require<Collider>(C.Collider);
      if (!c.solid || !c.enabled || c.trigger || c.height < 0.4) continue;
      const t = o.require<TransformIso>(C.Transform);
      for (let x = Math.floor(t.x - c.w / 2 + 0.05); x <= Math.floor(t.x + c.w / 2 - 0.05); x++) {
        for (let y = Math.floor(t.y - c.d / 2 + 0.05); y <= Math.floor(t.y + c.d / 2 - 0.05); y++) out.add(`${x},${y}`);
      }
    }
    return out;
  }

  /** Cells a text block is bridging right now (it is underlined): walkable even over a pit. */
  private bridges(): Set<string> {
    const out = new Set<string>();
    for (const o of this.game.sim.world.query('textBlock', C.Transform)) {
      if (!(o.get<{ underline?: boolean }>('label')?.underline ?? false)) continue;
      const t = o.require<TransformIso>(C.Transform);
      const c = o.get<Collider>(C.Collider);
      const w = c?.w ?? 2;
      const d = c?.d ?? 1;
      for (let x = Math.floor(t.x - w / 2 + 0.05); x <= Math.floor(t.x + w / 2 - 0.05); x++) for (let y = Math.floor(t.y - d / 2 + 0.05); y <= Math.floor(t.y + d / 2 - 0.05); y++) out.add(`${x},${y}`);
    }
    return out;
  }

  private plan(goal: { x: number; y: number }): Cell2[] | null {
    const map = this.game.sim.map;
    if (!map) return null;
    const body = this.game.player.get<Body>(C.Body);
    const obstacles = this.obstacles();
    const path = findPath(map, this.pos(), goal, { stepUp: body?.stepUp, maxDrop: 3, blocked: (x, y) => obstacles.has(`${x},${y}`), bridges: this.bridges(), maxNodes: 8000 });
    if (!path) return null;
    path[path.length - 1] = { x: goal.x, y: goal.y };
    return path;
  }

  /**
   * Walk to a spot using only the movement buttons. Plans around walls, pits and objects, notices when it is
   * not getting anywhere and replans, and gives up with a plain-English report.
   */
  walkTo(goal: { x: number; y: number }, opts: WalkOptions = {}): PlayReport {
    const label = opts.label ?? `(${goal.x.toFixed(1)}, ${goal.y.toFixed(1)})`;
    const arrive = opts.arrive ?? 0.25;
    const maxTicks = Math.round((opts.maxSeconds ?? 60) * 60);
    const start = this.game.sim.tick;
    const scene0 = this.game.scenePath;
    let path = this.plan(goal);
    if (!path) return { ok: false, kind: 'blocked', seconds: 0, message: `There is no way to walk to ${label} from here.` };
    let replanAt = start + 30;
    let checkTick = start;
    let checkPos = this.pos();
    let stuckChecks = 0;
    let recenter = false;
    const done = (kind: ReportKind, message: string, ok = false): PlayReport => ({ ok, kind, seconds: (this.game.sim.tick - start) / 60, message, at: { ...this.pos() } });
    while (this.game.sim.tick - start < maxTicks) {
      // a portal or a fast-travel took the player to another scene on the way: that counts as arriving
      if (this.game.scenePath !== scene0) return done('reached', `Went on to ${this.game.scenePath.replace(/^scenes\//, '').replace('.scene.json', '')} on the way to ${label}.`, true);
      const p = this.pos();
      if (Math.hypot(goal.x - p.x, goal.y - p.y) <= arrive) {
        this.step();
        return done('reached', `Reached ${label} in ${formatTime((this.game.sim.tick - start) / 60)}.`, true);
      }
      const hp = healthOf(this.game.player);
      if (hp?.dead) return done('died', `The player was defeated on the way to ${label}.`);
      if (this.game.sim.runtime.dialogue || this.game.sim.runtime.cutscene) {
        // a conversation or cutscene took the controls: let it play out by pressing the confirm button
        this.press('interact');
        continue;
      }
      if (this.game.sim.tick >= replanAt) {
        replanAt = this.game.sim.tick + 30;
        const again = this.plan(goal);
        if (!again) return done('blocked', `There is no way to walk to ${label} from here.`);
        path = again;
        if (recenter) {
          path.unshift({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });
          recenter = false;
        }
      }
      while (path.length > 1 && Math.hypot(path[0]!.x - p.x, path[0]!.y - p.y) < 0.14) path.shift();
      const wp = path[0]!;
      const dx = wp.x - p.x;
      const dy = wp.y - p.y;
      const snap: ActionSnapshot = {};
      // one axis at a time keeps the bot on the middle of cells, clear of corners
      if (Math.abs(dx) > 0.06 && Math.abs(dx) >= Math.abs(dy)) Object.assign(snap, dx > 0 ? KEYS.px : KEYS.nx);
      else if (Math.abs(dy) > 0.06) Object.assign(snap, dy > 0 ? KEYS.py : KEYS.ny);
      else if (Math.abs(dx) > 0.06) Object.assign(snap, dx > 0 ? KEYS.px : KEYS.nx);
      else if (path.length > 1) path.shift();      if (opts.run) snap.run = 1;
      this.step(snap);
      if (this.game.sim.tick - checkTick >= 45) {
        const moved = Math.hypot(p.x - checkPos.x, p.y - checkPos.y);
        if (moved < 0.1 && Object.keys(snap).length > 0) {
          stuckChecks++;
          if (stuckChecks >= 3) {
            const c = this.pos();
            return done('stuck', `Stuck at cell (${Math.floor(c.x)}, ${Math.floor(c.y)}) for ${((this.game.sim.tick - start) / 60).toFixed(0)} s while heading for ${label}.`);
          }
          replanAt = this.game.sim.tick;
          recenter = true; // wedged against a corner: step back to the middle of the cell, then carry on
        } else stuckChecks = 0;
        checkTick = this.game.sim.tick;
        checkPos = this.pos();
      }
    }
    return done('timeout', `Did not reach ${label} within ${formatTime(opts.maxSeconds ?? 60)}.`);
  }

  /**
   * Fight something with the quill and the movement buttons: walk up to it, swing when it is close, repeat until it is
   * defeated or gone. Gives up when the player is defeated or time runs out.
   */
  fight(ref: string, opts: WalkOptions = {}): PlayReport {
    const start = this.game.sim.tick;
    const maxTicks = Math.round((opts.maxSeconds ?? 90) * 60);
    const first = this.game.find(ref);
    const label = opts.label ?? (first ? `"${first.name}"` : ref);
    const done = (kind: ReportKind, message: string, ok = false): PlayReport => ({ ok, kind, seconds: (this.game.sim.tick - start) / 60, message, at: { ...this.pos() } });
    if (!first) return done('blocked', `There is nothing matching "${ref}" to fight.`);
    while (this.game.sim.tick - start < maxTicks) {
      const target = this.game.find(ref);
      if (!target || (healthOf(target)?.dead ?? false)) return done('reached', `Defeated ${label} in ${formatTime((this.game.sim.tick - start) / 60)}.`, true);
      if (healthOf(this.game.player)?.dead) return done('died', `The player was defeated fighting ${label}.`);
      if (this.game.sim.runtime.dialogue || this.game.sim.runtime.cutscene) {
        this.press('interact');
        continue;
      }
      const tt = target.require<TransformIso>(C.Transform);
      const me = this.pos();
      const dx = tt.x - me.x;
      const dy = tt.y - me.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        // far away: walk round whatever is in the way first
        const r = this.walkTo({ x: tt.x, y: tt.y }, { arrive: 3, maxSeconds: 4, label });
        if (!r.ok && r.kind !== 'timeout') return done(r.kind, r.message);
        continue;
      }
      const snap: ActionSnapshot = {};
      if (dist > 1.3) {
        // a direction on the map is a pair of screen keys
        const sx = (dx - dy) / 2;
        const sy = (dx + dy) / 2;
        if (sx > 0.25) snap.move_right = 1;
        if (sx < -0.25) snap.move_left = 1;
        if (sy > 0.25) snap.move_down = 1;
        if (sy < -0.25) snap.move_up = 1;
      }
      if (dist < 1.9 && (this.game.sim.tick - start) % 24 === 0) snap.attack = 1;
      this.step(snap);
    }
    return done('timeout', `Did not defeat ${label} within ${formatTime(opts.maxSeconds ?? 90)}.`);
  }

  /** Walk to an object (by reference) and stop close to it. */
  walkToEntity(ref: string, opts: WalkOptions = {}): PlayReport {
    const e = this.game.find(ref);
    if (!e) return { ok: false, kind: 'blocked', seconds: 0, message: `There is nothing matching "${ref}" to walk to.` };
    const t = e.require<TransformIso>(C.Transform);
    return this.walkTo({ x: t.x, y: t.y }, { label: `"${e.name}"`, ...opts });
  }

  /** Walk up to an object and press Interact. */
  interact(ref: string, opts: WalkOptions = {}): PlayReport {
    const r = this.walkToEntity(ref, { arrive: 1.0, ...opts });
    if (!r.ok) return r;
    this.press('interact');
    return r;
  }

  /** Get through whatever conversation is open: confirm lines, and pick choices with `choose` (default: the first). */
  talkThrough(choose: (options: string[]) => number = () => 0, maxSteps = 200): void {
    for (let i = 0; i < maxSteps && this.game.sim.runtime.dialogue; i++) {
      const d = this.game.sim.runtime.dialogue!;
      if (d.view.kind === 'choice') {
        const want = Math.max(0, Math.min(d.view.options.length - 1, choose(d.view.options.map((o) => o.text))));
        let moves = 0;
        while (this.game.sim.runtime.dialogue?.selected !== want && moves++ < 10) {
          this.press(this.game.sim.runtime.dialogue!.selected < want ? 'move_down' : 'move_up');
        }
      }
      this.press('interact');
    }
  }

  /** Stand on a spot for a while (holding a pressure plate down). */
  standOn(ref: string, seconds = 0.5, opts: WalkOptions = {}): PlayReport {
    const r = this.walkToEntity(ref, { arrive: 0.12, ...opts });
    if (r.ok) this.wait(seconds);
    return r;
  }

  /** Push a crate one cell: walk behind it, then walk into it. */
  pushCrate(crate: Entity, dir: [number, number], opts: WalkOptions = {}): PlayReport {
    const t = crate.require<TransformIso>(C.Transform);
    const behind = { x: Math.floor(t.x) + 0.5 - dir[0], y: Math.floor(t.y) + 0.5 - dir[1] };
    const r = this.walkTo(behind, { arrive: 0.1, label: 'the spot behind the crate', ...opts });
    if (!r.ok) return r;
    const goal = { x: t.x + dir[0], y: t.y + dir[1] };
    const key = dir[0] === 1 ? KEYS.px : dir[0] === -1 ? KEYS.nx : dir[1] === 1 ? KEYS.py : KEYS.ny;
    for (let i = 0; i < 180; i++) {
      const now = crate.require<TransformIso>(C.Transform);
      if (Math.hypot(now.x - goal.x, now.y - goal.y) < 0.02) break;
      this.step(key);
    }
    this.wait(0.15);
    const end = crate.require<TransformIso>(C.Transform);
    return Math.hypot(end.x - goal.x, end.y - goal.y) < 0.1
      ? { ok: true, kind: 'reached', seconds: 0, message: `Pushed ${crate.name} one cell.` }
      : { ok: false, kind: 'stuck', seconds: 0, message: `${crate.name} would not move that way.`, at: { x: end.x, y: end.y } };
  }

  /** Carry out the pushes a solver found, one at a time, with the buttons. */
  executePushes(moves: readonly PushMove[]): PlayReport {
    for (const m of moves) {
      const crate = this.game.sim.world.query('pushable').find((c) => {
        const t = c.require<TransformIso>(C.Transform);
        return Math.floor(t.x) === m.from[0] && Math.floor(t.y) === m.from[1];
      });
      if (!crate) return { ok: false, kind: 'blocked', seconds: 0, message: `There is no crate at cell (${m.from[0]}, ${m.from[1]}) to push.` };
      const r = this.pushCrate(crate, m.dir);
      if (!r.ok) return r;
    }
    return { ok: true, kind: 'reached', seconds: this.game.seconds, message: `Pushed the crates into place in ${formatTime(this.game.seconds)}.` };
  }

  /**
   * Hold several plates down with echoes: record an echo walking to each plate in turn (all but the last), then
   * stand on the last plate yourself. Needs an Echo Recorder with room for one echo fewer than there are plates.
   */
  holdPlatesWithEchoes(plateRefs: readonly string[]): PlayReport {
    for (let i = 0; i < plateRefs.length - 1; i++) {
      this.press('echo'); // start recording
      const r = this.walkToEntity(plateRefs[i]!, { arrive: 0.12 });
      if (!r.ok) return r;
      this.wait(0.2);
      this.press('echo'); // stop: the echo takes over this plate
    }
    const last = this.standOn(plateRefs[plateRefs.length - 1]!, 0.6);
    return last.ok ? { ...last, message: `Held ${plateRefs.length} plates (${plateRefs.length - 1} with echoes) in ${formatTime(this.game.seconds)}.` } : last;
  }

  /**
   * Try to get to a goal the way a player would: walk there; if that does not work, use the nearest switch
   * (stand on a plate, flip a lever) and try again, until it works or there is nothing left to try.
   */
  solveToGoal(goalRef: string, opts: WalkOptions = {}): PlayReport {
    const goal = this.game.find(goalRef);
    const label = opts.label ?? (goal ? `"${goal.name}"` : goalRef);
    const used: string[] = [];
    const start = this.game.sim.tick;
    let r = this.walkToEntity(goalRef, { ...opts, label });
    const tried = new Set<number>();
    for (let attempt = 0; attempt < 10 && !r.ok && r.kind !== 'died'; attempt++) {
      const me = this.pos();
      const next = this.game.sim.world
        .all()
        .filter((e) => (e.has('pressurePlate') || e.has('lever')) && !tried.has(e.id))
        .sort((a, b) => {
          const ta = a.require<TransformIso>(C.Transform);
          const tb = b.require<TransformIso>(C.Transform);
          return Math.hypot(ta.x - me.x, ta.y - me.y) - Math.hypot(tb.x - me.x, tb.y - me.y);
        })[0];
      if (!next) break;
      tried.add(next.id);
      const ref = `id:${next.get<{ sceneId: string }>('meta')?.sceneId ?? ''}`;
      const used1 = next.has('pressurePlate') ? this.standOn(ref, 0.6) : this.interact(ref);
      if (!used1.ok) continue; // could not even get to it: try the next one
      used.push(`"${next.name}"`);
      r = this.walkToEntity(goalRef, { ...opts, label });
    }
    const seconds = (this.game.sim.tick - start) / 60;
    if (r.ok) return { ...r, seconds, message: used.length ? `Reached ${label} in ${formatTime(seconds)} after using ${used.join(' and ')}.` : r.message };
    return { ...r, message: `${r.message} Switches tried: ${used.join(', ') || 'none'}.` };
  }
}
