import { Application, Container, Graphics } from 'pixi.js';
import { DEFAULT_ISO, gridToScreen, screenToCell, type Cell, type IsoConfig } from '../iso/math';
import { C, type Sprite, type TransformIso } from '../scene/components';
import type { Entity, EntityId, World } from '../scene/world';
import { DEFAULT_TILESET, FLAG, SLOPE, TileMap, type TileDef, type TileSet } from '../tilemap/tilemap';
import { Camera } from './camera';
import { boxAt, isInFront, rectsOverlap, screenRect, sortBoxes, type DepthBox } from './depth';

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

const MISSING_TILE: TileDef = { name: '?', top: 0xff00ff, left: 0xbb00bb, right: 0x880088 };
const STAIR_STEPS = 4;

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

interface TileView {
  gfx: Graphics;
  box: DepthBox;
  /** Things that rise above the ground can hide the focus entity and fade out. */
  occluder: boolean;
}

/** Corner heights (levels, relative to the cell's base) at N(0,0) E(1,0) S(1,1) W(0,1). */
interface Corners {
  n: number;
  e: number;
  s: number;
  w: number;
}

function slopeCorners(dir: number): Corners {
  switch (dir) {
    case SLOPE.E:
      return { n: 0, e: 1, s: 1, w: 0 };
    case SLOPE.N:
      return { n: 1, e: 1, s: 0, w: 0 };
    case SLOPE.S:
      return { n: 0, e: 0, s: 1, w: 1 };
    case SLOPE.W:
      return { n: 1, e: 0, s: 0, w: 1 };
    default:
      return { n: 0, e: 0, s: 0, w: 0 };
  }
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
  /** Entity whose view should never be hidden by walls in front of it. */
  focus: EntityId | undefined;
  /** Fade walls that stand in front of the focus entity. */
  occlusionFade = true;
  /** Alpha an occluding wall fades to. */
  fadeAlpha = 0.3;

  private tileViews: TileView[] = [];
  private readonly entityViews = new Map<number, EntityView>();
  private ready = false;
  private tileset: TileSet = DEFAULT_TILESET;
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
    this.tileMap = tileMap;
    this.tileset = tileset;
    this.rebuildTiles();
  }

  /** Rebuild tile graphics after the map was edited. */
  rebuildTiles(): void {
    for (const v of this.tileViews) v.gfx.destroy();
    this.tileViews = [];
    const map = this.tileMap;
    if (!map) return;
    let id = 0;
    const add = (gfx: Graphics, x: number, y: number, h: number, box: DepthBox, occluder: boolean): void => {
      const p = gridToScreen(x, y, h, this.iso);
      gfx.position.set(p.x, p.y);
      this.world.addChild(gfx);
      box.id = id++;
      this.tileViews.push({ gfx, box, occluder });
    };

    map.forEach((x, y, tile, height) => {
      const def = this.tileset[tile] ?? MISSING_TILE;
      const flags = map.getFlags(x, y);
      const slope = map.getSlope(x, y);
      const g = new Graphics();
      const bottom = -(height + 1);
      let box = map.boxFor(x, y, 0);

      if (flags & FLAG.PIT) {
        this.drawPit(g);
        box = { ...box, maxZ: height };
      } else if (slope && slope.style === 'stairs') {
        this.drawStairs(g, slope.dir, bottom, def);
      } else if (slope) {
        this.drawCell(g, slopeCorners(slope.dir), bottom, def);
      } else {
        this.drawCell(g, { n: 0, e: 0, s: 0, w: 0 }, bottom, def);
      }
      add(g, x, y, height, box, !(flags & FLAG.PIT));

      const deck = map.getDeck(x, y);
      if (deck > 0) {
        const dg = new Graphics();
        const deckDef = this.tileset[map.deckTiles[y * map.width + x]! || tile] ?? def;
        // slab: 1 level thick, local origin at the deck's own level
        this.drawCell(dg, { n: 0, e: 0, s: 0, w: 0 }, -1, deckDef);
        const dbox: DepthBox = { id: 0, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: deck - 1, maxZ: deck };
        add(dg, x, y, deck, dbox, true);
      }
    });
  }

  /** A column top with per-corner heights, plus the two camera-facing sides down to `bottom`. */
  private drawCell(g: Graphics, c: Corners, bottom: number, def: TileDef): void {
    const P = (fx: number, fy: number, h: number): [number, number] => {
      const p = gridToScreen(fx, fy, h, this.iso);
      return [p.x, p.y];
    };
    const [nx, ny] = P(0, 0, c.n);
    const [ex, ey] = P(1, 0, c.e);
    const [sx, sy] = P(1, 1, c.s);
    const [wx, wy] = P(0, 1, c.w);
    const [wbx, wby] = P(0, 1, bottom);
    const [sbx, sby] = P(1, 1, bottom);
    const [ebx, eby] = P(1, 0, bottom);
    g.poly([wx, wy, sx, sy, sbx, sby, wbx, wby]).fill(def.left);
    g.poly([sx, sy, ex, ey, ebx, eby, sbx, sby]).fill(def.right);
    g.poly([nx, ny, ex, ey, sx, sy, wx, wy]).fill(def.top);
    g.poly([nx, ny, ex, ey, sx, sy, wx, wy]).stroke({ width: 1, color: shade(def.top, 0.85), alpha: 0.6 });
  }

  /** Stairs: STAIR_STEPS flat strips climbing one level, drawn far to near. */
  private drawStairs(g: Graphics, dir: number, bottom: number, def: TileDef): void {
    const P = (fx: number, fy: number, h: number): [number, number] => {
      const p = gridToScreen(fx, fy, h, this.iso);
      return [p.x, p.y];
    };
    // rising toward +x/+y means the high end is near the camera, so far = low steps first
    const risesTowardCamera = dir === SLOPE.E || dir === SLOPE.S;
    const order = [...Array(STAIR_STEPS).keys()];
    if (!risesTowardCamera) order.reverse();
    for (const i of order) {
      const a0 = i / STAIR_STEPS;
      const a1 = (i + 1) / STAIR_STEPS;
      // strip bounds along the climb axis; t runs 0 (low end) -> 1 (high end)
      let fx0 = 0;
      let fx1 = 1;
      let fy0 = 0;
      let fy1 = 1;
      if (dir === SLOPE.E) [fx0, fx1] = [a0, a1];
      else if (dir === SLOPE.W) [fx0, fx1] = [1 - a1, 1 - a0];
      else if (dir === SLOPE.S) [fy0, fy1] = [a0, a1];
      else [fy0, fy1] = [1 - a1, 1 - a0];
      const h = a1; // top of this step
      const light = 0.92 + 0.08 * (i / (STAIR_STEPS - 1));
      const [w1x, w1y] = P(fx0, fy1, h);
      const [s1x, s1y] = P(fx1, fy1, h);
      const [e1x, e1y] = P(fx1, fy0, h);
      const [n1x, n1y] = P(fx0, fy0, h);
      const [wbx, wby] = P(fx0, fy1, bottom);
      const [sbx, sby] = P(fx1, fy1, bottom);
      const [ebx, eby] = P(fx1, fy0, bottom);
      g.poly([w1x, w1y, s1x, s1y, sbx, sby, wbx, wby]).fill(def.left);
      g.poly([s1x, s1y, e1x, e1y, ebx, eby, sbx, sby]).fill(def.right);
      g.poly([n1x, n1y, e1x, e1y, s1x, s1y, w1x, w1y]).fill(shade(def.top, light));
      g.poly([n1x, n1y, e1x, e1y, s1x, s1y, w1x, w1y]).stroke({ width: 1, color: shade(def.top, 0.8), alpha: 0.7 });
    }
  }

  /** A hole: dark floor two levels down and the two far walls you can see into. */
  private drawPit(g: Graphics): void {
    const P = (fx: number, fy: number, h: number): [number, number] => {
      const p = gridToScreen(fx, fy, h, this.iso);
      return [p.x, p.y];
    };
    const depth = -2;
    const floor = [P(0, 0, depth), P(1, 0, depth), P(1, 1, depth), P(0, 1, depth)].flat();
    g.poly(floor).fill(0x050608);
    const [nx, ny] = P(0, 0, 0);
    const [ex, ey] = P(1, 0, 0);
    const [wx, wy] = P(0, 1, 0);
    const [nbx, nby] = P(0, 0, depth);
    const [ebx, eby] = P(1, 0, depth);
    const [wbx, wby] = P(0, 1, depth);
    g.poly([nx, ny, ex, ey, ebx, eby, nbx, nby]).fill(0x1f222b); // far wall facing +y
    g.poly([nx, ny, wx, wy, wbx, wby, nbx, nby]).fill(0x161920); // far wall facing +x
    g.poly([nx, ny, ex, ey, ...P(1, 1, 0), wx, wy]).stroke({ width: 1, color: 0x000000, alpha: 0.5 });
  }

  /** Draw one frame. */
  render(world: World): void {
    if (!this.ready) return;
    const t0 = performance.now();
    const boxes: DepthBox[] = this.tileViews.map((v) => v.box);
    const base = this.tileViews.length;
    const seen = new Set<number>();
    let focusBox: DepthBox | undefined;

    for (const e of world.query(C.Transform, C.Sprite)) {
      const t = e.require<TransformIso>(C.Transform);
      const s = e.require<Sprite>(C.Sprite);
      seen.add(e.id);
      const view = this.viewFor(e, s);
      view.gfx.visible = s.visible;
      const p = gridToScreen(t.x, t.y, t.h, this.iso);
      view.gfx.position.set(p.x, p.y);
      const box = boxAt(base + e.id, t.x, t.y, t.h, s.w, s.d, s.height, s.sortOffset);
      boxes.push(box);
      if (e.id === this.focus) focusBox = box;
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
      if (id < base) this.tileViews[id]!.gfx.zIndex = rank;
      else this.entityViews.get(id - base)!.gfx.zIndex = rank;
    }
    this.lastSortMs = performance.now() - t0;

    this.updateFade(focusBox);

    const off = this.camera.offset;
    this.world.position.set(Math.round(off.x), Math.round(off.y));
    this.world.scale.set(this.camera.zoom);
    this.app.renderer.render(this.app.stage);
  }

  /** Walls in front of the focus entity (that rise above its feet) fade out so it stays visible. */
  private updateFade(focusBox: DepthBox | undefined): void {
    const focusRect = focusBox ? screenRect(focusBox, this.iso) : undefined;
    for (const v of this.tileViews) {
      let target = 1;
      if (this.occlusionFade && focusBox && focusRect && v.occluder && v.box.maxZ > focusBox.minZ + 0.5) {
        if (rectsOverlap(focusRect, screenRect(v.box, this.iso)) && isInFront(focusBox, v.box)) target = this.fadeAlpha;
      }
      const a = v.gfx.alpha;
      v.gfx.alpha = Math.abs(a - target) < 0.02 ? target : a + (target - a) * 0.25;
    }
  }

  /** Alpha of the tile view for a cell's column (for tests and the debugger). */
  tileAlpha(x: number, y: number): number | undefined {
    return this.tileViews.find((v) => v.box.minX === x && v.box.minY === y && v.box.minZ === -1)?.gfx.alpha;
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
