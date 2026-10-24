import { parseRichText, pictureOf, readPointer, type Simulation, type TransformIso, type UiNode, type UiStyle } from '@tilewright/runtime';
import {
  activateWidget,
  adjustWidget,
  explicitNeighbour,
  focusables,
  hover,
  isFocusable,
  openScreens,
  setChoice,
  setSlider,
  swapRows,
  uiBridge,
  walkView,
  worldViews,
  type ViewNode,
} from './screens-logic';
import { host } from '../plugins/host';

/**
 * Draws the interface screens as plain DOM (so the editor's Play and an exported game use exactly the same thing) and passes
 * what the player does - clicks, keys, a gamepad, dragging a cell - to screens-logic. Elements are kept between frames and
 * matched by key, so hovering, dragging a slider and animations are not disturbed when numbers change.
 */

export const SCREENS_CSS = `
.tw-screens { position: absolute; inset: 0; pointer-events: none; }
.tw-screen { position: absolute; inset: 0; }
.tw-screen.dim { pointer-events: auto; }
.tw-w { box-sizing: border-box; pointer-events: none; position: absolute; font-family: var(--tw-font, Georgia, serif); color: var(--tw-text, #f4efe6); }
.tw-w.flow { position: relative; }
.tw-w.hit { pointer-events: auto; }
.tw-w.hidden { display: none !important; }
/* a panel widget is a plain box: the editor's own .panel rule (a dock panel) must not give it a background, padding or scrollbars */
.tw-w.panel { height: auto; overflow: visible; padding: 0; background: none; }
.tw-w.button, .tw-w.clickable { cursor: pointer; }
.tw-w.button { display: flex; align-items: center; justify-content: center; user-select: none; }
.tw-w.bar .fill { height: 100%; transition: width 0.12s linear; }
.tw-w.bar { overflow: hidden; }
.tw-w.slider input, .tw-w.dropdown select { width: 100%; }
.tw-w.tabs > .tw-tabbar { display: flex; gap: 4px; margin-bottom: 6px; }
.tw-w.tabs > .tw-tabbar button { pointer-events: auto; padding: 4px 10px; border: 2px solid var(--tw-border, #d9c6a0); background: var(--tw-panel, #14161b); color: inherit; border-radius: 6px; cursor: pointer; }
.tw-w.tabs > .tw-tabbar button.on { background: var(--tw-highlight, #6aa8ff); }
.tw-w.minimap canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
.tw-w.hand > .tw-w { transition: transform 0.12s; transform-origin: 50% 120%; }
.tw-w.hand > .tw-w:hover { transform: translateY(-14px) scale(1.06) !important; z-index: 5; }
.tw-w.dragging { opacity: 0.6; z-index: 100; pointer-events: none !important; }
.tw-w.droptarget { outline: 3px dashed var(--tw-accent, #ffd98a); }
.tw-w.ghost { opacity: 0.3 !important; outline: 1px dashed #fff8; }
.tw-w.focused { outline: 3px solid var(--tw-accent, #ffd98a); outline-offset: 2px; }
.tw-tooltip { position: absolute; z-index: 1000; max-width: 260px; padding: 6px 9px; background: #000d; color: #fff; border: 1px solid var(--tw-border, #d9c6a0); border-radius: 6px; font-size: 13px; pointer-events: none; }
.tw-w img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.tw-w .keyhint { margin-left: auto; padding-left: 12px; opacity: 0.85; }
`;

/** Words with inline formatting ([b], [i], [u], [s], [color=...]) as spans; text with none is set as plain text. Never parsed as HTML. */
function setRichText(target: HTMLElement, text: string): void {
  if (!text.includes('[')) {
    target.textContent = text;
    return;
  }
  target.replaceChildren(
    ...parseRichText(text).map((s) => {
      if (!s.bold && !s.italic && !s.underline && !s.strike && !s.color) return document.createTextNode(s.text);
      const span = document.createElement(s.italic ? 'i' : 'span');
      span.textContent = s.text;
      if (s.bold) span.style.fontWeight = 'bold';
      if (s.underline || s.strike) span.style.textDecoration = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ');
      if (s.color) span.style.color = s.color;
      return span;
    }),
  );
}

type StyleKey = 'hover' | 'pressed' | 'disabled' | 'focus';

function cssOf(s: UiStyle): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.fill !== undefined) out.background = s.fill;
  if (s.border !== undefined || s.borderWidth !== undefined) {
    out.border = `${s.borderWidth ?? 2}px solid ${s.border ?? 'var(--tw-border, #d9c6a0)'}`;
  }
  if (s.radius !== undefined) out['border-radius'] = `${s.radius}px`;
  if (s.color !== undefined) out.color = s.color;
  if (s.fontSize !== undefined) out['font-size'] = `${s.fontSize}px`;
  if (s.bold) out['font-weight'] = '700';
  if (s.align !== undefined) out['text-align'] = s.align;
  if (s.opacity !== undefined) out.opacity = String(s.opacity);
  if (s.shadow) out['box-shadow'] = '0 3px 10px #0008';
  if (s.scroll) out.overflow = 'auto';
  if (s.maxH !== undefined) out['max-height'] = `${s.maxH}%`;
  if (s.themeScale) out.zoom = `calc(${s.scale ?? 1} * var(--tw-scale, 1))`;
  else if (s.scale !== undefined && s.scale !== 1) out.zoom = String(s.scale);
  return out;
}

/** Where and how big a widget is, from its anchor and sizes and how its parent arranges things. */
export function layoutCss(n: UiNode, parent: UiNode | null): Record<string, string> {
  const css: Record<string, string> = {};
  const flow = parent !== null && parent.layout !== 'free';
  const px = (v: number): string => `${v}px`;
  if (n.wMode === 'fixed') css.width = px(n.w);
  else if (n.wMode === 'auto') css.width = 'max-content';
  else css[flow && parent!.layout === 'row' ? 'flex' : 'width'] = flow && parent!.layout === 'row' ? '1 1 0' : '100%';
  if (n.hMode === 'fixed') css.height = px(n.h);
  else if (n.hMode === 'auto') css.height = 'max-content';
  else css[flow && parent!.layout === 'column' ? 'flex' : 'height'] = flow && parent!.layout === 'column' ? '1 1 0' : '100%';
  if (flow) {
    css.position = 'relative';
    if (parent!.layout === 'row' && n.hMode === 'fill') css['align-self'] = 'stretch';
    if (parent!.layout === 'column' && n.wMode === 'fill') css['align-self'] = 'stretch';
    return css;
  }
  css.position = 'absolute';
  const a = n.anchor;
  if (a === 'fill') {
    css.inset = '0';
    css.width = 'auto';
    css.height = 'auto';
    css.margin = `${n.y}px ${n.x}px`;
    return css;
  }
  const h = a === 'tl' || a === 'l' || a === 'bl' ? 'l' : a === 'tr' || a === 'r' || a === 'br' ? 'r' : 'c';
  const v = a === 'tl' || a === 't' || a === 'tr' ? 't' : a === 'bl' || a === 'b' || a === 'br' ? 'b' : 'c';
  const tf: string[] = [];
  if (h === 'l') css.left = px(n.x);
  else if (h === 'r') css.right = px(-n.x);
  else {
    css.left = `calc(50% + ${n.x}px)`;
    tf.push('translateX(-50%)');
  }
  if (v === 't') css.top = px(n.y);
  else if (v === 'b') css.bottom = px(-n.y);
  else {
    css.top = `calc(50% + ${n.y}px)`;
    tf.push('translateY(-50%)');
  }
  if (tf.length > 0) css.transform = tf.join(' ');
  return css;
}

function containerCss(n: UiNode): Record<string, string> {
  const css: Record<string, string> = {};
  if (n.layout === 'row' || n.layout === 'column') {
    css.display = 'flex';
    css['flex-direction'] = n.layout;
    css.gap = `${n.gap}px`;
    css.padding = `${n.padding}px`;
    const map = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;
    css['align-items'] = map[n.align];
    if (n.type === 'turnOrder' || n.type === 'hand') css['justify-content'] = n.type === 'hand' ? 'center' : 'flex-start';
  } else if (n.layout === 'grid') {
    css.display = 'grid';
    css['grid-template-columns'] = `repeat(${Math.max(1, n.columns)}, ${n.wMode === 'fixed' && n.type !== 'grid' ? '1fr' : 'max-content'})`;
    css.gap = `${n.gap}px`;
    css.padding = `${n.padding}px`;
    css['align-content'] = 'start';
  }
  return css;
}

interface Live {
  el: HTMLElement;
  /** Child elements go in here (the element itself, or a body inside it). */
  body: HTMLElement;
  parentKey: string | null;
  /** Whether the element was last drawn as shown (null: not yet drawn, so the first frame decides). */
  shown: boolean | null;
  hovering: boolean;
  pressing: boolean;
  applied: string[];
  signature: string;
}

const KEYFRAMES = (anim: UiNode['anim'][number]): Keyframe[] => {
  const d = anim.dir;
  const off = d === 'left' ? 'translateX(-30px)' : d === 'right' ? 'translateX(30px)' : d === 'up' ? 'translateY(-30px)' : 'translateY(30px)';
  const hide = anim.on === 'hide';
  switch (anim.kind) {
    case 'fade':
      return hide ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }];
    case 'slide':
      return hide ? [{ transform: 'none', opacity: 1 }, { transform: off, opacity: 0 }] : [{ transform: off, opacity: 0 }, { transform: 'none', opacity: 1 }];
    case 'pop':
      return hide ? [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.6)', opacity: 0 }] : [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }];
    default:
      return [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.5 }, { transform: 'scale(1)' }];
  }
};

export class UiScreens {
  private readonly widgetCleanups = new WeakMap<HTMLElement, () => void>();
  private readonly root = document.createElement('div');
  private readonly layers = new Map<string, HTMLElement>();
  private readonly live = new Map<string, Live>();
  private current = new Map<string, ViewNode>();
  private readonly tooltip = document.createElement('div');
  private focusKey = '';
  private lastTick = -1;
  private seen = new Set<string>();
  private drag: { from: ViewNode; ghost: HTMLElement; x0: number; y0: number; started: boolean } | null = null;
  private capturingKey = '';
  private readonly worldRoot = document.createElement('div');
  private readonly worldItems = new Map<number, HTMLElement>();

  constructor(
    private readonly parent: HTMLElement,
    private readonly sim: Simulation,
    /** The designer draws the same screens but nothing reacts, and hidden widgets are shown faintly. */
    private readonly design = false,
  ) {
    this.root.className = 'tw-screens';
    this.root.setAttribute('data-testid', 'tw-screens');
    this.tooltip.className = 'tw-tooltip';
    this.tooltip.style.display = 'none';
    this.worldRoot.className = 'tw-world';
    this.worldRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    this.root.appendChild(this.worldRoot);
    parent.appendChild(this.root);
    this.root.appendChild(this.tooltip);
  }

  private readonly widgetCss = new Set<string>();
  private widgetStyle: HTMLStyleElement | null = null;

  /** Add a plugin widget's style rules to the page, once. */
  private useWidgetCss(css: string | undefined): void {
    if (!css || this.widgetCss.has(css)) return;
    this.widgetCss.add(css);
    if (!this.widgetStyle) {
      this.widgetStyle = document.createElement('style');
      this.root.appendChild(this.widgetStyle);
    }
    this.widgetStyle.textContent = [...this.widgetCss].join('\n');
  }

  /** The widget with this name or id, as the player sees it (for tests that click). */
  find(name: string): HTMLElement | null {
    return this.root.querySelector(`[data-name="${CSS.escape(name)}"]`);
  }

  get open(): boolean {
    return this.sim.runtime.ui.stack.length > 0;
  }

  update(): void {
    const sim = this.sim;
    const screens = openScreens(sim);
    this.current = new Map();
    this.seen = new Set();
    const wantedLayers = new Set<string>();
    const safe = sim.assets.ui.safeArea;
    this.root.style.inset = safe > 0 ? `${safe * 100}%` : '0';
    screens.forEach(({ screen, view }, i) => {
      wantedLayers.add(screen.name);
      let layer = this.layers.get(screen.name);
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'tw-screen';
        layer.setAttribute('data-testid', `tw-screen-${screen.name}`);
        this.layers.set(screen.name, layer);
        this.root.insertBefore(layer, this.tooltip);
        if (screen.transition !== 'none') layer.animate(screen.transition === 'fade' ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateY(24px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
      }
      layer.style.zIndex = String(i + 1);
      layer.classList.toggle('dim', screen.dim > 0 || screen.modal);
      layer.style.background = screen.dim > 0 ? `rgba(0,0,0,${screen.dim})` : 'transparent';
      this.sync(view, null, layer, null, i === screens.length - 1);
    });
    for (const [name, layer] of this.layers) {
      if (!wantedLayers.has(name)) {
        layer.remove();
        this.layers.delete(name);
      }
    }
    if (!this.design) this.drawWorld();
    // elements whose widgets are gone
    for (const [key, l] of this.live) {
      if (!this.seen.has(key)) {
        l.el.remove();
        this.live.delete(key);
      }
    }
    const top = screens[screens.length - 1];
    if (top && !this.design && sim.tick !== this.lastTick) {
      this.lastTick = sim.tick;
      this.navigate(top.view);
    } else if (!top) this.focusKey = '';
    this.paintFocus();
    this.drawMinimaps();
  }

  /**
   * Keys and gamepad buttons, once for every simulation step (the host calls it after each one), so a tap that starts and ends
   * between two frames still moves the focus or presses the button.
   */
  tick(): void {
    const sim = this.sim;
    if (this.design || sim.tick === this.lastTick) return;
    const screens = openScreens(sim);
    const top = screens[screens.length - 1];
    if (!top) return;
    this.lastTick = sim.tick;
    this.navigate(top.view);
  }

  /** Interface hanging over objects, kept above them as the camera moves. */
  private drawWorld(): void {
    const sim = this.sim;
    const cam = readPointer(sim.input).camera;
    const wanted = new Set<number>();
    for (const { entity, view, height } of worldViews(sim)) {
      wanted.add(entity.id);
      let wrap = this.worldItems.get(entity.id);
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'tw-world-item';
        wrap.style.cssText = 'position:absolute;pointer-events:none';
        this.worldRoot.appendChild(wrap);
        this.worldItems.set(entity.id, wrap);
      }
      this.sync(view, null, wrap, null, false);
      const t = entity.get<TransformIso>('transform');
      if (!cam || !t) {
        wrap.style.display = 'none';
        continue;
      }
      const p = pictureOf(cam, sim.runtime.view.rotation, sim.map, t.x, t.y, t.h + height);
      wrap.style.display = '';
      wrap.style.width = `${view.node.w}px`;
      wrap.style.height = `${view.node.h}px`;
      wrap.style.left = `${Math.round(p.x)}px`;
      wrap.style.top = `${Math.round(p.y)}px`;
      wrap.style.transform = 'translate(-50%, -100%)';
    }
    for (const [id, wrap] of this.worldItems) {
      if (!wanted.has(id)) {
        wrap.remove();
        this.worldItems.delete(id);
      }
    }
  }

  // ---------- building and updating elements ----------

  private sync(vn: ViewNode, parent: UiNode | null, host: HTMLElement, parentKey: string | null, topScreen: boolean): void {
    this.seen.add(vn.key);
    this.current.set(vn.key, vn);
    let live = this.live.get(vn.key);
    if (!live) {
      live = this.create(vn);
      this.live.set(vn.key, live);
    }
    live.parentKey = parentKey;
    if (live.el.parentElement !== host) host.appendChild(live.el);
    this.restyle(vn, parent, live, topScreen);
    let at = 0;
    for (const c of vn.children) {
      this.sync(c, vn.node, live.body, vn.key, topScreen);
      const el = this.live.get(c.key)!.el;
      // keep the children in order
      if (live.body.children[at] !== el) live.body.insertBefore(el, live.body.children[at] ?? null);
      at++;
    }
  }

  private create(vn: ViewNode): Live {
    const n = vn.node;
    const el = document.createElement('div');
    el.className = `tw-w ${n.type}`;
    el.setAttribute('data-testid', `tw-ui-${n.name}`);
    el.dataset.name = n.name;
    el.dataset.id = vn.key;
    if (vn.key.includes('#')) el.dataset.rowId = vn.key.slice(vn.key.lastIndexOf('#') + 1);
    let body: HTMLElement = el;
    const live: Live = { el, body, parentKey: null, shown: null, hovering: false, pressing: false, applied: [], signature: '' };
    switch (n.type) {
      case 'text': {
        body = document.createElement('span');
        el.appendChild(body);
        break;
      }
      case 'button':
      case 'toggle':
      case 'keybind':
        break;
      case 'bar': {
        const fill = document.createElement('div');
        fill.className = 'fill';
        el.appendChild(fill);
        break;
      }
      case 'slider': {
        const input = document.createElement('input');
        input.type = 'range';
        input.addEventListener('input', () => {
          const v = this.current.get(vn.key);
          if (v) setSlider(this.sim, v, Number(input.value));
        });
        el.appendChild(input);
        break;
      }
      case 'dropdown': {
        const sel = document.createElement('select');
        sel.addEventListener('change', () => {
          const v = this.current.get(vn.key);
          if (v) setChoice(this.sim, v, sel.value);
        });
        el.appendChild(sel);
        break;
      }
      case 'tabs': {
        const bar = document.createElement('div');
        bar.className = 'tw-tabbar';
        el.appendChild(bar);
        body = document.createElement('div');
        body.style.position = 'relative';
        body.style.flex = '1';
        el.appendChild(body);
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        break;
      }
      case 'minimap': {
        el.appendChild(document.createElement('canvas'));
        break;
      }
      case 'image': {
        el.appendChild(document.createElement('img'));
        break;
      }
      default:
        break;
    }
    live.body = body;
    this.wire(vn.key, live);
    return live;
  }

  /** Mouse handling, once per element; it always looks up the widget as it is now. */
  private wire(key: string, live: Live): void {
    if (this.design) return;
    const el = live.el;
    el.addEventListener('pointerenter', (e) => {
      const vn = this.current.get(key);
      if (!vn) return;
      live.hovering = true;
      this.paint(vn, live);
      if (vn.visible) hover(this.sim, vn);
      if (vn.tooltip) this.showTip(vn.tooltip, e);
      const anim = vn.node.anim.find((a) => a.on === 'hover');
      if (anim) el.animate(KEYFRAMES(anim), { duration: anim.ms, easing: 'ease-out' });
    });
    el.addEventListener('pointermove', (e) => {
      if (this.tooltip.style.display !== 'none') this.moveTip(e);
      this.dragMove(e);
    });
    el.addEventListener('pointerleave', () => {
      live.hovering = false;
      live.pressing = false;
      this.tooltip.style.display = 'none';
      const vn = this.current.get(key);
      if (vn) this.paint(vn, live);
    });
    el.addEventListener('pointerdown', (e) => {
      const vn = this.current.get(key);
      if (!vn) return;
      live.pressing = true;
      this.paint(vn, live);
      // dragging a cell of a grid
      const cell = this.cellOf(key);
      if (cell && !this.drag) {
        this.drag = { from: cell, ghost: document.createElement('div'), x0: e.clientX, y0: e.clientY, started: false };
        window.addEventListener('pointerup', this.dragEnd, { once: true });
      }
    });
    el.addEventListener('pointerup', () => {
      live.pressing = false;
      const vn = this.current.get(key);
      if (vn) this.paint(vn, live);
    });
    el.addEventListener('click', (e) => {
      const vn = this.current.get(key);
      if (!vn || this.dragged) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const fires = isFocusable(vn) && !['slider', 'dropdown'].includes(vn.node.type);
      if (!fires) return;
      e.stopPropagation();
      this.focusKey = key;
      const anim = vn.node.anim.find((a) => a.on === 'click');
      if (anim) el.animate(KEYFRAMES(anim), { duration: anim.ms, easing: 'ease-out' });
      if (vn.node.type === 'keybind') this.capturingKey = key;
      activateWidget(this.sim, vn);
    });
  }

  private dragged = false;

  private cellOf(key: string): ViewNode | null {
    // the repeat (a child of a draggable grid) this element is inside
    let k: string | null = key;
    while (k) {
      const vn = this.current.get(k);
      if (!vn) return null;
      const p: string | null | undefined = this.live.get(k)?.parentKey;
      const parent = p ? this.current.get(p) : undefined;
      if (parent && parent.node.type === 'grid' && parent.node.drag && vn.row) return vn;
      k = p ?? null;
    }
    return null;
  }

  private dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.started && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) {
      d.started = true;
      this.dragged = true;
      const src = this.live.get(d.from.key)?.el;
      d.ghost = (src?.cloneNode(true) as HTMLElement) ?? document.createElement('div');
      d.ghost.classList.add('dragging');
      d.ghost.style.position = 'fixed';
      d.ghost.style.pointerEvents = 'none';
      d.ghost.style.width = `${src?.offsetWidth ?? 40}px`;
      d.ghost.style.height = `${src?.offsetHeight ?? 40}px`;
      document.body.appendChild(d.ghost);
    }
    if (d.started) {
      d.ghost.style.left = `${e.clientX - 20}px`;
      d.ghost.style.top = `${e.clientY - 20}px`;
    }
  }

  private readonly dragEnd = (e: PointerEvent): void => {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    d.ghost.remove();
    if (d.started) {
      const under = document.elementsFromPoint(e.clientX, e.clientY);
      for (const u of under) {
        const key = (u as HTMLElement).dataset?.id;
        if (!key) continue;
        const target = this.cellOf(key);
        if (target?.row && d.from.row && target.row.table === d.from.row.table && target.key !== d.from.key) {
          swapRows(this.sim, d.from.row.table, d.from.row.id, target.row.id);
          break;
        }
      }
      window.setTimeout(() => (this.dragged = false), 0);
    }
  };

  private showTip(text: string, e: PointerEvent): void {
    this.tooltip.textContent = text;
    this.tooltip.style.display = 'block';
    this.moveTip(e);
  }

  private moveTip(e: PointerEvent): void {
    const r = this.root.getBoundingClientRect();
    this.tooltip.style.left = `${Math.min(r.width - 270, e.clientX - r.left + 14)}px`;
    this.tooltip.style.top = `${e.clientY - r.top + 18}px`;
  }

  private restyle(vn: ViewNode, parent: UiNode | null, live: Live, topScreen: boolean): void {
    const n = vn.node;
    const el = live.el;
    const sig = JSON.stringify([n.type, parent?.layout, n.anchor, n.x, n.y, n.w, n.h, n.wMode, n.hMode, n.layout, n.gap, n.padding, n.align, n.columns, n.style, n.states]);
    if (live.signature !== sig) {
      live.signature = sig;
      for (const k of live.applied) el.style.removeProperty(k);
      const css = { ...layoutCss(n, parent), ...containerCss(n), ...(n.type === 'tabs' ? { display: 'flex' } : {}) };
      live.applied = Object.keys(css);
      for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v);
      el.classList.toggle('flow', parent !== null && parent.layout !== 'free');
      el.classList.toggle('button', n.type === 'button');
    }
    // visibility, with the animations that go with showing and hiding
    if (vn.visible !== live.shown) {
      const first = !live.el.hasAttribute('data-seen');
      live.el.setAttribute('data-seen', '1');
      live.shown = vn.visible;
      const anim = n.anim.find((a) => a.on === (vn.visible ? 'show' : 'hide'));
      if (this.design) {
        el.classList.remove('hidden');
      } else if (vn.visible) {
        el.classList.remove('hidden');
        if (anim) el.animate(KEYFRAMES(anim), { duration: anim.ms, easing: 'ease-out' });
      } else if (anim && !first) {
        el.animate(KEYFRAMES(anim), { duration: anim.ms, easing: 'ease-in' }).onfinish = () => {
          if (!live.shown) el.classList.add('hidden');
        };
      } else el.classList.add('hidden');
    }
    if (this.design) el.classList.toggle('ghost', !vn.visible);
    const interactive = !this.design && vn.visible && topScreen && (isFocusable(vn) || vn.node.type === 'slider' || vn.node.type === 'dropdown' || vn.node.type === 'tabs' || vn.row !== undefined || vn.tooltip !== '' || vn.node.on.hover.length > 0);
    el.classList.toggle('hit', interactive);
    el.classList.toggle('clickable', isFocusable(vn));
    this.fillContent(vn, live);
    this.paint(vn, live);
  }

  /** The look for the state the widget is in now: normal, hovered, pressed, focused or disabled. */
  private paint(vn: ViewNode, live: Live): void {
    const n = vn.node;
    const order: StyleKey[] = [];
    if (!vn.enabled && (n.type === 'button' || n.type === 'toggle')) order.push('disabled');
    if (live.hovering) order.push('hover');
    if (this.focusKey === vn.key) order.push('focus');
    if (live.pressing) order.push('pressed');
    const merged: UiStyle = { ...n.style };
    for (const k of order) Object.assign(merged, n.states[k] ?? {});
    const css = cssOf(merged);
    const prev = (live.el.dataset.paint ?? '').split('|').filter(Boolean);
    for (const k of prev) if (!(k in css)) live.el.style.removeProperty(k);
    for (const [k, v] of Object.entries(css)) live.el.style.setProperty(k, v);
    live.el.dataset.paint = Object.keys(css).join('|');
    if (vn.scope['unit.active'] !== undefined) {
      // a unit of the turn order bar: the one whose turn it is stands out
      const active = vn.scope['unit.active'] === 1;
      if (!n.style.fill || n.id === 'turnchip') {
        live.el.style.outline = active ? '3px solid var(--tw-accent, #ffd98a)' : '';
        live.el.style.transform = active ? 'scale(1.1)' : '';
      }
      live.el.dataset.active = active ? '1' : '0';
    }
    if (n.type === 'bar') {
      const fill = live.el.querySelector<HTMLElement>('.fill');
      if (fill) {
        fill.style.width = `${Math.round(vn.fraction * 1000) / 10}%`;
        fill.style.background = merged.color ?? '#6fe08a';
      }
      live.el.style.color = '';
    }
  }

  private fillContent(vn: ViewNode, live: Live): void {
    const n = vn.node;
    const el = live.el;
    switch (n.type) {
      case 'text':
        if (live.body.dataset.text !== vn.text) {
          live.body.dataset.text = vn.text;
          setRichText(live.body, vn.text);
        }
        break;
      case 'button':
        if (el.dataset.text !== vn.text) {
          el.dataset.text = vn.text;
          el.textContent = vn.text;
        }
        break;
      case 'toggle': {
        const sig = `${vn.text}|${vn.value}`;
        if (el.dataset.text !== sig) {
          el.dataset.text = sig;
          el.textContent = `${vn.value ? '☑' : '☐'} ${vn.text}`;
        }
        break;
      }
      case 'keybind': {
        const label = uiBridge(this.sim)?.bindingText?.(vn.text) ?? '';
        const sig = `${vn.text}|${vn.label}|${label}|${this.capturingKey === vn.key}`;
        if (el.dataset.text !== sig) {
          el.dataset.text = sig;
          el.replaceChildren();
          const name = document.createElement('span');
          name.textContent = vn.label || vn.text;
          const hint = document.createElement('span');
          hint.className = 'keyhint';
          hint.textContent = this.capturingKey === vn.key && label === (el.dataset.was ?? label) ? 'press a key…' : label;
          el.append(name, hint);
          el.style.display = 'flex';
          el.style.alignItems = 'center';
        }
        break;
      }
      case 'slider': {
        const input = el.querySelector('input')!;
        input.min = String(n.min);
        input.max = String(n.min + (vn.max - n.min));
        input.step = String(n.step);
        if (document.activeElement !== input) input.value = String(vn.value);
        break;
      }
      case 'dropdown': {
        const sel = el.querySelector('select')!;
        const sig = `${vn.options.join('|')}|${vn.optionLabels.join('|')}`;
        if (sel.dataset.sig !== sig) {
          sel.dataset.sig = sig;
          sel.replaceChildren(...vn.options.map((o, i) => Object.assign(document.createElement('option'), { value: o, textContent: vn.optionLabels[i] ?? o })));
        }
        if (sel.value !== vn.choice) sel.value = vn.choice;
        break;
      }
      case 'tabs': {
        const bar = el.querySelector<HTMLElement>('.tw-tabbar')!;
        const sig = `${vn.options.join('|')}|${vn.choice}`;
        if (bar.dataset.sig !== sig) {
          bar.dataset.sig = sig;
          bar.replaceChildren(
            ...vn.options.map((o) => {
              const b = document.createElement('button');
              b.textContent = o;
              b.setAttribute('data-testid', `tw-tab-${o}`);
              b.className = o === vn.choice ? 'on' : '';
              b.onclick = () => {
                const cur = this.current.get(vn.key);
                if (cur) setChoice(this.sim, cur, o);
              };
              return b;
            }),
          );
        }
        break;
      }
      case 'image': {
        const img = el.querySelector('img')!;
        const url = n.sprite ? uiBridge(this.sim)?.spriteUrl?.(n.sprite) ?? '' : '';
        if (img.getAttribute('src') !== url) {
          if (url) img.setAttribute('src', url);
          else img.removeAttribute('src');
        }
        break;
      }
      case 'hand': {
        const kids = vn.children;
        kids.forEach((c, i) => {
          const live2 = this.live.get(c.key);
          if (!live2) return;
          const mid = (kids.length - 1) / 2;
          const a = (i - mid) * Math.min(7, 40 / Math.max(1, kids.length));
          live2.el.style.transform = `rotate(${a}deg) translateY(${Math.abs(i - mid) * 3}px)`;
          live2.el.style.marginLeft = i === 0 ? '0' : '-24px';
        });
        break;
      }
      case 'plugin': {
        // a kind of widget a plugin added: it fills the element in every frame, from the values the game has
        const def = host.ext.widgets.get(n.source);
        if (!def) {
          el.textContent = this.design ? `(the plugin widget "${n.source}" is not available)` : '';
          break;
        }
        this.useWidgetCss(def.css);
        const values: Record<string, string | number | boolean> = { ...this.sim.runtime.vars, 'time.seconds': this.sim.tick / 60 } as Record<string, string | number | boolean>;
        this.widgetCleanups.get(el)?.();
        const stop = def.render(el, n, values, { sim: this.sim, request: (event, data) => void this.sim.events.emit(event, data ?? {}) });
        if (typeof stop === 'function') this.widgetCleanups.set(el, stop);
        break;
      }
      default:
        break;
    }
  }

  // ---------- keys and gamepads ----------

  private navigate(view: ViewNode): void {
    const ui = this.sim.uiInput;
    const all = focusables(view);
    if (all.length === 0) return;
    if (this.capturingKey) return;
    let cur = all.find((f) => f.key === this.focusKey) ?? null;
    const dirs: [string, 'up' | 'down' | 'left' | 'right'][] = [
      ['move_up', 'up'],
      ['move_down', 'down'],
      ['move_left', 'left'],
      ['move_right', 'right'],
    ];
    for (const [action, dir] of dirs) {
      if (!ui.pressed(action)) continue;
      if (!cur) {
        cur = all[0]!;
        break;
      }
      const named = explicitNeighbour(view, cur, dir);
      if (named) {
        cur = named;
        break;
      }
      if ((dir === 'left' || dir === 'right') && adjustWidget(this.sim, cur, dir === 'left' ? -1 : 1)) break;
      if (cur.node.type === 'slider' && (dir === 'left' || dir === 'right')) {
        setSlider(this.sim, cur, cur.value + (dir === 'left' ? -1 : 1) * cur.node.step);
        break;
      }
      cur = this.nearest(cur, dir, all) ?? cur;
      break;
    }
    if (cur) this.focusKey = cur.key;
    if (cur && ui.pressed('interact')) {
      if (cur.node.type === 'keybind') this.capturingKey = cur.key;
      activateWidget(this.sim, cur);
    }
  }

  /** The widget closest in a direction, by where they are on screen. */
  private nearest(from: ViewNode, dir: 'up' | 'down' | 'left' | 'right', all: ViewNode[]): ViewNode | null {
    const a = this.live.get(from.key)?.el.getBoundingClientRect();
    if (!a) return null;
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: ViewNode | null = null;
    let score = Infinity;
    for (const o of all) {
      if (o.key === from.key) continue;
      const r = this.live.get(o.key)?.el.getBoundingClientRect();
      if (!r) continue;
      const dx = r.left + r.width / 2 - ax;
      const dy = r.top + r.height / 2 - ay;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 1) continue;
      const s = along + across * 2;
      if (s < score) {
        score = s;
        best = o;
      }
    }
    return best;
  }

  private paintFocus(): void {
    for (const [key, l] of this.live) {
      const on = key === this.focusKey;
      if (l.el.classList.contains('focused') !== on) {
        l.el.classList.toggle('focused', on && !this.current.get(key)?.node.states.focus);
        const vn = this.current.get(key);
        if (vn) this.paint(vn, l);
      }
    }
    if (this.capturingKey && !this.current.has(this.capturingKey)) this.capturingKey = '';
  }

  /** Called by the host when a key was captured (or the capture timed out). */
  captured(): void {
    this.capturingKey = '';
    for (const l of this.live.values()) l.el.dataset.text = '';
  }

  // ---------- minimaps ----------

  private drawMinimaps(): void {
    const sim = this.sim;
    const map = sim.map;
    for (const [key, vn] of this.current) {
      if (vn.node.type !== 'minimap' || !vn.visible) continue;
      const canvas = this.live.get(key)?.el.querySelector('canvas');
      if (!canvas || !map) continue;
      if (canvas.width !== map.width || canvas.height !== map.height) {
        canvas.width = map.width;
        canvas.height = map.height;
      }
      const g = canvas.getContext('2d');
      if (!g) continue;
      const img = g.createImageData(map.width, map.height);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const t = map.getTile(x, y);
          const h = map.getHeight(x, y);
          const i = (y * map.width + x) * 4;
          if (t === 0) {
            img.data[i + 3] = 0;
            continue;
          }
          const shade = 70 + Math.min(100, h * 22) + ((t * 37) % 40);
          img.data[i] = shade * 0.7;
          img.data[i + 1] = shade * 0.9;
          img.data[i + 2] = shade * 0.7;
          img.data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      for (const part of vn.node.marks.split(',')) {
        const [tag, colour] = part.split(':').map((s) => s.trim());
        if (!tag) continue;
        g.fillStyle = colour || '#fff';
        for (const e of sim.world.withTag(tag)) {
          const t = e.get<{ x: number; y: number }>('transform');
          if (t) g.fillRect(Math.floor(t.x) - 0.5, Math.floor(t.y) - 0.5, tag === 'player' ? 2.5 : 1.5, tag === 'player' ? 2.5 : 1.5);
        }
      }
    }
  }

  dispose(): void {
    this.root.remove();
    this.drag?.ghost.remove();
    void walkView;
  }
}
