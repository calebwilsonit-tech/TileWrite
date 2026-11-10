/**
 * A Nightgarden room, written as a small text grid. Each cell is a token of up to three characters:
 * the ground, what stands on it, and (for things that are wired together) a channel number.
 *
 *   ground:  #  hedge (stops walking and light)     .  path          ~  sunken bed (two levels down)
 *            ^  terrace (two levels up)             w  pond (stops walking, light passes)   _  nothing
 *   things:  @  the gardener      l / L  hand lamp, dark / lit        f  lamp that is always lit
 *            p / P  wired lamp (lit while its channel is on / off)     b  moonbloom     d  duskcap
 *            c  crate    z  brazier (a light you can push)    h  screen (a tall crate that casts a shadow)
 *            o  pressure plate (feeds its channel)   s / S  moonstone (feeds its channel while lit / dark)
 *            g / G  gate (open while its channel is on / off)          E  the way out       *  firefly
 */
/** Levels of the ground. Nothing is at level 0: the editor's own check takes unreachable ground at level 0 for a mistake, and a sunken bed is meant to be out of reach until a bloom lifts you. */
export const FLOOR = 3;
export const TRENCH = 1;
export const TERRACE = 5;
export const BLOOM_HEIGHT = 2;
/** How far a lamp's light reaches, in cells (see src/light.ts: two cells every way, less the far corners). */
export const LAMP_RANGE = 2.3;
export const BRAZIER_RANGE = 1.5;
/** How dark an unlit room is drawn (only a look: what counts as lit is the light rule's business). */
export const DARKNESS = 0.55;

export type Ground = 'hedge' | 'floor' | 'trench' | 'terrace' | 'pond' | 'void';
export type ThingKind = 'player' | 'lamp' | 'bloom' | 'crate' | 'brazier' | 'screen' | 'plate' | 'stone' | 'gate' | 'exit' | 'firefly';

export interface Thing {
  kind: ThingKind;
  x: number;
  y: number;
  /** lamp: lit at the start. gate: open while the channel is OFF. stone: on while DARK. */
  flag?: boolean;
  /** lamp: 'hand' (the player toggles it), 'fixed' (always lit), 'wired' (follows its channel). */
  mode?: 'hand' | 'fixed' | 'wired';
  /** bloom: which kind. */
  bloom?: 'moonbloom' | 'duskcap';
  channel?: number;
}

export interface RoomDef {
  id: string;
  name: string;
  /** One line shown when the room opens. */
  hint?: string;
  rows: string[];
}

export interface Room {
  id: string;
  name: string;
  hint: string;
  w: number;
  h: number;
  ground: Ground[][];
  things: Thing[];
}

const GROUND: Record<string, Ground> = { '#': 'hedge', '.': 'floor', '~': 'trench', '^': 'terrace', w: 'pond', _: 'void' };

export function groundLevel(g: Ground): number {
  return g === 'trench' ? TRENCH : g === 'terrace' ? TERRACE : FLOOR;
}

export function parseRoom(def: RoomDef): Room {
  const rows = def.rows.map((r) => r.trim().split(/\s+/));
  const w = Math.max(...rows.map((r) => r.length));
  const ground: Ground[][] = [];
  const things: Thing[] = [];
  const bad = (msg: string): never => {
    throw new Error(`Room ${def.id} "${def.name}": ${msg}`);
  };
  rows.forEach((row, y) => {
    if (row.length !== w) bad(`row ${y + 1} has ${row.length} cells, but the widest row has ${w}.`);
    ground.push(
      row.map((tok, x) => {
        const g = GROUND[tok[0]!];
        if (!g) return bad(`cell (${x}, ${y}) "${tok}" starts with an unknown ground "${tok[0]}".`);
        const o = tok[1];
        const ch = tok[2] ? Number(tok[2]) : undefined;
        if (tok.length > 3 || (tok[2] && !(ch! >= 1 && ch! <= 9))) bad(`cell (${x}, ${y}) "${tok}" is not ground + thing + channel 1-9.`);
        if (o && o !== '.') {
          const t = thingOf(o, x, y, ch);
          if (!t) return bad(`cell (${x}, ${y}) "${tok}" has an unknown thing "${o}".`);
          if (g === 'hedge' || g === 'pond' || g === 'void') bad(`cell (${x}, ${y}) "${tok}" puts a thing on ground nothing can stand on.`);
          things.push(t);
        }
        return g;
      }),
    );
  });
  const room: Room = { id: def.id, name: def.name, hint: def.hint ?? '', w, h: rows.length, ground, things };
  const count = (k: ThingKind): number => things.filter((t) => t.kind === k).length;
  if (count('player') !== 1) bad(`needs exactly one gardener (@), has ${count('player')}.`);
  if (count('exit') !== 1) bad(`needs exactly one way out (E), has ${count('exit')}.`);
  if (count('firefly') > 1) bad('has more than one firefly.');
  for (const t of things) {
    const needs = t.kind === 'plate' || t.kind === 'stone' || t.kind === 'gate' || (t.kind === 'lamp' && t.mode === 'wired');
    if (needs && t.channel === undefined) bad(`the ${t.kind} at (${t.x}, ${t.y}) needs a channel number.`);
    if (!needs && t.channel !== undefined) bad(`the ${t.kind} at (${t.x}, ${t.y}) has a channel it cannot use.`);
  }
  const fed = new Set(things.filter((t) => t.kind === 'plate' || t.kind === 'stone').map((t) => t.channel));
  const used = new Set(things.filter((t) => t.kind === 'gate' || (t.kind === 'lamp' && t.mode === 'wired')).map((t) => t.channel));
  for (const c of used) if (!fed.has(c)) bad(`channel ${c} is used by a gate or lamp but nothing feeds it.`);
  for (const c of fed) if (!used.has(c)) bad(`channel ${c} is fed by a plate or moonstone but nothing uses it.`);
  // the outside of a room must be closed: every open cell on the rim would let the gardener walk off the map
  return room;
}

function thingOf(o: string, x: number, y: number, channel?: number): Thing | null {
  const at = { x, y, ...(channel !== undefined ? { channel } : {}) };
  switch (o) {
    case '@': return { kind: 'player', ...at };
    case 'l': return { kind: 'lamp', mode: 'hand', flag: false, ...at };
    case 'L': return { kind: 'lamp', mode: 'hand', flag: true, ...at };
    case 'f': return { kind: 'lamp', mode: 'fixed', flag: true, ...at };
    case 'p': return { kind: 'lamp', mode: 'wired', flag: false, ...at };
    case 'P': return { kind: 'lamp', mode: 'wired', flag: true, ...at };
    case 'b': return { kind: 'bloom', bloom: 'moonbloom', ...at };
    case 'd': return { kind: 'bloom', bloom: 'duskcap', ...at };
    case 'c': return { kind: 'crate', ...at };
    case 'z': return { kind: 'brazier', ...at };
    case 'h': return { kind: 'screen', ...at };
    case 'o': return { kind: 'plate', ...at };
    case 's': return { kind: 'stone', flag: false, ...at };
    case 'S': return { kind: 'stone', flag: true, ...at };
    case 'g': return { kind: 'gate', flag: false, ...at };
    case 'G': return { kind: 'gate', flag: true, ...at };
    case 'E': return { kind: 'exit', ...at };
    case '*': return { kind: 'firefly', ...at };
    default: return null;
  }
}
