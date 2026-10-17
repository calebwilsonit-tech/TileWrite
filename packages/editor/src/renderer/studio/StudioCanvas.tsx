import { useEffect, useRef, useState } from 'react';
import { floodPoints, getPixel, moveShape, newEllipseShape, newPathShape, newRectShape, pickShape, resizeShape, shapeBounds, type Box, type Pt, type VectorShape } from '@tilewright/runtime';
import { isoBoxPixels, shadeHex, shapePixels } from './paint';
import { renderStudio, type Overlay, type View } from './render';
import { VECTOR_TOOLS, studio, useStudio } from './store';
import type { CelStroke, VectorEdit } from './doc';
import { boxOfDrag, dragBox, handleAt, handlesOf, movePoint, snap, type HandleId } from './vector-tools';
import { store } from '../app/store';

declare global {
  interface Window {
    __studioPx?: (x: number, y: number) => { x: number; y: number };
    __studio?: typeof studio;
  }
}

const rectOf = (a: Pt, b: Pt): { x: number; y: number; w: number; h: number } => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x) + 1,
  h: Math.abs(a.y - b.y) + 1,
});

/** The pixel-art canvas: draws the sprite and turns mouse gestures into tool actions. */
export function StudioCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const view = useRef<View>({ x: 40, y: 40 });
  const overlay = useRef<Overlay>({});
  const gesture = useRef<{ tool: string; start: Pt; last: Pt; stroke?: CelStroke | null; mode?: 'select' | 'move' | 'copy' } | null>(null);
  /** A shape being drawn, moved or reshaped with the vector tools. */
  const vgesture = useRef<{ kind: 'draw' | 'move' | 'handle'; tool: string; edit: VectorEdit; start: Pt; index: number; baseLength: number; orig?: VectorShape; origBox?: Box; handle?: HandleId } | null>(null);
  /** A path being drawn point by point. */
  const pathDraft = useRef<{ edit: VectorEdit; points: Pt[] } | null>(null);
  /** Always the latest `finishPath` (the key handler is set up once). */
  const finishRef = useRef<(close: boolean) => void>(() => {});
  const panning = useRef<{ x: number; y: number } | null>(null);
  const space = useRef(false);
  const [hover, setHover] = useState<Pt | null>(null);
  const [, bump] = useState(0);

  const state = useStudio((s) => s);
  useStudio((s) => s.docVersion);
  const doc = studio.doc;

  // lets end-to-end tests find pixels on screen (page coordinates of a sprite pixel's centre)
  useEffect(() => {
    window.__studioPx = (x: number, y: number) => {
      const r = canvas.current!.getBoundingClientRect();
      return { x: r.left + view.current.x + (x + 0.5) * studio.state.zoom, y: r.top + view.current.y + (y + 0.5) * studio.state.zoom };
    };
    return () => {
      window.__studioPx = undefined;
    };
  }, []);

  // keep the canvas element the size of its container
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // centre the sprite when a different sprite is opened or the zoom changes the fit
  const openName = state.openName;
  useEffect(() => {
    if (!doc) return;
    view.current = { x: Math.round((size.w - doc.width * state.zoom) / 2), y: Math.round((size.h - doc.height * state.zoom) / 2) };
    bump((n) => n + 1);
  }, [openName, size.w, size.h]);

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.matches?.('input,textarea,select')) space.current = true;
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // a path in progress is dropped when another tool is chosen or another sprite opened
  useEffect(() => {
    return () => {
      pathDraft.current?.edit.cancel();
      pathDraft.current = null;
    };
  }, [state.tool, openName, doc?.layer]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !doc) return;
    c.width = size.w;
    c.height = size.h;
    const selected = VECTOR_TOOLS.includes(state.tool) && doc.currentIsVector && doc.shape !== null ? doc.shapes()[doc.shape] : undefined;
    const gizmo = selected && vgesture.current?.kind !== 'draw' ? { box: shapeBounds({ ...selected, stroke: 0 }), handles: handlesOf(selected) } : undefined;
    renderStudio(c.getContext('2d')!, size.w, size.h, doc, state, view.current, gizmo ? { ...overlay.current, gizmo } : overlay.current);
  });

  // keys for the vector tools: Enter finishes a path, Escape cancels it, Delete removes the selected shape, arrows nudge it
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const d = studio.doc;
      const t = e.target as HTMLElement | null;
      if (!d || !VECTOR_TOOLS.includes(studio.state.tool) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && t.matches('input,textarea,select')) return;
      if (store.state.workspace !== 'sprites') return;
      const draft = pathDraft.current;
      if (e.key === 'Enter' && draft) {
        e.preventDefault();
        finishRef.current(false);
      } else if (e.key === 'Escape') {
        if (draft) {
          draft.edit.cancel();
          pathDraft.current = null;
        } else d.selectShape(null);
        e.preventDefault();
        setVersion((n) => n + 1);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && d.shape !== null && !draft) {
        e.preventDefault();
        d.removeShape();
      } else if (e.key.startsWith('Arrow') && d.shape !== null && !draft) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        const edit = d.beginVectorEdit('Nudge shape');
        const s = edit?.shapes[d.shape];
        if (edit && s) {
          edit.shapes[d.shape] = moveShape(s, dx, dy);
          edit.commit();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!doc) {
    return (
      <div ref={wrap} className="studio-canvas-wrap empty">
        <p className="hint">Pick a sprite on the left, or make a new one, to start drawing.</p>
        <canvas ref={canvas} style={{ display: 'none' }} />
      </div>
    );
  }

  const toPx = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left - view.current.x) / state.zoom), y: Math.floor((e.clientY - r.top - view.current.y) / state.zoom) };
  };

  const paintColor = (): number => (state.tool === 'eraser' ? 0 : state.color);
  const sym = { x: state.symX, y: state.symY };
  const opts = (): { size: number; filled: boolean; sym: typeof sym; canvas: { w: number; h: number } } => ({ size: state.size, filled: state.filled, sym, canvas: { w: doc.width, h: doc.height } });
  const previewColor = (): string => {
    if (state.tool === 'eraser') return 'rgba(255,255,255,0.35)';
    const hex = doc.palette[state.color] ?? '#ffffffff';
    return hex.slice(0, 7) + '99';
  };

  const refresh = (): void => bump((n) => n + 1);
  const setVersion = bump;

  // ---- vector shapes ----

  const toF = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.current.x) / state.zoom, y: (e.clientY - r.top - view.current.y) / state.zoom };
  };

  /** Fill and outline for a new shape, from the colour chosen and the shape options. */
  const newStyle = (): { fill: number; stroke: number; strokeWidth: number } => {
    let fill = state.vFill ? state.color : 0;
    let stroke = state.vStroke;
    if (fill === 0 && stroke === 0) stroke = state.color;
    if (fill === 0 && stroke === 0) fill = 1;
    return { fill, stroke, strokeWidth: state.vStrokeWidth };
  };

  const shapeFromDrag = (tool: string, b: Box): VectorShape => {
    const st = newStyle();
    const base = tool === 'vrect' ? newRectShape(b.x, b.y, b.w, b.h, st.fill, st.stroke) : newEllipseShape(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, st.fill, st.stroke);
    return { ...base, strokeWidth: st.strokeWidth } as VectorShape;
  };

  const vectorNotice = (): void => {
    if (!doc.currentIsVector) store.notify('warn', 'Shapes go on a vector layer. Pick one in the layer list, or add one with "+ Shape layer".');
    else hiddenLayerNotice();
  };

  /** Finish the path being drawn (closing it if asked, or because the first point was clicked again). */
  const finishPath = (close: boolean): void => {
    const d = pathDraft.current;
    if (!d) return;
    pathDraft.current = null;
    const points = d.points;
    if (points.length < 2) {
      d.edit.cancel();
      refresh();
      return;
    }
    const st = newStyle();
    const closed = close || state.vClosed;
    const base = newPathShape(points, st.fill, st.stroke, closed, state.vSmooth);
    d.edit.shapes[d.edit.shapes.length - 1] = { ...base, strokeWidth: st.strokeWidth } as VectorShape;
    d.edit.commit();
    doc.selectShape(d.edit.shapes.length - 1);
    refresh();
  };

  finishRef.current = finishPath;

  const previewPath = (cursor: Pt | null): void => {
    const d = pathDraft.current;
    if (!d) return;
    const st = newStyle();
    const pts = cursor ? [...d.points, cursor] : [...d.points];
    if (pts.length < 2) pts.push({ ...pts[0]! });
    const base = newPathShape(pts, st.fill, st.stroke, state.vClosed, state.vSmooth);
    d.edit.shapes[d.edit.shapes.length - 1] = { ...base, strokeWidth: st.strokeWidth } as VectorShape;
    d.edit.apply();
  };

  const vectorDown = (e: React.PointerEvent): void => {
    const tool = state.tool;
    const f = toF(e);
    if (!doc.currentIsVector) return vectorNotice();
    if (tool === 'vrect' || tool === 'vellipse') {
      const edit = doc.beginVectorEdit(tool === 'vrect' ? 'Draw rectangle' : 'Draw ellipse');
      if (!edit) return vectorNotice();
      vgesture.current = { kind: 'draw', tool, edit, start: { x: snap(f.x), y: snap(f.y) }, index: edit.shapes.length, baseLength: edit.shapes.length };
      return;
    }
    if (tool === 'vpath') {
      const pt = { x: snap(f.x, 0.5), y: snap(f.y, 0.5) };
      const draft = pathDraft.current;
      if (!draft) {
        const edit = doc.beginVectorEdit('Draw path');
        if (!edit) return vectorNotice();
        edit.shapes.push(newPathShape([pt, pt], 1, 0));
        pathDraft.current = { edit, points: [pt] };
      } else {
        const first = draft.points[0]!;
        const last = draft.points[draft.points.length - 1]!;
        if (draft.points.length >= 3 && Math.hypot(pt.x - first.x, pt.y - first.y) <= 1.5) return finishPath(true);
        if (Math.hypot(pt.x - last.x, pt.y - last.y) > 0.01) draft.points.push(pt);
      }
      previewPath(null);
      refresh();
      return;
    }
    // select / move / reshape
    const shapes = doc.shapes();
    if (doc.shape !== null && shapes[doc.shape]) {
      const s = shapes[doc.shape]!;
      const h = handleAt(s, f.x, f.y, 6 / state.zoom);
      const edit = h ? doc.beginVectorEdit(h.id.startsWith('p') ? 'Move point' : 'Resize shape') : null;
      if (h && edit) {
        vgesture.current = { kind: 'handle', tool, edit, start: f, index: doc.shape, baseLength: 0, orig: s, origBox: shapeBounds({ ...s, stroke: 0 }), handle: h.id };
        return;
      }
    }
    const hit = pickShape(shapes, f.x, f.y);
    doc.selectShape(hit >= 0 ? hit : null);
    if (hit < 0) return refresh();
    const edit = doc.beginVectorEdit('Move shape');
    if (edit) vgesture.current = { kind: 'move', tool, edit, start: f, index: hit, baseLength: 0, orig: shapes[hit]! };
    refresh();
  };

  const vectorMove = (e: React.PointerEvent): boolean => {
    const f = toF(e);
    const g = vgesture.current;
    if (!g) {
      if (pathDraft.current) {
        previewPath({ x: snap(f.x, 0.5), y: snap(f.y, 0.5) });
        refresh();
        return true;
      }
      return false;
    }
    if (g.kind === 'draw') {
      const b = boxOfDrag(g.start, { x: snap(f.x), y: snap(f.y) });
      g.edit.shapes = g.edit.shapes.slice(0, g.baseLength);
      if (b) g.edit.shapes.push(shapeFromDrag(g.tool, b));
      g.edit.apply();
    } else if (g.kind === 'move' && g.orig) {
      g.edit.shapes[g.index] = moveShape(g.orig, snap(f.x - g.start.x), snap(f.y - g.start.y));
      g.edit.apply();
    } else if (g.kind === 'handle' && g.orig && g.origBox && g.handle) {
      if (g.handle.startsWith('p')) g.edit.shapes[g.index] = movePoint(g.orig, Number(g.handle.slice(1)), { x: snap(f.x, 0.5), y: snap(f.y, 0.5) });
      else g.edit.shapes[g.index] = resizeShape(g.orig, g.origBox, dragBox(g.origBox, g.handle, snap(f.x), snap(f.y)));
      g.edit.apply();
    }
    refresh();
    return true;
  };

  const vectorUp = (): boolean => {
    const g = vgesture.current;
    if (!g) return false;
    vgesture.current = null;
    if (g.kind === 'draw') {
      if (g.edit.shapes.length > g.baseLength) {
        g.edit.commit();
        doc.selectShape(g.edit.shapes.length - 1);
      } else g.edit.cancel();
    } else if (g.edit.changed) g.edit.commit();
    else g.edit.cancel();
    refresh();
    return true;
  };

  const onDown = (e: React.PointerEvent): void => {
    canvas.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || space.current) {
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    const p = toPx(e);
    const tool = state.tool;
    if (VECTOR_TOOLS.includes(tool)) return vectorDown(e);
    if (tool === 'picker') {
      // topmost visible layer's colour under the pixel
      let found = 0;
      for (const layer of [...doc.layers].reverse()) {
        if (!layer.visible) continue;
        const v = getPixel(doc.cel(doc.frame, layer.id), { w: doc.width, h: doc.height }, p.x, p.y);
        if (v !== 0) {
          found = v;
          break;
        }
      }
      if (found !== 0) studio.set({ color: found });
      return;
    }
    if (tool === 'fill') {
      const stroke = doc.beginStroke('Fill');
      if (!stroke) return hiddenLayerNotice();
      const pts = floodPoints(doc.currentCel, { w: doc.width, h: doc.height }, p);
      stroke.setMany(pts, state.color);
      stroke.commit();
      return;
    }
    if (tool === 'origin') {
      doc.setOrigin(p.x, p.y);
      return;
    }
    if (tool === 'isobox') {
      stampIsoBox(p);
      return;
    }
    if (tool === 'select') {
      const sel = doc.selection;
      const inside = sel && p.x >= sel.x && p.y >= sel.y && p.x < sel.x + sel.w && p.y < sel.y + sel.h;
      gesture.current = { tool, start: p, last: p, mode: inside ? (e.altKey ? 'copy' : 'move') : 'select' };
      return;
    }
    if (tool === 'pencil' || tool === 'eraser' || tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      const stroke = doc.beginStroke(tool === 'eraser' ? 'Erase' : tool === 'pencil' ? 'Draw' : tool === 'line' ? 'Line' : tool === 'rect' ? 'Rectangle' : 'Ellipse');
      if (!stroke) return hiddenLayerNotice();
      gesture.current = { tool, start: p, last: p, stroke };
      if (tool === 'pencil' || tool === 'eraser') stroke.setMany(shapePixels('pencil', p, p, opts()), paintColor());
      else overlay.current = { pixels: shapePixels(tool, p, p, opts()), pixelColor: previewColor() };
      refresh();
      return;
    }
    if (tool === 'hitbox' || tool === 'hurtbox') gesture.current = { tool, start: p, last: p };
  };

  const hiddenLayerNotice = (): void =>
    store.notify('warn', doc.currentIsVector ? 'This is a vector layer: draw with the shape tools, or turn it into pixels first (the Turn into pixels button in Layers).' : 'This layer is hidden. Show it (eye button) before drawing on it.');

  const stampIsoBox = (p: Pt): void => {
    const stroke = doc.beginStroke('Iso box');
    if (!stroke) return hiddenLayerNotice();
    const base = doc.palette[state.color] ?? '#ffffffff';
    const top = state.color;
    const left = doc.addColor(shadeHex(base, 0.72));
    const right = doc.addColor(shadeHex(base, 0.52));
    const b = state.isoBox;
    const px = isoBoxPixels(p.x, p.y, b.w, b.d, b.h, b.s, { w: doc.width, h: doc.height });
    stroke.setMany(px.left, left > 0 ? left : top);
    stroke.setMany(px.right, right > 0 ? right : top);
    stroke.setMany(px.top, top);
    stroke.commit();
  };

  const onMove = (e: React.PointerEvent): void => {
    if (panning.current) {
      view.current = { x: view.current.x + e.clientX - panning.current.x, y: view.current.y + e.clientY - panning.current.y };
      panning.current = { x: e.clientX, y: e.clientY };
      refresh();
      return;
    }
    const p = toPx(e);
    setHover(p);
    if (VECTOR_TOOLS.includes(state.tool) && vectorMove(e)) return;
    const g = gesture.current;
    if (!g) {
      if (state.tool === 'isobox') {
        const b = state.isoBox;
        const px = isoBoxPixels(p.x, p.y, b.w, b.d, b.h, b.s, { w: doc.width, h: doc.height });
        overlay.current = { pixels: [...px.left, ...px.right, ...px.top], pixelColor: previewColor() };
      } else if (state.tool === 'pencil' || state.tool === 'eraser') overlay.current = { pixels: shapePixels('pencil', p, p, opts()), pixelColor: previewColor() };
      else overlay.current = {};
      refresh();
      return;
    }
    if (g.tool === 'pencil' || g.tool === 'eraser') {
      g.stroke?.setMany(shapePixels('pencil', g.last, p, opts()), paintColor());
      g.last = p;
    } else if (g.tool === 'line' || g.tool === 'rect' || g.tool === 'ellipse') {
      overlay.current = { pixels: shapePixels(g.tool, g.start, p, opts()), pixelColor: previewColor() };
      g.last = p;
    } else if (g.tool === 'select') {
      g.last = p;
      if (g.mode === 'select') overlay.current = { rect: { ...rectOf(g.start, p), color: '#ffffff' } };
      else {
        const sel = doc.selection!;
        overlay.current = { floating: { rect: sel, dx: p.x - g.start.x, dy: p.y - g.start.y } };
      }
    } else if (g.tool === 'hitbox' || g.tool === 'hurtbox') {
      g.last = p;
      overlay.current = { rect: { ...rectOf(g.start, p), color: g.tool === 'hitbox' ? '#ff5d5d' : '#5da8ff' } };
    }
    refresh();
  };

  const onUp = (e: React.PointerEvent): void => {
    if (panning.current) {
      panning.current = null;
      return;
    }
    if (vectorUp()) return;
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const p = toPx(e);
    overlay.current = {};
    if (g.tool === 'pencil' || g.tool === 'eraser') g.stroke?.commit();
    else if (g.tool === 'line' || g.tool === 'rect' || g.tool === 'ellipse') {
      g.stroke?.setMany(shapePixels(g.tool, g.start, p, opts()), paintColor());
      g.stroke?.commit();
    } else if (g.tool === 'select') {
      if (g.mode === 'select') {
        const r = rectOf(g.start, p);
        const clipped = {
          x: Math.max(0, r.x),
          y: Math.max(0, r.y),
          w: Math.min(doc.width, r.x + r.w) - Math.max(0, r.x),
          h: Math.min(doc.height, r.y + r.h) - Math.max(0, r.y),
        };
        const tiny = g.start.x === p.x && g.start.y === p.y;
        doc.setSelection(tiny || clipped.w <= 0 || clipped.h <= 0 ? null : clipped);
      } else doc.moveSelection(p.x - g.start.x, p.y - g.start.y, g.mode === 'copy');
    } else if (g.tool === 'hitbox' || g.tool === 'hurtbox') {
      const r = rectOf(g.start, p);
      doc.addBox(g.tool === 'hitbox' ? 'hit' : 'hurt', r);
    }
    refresh();
  };

  const onWheel = (e: React.WheelEvent): void => {
    const rect = canvas.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const px = (mx - view.current.x) / state.zoom;
    const py = (my - view.current.y) / state.zoom;
    const next = Math.max(1, Math.min(48, state.zoom + (e.deltaY < 0 ? 1 : -1) * (state.zoom >= 12 ? 2 : 1)));
    view.current = { x: Math.round(mx - px * next), y: Math.round(my - py * next) };
    studio.set({ zoom: next });
  };

  const cursor = panning.current || space.current ? 'grabbing' : state.tool === 'picker' ? 'copy' : 'crosshair';
  return (
    <div ref={wrap} className="studio-canvas-wrap">
      <canvas
        ref={canvas}
        data-testid="studio-canvas"
        style={{ cursor, touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          setHover(null);
          if (!gesture.current) {
            overlay.current = {};
            refresh();
          }
        }}
        onWheel={onWheel}
        onDoubleClick={() => state.tool === 'vpath' && finishPath(false)}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="studio-status" data-testid="studio-status">
        {hover && hover.x >= 0 && hover.y >= 0 && hover.x < doc.width && hover.y < doc.height ? `(${hover.x}, ${hover.y})` : ''} {doc.width} x {doc.height} px, frame {doc.frame + 1}/{doc.frames.length}, zoom {state.zoom}x
      </div>
    </div>
  );
}
