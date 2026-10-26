import type { MapSpec, SimContext, UiNode } from '@tilewright/runtime';

/** What the map code needs of the game: the parts of the simulation that are also in a system's context, so Quick Actions can use it too. */
export type MapSim = Pick<SimContext, 'world' | 'events' | 'assets' | 'runtime' | 'map' | 'tick' | 'compat' | 'uiInput'>;
import type { MapInfo } from './view';

/**
 * What a map remembers. The view (zoom, where it looks, the highlighted marker) is not saved; what the game changed (markers added,
 * markers hidden, the cells that were revealed by a rule that is saved) lives in variables, so a saved game brings it back.
 */

export interface HandMarker {
  id: string;
  kind: string;
  x: number;
  y: number;
  label: string;
  state: string;
}

export interface FogState {
  cells: Uint8Array;
  w: number;
  h: number;
  dirty: boolean;
  /** Counts the changes, so a drawing of the layer knows when to be made again. */
  version: number;
  raw: string;
  /** What the rule looked at last time, so it is worked out again only when that changes. */
  sig: string;
}

export interface MapRun {
  zoom: number;
  /** The centre in plane pixels (null: not placed yet, the map centres itself). */
  cx: number | null;
  cy: number | null;
  /** The highlighted marker. '' none. */
  highlight: string;
  /** Has the highlight been set by the start rule yet? */
  started: boolean;
  /** The cell under the pointer. */
  hover: { x: number; y: number } | null;
  /** The window's size in pixels, as the last frame measured it. */
  view: { w: number; h: number };
  /** Holds for keys moving the view when the map pans. */
  holds: Record<string, { held: number; next: number }>;
  /** Fog: the cells each fog layer has revealed (1 = revealed), and whether it changed since it was written to its variable. */
  fog: Map<string, FogState>;
  /** Where each marker of a kind that does not follow its object was first seen. */
  frozen: Map<string, { x: number; y: number }>;
  /** Markers dropped on the map by the game (a cache of the variable). */
  added: { raw: string; list: HandMarker[] };
}

const STORE = 'ui.maps';
const LIVE = 'ui.mapsLive';

/** The map widgets on screen now, by widget id: what Quick Actions and scripts find a map by. */
export interface LiveMap {
  node: UiNode;
  key: string;
  info: MapInfo | null;
}
export function liveMaps(sim: MapSim): Map<string, LiveMap> {
  let m = sim.runtime.scratch.get(LIVE) as Map<string, LiveMap> | undefined;
  if (!m) {
    m = new Map();
    sim.runtime.scratch.set(LIVE, m);
  }
  return m;
}

/** A map by the name or the id of its widget; with no name, the first one on screen. */
export function findLiveMap(sim: MapSim, name: string): LiveMap | undefined {
  const all = liveMaps(sim);
  if (!name) return [...all.values()][0];
  return [...all.values()].find((m) => m.node.id === name || m.node.name === name);
}

export function mapRuns(sim: MapSim): Map<string, MapRun> {
  let m = sim.runtime.scratch.get(STORE) as Map<string, MapRun> | undefined;
  if (!m) {
    m = new Map();
    sim.runtime.scratch.set(STORE, m);
  }
  return m;
}

export function mapRun(sim: MapSim, id: string, spec: MapSpec): MapRun {
  const all = mapRuns(sim);
  let r = all.get(id);
  if (!r) {
    r = { zoom: spec.view.zoom, cx: null, cy: null, highlight: '', started: false, hover: null, view: { w: 0, h: 0 }, holds: {}, fog: new Map(), frozen: new Map(), added: { raw: '', list: [] } };
    all.set(id, r);
  }
  return r;
}

const varName = (id: string, what: string): string => `__map.${id}.${what}`;

// ---------- markers the game added or hid (saved in variables) ----------

export function addedMarkers(sim: MapSim, id: string, run: MapRun): HandMarker[] {
  const raw = String(sim.runtime.vars[varName(id, 'markers')] ?? '');
  if (raw !== run.added.raw) {
    run.added.raw = raw;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      run.added.list = Array.isArray(parsed) ? (parsed as HandMarker[]).filter((m) => typeof m?.id === 'string' && Number.isFinite(m.x) && Number.isFinite(m.y)) : [];
    } catch {
      run.added.list = [];
    }
  }
  return run.added.list;
}

export function setAddedMarkers(sim: MapSim, id: string, run: MapRun, list: HandMarker[]): void {
  const raw = list.length === 0 ? '' : JSON.stringify(list);
  sim.runtime.vars[varName(id, 'markers')] = raw;
  run.added = { raw, list };
}

export function hiddenMarkers(sim: MapSim, id: string): Set<string> {
  const raw = String(sim.runtime.vars[varName(id, 'hidden')] ?? '');
  return new Set(raw.split(',').filter(Boolean));
}

export function setHiddenMarkers(sim: MapSim, id: string, set: Set<string>): void {
  sim.runtime.vars[varName(id, 'hidden')] = [...set].join(',');
}

// ---------- fog (saved in a variable when the rule says so) ----------

const toBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x4000) s += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
};
const fromBase64 = (text: string): Uint8Array => {
  const s = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** One bit a cell, packed. */
export function packCells(cells: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(cells.length / 8));
  for (let i = 0; i < cells.length; i++) if (cells[i]) bytes[i >> 3]! |= 1 << (i & 7);
  return toBase64(bytes);
}
export function unpackCells(text: string, n: number): Uint8Array {
  const bytes = fromBase64(text);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bytes[i >> 3]! >> (i & 7)) & 1;
  return out;
}

/** The cells a fog layer has revealed. A saved layer reads them back from its variable when the variable changed (a game was loaded). */
export function fogCells(sim: MapSim, mapId: string, layerId: string, run: MapRun, w: number, h: number, saved: boolean): FogState {
  const key = layerId;
  const name = varName(mapId, `fog.${layerId}`);
  let f = run.fog.get(key);
  if (!f || f.w !== w || f.h !== h) {
    f = { cells: new Uint8Array(w * h), w, h, dirty: false, version: 0, raw: '', sig: '' };
    run.fog.set(key, f);
  }
  if (saved) {
    const raw = String(sim.runtime.vars[name] ?? '');
    if (raw !== f.raw) {
      f.raw = raw;
      f.cells = raw ? unpackCells(raw, w * h) : new Uint8Array(w * h);
      f.version++;
    }
  }
  return f;
}

/** Write a saved layer's cells to its variable (when they changed). */
export function saveFog(sim: MapSim, mapId: string, layerId: string, f: { cells: Uint8Array; dirty: boolean; raw: string }): void {
  if (!f.dirty) return;
  f.dirty = false;
  f.raw = packCells(f.cells);
  sim.runtime.vars[varName(mapId, `fog.${layerId}`)] = f.raw;
}
