import { useEffect, useRef, useState } from 'react';
import { floodPoints, getPixel, type Pt } from '@tilewright/runtime';
import { isoBoxPixels, shadeHex, shapePixels } from './paint';
import { renderStudio, type Overlay, type View } from './render';
import { studio, useStudio } from './store';
import type { CelStroke } from './doc';
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

  useEffect(() => {
    const c = canvas.current;
    if (!c || !doc) return;
    c.width = size.w;
    c.height = size.h;
    renderStudio(c.getContext('2d')!, size.w, size.h, doc, state, view.current, overlay.current);
  });

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

  const onDown = (e: React.PointerEvent): void => {
    canvas.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || space.current) {
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    const p = toPx(e);
    const tool = state.tool;
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

  const hiddenLayerNotice = (): void => store.notify('warn', 'This layer is hidden. Show it (eye button) before drawing on it.');

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
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="studio-status" data-testid="studio-status">
        {hover && hover.x >= 0 && hover.y >= 0 && hover.x < doc.width && hover.y < doc.height ? `(${hover.x}, ${hover.y})` : ''} {doc.width} x {doc.height} px, frame {doc.frame + 1}/{doc.frames.length}, zoom {state.zoom}x
      </div>
    </div>
  );
}
