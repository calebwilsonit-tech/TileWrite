import {
  SPRITE_SCHEMA_VERSION,
  bounds,
  compositeCels,
  copyRect,
  decodeRle,
  encodeRle,
  flipH,
  flipV,
  newCel,
  pasteCel,
  rotate90,
  shift,
  type Cel,
  type ClipData,
  type FacingKey,
  type ShapeData,
  type SpriteBox,
  type SpriteData,
} from '@tilewright/runtime';
import { History } from '../model/history';

export interface LayerState {
  id: string;
  name: string;
  visible: boolean;
}

export interface FrameState {
  duration: number;
  cels: Record<string, Cel>;
  boxes: SpriteBox[];
}

interface State {
  width: number;
  height: number;
  palette: string[];
  layers: LayerState[];
  frames: FrameState[];
  origin: { x: number; y: number };
  clips: ClipData[];
  procedural: { shapes: ShapeData[] } | null;
}

export type StudioEvent = { type: 'pixels' } | { type: 'structure' } | { type: 'palette' } | { type: 'meta' } | { type: 'history' } | { type: 'selection' };

function cloneState(s: State): State {
  return {
    width: s.width,
    height: s.height,
    palette: [...s.palette],
    layers: s.layers.map((l) => ({ ...l })),
    frames: s.frames.map((f) => ({ duration: f.duration, cels: Object.fromEntries(Object.entries(f.cels).map(([k, v]) => [k, v.slice()])), boxes: f.boxes.map((b) => ({ ...b })) })),
    origin: { ...s.origin },
    clips: structuredClone(s.clips),
    procedural: s.procedural ? structuredClone(s.procedural) : null,
  };
}

/** An in-progress pixel stroke on one cel. Pixels change immediately; `commit` makes one undo step. */
export class CelStroke {
  private readonly before: Cel;
  private done = false;

  constructor(
    private readonly doc: SpriteDoc,
    readonly label: string,
    private readonly frame: number,
    private readonly layerId: string,
  ) {
    this.before = doc.cel(frame, layerId).slice();
  }

  get cel(): Cel {
    return this.doc.cel(this.frame, this.layerId);
  }

  set(x: number, y: number, v: number): void {
    if (this.done || x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return;
    this.cel[y * this.doc.width + x] = v;
  }

  setMany(points: readonly { x: number; y: number }[], v: number): void {
    for (const p of points) this.set(p.x, p.y, v);
    this.doc.emit({ type: 'pixels' });
  }

  get changed(): boolean {
    const now = this.cel;
    for (let i = 0; i < now.length; i++) if (now[i] !== this.before[i]) return true;
    return false;
  }

  commit(): void {
    if (this.done) return;
    this.done = true;
    if (!this.changed) return;
    const after = this.cel.slice();
    const before = this.before;
    const { frame, layerId, doc } = this;
    doc.history.push({
      label: this.label,
      redo: () => {
        doc.cel(frame, layerId).set(after);
        doc.emit({ type: 'pixels' });
      },
      undo: () => {
        doc.cel(frame, layerId).set(before);
        doc.emit({ type: 'pixels' });
      },
    });
    doc.markChanged();
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    this.doc.cel(this.frame, this.layerId).set(this.before);
    this.doc.emit({ type: 'pixels' });
  }
}

/**
 * The sprite being edited, in a form that is quick to draw on (decoded pixels), with undo.
 * Pixel strokes undo cheaply; structural edits (frames, layers, palette, clips...) snapshot the whole sprite.
 */
export class SpriteDoc {
  readonly history = new History();
  dirty = false;
  frame = 0;
  layer: string;
  /** Selected rectangle and a lifted copy of its pixels while it is being moved. */
  selection: { x: number; y: number; w: number; h: number } | null = null;
  private listeners = new Set<(e: StudioEvent) => void>();
  private nextLayer: number;
  private s: State;

  constructor(
    public name: string,
    state: State,
  ) {
    this.s = state;
    this.layer = state.layers[0]!.id;
    this.nextLayer = Math.max(0, ...state.layers.map((l) => Number(/(\d+)$/.exec(l.id)?.[1] ?? 0))) + 1;
  }

  static fromSprite(data: SpriteData): SpriteDoc {
    const n = data.width * data.height;
    const frames: FrameState[] = data.frames.map((f) => ({
      duration: f.duration,
      cels: Object.fromEntries(data.layers.map((l) => [l.id, f.cels[l.id] === undefined ? newCel(data.width, data.height) : decodeRle(f.cels[l.id]!, n)])),
      boxes: f.boxes.map((b) => ({ ...b })),
    }));
    return new SpriteDoc(data.name, {
      width: data.width,
      height: data.height,
      palette: [...data.palette],
      layers: data.layers.map((l) => ({ ...l })),
      frames,
      origin: { ...data.origin },
      clips: structuredClone(data.clips),
      procedural: data.procedural ? structuredClone(data.procedural) : null,
    });
  }

  toSprite(): SpriteData {
    return {
      schemaVersion: SPRITE_SCHEMA_VERSION,
      name: this.name,
      width: this.s.width,
      height: this.s.height,
      palette: [...this.s.palette],
      layers: this.s.layers.map((l) => ({ ...l })),
      frames: this.s.frames.map((f) => ({
        duration: f.duration,
        cels: Object.fromEntries(Object.entries(f.cels).filter(([, c]) => c.some((v) => v !== 0)).map(([k, c]) => [k, encodeRle(c)])),
        boxes: f.boxes.map((b) => ({ ...b })),
      })),
      origin: { ...this.s.origin },
      clips: structuredClone(this.s.clips),
      procedural: this.s.procedural ? structuredClone(this.s.procedural) : null,
    };
  }

  // ---- read access ----

  get width(): number {
    return this.s.width;
  }
  get height(): number {
    return this.s.height;
  }
  get palette(): readonly string[] {
    return this.s.palette;
  }
  get layers(): readonly LayerState[] {
    return this.s.layers;
  }
  get frames(): readonly FrameState[] {
    return this.s.frames;
  }
  get origin(): { x: number; y: number } {
    return this.s.origin;
  }
  get clips(): readonly ClipData[] {
    return this.s.clips;
  }
  get procedural(): { shapes: ShapeData[] } | null {
    return this.s.procedural;
  }

  /** The editable pixels of one layer in one frame (an empty cel is created on first use). */
  cel(frame: number, layerId: string): Cel {
    const f = this.s.frames[frame]!;
    return (f.cels[layerId] ??= newCel(this.s.width, this.s.height));
  }

  get currentCel(): Cel {
    return this.cel(this.frame, this.layer);
  }

  subscribe(fn: (e: StudioEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: StudioEvent): void {
    for (const l of [...this.listeners]) l(e);
  }

  markChanged(): void {
    this.dirty = true;
    this.emit({ type: 'history' });
  }

  /** The visible layers of a frame flattened to RGBA, straight from the decoded pixels (fast enough to redraw while painting). */
  composite(frame: number, opts: { alpha?: number; tint?: number } = {}): Uint8ClampedArray {
    const cels = this.s.layers.filter((l) => l.visible).map((l) => this.cel(frame, l.id));
    return compositeCels(this.s.width, this.s.height, this.s.palette, cels, opts);
  }

  // ---- selection of frame / layer ----

  selectFrame(i: number): void {
    this.frame = Math.max(0, Math.min(this.s.frames.length - 1, i));
    this.selection = null;
    this.emit({ type: 'structure' });
  }

  selectLayer(id: string): void {
    if (this.s.layers.some((l) => l.id === id)) {
      this.layer = id;
      this.emit({ type: 'structure' });
    }
  }

  // ---- drawing ----

  /** Start a pixel gesture on the current frame and layer. Locked/hidden layers cannot be drawn on. */
  beginStroke(label: string): CelStroke | null {
    const layer = this.s.layers.find((l) => l.id === this.layer);
    if (!layer || !layer.visible) return null;
    return new CelStroke(this, label, this.frame, this.layer);
  }

  /** Run an edit that changes the structure and make it one undo step (whole-sprite snapshot). */
  mutate(label: string, fn: () => void): void {
    const before = cloneState(this.s);
    const beforeSel = { frame: this.frame, layer: this.layer };
    fn();
    const after = cloneState(this.s);
    const afterSel = { frame: this.frame, layer: this.layer };
    const apply = (st: State, sel: { frame: number; layer: string }): void => {
      this.s = cloneState(st);
      this.frame = Math.min(sel.frame, this.s.frames.length - 1);
      this.layer = this.s.layers.some((l) => l.id === sel.layer) ? sel.layer : this.s.layers[0]!.id;
      this.selection = null;
      this.emit({ type: 'structure' });
      this.emit({ type: 'pixels' });
      this.emit({ type: 'palette' });
    };
    this.history.push({ label, redo: () => apply(after, afterSel), undo: () => apply(before, beforeSel) });
    this.markChanged();
    this.emit({ type: 'structure' });
    this.emit({ type: 'pixels' });
    this.emit({ type: 'palette' });
  }

  // ---- frames ----

  addFrame(duplicate = false): void {
    this.mutate(duplicate ? 'Duplicate frame' : 'Add frame', () => {
      const src = this.s.frames[this.frame]!;
      const copy: FrameState = duplicate
        ? { duration: src.duration, cels: Object.fromEntries(Object.entries(src.cels).map(([k, v]) => [k, v.slice()])), boxes: src.boxes.map((b) => ({ ...b })) }
        : { duration: src.duration, cels: {}, boxes: [] };
      this.s.frames.splice(this.frame + 1, 0, copy);
      this.shiftClips(this.frame + 1, 1);
      this.frame += 1;
    });
  }

  removeFrame(index = this.frame): void {
    if (this.s.frames.length <= 1) return;
    this.mutate('Delete frame', () => {
      this.s.frames.splice(index, 1);
      this.shiftClips(index, -1);
      this.frame = Math.min(this.frame, this.s.frames.length - 1);
    });
  }

  moveFrame(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this.s.frames.length || to >= this.s.frames.length) return;
    this.mutate('Move frame', () => {
      const [f] = this.s.frames.splice(from, 1);
      this.s.frames.splice(to, 0, f!);
      const remap = (i: number): number => (i === from ? to : from < to ? (i > from && i <= to ? i - 1 : i) : i >= to && i < from ? i + 1 : i);
      this.mapClipFrames(remap);
      this.frame = to;
    });
  }

  setDuration(index: number, ms: number): void {
    const v = Math.max(10, Math.min(60000, Math.round(ms)));
    if (this.s.frames[index]?.duration === v) return;
    this.mutate('Change frame time', () => {
      this.s.frames[index]!.duration = v;
    });
  }

  /** After inserting/removing a frame at `at`, keep clip frame lists pointing at the same pictures. */
  private shiftClips(at: number, delta: 1 | -1): void {
    this.mapClipFrames((i) => (i >= at ? i + delta : i), delta === -1 ? at : -1);
  }

  private mapClipFrames(map: (i: number) => number, dropped = -1): void {
    for (const c of this.s.clips) {
      const fix = (list: number[]): number[] => list.filter((i) => i !== dropped).map(map);
      c.all = fix(c.all);
      for (const k of Object.keys(c.dirs) as FacingKey[]) c.dirs[k] = fix(c.dirs[k] ?? []);
    }
  }

  // ---- layers ----

  addLayer(): void {
    this.mutate('Add layer', () => {
      const id = `l${this.nextLayer++}`;
      const at = this.s.layers.findIndex((l) => l.id === this.layer);
      this.s.layers.splice(at + 1, 0, { id, name: `Layer ${this.s.layers.length + 1}`, visible: true });
      this.layer = id;
    });
  }

  removeLayer(id = this.layer): void {
    if (this.s.layers.length <= 1) return;
    this.mutate('Delete layer', () => {
      this.s.layers = this.s.layers.filter((l) => l.id !== id);
      for (const f of this.s.frames) delete f.cels[id];
      this.layer = this.s.layers[Math.max(0, this.s.layers.length - 1)]!.id;
    });
  }

  renameLayer(id: string, name: string): void {
    const l = this.s.layers.find((x) => x.id === id);
    if (!l || !name.trim() || l.name === name.trim()) return;
    this.mutate('Rename layer', () => {
      l.name = name.trim();
    });
  }

  setLayerVisible(id: string, visible: boolean): void {
    if (this.s.layers.find((l) => l.id === id)?.visible === visible) return;
    this.mutate(visible ? 'Show layer' : 'Hide layer', () => {
      this.s.layers.find((l) => l.id === id)!.visible = visible;
    });
  }

  moveLayer(id: string, delta: -1 | 1): void {
    const i = this.s.layers.findIndex((l) => l.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.s.layers.length) return;
    this.mutate('Move layer', () => {
      const [l] = this.s.layers.splice(i, 1);
      this.s.layers.splice(j, 0, l!);
    });
  }

  /** Merge the current layer into the one below it (in every frame). */
  mergeDown(): void {
    const i = this.s.layers.findIndex((l) => l.id === this.layer);
    if (i <= 0) return;
    const below = this.s.layers[i - 1]!.id;
    this.mutate('Merge layer down', () => {
      for (const f of this.s.frames) {
        const top = f.cels[this.layer];
        if (!top) continue;
        const dst = (f.cels[below] ??= newCel(this.s.width, this.s.height));
        for (let p = 0; p < top.length; p++) if (top[p] !== 0) dst[p] = top[p]!;
        delete f.cels[this.layer];
      }
      this.s.layers.splice(i, 1);
      this.layer = below;
    });
  }

  // ---- palette ----

  setColor(index: number, hex: string): void {
    if (index <= 0 || index >= this.s.palette.length || !/^#[0-9a-fA-F]{8}$/.test(hex) || this.s.palette[index] === hex.toLowerCase()) return;
    this.mutate('Change colour', () => {
      this.s.palette[index] = hex.toLowerCase();
    });
  }

  /** Add a colour (or find it if it is already there). Returns its index, or -1 if the palette is full. */
  addColor(hex: string): number {
    const h = hex.toLowerCase();
    const found = this.s.palette.findIndex((c, i) => i > 0 && c === h);
    if (found > 0) return found;
    if (this.s.palette.length >= 256) return -1;
    this.mutate('Add colour', () => {
      this.s.palette.push(h);
    });
    return this.s.palette.length - 1;
  }

  /** Remove a colour; pixels using it become transparent and later colours shift down. */
  removeColor(index: number): void {
    if (index <= 0 || index >= this.s.palette.length) return;
    this.mutate('Delete colour', () => {
      this.s.palette.splice(index, 1);
      for (const f of this.s.frames) {
        for (const cel of Object.values(f.cels)) {
          for (let i = 0; i < cel.length; i++) {
            const v = cel[i]!;
            if (v === index) cel[i] = 0;
            else if (v > index) cel[i] = v - 1;
          }
        }
      }
    });
  }

  // ---- canvas, origin, boxes ----

  setOrigin(x: number, y: number): void {
    const ox = Math.max(0, Math.min(this.s.width, Math.round(x)));
    const oy = Math.max(0, Math.min(this.s.height, Math.round(y)));
    if (this.s.origin.x === ox && this.s.origin.y === oy) return;
    this.mutate('Move feet point', () => {
      this.s.origin = { x: ox, y: oy };
    });
  }

  /** Change the canvas size, keeping pixels anchored to the top-left (or the centre when `centre`). */
  resize(width: number, height: number, centre = false): void {
    const w = Math.max(1, Math.min(512, Math.round(width)));
    const h = Math.max(1, Math.min(512, Math.round(height)));
    if (w === this.s.width && h === this.s.height) return;
    this.mutate(`Resize canvas to ${w} x ${h}`, () => {
      const ox = centre ? Math.floor((w - this.s.width) / 2) : 0;
      const oy = centre ? Math.floor((h - this.s.height) / 2) : 0;
      for (const f of this.s.frames) {
        for (const [k, cel] of Object.entries(f.cels)) {
          const out = newCel(w, h);
          for (let y = 0; y < this.s.height; y++) {
            for (let x = 0; x < this.s.width; x++) {
              const nx = x + ox;
              const ny = y + oy;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = cel[y * this.s.width + x]!;
            }
          }
          f.cels[k] = out;
        }
        for (const b of f.boxes) {
          b.x += ox;
          b.y += oy;
        }
      }
      this.s.origin = { x: this.s.origin.x + ox, y: this.s.origin.y + oy };
      this.s.width = w;
      this.s.height = h;
    });
  }

  addBox(kind: 'hit' | 'hurt', box: { x: number; y: number; w: number; h: number }): void {
    this.mutate(kind === 'hit' ? 'Add hitbox' : 'Add hurtbox', () => {
      this.s.frames[this.frame]!.boxes.push({ kind, x: Math.round(box.x), y: Math.round(box.y), w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) });
    });
  }

  removeBox(index: number): void {
    if (!this.s.frames[this.frame]?.boxes[index]) return;
    this.mutate('Delete box', () => {
      this.s.frames[this.frame]!.boxes.splice(index, 1);
    });
  }

  updateBox(index: number, patch: Partial<SpriteBox>): void {
    const b = this.s.frames[this.frame]?.boxes[index];
    if (!b) return;
    this.mutate('Edit box', () => {
      Object.assign(b, patch);
      b.w = Math.max(1, Math.round(b.w));
      b.h = Math.max(1, Math.round(b.h));
    });
  }

  /** Copy this frame's boxes to every frame (hitboxes rarely change much between frames). */
  copyBoxesToAll(): void {
    const src = this.s.frames[this.frame]!.boxes;
    this.mutate('Copy boxes to all frames', () => {
      for (const f of this.s.frames) f.boxes = src.map((b) => ({ ...b }));
    });
  }

  // ---- whole-image edits on the current cel ----

  /** Flip / rotate / shift the current cel (or the selected part of it) as one undo step. */
  transform(kind: 'flipH' | 'flipV' | 'rotate' | 'left' | 'right' | 'up' | 'down'): void {
    const { width: w, height: h } = this.s;
    if (kind === 'rotate' && w !== h) return;
    const sel = this.selection;
    const stroke = this.beginStroke(`Transform: ${kind}`);
    if (!stroke) return;
    const cel = this.currentCel;
    const area = sel ?? { x: 0, y: 0, w, h };
    const part = copyRect(cel, { w, h }, area);
    let out: Cel;
    const size = { w: area.w, h: area.h };
    if (kind === 'flipH') out = flipH(part, size);
    else if (kind === 'flipV') out = flipV(part, size);
    else if (kind === 'rotate') out = rotate90(part, size).cel;
    else out = shift(part, size, kind === 'left' ? -1 : kind === 'right' ? 1 : 0, kind === 'up' ? -1 : kind === 'down' ? 1 : 0);
    if (kind === 'rotate' && area.w !== area.h) {
      stroke.cancel();
      return;
    }
    for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) stroke.set(area.x + x, area.y + y, out[y * area.w + x]!);
    stroke.commit();
    this.emit({ type: 'pixels' });
  }

  /** Move (or copy) the selected pixels by (dx, dy). The selection follows. */
  moveSelection(dx: number, dy: number, copy = false): void {
    const sel = this.selection;
    if (!sel || (dx === 0 && dy === 0)) return;
    const stroke = this.beginStroke(copy ? 'Copy selection' : 'Move selection');
    if (!stroke) return;
    const size = { w: this.s.width, h: this.s.height };
    const piece = copyRect(this.currentCel, size, sel);
    if (!copy) for (let y = 0; y < sel.h; y++) for (let x = 0; x < sel.w; x++) stroke.set(sel.x + x, sel.y + y, 0);
    const tmp = this.currentCel;
    pasteCel(tmp, size, piece, { w: sel.w, h: sel.h }, sel.x + dx, sel.y + dy, false);
    stroke.commit();
    this.selection = { ...sel, x: sel.x + dx, y: sel.y + dy };
    this.emit({ type: 'pixels' });
    this.emit({ type: 'selection' });
  }

  setSelection(rect: { x: number; y: number; w: number; h: number } | null): void {
    this.selection = rect;
    this.emit({ type: 'selection' });
  }

  /** Shrink the selection to its drawn pixels, or return null if it is empty. */
  tightSelection(): { x: number; y: number; w: number; h: number } | null {
    const sel = this.selection;
    if (!sel) return null;
    const part = copyRect(this.currentCel, { w: this.s.width, h: this.s.height }, sel);
    const b = bounds(part, { w: sel.w, h: sel.h });
    return b ? { x: sel.x + b.x, y: sel.y + b.y, w: b.w, h: b.h } : null;
  }

  // ---- clips (animations) ----

  addClip(name: string): ClipData | null {
    const n = name.trim();
    if (!n || this.s.clips.some((c) => c.name === n)) return null;
    const clip: ClipData = { name: n, loop: true, mirror: false, all: this.s.frames.map((_, i) => i), dirs: {}, events: [] };
    this.mutate(`Add animation "${n}"`, () => {
      this.s.clips.push(clip);
    });
    return clip;
  }

  removeClip(name: string): void {
    if (!this.s.clips.some((c) => c.name === name)) return;
    this.mutate('Delete animation', () => {
      this.s.clips = this.s.clips.filter((c) => c.name !== name);
    });
  }

  renameClip(name: string, to: string): void {
    const n = to.trim();
    const c = this.s.clips.find((x) => x.name === name);
    if (!c || !n || this.s.clips.some((x) => x.name === n)) return;
    this.mutate('Rename animation', () => {
      c.name = n;
    });
  }

  updateClip(name: string, label: string, fn: (c: ClipData) => void): void {
    const c = this.s.clips.find((x) => x.name === name);
    if (!c) return;
    this.mutate(label, () => fn(this.s.clips.find((x) => x.name === name)!));
  }

  // ---- procedural shapes ----

  enableProcedural(on: boolean): void {
    if ((this.s.procedural !== null) === on) return;
    this.mutate(on ? 'Use shapes' : 'Stop using shapes', () => {
      this.s.procedural = on ? { shapes: [{ type: 'box', color: 0xe8553d, x: 0, y: 0, w: 0.6, d: 0.6, h: 40 }] } : null;
    });
  }

  updateShapes(label: string, fn: (shapes: ShapeData[]) => void): void {
    if (!this.s.procedural) return;
    this.mutate(label, () => fn(this.s.procedural!.shapes));
  }

  /** Replace the first layer of frame 1 with the shapes drawn as pixels. */
  replaceWith(sprite: SpriteData, label: string): void {
    const fresh = SpriteDoc.fromSprite(sprite);
    this.mutate(label, () => {
      this.s = cloneState(fresh.s);
    });
  }
}
