import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, type Assets, type Rng, type VariableValue } from '@tilewright/plugin-sdk'; // (loading the runtime sets up Zod before the schemas below are built)
import type { DataKindDef, DataKnown } from '@tilewright/plugin-sdk';

/**
 * Minigames: small games inside the game (stop the marker in the zone, repeat the pattern, match the pairs).
 * Plain data in `assets/minigames.json`; each is a state machine that is stepped by the buttons a player has, so
 * it replays, saves its result in ordinary variables and can be played by the playbot. What happened is written to
 * variables: `minigame:<name>:won`, `:played` and `:best`, plus the variables the minigame names itself.
 */

const common = {
  name: z.string().min(1),
  /** Heading on the screen ('' = the name). */
  title: z.string().default(''),
  /** What the player has to do ('' = a standard line for the kind). */
  instructions: z.string().default(''),
  /** Set to true when the player wins ('' = none). */
  winVariable: z.string().default(''),
  /** Set to the score after every play ('' = none). */
  scoreVariable: z.string().default(''),
  /** An item given the first time the player wins ('' = none). */
  rewardItem: z.string().default(''),
  rewardAmount: z.number().int().min(1).default(1),
  /** The player may give up with Esc / P. */
  canQuit: z.boolean().default(true),
};

export const MinigameSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('timing'),
    /** Hits needed in a row of zones. */
    rounds: z.number().int().min(1).max(12).default(3),
    /** Width of the zone, as a fraction of the bar. */
    zone: z.number().min(0.05).max(0.6).default(0.22),
    /** How fast the marker sweeps (1 = a sweep in about a second). */
    speed: z.number().min(0.2).max(4).default(1),
    /** The zone gets narrower every round. */
    shrink: z.boolean().default(true),
    /** Misses allowed before the player loses. */
    allowedMisses: z.number().int().min(0).max(9).default(1),
  }),
  z.object({
    ...common,
    kind: z.literal('sequence'),
    /** How many symbols to remember. */
    length: z.number().int().min(2).max(14).default(4),
    /** How many different symbols (2 = left/right, 3 adds up, 4 adds down). */
    buttons: z.number().int().min(2).max(4).default(4),
    /** Seconds each symbol is shown. */
    showSeconds: z.number().min(0.15).max(2).default(0.6),
    allowedMistakes: z.number().int().min(0).max(9).default(1),
  }),
  z.object({
    ...common,
    kind: z.literal('pairs'),
    pairs: z.number().int().min(2).max(10).default(4),
    allowedMisses: z.number().int().min(0).max(40).default(8),
  }),
]);
export type MinigameData = z.infer<typeof MinigameSchema>;
export type MinigameKind = MinigameData['kind'];

export const MinigamesFileSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  minigames: z.array(MinigameSchema).default([]),
});

export const MINIGAME_KINDS: { kind: MinigameKind; label: string; blurb: string }[] = [
  { kind: 'timing', label: 'Timing bar', blurb: 'A marker sweeps along a bar; press the button while it is inside the zone.' },
  { kind: 'sequence', label: 'Repeat the pattern', blurb: 'A pattern of arrows is shown; repeat it from memory.' },
  { kind: 'pairs', label: 'Match the pairs', blurb: 'Flip cards two at a time and find all the matching pairs.' },
];

export function newMinigame(kind: MinigameKind, name: string): MinigameData {
  return MinigameSchema.parse({ kind, name });
}

export function defaultInstructions(kind: MinigameKind): string {
  switch (kind) {
    case 'timing':
      return 'Press E when the marker is inside the bright zone.';
    case 'sequence':
      return 'Watch the arrows, then press them in the same order.';
    case 'pairs':
      return 'Move with the arrows and press E to flip a card. Find every matching pair.';
  }
}

/** Every minigame the project defines, by name (what the running game reads). */
export function minigamesOf(assets: Pick<Assets, 'data'>): ReadonlyMap<string, MinigameData> {
  return (assets.data.get('minigames') ?? new Map()) as ReadonlyMap<string, MinigameData>;
}

/** The minigame that is open over the game, if any (the game is frozen while it is). */
export function openMinigame(runtime: { modals: Record<string, unknown> }): MinigameState | null {
  return (runtime.modals.minigame as MinigameState | undefined) ?? null;
}

/** Open a minigame over the game, or (with null) close it. */
export function setMinigame(runtime: { modals: Record<string, unknown> }, state: MinigameState | null): void {
  if (state) runtime.modals.minigame = state;
  else delete runtime.modals.minigame;
}

/** Problems with a minigame, in plain English. `carried` are the names of everything the player can be given. */
export function checkMinigame(m: MinigameData, known: { carried: ReadonlySet<string> }): string[] {
  const out: string[] = [];
  if (m.rewardItem !== '' && !known.carried.has(m.rewardItem)) out.push(`The minigame "${m.name}" rewards the item "${m.rewardItem}", which is not in the item list.`);
  if (m.kind === 'timing' && m.zone * (m.shrink ? 1 - 0.12 * (m.rounds - 1) : 1) < 0.07) out.push(`The minigame "${m.name}" shrinks its zone so much by the last round that it is almost impossible to hit. Use a wider zone or fewer rounds.`);
  if (m.kind === 'timing' && m.speed >= 3 && m.zone < 0.1) out.push(`The minigame "${m.name}" has a very fast marker and a very narrow zone; most players will never win it.`);
  if (m.kind === 'sequence' && m.length > 9 && m.allowedMistakes === 0) out.push(`The minigame "${m.name}" has ${m.length} symbols and no allowed mistakes; this is very hard to win.`);
  return out;
}

/** The project's minigames as a kind of data: their file, their checks, the words in them. The editor adds the tab that edits them. */
export const minigamesKind: DataKindDef = {
  id: 'minigames',
  label: 'Minigames',
  blurb: 'Small games inside your game. Give an object the Minigame behaviour (or use the "Play a minigame" action) to let the player play one. Winning sets a flag, can give an item once, and the "A minigame has been won" condition lets event rows react.',
  file: 'assets/minigames.json',
  listKey: 'minigames',
  noun: 'minigame',
  keyName: 'name',
  schema: MinigameSchema,
  keyOf: (m: MinigameData) => m.name,
  create: (existing: readonly MinigameData[]) => {
    let n = existing.length + 1;
    while (existing.some((m) => m.name === `Game ${n}`)) n++;
    return newMinigame('timing', `Game ${n}`);
  },
  check: (records: readonly MinigameData[], known: DataKnown) => records.flatMap((m) => checkMinigame(m, known)),
  texts: (m: MinigameData) => [m.title || m.name, m.instructions || defaultInstructions(m.kind)].map((text) => ({ text, where: `Minigame ${m.name}` })),
  assistant: { description: `Replace the project's whole list of minigames (start from story_overview and send everything back, changed). A minigame has a name, a kind and settings: "timing" {rounds, zone, speed, shrink, allowedMisses}, "sequence" {length, buttons (2-4), showSeconds, allowedMistakes} or "pairs" {pairs, allowedMisses}; all kinds can have title, instructions, winVariable, scoreVariable, rewardItem (an item id, given for the first win) and canQuit. Players reach one through an object with the minigameStation behaviour (settings {"minigame": "<name>"}) or the playMinigame action.` },
};

// ---------- state ----------

export type MinigamePhase = 'intro' | 'show' | 'play' | 'won' | 'lost';

/** Everything a minigame in progress remembers. Plain data (it is part of the state hash). */
export interface MinigameState {
  name: string;
  kind: MinigameKind;
  phase: MinigamePhase;
  /** Seconds in the current phase. */
  t: number;
  score: number;
  misses: number;
  // timing bar
  pos: number;
  dir: 1 | -1;
  zoneAt: number;
  zoneSize: number;
  round: number;
  /** 'hit' or 'miss' for a moment after pressing. */
  flash: '' | 'hit' | 'miss';
  flashT: number;
  // repeat the pattern
  seq: number[];
  /** The symbol lit while the pattern is shown (-1 = none). */
  lit: number;
  entered: number;
  // match the pairs
  cards: number[];
  faces: ('down' | 'up' | 'done')[];
  cursor: number;
  open: number[];
  lock: number;
}

/** What the player pressed this tick (a press, not a hold). */
export interface MinigameButtons {
  left?: boolean;
  right?: boolean;
  up?: boolean;
  down?: boolean;
  confirm?: boolean;
  cancel?: boolean;
}

/** How a minigame ended, once the player has seen the result. */
export interface MinigameOutcome {
  won: boolean;
  score: number;
  quit: boolean;
}

/** The directions that stand for each symbol. */
export function symbolDirs(buttons: number): ('up' | 'right' | 'down' | 'left')[] {
  if (buttons <= 2) return ['left', 'right'];
  if (buttons === 3) return ['left', 'up', 'right'];
  return ['up', 'right', 'down', 'left'];
}

/** Columns of the card table. */
export function pairColumns(cards: number): number {
  return Math.max(2, Math.min(4, Math.ceil(cards / 2)));
}

export function startMinigame(m: MinigameData, rng: Rng): MinigameState {
  const st: MinigameState = {
    name: m.name,
    kind: m.kind,
    phase: 'intro',
    t: 0,
    score: 0,
    misses: 0,
    pos: 0,
    dir: 1,
    zoneAt: 0.4,
    zoneSize: 0.2,
    round: 0,
    flash: '',
    flashT: 0,
    seq: [],
    lit: -1,
    entered: 0,
    cards: [],
    faces: [],
    cursor: 0,
    open: [],
    lock: 0,
  };
  if (m.kind === 'timing') newZone(m, st, rng);
  if (m.kind === 'sequence') for (let i = 0; i < m.length; i++) st.seq.push(rng.int(0, m.buttons - 1));
  if (m.kind === 'pairs') {
    for (let i = 0; i < m.pairs; i++) st.cards.push(i, i);
    for (let i = st.cards.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [st.cards[i], st.cards[j]] = [st.cards[j]!, st.cards[i]!];
    }
    st.faces = st.cards.map(() => 'down');
  }
  return st;
}

function newZone(m: MinigameData & { kind: 'timing' }, st: MinigameState, rng: Rng): void {
  const size = m.shrink ? Math.max(0.06, m.zone * (1 - 0.12 * st.round)) : m.zone;
  st.zoneSize = size;
  st.zoneAt = rng.range(0.08, 0.92 - size);
}

const SHOW_GAP = 0.25;

function finish(m: MinigameData, st: MinigameState, won: boolean): void {
  st.phase = won ? 'won' : 'lost';
  st.t = 0;
  st.lit = -1;
  switch (m.kind) {
    case 'timing':
      st.score = Math.max(0, st.round * 100 - st.misses * 25);
      break;
    case 'sequence':
      st.score = Math.max(0, (won ? m.length : st.entered) * 100 - st.misses * 50);
      break;
    case 'pairs':
      st.score = Math.max(0, st.faces.filter((f) => f === 'done').length * 50 - st.misses * 10);
      break;
  }
}

/** Press a symbol of the pattern game (also what clicking an arrow does). */
function pressSymbol(m: MinigameData & { kind: 'sequence' }, st: MinigameState, symbol: number): void {
  if (st.phase !== 'play') return;
  st.lit = symbol;
  st.flashT = 0.15;
  if (symbol === st.seq[st.entered]) {
    st.entered++;
    if (st.entered >= st.seq.length) finish(m, st, true);
    return;
  }
  st.misses++;
  if (st.misses > m.allowedMistakes) {
    finish(m, st, false);
    return;
  }
  st.entered = 0;
  st.phase = 'show';
  st.t = 0;
}

/** Flip a card (also what clicking one does). */
function flipCard(m: MinigameData & { kind: 'pairs' }, st: MinigameState, index: number): void {
  if (st.phase !== 'play' || st.lock > 0 || st.faces[index] !== 'down') return;
  st.faces[index] = 'up';
  st.open.push(index);
  if (st.open.length < 2) return;
  const [a, b] = st.open as [number, number];
  if (st.cards[a] === st.cards[b]) {
    st.faces[a] = st.faces[b] = 'done';
    st.open = [];
    if (st.faces.every((f) => f === 'done')) finish(m, st, true);
  } else {
    st.misses++;
    st.lock = 0.8;
  }
}

/** A mouse click on part of the screen: an arrow of the pattern game, or a card. */
export function clickMinigame(m: MinigameData, st: MinigameState, target: { symbol?: number; card?: number }): void {
  if (m.kind === 'sequence' && target.symbol !== undefined) pressSymbol(m, st, target.symbol);
  if (m.kind === 'pairs' && target.card !== undefined) {
    st.cursor = target.card;
    flipCard(m, st, target.card);
  }
}

/**
 * One fixed step. Returns the outcome once the player has dismissed the result (or gave up); until then null.
 */
export function stepMinigame(m: MinigameData, st: MinigameState, b: MinigameButtons, dt: number, rng: Rng): MinigameOutcome | null {
  st.t += dt;
  if (st.flashT > 0) {
    st.flashT -= dt;
    if (st.flashT <= 0) {
      st.flash = '';
      if (m.kind === 'sequence') st.lit = st.phase === 'play' ? -1 : st.lit;
    }
  }
  if (st.phase === 'won' || st.phase === 'lost') {
    if (b.confirm || b.cancel) return { won: st.phase === 'won', score: st.score, quit: false };
    return null;
  }
  if (b.cancel && m.canQuit) return { won: false, score: st.score, quit: true };
  if (st.phase === 'intro') {
    if (b.confirm) {
      st.t = 0;
      st.phase = m.kind === 'sequence' ? 'show' : 'play';
    }
    return null;
  }
  switch (m.kind) {
    case 'timing': {
      if (st.phase !== 'play') return null;
      st.pos += st.dir * (m.speed / 1.1) * dt;
      if (st.pos >= 1) {
        st.pos = 1;
        st.dir = -1;
      } else if (st.pos <= 0) {
        st.pos = 0;
        st.dir = 1;
      }
      if (b.confirm) {
        if (st.pos >= st.zoneAt && st.pos <= st.zoneAt + st.zoneSize) {
          st.round++;
          st.flash = 'hit';
          st.flashT = 0.25;
          if (st.round >= m.rounds) finish(m, st, true);
          else newZone(m, st, rng);
        } else {
          st.misses++;
          st.flash = 'miss';
          st.flashT = 0.25;
          if (st.misses > m.allowedMisses) finish(m, st, false);
        }
      }
      break;
    }
    case 'sequence': {
      if (st.phase === 'show') {
        const period = m.showSeconds * (1 + SHOW_GAP);
        const lead = 0.5; // a moment to look before the first one
        const at = st.t - lead;
        if (at < 0) st.lit = -1;
        else {
          const i = Math.floor(at / period);
          if (i >= st.seq.length) {
            st.phase = 'play';
            st.t = 0;
            st.lit = -1;
            st.entered = 0;
          } else st.lit = at - i * period < m.showSeconds ? st.seq[i]! : -1;
        }
      } else if (st.phase === 'play') {
        const dirs = symbolDirs(m.buttons);
        for (let s = 0; s < dirs.length; s++) if (b[dirs[s]!]) pressSymbol(m, st, s);
      }
      break;
    }
    case 'pairs': {
      if (st.lock > 0) {
        st.lock -= dt;
        if (st.lock <= 0) {
          st.lock = 0;
          for (const i of st.open) st.faces[i] = 'down';
          st.open = [];
          if (st.misses > m.allowedMisses) finish(m, st, false);
        }
        break;
      }
      const cols = pairColumns(st.cards.length);
      const n = st.cards.length;
      if (b.left && st.cursor % cols > 0) st.cursor--;
      if (b.right && st.cursor % cols < cols - 1 && st.cursor + 1 < n) st.cursor++;
      if (b.up && st.cursor - cols >= 0) st.cursor -= cols;
      if (b.down && st.cursor + cols < n) st.cursor += cols;
      if (b.confirm) flipCard(m, st, st.cursor);
      break;
    }
  }
  return null;
}

// ---------- what a play leaves behind ----------

export const minigameKey = (name: string, what: 'won' | 'played' | 'best'): string => `minigame:${name}:${what}`;

export function minigameWon(vars: Record<string, VariableValue>, name: string): boolean {
  return vars[minigameKey(name, 'won')] === true;
}

/** What the result screen says. */
export function resultText(st: MinigameState): string {
  return st.phase === 'won' ? 'You won!' : 'You lost.';
}
