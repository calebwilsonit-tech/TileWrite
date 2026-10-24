import { MAP_HEIGHT, MAP_WIDTH, host, placeState, type MapNode, type WidgetDef } from '@tilewright/plugin-sdk';

const GLYPHS: Record<string, string> = { pin: '●', town: '⌂', dungeon: '☠', cave: '◓', forest: '♣', tower: '♜', castle: '♛', camp: '▲', harbor: '⚓' };

export const WORLD_MAP_CSS = `
.tw-map { width: 100%; height: auto; display: block; margin-bottom: 10px; border-radius: 8px; border: 1px solid #d9c6a055; background: #2a2418; pointer-events: auto; }
.tw-map .place { cursor: pointer; } .tw-map .place text { pointer-events: none; }
`;

/** The picture of the world map: places joined by paths, the one the player is in marked, locked ones as question marks. */
export const worldMapWidget: WidgetDef = {
  id: 'world-map',
  label: 'World map (the picture of the places the player can travel to)',
  defaults: { w: 560, h: 340, wMode: 'fill', hMode: 'auto' },
  render(el, _node, _values, ctx) {
    const sim = ctx?.sim;
    const map = sim?.assets.worldMap;
    if (!sim || !map) {
      el.replaceChildren();
      delete el.dataset.sig;
      return;
    }
    const custom = (kind: string, node: MapNode): boolean => host.ext.unlockRules.get(kind)?.met(sim.runtime.vars, node) ?? false;
    const state = new Map(map.nodes.map((n) => [n.id, placeState(n, sim.runtime.vars, sim.runtime.scene, custom)]));
    const t = (s: string): string => sim.assets.strings.t(s);
    // redrawn only when something about the places changed, so a click is never lost to a redraw
    const sig = JSON.stringify([map.nodes.map((n) => [n.id, n.x, n.y, n.label, n.icon]), map.links, [...state], sim.assets.strings.language]);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    svg.setAttribute('class', 'tw-map');
    svg.setAttribute('data-testid', 'tw-map');
    const make = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = svg): SVGElementTagNameMap[K] => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      parent.appendChild(e);
      return e;
    };
    const shown = (id: string): boolean => (state.get(id) ?? 'hidden') !== 'hidden';
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    for (const l of map.links) {
      const a = byId.get(l.a);
      const b = byId.get(l.b);
      if (!a || !b || !shown(a.id) || !shown(b.id)) continue;
      make('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#d9c6a0', 'stroke-width': 3, 'stroke-dasharray': '10 7', opacity: 0.6 });
    }
    for (const n of map.nodes) {
      const st = state.get(n.id)!;
      if (st === 'hidden') continue;
      const g = make('g', { class: 'place', transform: `translate(${n.x},${n.y})`, 'data-testid': `tw-place-${n.id}`, 'data-state': st });
      make('circle', { r: 22, fill: st === 'locked' ? '#3b3b44' : st === 'here' ? '#2b4c7e' : '#4a3b1e', stroke: st === 'locked' ? '#777' : '#ffd98a', 'stroke-width': 3 }, g);
      const glyph = make('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 22, fill: st === 'locked' ? '#999' : '#ffd98a' }, g);
      glyph.textContent = st === 'locked' ? '?' : (GLYPHS[n.icon] ?? GLYPHS.pin!);
      const label = make('text', { 'text-anchor': 'middle', y: 42, 'font-size': 20, fill: st === 'locked' ? '#999' : '#f4efe6' }, g);
      label.textContent = st === 'locked' ? '?' : t(n.label);
      if (st === 'here') {
        const you = make('text', { 'text-anchor': 'middle', y: -34, 'font-size': 15, fill: '#9cc7ff' }, g);
        you.textContent = t('you are here');
      }
      if (st === 'open') g.addEventListener('click', () => ctx.request('travel-place-request', { place: n.id }));
    }
    el.replaceChildren(svg);
  },
};
