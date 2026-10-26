import { evalUiCondition, lineOfSight, type MapLayer, type Simulation, type RegionData, type UiNode } from '@tilewright/runtime';
import { host } from '../../plugins/host';
import { settingBool, settingNumber, settingText } from './layers';
import { fogCells, mapRun, saveFog, type MapRun, type MapSim } from './state';
import { resolveWorld, type MapWorld } from './world';

/**
 * Fog and discovery. Each fog layer has its own rule for what is known: cells near where an object has been, regions it entered, a
 * condition, cells listed in a table, what it can see, or whatever a plugin's rule says. The cells that are known are kept (and saved
 * with the game when the layer says so); a Quick Action can reveal more.
 */

export interface FogDraw {
  version: number;
  cells: Uint8Array;
  w: number;
  h: number;
  look: string;
  colour: string;
  picture: string;
  dim: number;
}

/** The objects a fog layer follows (the tag in its settings), as cells. */
function followed(sim: MapSim, s: Record<string, unknown>): { x: number; y: number }[] {
  const tag = settingText(s.follow, 'player');
  const out: { x: number; y: number }[] = [];
  for (const e of sim.world.withTag(tag)) {
    const t = e.get<{ x: number; y: number }>('transform');
    if (t) out.push({ x: Math.floor(t.x), y: Math.floor(t.y) });
  }
  return out;
}

/** The cells inside a region, or a rectangle "x,y,w,h", or all. */
export function areaCells(area: string, world: { w: number; h: number; regions: readonly RegionData[] }): { x0: number; y0: number; x1: number; y1: number } | null {
  const a = area.trim();
  if (a === '' || a === 'all') return { x0: 0, y0: 0, x1: world.w, y1: world.h };
  const rect = a.split(',').map((t) => Number(t.trim()));
  if (rect.length === 4 && rect.every((n) => Number.isFinite(n))) return { x0: rect[0]!, y0: rect[1]!, x1: rect[0]! + rect[2]!, y1: rect[1]! + rect[3]! };
  const r = world.regions.find((g) => g.name === a || g.id === a);
  return r ? { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h } : null;
}

const touch = (f: { dirty: boolean; version: number }): void => {
  f.dirty = true;
  f.version++;
};

export function revealRect(f: { cells: Uint8Array; w: number; h: number; dirty: boolean; version: number }, r: { x0: number; y0: number; x1: number; y1: number }): number {
  let n = 0;
  for (let y = Math.max(0, r.y0); y < Math.min(f.h, r.y1); y++) {
    for (let x = Math.max(0, r.x0); x < Math.min(f.w, r.x1); x++) {
      const i = y * f.w + x;
      if (!f.cells[i]) {
        f.cells[i] = 1;
        touch(f);
        n++;
      }
    }
  }
  return n;
}

export function revealCircle(f: { cells: Uint8Array; w: number; h: number; dirty: boolean; version: number }, cx: number, cy: number, radius: number, canSee?: (x: number, y: number) => boolean): number {
  let n = 0;
  const r = Math.max(0, radius);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r + 0.5) continue;
      if (canSee && !canSee(x, y)) continue;
      const i = y * f.w + x;
      if (!f.cells[i]) {
        f.cells[i] = 1;
        touch(f);
        n++;
      }
    }
  }
  return n;
}

export const isRevealed = (f: { cells: Uint8Array; w: number; h: number }, x: number, y: number): boolean => x >= 0 && y >= 0 && x < f.w && y < f.h && f.cells[Math.floor(y) * f.w + Math.floor(x)] === 1;

/** One tick of one fog layer: what its rule knows now. */
export function updateFog(sim: MapSim, mapId: string, layer: MapLayer, run: MapRun, world: MapWorld): void {
  const s = layer.settings;
  const saved = settingBool(s.saved, true);
  const f = fogCells(sim, mapId, layer.id, run, world.w, world.h, saved);
  const kind = settingText(s.reveal, 'visited');
  const remember = settingBool(s.remember, true);
  const radius = settingNumber(s.radius, 4);
  // only what moved is worked out again
  const objects = kind === 'visited' || kind === 'sight' || kind === 'regions' ? followed(sim, s) : [];
  const sig = `${kind}|${radius}|${objects.map((o) => `${o.x},${o.y}`).join(';')}|${kind === 'variable' ? settingText(s.condition) + String(evalUiCondition({ vars: sim.runtime.vars, tables: sim.assets.tables, world: sim.world }, settingText(s.condition))) : ''}`;
  if (f.sig === sig && kind !== 'table' && !host.ext.fogRules.has(kind)) return;
  f.sig = sig;
  if (!remember && kind !== 'event' && kind !== 'table') {
    if (f.cells.some((c) => c === 1)) touch(f);
    f.cells.fill(0);
  }
  const reveal = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    const i = y * f.w + x;
    if (!f.cells[i]) {
      f.cells[i] = 1;
      touch(f);
    }
  };
  switch (kind) {
    case 'visited':
      for (const o of objects) revealCircle(f, o.x + 0.5, o.y + 0.5, radius);
      break;
    case 'sight': {
      for (const o of objects) {
        const viewer = world.heightAt(o.x, o.y);
        const blocked = (c: { x: number; y: number }): boolean => {
          const def = world.tileset[world.tileAt(c.x, c.y)];
          return def?.props?.blocksLight === true || def?.wall === true || world.heightAt(c.x, c.y) > viewer + 1;
        };
        revealCircle(f, o.x + 0.5, o.y + 0.5, radius, (x, y) => lineOfSight(o, { x, y }, blocked));
      }
      break;
    }
    case 'regions': {
      for (const o of objects) for (const r of world.regions) if (o.x >= r.x && o.y >= r.y && o.x < r.x + r.w && o.y < r.y + r.h) revealRect(f, { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
      break;
    }
    case 'variable': {
      const ok = evalUiCondition({ vars: sim.runtime.vars, tables: sim.assets.tables, world: sim.world }, settingText(s.condition));
      if (ok) {
        const rect = areaCells(settingText(s.area, 'all'), world);
        if (rect) revealRect(f, rect);
      }
      break;
    }
    case 'table': {
      const t = sim.assets.tables.get(settingText(s.table));
      for (const r of t?.rows ?? []) {
        if (r.region !== undefined && r.region !== '') {
          const rect = areaCells(String(r.region), world);
          if (rect) revealRect(f, rect);
        } else if (Number.isFinite(Number(r.x)) && Number.isFinite(Number(r.y))) {
          const rr = Number(r.r ?? r.radius ?? 0);
          if (rr > 0) revealCircle(f, Number(r.x) + 0.5, Number(r.y) + 0.5, rr);
          else reveal(Number(r.x), Number(r.y));
        }
      }
      break;
    }
    case 'event':
      break;
    default: {
      const def = host.ext.fogRules.get(kind);
      if (def) def.reveal(sim as unknown as Simulation, s, { w: world.w, h: world.h, regions: world.regions }, reveal);
    }
  }
}

/** How a fog layer is drawn: the cells known, and the look of the others. */
export function fogDraw(sim: MapSim, mapId: string, layer: MapLayer, run: MapRun, world: MapWorld): FogDraw {
  const s = layer.settings;
  const f = fogCells(sim, mapId, layer.id, run, world.w, world.h, settingBool(s.saved, true));
  return { version: f.version, cells: f.cells, w: f.w, h: f.h, look: settingText(s.look, 'hidden'), colour: settingText(s.colour, '#0b0d12'), picture: settingText(s.picture), dim: settingNumber(s.dimAmount, 0.55) };
}

/** Every map widget of the project: in screens and in UI prefabs (a fog layer keeps working while its screen is closed). */
export function mapWidgets(sim: MapSim): UiNode[] {
  const cache = sim.runtime.scratch.get('ui.mapWidgets') as { doc: unknown; list: UiNode[] } | undefined;
  if (cache && cache.doc === sim.assets.ui) return cache.list;
  const out: UiNode[] = [];
  const visit = (n: UiNode): void => {
    if (n.type === 'map') out.push(n);
    for (const c of n.children) visit(c);
  };
  for (const s of sim.assets.ui.screens) visit(s.root);
  for (const p of sim.assets.ui.prefabs) visit(p.widget);
  sim.runtime.scratch.set('ui.mapWidgets', { doc: sim.assets.ui, list: out });
  return out;
}

/** Once a tick, whether or not a map is on screen: every fog layer learns what its rule knows, and the saved ones are written to their variable now and then. */
export function trackMaps(sim: MapSim): void {
  for (const node of mapWidgets(sim)) {
    const spec = node.map;
    if (!spec || !spec.layers.some((l) => l.kind === 'fog')) continue;
    const run = mapRun(sim, node.id, spec);
    const world = resolveWorld(sim, spec);
    for (const layer of spec.layers) {
      if (layer.kind !== 'fog') continue;
      updateFog(sim, node.id, layer, run, world);
      if (settingBool(layer.settings.saved, true) && sim.tick % 30 === 0) {
        const f = run.fog.get(layer.id);
        if (f) saveFog(sim, node.id, layer.id, f);
      }
    }
  }
}
