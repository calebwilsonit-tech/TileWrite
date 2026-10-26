import { evalUiCondition, evalValue, fillValues, placeState, type MapNode, type MapSpec, type MarkerKind, type Simulation, type VariableValue } from '@tilewright/runtime';
import { host } from '../../plugins/host';
import { selfScope, withScope } from '../screens-logic';
import { isRevealed } from './fog';
import { addedMarkers, hiddenMarkers, type MapRun, type MapSim } from './state';
import type { FogState } from './state';

/**
 * The markers of a map: where they come from (a hand-placed list, tags, prefabs, regions, table rows, list sources, the world map's
 * places, or a source a plugin added), where each is, what state it is in, which show, in what order, and which merge when they overlap.
 */

export interface MapMarker {
  /** Unique on the map: the kind and the row. */
  id: string;
  kind: string;
  /** The row or object it came from. */
  rowId: string;
  /** In cells. */
  x: number;
  y: number;
  /** In pixels of the map's window (filled in once the view is known). */
  sx: number;
  sy: number;
  state: string;
  prefab: string;
  label: string;
  scope: Record<string, VariableValue>;
  rank: number;
  /** The index of the layer it is drawn in. */
  layer: number;
  choosable: boolean;
  /** For a marker that stands for several that overlap. */
  cluster?: { count: number; ids: string[] };
}

type Scope = Record<string, VariableValue>;

const sourceOf = (sim: MapSim) => ({ vars: sim.runtime.vars, tables: sim.assets.tables, world: sim.world });

interface RawMarker {
  rowId: string;
  x: number;
  y: number;
  scope: Scope;
  label?: string;
  state?: string;
}

const num = (v: VariableValue | undefined, d = 0): number => (typeof v === 'number' ? v : Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);

/** A number from a row: a name of one of its values ("x"), or a little arithmetic with {values} in it. */
function valueOf(sim: MapSim, scope: Scope, expr: string, d = 0): number {
  const e = expr.trim();
  if (e === '') return d;
  if (/^[A-Za-z_][\w.]*$/.test(e)) {
    const hit = scope[e] ?? scope[`row.${e}`] ?? scope[`place.${e}`];
    if (hit !== undefined) return num(hit, d);
  }
  return withScope(sim, scope, () => num(evalValue(sourceOf(sim), e.includes('{') ? e : `{${e}}`), d));
}

/** The markers of one kind, before anything is asked of them. */
function rawMarkers(sim: MapSim, kind: MarkerKind, run: MapRun, mapId: string): RawMarker[] {
  const out: RawMarker[] = [];
  const plane = (scope: Scope): { x: number; y: number } => ({ x: valueOf(sim, scope, kind.x, 0), y: valueOf(sim, scope, kind.y, 0) });
  switch (kind.from) {
    case 'hand': {
      for (const m of [...kind.hand, ...addedMarkers(sim, mapId, run).filter((a) => a.kind === kind.id)]) out.push({ rowId: m.id, x: m.x, y: m.y, scope: { 'marker.label': m.label, 'marker.name': m.label }, label: m.label, state: m.state });
      break;
    }
    case 'tags': {
      for (const e of sim.world.withTag(kind.source)) {
        const t = e.get<{ x: number; y: number }>('transform');
        if (!t) continue;
        let at = { x: t.x, y: t.y };
        // a kind that does not follow its objects keeps the place each was first seen at
        if (!kind.follows) {
          const k = `${kind.id}:${e.id}`;
          const seen = run.frozen.get(k);
          if (seen) at = seen;
          else run.frozen.set(k, at);
        }
        out.push({ rowId: `e${e.id}`, x: at.x, y: at.y, scope: { ...selfScope(e), 'marker.name': e.name }, label: e.name });
      }
      break;
    }
    case 'prefabs': {
      for (const e of sim.world.all()) {
        const meta = e.get<{ prefab?: string }>('meta');
        if ((meta?.prefab ?? '') !== kind.source && e.name !== kind.source) continue;
        const t = e.get<{ x: number; y: number }>('transform');
        if (t) out.push({ rowId: `e${e.id}`, x: t.x, y: t.y, scope: { ...selfScope(e), 'marker.name': e.name }, label: e.name });
      }
      break;
    }
    case 'regions': {
      const only = kind.source
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const r of sim.runtime.regions) {
        if (only.length > 0 && !only.includes(r.name) && !only.includes(r.id)) continue;
        out.push({ rowId: r.id, x: r.x + r.w / 2, y: r.y + r.h / 2, scope: { 'region.id': r.id, 'region.name': r.name, 'region.w': r.w, 'region.h': r.h, 'marker.name': r.name }, label: r.name });
      }
      break;
    }
    case 'table': {
      const name = kind.source.replace(/^table:/, '');
      const t = sim.assets.tables.get(name);
      (t?.rows ?? []).forEach((r, i) => {
        const scope: Scope = { 'row.id': r.id, index: i + 1 };
        for (const c of t!.columns) scope[`row.${c.id}`] = (r[c.id] ?? '') as VariableValue;
        const p = plane(scope);
        out.push({ rowId: r.id, x: p.x, y: p.y, scope, label: String(scope['row.name'] ?? scope['row.label'] ?? r.id) });
      });
      break;
    }
    case 'list': {
      const colon = kind.source.indexOf(':');
      const def = host.ext.listSources.get(colon < 0 ? kind.source : kind.source.slice(0, colon));
      if (!def) break;
      try {
        def.rows(sim as unknown as Simulation, colon < 0 ? '' : kind.source.slice(colon + 1)).forEach((r, i) => {
          const scope: Scope = { index: i + 1, ...r.scope };
          const p = plane(scope);
          out.push({ rowId: r.id, x: p.x, y: p.y, scope, label: String(scope['place.name'] ?? scope['row.name'] ?? scope['marker.name'] ?? r.id) });
        });
      } catch {
        /* the plugin's failure is recorded against it by the host */
      }
      break;
    }
    case 'places': {
      const world = sim.assets.worldMap;
      if (!world) break;
      const custom = (k: string, node: MapNode): boolean => host.ext.unlockRules.get(k)?.met(sim.runtime.vars, node) ?? false;
      world.nodes.forEach((n, i) => {
        const state = placeState(n, sim.runtime.vars, sim.runtime.scene, custom);
        if (state === 'hidden') return; // a place nobody has heard of is not drawn at all
        out.push({ rowId: n.id, x: n.x, y: n.y, scope: { 'place.id': n.id, 'place.name': sim.assets.strings.t(n.label), 'place.scene': n.scene, 'place.here': state === 'here' ? 1 : 0, 'place.state': state, 'place.icon': n.icon, 'place.x': n.x, 'place.y': n.y, index: i + 1 }, label: sim.assets.strings.t(n.label), state });
      });
      break;
    }
    default: {
      const def = host.ext.markerSources.get(kind.from);
      if (!def) break;
      try {
        for (const r of def.rows(sim as unknown as Simulation, { source: kind.source, settings: kind.settings })) out.push({ rowId: r.id, x: r.x, y: r.y, scope: r.scope, label: String(r.scope['marker.name'] ?? r.scope['name'] ?? r.id) });
      } catch {
        /* recorded against the plugin */
      }
    }
  }
  return out;
}

/** The first object with a tag, as a cell (for "how far is this marker from the player"). */
export function followedCell(sim: MapSim, tag: string): { x: number; y: number } | null {
  const e = sim.world.withTag(tag)[0];
  const t = e?.get<{ x: number; y: number }>('transform');
  return t ? { x: t.x, y: t.y } : null;
}

export interface MarkerContext {
  sim: MapSim;
  node: { id: string };
  spec: MapSpec;
  run: MapRun;
  zoom: number;
  fogs: { id: string; state: FogState }[];
  /** A place in the world as a place in the window. */
  toView(x: number, y: number): { x: number; y: number };
  /** Which layer draws markers of a kind. */
  layerOf(kind: string): number;
}

/** Every marker the map shows now: placed, in its state, passing its kind's condition, in drawing order, merged where they overlap. */
export function collectMarkers(c: MarkerContext): MapMarker[] {
  const { sim, spec, run } = c;
  const hidden = hiddenMarkers(sim, c.node.id);
  const here = followedCell(sim, 'player');
  const all: MapMarker[] = [];
  for (const kind of spec.markers) {
    for (const raw of rawMarkers(sim, kind, run, c.node.id)) {
      const id = `${kind.id}:${raw.rowId}`;
      if (hidden.has(id) || hidden.has(raw.rowId)) continue;
      const revealed: Scope = {};
      c.fogs.forEach((f, i) => {
        const v = isRevealed(f.state, Math.floor(raw.x), Math.floor(raw.y)) ? 1 : 0;
        revealed[`marker.revealed.${f.id}`] = v;
        if (i === 0) revealed['marker.revealed'] = v;
      });
      if (c.fogs.length === 0) revealed['marker.revealed'] = 1;
      const distance = here ? Math.hypot(raw.x - here.x, raw.y - here.y) : 0;
      const base: Scope = { ...raw.scope, 'marker.id': id, 'marker.kind': kind.id, 'marker.x': raw.x, 'marker.y': raw.y, 'marker.label': raw.label ?? '', 'map.zoom': c.zoom, 'map.distance': Math.round(distance * 100) / 100, ...revealed };
      const state = withScope(sim, base, () => (raw.state && raw.state !== '' ? raw.state : kind.state ? fillValues(kind.state, sourceOf(sim)) : ''));
      const scope: Scope = { ...base, 'marker.state': state };
      const shown = withScope(sim, scope, () => evalUiCondition(sourceOf(sim), kind.show));
      if (!shown) continue;
      const rank = kind.sort ? withScope(sim, scope, () => num(evalValue(sourceOf(sim), kind.sort.includes('{') ? kind.sort : `{${kind.sort}}`), 0)) : 0;
      const p = c.toView(raw.x, raw.y);
      all.push({ id, kind: kind.id, rowId: raw.rowId, x: raw.x, y: raw.y, sx: p.x, sy: p.y, state, prefab: kind.statePrefabs[state] ?? kind.prefab, label: raw.label ?? '', scope: { ...scope, 'marker.rank': rank }, rank, layer: c.layerOf(kind.id), choosable: kind.choosable });
    }
  }
  all.sort((a, b) => a.rank - b.rank);
  return mergeOverlapping(all, spec);
}

/** Markers of a kind that has a cluster distance merge when they are closer than it on the screen. */
export function mergeOverlapping(list: MapMarker[], spec: MapSpec): MapMarker[] {
  const out: MapMarker[] = [];
  const taken = new Set<string>();
  const kinds = new Map(spec.markers.map((k) => [k.id, k]));
  for (const m of list) {
    if (taken.has(m.id)) continue;
    const kind = kinds.get(m.kind);
    if (!kind || kind.cluster <= 0) {
      out.push(m);
      continue;
    }
    const group = [m];
    for (const o of list) {
      if (o === m || taken.has(o.id) || o.kind !== m.kind) continue;
      if (Math.hypot(o.sx - m.sx, o.sy - m.sy) <= kind.cluster) group.push(o);
    }
    if (group.length === 1) {
      out.push(m);
      continue;
    }
    for (const g of group) taken.add(g.id);
    const cx = group.reduce((s, g) => s + g.sx, 0) / group.length;
    const cy = group.reduce((s, g) => s + g.sy, 0) / group.length;
    const x = group.reduce((s, g) => s + g.x, 0) / group.length;
    const y = group.reduce((s, g) => s + g.y, 0) / group.length;
    const ids = group.map((g) => g.id);
    out.push({
      ...m,
      id: `cluster:${m.id}`,
      sx: cx,
      sy: cy,
      x,
      y,
      prefab: kind.clusterPrefab || m.prefab,
      state: 'cluster',
      label: `${group.length}`,
      scope: { ...m.scope, 'marker.id': `cluster:${m.id}`, 'marker.count': group.length, 'marker.state': 'cluster', 'marker.x': x, 'marker.y': y },
      cluster: { count: group.length, ids },
    });
  }
  return out;
}
