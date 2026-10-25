import { MAP_HEIGHT, MAP_WIDTH, type Simulation, type WidgetDef } from '@tilewright/plugin-sdk';
import { PARCHMENT } from './palette';
import { MIN_TRAVEL, placesWithState, regionName, type Waypoint } from './sources';

/**
 * Widgets this kit adds to the UI designer (under "From plugins"): a flourish, a paper doll, the parchment map, the region name that
 * fades in when the player walks into a new one, and the slips that messages appear on. Each is plain DOM filled in on every frame
 * from what the game says (`ctx.sim`); a screen uses them like any other widget.
 */

export const flourishWidget: WidgetDef = {
  id: 'parchment-flourish',
  label: 'Flourish (a line with a star in the middle)',
  defaults: { w: 200, h: 18, wMode: 'fill', hMode: 'auto' },
  render(el) {
    el.textContent = '———  ✦  ———';
    el.style.textAlign = 'center';
    el.style.color = PARCHMENT.border;
    el.style.letterSpacing = '0.2em';
  },
};

// ---------- the paper doll ----------

/** The outline of a person, in ink, for the slots of the equipment to stand around. */
export const DOLL_SVG = `<svg viewBox="0 0 100 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:100%;height:100%">
<g fill="none" stroke="${PARCHMENT.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">
<circle cx="50" cy="26" r="15"/>
<path d="M50 41 L50 105"/>
<path d="M50 56 L22 90 M50 56 L78 90"/>
<path d="M50 105 L30 180 M50 105 L70 180"/>
<path d="M30 180 L20 180 M70 180 L80 180"/>
</g>
<g fill="${PARCHMENT.paperDark}" opacity="0.55"><ellipse cx="50" cy="194" rx="30" ry="4"/></g>
</svg>`;

export const dollWidget: WidgetDef = {
  id: 'parchment-doll',
  label: 'Paper doll (the outline of a character, for equipment slots to stand beside)',
  defaults: { w: 130, h: 230, wMode: 'fixed', hMode: 'fixed' },
  render(el) {
    if (el.dataset.doll === '1') return;
    el.dataset.doll = '1';
    el.innerHTML = DOLL_SVG;
  },
};

// ---------- the parchment map ----------

export interface MapMark {
  id: string;
  x: number;
  y: number;
  label: string;
  /** Lit: the player can travel there. Dim: known, but not a place to go to (too close, or only a "?"). */
  look: 'here' | 'lit' | 'near' | 'unknown';
}

/** What the map shows: only the places the player has found; the ones they can go to lit, the ones too close dim, the others as "?". */
export function mapMarks(sim: Simulation): MapMark[] {
  const t = (s: string): string => sim.assets.strings.t(s);
  const out: MapMark[] = [];
  for (const w of placesWithState(sim)) {
    const base = { id: w.node.id, x: w.node.x, y: w.node.y };
    if (w.state === 'hidden') continue; // not discovered: not on the map at all
    if (w.state === 'here') out.push({ ...base, label: t(w.node.label), look: 'here' });
    else if (w.state === 'locked') out.push({ ...base, label: '?', look: 'unknown' });
    else out.push({ ...base, label: t(w.node.label), look: tooClose(w) ? 'near' : 'lit' });
  }
  return out;
}

const tooClose = (w: Waypoint): boolean => w.distance > 0 && w.distance < MIN_TRAVEL;

const MAP_CSS = `
.tw-pmap { position: relative; width: 100%; aspect-ratio: ${MAP_WIDTH} / ${MAP_HEIGHT}; background: radial-gradient(ellipse at center, ${PARCHMENT.paper} 55%, ${PARCHMENT.paperDark} 100%); border: 3px solid ${PARCHMENT.border}; border-radius: 3px; box-shadow: inset 0 0 40px #8a6a3a66; pointer-events: auto; }
.tw-pmap svg { width: 100%; height: 100%; display: block; }
.tw-pmap .mark { cursor: default; } .tw-pmap .mark.lit { cursor: pointer; }
.tw-pmap .mark text { pointer-events: none; font-family: Georgia, serif; }
.tw-pmap .glow { animation: tw-pmap-glow 2.4s ease-in-out infinite; }
@keyframes tw-pmap-glow { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
`;

export const mapWidget: WidgetDef = {
  id: 'parchment-map',
  label: 'Parchment map (found places only; places to travel to lit; "you are here")',
  defaults: { w: 560, h: 336, wMode: 'fill', hMode: 'auto' },
  css: MAP_CSS,
  render(el, _node, _values, ctx) {
    const sim = ctx?.sim;
    const map = sim?.assets.worldMap;
    if (!sim || !map) {
      el.replaceChildren();
      delete el.dataset.sig;
      return;
    }
    const marks = mapMarks(sim);
    const links = map.links.filter((l) => marks.some((m) => m.id === l.a) && marks.some((m) => m.id === l.b));
    // redrawn only when something about the map changed, so a click is never lost to a redraw
    const sig = JSON.stringify([marks, links, sim.assets.strings.language]);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    const make = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = svg): SVGElementTagNameMap[K] => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      parent.appendChild(e);
      return e;
    };
    const at = new Map(marks.map((m) => [m.id, m]));
    for (const l of links) {
      const a = at.get(l.a)!;
      const b = at.get(l.b)!;
      make('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: PARCHMENT.inkSoft, 'stroke-width': 3, 'stroke-dasharray': '4 9', 'stroke-linecap': 'round', opacity: 0.7 });
    }
    for (const m of marks) {
      const g = make('g', { class: `mark ${m.look}`, transform: `translate(${m.x},${m.y})`, 'data-testid': `tw-pmark-${m.id}`, 'data-look': m.look });
      if (m.look === 'lit') make('circle', { r: 30, fill: '#ffd98a', class: 'glow' }, g);
      make('circle', { r: m.look === 'here' ? 13 : 10, fill: m.look === 'here' ? PARCHMENT.heading : m.look === 'lit' ? '#f0b94a' : 'none', stroke: PARCHMENT.ink, 'stroke-width': m.look === 'unknown' || m.look === 'near' ? 2 : 3, opacity: m.look === 'near' ? 0.45 : 1 }, g);
      const name = make('text', { 'text-anchor': 'middle', y: 36, 'font-size': 22, fill: m.look === 'near' ? PARCHMENT.inkSoft : PARCHMENT.ink }, g);
      name.textContent = m.label;
      if (m.look === 'here') {
        const you = make('text', { 'text-anchor': 'middle', y: -26, 'font-size': 18, 'font-style': 'italic', fill: PARCHMENT.heading }, g);
        you.textContent = sim.assets.strings.t('you are here');
      }
      if (m.look === 'lit') g.addEventListener('click', () => ctx.request('travel-place-request', { place: m.id }));
    }
    const box = document.createElement('div');
    box.className = 'tw-pmap';
    box.append(svg);
    el.replaceChildren(box);
  },
};

// ---------- the region name ----------

const REGION_CSS = `
.tw-region { font-family: Georgia, serif; font-size: 26px; letter-spacing: .12em; color: ${PARCHMENT.paper}; text-shadow: 0 2px 6px #000c, 0 0 2px #000; text-align: center; opacity: 0; transition: opacity .9s ease; pointer-events: none; }
.tw-region.on { opacity: 1; }
`;

/** The name of the region the player walks into: it fades in and, a few seconds later, out. */
export const regionWidget: WidgetDef = {
  id: 'parchment-region',
  label: 'Region name (fades in when the player enters a region of the scene)',
  defaults: { w: 360, h: 40, wMode: 'auto', hMode: 'auto' },
  css: REGION_CSS,
  render(el, _node, _values, ctx) {
    const sim = ctx?.sim;
    if (!sim) return;
    const name = regionName(sim);
    const shown = el.dataset.region ?? '';
    if (name === shown) return;
    el.dataset.region = name;
    window.clearTimeout(Number(el.dataset.timer ?? 0));
    if (!name) {
      el.firstElementChild?.classList.remove('on');
      return;
    }
    let line = el.firstElementChild as HTMLElement | null;
    if (!line) {
      line = document.createElement('div');
      line.className = 'tw-region';
      el.append(line);
    }
    line.textContent = name;
    line.classList.remove('on');
    // two frames later, so the change of opacity is seen as a fade
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => line!.classList.add('on')));
    el.dataset.timer = String(window.setTimeout(() => line!.classList.remove('on'), 4200));
  },
};

// ---------- messages on slips of paper ----------

const TOAST_CSS = `
.tw-slips { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; width: max-content; max-width: 300px; pointer-events: none; }
.tw-slip { width: max-content; max-width: 300px; background: ${PARCHMENT.paper}; color: ${PARCHMENT.ink}; border: 2px solid ${PARCHMENT.border}; border-radius: 3px; padding: 6px 12px; font: 15px Georgia, serif; box-shadow: 2px 3px 0 #0006; animation: tw-slip-in .25s ease-out; }
@keyframes tw-slip-in { from { transform: translateX(30px); opacity: 0 } to { transform: none; opacity: 1 } }
.tw-toasts { display: none !important; }
`;

const SLIP_MS = 3500;
const slips = new WeakMap<Simulation, { text: string; until: number }[]>();

/** Messages as slips of paper in the corner (the game's own plain toasts are hidden while this is on screen). */
export const slipsWidget: WidgetDef = {
  id: 'parchment-slips',
  label: 'Message slips (what the game says, on slips of paper that fade away)',
  defaults: { w: 280, h: 120, wMode: 'auto', hMode: 'auto' },
  css: TOAST_CSS,
  render(el, _node, _values, ctx) {
    const sim = ctx?.sim;
    if (!sim) return;
    let list = slips.get(sim);
    if (!list) {
      const mine: { text: string; until: number }[] = [];
      list = mine;
      slips.set(sim, mine);
      // asked for once for this game: messages from the game's rules and from anything that says something
      sim.events.on('message', (e) => void mine.push({ text: String(e.text ?? ''), until: Date.now() + SLIP_MS }));
    }
    const now = Date.now();
    while (list.length > 0 && list[0]!.until < now) list.shift();
    const shown = list.slice(-4).map((s) => s.text).join('\u0000');
    if (el.dataset.shown === shown) return;
    el.dataset.shown = shown;
    const box = document.createElement('div');
    box.className = 'tw-slips';
    for (const s of list.slice(-4)) {
      const slip = document.createElement('div');
      slip.className = 'tw-slip';
      slip.textContent = s.text;
      box.append(slip);
    }
    el.replaceChildren(box);
  },
};
