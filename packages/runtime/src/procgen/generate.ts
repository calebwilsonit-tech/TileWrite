import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { Rng } from '../core/rng';
import { FLAG, TileMap } from '../tilemap/tilemap';

/**
 * Procedural maps: rooms and corridors, caves, islands and towns, drawn from a seed and a handful of visually edited rules.
 * The same seed always gives the same map (a locked seed is a hand-made level you can still tweak; an unlocked one is a new
 * level each run). Generators only make ground, walls and a list of places for things (a start, an exit, props, enemies); the
 * game turns the places into objects with the prefabs the rules name.
 */

export const GENERATOR_KINDS = ['dungeon', 'cave', 'island', 'town'] as const;
export type GeneratorKind = (typeof GENERATOR_KINDS)[number];

export const GENERATOR_NAMES: Record<GeneratorKind, string> = {
  dungeon: 'Rooms and corridors',
  cave: 'Caves',
  island: 'Islands',
  town: 'A town',
};

export const SCATTER_PLACES = ['room', 'floor', 'edge', 'start', 'end', 'corridor', 'anywhere'] as const;
export type ScatterPlace = (typeof SCATTER_PLACES)[number];

export const SCATTER_NAMES: Record<ScatterPlace, string> = {
  room: 'inside rooms (or open areas)',
  floor: 'anywhere on the floor',
  edge: 'against walls and shores',
  start: 'at the start',
  end: 'at the exit',
  corridor: 'in corridors and on roads',
  anywhere: 'anywhere (even on water)',
};

export const ScatterRuleSchema = z.object({
  /** The prefab to place. */
  prefab: z.string().default(''),
  where: z.enum(SCATTER_PLACES).default('floor'),
  /** Exactly this many (0 = use the chance below). */
  count: z.number().int().min(0).max(500).default(0),
  /** Chance (0-1) that each eligible cell gets one, when count is 0. */
  chance: z.number().min(0).max(1).default(0.02),
  /** No two of these closer than this many cells. */
  spacing: z.number().min(0).max(32).default(2),
  /** Added to the placed object's tags so event rows can find it. */
  tag: z.string().default(''),
});
export type ScatterRule = z.infer<typeof ScatterRuleSchema>;

export const GeneratorSpecSchema = z.object({
  kind: z.enum(GENERATOR_KINDS).default('dungeon'),
  width: z.number().int().min(8).max(512).default(48),
  height: z.number().int().min(8).max(512).default(48),
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(1),
  /** A locked seed always makes the same map. Unlocked, each new run (the variable run.seed) makes its own. */
  lockSeed: z.boolean().default(true),
  /** Make the map when the game starts (otherwise it is made in the editor and kept in the scene). */
  atStart: z.boolean().default(false),
  /** Tile ids from the project's tile list. */
  floorTile: z.number().int().min(1).default(2),
  wallTile: z.number().int().min(1).default(5),
  waterTile: z.number().int().min(1).default(4),
  sandTile: z.number().int().min(1).default(3),
  grassTile: z.number().int().min(1).default(1),
  roadTile: z.number().int().min(1).default(2),
  wallHeight: z.number().int().min(1).max(8).default(3),
  // rooms and corridors
  rooms: z.number().int().min(1).max(200).default(8),
  roomMin: z.number().int().min(3).max(30).default(5),
  roomMax: z.number().int().min(3).max(40).default(10),
  corridorWidth: z.number().int().min(1).max(3).default(2),
  // caves
  fill: z.number().min(0.2).max(0.7).default(0.45),
  smoothing: z.number().int().min(0).max(10).default(4),
  // islands
  landRatio: z.number().min(0.1).max(0.9).default(0.5),
  hills: z.number().int().min(0).max(4).default(2),
  // towns
  roadSpacing: z.number().int().min(5).max(24).default(10),
  buildingPrefab: z.string().default(''),
  buildingSize: z.number().int().min(2).max(8).default(3),
  scatter: z.array(ScatterRuleSchema).default([]),
});
export type GeneratorSpec = z.infer<typeof GeneratorSpecSchema>;

export const newGeneratorSpec = (kind: GeneratorKind = 'dungeon'): GeneratorSpec => GeneratorSpecSchema.parse({ kind });

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GeneratedPlacement {
  prefab: string;
  x: number;
  y: number;
  tag: string;
}

export interface Generated {
  map: TileMap;
  rooms: Room[];
  /** Cells where the player can start and where the way out is. */
  start: { x: number; y: number };
  end: { x: number; y: number };
  placements: GeneratedPlacement[];
  /** Plain-English remarks (the rules asked for more than fits, for example). */
  notes: string[];
  /** Ground a walker can stand on, corridors and roads, and shores (cell keys), for scattering and checking. */
  floors?: Set<number>;
  corridors?: Set<number>;
  edges?: Set<number>;
}

const key = (x: number, y: number): number => y * 4096 + x;

/** What the rules are for each of the four kinds, in plain English (for the editor's help line). */
export const GENERATOR_HELP: Record<GeneratorKind, string> = {
  dungeon: 'Places rooms that do not overlap, joins each to the next with a corridor, and builds walls around everything. The start is in the first room, the exit in the room farthest from it.',
  cave: 'Fills the map with random rock, smooths it into caves, keeps the biggest cave and walls it in. The start and the exit are at the two ends of the cave.',
  island: 'Raises a landmass out of the water: beaches at the shore, grass inland, hills in the middle. The start is on a beach.',
  town: 'Lays a grid of roads with a plaza in the middle and puts a building on each lot. The start is in the plaza.',
};

/** Make a map. The same spec (and seed) always gives the same result. */
export function generate(spec: GeneratorSpec, seedOverride?: number): Generated {
  const s = GeneratorSpecSchema.parse(spec);
  const rng = new Rng((seedOverride ?? s.seed) + 1);
  const notes: string[] = [];
  const out: Generated = { map: new TileMap(s.width, s.height), rooms: [], start: { x: 1, y: 1 }, end: { x: 1, y: 1 }, placements: [], notes };
  switch (s.kind) {
    case 'cave':
      cave(s, rng, out);
      break;
    case 'island':
      island(s, rng, out);
      break;
    case 'town':
      town(s, rng, out);
      break;
    default:
      dungeon(s, rng, out);
  }
  scatter(s, rng, out);
  return out;
}

// ---------- shared helpers ----------

/** Walls (a cliff of the wall tile) around every ground cell: any empty cell that touches ground. */
function wallAround(map: TileMap, floors: Set<number>, tile: number, height: number): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (floors.has(key(x, y))) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) if (floors.has(key(x + dx, y + dy))) touches = true;
      if (touches) map.set(x, y, tile, height);
    }
  }
}

/** Distances (in steps) from a cell over the floors; cells that cannot be reached are missing. */
function distances(floors: Set<number>, from: { x: number; y: number }): Map<number, number> {
  const d = new Map<number, number>([[key(from.x, from.y), 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    const base = d.get(key(c.x, c.y))!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { x: c.x + dx, y: c.y + dy };
      const k = key(n.x, n.y);
      if (!floors.has(k) || d.has(k)) continue;
      d.set(k, base + 1);
      queue.push(n);
    }
  }
  return d;
}

function farthest(floors: Set<number>, from: { x: number; y: number }): { x: number; y: number } {
  const d = distances(floors, from);
  let best = from;
  let bd = -1;
  for (const [k, v] of d) {
    if (v > bd) {
      bd = v;
      best = { x: k % 4096, y: Math.floor(k / 4096) };
    }
  }
  return best;
}

// ---------- rooms and corridors ----------

function dungeon(s: GeneratorSpec, rng: Rng, out: Generated): void {
  const { map } = out;
  const floors = new Set<number>();
  const rooms: Room[] = [];
  const lo = Math.min(s.roomMin, s.roomMax);
  const hi = Math.max(s.roomMin, s.roomMax);
  for (let tries = 0; tries < s.rooms * 40 && rooms.length < s.rooms; tries++) {
    const w = rng.int(lo, hi);
    const h = rng.int(lo, hi);
    const x = rng.int(2, s.width - w - 3);
    const y = rng.int(2, s.height - h - 3);
    if (x < 2 || y < 2) continue;
    // keep a wall's width between rooms
    if (rooms.some((r) => x < r.x + r.w + 3 && r.x < x + w + 3 && y < r.y + r.h + 3 && r.y < y + h + 3)) continue;
    rooms.push({ x, y, w, h });
  }
  if (rooms.length < s.rooms) out.notes.push(`Only ${rooms.length} of the ${s.rooms} rooms fit on a ${s.width} x ${s.height} map.`);
  if (rooms.length === 0) rooms.push({ x: Math.floor(s.width / 2) - 3, y: Math.floor(s.height / 2) - 3, w: 6, h: 6 });
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) floors.add(key(x, y));
  // join each room to the one before it with an L-shaped corridor (the order is shuffled by the seed, so the layout is not a chain of neighbours)
  const order = rooms.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const corridor = new Set<number>();
  const carve = (x: number, y: number): void => {
    for (let dy = 0; dy < s.corridorWidth; dy++) {
      for (let dx = 0; dx < s.corridorWidth; dx++) {
        if (x + dx > 0 && y + dy > 0 && x + dx < s.width - 1 && y + dy < s.height - 1) {
          const k = key(x + dx, y + dy);
          if (!floors.has(k)) corridor.add(k);
          floors.add(k);
        }
      }
    }
  };
  for (let i = 1; i < order.length; i++) {
    const a = rooms[order[i - 1]!]!;
    const b = rooms[order[i]!]!;
    const ax = a.x + Math.floor(a.w / 2);
    const ay = a.y + Math.floor(a.h / 2);
    const bx = b.x + Math.floor(b.w / 2);
    const by = b.y + Math.floor(b.h / 2);
    const horizontalFirst = rng.next() < 0.5;
    const [mx, my] = horizontalFirst ? [bx, ay] : [ax, by];
    for (let x = Math.min(ax, mx); x <= Math.max(ax, mx); x++) carve(x, ay);
    for (let y = Math.min(ay, my); y <= Math.max(ay, my); y++) carve(mx, y);
    for (let x = Math.min(mx, bx); x <= Math.max(mx, bx); x++) carve(x, by);
    for (let y = Math.min(my, by); y <= Math.max(my, by); y++) carve(bx, y);
  }
  for (const k of floors) map.set(k % 4096, Math.floor(k / 4096), s.floorTile, 0);
  wallAround(map, floors, s.wallTile, s.wallHeight);
  out.rooms = rooms;
  const first = rooms[order[0]!]!;
  out.start = { x: first.x + Math.floor(first.w / 2), y: first.y + Math.floor(first.h / 2) };
  out.end = farthest(floors, out.start);
  out.floors = floors;
  out.corridors = corridor;
}

// ---------- caves ----------

function cave(s: GeneratorSpec, rng: Rng, out: Generated): void {
  const { map } = out;
  let rock = new Uint8Array(s.width * s.height);
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) rock[y * s.width + x] = x === 0 || y === 0 || x === s.width - 1 || y === s.height - 1 || rng.next() < s.fill ? 1 : 0;
  for (let step = 0; step < s.smoothing; step++) {
    const next = new Uint8Array(rock.length);
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dy !== 0) n += x + dx < 0 || y + dy < 0 || x + dx >= s.width || y + dy >= s.height ? 1 : rock[(y + dy) * s.width + x + dx]!;
        next[y * s.width + x] = n >= 5 ? 1 : n <= 2 ? 0 : rock[y * s.width + x]!;
      }
    }
    rock = next;
  }
  // keep the biggest open region
  const seen = new Uint8Array(rock.length);
  let best: number[] = [];
  for (let i = 0; i < rock.length; i++) {
    if (rock[i] || seen[i]) continue;
    const region: number[] = [i];
    seen[i] = 1;
    for (let q = 0; q < region.length; q++) {
      const c = region[q]!;
      const x = c % s.width;
      const y = Math.floor(c / s.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= s.width || ny >= s.height) continue;
        const n = ny * s.width + nx;
        if (rock[n] || seen[n]) continue;
        seen[n] = 1;
        region.push(n);
      }
    }
    if (region.length > best.length) best = region;
  }
  if (best.length < 20) out.notes.push('The caves came out very small. Try less rock (a lower fill) or fewer smoothing steps.');
  const floors = new Set<number>();
  for (const c of best) floors.add(key(c % s.width, Math.floor(c / s.width)));
  if (floors.size === 0) for (let y = 3; y < 8; y++) for (let x = 3; x < 8; x++) floors.add(key(x, y));
  for (const k of floors) map.set(k % 4096, Math.floor(k / 4096), s.floorTile, 0);
  wallAround(map, floors, s.wallTile, s.wallHeight);
  const any = floors.values().next().value as number;
  const a = farthest(floors, { x: any % 4096, y: Math.floor(any / 4096) });
  out.start = a;
  out.end = farthest(floors, a);
  out.floors = floors;
  out.rooms = [];
}

// ---------- islands ----------

/** Smooth seeded noise: random values on a coarse grid, blended. */
function noiseField(w: number, h: number, rng: Rng, cell: number): Float32Array {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / cell;
      const fy = y / cell;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = grid[y0 * gw + x0]!;
      const b = grid[y0 * gw + x0 + 1]!;
      const c = grid[(y0 + 1) * gw + x0]!;
      const d = grid[(y0 + 1) * gw + x0 + 1]!;
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function island(s: GeneratorSpec, rng: Rng, out: Generated): void {
  const { map } = out;
  const n1 = noiseField(s.width, s.height, rng, Math.max(4, Math.floor(s.width / 6)));
  const n2 = noiseField(s.width, s.height, rng, Math.max(2, Math.floor(s.width / 14)));
  const heightMap = new Float32Array(s.width * s.height);
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      // an island: high in the middle, sinking toward the edges, with noise on top
      const dx = (x / (s.width - 1)) * 2 - 1;
      const dy = (y / (s.height - 1)) * 2 - 1;
      const fall = Math.min(1, Math.hypot(dx, dy));
      heightMap[y * s.width + x] = (n1[y * s.width + x]! * 0.65 + n2[y * s.width + x]! * 0.35) * (1 - fall * 0.95);
    }
  }
  // choose the water level so that the wanted share of the map is land
  const sorted = [...heightMap].sort((a, b) => a - b);
  const level = sorted[Math.floor((1 - s.landRatio) * (sorted.length - 1))]!;
  const top = sorted[sorted.length - 1]!;
  const floors = new Set<number>();
  const edge: number[] = [];
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const v = heightMap[y * s.width + x]!;
      if (v <= level) {
        map.set(x, y, s.waterTile, 0);
        map.setFlag(x, y, FLAG.WATER);
        continue;
      }
      const t = (v - level) / Math.max(1e-6, top - level);
      const shore = t < 0.12;
      const lift = s.hills > 0 ? Math.min(s.hills, Math.floor(Math.max(0, t - 0.55) * (s.hills + 1) * 2.2)) : 0;
      map.set(x, y, shore ? s.sandTile : lift > 0 ? s.floorTile : s.grassTile, lift);
      floors.add(key(x, y));
      if (shore) edge.push(key(x, y));
    }
  }
  // the biggest landmass is where the game takes place
  const seen = new Set<number>();
  let best = new Set<number>();
  for (const k of floors) {
    if (seen.has(k)) continue;
    const region = new Set<number>([k]);
    const q = [k];
    seen.add(k);
    for (let i = 0; i < q.length; i++) {
      const c = q[i]!;
      const x = c % 4096;
      const y = Math.floor(c / 4096);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = key(x + dx, y + dy);
        if (!floors.has(nk) || seen.has(nk)) continue;
        seen.add(nk);
        region.add(nk);
        q.push(nk);
      }
    }
    if (region.size > best.size) best = region;
  }
  // small islands are drowned so nothing out there is unreachable
  for (const k of floors) {
    if (best.has(k)) continue;
    map.set(k % 4096, Math.floor(k / 4096), s.waterTile, 0);
    map.setFlag(k % 4096, Math.floor(k / 4096), FLAG.WATER);
  }
  const shoreCells = edge.filter((k) => best.has(k));
  const startKey = shoreCells.length > 0 ? shoreCells[Math.floor(shoreCells.length / 2)]! : [...best][0]!;
  out.start = { x: startKey % 4096, y: Math.floor(startKey / 4096) };
  out.end = farthest(best, out.start);
  out.floors = best;
  out.edges = new Set(shoreCells);
  out.rooms = [];
}

// ---------- towns ----------

function town(s: GeneratorSpec, rng: Rng, out: Generated): void {
  const { map } = out;
  map.fill(s.grassTile, 0);
  const floors = new Set<number>();
  const roads = new Set<number>();
  const step = s.roadSpacing;
  const isRoad = (x: number, y: number): boolean => x % step === Math.floor(step / 2) || y % step === Math.floor(step / 2);
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      floors.add(key(x, y));
      if (isRoad(x, y)) {
        map.set(x, y, s.roadTile, 0);
        roads.add(key(x, y));
      }
    }
  }
  // a building on most lots (a block between roads), its footprint kept off the road
  const size = s.buildingSize;
  const lots: Room[] = [];
  for (let by = 0; by + step <= s.height; by += step) {
    for (let bx = 0; bx + step <= s.width; bx += step) {
      const x0 = bx + Math.floor(step / 2) + 1;
      const y0 = by + Math.floor(step / 2) + 1;
      const w = Math.min(size, step - 2);
      const h = Math.min(size, step - 2);
      if (x0 + w > s.width || y0 + h > s.height) continue;
      const cx = bx + Math.floor(step / 2) + 1 + step / 2;
      const middle = Math.abs(cx - s.width / 2) < step && Math.abs(y0 + h / 2 - s.height / 2) < step;
      if (middle || rng.next() < 0.15) continue; // the plaza stays open; some lots are empty
      lots.push({ x: x0, y: y0, w, h });
    }
  }
  if (s.buildingPrefab) for (const l of lots) out.placements.push({ prefab: s.buildingPrefab, x: l.x + l.w / 2, y: l.y + l.h / 2, tag: 'building' });
  else out.notes.push('No building prefab is chosen, so the lots are empty. Pick one in the town settings.');
  out.rooms = lots;
  out.start = { x: Math.floor(s.width / 2), y: Math.floor(s.height / 2) };
  out.end = farthest(floors, out.start);
  out.floors = floors;
  out.corridors = roads;
  // building lots are not floor for scattering (props go in the streets and gardens)
  for (const l of lots) for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) floors.delete(key(x, y));
}

// ---------- scattering things ----------

function scatter(s: GeneratorSpec, rng: Rng, out: Generated): void {
  const floors = out.floors ?? new Set<number>();
  const rooms = out.rooms;
  const corridor = out.corridors ?? new Set<number>();
  const edges = out.edges ?? new Set<number>();
  const taken: { x: number; y: number }[] = [{ ...out.start }];
  const inRoom = (x: number, y: number): boolean => rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const nearWall = (x: number, y: number): boolean => {
    if (edges.has(key(x, y))) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (!floors.has(key(x + dx, y + dy))) return true;
    return false;
  };
  for (const rule of s.scatter) {
    if (!rule.prefab) continue;
    let eligible: { x: number; y: number }[] = [];
    switch (rule.where) {
      case 'start':
        eligible = [{ ...out.start }];
        break;
      case 'end':
        eligible = [{ ...out.end }];
        break;
      case 'anywhere':
        for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) eligible.push({ x, y });
        break;
      default:
        for (const k of [...floors].sort((a, b) => a - b)) {
          const x = k % 4096;
          const y = Math.floor(k / 4096);
          const ok =
            rule.where === 'floor' ||
            (rule.where === 'room' && (rooms.length === 0 ? !nearWall(x, y) : inRoom(x, y) && !nearWall(x, y))) ||
            (rule.where === 'edge' && nearWall(x, y)) ||
            (rule.where === 'corridor' && corridor.has(k));
          if (ok && (x !== out.start.x || y !== out.start.y)) eligible.push({ x, y });
        }
    }
    // shuffle by the seed so the same cells are not always first
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!];
    }
    const want = rule.count > 0 ? rule.count : Number.POSITIVE_INFINITY;
    let made = 0;
    for (const c of eligible) {
      if (made >= want) break;
      if (rule.count === 0 && rng.next() >= rule.chance) continue;
      if (rule.where !== 'start' && rule.where !== 'end' && taken.some((t) => Math.hypot(t.x - c.x, t.y - c.y) < Math.max(1, rule.spacing))) continue;
      taken.push(c);
      out.placements.push({ prefab: rule.prefab, x: c.x + 0.5, y: c.y + 0.5, tag: rule.tag });
      made++;
    }
    if (rule.count > 0 && made < rule.count) out.notes.push(`Only ${made} of the ${rule.count} "${rule.prefab}" fit ${SCATTER_NAMES[rule.where]}.`);
  }
}

/** Can a walker get from the start to the exit over the ground the generator made? */
export function startReachesEnd(g: Generated): boolean {
  const floors = g.floors;
  if (!floors) return true;
  return distances(floors, g.start).has(key(g.end.x, g.end.y));
}
