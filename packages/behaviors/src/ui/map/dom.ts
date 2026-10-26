import { rotateGrid, type Simulation } from '@tilewright/runtime';
import { host } from '../../plugins/host';
import { uiBridge, type ViewNode } from '../screens-logic';
import { panMap, zoomMap } from './actions';
import { parseColour, cssOfRgba, settingBool, settingNumber, settingText, unpackColour } from './layers';
import { findLiveMap, mapRun } from './state';
import type { LayerPlan, MapInfo } from './view';
import { cellToPlane, planeToCell, planeToView, viewToPlane } from './world';

/**
 * Paints a Map widget: one canvas for every layer (so each has its own opacity and blend, in its own place in the order), and the
 * pointer: click, drag to pan, wheel to zoom, two fingers to pinch. What to paint is decided by build.ts; this only draws it.
 */

const images = new Map<string, HTMLImageElement>();
function imageFor(url: string, redraw: () => void): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.onload = redraw;
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** The map's own size on screen, written down so the next frame lays out for it. */
export function applyMap(sim: Simulation, current: Map<string, ViewNode>, elOf: (key: string) => HTMLElement | undefined, design: boolean): void {
  void design;
  for (const [key, vn] of current) {
    if (!vn.map) continue;
    const el = elOf(key);
    if (!el) continue;
    const run = mapRun(sim, vn.node.id, vn.map.spec);
    run.view = { w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) };
  }
}

export function drawMaps(sim: Simulation, current: Map<string, ViewNode>, elOf: (key: string) => HTMLElement | undefined): void {
  for (const [key, vn] of current) {
    const info = vn.map;
    if (!info) continue;
    const el = elOf(key);
    if (!el) continue;
    const wanted = new Set<string>();
    for (const plan of info.layers) {
      if (plan.kind === 'markers') continue;
      wanted.add(plan.id);
      let canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-layer="${CSS.escape(plan.id)}"]`);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.dataset.layer = plan.id;
        canvas.className = 'tw-map-layer';
        canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
        el.insertBefore(canvas, el.querySelector('.tw-overlay'));
      }
      canvas.style.zIndex = String(plan.index * 100);
      canvas.style.display = plan.visible && vn.visible ? '' : 'none';
      canvas.style.opacity = String(plan.opacity);
      canvas.style.mixBlendMode = plan.kind === 'fog' && plan.data.kind === 'fog' && plan.data.draw.look === 'desaturate' ? 'saturation' : plan.blend === 'normal' ? '' : plan.blend;
      if (!plan.visible || !vn.visible) continue;
      const w = Math.max(1, info.view.w);
      const h = Math.max(1, info.view.h);
      if (canvas.dataset.sig === plan.sig && canvas.width === w && canvas.height === h) continue;
      canvas.dataset.sig = plan.sig;
      canvas.width = w;
      canvas.height = h;
      paintLayer(sim, info, plan, canvas);
    }
    for (const c of [...el.querySelectorAll<HTMLCanvasElement>('canvas.tw-map-layer')]) if (!wanted.has(c.dataset.layer ?? '')) c.remove();
    // the old single canvas of the widget is not used
    const old = el.querySelector<HTMLCanvasElement>('canvas.tw-map-canvas');
    if (old) old.remove();
  }
}

function paintLayer(sim: Simulation, info: MapInfo, plan: LayerPlan, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { view, proj, world } = info;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const toView = (x: number, y: number, height = 0): { x: number; y: number } => {
    const p = cellToPlane(proj, x, y, height);
    return planeToView(view, p.x, p.y);
  };
  /** Map plane -> window as one transform, for pictures that are drawn whole. */
  const planeTransform = (): void => {
    const a = (view.angle * Math.PI) / 180;
    ctx.translate(view.w / 2, view.h / 2);
    ctx.rotate(a);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(-view.cx, -view.cy);
  };
  const redraw = (): void => {
    canvas.dataset.sig = '';
  };
  const d = plan.data;
  switch (d.kind) {
    case 'terrain': {
      const off = document.createElement('canvas');
      off.width = d.w;
      off.height = d.h;
      const g = off.getContext('2d')!;
      const img = g.createImageData(d.w, d.h);
      new Uint32Array(img.data.buffer).set(d.colours);
      if (proj.kind !== 'iso') {
        g.putImageData(img, 0, 0);
        ctx.save();
        planeTransform();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, d.w * proj.cell, d.h * proj.cell);
        ctx.restore();
        paintOutline(ctx, plan, d.colours, d.w, d.h, (x, y) => toView(x, y));
      } else {
        // isometric: every cell is a diamond (a little higher where the ground is), drawn from the back to the front
        const order: number[] = [];
        for (let i = 0; i < d.w * d.h; i++) if (d.colours[i]) order.push(i);
        const key = (i: number): number => {
          const r = rotateGrid(i % d.w, Math.floor(i / d.w), proj.iso!);
          return r.x + r.y;
        };
        order.sort((a, b) => key(a) - key(b));
        for (const i of order) {
          const x = i % d.w;
          const y = Math.floor(i / d.w);
          const hgt = world.heightAt(x, y);
          const p0 = toView(x, y, hgt);
          const p1 = toView(x + 1, y, hgt);
          const p2 = toView(x + 1, y + 1, hgt);
          const p3 = toView(x, y + 1, hgt);
          const c = unpackColour(d.colours[i]!);
          ctx.fillStyle = cssOfRgba(c);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fill();
          if (settingText(plan.settings.outline, 'none') === 'cells') {
            ctx.strokeStyle = cssOfRgba(parseColour(settingText(plan.settings.outlineColour, '#00000066')));
            ctx.stroke();
          }
        }
      }
      break;
    }
    case 'regions': {
      for (const r of d.items) {
        const p = [toView(r.x, r.y), toView(r.x + r.w, r.y), toView(r.x + r.w, r.y + r.h), toView(r.x, r.y + r.h)];
        ctx.beginPath();
        ctx.moveTo(p[0]!.x, p[0]!.y);
        for (const q of p.slice(1)) ctx.lineTo(q.x, q.y);
        ctx.closePath();
        if (d.style === 'fill' || d.style === 'both') {
          ctx.fillStyle = r.colour;
          ctx.fill();
        }
        if (d.style === 'outline' || d.style === 'both') {
          ctx.strokeStyle = r.colour.replace(/,\s*[\d.]+\)$/, ',1)');
          ctx.lineWidth = d.lineWidth;
          ctx.stroke();
        }
      }
      break;
    }
    case 'paths': {
      ctx.strokeStyle = d.colour;
      ctx.lineWidth = d.lineWidth;
      ctx.setLineDash(d.dash.split(',').map((t) => Number(t.trim())).filter((n) => Number.isFinite(n) && n > 0));
      for (const s of d.segs) {
        const a = toView(s.x1, s.y1);
        const b = toView(s.x2, s.y2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      break;
    }
    case 'labels': {
      ctx.fillStyle = d.colour;
      ctx.font = `${d.size}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const t of d.items) {
        const p = toView(t.x, t.y);
        ctx.fillText(t.text, p.x, p.y);
      }
      break;
    }
    case 'fog': {
      const f = d.draw;
      const cover = d.draw.look === 'dim' ? `rgba(0,0,0,${f.dim})` : d.draw.look === 'desaturate' ? '#808080' : f.colour;
      ctx.save();
      // cover the whole world, then cut away what is known
      ctx.fillStyle = cover;
      if (f.look === 'picture' && f.picture) {
        const url = uiBridge(sim)?.spriteUrl?.(f.picture) ?? '';
        const img = url ? imageFor(url, redraw) : null;
        if (img) ctx.fillStyle = ctx.createPattern(img, 'repeat') ?? cover;
      }
      const corners = [toView(0, 0), toView(world.w, 0), toView(world.w, world.h), toView(0, world.h)];
      ctx.beginPath();
      ctx.moveTo(corners[0]!.x, corners[0]!.y);
      for (const q of corners.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      if (proj.kind !== 'iso') {
        const mask = document.createElement('canvas');
        mask.width = f.w;
        mask.height = f.h;
        const g = mask.getContext('2d')!;
        const img = g.createImageData(f.w, f.h);
        for (let i = 0; i < f.cells.length; i++) img.data[i * 4 + 3] = f.cells[i] ? 255 : 0;
        g.putImageData(img, 0, 0);
        planeTransform();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(mask, 0, 0, f.w * proj.cell, f.h * proj.cell);
      } else {
        ctx.fillStyle = '#000';
        for (let i = 0; i < f.cells.length; i++) {
          if (!f.cells[i]) continue;
          const x = i % f.w;
          const y = Math.floor(i / f.w);
          const p = [toView(x, y), toView(x + 1, y), toView(x + 1, y + 1), toView(x, y + 1)];
          ctx.beginPath();
          ctx.moveTo(p[0]!.x, p[0]!.y);
          for (const q of p.slice(1)) ctx.lineTo(q.x, q.y);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
      break;
    }
    default:
      break;
  }
  // layers that are not made from the world's cells
  if (plan.kind === 'grid') {
    const every = Math.max(1, settingNumber(plan.settings.every, 8));
    ctx.strokeStyle = cssOfRgba(parseColour(settingText(plan.settings.colour, '#ffffff22')));
    ctx.lineWidth = settingNumber(plan.settings.lineWidth, 1);
    for (let x = 0; x <= world.w; x += every) {
      const a = toView(x, 0);
      const b = toView(x, world.h);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let y = 0; y <= world.h; y += every) {
      const a = toView(0, y);
      const b = toView(world.w, y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  } else if (plan.kind === 'picture') {
    const name = settingText(plan.settings.picture);
    const url = name ? (uiBridge(sim)?.spriteUrl?.(name) ?? '') : '';
    const img = url ? imageFor(url, redraw) : null;
    if (img) {
      const fit = settingText(plan.settings.fit, 'stretch');
      ctx.save();
      planeTransform();
      ctx.imageSmoothingEnabled = !(img.naturalWidth <= 64);
      if (fit === 'tile') {
        const size = Math.max(4, settingNumber(plan.settings.tileSize, 64));
        const pat = ctx.createPattern(img, 'repeat');
        if (pat) {
          ctx.scale(size / img.naturalWidth, size / img.naturalWidth);
          ctx.fillStyle = pat;
          ctx.fillRect(0, 0, (proj.plane.w * img.naturalWidth) / size, (proj.plane.h * img.naturalWidth) / size);
        }
      } else if (fit === 'world') {
        const x = settingNumber(plan.settings.x, 0);
        const y = settingNumber(plan.settings.y, 0);
        const wc = settingNumber(plan.settings.w, 0) || world.w;
        const hc = settingNumber(plan.settings.h, 0) || world.h;
        const a = cellToPlane(proj, x, y);
        const b = cellToPlane(proj, x + wc, y + hc);
        ctx.drawImage(img, a.x, a.y, b.x - a.x, b.y - a.y);
      } else ctx.drawImage(img, 0, 0, proj.plane.w, proj.plane.h);
      ctx.restore();
    }
  } else if (d.kind === 'none' && host.ext.mapLayers.has(plan.kind)) {
    host.ext.mapLayers.get(plan.kind)!.draw({
      sim,
      settings: plan.settings,
      ctx,
      width: canvas.width,
      height: canvas.height,
      world: { w: world.w, h: world.h, tileAt: world.tileAt, heightAt: world.heightAt, valueAt: world.valueAt },
      toView,
      cellPx: proj.cell * view.zoom,
      zoom: info.zoom,
    });
  }
}

/** Lines where the colour changes, or around every cell (a terrain layer's outline setting). */
function paintOutline(ctx: CanvasRenderingContext2D, plan: LayerPlan, colours: Uint32Array, w: number, h: number, toView: (x: number, y: number) => { x: number; y: number }): void {
  const mode = settingText(plan.settings.outline, 'none');
  if (mode === 'none') return;
  ctx.strokeStyle = cssOfRgba(parseColour(settingText(plan.settings.outlineColour, '#00000066')));
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = colours[y * w + x];
      if (!c) continue;
      const right = x + 1 < w ? colours[y * w + x + 1] : 0;
      const down = y + 1 < h ? colours[(y + 1) * w + x] : 0;
      if (mode === 'cells' || right !== c) {
        const a = toView(x + 1, y);
        const b = toView(x + 1, y + 1);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      if (mode === 'cells' || down !== c) {
        const a = toView(x, y + 1);
        const b = toView(x + 1, y + 1);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
  }
  ctx.stroke();
}

// ---------- the pointer ----------

export function wireMap(sim: Simulation, key: string, el: HTMLElement, first: ViewNode, get: () => ViewNode | undefined, design: () => boolean): void {
  if (first.node.type !== 'map' || design()) return;
  const pointers = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; moved: boolean } | null = null;
  let pinch: { dist: number; zoom: number } | null = null;
  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const live = (): ReturnType<typeof findLiveMap> => findLiveMap(sim, get()?.node.id ?? first.node.id);
  el.addEventListener('pointerdown', (e) => {
    const vn = get();
    if (!vn?.map || !vn.visible) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) start = { ...local(e), moved: false };
    if (pointers.size === 2 && vn.map.spec.nav.pinch) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: vn.map.run.zoom };
    }
  });
  el.addEventListener('pointermove', (e) => {
    const vn = get();
    const info = vn?.map;
    if (!info) return;
    const p = local(e);
    const cell = planeToCell(info.proj, viewToPlane(info.view, p.x, p.y).x, viewToPlane(info.view, p.x, p.y).y);
    info.run.hover = cell.x >= 0 && cell.y >= 0 && cell.x < info.world.w && cell.y < info.world.h ? { x: Math.floor(cell.x), y: Math.floor(cell.y) } : null;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const lv = live();
    if (pointers.size >= 2 && pinch && lv && info.spec.nav.pinch) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mid = local({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 });
      if (pinch.dist > 4) zoomMap(sim, lv, 'to', pinch.zoom * (dist / pinch.dist), mid);
      if (start) start.moved = true;
      return;
    }
    if (start && lv && info.spec.nav.drag && e.buttons !== 0) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (!start.moved && Math.hypot(p.x - start.x, p.y - start.y) < 5) return;
      start.moved = true;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      panMap(sim, lv, -dx, -dy);
    }
  });
  const end = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) start = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener(
    'wheel',
    (e) => {
      const vn = get();
      const lv = live();
      if (!vn?.map || !lv || !vn.map.spec.nav.wheel) return;
      zoomMap(sim, lv, e.deltaY < 0 ? 'in' : 'out', 1.2, local(e));
      e.preventDefault();
      e.stopPropagation();
    },
    { passive: false },
  );
  void key;
  void settingBool;
}
