import { Application, Container, Graphics } from 'pixi.js';
import { DEFAULT_ISO, gridToScreen, screenToCell, type Cell, type IsoConfig } from '../iso/math';
import { C, type Sprite, type TransformIso } from '../scene/components';
import type { Entity, World } from '../scene/world';
import { DEFAULT_TILESET, TileMap, type TileSet } from '../tilemap/tilemap';
import { Camera } from './camera';
import { boxAt, sortBoxes, type DepthBox } from './depth';

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

export interface RendererOptions {
  iso?: IsoConfig;
  background?: number;
  /** Existing canvas to draw into; otherwise one is created. */
  canvas?: HTMLCanvasElement;
  width?: number;
  height?: number;
  antialias?: boolean;
}

interface EntityView {
  gfx: Graphics;
  signature: string;
}

/**
 * Draws a TileMap and a World with PixiJS. Everything is procedural for now (see Sprite.shape);
 * art arrives with the sprite studio. Draw order comes from `sortBoxes`, so tall and multi-cell
 * things overlap correctly at every height.
 */
export class IsoRenderer {
  readonly app = new Application();
  readonly camera = new Camera();
  readonly iso: IsoConfig;
  readonly world = new Container();
  /** Time (ms) the last sort took; shown by the profiler overlay later. */
  lastSortMs = 0;

  private tileViews: Graphics[] = [];
  private tileBoxes: DepthBox[] = [];
  private readonly entityViews = new Map<number, EntityView>();
  private ready = false;
  private tileMap: TileMap | null = null;

  constructor(private readonly opts: RendererOptions = {}) {
    this.iso = opts.iso ?? DEFAULT_ISO;
  }

  async init(parent?: HTMLElement): Promise<void> {
    await this.app.init({
      canvas: this.opts.canvas,
      width: this.opts.width ?? 1280,
      height: this.opts.height ?? 720,
      background: this.opts.background ?? 0x14161b,
      antialias: this.opts.antialias ?? true,
      resizeTo: parent,
    });
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);
    if (parent && !this.opts.canvas) parent.appendChild(this.app.canvas);
    this.camera.setViewport(this.app.screen.width, this.app.screen.height);
    this.ready = true;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  resize(w: number, h: number): void {
    this.app.renderer.resize(w, h);
    this.camera.setViewport(w, h);
  }

  setTileMap(tileMap: TileMap, tileset: TileSet = DEFAULT_TILESET): void {
    for (const g of this.tileViews) g.destroy();
    this.tileViews = [];
    this.tileBoxes = [];
    this.tileMap = tileMap;
    const hw = this.iso.tileW / 2;
    const hh = this.iso.tileH / 2;
    let id = 0;
    tileMap.forEach((x, y, tile, height) => {
      const def = tileset[tile] ?? { name: '?', top: 0xff00ff, left: 0xbb00bb, right: 0x880088 };
      const g = new Graphics();
      const drop = (height + 1) * this.iso.heightPx; // column down to one level below the floor
      g.poly([0, 0, hw, hh, 0, this.iso.tileH, -hw, hh]).fill(def.top);
      g.poly([-hw, hh, 0, this.iso.tileH, 0, this.iso.tileH + drop, -hw, hh + drop]).fill(def.left);
      g.poly([0, this.iso.tileH, hw, hh, hw, hh + drop, 0, this.iso.tileH + drop]).fill(def.right);
      g.poly([0, 0, hw, hh, 0, this.iso.tileH, -hw, hh]).stroke({ width: 1, color: shade(def.top, 0.85), alpha: 0.6 });
      const p = gridToScreen(x, y, height, this.iso);
      g.position.set(p.x, p.y);
      this.world.addChild(g);
      this.tileViews.push(g);
      this.tileBoxes.push(tileMap.boxFor(x, y, id++));
    });
    // tile boxes keep ids 0..n-1; entities use n + entity id
  }

  /** Draw one frame. */
  render(world: World): void {
    if (!this.ready) return;
    const t0 = performance.now();
    const boxes: DepthBox[] = [...this.tileBoxes];
    const base = this.tileBoxes.length;
    const seen = new Set<number>();

    for (const e of world.query(C.Transform, C.Sprite)) {
      const t = e.require<TransformIso>(C.Transform);
      const s = e.require<Sprite>(C.Sprite);
      seen.add(e.id);
      const view = this.viewFor(e, s);
      view.gfx.visible = s.visible;
      const p = gridToScreen(t.x, t.y, t.h, this.iso);
      view.gfx.position.set(p.x, p.y);
      boxes.push(boxAt(base + e.id, t.x, t.y, t.h, s.w, s.d, s.height, s.sortOffset));
    }
    for (const [id, v] of this.entityViews) {
      if (!seen.has(id)) {
        v.gfx.destroy();
        this.entityViews.delete(id);
      }
    }

    const order = sortBoxes(boxes, this.iso);
    for (let rank = 0; rank < order.length; rank++) {
      const id = order[rank]!;
      if (id < base) this.tileViews[id]!.zIndex = rank;
      else this.entityViews.get(id - base)!.gfx.zIndex = rank;
    }
    this.lastSortMs = performance.now() - t0;

    const off = this.camera.offset;
    this.world.position.set(Math.round(off.x), Math.round(off.y));
    this.world.scale.set(this.camera.zoom);
    this.app.renderer.render(this.app.stage);
  }

  /** Cell under a viewport pixel, assuming the plane at height h. */
  viewToCell(px: number, py: number, h = 0): Cell {
    const w = this.camera.viewToWorld({ x: px, y: py });
    return screenToCell(w.x, w.y, h, this.iso);
  }

  private viewFor(e: Entity, s: Sprite): EntityView {
    const signature = `${s.shape}|${s.color}|${s.w}|${s.d}|${s.height}`;
    let v = this.entityViews.get(e.id);
    if (v && v.signature === signature) return v;
    if (v) v.gfx.destroy();
    const gfx = new Graphics();
    this.drawSprite(gfx, s);
    this.world.addChild(gfx);
    v = { gfx, signature };
    this.entityViews.set(e.id, v);
    return v;
  }

  /** Geometry is relative to the feet point (the entity's grid position at its height). */
  private drawSprite(g: Graphics, s: Sprite): void {
    const pt = (dx: number, dy: number, dh: number): [number, number] => {
      const p = gridToScreen(dx, dy, dh, this.iso);
      return [p.x, p.y];
    };
    const hx = s.w / 2;
    const hy = s.d / 2;
    // soft contact shadow
    g.ellipse(0, 0, Math.max(6, s.w * this.iso.tileW * 0.3), Math.max(3, s.d * this.iso.tileH * 0.3)).fill({ color: 0x000000, alpha: 0.28 });
    if (s.shape === 'diamond') {
      const [nx, ny] = pt(-hx, -hy, s.height);
      const [ex, ey] = pt(hx, -hy, s.height);
      const [sx, sy] = pt(hx, hy, s.height);
      const [wx, wy] = pt(-hx, hy, s.height);
      g.poly([nx, ny, ex, ey, sx, sy, wx, wy]).fill(s.color);
      return;
    }
    // box: top, left face (towards +y), right face (towards +x)
    const top = [pt(-hx, -hy, s.height), pt(hx, -hy, s.height), pt(hx, hy, s.height), pt(-hx, hy, s.height)];
    const botW = pt(-hx, hy, 0);
    const botS = pt(hx, hy, 0);
    const botE = pt(hx, -hy, 0);
    g.poly([top[3]![0], top[3]![1], top[2]![0], top[2]![1], botS[0], botS[1], botW[0], botW[1]]).fill(shade(s.color, 0.7));
    g.poly([top[2]![0], top[2]![1], top[1]![0], top[1]![1], botE[0], botE[1], botS[0], botS[1]]).fill(shade(s.color, 0.5));
    g.poly(top.flat()).fill(s.color);
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
    this.ready = false;
  }
}
