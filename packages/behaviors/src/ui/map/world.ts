import { DEFAULT_TILESET, gridToScreen, screenToGrid, type IsoConfig, type MapSpec, type RegionData, type Simulation, type TileSet, type ViewRotation } from '@tilewright/runtime';
import { uiBridge } from '../screens-logic';
import type { MapSim } from './state';
import { host } from '../../plugins/host';

/**
 * What a map is a map of: a grid of cells with a tile, a height and perhaps a value in each, the regions on it, and how cells become
 * places on the picture of the map (from above, isometric like the game, or a picture with the markers placed on it).
 * No drawing in here: the numbers the drawing and the markers are made from.
 */

export interface MapWorld {
  w: number;
  h: number;
  tileAt(x: number, y: number): number;
  heightAt(x: number, y: number): number;
  /** The value a table or list gives a cell (for colouring by a column), if the source has one. */
  valueAt(x: number, y: number): number | string | undefined;
  tileset: TileSet;
  regions: RegionData[];
  /** Changes while the game runs (the scene being played): its picture is made again now and then. */
  dynamic: boolean;
  /** Changes when the world changes: the picture is made again when it does. */
  signature: string;
}

/** A scene as a host gives it to a map (the scene being played is read from the simulation instead). */
export interface SceneGrid {
  width: number;
  height: number;
  tiles: ArrayLike<number>;
  heights: ArrayLike<number>;
  regions: RegionData[];
  tileset?: TileSet;
}

const empty = (w: number, h: number): MapWorld => ({ w, h, tileAt: () => 0, heightAt: () => 0, valueAt: () => undefined, tileset: DEFAULT_TILESET, regions: [], dynamic: false, signature: `empty:${w}x${h}` });

const fromGrid = (g: SceneGrid, sim: MapSim, signature: string): MapWorld => ({
  w: g.width,
  h: g.height,
  tileAt: (x, y) => (x >= 0 && y >= 0 && x < g.width && y < g.height ? ((g.tiles[y * g.width + x] as number) ?? 0) : 0),
  heightAt: (x, y) => (x >= 0 && y >= 0 && x < g.width && y < g.height ? ((g.heights[y * g.width + x] as number) ?? 0) : 0),
  valueAt: () => undefined,
  tileset: g.tileset ?? sim.assets.tileset ?? DEFAULT_TILESET,
  regions: g.regions,
  dynamic: false,
  signature,
});

/** The world the map's source names. */
export function resolveWorld(sim: MapSim, spec: MapSpec): MapWorld {
  const src = spec.source;
  const bridge = uiBridge(sim);
  switch (src.kind) {
    case 'current': {
      const m = sim.map;
      if (!m) return empty(src.width, src.height);
      return {
        w: m.width,
        h: m.height,
        tileAt: (x, y) => m.getTile(x, y),
        heightAt: (x, y) => m.getHeight(x, y),
        valueAt: () => undefined,
        tileset: sim.assets.tileset ?? DEFAULT_TILESET,
        regions: sim.runtime.regions,
        dynamic: true,
        signature: `current:${sim.runtime.scene}:${m.width}x${m.height}:${sim.runtime.blockEdits}`,
      };
    }
    case 'scene': {
      if (src.scene === sim.runtime.scene || src.scene === '') return resolveWorld(sim, { ...spec, source: { ...src, kind: 'current' } });
      const g = bridge?.sceneGrid?.(src.scene) ?? null;
      return g ? fromGrid(g, sim, `scene:${src.scene}`) : empty(src.width, src.height);
    }
    case 'scenes': {
      // several scenes placed on one world layout (cells)
      const placed = src.scenes
        .map((s) => ({ at: s, g: s.scene === sim.runtime.scene ? currentAsGrid(sim) : (bridge?.sceneGrid?.(s.scene) ?? null) }))
        .filter((p): p is { at: (typeof src.scenes)[number]; g: SceneGrid } => p.g !== null);
      const w = placed.length > 0 ? Math.max(...placed.map((p) => p.at.x + p.g.width)) : src.width;
      const h = placed.length > 0 ? Math.max(...placed.map((p) => p.at.y + p.g.height)) : src.height;
      const at = (x: number, y: number): { g: SceneGrid; lx: number; ly: number } | null => {
        for (const p of placed) {
          const lx = x - p.at.x;
          const ly = y - p.at.y;
          if (lx >= 0 && ly >= 0 && lx < p.g.width && ly < p.g.height) return { g: p.g, lx, ly };
        }
        return null;
      };
      return {
        w,
        h,
        tileAt: (x, y) => {
          const c = at(x, y);
          return c ? ((c.g.tiles[c.ly * c.g.width + c.lx] as number) ?? 0) : 0;
        },
        heightAt: (x, y) => {
          const c = at(x, y);
          return c ? ((c.g.heights[c.ly * c.g.width + c.lx] as number) ?? 0) : 0;
        },
        valueAt: () => undefined,
        tileset: sim.assets.tileset ?? DEFAULT_TILESET,
        regions: placed.flatMap((p) => p.g.regions.map((r) => ({ ...r, x: r.x + p.at.x, y: r.y + p.at.y }))),
        dynamic: placed.some((p) => p.at.scene === sim.runtime.scene),
        signature: `scenes:${placed.map((p) => `${p.at.scene}@${p.at.x},${p.at.y}`).join('|')}:${sim.runtime.scene}`,
      };
    }
    case 'table': {
      const t = sim.assets.tables.get(src.table);
      if (!t) return empty(src.width, src.height);
      const values = new Map<number, number | string>();
      const tiles = new Map<number, number>();
      const heights = new Map<number, number>();
      let w = src.width;
      let h = src.height;
      for (const r of t.rows) {
        const x = Number(r.x);
        const y = Number(r.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        w = Math.max(w, x + 1);
        h = Math.max(h, y + 1);
      }
      for (const r of t.rows) {
        const x = Number(r.x);
        const y = Number(r.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const i = y * w + x;
        if (r.tile !== undefined && r.tile !== '') tiles.set(i, Number(r.tile) || 0);
        if (r.height !== undefined && r.height !== '') heights.set(i, Number(r.height) || 0);
        const v = r.value ?? r.region;
        if (v !== undefined && v !== '') values.set(i, typeof v === 'number' ? v : Number.isFinite(Number(v)) ? Number(v) : String(v));
      }
      return {
        w,
        h,
        tileAt: (x, y) => tiles.get(y * w + x) ?? 0,
        heightAt: (x, y) => heights.get(y * w + x) ?? 0,
        valueAt: (x, y) => values.get(y * w + x),
        tileset: sim.assets.tileset ?? DEFAULT_TILESET,
        regions: [],
        dynamic: false,
        signature: `table:${src.table}:${t.rows.length}:${t.rows.map((r) => `${r.x},${r.y},${r.tile ?? ''},${r.value ?? ''},${r.region ?? ''}`).join(';')}`,
      };
    }
    case 'list': {
      const def = host.ext.listSources.get(src.table.split(':')[0] ?? '');
      if (!def) return empty(src.width, src.height);
      let rows: { id: string; scope: Record<string, string | number | boolean> }[];
      try {
        rows = def.rows(sim as unknown as Simulation, src.table.includes(':') ? src.table.slice(src.table.indexOf(':') + 1) : '');
      } catch {
        rows = [];
      }
      const values = new Map<number, number | string>();
      const w = Math.max(src.width, ...rows.map((r) => Number(r.scope.x ?? 0) + 1));
      const h = Math.max(src.height, ...rows.map((r) => Number(r.scope.y ?? 0) + 1));
      for (const r of rows) {
        const v = r.scope.value ?? r.scope.tile;
        if (v !== undefined) values.set(Number(r.scope.y ?? 0) * w + Number(r.scope.x ?? 0), typeof v === 'boolean' ? (v ? 1 : 0) : v);
      }
      return { ...empty(w, h), valueAt: (x, y) => values.get(y * w + x), signature: `list:${src.table}:${[...values].join(',')}`, dynamic: true };
    }
    default:
      return empty(src.width, src.height);
  }
}

function currentAsGrid(sim: MapSim): SceneGrid {
  const m = sim.map!;
  return { width: m.width, height: m.height, tiles: m.tiles, heights: m.heights, regions: sim.runtime.regions };
}

// ---------- projection ----------

export interface Projection {
  kind: 'topdown' | 'iso' | 'picture';
  cell: number;
  w: number;
  h: number;
  /** Quarter turns of the world for iso (0 to 3). */
  turn: ViewRotation;
  /** The size of the plane (what the map is as one flat picture at zoom 1) and where its top left is in the projection's own coordinates. */
  plane: { x: number; y: number; w: number; h: number };
  iso?: IsoConfig;
}

export const rotationOf = (sim: MapSim): ViewRotation => ((((sim.runtime.view.rotation ?? 0) % 4) + 4) % 4) as ViewRotation;

export function makeProjection(sim: MapSim, spec: MapSpec, world: { w: number; h: number }): Projection {
  const cell = spec.view.cell;
  const kind = spec.projection.kind;
  if (kind !== 'iso') return { kind, cell, w: world.w, h: world.h, turn: 0, plane: { x: 0, y: 0, w: world.w * cell, h: world.h * cell } };
  const turn = (spec.projection.rotation === 'camera' ? rotationOf(sim) : ((((Math.round(spec.projection.angle / 90) % 4) + 4) % 4) as ViewRotation)) as ViewRotation;
  const iso: IsoConfig = { tileW: cell * 2, tileH: cell, heightPx: cell / 2, view: turn, mapW: world.w, mapH: world.h };
  const corners = [gridToScreen(0, 0, 0, iso), gridToScreen(world.w, 0, 0, iso), gridToScreen(0, world.h, 0, iso), gridToScreen(world.w, world.h, 0, iso)];
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  return { kind, cell, w: world.w, h: world.h, turn, plane: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, iso };
}

/** A place in the world (cells, fractions allowed) as a point of the plane (pixels at zoom 1, from the plane's top left). */
export function cellToPlane(p: Projection, x: number, y: number, height = 0): { x: number; y: number } {
  if (p.iso) {
    const s = gridToScreen(x, y, height, p.iso);
    return { x: s.x - p.plane.x, y: s.y - p.plane.y };
  }
  return { x: x * p.cell, y: y * p.cell };
}

/** The inverse: a point of the plane as a place in the world (on the ground). */
export function planeToCell(p: Projection, px: number, py: number): { x: number; y: number } {
  if (p.iso) return screenToGrid(px + p.plane.x, py + p.plane.y, 0, p.iso);
  return { x: px / p.cell, y: py / p.cell };
}

// ---------- the view: where the map is looking ----------

export interface MapView {
  zoom: number;
  /** The point of the plane in the middle of the window. */
  cx: number;
  cy: number;
  /** The map turns by this many degrees (topdown, from the camera or a fixed angle). */
  angle: number;
  w: number;
  h: number;
}

/** A point of the plane as a place in the window (pixels from its top left), and back. */
export function planeToView(v: MapView, px: number, py: number): { x: number; y: number } {
  const a = (v.angle * Math.PI) / 180;
  const dx = (px - v.cx) * v.zoom;
  const dy = (py - v.cy) * v.zoom;
  return { x: v.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: v.h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
}

export function viewToPlane(v: MapView, sx: number, sy: number): { x: number; y: number } {
  const a = (-v.angle * Math.PI) / 180;
  const dx = sx - v.w / 2;
  const dy = sy - v.h / 2;
  return { x: v.cx + (dx * Math.cos(a) - dy * Math.sin(a)) / v.zoom, y: v.cy + (dx * Math.sin(a) + dy * Math.cos(a)) / v.zoom };
}

/** The zoom at which the whole plane fits the window. */
export const fitZoom = (p: Projection, w: number, h: number): number => Math.max(0.01, Math.min(w / Math.max(1, p.plane.w), h / Math.max(1, p.plane.h)));
