import { EMPTY_TILE, FLAG, SLOPE, groundHeightAt, reachableCells, type PrefabData, type SlopeDir } from '@tilewright/runtime';
import type { CellData } from '../model/cells';
import type { EditorDoc, Stroke } from '../model/doc';
import type { ToolId, ToolOptions } from '../app/store';
import {
  brushCells,
  capturePattern,
  floodFill,
  lineBetween,
  planSlope,
  rectCells,
  smoothedHeights,
  stampCells,
  type P,
  type Pattern,
} from './algorithms';
import { prefabById } from './prefabs';

export const MAX_HEIGHT = 12;

export interface Pointer {
  cell: P | null;
  screen: { x: number; y: number };
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export type Preview =
  | { kind: 'wire'; from: { x: number; y: number; h: number }; to: { x: number; y: number } }
  | { kind: 'cells'; cells: P[]; color: number; alpha?: number }
  | { kind: 'ghost'; x: number; y: number; h: number; prefab: string };

export interface ToolEnv {
  doc: EditorDoc;
  opts: ToolOptions;
  selection: string[];
  setPreview(p: Preview[]): void;
  select(ids: string[], region?: string | null): void;
  notify(kind: 'info' | 'warn' | 'error', text: string): void;
  setWalk(cells: Set<string> | null): void;
  setMarquee(r: { x0: number; y0: number; x1: number; y1: number } | null): void;
  pickEntity(screen: { x: number; y: number }): string | null;
  pickRegion(cell: P): string | null;
  /** Two objects were just wired together by dragging; the app asks which signals to connect. */
  connect(from: string, to: string): void;
  /** The object's id and where it is, for drawing a wire from it. */
  entityAnchor(id: string): { x: number; y: number; h: number } | null;
  /** The project's prefabs, for the Place tool. */
  prefabs: ReadonlyMap<string, PrefabData>;
  /** Entities whose on-screen position lies inside a screen rectangle. */
  entitiesInRect(r: { x0: number; y0: number; x1: number; y1: number }): string[];
  /** Grid position under a screen point, on the plane at height h. */
  worldAt(screen: { x: number; y: number }, h: number): { x: number; y: number };
}

export interface ToolImpl {
  down(p: Pointer, env: ToolEnv): void;
  move(p: Pointer, env: ToolEnv): void;
  up(p: Pointer, env: ToolEnv): void;
  /** Drop the gesture (Escape, or tool switched mid-drag). */
  cancel(env: ToolEnv): void;
  hover(p: Pointer, env: ToolEnv): void;
  key?(key: string, env: ToolEnv): boolean;
}

export interface ToolMeta {
  id: ToolId;
  label: string;
  group: 'Select' | 'Paint' | 'Height' | 'Terrain' | 'Collision' | 'Objects' | 'Logic' | 'Helpers';
  hotkey?: string;
  hint: string;
  /** Which layer this tool edits (so a locked layer can refuse it). */
  edits: 'ground' | 'objects' | 'regions' | 'none';
  /** Option controls to show while the tool is active. */
  options: (keyof ToolOptions)[];
  /** Show the collision overlay while this tool is active. */
  showsCollision?: boolean;
}

export const TOOL_META: ToolMeta[] = [
  { id: 'select', label: 'Select', group: 'Select', hotkey: 'V', hint: 'Click to select things, drag to move them, drag empty space to box-select. Delete removes, R rotates, Ctrl+C / Ctrl+V copies.', edits: 'objects', options: [] },
  { id: 'paint', label: 'Brush', group: 'Paint', hotkey: 'B', hint: 'Paint the chosen tile. Drag to paint a line of cells.', edits: 'ground', options: ['tile', 'size'] },
  { id: 'rect', label: 'Rectangle', group: 'Paint', hotkey: 'U', hint: 'Drag a rectangle and fill it with the chosen tile. Outline option draws only the border.', edits: 'ground', options: ['tile', 'outline'] },
  { id: 'line', label: 'Line', group: 'Paint', hotkey: 'L', hint: 'Drag a straight line of the chosen tile.', edits: 'ground', options: ['tile', 'size'] },
  { id: 'fill', label: 'Fill', group: 'Paint', hotkey: 'G', hint: 'Click to flood-fill the connected area (same tile and height) with the chosen tile.', edits: 'ground', options: ['tile'] },
  { id: 'eraser', label: 'Eraser', group: 'Paint', hotkey: 'E', hint: 'Remove tiles completely (leaves empty space).', edits: 'ground', options: ['size'] },
  { id: 'scatter', label: 'Scatter', group: 'Paint', hotkey: 'S', hint: 'Sprinkle the chosen tile randomly inside the brush. Density sets how much.', edits: 'ground', options: ['tile', 'size', 'density'] },
  { id: 'stamp', label: 'Stamp', group: 'Paint', hotkey: 'T', hint: 'Drag to copy an area as a pattern, then click to stamp it down. Esc forgets the pattern.', edits: 'ground', options: [] },
  { id: 'raise', label: 'Raise', group: 'Height', hotkey: 'Q', hint: 'Raise ground by one level per click or drag. Hold Shift to lower.', edits: 'ground', options: ['size'] },
  { id: 'lower', label: 'Lower', group: 'Height', hotkey: 'W', hint: 'Lower ground by one level per click or drag.', edits: 'ground', options: ['size'] },
  { id: 'setheight', label: 'Set height', group: 'Height', hint: 'Set cells to an exact height level.', edits: 'ground', options: ['height', 'size'] },
  { id: 'smooth', label: 'Smooth', group: 'Height', hint: 'Even out bumps by blending heights with the neighbours.', edits: 'ground', options: ['size'] },
  { id: 'stairs', label: 'Stairs', group: 'Terrain', hotkey: 'Z', hint: 'Click a cell to make stairs that climb in the chosen direction (R turns them). The base height copies the floor they climb from. Drag to build several.', edits: 'ground', options: ['slopeDir'], showsCollision: true },
  { id: 'ramp', label: 'Ramp', group: 'Terrain', hotkey: 'X', hint: 'Like stairs but a smooth slope.', edits: 'ground', options: ['slopeDir'], showsCollision: true },
  { id: 'cliff', label: 'Cliff', group: 'Terrain', hotkey: 'C', hint: 'Drag a rectangle to raise it to the chosen height, leaving a cliff around its edge that blocks walking.', edits: 'ground', options: ['tile', 'height'], showsCollision: true },
  { id: 'pit', label: 'Pit', group: 'Terrain', hotkey: 'P', hint: 'Paint holes that things fall into. Hold Shift to fill them in.', edits: 'ground', options: ['size'], showsCollision: true },
  { id: 'water', label: 'Water', group: 'Terrain', hotkey: 'O', hint: 'Paint water, which blocks walking. Hold Shift to remove it.', edits: 'ground', options: ['size', 'tile'], showsCollision: true },
  { id: 'bridge', label: 'Bridge', group: 'Terrain', hotkey: 'J', hint: 'Paint a walkable deck at the chosen level over water, pits or floor. Hold Shift to remove it.', edits: 'ground', options: ['bridgeLevel', 'size'], showsCollision: true },
  { id: 'block', label: 'Blocker', group: 'Collision', hotkey: 'K', hint: 'Paint invisible walls that block at every height. Hold Shift to clear them.', edits: 'ground', options: ['size'], showsCollision: true },
  { id: 'oneway', label: 'One-way edge', group: 'Collision', hint: 'Click a cell to toggle a side that cannot be entered (but can be left).', edits: 'ground', options: ['edge'], showsCollision: true },
  { id: 'walktest', label: 'Walk test', group: 'Collision', hotkey: 'H', hint: 'Click a cell to see everywhere the player could walk to from there.', edits: 'none', options: [], showsCollision: true },
  { id: 'place', label: 'Place', group: 'Objects', hotkey: 'N', hint: 'Click to place the chosen object, snapped to the grid. R turns it.', edits: 'objects', options: ['prefab'] },
  { id: 'region', label: 'Region', group: 'Objects', hotkey: 'M', hint: 'Drag a rectangle to mark a room: camera bounds, music, darkness, boss area.', edits: 'regions', options: [] },
  { id: 'room', label: 'Room', group: 'Helpers', hint: 'Drag a rectangle to build a room: floor in the chosen tile, brick walls around it, flattened inside.', edits: 'ground', options: ['tile', 'height'] },
  { id: 'corridor', label: 'Corridor', group: 'Helpers', hint: 'Drag from one point to another to carve a two-cell-wide corridor of the chosen tile between them.', edits: 'ground', options: ['tile'] },
  { id: 'wire', label: 'Wire', group: 'Logic', hotkey: 'Y', hint: 'Drag from one object to another to connect them: a pressure plate to a gate, a lever to a spawner, anything to a logic gate.', edits: 'objects', options: [] },
  { id: 'props', label: 'Scatter props', group: 'Helpers', hint: 'Drag a rectangle to sprinkle the chosen object around it, keeping clear of walls, water and stairs. Density sets how many.', edits: 'objects', options: ['prefab', 'density'] },
];

export function toolMeta(id: ToolId): ToolMeta {
  return TOOL_META.find((t) => t.id === id)!;
}

// ---------- helpers ----------

const ERASED: Partial<CellData> = { tile: EMPTY_TILE, height: 0, slope: 0, flags: 0, deck: 0, deckTile: 0, oneWay: 0 };

function key(c: P): string {
  return `${c.x},${c.y}`;
}

function cellsAround(c: P, size: number): P[] {
  return brushCells(c.x, c.y, size);
}

/** Pit/water/etc. cells must have a tile to be drawn. */
function ensureTile(c: CellData, fallback: number): number {
  return c.tile === EMPTY_TILE ? fallback : c.tile;
}

type Applier = (stroke: Stroke, c: P, p: Pointer, env: ToolEnv, visited: Set<string>) => void;

/** A tool that changes brush-sized groups of cells while you drag, as one undo step. */
function brushTool(label: string, apply: Applier, o: { once?: boolean; color?: number } = {}): ToolImpl {
  let stroke: Stroke | null = null;
  let last: P | null = null;
  let visited = new Set<string>();

  const paintAlong = (to: P, p: Pointer, env: ToolEnv): void => {
    if (!stroke) return;
    const path = last ? lineBetween(last, to) : [to];
    for (const c of path) {
      for (const cell of cellsAround(c, env.opts.size)) {
        if (o.once) {
          const k = key(cell);
          if (visited.has(k)) continue;
          visited.add(k);
        }
        apply(stroke, cell, p, env, visited);
      }
    }
    last = to;
  };

  const preview = (p: Pointer, env: ToolEnv): void => {
    env.setPreview(p.cell ? [{ kind: 'cells', cells: cellsAround(p.cell, env.opts.size), color: o.color ?? 0xffffff, alpha: 0.35 }] : []);
  };

  return {
    down(p, env) {
      if (!p.cell) return;
      stroke = env.doc.beginStroke(label);
      last = null;
      visited = new Set();
      paintAlong(p.cell, p, env);
    },
    move(p, env) {
      if (stroke && p.cell) paintAlong(p.cell, p, env);
      preview(p, env);
    },
    up() {
      stroke?.commit();
      stroke = null;
      last = null;
    },
    cancel() {
      stroke?.cancel();
      stroke = null;
      last = null;
    },
    hover: preview,
  };
}

/** A tool driven by dragging a rectangle (or any two-corner shape). */
function dragTool(
  onPreview: (a: P, b: P, p: Pointer, env: ToolEnv) => P[],
  onCommit: (a: P, b: P, p: Pointer, env: ToolEnv) => void,
  color = 0xffffff,
): ToolImpl {
  let start: P | null = null;
  return {
    down(p) {
      start = p.cell;
    },
    move(p, env) {
      if (start && p.cell) env.setPreview([{ kind: 'cells', cells: onPreview(start, p.cell, p, env), color, alpha: 0.4 }]);
      else env.setPreview(p.cell ? [{ kind: 'cells', cells: [p.cell], color, alpha: 0.4 }] : []);
    },
    up(p, env) {
      if (start && p.cell) onCommit(start, p.cell, p, env);
      start = null;
      env.setPreview([]);
    },
    cancel(env) {
      start = null;
      env.setPreview([]);
    },
    hover(p, env) {
      env.setPreview(p.cell ? [{ kind: 'cells', cells: [p.cell], color, alpha: 0.4 }] : []);
    },
  };
}

function rectOrOutline(a: P, b: P, outline: boolean): P[] {
  const all = rectCells(a, b);
  if (!outline) return all;
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return all.filter((c) => c.x === x0 || c.x === x1 || c.y === y0 || c.y === y1);
}

function hash01(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + salt, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function slopeFromDrag(a: P, b: P, fallback: SlopeDir): SlopeDir {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? SLOPE.E : SLOPE.W;
  return dy > 0 ? SLOPE.S : SLOPE.N;
}

const ARROW: Record<number, string> = { [SLOPE.N]: 'north', [SLOPE.E]: 'east', [SLOPE.S]: 'south', [SLOPE.W]: 'west' };

/** Stairs or a ramp: click a cell, or drag a line of them (direction follows the drag). */
function slopeTool(style: 'stairs' | 'ramp'): ToolImpl {
  let start: P | null = null;
  const cellsFor = (a: P, b: P): P[] => lineBetween(a, b);
  return {
    down(p) {
      start = p.cell;
    },
    move(p, env) {
      if (start && p.cell) env.setPreview([{ kind: 'cells', cells: cellsFor(start, p.cell), color: 0xffd34a, alpha: 0.45 }]);
      else env.setPreview(p.cell ? [{ kind: 'cells', cells: [p.cell], color: 0xffd34a, alpha: 0.45 }] : []);
    },
    up(p, env) {
      if (start && p.cell) {
        const dir = start.x === p.cell.x && start.y === p.cell.y ? env.opts.slopeDir : slopeFromDrag(start, p.cell, env.opts.slopeDir);
        const stroke = env.doc.beginStroke(style === 'stairs' ? 'Build stairs' : 'Build ramp');
        const warnings = new Set<string>();
        const line = cellsFor(start, p.cell);
        // Apply the line from the low end so each step's base height chains from the one before.
        for (const [i, c] of line.entries()) {
          if (!env.doc.map.inBounds(c.x, c.y)) continue;
          const plan = planSlope(env.doc.map, c.x, c.y, dir, style);
          // Only the last step of a chain sets the real top; earlier steps lead to the next step, not to a floor.
          if (i === line.length - 1) plan.warnings.forEach((w) => warnings.add(w));
          stroke.apply(c.x, c.y, (cell) => ({ ...plan.patch, tile: ensureTile(cell, 2) }));
        }
        stroke.commit();
        if (warnings.size > 0) env.notify('warn', [...warnings][0]!);
        else env.notify('info', `${style === 'stairs' ? 'Stairs' : 'Ramp'} going ${ARROW[dir]}.`);
      }
      start = null;
      env.setPreview([]);
    },
    cancel(env) {
      start = null;
      env.setPreview([]);
    },
    hover(p, env) {
      env.setPreview(p.cell ? [{ kind: 'cells', cells: [p.cell], color: 0xffd34a, alpha: 0.45 }] : []);
    },
    key(k, env) {
      if (k.toLowerCase() === 'r') {
        const order: SlopeDir[] = [SLOPE.N, SLOPE.E, SLOPE.S, SLOPE.W];
        const next = order[(order.indexOf(env.opts.slopeDir) + 1) % 4]!;
        env.notify('info', `Climbs ${ARROW[next]}.`);
        return true;
      }
      return false;
    },
  };
}

// ---------- the tools ----------

export interface ToolState {
  pattern: Pattern | null;
  walk: Set<string> | null;
  ghostFacing: number;
}

export const toolState: ToolState = { pattern: null, walk: null, ghostFacing: 2 };

const selectTool = (): ToolImpl => {
  type Drag = { ids: string[]; origin: Map<string, { x: number; y: number; h: number }>; startWorld: { x: number; y: number } };
  let drag: Drag | null = null;
  let marquee: { x0: number; y0: number } | null = null;
  let moved = false;
  let downPick: string | null = null;
  let downShift = false;

  const transformOf = (doc: EditorDoc, id: string): { x: number; y: number; h: number; facing: number } | undefined =>
    doc.getEntity(id)?.components.transform as { x: number; y: number; h: number; facing: number } | undefined;

  const snap = (v: number, off: boolean): number => (off ? v : Math.round(v * 2) / 2);

  const applyDrag = (p: Pointer, env: ToolEnv): void => {
    if (!drag) return;
    const first = drag.origin.get(drag.ids[0]!)!;
    const w = env.worldAt(p.screen, first.h);
    const dx = snap(first.x + (w.x - drag.startWorld.x), p.alt) - first.x;
    const dy = snap(first.y + (w.y - drag.startWorld.y), p.alt) - first.y;
    for (const id of drag.ids) {
      const t = transformOf(env.doc, id);
      const o = drag.origin.get(id);
      if (!t || !o) continue;
      t.x = o.x + dx;
      t.y = o.y + dy;
      if (!p.alt) {
        const cx = Math.floor(t.x);
        const cy = Math.floor(t.y);
        if (env.doc.map.inBounds(cx, cy)) t.h = Math.max(groundHeightAt(env.doc.map, t.x, t.y), env.doc.map.getDeck(cx, cy));
      }
    }
    env.doc.emit({ type: 'entities' });
  };

  return {
    down(p, env) {
      moved = false;
      downShift = p.shift;
      downPick = env.pickEntity(p.screen);
      if (downPick) {
        const sel = env.selection.includes(downPick) ? env.selection : p.shift ? [...env.selection, downPick] : [downPick];
        env.select(sel);
        const first = transformOf(env.doc, downPick)!;
        const origin = new Map<string, { x: number; y: number; h: number }>();
        for (const id of sel) {
          const t = transformOf(env.doc, id);
          if (t) origin.set(id, { x: t.x, y: t.y, h: t.h });
        }
        drag = { ids: [downPick, ...sel.filter((s) => s !== downPick)], origin, startWorld: env.worldAt(p.screen, first.h) };
        return;
      }
      marquee = { x0: p.screen.x, y0: p.screen.y };
    },
    move(p, env) {
      if (drag) {
        moved = true;
        applyDrag(p, env);
      } else if (marquee) {
        env.setMarquee({ x0: marquee.x0, y0: marquee.y0, x1: p.screen.x, y1: p.screen.y });
      }
    },
    up(p, env) {
      if (drag) {
        if (moved) {
          const finals = new Map<string, { x: number; y: number; h: number }>();
          for (const id of drag.ids) {
            const t = transformOf(env.doc, id);
            if (t) finals.set(id, { x: t.x, y: t.y, h: t.h });
          }
          for (const id of drag.ids) {
            const t = transformOf(env.doc, id);
            const o = drag.origin.get(id);
            if (t && o) Object.assign(t, o);
          }
          env.doc.updateEntities(drag.ids, drag.ids.length > 1 ? `Move ${drag.ids.length} objects` : 'Move object', (e) => {
            const f = finals.get(e.id);
            if (f) Object.assign(e.components.transform as object, f);
          });
        } else if (downPick && !downShift && env.selection.length > 1 && env.selection.includes(downPick)) {
          env.select([downPick]); // plain click on one of several selected: narrow to it
        } else if (downPick && downShift && env.selection.includes(downPick) && !moved) {
          // shift-click toggles
        }
        drag = null;
        return;
      }
      if (marquee) {
        const r = { x0: marquee.x0, y0: marquee.y0, x1: p.screen.x, y1: p.screen.y };
        marquee = null;
        env.setMarquee(null);
        const small = Math.abs(r.x1 - r.x0) < 4 && Math.abs(r.y1 - r.y0) < 4;
        if (small) {
          const region = p.cell ? env.pickRegion(p.cell) : null;
          if (region) env.select([], region);
          else if (!downShift) env.select([]);
        } else {
          const ids = env.entitiesInRect(r);
          env.select(downShift ? [...new Set([...env.selection, ...ids])] : ids);
        }
      }
    },
    cancel(env) {
      if (drag) {
        for (const id of drag.ids) {
          const t = transformOf(env.doc, id);
          const o = drag.origin.get(id);
          if (t && o) Object.assign(t, o);
        }
        env.doc.emit({ type: 'entities' });
      }
      drag = null;
      marquee = null;
      env.setMarquee(null);
    },
    hover() {},
  };
};

const stampTool = (): ToolImpl => {
  let start: P | null = null;
  const outline = (c: P, pat: Pattern): P[] => rectCells(c, { x: c.x + pat.w - 1, y: c.y + pat.h - 1 });
  return {
    down(p) {
      start = p.cell;
    },
    move(p, env) {
      if (!p.cell) return;
      if (toolState.pattern) env.setPreview([{ kind: 'cells', cells: outline(p.cell, toolState.pattern), color: 0x6aa8ff, alpha: 0.35 }]);
      else if (start) env.setPreview([{ kind: 'cells', cells: rectCells(start, p.cell), color: 0x6aa8ff, alpha: 0.35 }]);
    },
    up(p, env) {
      if (!p.cell) return;
      if (toolState.pattern) {
        const pat = toolState.pattern;
        const stroke = env.doc.beginStroke('Stamp pattern');
        for (const s of stampCells(pat, p.cell.x, p.cell.y)) stroke.apply(s.x, s.y, s.cell);
        stroke.commit();
      } else if (start) {
        toolState.pattern = capturePattern(env.doc.map, start, p.cell);
        env.notify('info', `Copied a ${toolState.pattern.w} x ${toolState.pattern.h} pattern. Click to stamp it. Esc forgets it.`);
      }
      start = null;
      env.setPreview([]);
    },
    cancel(env) {
      start = null;
      env.setPreview([]);
    },
    hover(p, env) {
      if (p.cell && toolState.pattern) env.setPreview([{ kind: 'cells', cells: outline(p.cell, toolState.pattern), color: 0x6aa8ff, alpha: 0.35 }]);
      else env.setPreview(p.cell ? [{ kind: 'cells', cells: [p.cell], color: 0x6aa8ff, alpha: 0.35 }] : []);
    },
    key(k, env) {
      if (k === 'Escape' && toolState.pattern) {
        toolState.pattern = null;
        env.notify('info', 'Pattern cleared.');
        return true;
      }
      return false;
    },
  };
};

const placeTool = (): ToolImpl => ({
  down(p, env) {
    if (!p.cell || !env.doc.map.inBounds(p.cell.x, p.cell.y)) return;
    const map = env.doc.map;
    const x = p.cell.x + 0.5;
    const y = p.cell.y + 0.5;
    const h = Math.max(groundHeightAt(map, x, y), map.getDeck(p.cell.x, p.cell.y));
    const prefab = prefabById(env.opts.prefab, env.prefabs);
    const data = prefab.make(x, y, h);
    (data.components.transform as { facing: number }).facing = toolState.ghostFacing;
    if (prefab.id === 'player') {
      const existing = env.doc.entities.find((e) => e.tags.includes('player'));
      if (existing) {
        env.doc.updateEntities([existing.id], 'Move player start', (e) => {
          Object.assign(e.components.transform as object, { x, y, h });
        });
        env.select([existing.id]);
        return;
      }
    }
    const [added] = env.doc.addEntities([{ ...data, name: uniqueName(env.doc, data.name) }], `Place ${prefab.label.toLowerCase()}`);
    if (added) env.select([added.id]);
  },
  move(p, env) {
    this.hover(p, env);
  },
  up() {},
  cancel(env) {
    env.setPreview([]);
  },
  hover(p, env) {
    if (!p.cell) return env.setPreview([]);
    const map = env.doc.map;
    const h = map.inBounds(p.cell.x, p.cell.y) ? Math.max(groundHeightAt(map, p.cell.x + 0.5, p.cell.y + 0.5), map.getDeck(p.cell.x, p.cell.y)) : 0;
    env.setPreview([{ kind: 'ghost', x: p.cell.x + 0.5, y: p.cell.y + 0.5, h, prefab: env.opts.prefab }]);
  },
  key(k) {
    if (k.toLowerCase() === 'r') {
      toolState.ghostFacing = (toolState.ghostFacing + 2) % 8;
      return true;
    }
    return false;
  },
});

export function uniqueName(doc: EditorDoc, base: string): string {
  const names = new Set(doc.entities.map((e) => e.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

const regionTool = (): ToolImpl =>
  dragTool(
    (a, b) => rectCells(a, b),
    (a, b, _p, env) => {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(a.x - b.x) + 1;
      const h = Math.abs(a.y - b.y) + 1;
      const n = env.doc.regions.length + 1;
      const r = env.doc.addRegion({ name: `Room ${n}`, x, y, w, h, cameraBounds: false, music: '', darkness: 0, bossActive: false });
      env.select([], r.id);
    },
    0xb18cff,
  );

/** Cells of a two-cell-wide L-shaped corridor from a to b (horizontal first, then vertical). */
export function corridorCells(a: P, b: P): P[] {
  const out = new Map<string, P>();
  const add = (x: number, y: number): void => void out.set(`${x},${y}`, { x, y });
  const sx = Math.sign(b.x - a.x) || 1;
  const sy = Math.sign(b.y - a.y) || 1;
  for (let x = a.x; x !== b.x + sx; x += sx) {
    add(x, a.y);
    add(x, a.y + 1);
  }
  for (let y = a.y; y !== b.y + sy; y += sy) {
    add(b.x, y);
    add(b.x + 1, y);
  }
  return [...out.values()];
}

/** Brick walls around a rectangle, a flat floor inside. */
export function roomPlan(a: P, b: P): { floor: P[]; walls: P[] } {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const floor: P[] = [];
  const walls: P[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) (x === x0 || x === x1 || y === y0 || y === y1 ? walls : floor).push({ x, y });
  }
  return { floor, walls };
}

const CLEAN: Partial<CellData> = { slope: 0, flags: 0, deck: 0, deckTile: 0, oneWay: 0 };

const roomTool = (): ToolImpl =>
  dragTool(
    (a, b) => rectCells(a, b),
    (a, b, _p, env) => {
      if (Math.abs(a.x - b.x) < 2 || Math.abs(a.y - b.y) < 2) {
        env.notify('warn', 'A room needs to be at least 3 cells wide and tall.');
        return;
      }
      const plan = roomPlan(a, b);
      const s = env.doc.beginStroke('Build room');
      for (const c of plan.floor) s.apply(c.x, c.y, { ...CLEAN, tile: env.opts.tile, height: 0 });
      for (const c of plan.walls) s.apply(c.x, c.y, { ...CLEAN, tile: 5, height: Math.max(1, env.opts.height) });
      s.commit();
      env.notify('info', 'Room built. Use the Eraser or Set height to open a doorway.');
    },
    0xb5654a,
  );

const corridorTool = (): ToolImpl =>
  dragTool(
    (a, b) => corridorCells(a, b),
    (a, b, _p, env) => {
      const s = env.doc.beginStroke('Carve corridor');
      for (const c of corridorCells(a, b)) s.apply(c.x, c.y, { ...CLEAN, tile: env.opts.tile, height: 0 });
      s.commit();
    },
    0xa3a7b3,
  );

const propsTool = (): ToolImpl =>
  dragTool(
    (a, b) => rectCells(a, b),
    (a, b, _p, env) => {
      const map = env.doc.map;
      const prefab = prefabById(env.opts.prefab);
      if (prefab.id === 'player') {
        env.notify('warn', 'A scene has one player start. Choose another object to scatter.');
        return;
      }
      const taken = new Set(env.doc.entities.map((e) => {
        const t = e.components.transform as { x: number; y: number } | undefined;
        return t ? `${Math.floor(t.x)},${Math.floor(t.y)}` : '';
      }));
      const items: ReturnType<typeof prefab.make>[] = [];
      for (const c of rectCells(a, b)) {
        if (!map.inBounds(c.x, c.y) || map.getTile(c.x, c.y) === EMPTY_TILE) continue;
        if (map.getFlags(c.x, c.y) & (FLAG.PIT | FLAG.WATER | FLAG.BLOCK) || map.getSlope(c.x, c.y) || map.getDeck(c.x, c.y) > 0) continue;
        if (taken.has(`${c.x},${c.y}`) || hash01(c.x, c.y, 91) >= env.opts.density * 0.5) continue;
        const data = prefab.make(c.x + 0.5, c.y + 0.5, map.getHeight(c.x, c.y));
        items.push({ ...data, name: `${data.name}` });
      }
      if (items.length === 0) {
        env.notify('warn', 'Nothing was placed: raise the density or choose open ground.');
        return;
      }
      env.doc.addEntities(items, 'Scatter props');
      env.notify('info', `Placed ${items.length} object${items.length > 1 ? 's' : ''}.`);
    },
    0x8e7cc3,
  );

const wireTool = (): ToolImpl => {
  let from: string | null = null;
  return {
    down(p, env) {
      from = env.pickEntity(p.screen);
      if (!from) env.notify('info', 'Start the wire on an object: drag from it to another object.');
    },
    move(p, env) {
      if (!from) return;
      const a = env.entityAnchor(from);
      if (!a) return;
      const w = env.worldAt(p.screen, a.h);
      env.setPreview([{ kind: 'wire', from: a, to: w }]);
    },
    up(p, env) {
      const start = from;
      from = null;
      env.setPreview([]);
      if (!start) return;
      const end = env.pickEntity(p.screen);
      if (!end) return;
      if (end === start) env.notify('info', 'Drag to a different object to connect them.');
      else env.connect(start, end);
    },
    cancel(env) {
      from = null;
      env.setPreview([]);
    },
    hover() {},
  };
};

export const TOOLS: Record<ToolId, ToolImpl> = {
  wire: wireTool(),
  room: roomTool(),
  corridor: corridorTool(),
  props: propsTool(),
  select: selectTool(),
  paint: brushTool('Paint tiles', (s, c, _p, env) => void s.apply(c.x, c.y, { tile: env.opts.tile }), { color: 0x6fae5b }),
  rect: dragTool(
    (a, b, _p, env) => rectOrOutline(a, b, env.opts.outline),
    (a, b, _p, env) => {
      const s = (env as ToolEnv).doc.beginStroke('Fill rectangle');
      for (const c of rectOrOutline(a, b, env.opts.outline)) s.apply(c.x, c.y, { tile: env.opts.tile });
      s.commit();
    },
    0x6fae5b,
  ),
  line: dragTool(
    (a, b, _p, env) => lineBetween(a, b).flatMap((c) => cellsAround(c, env.opts.size)),
    (a, b, _p, env) => {
      const s = env.doc.beginStroke('Draw line');
      for (const c of lineBetween(a, b)) for (const cell of cellsAround(c, env.opts.size)) s.apply(cell.x, cell.y, { tile: env.opts.tile });
      s.commit();
    },
    0x6fae5b,
  ),
  fill: {
    down(p, env) {
      if (!p.cell || !env.doc.map.inBounds(p.cell.x, p.cell.y)) return;
      const start = env.doc.map;
      const t0 = start.getTile(p.cell.x, p.cell.y);
      const h0 = start.getHeight(p.cell.x, p.cell.y);
      if (t0 === env.opts.tile) return;
      const cells = floodFill(start, p.cell, (c) => c.tile === t0 && c.height === h0);
      const s = env.doc.beginStroke('Fill area');
      for (const c of cells) s.apply(c.x, c.y, { tile: env.opts.tile });
      s.commit();
      env.notify('info', `Filled ${cells.length} cells.`);
    },
    move(p, env) {
      this.hover(p, env);
    },
    up() {},
    cancel() {},
    hover(p, env) {
      env.setPreview(p.cell ? [{ kind: 'cells', cells: [p.cell], color: 0x6fae5b, alpha: 0.4 }] : []);
    },
  },
  eraser: brushTool('Erase tiles', (s, c) => void s.apply(c.x, c.y, ERASED), { color: 0xff6b6b }),
  scatter: brushTool(
    'Scatter tiles',
    (s, c, _p, env) => {
      if (hash01(c.x, c.y, 17) < env.opts.density) s.apply(c.x, c.y, { tile: env.opts.tile });
    },
    { once: true, color: 0x6fae5b },
  ),
  stamp: stampTool(),
  raise: brushTool(
    'Raise ground',
    (s, c, p) => {
      const d = p.shift ? -1 : 1;
      s.apply(c.x, c.y, (cell) => (cell.tile === EMPTY_TILE ? {} : { height: Math.max(0, Math.min(MAX_HEIGHT, cell.height + d)) }));
    },
    { once: true, color: 0xffffff },
  ),
  lower: brushTool(
    'Lower ground',
    (s, c) => void s.apply(c.x, c.y, (cell) => (cell.tile === EMPTY_TILE ? {} : { height: Math.max(0, cell.height - 1) })),
    { once: true, color: 0xffffff },
  ),
  setheight: brushTool(
    'Set height',
    (s, c, _p, env) => void s.apply(c.x, c.y, (cell) => (cell.tile === EMPTY_TILE ? {} : { height: Math.max(0, Math.min(MAX_HEIGHT, env.opts.height)), slope: 0 })),
    { once: true, color: 0xffffff },
  ),
  smooth: {
    ...(() => {
      let stroke: Stroke | null = null;
      let seen = new Set<string>();
      const run = (p: Pointer, env: ToolEnv): void => {
        if (!stroke || !p.cell) return;
        const cells = cellsAround(p.cell, Math.max(3, env.opts.size)).filter((c) => !seen.has(key(c)));
        cells.forEach((c) => seen.add(key(c)));
        for (const r of smoothedHeights(env.doc.map, cells)) stroke.apply(r.x, r.y, { height: r.height });
      };
      const impl: ToolImpl = {
        down(p, env) {
          stroke = env.doc.beginStroke('Smooth ground');
          seen = new Set();
          run(p, env);
        },
        move(p, env) {
          run(p, env);
          impl.hover(p, env);
        },
        up() {
          stroke?.commit();
          stroke = null;
        },
        cancel() {
          stroke?.cancel();
          stroke = null;
        },
        hover(p, env) {
          env.setPreview(p.cell ? [{ kind: 'cells', cells: cellsAround(p.cell, Math.max(3, env.opts.size)), color: 0xffffff, alpha: 0.25 }] : []);
        },
      };
      return impl;
    })(),
  },
  stairs: slopeTool('stairs'),
  ramp: slopeTool('ramp'),
  cliff: dragTool(
    (a, b) => rectCells(a, b),
    (a, b, _p, env) => {
      const h = Math.max(0, Math.min(MAX_HEIGHT, env.opts.height));
      const s = env.doc.beginStroke('Raise cliff');
      for (const c of rectCells(a, b)) s.apply(c.x, c.y, { height: h, slope: 0, tile: env.opts.tile, flags: 0, deck: 0, deckTile: 0 });
      s.commit();
    },
    0xd0d3dc,
  ),
  pit: brushTool(
    'Paint pit',
    (s, c, p) =>
      void s.apply(c.x, c.y, (cell) =>
        p.shift ? { flags: cell.flags & ~FLAG.PIT } : { flags: cell.flags | FLAG.PIT, slope: 0, tile: ensureTile(cell, 1) },
      ),
    { color: 0x111318 },
  ),
  water: brushTool(
    'Paint water',
    (s, c, p, env) =>
      void s.apply(c.x, c.y, (cell) =>
        p.shift ? { flags: cell.flags & ~FLAG.WATER, tile: env.opts.tile === 4 ? 1 : env.opts.tile } : { flags: (cell.flags | FLAG.WATER) & ~FLAG.PIT, tile: 4, slope: 0 },
      ),
    { color: 0x4a90d9 },
  ),
  bridge: brushTool(
    'Paint bridge',
    (s, c, p, env) =>
      void s.apply(c.x, c.y, (cell) =>
        cell.tile === EMPTY_TILE ? {} : p.shift ? { deck: 0, deckTile: 0 } : { deck: Math.max(1, env.opts.bridgeLevel), deckTile: 6 },
      ),
    { color: 0x9c6b3f },
  ),
  block: brushTool(
    'Paint blocker',
    (s, c, p) => void s.apply(c.x, c.y, (cell) => (cell.tile === EMPTY_TILE ? {} : { flags: p.shift ? cell.flags & ~FLAG.BLOCK : cell.flags | FLAG.BLOCK })),
    { color: 0xff6b6b },
  ),
  oneway: {
    down(p, env) {
      if (!p.cell || !env.doc.map.inBounds(p.cell.x, p.cell.y)) return;
      const bit = env.opts.edge;
      env.doc.paint('Toggle one-way edge', [{ x: p.cell.x, y: p.cell.y, patch: (c) => ({ oneWay: c.oneWay ^ bit }) }]);
    },
    move(p, env) {
      this.hover(p, env);
    },
    up() {},
    cancel() {},
    hover(p, env) {
      env.setPreview(p.cell ? [{ kind: 'cells', cells: [p.cell], color: 0xffd34a, alpha: 0.4 }] : []);
    },
  },
  walktest: {
    down(p, env) {
      if (!p.cell || !env.doc.map.inBounds(p.cell.x, p.cell.y)) return;
      const set = reachableCells(env.doc.map, p.cell);
      toolState.walk = set;
      env.setWalk(set);
      env.notify('info', `The player can walk to ${set.size} cells from here.`);
    },
    move(p, env) {
      this.hover(p, env);
    },
    up() {},
    cancel() {},
    hover(p, env) {
      env.setPreview(p.cell ? [{ kind: 'cells', cells: [p.cell], color: 0x40e08a, alpha: 0.5 }] : []);
    },
    key(k, env) {
      if (k === 'Escape') {
        toolState.walk = null;
        env.setWalk(null);
        return true;
      }
      return false;
    },
  },
  place: placeTool(),
  region: regionTool(),
};
