import type { Pt } from '@tilewright/runtime';
import type { SpriteDoc } from './doc';
import type { StudioState } from './store';

export interface View {
  /** Canvas pixel where the sprite's top-left corner is drawn. */
  x: number;
  y: number;
}

export interface Overlay {
  /** Pixels a tool is about to paint (shown with the chosen colour). */
  pixels?: Pt[];
  pixelColor?: string;
  /** A rectangle being dragged (selection or box). */
  rect?: { x: number; y: number; w: number; h: number; color: string };
  /** The selected vector shape: its box, and the handles to drag (sprite pixel coordinates). */
  gizmo?: { box: { x: number; y: number; w: number; h: number }; handles: { x: number; y: number }[] };
  /** The selection being moved: a lifted copy drawn at an offset. */
  floating?: { rect: { x: number; y: number; w: number; h: number }; dx: number; dy: number };
}

/** Draw a frame (flattened) 1:1 into a throwaway canvas and return it. */
export function frameCanvas(doc: SpriteDoc, frame: number, opts: { alpha?: number; tint?: number } = {}): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = doc.width;
  c.height = doc.height;
  const rgba = doc.composite(frame, opts);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), doc.width, doc.height), 0, 0);
  return c;
}

/** Draw the whole studio canvas: checkerboard, onion skins, pixels, grids, feet point, boxes, selection, tool preview. */
export function renderStudio(ctx: CanvasRenderingContext2D, width: number, height: number, doc: SpriteDoc, s: StudioState, view: View, overlay: Overlay): void {
  const z = s.zoom;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  const w = doc.width * z;
  const h = doc.height * z;

  // checkerboard behind the sprite
  const sq = Math.max(4, z);
  for (let y = 0; y < doc.height * z; y += sq) {
    for (let x = 0; x < doc.width * z; x += sq) {
      ctx.fillStyle = ((x / sq + y / sq) & 1) === 0 ? '#3a3d48' : '#2f323c';
      ctx.fillRect(view.x + x, view.y + y, Math.min(sq, w - x), Math.min(sq, h - y));
    }
  }

  const layerPixels = (frame: number, opts: { alpha?: number; tint?: number }): HTMLCanvasElement => frameCanvas(doc, frame, opts);
  if (s.onionPrev && doc.frame > 0) ctx.drawImage(layerPixels(doc.frame - 1, { alpha: 0.35, tint: 0xff5555 }), view.x, view.y, w, h);
  if (s.onionNext && doc.frame < doc.frames.length - 1) ctx.drawImage(layerPixels(doc.frame + 1, { alpha: 0.35, tint: 0x55ff77 }), view.x, view.y, w, h);
  ctx.drawImage(layerPixels(doc.frame, {}), view.x, view.y, w, h);

  if (overlay.pixels && overlay.pixels.length > 0) {
    ctx.fillStyle = overlay.pixelColor ?? '#ffffff88';
    for (const p of overlay.pixels) if (p.x >= 0 && p.y >= 0 && p.x < doc.width && p.y < doc.height) ctx.fillRect(view.x + p.x * z, view.y + p.y * z, z, z);
  }
  if (overlay.floating) {
    const { rect, dx, dy } = overlay.floating;
    ctx.strokeStyle = '#6aa8ff';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(view.x + (rect.x + dx) * z + 0.5, view.y + (rect.y + dy) * z + 0.5, rect.w * z, rect.h * z);
    ctx.setLineDash([]);
  }

  if (s.pixelGrid && z >= 6) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= doc.width; x++) {
      ctx.moveTo(view.x + x * z + 0.5, view.y);
      ctx.lineTo(view.x + x * z + 0.5, view.y + h);
    }
    for (let y = 0; y <= doc.height; y++) {
      ctx.moveTo(view.x, view.y + y * z + 0.5);
      ctx.lineTo(view.x + w, view.y + y * z + 0.5);
    }
    ctx.stroke();
  }

  if (s.isoGrid) {
    // 2:1 isometric guide lines through the feet point, one line every 8 pixels across
    ctx.strokeStyle = 'rgba(106,168,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const ox = doc.origin.x;
    const oy = doc.origin.y;
    for (let k = -doc.width - doc.height; k <= doc.width + doc.height; k += 8) {
      // lines of slope +1/2 and -1/2
      ctx.moveTo(view.x + (ox + k) * z, view.y + oy * z);
      ctx.lineTo(view.x + (ox + k + doc.height * 2) * z, view.y + (oy + doc.height) * z);
      ctx.moveTo(view.x + (ox + k) * z, view.y + oy * z);
      ctx.lineTo(view.x + (ox + k - doc.height * 2) * z, view.y + (oy + doc.height) * z);
      ctx.moveTo(view.x + (ox + k) * z, view.y + oy * z);
      ctx.lineTo(view.x + (ox + k + doc.height * 2) * z, view.y + (oy - doc.height) * z);
      ctx.moveTo(view.x + (ox + k) * z, view.y + oy * z);
      ctx.lineTo(view.x + (ox + k - doc.height * 2) * z, view.y + (oy - doc.height) * z);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,211,74,0.5)';
    ctx.beginPath();
    ctx.moveTo(view.x, view.y + oy * z);
    ctx.lineTo(view.x + w, view.y + oy * z);
    ctx.stroke();
  }

  // symmetry axes
  ctx.strokeStyle = 'rgba(255,107,107,0.6)';
  if (s.symX) {
    ctx.beginPath();
    ctx.moveTo(view.x + w / 2 + 0.5, view.y);
    ctx.lineTo(view.x + w / 2 + 0.5, view.y + h);
    ctx.stroke();
  }
  if (s.symY) {
    ctx.beginPath();
    ctx.moveTo(view.x, view.y + h / 2 + 0.5);
    ctx.lineTo(view.x + w, view.y + h / 2 + 0.5);
    ctx.stroke();
  }

  // feet point
  const fx = view.x + doc.origin.x * z;
  const fy = view.y + doc.origin.y * z;
  ctx.strokeStyle = '#ffd34a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fx - 8, fy);
  ctx.lineTo(fx + 8, fy);
  ctx.moveTo(fx, fy - 8);
  ctx.lineTo(fx, fy + 8);
  ctx.stroke();
  ctx.lineWidth = 1;

  if (s.showBoxes) {
    for (const b of doc.frames[doc.frame]?.boxes ?? []) {
      ctx.strokeStyle = b.kind === 'hit' ? '#ff5d5d' : '#5da8ff';
      ctx.strokeRect(view.x + b.x * z + 0.5, view.y + b.y * z + 0.5, b.w * z, b.h * z);
    }
  }

  const sel = doc.selection;
  if (sel) {
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(view.x + sel.x * z + 0.5, view.y + sel.y * z + 0.5, sel.w * z, sel.h * z);
    ctx.setLineDash([]);
  }
  if (overlay.gizmo) {
    const g = overlay.gizmo;
    ctx.strokeStyle = '#6aa8ff';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(view.x + g.box.x * z + 0.5, view.y + g.box.y * z + 0.5, g.box.w * z, g.box.h * z);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2b4c7e';
    for (const h of g.handles) {
      ctx.fillRect(view.x + h.x * z - 3, view.y + h.y * z - 3, 6, 6);
      ctx.strokeRect(view.x + h.x * z - 3 + 0.5, view.y + h.y * z - 3 + 0.5, 5, 5);
    }
  }
  if (overlay.rect) {
    const r = overlay.rect;
    ctx.strokeStyle = r.color;
    ctx.strokeRect(view.x + r.x * z + 0.5, view.y + r.y * z + 0.5, r.w * z, r.h * z);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(view.x - 0.5, view.y - 0.5, w + 1, h + 1);
  ctx.restore();
}
