import {
  FLAG,
  cellWalkable,
  expandEntities,
  stepAllowed,
  tileMapFromRows,
  type EntityData,
  type PrefabMap,
  type SceneData,
  type TileMap,
} from '@tilewright/runtime';
import { isMovableByPuzzle, possibleBridges } from '@tilewright/behaviors';

/**
 * Level analysis without running the game: what can the player reach, can a gate be bypassed, is a goal
 * walled off. It works on the scene's data (prefab instances filled in) and uses the same walking rules as the
 * engine, plus the player's jump.
 */

export interface LevelIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  /** Scene id of the object the problem is about. */
  entity?: string;
  x?: number;
  y?: number;
}

export interface Prepared {
  map: TileMap;
  entities: EntityData[];
  player: EntityData | undefined;
}

export function prepare(scene: SceneData, prefabs: PrefabMap = new Map()): Prepared {
  const { entities } = expandEntities(scene.entities, prefabs);
  return { map: tileMapFromRows(scene.map), entities, player: entities.find((e) => e.tags.includes('player')) };
}

export interface Walker {
  stepUp: number;
  maxDrop: number;
  /** Can hop over gaps. */
  jump: boolean;
  /** Highest ledge a jump gets onto (levels). */
  jumpHeight: number;
  /** Widest gap a jump crosses (cells). */
  hop: number;
}

/** What the player can do, from the player object's settings. */
export function walkerOf(player: EntityData | undefined, jump = true): Walker {
  const body = player?.components.body as { stepUp?: number; stepDown?: number; ledge?: string } | undefined;
  const pc = player?.components.playerController as { jumpSpeed?: number; speed?: number } | undefined;
  const speed = pc?.speed ?? 4;
  const jumpSpeed = pc?.jumpSpeed ?? 0;
  const air = jumpSpeed > 0 ? (2 * jumpSpeed) / 36 : 0; // seconds in the air at gravity 36
  return {
    stepUp: body?.stepUp ?? 0.35,
    // players walk off ledges (they fall); only a "block" ledge setting stops that
    maxDrop: body?.ledge === 'block' ? (body?.stepDown ?? 0.4) : 3,
    jump: jump && jumpSpeed > 0,
    jumpHeight: (jumpSpeed * jumpSpeed) / (2 * 36) - 0.1,
    hop: Math.max(1, Math.floor(speed * air * 0.8)),
  };
}

export const cellKey = (x: number, y: number): string => `${x},${y}`;

const isGate = (e: EntityData): boolean => e.components.gate !== undefined;
const isCrate = (e: EntityData): boolean => e.components.pushable !== undefined;

interface Footprint {
  x: number;
  y: number;
  w: number;
  d: number;
}

function footprintCells(f: Footprint): [number, number][] {
  const out: [number, number][] = [];
  for (let x = Math.floor(f.x - f.w / 2 + 0.05); x <= Math.floor(f.x + f.w / 2 - 0.05); x++) {
    for (let y = Math.floor(f.y - f.d / 2 + 0.05); y <= Math.floor(f.y + f.d / 2 - 0.05); y++) out.push([x, y]);
  }
  return out;
}

/** Cells taken up by solid objects of one kind. */
export function solidCells(entities: readonly EntityData[], pick: (e: EntityData) => boolean): Set<string> {
  const out = new Set<string>();
  for (const e of entities) {
    if (!pick(e)) continue;
    const c = e.components.collider as { w: number; d: number; solid: boolean; enabled: boolean; trigger: boolean; height: number } | undefined;
    const t = e.components.transform as { x: number; y: number } | undefined;
    if (!c || !t || !c.solid || !c.enabled || c.trigger || c.height < 0.4) continue;
    for (const [x, y] of footprintCells({ x: t.x, y: t.y, w: c.w, d: c.d })) out.add(cellKey(x, y));
  }
  return out;
}

/** Fixed scenery (not gates, not crates, not the player's kind): always in the way. */
export const fixedCells = (entities: readonly EntityData[]): Set<string> =>
  solidCells(entities, (e) => !isGate(e) && !isCrate(e) && e.components.body === undefined && !isMovableByPuzzle(e));

const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Every cell the player can get to from a starting cell: walking (with the engine's step and ledge rules) and,
 * if the player can jump, hopping over short gaps. `blocked` cells are never entered.
 */
export function reachCells(map: TileMap, start: { x: number; y: number }, walker: Walker, blocked: ReadonlySet<string> = new Set(), bridges: ReadonlySet<string> = new Set()): Set<string> {
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const seen = new Set<string>([cellKey(sx, sy)]);
  const queue: [number, number][] = [[sx, sy]];
  const open = (x: number, y: number): boolean => (cellWalkable(map, x, y) || (bridges.has(cellKey(x, y)) && map.inBounds(x, y) && !map.cellBlocked(x, y))) && !blocked.has(cellKey(x, y));
  const isHole = (x: number, y: number): boolean => {
    if (blocked.has(cellKey(x, y)) || bridges.has(cellKey(x, y))) return false;
    if (!map.inBounds(x, y)) return true;
    if (map.cellBlocked(x, y)) return false;
    return map.getTile(x, y) === 0 || (map.getDeck(x, y) === 0 && (map.getFlags(x, y) & (FLAG.PIT | FLAG.WATER)) !== 0);
  };
  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (open(nx, ny)) {
        if (seen.has(cellKey(nx, ny))) continue;
        const up = walker.jump ? Math.max(walker.stepUp, walker.jumpHeight) : walker.stepUp;
        if (!stepAllowed(map, cx, cy, nx, ny, up, walker.maxDrop)) continue;
        seen.add(cellKey(nx, ny));
        queue.push([nx, ny]);
      } else if (walker.jump && isHole(nx, ny)) {
        // a hole (pit, water, nothing) in the way: hop across it to the first solid ground within reach
        for (let gap = 2; gap <= walker.hop + 1; gap++) {
          const lx = cx + dx * gap;
          const ly = cy + dy * gap;
          if (open(lx, ly)) {
            if (!seen.has(cellKey(lx, ly)) && map.topHeight(lx, ly) - map.topHeight(cx, cy) <= walker.jumpHeight) {
              seen.add(cellKey(lx, ly));
              queue.push([lx, ly]);
            }
            break;
          }
          if (!isHole(lx, ly)) break; // a wall or an object: no landing past it
        }
      }
    }
  }  return seen;
}

const GOAL_TAGS = ['goal', 'exit', 'reward'];

export const goalsOf = (entities: readonly EntityData[]): EntityData[] => entities.filter((e) => e.tags.some((t) => GOAL_TAGS.includes(t)) && e.components.transform !== undefined);

function cellOf(e: EntityData): { x: number; y: number } {
  const t = e.components.transform as { x: number; y: number };
  return { x: Math.floor(t.x), y: Math.floor(t.y) };
}

/**
 * Problems a designer can fix: goals that cannot be reached at all, goals that can be reached without opening
 * a gate (a puzzle that can be bypassed, often by a jump), and gates that block nothing.
 */
export function analyseLevel(scene: SceneData, prefabs: PrefabMap = new Map()): LevelIssue[] {
  const prep = prepare(scene, prefabs);
  const issues: LevelIssue[] = [];
  if (!prep.player) return issues;
  const t = prep.player.components.transform as { x: number; y: number };
  const walker = walkerOf(prep.player);
  const fixed = fixedCells(prep.entities);
  const gates = prep.entities.filter(isGate);
  const closedCells = (open: ReadonlySet<string> = new Set()): Set<string> => {
    const cells = new Set(fixed);
    for (const g of gates) {
      if (open.has(g.id)) continue;
      for (const c of solidCells([g], () => true)) cells.add(c);
    }
    return cells;
  };
  const bridges = possibleBridges(prep.entities, scene.wires);
  const allOpen = reachCells(prep.map, t, walker, fixed, bridges);
  const allClosed = reachCells(prep.map, t, walker, closedCells(), bridges);
  for (const goal of goalsOf(prep.entities)) {
    const c = cellOf(goal);
    const k = cellKey(c.x, c.y);
    const near = (set: Set<string>): boolean => set.has(k) || DIRS.some(([dx, dy]) => set.has(cellKey(c.x + dx, c.y + dy)));
    if (!near(allOpen)) {
      issues.push({
        id: `goal-unreachable-${goal.id}`,
        severity: 'error',
        message: `"${goal.name}" cannot be reached even with every gate open: walls, pits, water or something standing in the way blocks every route.`,
        entity: goal.id,
        x: c.x,
        y: c.y,
      });
    } else if (gates.length > 0 && near(allClosed)) {
      issues.push({
        id: `goal-bypass-${goal.id}`,
        severity: 'warning',
        message: `"${goal.name}" can be reached without opening any gate, so the puzzle can be bypassed${walker.jump ? ' (the player may be able to jump a gap or ledge)' : ''}. Close the gap or add a wall.`,
        entity: goal.id,
        x: c.x,
        y: c.y,
      });
    }
  }
  for (const g of gates) {
    // A gate matters if opening it changes where the player can go, either when the other gates are shut (the first gate
    // of a doorway made of two) or when they are open (gates in a row: the later ones are only reached through the earlier ones).
    const own = solidCells([g], () => true);
    const others = new Set(gates.filter((x) => x.id !== g.id).map((x) => x.id));
    const onlyThisClosed = reachCells(prep.map, t, walker, closedCells(others), bridges);
    const reachable = new Set(allOpen);
    for (const c of own) reachable.delete(c); // the gate's own cell does not count as something behind it
    const withG = reachCells(prep.map, t, walker, closedCells(new Set([g.id])), bridges);
    for (const c of own) withG.delete(c);
    if (onlyThisClosed.size === reachable.size && withG.size === allClosed.size) {
      const gc = cellOf(g);
      issues.push({
        id: `gate-useless-${g.id}`,
        severity: 'warning',
        message: `The gate "${g.name}" blocks nothing: the player can walk around it, or nothing lies behind it.`,
        entity: g.id,
        x: gc.x,
        y: gc.y,
      });
    }
  }
  return issues;
}
