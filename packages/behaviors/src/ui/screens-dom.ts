import { parseRichText, pictureOf, readPointer, screenIsOverlay, type Simulation, type TransformIso, type UiNode, type UiScreen, type UiStyle } from '@tilewright/runtime';
import {
  activateWidget,
  claimedButtons,
  adjustWidget,
  explicitNeighbour,
  focusables,
  hover,
  isFocusable,
  openScreens,
  setChoice,
  setSlider,
  stepWidget,
  swapRows,
  uiBridge,
  walkView,
  worldViews,
  type PartInfo,
  type ViewNode,
} from './screens-logic';
import { host } from '../plugins/host';
import { editingFieldKey, openPopupKey, placePopup, pointerPosition, popupRun, sliderPositionOf, sliderRun, sliderValueAt, takeFocusRequest } from './controls';
import { closePopup, commitEditing, driveSliderKeys, noteOptionFocus, setPopupQuery, setSliderThumb, typeInto, wheelSlider } from './screens-controls';
import { canScroll, axesOf, driveScroller, dragTo, followFocus, mainAxis, offsetRange, releaseDrag, scrollBy, scrollState, scrollTo, type ScrollState } from './scrolling';
import { applyMap, drawMaps, wireMap } from './map/dom';

/**
 * Draws the interface screens as plain DOM (so the editor's Play and an exported game use exactly the same thing) and passes
 * what the player does - clicks, keys, a gamepad, dragging a cell - to screens-logic. Elements are kept between frames and
 * matched by key, so hovering, dragging a slider and animations are not disturbed when numbers change.
 *
 * The controls the engine draws itself (a project with the flags `uiScroll` and `uiControls`) are made of parts, which are widgets like
 * any other: the scrollbar, the slider's thumb, the pop-up list. This file puts each part where the logic says and passes the pointer to
 * the logic; nothing in a game is the browser's own scrollbar, range input or select box.
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
.tw-w.tabs.engine > .tw-tabbar { margin-bottom: 6px; pointer-events: none; }
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
/* scrolling is the engine's: the browser never shows a scrollbar */
.tw-w.tw-scroller { overflow: hidden !important; }
.tw-scroll-content { box-sizing: border-box; will-change: transform; }
.tw-overlay { position: absolute; inset: 0; pointer-events: none; }
.tw-axis { position: absolute; pointer-events: none; }
/* the parts of a control: placed by the control, drawn like any widget */
.tw-w.tw-part { position: absolute; }
.tw-w.tw-part.flow { position: relative; }
.tw-w.tw-part.tw-bar-idle { opacity: 0; transition: opacity 0.25s; }
.tw-w.tw-part.tw-bar-hoveronly { opacity: 0; transition: opacity 0.2s; }
.tw-w:hover > .tw-overlay > .tw-part.tw-bar-hoveronly { opacity: 1; }
.tw-w.engine-control { display: flex; align-items: center; }
.tw-w.engine-slider { touch-action: none; cursor: pointer; }
.tw-w.tw-popup-list { z-index: 2000; overflow: hidden; }
.tw-w.tw-map { overflow: hidden; touch-action: none; }
.tw-w.tw-map canvas.tw-map-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tw-w.tw-map .tw-map-markers { position: absolute; inset: 0; pointer-events: none; }
.tw-hidden-input { position: fixed; left: -4000px; top: 0; width: 10px; height: 10px; opacity: 0; }
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

function cssOf(s: UiStyle, scrollerOn = false): Record<string, string> {
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
  if (s.scroll && !scrollerOn) out.overflow = 'auto';
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

/** Where a piece of a control goes: its own size from its widget, its position from the control. */
export function partCss(n: UiNode, part: PartInfo): Record<string, string> {
  const flowing = part.mount === 'content' || part.mount === 'bar';
  if (flowing) return layoutCss(n, { layout: 'row' } as UiNode);
  const css = layoutCss(n, null);
  for (const k of ['left', 'right', 'top', 'bottom', 'transform', 'inset', 'margin']) delete css[k];
  if (part.place.inset === undefined && (part.place.width !== undefined || part.place.left !== undefined || part.place.right !== undefined)) {
    // the control sizes it along the track when it says so; otherwise the widget's own size stands
  }
  for (const [k, v] of Object.entries(part.place)) {
    if (k === 'maxRows') continue;
    css[k === 'maxHeight' ? 'max-height' : k] = v;
  }
  css.position = 'absolute';
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
  appliedContent: string[];
  signature: string;
  /** For a scroller: the content that moves. For a control with pieces over it: the layer they are in. For a slider: the track's own space. For tabs: the bar. */
  content?: HTMLElement;
  overlay?: HTMLElement;
  axis?: HTMLElement;
  bar?: HTMLElement;
  /** The offset last put on the content, so it is written only when it changes. */
  offset?: string;
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

const POPUP_ANIM = (kind: string): Keyframe[] | null => (kind === 'fade' ? [{ opacity: 0 }, { opacity: 1 }] : kind === 'slide' ? [{ transform: 'translateY(-8px)', opacity: 0 }, { transform: 'none', opacity: 1 }] : kind === 'pop' ? [{ transform: 'scale(0.9)', opacity: 0 }, { transform: 'none', opacity: 1 }] : null);

const apply = (el: HTMLElement, prev: string[], css: Record<string, string>): string[] => {
  for (const k of prev) if (!(k in css)) el.style.removeProperty(k);
  for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v);
  return Object.keys(css);
};

export class UiScreens {
  private readonly widgetCleanups = new WeakMap<HTMLElement, () => void>();
  private readonly root = document.createElement('div');
  private readonly layers = new Map<string, HTMLElement>();
  private readonly live = new Map<string, Live>();
  private current = new Map<string, ViewNode>();
  private readonly tooltip = document.createElement('div');
  private focusKey = '';
  private autoFocusOn = '';
  private autoFocus = true;
  /** The widgets that can have the focus on the screen on top, as of the last step (what `claimInput` looks at before the next one). */
  private focusableKeys = new Set<string>();
  private readonly claim = (snapshot: Readonly<Record<string, number>>): string[] => {
    // while the player types into a field every button is the field's: nothing reaches the game
    if (!this.design && editingFieldKey(this.sim) !== '') return Object.keys(snapshot);
    return claimedButtons(snapshot, this.focusKey, this.focusableKeys);
  };
  private lastTick = -1;
  private seen = new Set<string>();
  private drag: { from: ViewNode; ghost: HTMLElement; x0: number; y0: number; started: boolean } | null = null;
  private capturingKey = '';
  private readonly worldRoot = document.createElement('div');
  private readonly worldItems = new Map<number, HTMLElement>();
  /** The designer shows a state a widget has only for a moment (mouse over, pressed, selected by keys) as if it were on. */
  private preview: { id: string; state: StyleKey } | null = null;
  private input: HTMLInputElement | null = null;
  private topLayer: HTMLElement | null = null;
  private scrollDrag: { key: string; axis: 'x' | 'y'; start: number; offset: number; moved: boolean; id: number; lastT: number; lastPos: number; v: number } | null = null;
  private barDrag: { key: string; axis: 'x' | 'y'; start: number; offset: number; trackPx: number; thumb: number } | null = null;
  private sliderDrag: { key: string; thumb: 1 | 2 } | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly sim: Simulation,
    /** The designer draws the same screens but nothing reacts, and hidden widgets are shown faintly. */
    private readonly design = false,
  ) {
    if (!design) sim.claimInput = this.claim;
    this.root.className = 'tw-screens';
    this.root.setAttribute('data-testid', 'tw-screens');
    this.tooltip.className = 'tw-tooltip';
    this.tooltip.style.display = 'none';
    this.worldRoot.className = 'tw-world';
    this.worldRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    this.root.appendChild(this.worldRoot);
    parent.appendChild(this.root);
    this.root.appendChild(this.tooltip);
    if (!design) {
      this.root.addEventListener('wheel', this.onWheel, { passive: false });
      window.addEventListener('pointerdown', this.onWindowDown, true);
      window.addEventListener('pointermove', this.onWindowMove, true);
      window.addEventListener('pointerup', this.onWindowUp, true);
      window.addEventListener('keydown', this.onKeyDown, true);
    }
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

  /** The designer asks to see one widget in a state it only has for a moment (null: back to normal). */
  setPreview(id: string | null, state: StyleKey = 'hover'): void {
    this.preview = id ? { id, state } : null;
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
      if (i === screens.length - 1) this.topLayer = layer;
      this.sync(view, null, layer, null, i === screens.length - 1, layer);
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
    this.measureScrollers();
    this.positionPopups();
    this.applyScroll();
    this.syncInput();
    applyMap(this.sim, this.current, (k) => this.live.get(k)?.el, this.design);
    const top = screens[screens.length - 1];
    if (top && !this.design && sim.tick !== this.lastTick) {
      this.lastTick = sim.tick;
      this.step(top.view, top.screen);
    } else if (!top) {
      this.focusKey = '';
      this.focusableKeys = new Set();
    }
    this.paintFocus();
    this.drawMinimaps();
    drawMaps(this.sim, this.current, (k) => this.live.get(k)?.el);
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
    this.step(top.view, top.screen);
  }

  private step(view: ViewNode, screen: UiScreen): void {
    this.driveScrollers(view);
    this.navigate(view, screen);
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
      this.sync(view, null, wrap, null, false, wrap);
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

  private sync(vn: ViewNode, parent: UiNode | null, host: HTMLElement, parentKey: string | null, topScreen: boolean, layer: HTMLElement): void {
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
      this.sync(c, vn.node, live.body, vn.key, topScreen, layer);
      const el = this.live.get(c.key)!.el;
      // keep the children in order
      if (live.body.children[at] !== el) live.body.insertBefore(el, live.body.children[at] ?? null);
      at++;
    }
    // the pieces of a control: each in the place its mount says
    for (const p of vn.parts ?? []) {
      const target = this.mountFor(p, live, layer);
      this.sync(p, null, target, vn.key, topScreen, layer);
      const el = this.live.get(p.key)!.el;
      if (p.part!.mount === 'content') {
        if (live.body.children[at] !== el) live.body.insertBefore(el, live.body.children[at] ?? null);
        at++;
      }
    }
  }

  private mountFor(p: ViewNode, live: Live, layer: HTMLElement): HTMLElement {
    switch (p.part!.mount) {
      case 'axis':
        return this.ensureAxis(live);
      case 'overlay':
        return this.ensureOverlay(live);
      case 'bar':
        return live.bar ?? live.body;
      case 'screen':
        return layer;
      default:
        return live.body;
    }
  }

  private ensureOverlay(live: Live): HTMLElement {
    if (!live.overlay) {
      live.overlay = document.createElement('div');
      live.overlay.className = 'tw-overlay';
      live.el.appendChild(live.overlay);
    }
    return live.overlay;
  }

  private ensureAxis(live: Live): HTMLElement {
    if (!live.axis) {
      live.axis = document.createElement('div');
      live.axis.className = 'tw-axis';
      live.el.appendChild(live.axis);
    }
    return live.axis;
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
    const live: Live = { el, body, parentKey: null, shown: null, hovering: false, pressing: false, applied: [], appliedContent: [], signature: '' };
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
        if (vn.engine) {
          el.classList.add('engine-slider');
          break;
        }
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
        if (vn.engine) break;
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
        live.bar = bar;
        body = document.createElement('div');
        body.style.position = 'relative';
        body.style.flex = '1';
        el.appendChild(body);
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        if (vn.engine) el.classList.add('engine');
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
      case 'map': {
        el.classList.add('tw-map');
        const canvas = document.createElement('canvas');
        canvas.className = 'tw-map-canvas';
        el.appendChild(canvas);
        const markers = document.createElement('div');
        markers.className = 'tw-map-markers';
        el.appendChild(markers);
        body = markers;
        break;
      }
      default:
        break;
    }
    live.body = body;
    if (vn.part) el.classList.add('tw-part');
    if (vn.engine && ['toggle', 'keybind', 'dropdown', 'textfield', 'numberfield'].includes(n.type)) el.classList.add('engine-control');
    this.wire(vn.key, live, vn);
    return live;
  }

  /** Mouse handling, once per element; it always looks up the widget as it is now. */
  private wire(key: string, live: Live, first: ViewNode): void {
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
      if (vn.engine && vn.node.type === 'slider' && vn.enabled) this.startSliderDrag(vn, e);
      if (vn.part?.kind === 'scrollbar' && (vn.part.role === 'thumb' || vn.part.role === 'track')) this.startBarDrag(vn, e);
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
      if (!vn || this.dragged || this.scrollMoved) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const engineBox = vn.engine && ['dropdown', 'textfield', 'numberfield'].includes(vn.node.type);
      const fires = isFocusable(vn) && (engineBox || !['slider', 'dropdown'].includes(vn.node.type));
      if (!fires) return;
      e.stopPropagation();
      this.autoFocus = false; // the player chose a row with the mouse
      this.focusKey = key;
      const anim = vn.node.anim.find((a) => a.on === 'click');
      if (anim) el.animate(KEYFRAMES(anim), { duration: anim.ms, easing: 'ease-out' });
      if (vn.node.type === 'keybind') this.capturingKey = key;
      if (vn.node.type === 'keybind') this.sim.runtime.scratch.set('ui.capturing', key);
      activateWidget(this.sim, vn);
    });
    wireMap(this.sim, key, el, first, () => this.current.get(key), () => this.design);
  }

  private dragged = false;
  private scrollMoved = false;

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
    // a scroller keeps its content in a box of its own that moves; the pieces of a control that sit over it go in a layer above
    if (vn.scroll && !live.content) {
      live.content = document.createElement('div');
      live.content.className = 'tw-scroll-content';
      el.appendChild(live.content);
      live.body = live.content;
      this.ensureOverlay(live);
    }
    const flowPart = vn.part !== undefined && (vn.part.mount === 'content' || vn.part.mount === 'bar');
    const sig = JSON.stringify([n.type, parent?.layout, n.anchor, n.x, n.y, n.w, n.h, n.wMode, n.hMode, n.layout, n.gap, n.padding, n.align, n.columns, n.style, n.states, vn.part?.place, vn.part?.mount, vn.scroll?.scroller.dir, vn.engine, vn.slider?.spec.angle]);
    if (live.signature !== sig) {
      live.signature = sig;
      el.classList.toggle('tw-scroller', vn.scroll !== undefined);
      const own = vn.part ? partCss(n, vn.part) : layoutCss(n, parent);
      const box = containerCss(n);
      const engineBox = vn.engine && ['toggle', 'keybind'].includes(n.type) ? { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: `${n.gap}px` } : vn.engine && ['dropdown', 'textfield', 'numberfield'].includes(n.type) ? { display: 'flex', 'flex-direction': 'column' } : {};
      if (live.content) {
        live.applied = apply(el, live.applied, { ...own, ...(n.type === 'tabs' ? { display: 'flex' } : {}) });
        const dir = vn.scroll!.scroller.dir;
        live.appliedContent = apply(live.content, live.appliedContent, { ...box, ...(dir === 'horizontal' ? { 'min-width': '100%', width: 'max-content', height: '100%' } : dir === 'both' ? { 'min-width': '100%', 'min-height': '100%', width: 'max-content' } : { 'min-height': '100%', width: '100%' }) });
      } else {
        live.applied = apply(el, live.applied, { ...own, ...box, ...engineBox, ...(n.type === 'tabs' ? { display: 'flex' } : {}) });
      }
      el.classList.toggle('flow', flowPart || (parent !== null && parent.layout !== 'free'));
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
        else if (vn.part?.role === 'list' && vn.popup === undefined) {
          const f = POPUP_ANIM(vn.owner?.popup?.spec.animOpen ?? 'none');
          if (f) el.animate(f, { duration: 140, easing: 'ease-out' });
        }
      } else if (anim && !first) {
        el.animate(KEYFRAMES(anim), { duration: anim.ms, easing: 'ease-in' }).onfinish = () => {
          if (!live.shown) el.classList.add('hidden');
        };
      } else el.classList.add('hidden');
    }
    if (this.design) el.classList.toggle('ghost', !vn.visible);
    const type = vn.node.type;
    const interactive = !this.design && vn.visible && topScreen && (isFocusable(vn) || type === 'slider' || type === 'dropdown' || type === 'tabs' || type === 'textfield' || type === 'numberfield' || type === 'map' || vn.row !== undefined || vn.tooltip !== '' || vn.node.on.hover.length > 0 || (vn.part?.kind === 'scrollbar' && (vn.part.role === 'thumb' || vn.part.role === 'track')) || vn.scroll !== undefined);
    // a popup list is always above everything of its screen, whichever screen it is on
    el.classList.toggle('hit', interactive || (vn.part?.mount === 'screen' && vn.visible && !this.design));
    el.classList.toggle('clickable', isFocusable(vn));
    if (vn.part?.mount === 'screen') {
      el.classList.add('tw-popup-list');
      el.dataset.popupList = '1';
    }
    if (vn.part?.kind === 'scrollbar' && vn.owner?.scroll) {
      const bar = vn.owner.scroll.scroller.bar;
      const show = bar?.show ?? 'scroll';
      el.classList.toggle('tw-bar-idle', show === 'scroll' && !vn.owner.scroll.recent && !live.hovering);
      el.classList.toggle('tw-bar-hoveronly', show === 'hover');
    }
    this.fillContent(vn, live);
    this.paint(vn, live);
  }

  /** The look for the state the widget is in now: normal, hovered, pressed, focused or disabled. A piece of a control also takes the states of its control. */
  private paint(vn: ViewNode, live: Live): void {
    const n = vn.node;
    const order: StyleKey[] = [];
    const owner = vn.part ? this.live.get(vn.part.of) : undefined;
    const ownerView = vn.owner;
    if (((!vn.enabled && (n.type === 'button' || n.type === 'toggle')) || (ownerView && !ownerView.enabled)) && !(vn.act && vn.enabled)) order.push('disabled');
    if (live.hovering || owner?.hovering) order.push('hover');
    if (this.focusKey === vn.key || (vn.part !== undefined && this.focusKey === vn.part.of && vn.part.mount !== 'screen')) order.push('focus');
    if (live.pressing || owner?.pressing || ownerView?.slider?.dragging || this.barDrag?.key === vn.part?.of) order.push('pressed');
    const forced = this.preview && (n.id === this.preview.id || ownerView?.node.id === this.preview.id) ? this.preview.state : null;
    if (forced && !order.includes(forced)) order.push(forced);
    const merged: UiStyle = { ...n.style };
    for (const k of order) Object.assign(merged, n.states[k] ?? {});
    const css = cssOf(merged, vn.scroll !== undefined);
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
        if (vn.engine) break; // a box and a label, made of parts
        const sig = `${vn.text}|${vn.value}`;
        if (el.dataset.text !== sig) {
          el.dataset.text = sig;
          el.textContent = `${vn.value ? '☑' : '☐'} ${vn.text}`;
        }
        break;
      }
      case 'keybind': {
        if (vn.engine) break;
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
        if (vn.engine) {
          this.layoutAxis(vn, live);
          break;
        }
        const input = el.querySelector('input')!;
        input.min = String(n.min);
        input.max = String(n.min + (vn.max - n.min));
        input.step = String(n.step);
        if (document.activeElement !== input) input.value = String(vn.value);
        break;
      }
      case 'dropdown': {
        if (vn.engine) break;
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
        if (vn.engine) break; // the tabs are parts in the bar
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

  // ---------- sliders ----------

  /** A slider's track runs along its angle: the pieces are laid out left to right in a box that is turned to that angle. */
  private layoutAxis(vn: ViewNode, live: Live): void {
    const axis = this.ensureAxis(live);
    const angle = vn.slider?.spec.angle ?? 0;
    const r = live.el.getBoundingClientRect();
    const w = r.width || vn.node.w;
    const h = r.height || vn.node.h;
    const a = (angle * Math.PI) / 180;
    const length = Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h;
    const norm = ((angle % 180) + 180) % 180;
    const thickness = norm === 0 ? h : norm === 90 ? w : Math.min(w, h);
    axis.style.width = `${length}px`;
    axis.style.height = `${thickness}px`;
    axis.style.left = `${(w - length) / 2}px`;
    axis.style.top = `${(h - thickness) / 2}px`;
    axis.style.transform = angle === 0 ? '' : `rotate(${angle}deg)`;
  }

  private startSliderDrag(vn: ViewNode, e: PointerEvent): void {
    const info = vn.slider;
    const el = this.live.get(vn.key)?.el;
    if (!info || !el) return;
    const rect = el.getBoundingClientRect();
    const f = pointerPosition(info.spec.angle, { w: rect.width, h: rect.height }, e.clientX - rect.left, e.clientY - rect.top);
    let thumb: 1 | 2 = 1;
    if (info.value2 !== null) thumb = Math.abs(f - info.at) <= Math.abs(f - (info.at2 ?? info.at)) ? 1 : 2;
    this.sliderDrag = { key: vn.key, thumb };
    this.autoFocus = false;
    this.focusKey = vn.key;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer cannot be captured */
    }
    this.moveSlider(vn, f, thumb, 'changing');
  }

  private moveSlider(vn: ViewNode, f: number, thumb: 1 | 2, phase: 'changing' | 'changed'): void {
    const info = vn.slider;
    if (!info) return;
    const run = sliderRun(this.sim, vn.key);
    run.dragging = phase === 'changing';
    run.active = thumb;
    setSliderThumb(this.sim, vn, thumb, sliderValueAt(info.spec, info.min, info.max, f), phase);
  }

  // ---------- scrollbars ----------

  private startBarDrag(vn: ViewNode, e: PointerEvent): void {
    const owner = vn.owner;
    if (!owner?.scroll) return;
    const sc = owner.scroll.scroller;
    const side = owner.scroll.side;
    const vertical = side === 'right' || side === 'left';
    const axis: 'x' | 'y' = vertical ? 'y' : 'x';
    const st = scrollState(this.sim, owner.key);
    const ownerEl = this.live.get(owner.key)?.el;
    if (!ownerEl) return;
    const r = ownerEl.getBoundingClientRect();
    const trackPx = (vertical ? r.height : r.width) - (sc.bar?.arrows ? 2 * ((sc.bar?.size ?? 10) + 4) : 0);
    if (vn.part!.role === 'track') {
      // a click on the track goes a page toward it
      const thumb = [...(owner.parts ?? [])].find((p) => p.part?.role === 'thumb');
      const tr = thumb ? this.live.get(thumb.key)?.el.getBoundingClientRect() : null;
      const pos = vertical ? e.clientY : e.clientX;
      const before = tr ? (vertical ? tr.top : tr.left) : pos;
      const view = vertical ? st.metrics.viewH : st.metrics.viewW;
      scrollBy(sc, st, axis, (pos < before ? -1 : 1) * Math.max(view - st.metrics.row, view / 2));
      return;
    }
    const thumbLen = owner.scroll.values.max > 0 ? Math.max(0.04, (vertical ? st.metrics.viewH : st.metrics.viewW) / Math.max(1, vertical ? st.metrics.contentH : st.metrics.contentW)) : 1;
    this.barDrag = { key: owner.key, axis, start: vertical ? e.clientY : e.clientX, offset: st[axis].o, trackPx, thumb: sc.bar?.thumb === 'fixed' ? (sc.bar.thumbSize ?? 40) / Math.max(1, trackPx) : thumbLen };
    st.dragging = true;
    try {
      this.live.get(vn.key)?.el.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer cannot be captured */
    }
  }

  // ---------- scrolling ----------

  /** The scrollers around a widget, nearest first. */
  private scrollChain(key: string): { key: string; scroller: NonNullable<ViewNode['scroll']>['scroller'] }[] {
    const out: { key: string; scroller: NonNullable<ViewNode['scroll']>['scroller'] }[] = [];
    let k: string | null | undefined = key;
    let guard = 0;
    while (k && guard++ < 64) {
      const vn: ViewNode | undefined = this.current.get(k);
      if (vn?.scroll && k !== key) out.push({ key: k, scroller: vn.scroll.scroller });
      k = this.live.get(k)?.parentKey;
    }
    return out;
  }

  /** Once a tick: the mapped buttons scroll the scroller the focus is in (or the first one on the screen), everything else eases and reports. */
  private driveScrollers(top: ViewNode): void {
    const scrollers: string[] = [];
    walkView(top, (v) => {
      if (v.scroll) scrollers.push(v.key);
    });
    // lists in pop-ups are in the screen's layer, not under the top view
    for (const [k, v] of this.current) if (v.scroll && !scrollers.includes(k) && v.part?.mount === 'screen') scrollers.push(k);
    if (scrollers.length === 0) return;
    const focusChain = this.focusKey ? this.scrollChain(this.focusKey) : [];
    const buttonsGoTo = focusChain[0]?.key ?? scrollers[0]!;
    const reduce = typeof document !== 'undefined' && (document.documentElement.classList.contains('reduce-motion') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches));
    for (const key of scrollers) {
      const vn = this.current.get(key)!;
      driveScroller(this.sim, key, vn.scroll!.scroller, { count: vn.scroll!.values.count, inputs: key === buttonsGoTo && !this.design && editingFieldKey(this.sim) === '', reduceMotion: reduce });
    }
  }

  /** The size of every scroller's window and content, and where each widget inside is - what the logic needs to keep the focus in view. */
  private measureScrollers(): void {
    const scrollers: [string, ViewNode, Live][] = [];
    for (const [key, vn] of this.current) {
      const l = this.live.get(key);
      if (vn.scroll && l?.content) scrollers.push([key, vn, l]);
    }
    if (scrollers.length === 0) return;
    const rects = new Map<string, DOMRect>();
    for (const [key, , l] of scrollers) {
      const st = scrollState(this.sim, key);
      const r = l.el.getBoundingClientRect();
      const cr = l.content!.getBoundingClientRect();
      const m = st.metrics;
      m.viewW = r.width;
      m.viewH = r.height;
      m.contentW = cr.width;
      m.contentH = cr.height;
      m.items = {};
      rects.set(key, cr);
      const sc = vn.scroll!.scroller;
      if (sc.rowSize > 0) m.row = sc.rowSize;
      else {
        const kids = [...l.content!.children].filter((c) => !c.classList.contains('hidden')) as HTMLElement[];
        if (kids.length > 0) {
          const a = kids[0]!.getBoundingClientRect();
          const b = kids[1]?.getBoundingClientRect();
          const horizontal = mainAxis(sc) === 'x';
          m.row = b ? Math.abs(horizontal ? b.left - a.left : b.top - a.top) || (horizontal ? a.width : a.height) : horizontal ? a.width : a.height;
          // (rows in a grid share a line: the row is the distance to the next line)
          if (b && !horizontal && Math.abs(b.top - a.top) < 1) {
            const next = kids.find((k) => k.getBoundingClientRect().top - a.top > 1);
            if (next) m.row = next.getBoundingClientRect().top - a.top;
          }
        } else m.row = 0;
      }
    }
    // each widget that can be chosen, and each scroller inside another, in the content coordinates of every scroller around it
    const keys = new Set(scrollers.map((s) => s[0]));
    for (const [key, vn] of this.current) {
      if (!(isFocusable(vn) || vn.scroll)) continue;
      const el = this.live.get(key)?.el;
      if (!el) continue;
      let r: DOMRect | null = null;
      let k: string | null | undefined = this.live.get(key)?.parentKey;
      let guard = 0;
      while (k && guard++ < 64) {
        if (keys.has(k) && k !== key) {
          r ??= el.getBoundingClientRect();
          const cr = rects.get(k)!;
          scrollState(this.sim, k).metrics.items[key] = [r.left - cr.left, r.top - cr.top, r.right - cr.left, r.bottom - cr.top];
        }
        k = this.live.get(k)?.parentKey;
      }
    }
  }

  /** Put every scroller's content where the logic says. */
  private applyScroll(): void {
    for (const [key, vn] of this.current) {
      const l = this.live.get(key);
      if (!vn.scroll || !l?.content) continue;
      const st: ScrollState = scrollState(this.sim, key);
      const axes = axesOf(vn.scroll.scroller);
      const x = axes.includes('x') ? Math.round(st.x.o * 10) / 10 : 0;
      const y = axes.includes('y') ? Math.round(st.y.o * 10) / 10 : 0;
      const t = `translate(${-x}px, ${-y}px)`;
      if (l.offset !== t) {
        l.offset = t;
        l.content.style.transform = t;
        l.el.dataset.scrollX = String(x);
        l.el.dataset.scrollY = String(y);
      }
    }
  }

  private readonly onWheel = (e: WheelEvent): void => {
    const target = e.target instanceof Element ? (e.target.closest('[data-id]') as HTMLElement | null) : null;
    if (!target?.dataset.id) return;
    const vn = this.current.get(target.dataset.id);
    if (vn && vn.engine && vn.node.type === 'slider' && vn.slider?.spec.wheel) {
      wheelSlider(this.sim, vn, e.deltaY < 0);
      e.preventDefault();
      return;
    }
    for (const c of [{ key: target.dataset.id, scroller: vn?.scroll?.scroller }, ...this.scrollChain(target.dataset.id)]) {
      const sc = c.scroller;
      if (!sc || !sc.wheel) continue;
      const st = scrollState(this.sim, c.key);
      const axis: 'x' | 'y' = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey ? 'x' : 'y';
      const use = axesOf(sc).includes(axis) ? axis : axesOf(sc)[0]!;
      if (!canScroll(sc, st, use)) continue;
      const d = (axis === 'x' && !e.shiftKey ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 20 : 1);
      const range = offsetRange(sc, use === 'y' ? st.metrics.contentH : st.metrics.contentW, use === 'y' ? st.metrics.viewH : st.metrics.viewW);
      const next = st[use].t + d * sc.speed;
      if ((d < 0 && st[use].t <= range.min) || (d > 0 && st[use].t >= range.max)) continue; // at the end: the scroller around it may take it
      scrollTo(sc, st, use, next, true);
      e.preventDefault();
      return;
    }
  };

  private readonly onWindowDown = (e: PointerEvent): void => {
    // a press outside an open pop-up list closes it (a press on its box is the box's own business)
    const open = openPopupKey(this.sim);
    if (open && e.target instanceof Element && !e.target.closest('[data-popup-list]') && !e.target.closest(`[data-id="${CSS.escape(open)}"]`)) closePopup(this.sim, open, false);
    if (!(e.target instanceof Element) || !this.root.contains(e.target)) return;
    const hit = e.target.closest('[data-id]') as HTMLElement | null;
    this.scrollMoved = false;
    if (!hit?.dataset.id) return;
    const vn = this.current.get(hit.dataset.id);
    // dragging the content of a scroller (touch, or the mouse past a few pixels), unless the press is on a control that uses the drag
    if (vn && (vn.engine && vn.node.type === 'slider')) return;
    if (vn?.part?.kind === 'scrollbar') return;
    if (e.target.closest('.tw-map')) return;
    for (const c of [{ key: hit.dataset.id, scroller: vn?.scroll?.scroller }, ...this.scrollChain(hit.dataset.id)]) {
      const sc = c.scroller;
      if (!sc || !sc.drag) continue;
      const st = scrollState(this.sim, c.key);
      const axis = mainAxis(sc);
      if (!canScroll(sc, st, axis)) continue;
      const pos = axis === 'y' ? e.clientY : e.clientX;
      this.scrollDrag = { key: c.key, axis, start: pos, offset: st[axis].o, moved: false, id: e.pointerId, lastT: performance.now(), lastPos: pos, v: 0 };
      return;
    }
  };

  private readonly onWindowMove = (e: PointerEvent): void => {
    const d = this.scrollDrag;
    if (d && e.pointerId === d.id) {
      const vn = this.current.get(d.key);
      const sc = vn?.scroll?.scroller;
      if (sc) {
        const pos = d.axis === 'y' ? e.clientY : e.clientX;
        if (!d.moved && Math.abs(pos - d.start) > 6) {
          d.moved = true;
          this.scrollMoved = true;
        }
        if (d.moved) {
          const st = scrollState(this.sim, d.key);
          const now = performance.now();
          const dt = Math.max(1, now - d.lastT);
          d.v = (-(pos - d.lastPos) / dt) * 1000;
          d.lastT = now;
          d.lastPos = pos;
          dragTo(sc, st, d.axis, d.offset - (pos - d.start));
        }
      }
    }
    const b = this.barDrag;
    if (b) {
      const vn = this.current.get(b.key);
      const sc = vn?.scroll?.scroller;
      if (sc) {
        const st = scrollState(this.sim, b.key);
        const m = st.metrics;
        const range = offsetRange(sc, b.axis === 'y' ? m.contentH : m.contentW, b.axis === 'y' ? m.viewH : m.viewW);
        const pos = b.axis === 'y' ? e.clientY : e.clientX;
        const span = Math.max(1, b.trackPx * (1 - b.thumb));
        dragTo(sc, st, b.axis, b.offset + ((pos - b.start) / span) * (range.max - range.min));
        this.scrollMoved = true;
      }
    }
    const s = this.sliderDrag;
    if (s && (e.buttons > 0 || e.pointerType === 'touch')) {
      const vn = this.current.get(s.key);
      const el = this.live.get(s.key)?.el;
      if (vn?.slider && el) {
        const rect = el.getBoundingClientRect();
        this.moveSlider(vn, pointerPosition(vn.slider.spec.angle, { w: rect.width, h: rect.height }, e.clientX - rect.left, e.clientY - rect.top), s.thumb, 'changing');
      }
    }
  };

  private readonly onWindowUp = (e: PointerEvent): void => {
    const d = this.scrollDrag;
    if (d && e.pointerId === d.id) {
      this.scrollDrag = null;
      const vn = this.current.get(d.key);
      if (vn?.scroll && d.moved) {
        releaseDrag(vn.scroll.scroller, scrollState(this.sim, d.key), d.axis, d.v);
        window.setTimeout(() => (this.scrollMoved = false), 0);
      }
    }
    const b = this.barDrag;
    if (b) {
      this.barDrag = null;
      const vn = this.current.get(b.key);
      if (vn?.scroll) releaseDrag(vn.scroll.scroller, scrollState(this.sim, b.key), b.axis, 0);
      window.setTimeout(() => (this.scrollMoved = false), 0);
    }
    const s = this.sliderDrag;
    if (s) {
      this.sliderDrag = null;
      const vn = this.current.get(s.key);
      if (vn?.slider) {
        // let go: the value is final
        this.moveSlider(vn, sliderPositionOf(vn.slider.spec, vn.slider.min, vn.slider.max, vn.slider.value2 !== null && s.thumb === 2 ? vn.slider.value2 : vn.slider.value), s.thumb, 'changed');
        sliderRun(this.sim, s.key).dragging = false;
      }
    }
  };

  // ---------- pop-up lists ----------

  private positionPopups(): void {
    for (const [key, vn] of this.current) {
      const info = vn.popup;
      if (!info?.open || info.spec.place === 'screen') continue;
      const owner = this.live.get(key);
      const list = this.live.get(info.listKey);
      if (!owner || !list || !list.el.parentElement) continue;
      const lr = list.el.parentElement.getBoundingClientRect();
      const br = owner.el.getBoundingClientRect();
      const option = list.el.querySelector<HTMLElement>('[data-id*="~opt#"]');
      const optH = option ? option.getBoundingClientRect().height : 32;
      const padding = list.el.firstElementChild ? 0 : 0;
      const search = list.el.querySelector<HTMLElement>('[data-id$="~search"]');
      const maxPx = optH * info.spec.maxRows + (search ? search.getBoundingClientRect().height : 0) + vn.parts!.find((p) => p.key === info.listKey)!.node.padding * 2 + padding;
      list.el.style.maxHeight = `${maxPx}px`;
      list.el.style.width = info.spec.width === 'box' ? `${br.width}px` : 'max-content';
      const natural = list.el.getBoundingClientRect();
      const p = placePopup(info.spec.place, { x: br.left - lr.left, y: br.top - lr.top, w: br.width, h: br.height }, { w: natural.width, h: Math.min(natural.height, maxPx) }, { w: lr.width, h: lr.height }, info.spec.width);
      list.el.style.left = `${Math.round(p.x)}px`;
      list.el.style.top = `${Math.round(p.y)}px`;
      list.el.style.right = 'auto';
      list.el.style.bottom = 'auto';
      list.el.style.transform = 'none';
      list.el.style.margin = '0';
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const sim = this.sim;
    const key = openPopupKey(sim);
    if (!key || e.ctrlKey || e.metaKey || e.altKey) return;
    const vn = this.current.get(key);
    if (!vn?.popup?.spec.search) return;
    const run = popupRun(sim, key);
    if (e.key.length === 1 && e.key !== ' ' ? true : e.key === ' ' && run.query !== '') {
      setPopupQuery(sim, vn, run.query + e.key);
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Backspace') {
      setPopupQuery(sim, vn, run.query.slice(0, -1));
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ---------- typing into a field ----------

  /** While a field is being typed in, a hidden input receives the keys (so paste, accents and the phone keyboard work); the field is drawn from parts. */
  private syncInput(): void {
    if (this.design) return;
    const key = editingFieldKey(this.sim);
    if (!key) {
      if (this.input) {
        this.input.remove();
        this.input = null;
      }
      return;
    }
    const vn = this.current.get(key);
    if (!vn?.field) return;
    if (!this.input) {
      const input = document.createElement('input');
      input.className = 'tw-hidden-input';
      input.setAttribute('data-testid', 'tw-field-input');
      input.autocomplete = 'off';
      input.value = vn.field.draft;
      input.addEventListener('input', () => {
        const cur = this.current.get(key);
        if (!cur) return;
        typeInto(this.sim, cur, input.value);
        if (cur.field && input.value !== cur.field.draft) input.value = cur.field.draft;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const cur = this.current.get(key);
          if (cur) commitEditing(this.sim, cur);
          e.preventDefault();
        }
      });
      input.addEventListener('blur', () => {
        const cur = this.current.get(key);
        if (cur && editingFieldKey(this.sim) === key) commitEditing(this.sim, cur);
      });
      this.root.appendChild(input);
      this.input = input;
      input.focus();
    }
  }

  // ---------- keys and gamepads ----------

  private navigate(view: ViewNode, screen: UiScreen): void {
    const ui = this.sim.uiInput;
    const all = focusables(view);
    // the lists that are open hold the focus even when they are drawn in the screen's layer rather than under this view
    const popups = [...this.current.values()].filter((v) => v.popup?.open);
    const options = popups.length > 0 ? [...this.current.values()].filter((v) => v.act?.kind === 'option' && v.visible && v.owner === popups[0]) : [];
    const pool = options.length > 0 ? options : all;
    // (the screens plugins ship, and copies of them, always worked as the game's own menus do; a screen made in the designer does when the project has the flag `menuKeys`)
    const menuKeys = this.sim.compat.menuKeys || screen.from !== undefined;
    // a menu starts with its first row chosen (the keyboard and the pad act on it at once); a heads-up display's buttons are clicked, not walked to with the keyboard:
    // its focus does not take the button away from the game
    const menu = menuKeys && !screenIsOverlay(screen);
    this.focusableKeys = menu || options.length > 0 ? new Set(pool.map((f) => f.key)) : new Set();
    if (pool.length === 0) return;
    if (this.capturingKey) return;
    // typing into a field: the keys are the field's
    if (editingFieldKey(this.sim) !== '') return;
    let cur = pool.find((f) => f.key === this.focusKey) ?? null;
    // something closed or opened and says where the focus goes (a closed list gives it back to its box)
    const wanted = takeFocusRequest(this.sim);
    if (wanted) {
      const target = pool.find((f) => f.key === wanted);
      if (target) {
        cur = target;
        this.autoFocus = false;
      }
    }
    // (until the player has moved the focus themselves it stays on the first row, even when that row only turns up a moment after the
    // screen opened: a Continue that appears once the saves have been read)
    if (this.autoFocusOn !== screen.name) {
      this.autoFocusOn = screen.name;
      this.autoFocus = true;
    }
    if (menu && (this.autoFocus || !cur) && !wanted) cur = cur && options.length > 0 ? cur : pool[0]!;
    if (options.length > 0 && !cur) cur = options[0]!;
    // a slider uses its own mapped buttons: they are not also moves of the focus
    const sliderActions = new Set<string>();
    if (cur?.engine && cur.node.type === 'slider' && cur.slider) {
      for (const a of Object.values(cur.slider.spec.actions)) sliderActions.add(a);
      driveSliderKeys(this.sim, cur);
    }
    const dirs: [string, 'up' | 'down' | 'left' | 'right'][] = [
      ['move_up', 'up'],
      ['move_down', 'down'],
      ['move_left', 'left'],
      ['move_right', 'right'],
    ];
    for (const [action, dir] of dirs) {
      if (!ui.pressed(action)) continue;
      if (sliderActions.has(action)) break;
      this.autoFocus = false;
      if (!cur) {
        cur = pool[0]!;
        break;
      }
      // in an open list, up and down walk the options round the ends and left and right do nothing
      if (options.length > 0) {
        if (dir === 'up' || dir === 'down') {
          const i = options.indexOf(cur);
          cur = options[(i + (dir === 'down' ? 1 : -1) + options.length) % options.length]!;
        }
        break;
      }
      const named = explicitNeighbour(view, cur, dir);
      if (named) {
        cur = named;
        break;
      }
      if ((dir === 'left' || dir === 'right') && adjustWidget(this.sim, cur, dir === 'left' ? -1 : 1)) break;
      if (cur.node.type === 'slider' && !cur.engine && (dir === 'left' || dir === 'right')) {
        setSlider(this.sim, cur, cur.value + (dir === 'left' ? -1 : 1) * cur.node.step);
        break;
      }
      if ((menuKeys || cur.engine) && (dir === 'left' || dir === 'right') && stepWidget(this.sim, cur, dir === 'left' ? -1 : 1)) break;
      // past the last row of a menu is the first one again, and before the first one the last (as the menus always did)
      cur = this.nearest(cur, dir, pool, menuKeys) ?? (menu && (dir === 'up' || dir === 'down') ? (dir === 'down' ? pool[0]! : pool[pool.length - 1]!) : cur);
      break;
    }
    // choosing a widget with the keys or the pad does what pointing at it does (a description under a menu follows both)
    if (cur && cur.key !== this.focusKey && cur.visible && cur.node.on.hover.length > 0) hover(this.sim, cur);
    if (cur && cur.key !== this.focusKey) noteOptionFocus(this.sim, cur);
    if (cur) this.focusKey = cur.key;
    // the scrollers around the chosen widget keep it in view (rows added or taken away above it move it, and that is followed too)
    if (cur) followFocus(this.sim, cur.key, this.scrollChain(cur.key));
    if (cur && ui.pressed('interact')) {
      this.autoFocus = false;
      if (cur.node.type === 'keybind') {
        this.capturingKey = cur.key;
        this.sim.runtime.scratch.set('ui.capturing', cur.key);
      }
      activateWidget(this.sim, cur);
      ui.consume('interact'); // the press went to the widget: nothing after it in this tick acts on it too
    }
  }

  /** The widget closest in a direction, by where they are on screen. */
  private nearest(from: ViewNode, dir: 'up' | 'down' | 'left' | 'right', all: ViewNode[], menuKeys: boolean): ViewNode | null {
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
      // left and right stay on their own line: a row with nothing to adjust does not send the focus to another row
      if (menuKeys && (dir === 'left' || dir === 'right') && Math.abs(dy) > Math.max(a.height, r.height) / 2) continue;
      // up and down go to the next row, whatever its width (a tick box on the right of its row must not be jumped over); left and right keep to their own line
      const s = along + across * (menuKeys && (dir === 'up' || dir === 'down') ? 0.25 : 2);
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
      l.el.dataset.focus = on ? '1' : '0'; // (also how the tests and the menu comparison see where the focus is)
      if (l.el.classList.contains('focused') !== on) {
        l.el.classList.toggle('focused', on && !this.current.get(key)?.node.states.focus);
        const vn = this.current.get(key);
        if (vn) this.paint(vn, l);
      }
    }
    // the pieces of the control that has the focus take its focus look
    const owner = this.current.get(this.focusKey);
    for (const p of owner?.parts ?? []) {
      const l = this.live.get(p.key);
      if (l && p.part!.mount !== 'screen') this.paint(p, l);
    }
    if (this.capturingKey && !this.current.has(this.capturingKey)) {
      this.capturingKey = '';
      this.sim.runtime.scratch.delete('ui.capturing');
    }
  }

  /** Called by the host when a key was captured (or the capture timed out). */
  captured(): void {
    this.capturingKey = '';
    this.sim.runtime.scratch.delete('ui.capturing');
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
    if (this.sim.claimInput === this.claim) this.sim.claimInput = null;
    if (!this.design) {
      this.root.removeEventListener('wheel', this.onWheel);
      window.removeEventListener('pointerdown', this.onWindowDown, true);
      window.removeEventListener('pointermove', this.onWindowMove, true);
      window.removeEventListener('pointerup', this.onWindowUp, true);
      window.removeEventListener('keydown', this.onKeyDown, true);
    }
    this.input?.remove();
    this.root.remove();
    this.drag?.ghost.remove();
    void walkView;
    void this.topLayer;
    void scrollTo;
  }
}
