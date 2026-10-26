import { runActionList } from '../../events/sheet';
import type { MapSim } from './state';
import { contextOf } from '../../story/context';
import { holdSteps } from '../scrolling';
import { withScope, type ViewNode } from '../screens-logic';
import { areaCells, revealCircle, revealRect } from './fog';
import { moveHighlight, stepHighlight, type Dir } from './nav';
import { addedMarkers, findLiveMap, fogCells, hiddenMarkers, setAddedMarkers, setHiddenMarkers, type HandMarker, type LiveMap } from './state';
import { cellToPlane, fitZoom, viewToPlane } from './world';
import type { Simulation } from '@tilewright/runtime';

/**
 * What can be done to a map, by the player (the keys, the pad, the mouse) and by the game (Quick Actions, event rows, scripts): move
 * the highlight, choose a marker, zoom, pan, centre, reveal fog, add and hide markers. All of them reach the same things.
 */

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Run a list of actions with the marker's values in view. */
function runWith(sim: MapSim, live: LiveMap, actions: unknown[], scope: Record<string, string | number | boolean>): void {
  if (actions.length === 0) return;
  withScope(sim, scope, () => runActionList(contextOf(sim as unknown as Simulation), actions as never));
}

export function highlightMarker(sim: MapSim, live: LiveMap, id: string): boolean {
  const info = live.info;
  if (!info) return false;
  const m = info.markers.find((x) => x.id === id && x.choosable);
  if (!m || info.run.highlight === id) return false;
  info.run.highlight = id;
  info.highlight = id;
  sim.events.emit('map-marker-highlighted', { map: live.node.id, marker: id, kind: m.kind, state: m.state });
  runWith(sim, live, info.spec.on.highlight, m.scope);
  return true;
}

/** Up, down, left or right from the highlighted marker. False when there was nowhere to go. */
export function moveHighlightBy(sim: MapSim, live: LiveMap, dir: Dir): boolean {
  const info = live.info;
  if (!info) return false;
  const next = moveHighlight(info.markers, info.run.highlight, dir, info.spec.nav.mode, info.spec.nav.wrap);
  return next ? highlightMarker(sim, live, next.id) || next.id === info.run.highlight : false;
}

export function stepHighlightBy(sim: MapSim, live: LiveMap, delta: -1 | 1): boolean {
  const info = live.info;
  if (!info) return false;
  const next = stepHighlight(info.markers, info.run.highlight, delta, info.spec.nav.wrap);
  return next ? highlightMarker(sim, live, next.id) || next.id === info.run.highlight : false;
}

/** Choose a marker: what the map's "when a marker is chosen" actions say. A group of overlapping markers zooms in on itself instead. */
export function chooseMarker(sim: MapSim, live: LiveMap, id: string): boolean {
  const info = live.info;
  if (!info) return false;
  const m = info.markers.find((x) => x.id === id);
  if (!m) return false;
  if (m.cluster) {
    cameraTo(sim, live, m.x, m.y, info.zoom * 2);
    return true;
  }
  sim.events.emit('map-marker-chosen', { map: live.node.id, marker: m.id, kind: m.kind, state: m.state, row: m.rowId });
  runWith(sim, live, info.spec.on.choose, m.scope);
  return true;
}

export function chooseHighlighted(sim: MapSim, live: LiveMap): boolean {
  const id = live.info?.run.highlight ?? '';
  return id ? chooseMarker(sim, live, id) : false;
}

export function zoomMap(sim: MapSim, live: LiveMap, how: 'in' | 'out' | 'to', amount = 1.25, aroundPx?: { x: number; y: number }): void {
  const info = live.info;
  if (!info) return;
  const run = info.run;
  const before = run.zoom;
  const next = clamp(how === 'to' ? amount : how === 'in' ? run.zoom * amount : run.zoom / amount, info.spec.view.zoomMin, info.spec.view.zoomMax);
  if (next === before) return;
  // zooming with the pointer keeps the place under it where it is
  if (aroundPx) {
    const p = viewToPlane(info.view, aroundPx.x, aroundPx.y);
    const ratio = before / next;
    const cx = info.run.cx ?? info.view.cx;
    const cy = info.run.cy ?? info.view.cy;
    run.cx = p.x + (cx - p.x) * ratio;
    run.cy = p.y + (cy - p.y) * ratio;
  }
  run.zoom = next;
  void sim;
}

/** Move the view by a number of pixels of the window. */
export function panMap(sim: MapSim, live: LiveMap, dx: number, dy: number): void {
  const info = live.info;
  if (!info) return;
  const a = (-info.view.angle * Math.PI) / 180;
  const px = (dx * Math.cos(a) - dy * Math.sin(a)) / info.view.zoom;
  const py = (dx * Math.sin(a) + dy * Math.cos(a)) / info.view.zoom;
  const w = info.proj.plane.w;
  const h = info.proj.plane.h;
  info.run.cx = clamp((info.run.cx ?? info.view.cx) + px, 0, w);
  info.run.cy = clamp((info.run.cy ?? info.view.cy) + py, 0, h);
  void sim;
}

/** Back to where the map's own rule looks (the middle, or the object it follows). */
export function recentreMap(sim: MapSim, live: LiveMap): void {
  if (!live.info) return;
  live.info.run.cx = null;
  live.info.run.cy = null;
  void sim;
}

/** Look at a place in the world (cells), and perhaps zoom. */
export function cameraTo(sim: MapSim, live: LiveMap, x: number, y: number, zoom?: number): void {
  const info = live.info;
  if (!info) return;
  const p = cellToPlane(info.proj, x, y);
  info.run.cx = p.x;
  info.run.cy = p.y;
  if (zoom !== undefined) info.run.zoom = clamp(zoom, info.spec.view.zoomMin, info.spec.view.zoomMax);
  void sim;
}

/**
 * Reveal (or cover again) part of a fog layer: a region by name, a rectangle "x,y,w,h", or a circle "x,y,r" written "circle:x,y,r".
 * Returns how many cells changed.
 */
export function revealOnMap(sim: MapSim, live: LiveMap, layerId: string, area: string, cover = false): number {
  const info = live.info;
  if (!info) return 0;
  const layer = info.spec.layers.find((l) => l.kind === 'fog' && (layerId === '' || l.id === layerId || l.name === layerId));
  if (!layer) return 0;
  const f = fogCells(sim, live.node.id, layer.id, info.run, info.world.w, info.world.h, layer.settings.saved !== false);
  let n = 0;
  const a = area.trim();
  if (cover) {
    const rect = areaCells(a, info.world);
    if (rect) {
      for (let y = Math.max(0, rect.y0); y < Math.min(f.h, rect.y1); y++) {
        for (let x = Math.max(0, rect.x0); x < Math.min(f.w, rect.x1); x++) {
          if (f.cells[y * f.w + x]) {
            f.cells[y * f.w + x] = 0;
            f.dirty = true;
            f.version++;
            n++;
          }
        }
      }
    }
  } else if (a.startsWith('circle:')) {
    const [x, y, r] = a.slice(7).split(',').map((t) => Number(t.trim()));
    if (Number.isFinite(x) && Number.isFinite(y)) n = revealCircle(f, x!, y!, Number.isFinite(r) ? r! : 3);
  } else {
    const rect = areaCells(a, info.world);
    if (rect) n = revealRect(f, rect);
  }
  if (n > 0 && !cover) sim.events.emit('map-area-revealed', { map: live.node.id, layer: layer.id, area: a, cells: n });
  if (n > 0 && !cover) runWith(sim, live, info.spec.on.reveal, { 'reveal.area': a, 'reveal.cells': n });
  return n;
}

export function hideMarkerOnMap(sim: MapSim, live: LiveMap, idOrRow: string, hide = true): void {
  const set = hiddenMarkers(sim, live.node.id);
  if (hide) set.add(idOrRow);
  else set.delete(idOrRow);
  setHiddenMarkers(sim, live.node.id, set);
}

export function addMarkerToMap(sim: MapSim, live: LiveMap, m: HandMarker): void {
  const info = live.info;
  if (!info) return;
  const list = addedMarkers(sim, live.node.id, info.run).filter((x) => !(x.kind === m.kind && x.id === m.id));
  setAddedMarkers(sim, live.node.id, info.run, [...list, m]);
}

export function removeMarkerFromMap(sim: MapSim, live: LiveMap, kind: string, id: string): void {
  const info = live.info;
  if (!info) return;
  setAddedMarkers(
    sim,
    live.node.id,
    info.run,
    addedMarkers(sim, live.node.id, info.run).filter((x) => !(x.id === id && (kind === '' || x.kind === kind))),
  );
}

export { findLiveMap };

// ---------- the player's keys and pad ----------

/**
 * The mapped buttons on a map that has the focus: the arrows move the highlight (or pan the view), the page buttons go marker to marker,
 * zoom buttons zoom, the recentre button centres. Returns the buttons it used, so the screen does not also move the focus with them.
 */
export function driveMapKeys(sim: MapSim, vn: ViewNode, dt = 1 / 60): Set<string> {
  const used = new Set<string>();
  const live = findLiveMap(sim, vn.node.id);
  const info = vn.map;
  if (!live || !info || !vn.enabled) return used;
  live.info = info;
  const nav = info.spec.nav;
  if (nav.keys === 'none') return used;
  const ui = sim.uiInput;
  const dirs: Dir[] = ['up', 'down', 'left', 'right'];
  for (const dir of dirs) {
    const action = nav.actions[dir];
    if (nav.keys === 'highlight') {
      if (ui.pressed(action) && moveHighlightBy(sim, live, dir)) used.add(action);
    } else if (ui.down(action)) {
      const speed = 420 * dt;
      panMap(sim, live, dir === 'left' ? -speed : dir === 'right' ? speed : 0, dir === 'up' ? -speed : dir === 'down' ? speed : 0);
      used.add(action);
    }
  }
  if (ui.pressed(nav.actions.next) && stepHighlightBy(sim, live, 1)) used.add(nav.actions.next);
  if (ui.pressed(nav.actions.prev) && stepHighlightBy(sim, live, -1)) used.add(nav.actions.prev);
  const holds = info.run.holds;
  for (const [name, how] of [['zoomIn', 'in'], ['zoomOut', 'out']] as const) {
    const action = nav.actions[name];
    const h = (holds[name] ??= { held: 0, next: 0 });
    const k = holdSteps(h, ui.down(action), dt, 0.3, 6, 1.5);
    for (let i = 0; i < k; i++) zoomMap(sim, live, how);
    if (ui.down(action)) used.add(action);
  }
  if (ui.pressed(nav.actions.recentre)) {
    recentreMap(sim, live);
    used.add(nav.actions.recentre);
  }
  if (nav.actions.select !== 'interact' && ui.pressed(nav.actions.select) && chooseHighlighted(sim, live)) used.add(nav.actions.select);
  return used;
}

/** Fit zoom in the window (for tests and the designer). */
export const fitOf = (live: LiveMap): number => (live.info ? fitZoom(live.info.proj, live.info.view.w, live.info.view.h) : 1);
