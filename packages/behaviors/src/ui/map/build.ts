import { MapSpecSchema, evalUiCondition, type MapLayer, type MapSpec, type Simulation, type UiNode, type VariableValue } from '@tilewright/runtime';
import { host } from '../../plugins/host';
import { partNode, makePart, controlState } from '../screens-controls';
import { instanceStub, withScope, type ViewNode } from '../screens-logic';
import { fogDraw } from './fog';
import { parseColour, regionItems, settingBool, settingNumber, settingText, terrainColours, cssOfRgba } from './layers';
import { collectMarkers, followedCell, type MapMarker } from './markers';
import { choosable as choosableOf, startMarker } from './nav';
import { fogCells, liveMaps, mapRun, type MapRun } from './state';
import type { LayerData, LayerPlan, MapInfo } from './view';
import { cellToPlane, fitZoom, makeProjection, planeToView, resolveWorld, rotationOf, type MapView, type MapWorld, type Projection } from './world';

/**
 * Works out a Map widget for this frame: the world it shows, where it looks, what each layer needs to be drawn, the markers (placed,
 * in their state, filtered, merged) and which one is highlighted. The markers are ordinary widgets (a UI prefab each); the layers
 * are painted by the screen from the plans made here.
 */

const DEFAULT_SPEC: MapSpec = MapSpecSchema.parse({});
const sourceOf = (sim: Simulation) => ({ vars: sim.runtime.vars, tables: sim.assets.tables, world: sim.world });
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface TerrainCache {
  sig: string;
  colours: Uint32Array;
}

function terrainOf(sim: Simulation, key: string, world: MapWorld, layer: MapLayer): Uint32Array {
  let cache = sim.runtime.scratch.get('ui.mapTerrain') as Map<string, TerrainCache> | undefined;
  if (!cache) {
    cache = new Map();
    sim.runtime.scratch.set('ui.mapTerrain', cache);
  }
  const sig = `${world.signature}|${JSON.stringify(layer.settings)}|${world.dynamic ? Math.floor(sim.tick / 30) : 0}`;
  const hit = cache.get(key);
  if (hit && hit.sig === sig) return hit.colours;
  const colours = terrainColours(world, layer.settings);
  cache.set(key, { sig, colours });
  return colours;
}

/** The centre of the view and where it is looking, from the map's rule and what the player (or an action) did to it. */
function viewOf(sim: Simulation, spec: MapSpec, run: MapRun, proj: Projection, w: number, h: number): { view: MapView; zoom: number } {
  const zoom = clamp(run.zoom, spec.view.zoomMin, spec.view.zoomMax);
  const scale = spec.view.fit ? fitZoom(proj, w, h) * zoom : zoom;
  let cx = proj.plane.w / 2;
  let cy = proj.plane.h / 2;
  const rule = spec.view.centre.trim();
  if (rule.startsWith('follow:')) {
    const at = followedCell(sim, rule.slice(7).trim() || 'player');
    if (at) {
      const p = cellToPlane(proj, at.x, at.y);
      cx = p.x;
      cy = p.y;
    }
  } else if (rule !== '' && rule !== 'auto') {
    const [x, y] = rule.split(',').map((t) => Number(t.trim()));
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const p = cellToPlane(proj, x!, y!);
      cx = p.x;
      cy = p.y;
    }
  }
  if (run.cx !== null && run.cy !== null) {
    cx = run.cx;
    cy = run.cy;
  }
  const angle = proj.kind === 'iso' ? 0 : spec.view.turn === 'camera' ? rotationOf(sim) * 90 : spec.view.turn === 'fixed' ? spec.view.turnAngle : 0;
  return { view: { zoom: scale, cx, cy, angle, w, h }, zoom };
}

const dataSig = (plan: LayerPlan, world: MapWorld, sim: Simulation): string => {
  const d = plan.data;
  switch (d.kind) {
    case 'terrain':
      return `${world.signature}|${world.dynamic ? Math.floor(sim.tick / 30) : 0}`;
    case 'fog':
      return `${d.draw.version}|${d.draw.look}|${d.draw.colour}|${d.draw.picture}|${d.draw.dim}`;
    case 'none':
      // a layer a plugin added is painted again a few times a second (it may show something that moves)
      return host.ext.mapLayers.has(plan.kind) ? String(Math.floor(sim.tick / 15)) : '';
    default:
      return JSON.stringify(d);
  }
};

function pathsOf(sim: Simulation, node: UiNode, s: Record<string, unknown>, markers: MapMarker[], toScope: (r: Record<string, VariableValue>) => boolean): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const from = settingText(s.from, 'places');
  if (from === 'places') {
    const map = sim.assets.worldMap;
    if (!map) return out;
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const shown = new Set(markers.filter((m) => m.scope['place.id'] !== undefined).map((m) => String(m.scope['place.id'])));
    for (const l of map.links) {
      const a = byId.get(l.a);
      const b = byId.get(l.b);
      // a link is drawn when both ends are (places nobody has heard of are not on the map), or always when no marker kind draws places
      if (!a || !b || (shown.size > 0 && (!shown.has(a.id) || !shown.has(b.id)))) continue;
      if (toScope({ 'link.a': a.id, 'link.b': b.id })) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  } else if (from === 'markers') {
    const kind = settingText(s.kind);
    const list = markers.filter((m) => m.kind === kind && !m.cluster);
    for (let i = 1; i < list.length; i++) if (toScope({ 'link.a': list[i - 1]!.rowId, 'link.b': list[i]!.rowId })) out.push({ x1: list[i - 1]!.x, y1: list[i - 1]!.y, x2: list[i]!.x, y2: list[i]!.y });
  } else if (from === 'table') {
    const t = sim.assets.tables.get(settingText(s.kind));
    const at = new Map(markers.map((m) => [m.rowId, m]));
    for (const r of t?.rows ?? []) {
      const a = at.get(String(r.a ?? ''));
      const b = at.get(String(r.b ?? ''));
      const seg = a && b ? { x1: a.x, y1: a.y, x2: b.x, y2: b.y } : Number.isFinite(Number(r.x1)) ? { x1: Number(r.x1), y1: Number(r.y1), x2: Number(r.x2), y2: Number(r.y2) } : null;
      if (seg && toScope({ 'link.a': String(r.a ?? ''), 'link.b': String(r.b ?? '') })) out.push(seg);
    }
  }
  void node;
  return out;
}

export function buildMap(sim: Simulation, out: ViewNode, node: UiNode, depth: number, visible: boolean): void {
  const spec = node.map ?? DEFAULT_SPEC;
  const run = mapRun(sim, node.id, spec);
  const world = resolveWorld(sim, spec);
  const proj = makeProjection(sim, spec, world);
  const w = run.view.w > 0 ? run.view.w : node.w;
  const h = run.view.h > 0 ? run.view.h : node.h;
  const { view, zoom } = viewOf(sim, spec, run, proj, w, h);
  run.zoom = zoom;
  const toView = (x: number, y: number): { x: number; y: number } => {
    const p = cellToPlane(proj, x, y);
    return planeToView(view, p.x, p.y);
  };
  const src = sourceOf(sim);
  const layerScope = { 'map.zoom': zoom };
  // which layers are on show now
  const plans: LayerPlan[] = [];
  const fogLayers = spec.layers.filter((l) => l.kind === 'fog');
  const fogs = fogLayers.map((l) => ({ id: l.id, state: fogCells(sim, node.id, l.id, run, world.w, world.h, settingBool(l.settings.saved, true)) }));
  const markerLayers = spec.layers.map((l, i) => ({ l, i })).filter((x) => x.l.kind === 'markers');
  const layerOf = (kind: string): number => {
    for (const { l, i } of markerLayers) {
      const kinds = settingText(l.settings.kinds)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (kinds.length === 0 || kinds.includes(kind)) return i;
    }
    return spec.layers.length;
  };
  const markers = collectMarkers({ sim, node, spec, run, zoom, fogs, toView, layerOf });
  const inLayer = new Set<string>();
  spec.layers.forEach((layer, index) => {
    const shown = withScope(sim, layerScope, () => evalUiCondition(src, layer.visible)) && (layer.zoomMin <= 0 || zoom >= layer.zoomMin) && (layer.zoomMax <= 0 || zoom <= layer.zoomMax);
    let data: LayerData = { kind: 'none' };
    const s = layer.settings;
    if (shown) {
      switch (layer.kind) {
        case 'terrain':
          data = { kind: 'terrain', colours: terrainOf(sim, `${node.id}.${layer.id}`, world, layer), w: world.w, h: world.h };
          break;
        case 'regions': {
          const when = settingText(s.when);
          const items = regionItems(world.regions, s, (r) => when === '' || withScope(sim, { ...layerScope, 'region.name': r.name, 'region.id': r.id, 'region.w': r.w, 'region.h': r.h, 'marker.revealed': 1 }, () => evalUiCondition(src, when)));
          data = { kind: 'regions', items, style: settingText(s.style, 'fill'), lineWidth: settingNumber(s.lineWidth, 2) };
          break;
        }
        case 'paths': {
          const when = settingText(s.when);
          const segs = pathsOf(sim, node, s, markers, (scope) => when === '' || withScope(sim, { ...layerScope, ...scope }, () => evalUiCondition(src, when)));
          data = { kind: 'paths', segs, colour: cssOfRgba(parseColour(settingText(s.colour, '#d9c6a0'))), dash: settingText(s.dash, '10,7'), lineWidth: settingNumber(s.lineWidth, 3) };
          break;
        }
        case 'fog':
          data = { kind: 'fog', draw: fogDraw(sim, node.id, layer, run, world) };
          break;
        case 'labels': {
          const when = settingText(s.when);
          const items: { text: string; x: number; y: number }[] = [];
          if (settingText(s.from, 'regions') === 'regions') {
            for (const r of world.regions) if (r.name && (when === '' || withScope(sim, { ...layerScope, 'region.name': r.name, 'region.id': r.id }, () => evalUiCondition(src, when)))) items.push({ text: sim.assets.strings.t(r.name), x: r.x + r.w / 2, y: r.y + r.h / 2 });
          } else {
            for (const m of markers) if (m.kind === settingText(s.kind) && m.label && !m.cluster && (when === '' || withScope(sim, m.scope, () => evalUiCondition(src, when)))) items.push({ text: m.label, x: m.x, y: m.y });
          }
          data = { kind: 'labels', items, colour: cssOfRgba(parseColour(settingText(s.colour, '#f4efe6'))), size: settingNumber(s.size, 12) };
          break;
        }
        default:
          break;
      }
    }
    const plan: LayerPlan = { id: layer.id, kind: layer.kind, index, opacity: layer.opacity, blend: layer.blend, visible: shown, settings: s, data, sig: '' };
    plan.sig = `${shown}|${dataSig(plan, world, sim)}|${view.zoom}|${view.cx}|${view.cy}|${view.angle}|${view.w}x${view.h}|${proj.turn}|${JSON.stringify(s)}`;
    plans.push(plan);
    if (layer.kind === 'markers' && shown) inLayer.add(layer.id);
  });

  // the highlight
  const here = followedCell(sim, 'player');
  const list = choosableOf(markers);
  if (!run.started) {
    run.started = true;
    run.highlight = startMarker(markers, spec.nav.start, here)?.id ?? '';
  }
  if (run.highlight && !list.some((m) => m.id === run.highlight)) run.highlight = '';

  const info: MapInfo = { id: node.id, spec, world, proj, view, zoom, layers: plans, markers, highlight: run.highlight, hover: run.hover, run };
  out.engine = true;
  out.map = info;
  const live = liveMaps(sim);
  live.set(node.id, { node, key: out.key, info });

  // the markers are widgets: a UI prefab each, in the layer that draws their kind
  const parts: ViewNode[] = [];
  const kinds = new Map(spec.markers.map((k) => [k.id, k]));
  markers.forEach((m, i) => {
    const kind = kinds.get(m.kind);
    const layer = plans[m.layer];
    const layerShown = layer ? layer.visible : true;
    const prefab = m.prefab ? { ...instanceStub(`map.marker.${m.kind}`, m.prefab), name: m.prefab } : partNode('map', 'marker', undefined);
    if (!prefab) return;
    const on = layerShown && m.sx > -80 && m.sy > -80 && m.sx < w + 80 && m.sy < h + 80;
    const scale = kind?.scaleWithZoom ? Math.max(0.3, Math.min(3, view.zoom / Math.max(0.0001, fitZoom(proj, w, h)))) : 1;
    const place: Record<string, string> = {
      left: `${Math.round(m.sx * 10) / 10}px`,
      top: `${Math.round(m.sy * 10) / 10}px`,
      transform: `translate(-50%, -50%)${scale === 1 ? '' : ` scale(${Math.round(scale * 100) / 100})`}`,
      'z-index': String((layer?.index ?? spec.layers.length) * 100 + 10 + Math.min(i, 80)),
    };
    if (layer && layer.opacity < 1) place.opacity = String(layer.opacity);
    if (layer && layer.blend !== 'normal') place['mix-blend-mode'] = layer.blend;
    const scope = { ...m.scope, 'marker.highlight': m.id === run.highlight ? 1 : 0, 'map.highlight': run.highlight, 'map.zoom': zoom, ...controlState(out) };
    parts.push(makePart(sim, out, 'map', 'marker', prefab, `m#${m.id}`, scope, place, 'overlay', depth, visible && on, m.choosable ? { kind: 'marker', id: m.id } : undefined));
  });
  out.parts = parts;
  writeBindings(sim, spec, run, markers, view, proj, zoom);
}

/** The values the rest of the game reads: the highlighted marker (and its row's fields), the zoom, the centre, the cell under the pointer. */
function writeBindings(sim: Simulation, spec: MapSpec, run: MapRun, markers: MapMarker[], view: MapView, proj: Projection, zoom: number): void {
  const bind = spec.bind.trim();
  if (!bind) return;
  const vars = sim.runtime.vars;
  const written = (sim.runtime.scratch.get(`ui.mapBind.${bind}`) as string[] | undefined) ?? [];
  const next = new Map<string, VariableValue>();
  const m = markers.find((x) => x.id === run.highlight);
  next.set(`${bind}.marker`, m?.id ?? '');
  next.set(`${bind}.kind`, m?.kind ?? '');
  next.set(`${bind}.state`, m?.state ?? '');
  next.set(`${bind}.label`, m?.label ?? '');
  next.set(`${bind}.row`, m?.rowId ?? '');
  next.set(`${bind}.x`, m ? Math.round(m.x * 100) / 100 : 0);
  next.set(`${bind}.y`, m ? Math.round(m.y * 100) / 100 : 0);
  if (m) for (const [k, v] of Object.entries(m.scope)) if (!k.startsWith('marker.') && !k.startsWith('map.')) next.set(`${bind}.${k}`, v);
  next.set(`${bind}.zoom`, Math.round(zoom * 1000) / 1000);
  const centre = proj.iso ? { x: view.cx, y: view.cy } : { x: view.cx / proj.cell, y: view.cy / proj.cell };
  next.set(`${bind}.centrex`, Math.round(centre.x * 10) / 10);
  next.set(`${bind}.centrey`, Math.round(centre.y * 10) / 10);
  next.set(`${bind}.cellx`, run.hover?.x ?? -1);
  next.set(`${bind}.celly`, run.hover?.y ?? -1);
  next.set(`${bind}.count`, markers.filter((x) => x.choosable).length);
  for (const k of written) if (!next.has(k)) delete vars[k];
  for (const [k, v] of next) if (vars[k] !== v) vars[k] = v;
  sim.runtime.scratch.set(`ui.mapBind.${bind}`, [...next.keys()]);
}
