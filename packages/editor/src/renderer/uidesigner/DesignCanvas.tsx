import { useEffect, useRef, useState } from 'react';
import { UiScreens, fillAssetData } from '@tilewright/behaviors';
import { Simulation, findWidget, parentOf, walkWidgets, type UiDoc, type UiNode, type VariableValue } from '@tilewright/runtime';
import { store } from '../app/store';
import { anchorForDrop, designScreen, linkFocus, moveWidget, rootOf, updateWidget, addWidget, type Dir } from './ui-edit';
import { RESOLUTIONS, designer, useDesigner } from './state';
import { namesUsed } from './bindings';

/** The picture of the open screen, drawn by the same code the game uses, with handles to move and resize what is selected. */

const CONTAINERS = new Set(['panel', 'list', 'grid', 'tabs', 'hand', 'turnOrder']);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The id of the widget an element draws (the last part of its key, without the repeat number). */
const idOfElement = (el: Element): string | null => {
  const key = (el as HTMLElement).dataset?.id;
  if (!key) return null;
  return key.split('/').pop()!.split('#')[0]!;
};

interface CanvasApi {
  /** Add a new widget at a point on the screen (client coordinates), as when dragged from the palette. */
  drop(type: Parameters<typeof addWidget>[3], clientX: number, clientY: number): boolean;
  contains(clientX: number, clientY: number): boolean;
}
export const canvasApi: { current: CanvasApi | null } = { current: null };

/** The names a screen reads, to offer made-up values for them. */
export function namesOnScreen(root: UiNode, doc?: UiDoc): string[] {
  const out = new Set<string>();
  const visited = new Set<string>();
  const scan = (w: UiNode): void => {
    for (const f of [w.text, w.tooltip, w.visible, w.enabled]) for (const n of namesUsed(f)) out.add(n);
    for (const f of [w.value, w.max]) {
      const t = f.trim().replace(/^{(.*)}$/, '$1');
      if (t && Number.isNaN(Number(t))) out.add(t);
    }
    // pieces reused from UI prefabs read names too
    for (const name of [w.type === 'instance' ? w.prefab : '', w.template]) {
      const p = name && !visited.has(name) ? doc?.prefabs.find((x) => x.name === name) : undefined;
      if (p) {
        visited.add(name);
        walkWidgets(p.widget, scan);
      }
    }
  };
  walkWidgets(root, scan);
  return [...out].filter((n) => !/^(row|item|unit|slot|index|self)(.|$)/.test(n) && !n.startsWith('settings.') && !n.startsWith('@') && !n.includes('.'));
}

export function DesignCanvas({ doc }: { doc: UiDoc }) {
  const screenId = useDesigner((s) => s.screenId);
  const selected = useDesigner((s) => s.selected);
  const resolution = useDesigner((s) => s.resolution);
  const mode = useDesigner((s) => s.mode);
  const showSafe = useDesigner((s) => s.showSafe);
  const preview = useDesigner((s) => s.preview);
  const prefabName = useDesigner((s) => s.prefab);
  const screen = designScreen(doc, screenId, prefabName);
  const res = RESOLUTIONS.find((r) => r.id === resolution) ?? RESOLUTIONS[0]!;

  const area = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [box, setBox] = useState<Box | null>(null);
  const [arrows, setArrows] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const [dragLine, setDragLine] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const simRef = useRef<Simulation | null>(null);
  const uiRef = useRef<UiScreens | null>(null);
  const live = useRef({ doc, screen, preview, selected, mode, scale });
  live.current = { doc, screen, preview, selected, mode, scale };

  // fit the picture into the room there is
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = (): void => setScale(Math.max(0.2, Math.min(1.5, Math.min((el.clientWidth - 24) / res.w, (el.clientHeight - 24) / res.h))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [res.w, res.h]);

  const elements = (): Map<string, HTMLElement> => {
    const map = new Map<string, HTMLElement>();
    host.current?.querySelectorAll<HTMLElement>('.tw-w').forEach((e) => {
      const id = idOfElement(e);
      if (id && !map.has(id)) map.set(id, e);
    });
    return map;
  };

  /** A rectangle in the picture's own pixels. */
  const rectOf = (e: Element): Box => {
    const h = host.current!.getBoundingClientRect();
    const r = e.getBoundingClientRect();
    const s = live.current.scale;
    return {
      x: (r.left - h.left) / s,
      y: (r.top - h.top) / s,
      w: r.width / s,
      h: r.height / s,
    };
  };

  useEffect(() => {
    const sim = new Simulation(1);
    simRef.current = sim;
    const ui = new UiScreens(host.current!, sim, true);
    uiRef.current = ui;
    let raf = 0;
    const loop = (): void => {
      const { doc: d, screen: sc, preview: pv, selected: sel, mode: md } = live.current;
      sim.assets.ui = sc && !d.screens.some((x) => x.id === sc.id) ? { ...d, screens: [...d.screens, sc] } : sc ? { ...d, screens: d.screens.map((x) => (x.id === sc.id ? sc : x)) } : d;
      sim.assets.tables.clear();
      for (const t of store.tables) sim.assets.tables.set(t.name, t);
      fillAssetData(sim.assets, store.data);
      const vars = sim.runtime.vars;
      for (const k of Object.keys(vars)) delete vars[k];
      for (const v of store.doc?.variables ?? []) vars[v.name] = v.value;
      if (sc) {
        for (const n of namesOnScreen(sc.root, d)) if (vars[n] === undefined) vars[n] = 0;
        Object.assign(vars, pv);
      }
      sim.runtime.ui.stack = sc ? [sc.name] : [];
      ui.update();
      if (sc && sel) {
        const el = elements().get(sel);
        const b = el ? rectOf(el) : null;
        setBox((prev) => (b && prev && Math.abs(prev.x - b.x) < 0.5 && Math.abs(prev.y - b.y) < 0.5 && Math.abs(prev.w - b.w) < 0.5 && Math.abs(prev.h - b.h) < 0.5 ? prev : b));
      } else setBox((prev) => (prev === null ? prev : null));
      if (sc && md === 'focus') {
        const els = elements();
        const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
        walkWidgets(sc.root, (w) => {
          for (const dir of ['up', 'down', 'left', 'right'] as const) {
            const to = w.focus[dir];
            const a = els.get(w.id);
            const b = to ? els.get(to) : undefined;
            if (a && b) {
              const ra = rectOf(a);
              const rb = rectOf(b);
              lines.push({
                x1: ra.x + ra.w / 2,
                y1: ra.y + ra.h / 2,
                x2: rb.x + rb.w / 2,
                y2: rb.y + rb.h / 2,
              });
            }
          }
        });
        setArrows((prev) => (JSON.stringify(prev) === JSON.stringify(lines) ? prev : lines));
      } else setArrows((prev) => (prev.length === 0 ? prev : []));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ui.dispose();
      uiRef.current = null;
      simRef.current = null;
    };
  }, []);

  /** The widget under a point, deepest first. */
  const widgetAt = (clientX: number, clientY: number): { id: string; el: HTMLElement } | null => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (!(el instanceof HTMLElement) || !el.classList.contains('tw-w')) continue;
      const id = idOfElement(el);
      if (id) return { id, el };
    }
    return null;
  };

  const containerAt = (clientX: number, clientY: number): { id: string; el: HTMLElement } | null => {
    const sc = live.current.screen;
    if (!sc) return null;
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (!(el instanceof HTMLElement) || !el.classList.contains('tw-w')) continue;
      const id = idOfElement(el);
      const w = id ? findWidget(sc.root, id) : null;
      if (w && CONTAINERS.has(w.type)) return { id: w.id, el };
    }
    return { id: sc.root.id, el: elements().get(sc.root.id) ?? host.current! };
  };

  canvasApi.current = {
    contains(cx, cy) {
      const r = host.current?.getBoundingClientRect();
      return !!r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    },
    drop(type, cx, cy) {
      const { doc: d, screen: sc } = live.current;
      if (!sc) return false;
      const target = containerAt(cx, cy);
      if (!target) return false;
      const parent = findWidget(sc.root, target.id)!;
      const r = target.el.getBoundingClientRect();
      const s = live.current.scale;
      const made = addWidget(d, sc.id, parent.id, type);
      const w = findWidget(made.doc.screens.find((x) => x.id === sc.id)!.root, made.id)!;
      let next = made.doc;
      if (parent.layout === 'free') {
        const rect = { w: r.width / s, h: r.height / s };
        const px = (cx - r.left) / s - w.w / 2;
        const py = (cy - r.top) / s - w.h / 2;
        const pos = anchorForDrop(rect, { x: px, y: py, w: w.w, h: w.h });
        next = updateWidget(next, made.id, (n) => Object.assign(n, pos));
      }
      designer.edit(next);
      designer.set({ selected: made.id });
      return true;
    },
  };

  const onDown = (e: React.PointerEvent): void => {
    if (!screen) return;
    const hit = widgetAt(e.clientX, e.clientY);
    // clicking the screen's own root selects nothing (it fills the whole picture)
    if (mode === 'focus') {
      if (!hit) return;
      designer.set({ selected: hit.id });
      const start = rectOf(hit.el);
      const from = hit.id;
      const toLocal = (ev: PointerEvent): { x: number; y: number } => {
        const h = host.current!.getBoundingClientRect();
        return {
          x: (ev.clientX - h.left) / live.current.scale,
          y: (ev.clientY - h.top) / live.current.scale,
        };
      };
      const move = (ev: PointerEvent): void => {
        const p = toLocal(ev);
        setDragLine({
          x1: start.x + start.w / 2,
          y1: start.y + start.h / 2,
          x2: p.x,
          y2: p.y,
        });
      };
      const up = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDragLine(null);
        const over = widgetAt(ev.clientX, ev.clientY);
        if (!over || over.id === from) return;
        const a = rectOf(over.el);
        const dx = a.x + a.w / 2 - (start.x + start.w / 2);
        const dy = a.y + a.h / 2 - (start.y + start.h / 2);
        const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        designer.edit(linkFocus(live.current.doc, from, over.id, dir, true));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (!hit || hit.id === screen.root.id) {
      designer.set({ selected: hit ? hit.id : null });
      return;
    }
    designer.set({ selected: hit.id });
    const id = hit.id;
    const w = findWidget(screen.root, id)!;
    const parent = parentOf(screen.root, id);
    if (!parent) return;
    const before = live.current.doc;
    const startPointer = { x: e.clientX, y: e.clientY };
    const startBox = rectOf(hit.el);
    const parentEl = elements().get(parent.id) ?? host.current!;
    const parentRect = rectOf(parentEl);
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const dx = (ev.clientX - startPointer.x) / live.current.scale;
      const dy = (ev.clientY - startPointer.y) / live.current.scale;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      if (parent.layout !== 'free') return; // stacked widgets are reordered when let go
      const nb = {
        x: startBox.x - parentRect.x + dx,
        y: startBox.y - parentRect.y + dy,
        w: startBox.w,
        h: startBox.h,
      };
      const pos = anchorForDrop({ w: parentRect.w, h: parentRect.h }, nb);
      designer.live(updateWidget(before, id, (n) => Object.assign(n, pos)));
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) return;
      if (parent.layout !== 'free') {
        const under = document
          .elementsFromPoint(ev.clientX, ev.clientY)
          .map((el) => (el instanceof HTMLElement && el.classList.contains('tw-w') ? idOfElement(el) : null))
          .find((x) => x && x !== id && parent.children.some((c) => c.id === x));
        designer.edit(moveWidget(before, id, parent.id, under ?? undefined));
      } else designer.commit(before);
    };
    void w;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e: React.PointerEvent, edge: string): void => {
    e.stopPropagation();
    e.preventDefault();
    const { screen: sc, doc: d } = live.current;
    const sel = live.current.selected;
    if (!sc || !sel || !box) return;
    const parent = parentOf(sc.root, sel);
    if (!parent) return;
    const before = d;
    const parentEl = elements().get(parent.id) ?? host.current!;
    const parentRect = rectOf(parentEl);
    const start = { ...box };
    const p0 = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent): void => {
      const dx = (ev.clientX - p0.x) / live.current.scale;
      const dy = (ev.clientY - p0.y) / live.current.scale;
      let { x, y, w, h } = start;
      if (edge.includes('e')) w = Math.max(8, start.w + dx);
      if (edge.includes('s')) h = Math.max(8, start.h + dy);
      if (edge.includes('w')) {
        w = Math.max(8, start.w - dx);
        x = start.x + start.w - w;
      }
      if (edge.includes('n')) {
        h = Math.max(8, start.h - dy);
        y = start.y + start.h - h;
      }
      const pos = parent.layout === 'free' ? anchorForDrop({ w: parentRect.w, h: parentRect.h }, { x: x - parentRect.x, y: y - parentRect.y, w, h }) : {};
      designer.live(
        updateWidget(before, sel, (n) =>
          Object.assign(n, pos, {
            w: Math.round(w),
            h: Math.round(h),
            wMode: 'fixed',
            hMode: 'fixed',
          }),
        ),
      );
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      designer.commit(before);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const safe = doc.safeArea;
  return (
    <div className="ui-canvas-area" ref={area} data-testid="ui-canvas-area">
      {!screen && (
        <p className="hint" data-testid="ui-no-screen">
          Make a screen (+ New screen on the left), then drag widgets from the palette onto the picture.
        </p>
      )}
      {
        <div
          className="ui-monitor"
          style={{
            display: screen ? undefined : 'none',
            width: res.w * scale,
            height: res.h * scale,
          }}
          data-testid="ui-monitor"
        >
          <div
            className="ui-stage"
            style={{
              width: res.w,
              height: res.h,
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
            }}
            data-testid="ui-stage"
            data-res={res.id}
          >
            <div className="ui-host" ref={host} />
            {showSafe && safe > 0 && <div className="ui-safe" style={{ inset: `${safe * 100}%` }} />}
            {showSafe && safe === 0 && <div className="ui-safe" style={{ inset: '5%' }} title="A typical safe area (set yours under the picture)" />}
            <div className="ui-overlay" data-testid="ui-overlay" onPointerDown={onDown}>
              {box && selected && mode === 'layout' && (
                <div
                  className="ui-selbox"
                  data-testid="ui-selbox"
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.w,
                    height: box.h,
                  }}
                >
                  {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((edge) => (
                    <span key={edge} className={`ui-handle ${edge}`} data-testid={`ui-handle-${edge}`} onPointerDown={(e) => startResize(e, edge)} />
                  ))}
                </div>
              )}
              {box && selected && mode === 'focus' && (
                <div
                  className="ui-selbox focus"
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.w,
                    height: box.h,
                  }}
                />
              )}
              {mode === 'focus' && (
                <svg className="ui-arrows" width={res.w} height={res.h}>
                  <defs>
                    <marker id="ui-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 z" fill="#ffd34a" />
                    </marker>
                  </defs>
                  {arrows.map((a, i) => (
                    <line key={i} data-testid="ui-focus-arrow" x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="#ffd34a" strokeWidth={2} markerEnd="url(#ui-arrowhead)" />
                  ))}
                  {dragLine && <line x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2} stroke="#fff" strokeDasharray="6 4" strokeWidth={2} />}
                </svg>
              )}
            </div>
          </div>
        </div>
      }
    </div>
  );
}

export type { VariableValue };
export { rootOf };
