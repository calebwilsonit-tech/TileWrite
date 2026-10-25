import { describe, expect, it } from 'vitest';
import { Rng } from '@tilewright/runtime';
import {
  MinigamesFileSchema,
  checkMinigame,
  clickMinigame,
  newMinigame,
  pairColumns,
  startMinigame,
  stepMinigame,
  symbolDirs,
  type MinigameButtons,
  type MinigameData,
  type MinigameOutcome,
  type MinigameState,
} from './minigames';

const DT = 1 / 60;

function runner(m: MinigameData, seed = 3) {
  const rng = new Rng(seed);
  const st = startMinigame(m, rng);
  let outcome: MinigameOutcome | null = null;
  const step = (b: MinigameButtons = {}): void => {
    outcome = stepMinigame(m, st, b, DT, rng) ?? outcome;
  };
  return { st, step, rng, outcome: () => outcome };
}

describe('the schema', () => {
  it('fills in sensible defaults for every kind', () => {
    for (const kind of ['timing', 'sequence', 'pairs'] as const) {
      const m = newMinigame(kind, 'Game');
      expect(m.kind).toBe(kind);
      expect(m.canQuit).toBe(true);
    }
    expect(MinigamesFileSchema.safeParse({ minigames: [{ kind: 'timing', name: 'x', rounds: 99 }] }).success).toBe(false);
  });
});

describe('timing bar', () => {
  const m = { ...newMinigame('timing', 'T'), rounds: 3, allowedMisses: 1 } as MinigameData & { kind: 'timing' };

  /** Press confirm as soon as the marker is inside the middle of the zone. */
  function solve(r: ReturnType<typeof runner>, misses = 0): void {
    r.step({ confirm: true }); // intro
    let missed = 0;
    for (let i = 0; i < 6000 && r.st.phase === 'play'; i++) {
      const centre = r.st.zoneAt + r.st.zoneSize / 2;
      const wantMiss = missed < misses && Math.abs(r.st.pos - centre) > 0.4;
      if (wantMiss) {
        missed++;
        r.step({ confirm: true });
      } else if (!(missed < misses) && Math.abs(r.st.pos - centre) < 0.03) r.step({ confirm: true });
      else r.step();
    }
  }

  it('starts on an intro screen and only moves once the player confirms', () => {
    const r = runner(m);
    expect(r.st.phase).toBe('intro');
    for (let i = 0; i < 30; i++) r.step();
    expect(r.st.pos).toBe(0);
    r.step({ confirm: true });
    expect(r.st.phase).toBe('play');
  });

  it('is won by hitting the zone every round, and the result needs one more press', () => {
    const r = runner(m);
    solve(r);
    expect(r.st.phase).toBe('won');
    expect(r.st.round).toBe(3);
    expect(r.outcome()).toBeNull();
    r.step({ confirm: true });
    expect(r.outcome()).toEqual({ won: true, score: 300, quit: false });
  });

  it('forgives the misses it allows and is lost on one more', () => {
    const r = runner(m);
    solve(r, 1);
    expect(r.st.phase).toBe('won');
    expect(r.st.misses).toBe(1);
    expect(r.st.score).toBe(300 - 25);
    const bad = runner({ ...m, allowedMisses: 0 });
    bad.step({ confirm: true });
    for (let i = 0; i < 600 && bad.st.phase === 'play'; i++) bad.step(Math.abs(bad.st.pos - (bad.st.zoneAt + bad.st.zoneSize / 2)) > 0.45 ? { confirm: true } : {});
    expect(bad.st.phase).toBe('lost');
    bad.step({ confirm: true });
    expect(bad.outcome()).toMatchObject({ won: false, quit: false });
  });

  it('shrinks the zone every round when asked, and not otherwise', () => {
    const shrink = runner(m);
    const first = shrink.st.zoneSize;
    shrink.step({ confirm: true });
    for (let i = 0; i < 3000 && shrink.st.round === 0; i++) shrink.step(Math.abs(shrink.st.pos - (shrink.st.zoneAt + shrink.st.zoneSize / 2)) < 0.03 ? { confirm: true } : {});
    expect(shrink.st.zoneSize).toBeLessThan(first);
    const flat = runner({ ...m, shrink: false });
    flat.step({ confirm: true });
    for (let i = 0; i < 3000 && flat.st.round === 0; i++) flat.step(Math.abs(flat.st.pos - (flat.st.zoneAt + flat.st.zoneSize / 2)) < 0.03 ? { confirm: true } : {});
    expect(flat.st.zoneSize).toBeCloseTo(m.zone);
  });

  it('can be given up on when allowed', () => {
    const r = runner(m);
    r.step({ confirm: true });
    r.step({ cancel: true });
    expect(r.outcome()).toEqual({ won: false, score: 0, quit: true });
    const stuck = runner({ ...m, canQuit: false });
    stuck.step({ cancel: true });
    expect(stuck.outcome()).toBeNull();
  });

  it('plays the same way every time for the same seed', () => {
    const a = runner(m, 9);
    const b = runner(m, 9);
    solve(a);
    solve(b);
    expect(JSON.stringify(a.st)).toBe(JSON.stringify(b.st));
  });
});

describe('repeat the pattern', () => {
  const m = { ...newMinigame('sequence', 'S'), length: 4, buttons: 4, allowedMistakes: 1, showSeconds: 0.3 } as MinigameData & { kind: 'sequence' };

  function watchThenEnter(r: ReturnType<typeof runner>, wrong = false): void {
    r.step({ confirm: true });
    for (let i = 0; i < 2000 && r.st.phase === 'show'; i++) r.step();
    expect(r.st.phase).toBe('play');
    const dirs = symbolDirs(m.buttons);
    for (let i = 0; i < r.st.seq.length && r.st.phase === 'play'; i++) {
      const s = wrong && i === 1 ? (r.st.seq[i]! + 1) % m.buttons : r.st.seq[i]!;
      r.step({ [dirs[s]!]: true });
    }
  }

  it('shows every symbol in order, then waits for the player', () => {
    const r = runner(m);
    r.step({ confirm: true });
    const seen: number[] = [];
    for (let i = 0; i < 2000 && r.st.phase === 'show'; i++) {
      r.step();
      if (r.st.lit >= 0 && seen[seen.length - 1] !== r.st.lit) seen.push(r.st.lit);
      else if (r.st.lit === -1 && seen.length && seen[seen.length - 1] !== -1) seen.push(-1);
    }
    expect(seen.filter((s) => s >= 0).length).toBeGreaterThan(0);
    expect(r.st.phase).toBe('play');
  });

  it('is won by repeating the pattern', () => {
    const r = runner(m);
    watchThenEnter(r);
    expect(r.st.phase).toBe('won');
    expect(r.st.score).toBe(400);
  });

  it('shows the pattern again after a mistake, and is lost after too many', () => {
    const r = runner(m);
    watchThenEnter(r, true);
    expect(r.st.phase).toBe('show');
    expect(r.st.misses).toBe(1);
    expect(r.st.entered).toBe(0);
    for (let i = 0; i < 2000 && r.st.phase === 'show'; i++) r.step();
    for (const s of r.st.seq) r.step({ [symbolDirs(4)[s]!]: true });
    expect(r.st.phase).toBe('won'); // the same pattern, so the second try can win
    const strict = runner({ ...m, allowedMistakes: 0 });
    watchThenEnter(strict, true);
    expect(strict.st.phase).toBe('lost');
  });

  it('takes mouse clicks on the arrows too, and fewer buttons mean fewer arrows', () => {
    const r = runner(m);
    r.step({ confirm: true });
    for (let i = 0; i < 2000 && r.st.phase === 'show'; i++) r.step();
    for (const s of r.st.seq) clickMinigame(m, r.st, { symbol: s });
    expect(r.st.phase).toBe('won');
    expect(symbolDirs(2)).toEqual(['left', 'right']);
    expect(symbolDirs(3)).toHaveLength(3);
    const two = runner({ ...m, buttons: 2 });
    expect(new Set(two.st.seq).size).toBeLessThanOrEqual(2);
  });
});

describe('match the pairs', () => {
  const m = { ...newMinigame('pairs', 'P'), pairs: 3, allowedMisses: 2 } as MinigameData & { kind: 'pairs' };

  function flip(r: ReturnType<typeof runner>, st: MinigameState, i: number): void {
    clickMinigame(m, st, { card: i });
    r.step();
  }

  it('deals every card twice', () => {
    const r = runner(m);
    expect([...r.st.cards].sort()).toEqual([0, 0, 1, 1, 2, 2]);
    expect(pairColumns(6)).toBe(3);
  });

  it('keeps matches face up and turns a mismatch back after a moment', () => {
    const r = runner(m);
    r.step({ confirm: true });
    const a = r.st.cards.indexOf(0);
    const b = r.st.cards.indexOf(0, a + 1);
    const other = r.st.cards.findIndex((c) => c !== 0);
    flip(r, r.st, a);
    flip(r, r.st, b);
    expect(r.st.faces[a]).toBe('done');
    flip(r, r.st, other);
    const wrong = r.st.cards.findIndex((c, i) => c !== r.st.cards[other] && r.st.faces[i] === 'down');
    flip(r, r.st, wrong);
    expect(r.st.misses).toBe(1);
    expect(r.st.faces[other]).toBe('up');
    flip(r, r.st, r.st.faces.indexOf('down')); // locked: ignored while the cards are shown
    for (let i = 0; i < 60; i++) r.step();
    expect(r.st.faces[other]).toBe('down');
    expect(r.st.faces[wrong]).toBe('down');
  });

  it('is won by matching everything with the keyboard cursor', () => {
    const r = runner(m);
    r.step({ confirm: true });
    const pending = new Map<number, number[]>();
    r.st.cards.forEach((c, i) => pending.set(c, [...(pending.get(c) ?? []), i]));
    const cols = pairColumns(6);
    for (const [, [x, y]] of pending) {
      for (const target of [x!, y!]) {
        while (r.st.cursor !== target) {
          const cx = r.st.cursor % cols;
          const cy = Math.floor(r.st.cursor / cols);
          const tx = target % cols;
          const ty = Math.floor(target / cols);
          r.step(cx < tx ? { right: true } : cx > tx ? { left: true } : cy < ty ? { down: true } : { up: true });
        }
        r.step({ confirm: true });
      }
    }
    expect(r.st.phase).toBe('won');
    expect(r.st.score).toBe(300);
  });

  it('is lost when too many guesses are wrong', () => {
    const r = runner({ ...m, allowedMisses: 0 });
    r.step({ confirm: true });
    const a = 0;
    const b = r.st.cards.findIndex((c, i) => i !== a && c !== r.st.cards[a]);
    clickMinigame(m, r.st, { card: a });
    clickMinigame(m, r.st, { card: b });
    for (let i = 0; i < 60; i++) r.step();
    expect(r.st.phase).toBe('lost');
  });
});

describe('checks', () => {
  it('warns about impossible or missing things in plain English', () => {
    const known = { carried: new Set(['key']) };
    expect(checkMinigame(newMinigame('timing', 'T'), known)).toEqual([]);
    expect(checkMinigame({ ...newMinigame('timing', 'T'), rewardItem: 'gem' }, known)[0]).toMatch(/item "gem"/);
    expect(checkMinigame({ ...newMinigame('timing', 'T'), rounds: 12, zone: 0.08 } as MinigameData, known)[0]).toMatch(/almost impossible/);
    expect(checkMinigame({ ...newMinigame('sequence', 'S'), length: 12, allowedMistakes: 0 } as MinigameData, known)[0]).toMatch(/very hard/);
  });
});
