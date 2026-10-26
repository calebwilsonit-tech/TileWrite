import { filled, registerAction, str, type ActionDef } from '../../events/sheet';
import { addMarkerToMap, cameraTo, chooseHighlighted, chooseMarker, findLiveMap, hideMarkerOnMap, highlightMarker, moveHighlightBy, panMap, recentreMap, removeMarkerFromMap, revealOnMap, stepHighlightBy, zoomMap } from './actions';
import type { Dir } from './nav';

/**
 * The Quick Actions of a Map widget. Every one names the map by the name of its widget (blank: the first map on screen), so a button,
 * a wire, an event row, a graph or a script can drive any map.
 */

const MAP: { key: string; label: string; type: 'text'; default: string } = { key: 'map', label: 'Map (the name of its widget; blank: the first one)', type: 'text', default: '' };
const num = (ctx: Parameters<ActionDef['run']>[0], p: Record<string, unknown>, k: string, d = 0): number => {
  const n = Number(filled(ctx, p, k));
  return Number.isFinite(n) ? n : d;
};

export const MAP_ACTIONS: ActionDef[] = [
  {
    id: 'mapHighlight',
    label: 'Move a map\'s highlight',
    category: 'Interface',
    params: [
      MAP,
      { key: 'how', label: 'Move', type: 'select', default: 'next', options: [{ value: 'up', label: 'up' }, { value: 'down', label: 'down' }, { value: 'left', label: 'left' }, { value: 'right', label: 'right' }, { value: 'next', label: 'to the next marker' }, { value: 'previous', label: 'to the earlier marker' }, { value: 'marker', label: 'to the marker with this id' }] },
      { key: 'marker', label: 'Marker id (for "to the marker with this id")', type: 'text', default: '' },
    ],
    describe: (p) => (str(p, 'how') === 'marker' ? `highlight the marker "${str(p, 'marker')}" on the map` : `move the map's highlight ${str(p, 'how') || 'next'}`),
    run(ctx, p) {
      const live = findLiveMap(ctx, filled(ctx, p, 'map'));
      if (!live) return;
      const how = str(p, 'how');
      if (how === 'marker') highlightMarker(ctx, live, filled(ctx, p, 'marker'));
      else if (how === 'next') stepHighlightBy(ctx, live, 1);
      else if (how === 'previous') stepHighlightBy(ctx, live, -1);
      else moveHighlightBy(ctx, live, how as Dir);
    },
  },
  {
    id: 'mapChoose',
    label: 'Choose a marker on a map (what choosing it does is set on the map)',
    category: 'Interface',
    params: [MAP, { key: 'marker', label: 'Marker id (blank: the highlighted one)', type: 'text', default: '' }],
    describe: (p) => (str(p, 'marker') ? `choose the marker "${str(p, 'marker')}" on the map` : "choose the map's highlighted marker"),
    run(ctx, p) {
      const live = findLiveMap(ctx, filled(ctx, p, 'map'));
      if (!live) return;
      const id = filled(ctx, p, 'marker');
      if (id) chooseMarker(ctx, live, id);
      else chooseHighlighted(ctx, live);
    },
  },
  {
    id: 'mapZoom',
    label: 'Zoom a map',
    category: 'Interface',
    params: [
      MAP,
      { key: 'how', label: 'Zoom', type: 'select', default: 'in', options: [{ value: 'in', label: 'in' }, { value: 'out', label: 'out' }, { value: 'to', label: 'to this zoom' }] },
      { key: 'amount', label: 'By how much (1.25 = a quarter more), or the zoom to go to', type: 'text', default: '1.25' },
    ],
    describe: (p) => `zoom the map ${str(p, 'how') || 'in'}`,
    run(ctx, p) {
      const live = findLiveMap(ctx, filled(ctx, p, 'map'));
      if (live) zoomMap(ctx, live, (str(p, 'how') || 'in') as 'in' | 'out' | 'to', num(ctx, p, 'amount', 1.25));
    },
  },
  {
    id: 'mapCamera',
    label: 'Move a map\'s view',
    category: 'Interface',
    params: [
      MAP,
      { key: 'to', label: 'Move', type: 'select', default: 'cell', options: [{ value: 'cell', label: 'to a cell (a place in the world)' }, { value: 'marker', label: 'to a marker' }, { value: 'by', label: 'by some pixels' }, { value: 'home', label: 'back to where it normally looks' }] },
      { key: 'x', label: 'Across (a cell, or pixels)', type: 'text', default: '0' },
      { key: 'y', label: 'Down (a cell, or pixels)', type: 'text', default: '0' },
      { key: 'marker', label: 'Marker id', type: 'text', default: '' },
      { key: 'zoom', label: 'Zoom to (blank: leave it)', type: 'text', default: '' },
    ],
    describe: (p) => (str(p, 'to') === 'home' ? "put the map's view back" : `move the map's view ${str(p, 'to') || 'to a cell'}`),
    run(ctx, p) {
      const live = findLiveMap(ctx, filled(ctx, p, 'map'));
      if (!live) return;
      const zoomText = filled(ctx, p, 'zoom');
      const zoom = zoomText === '' ? undefined : Number(zoomText);
      switch (str(p, 'to')) {
        case 'home':
          return recentreMap(ctx, live);
        case 'by':
          return panMap(ctx, live, num(ctx, p, 'x'), num(ctx, p, 'y'));
        case 'marker': {
          const m = live.info?.markers.find((x) => x.id === filled(ctx, p, 'marker') || x.rowId === filled(ctx, p, 'marker'));
          if (m) cameraTo(ctx, live, m.x, m.y, Number.isFinite(zoom) ? zoom : undefined);
          return;
        }
        default:
          cameraTo(ctx, live, num(ctx, p, 'x'), num(ctx, p, 'y'), zoom !== undefined && Number.isFinite(zoom) ? zoom : undefined);
      }
    },
  },
  {
    id: 'mapReveal',
    label: 'Reveal or cover part of a map\'s fog',
    category: 'Interface',
    params: [
      MAP,
      { key: 'layer', label: 'Fog layer (its id or name; blank: the first)', type: 'text', default: '' },
      { key: 'area', label: 'Area: a region name, "x,y,w,h", or "circle:x,y,radius"', type: 'text', default: '' },
      { key: 'cover', label: 'Do', type: 'select', default: 'reveal', options: [{ value: 'reveal', label: 'reveal it' }, { value: 'cover', label: 'cover it again' }] },
    ],
    describe: (p) => `${str(p, 'cover') === 'cover' ? 'cover' : 'reveal'} "${str(p, 'area')}" on the map`,
    run(ctx, p) {
      const live = findLiveMap(ctx, filled(ctx, p, 'map'));
      if (live) revealOnMap(ctx, live, filled(ctx, p, 'layer'), filled(ctx, p, 'area'), str(p, 'cover') === 'cover');
    },
  },
  {
    id: 'mapMarker',
    label: 'Add, hide, show or remove a marker on a map',
    category: 'Interface',
    params: [
      MAP,
      { key: 'op', label: 'Do', type: 'select', default: 'add', options: [{ value: 'add', label: 'add a marker' }, { value: 'remove', label: 'remove a marker that was added' }, { value: 'hide', label: 'hide a marker' }, { value: 'show', label: 'show a hidden marker' }] },
      { key: 'kind', label: 'Marker kind (its id on the map)', type: 'text', default: '' },
      { key: 'id', label: 'Marker id (the row or object it is for)', type: 'text', default: '' },
      { key: 'x', label: 'Across (cells), when adding', type: 'text', default: '0' },
      { key: 'y', label: 'Down (cells), when adding', type: 'text', default: '0' },
      { key: 'label', label: 'Words it carries, when adding', type: 'text', default: '' },
      { key: 'state', label: 'State, when adding', type: 'text', default: '' },
    ],
    describe: (p) => `${str(p, 'op') || 'add'} the marker "${str(p, 'id')}" on the map`,
    run(ctx, p) {
      const live = findLiveMap(ctx, filled(ctx, p, 'map'));
      if (!live) return;
      const id = filled(ctx, p, 'id');
      const kind = filled(ctx, p, 'kind') || live.info?.spec.markers[0]?.id || '';
      switch (str(p, 'op')) {
        case 'remove':
          return removeMarkerFromMap(ctx, live, kind, id);
        case 'hide':
          return hideMarkerOnMap(ctx, live, id, true);
        case 'show':
          return hideMarkerOnMap(ctx, live, id, false);
        default:
          addMarkerToMap(ctx, live, { id: id || `m${ctx.tick}`, kind, x: num(ctx, p, 'x'), y: num(ctx, p, 'y'), label: filled(ctx, p, 'label'), state: filled(ctx, p, 'state') });
      }
    },
  },
];

let installed = false;
/** Put the actions in the event sheet's pickers (once). */
export function installMapActions(): void {
  if (installed) return;
  installed = true;
  for (const a of MAP_ACTIONS) registerAction(a);
}

installMapActions();
