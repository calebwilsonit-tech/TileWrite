import { Application, Container, Graphics, Rectangle, Sprite as PixiSprite, Text, Texture } from 'pixi.js';
import { ANIMATOR, type Animator } from '../anim/animator';
import { DEFAULT_ISO, gridToScreen, screenToCell, type Cell, type IsoConfig } from '../iso/math';
import type { LightingModel } from '../lighting/lighting';
import { C, LABEL, type Label, type Sprite, type TransformIso } from '../scene/components';
import { LightingLayer } from './lighting-layer';
import { ParticleLayer } from './particles';
import type { SpriteData } from '../sprites/format';
import { exportSheet, type Atlas } from '../sprites/sheet';
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

/** Depth-sort ids at or above this are entities (id - base); below are tile views. */
const ENTITY_ID_BASE = 2 ** 31;
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

/** A drawn sprite uploaded to the GPU: one texture per frame cut from a packed sheet. */
interface SpriteSheetTextures {
  atlas: Atlas;
  textures: Texture[];
  version: number;
}

interface EntityView {
  /** Graphics for procedural shapes, a Container (shadow + sprite) for drawn sprites. */
  gfx: Container;
  signature: string;
  spr?: PixiSprite;
  sheet?: SpriteSheetTextures;
}

interface LabelView {
  text: Text;
  underline: Graphics;
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

  /** Overlay for editor gizmos; drawn above everything, in the same projected space as the world. */
  readonly overlay = new Container();
  /** Hide the ground (tiles, decks) - used by the editor's layer toggles. */
  groundVisible = true;
  /** Hide entities - used by the editor's layer toggles. */
  entitiesVisible = true;
  /** Pixels of screen shake this frame (set by the game runner). */
  shake = 0;
  /** Draw each object's depth-sort position as a number above it (a debugging aid). */
  debugDepth = false;
  /** Milliseconds the last frame took to draw. */
  lastRenderMs = 0;
  private readonly depthLabels = new Map<number, Text>();
  /** Darkness and lights to draw this frame (null = none). Set by the game runner from the simulation. */
  lighting: LightingModel | null = null;
  private readonly lightLayer = new LightingLayer();
  private readonly labelLayer = new Container();
  private readonly labelViews = new Map<number, LabelView>();
  /** Sparks, dust and other bursts; the runner throws them from the simulation's effect queue. */
  readonly particles: ParticleLayer;
  private lastFrameAt = 0;

  private cellViews = new Map<number, TileView[]>();
  private viewById = new Map<number, TileView>();
  private tileList: TileView[] = [];
  private tileListDirty = true;
  private nextTileId = 0;
  private readonly entityViews = new Map<number, EntityView>();
  private readonly sprites = new Map<string, SpriteSheetTextures>();
  private spriteVersion = 0;
  private ready = false;
  private tileset: TileSet = DEFAULT_TILESET;
  private tileMap: TileMap | null = null;

  constructor(private readonly opts: RendererOptions = {}) {
    this.iso = opts.iso ?? DEFAULT_ISO;
    this.particles = new ParticleLayer(this.iso);
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
    this.overlay.zIndex = 1e9;
    this.world.addChild(this.overlay);
    this.labelLayer.zIndex = 1e8;
    this.world.addChild(this.labelLayer);
    this.world.addChild(this.particles.container);
    this.app.stage.addChild(this.world, this.lightLayer.glow, this.lightLayer.darkness);
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

  /** Rebuild all tile graphics (after loading or swapping the map). */
  rebuildTiles(): void {
    for (const v of this.viewById.values()) v.gfx.destroy();
    this.cellViews = new Map();
    this.viewById = new Map();
    this.tileListDirty = true;
    const map = this.tileMap;
    if (!map) return;
    map.forEach((x, y) => this.buildCell(map, x, y));
  }

  /** Rebuild only these cells after an edit (the editor calls this per brush stroke). */
  updateCells(cells: readonly { x: number; y: number }[]): void {
    const map = this.tileMap;
    if (!map) return;
    for (const c of cells) {
      this.clearCell(map, c.x, c.y);
      if (map.inBounds(c.x, c.y) && map.getTile(c.x, c.y) !== 0) this.buildCell(map, c.x, c.y);
    }
  }

  private clearCell(map: TileMap, x: number, y: number): void {
    const key = y * map.width + x;
    const views = this.cellViews.get(key);
    if (!views) return;
    for (const v of views) {
      v.gfx.destroy();
      this.viewById.delete(v.box.id);
    }
    this.cellViews.delete(key);
    this.tileListDirty = true;
  }

  private buildCell(map: TileMap, x: number, y: number): void {
    const tile = map.getTile(x, y);
    const height = map.getHeight(x, y);
    const def = this.tileset[tile] ?? MISSING_TILE;
    const flags = map.getFlags(x, y);
    const slope = map.getSlope(x, y);
    const views: TileView[] = [];
    const add = (gfx: Graphics, h: number, box: DepthBox, occluder: boolean): void => {
      const p = gridToScreen(x, y, h, this.iso);
      gfx.position.set(p.x, p.y);
      gfx.visible = this.groundVisible;
      this.world.addChild(gfx);
      box.id = this.nextTileId++;
      const view = { gfx, box, occluder };
      views.push(view);
      this.viewById.set(box.id, view);
    };

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
    add(g, height, box, !(flags & FLAG.PIT));

    const deck = map.getDeck(x, y);
    if (deck > 0) {
      const dg = new Graphics();
      const deckDef = this.tileset[map.deckTiles[y * map.width + x]! || tile] ?? def;
      // slab: 1 level thick, local origin at the deck's own level
      this.drawCell(dg, { n: 0, e: 0, s: 0, w: 0 }, -1, deckDef);
      add(dg, deck, { id: 0, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: deck - 1, maxZ: deck }, true);
    }
    this.cellViews.set(y * map.width + x, views);
    this.tileListDirty = true;
  }

  /** Show or hide the ground layer. */
  setGroundVisible(v: boolean): void {
    this.groundVisible = v;
    for (const view of this.viewById.values()) view.gfx.visible = v;
  }

  private get tiles(): TileView[] {
    if (this.tileListDirty) {
      this.tileList = [...this.viewById.values()];
      this.tileListDirty = false;
    }
    return this.tileList;
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
    const tiles = this.tiles;
    const boxes: DepthBox[] = tiles.map((v) => v.box);
    const base = ENTITY_ID_BASE;
    const seen = new Set<number>();
    let focusBox: DepthBox | undefined;

    for (const e of world.query(C.Transform, C.Sprite)) {
      const t = e.require<TransformIso>(C.Transform);
      const s = e.require<Sprite>(C.Sprite);
      seen.add(e.id);
      const view = this.viewFor(e, s);
      view.gfx.visible = s.visible && this.entitiesVisible;
      view.gfx.alpha = s.alpha ?? 1;
      const p = gridToScreen(t.x, t.y, t.h, this.iso);
      view.gfx.position.set(p.x, p.y);
      this.syncLabel(e, t, s);
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

    for (const [id, l] of this.labelViews) {
      if (!seen.has(id)) {
        l.text.destroy();
        l.underline.destroy();
        this.labelViews.delete(id);
      }
    }

    const order = sortBoxes(boxes, this.iso);
    for (let rank = 0; rank < order.length; rank++) {
      const id = order[rank]!;
      if (id < base) {
        const v = this.viewById.get(id);
        if (v) v.gfx.zIndex = rank;
      } else {
        const v = this.entityViews.get(id - base);
        if (v) v.gfx.zIndex = rank;
      }
    }
    this.lastSortMs = performance.now() - t0;
    this.syncDepthLabels();

    this.updateFade(focusBox);
    const nowMs = performance.now();
    this.particles.frame(this.lastFrameAt ? Math.min(0.1, (nowMs - this.lastFrameAt) / 1000) : 0);
    this.lastFrameAt = nowMs;

    const off = this.camera.offset;
    const jx = this.shake > 0 ? (Math.random() - 0.5) * 2 * this.shake : 0;
    const jy = this.shake > 0 ? (Math.random() - 0.5) * 2 * this.shake : 0;
    this.world.position.set(Math.round(off.x + jx), Math.round(off.y + jy));
    this.world.scale.set(this.camera.zoom);
    if (this.lighting) {
      this.lightLayer.update(this.app.renderer, this.lighting, this.iso, { x: Math.round(off.x), y: Math.round(off.y), zoom: this.camera.zoom }, this.app.screen.width, this.app.screen.height);
    } else {
      this.lightLayer.hide();
    }
    const r0 = performance.now();
    this.app.renderer.render(this.app.stage);
    this.lastRenderMs = performance.now() - r0;
  }

  /** How much there is to draw, for the profiler. */
  stats(): { objects: number; tiles: number; lights: number; sortMs: number; renderMs: number } {
    return { objects: this.entityViews.size, tiles: this.tiles.length, lights: this.lighting?.lights.length ?? 0, sortMs: this.lastSortMs, renderMs: this.lastRenderMs };
  }

  /** Numbers showing the draw order of every object, when switched on. */
  private syncDepthLabels(): void {
    if (!this.debugDepth) {
      for (const t of this.depthLabels.values()) t.visible = false;
      return;
    }
    for (const [id, v] of this.entityViews) {
      let t = this.depthLabels.get(id);
      if (!t) {
        t = new Text({ text: '', style: { fontSize: 11, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
        t.anchor.set(0.5, 1);
        this.labelLayer.addChild(t);
        this.depthLabels.set(id, t);
      }
      t.visible = v.gfx.visible;
      t.text = String(Math.round(v.gfx.zIndex));
      t.position.set(v.gfx.position.x, v.gfx.position.y - 4);
    }
    for (const [id, t] of this.depthLabels) {
      if (!this.entityViews.has(id)) {
        t.destroy();
        this.depthLabels.delete(id);
      }
    }
  }

  /** Create, update or remove the floating text for an object with a Label component. */
  private syncLabel(e: Entity, t: TransformIso, s: Sprite): void {
    const label = e.get<Label>(LABEL);
    const existing = this.labelViews.get(e.id);
    if (!label || label.text === '') {
      if (existing) existing.text.visible = existing.underline.visible = false;
      return;
    }
    const signature = `${label.text}|${label.color}|${label.size}|${label.bold}|${label.italic}|${label.underline}`;
    let v = existing;
    if (!v || v.signature !== signature) {
      v?.text.destroy();
      v?.underline.destroy();
      const text = new Text({
        text: label.text,
        style: {
          fontSize: label.size,
          fill: label.color,
          fontFamily: 'Georgia, serif',
          fontWeight: label.bold ? '700' : '400',
          fontStyle: label.italic ? 'italic' : 'normal',
          stroke: { color: 0x000000, width: 3 },
        },
      });
      text.anchor.set(0.5, 1);
      const underline = new Graphics();
      if (label.underline) underline.moveTo(-text.width / 2, 3).lineTo(text.width / 2, 3).stroke({ width: 2, color: label.color });
      this.labelLayer.addChild(underline, text);
      v = { text, underline, signature };
      this.labelViews.set(e.id, v);
    }
    const p = gridToScreen(t.x, t.y, t.h + s.height + label.lift, this.iso);
    v.text.visible = v.underline.visible = s.visible && this.entitiesVisible;
    v.text.position.set(p.x, p.y);
    v.underline.position.set(p.x, p.y);
  }

  /** Walls in front of the focus entity (that rise above its feet) fade out so it stays visible. */
  private updateFade(focusBox: DepthBox | undefined): void {
    const focusRect = focusBox ? screenRect(focusBox, this.iso) : undefined;
    for (const v of this.tiles) {
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
    return this.cellViews.get(y * (this.tileMap?.width ?? 0) + x)?.find((v) => v.box.minZ === -1)?.gfx.alpha;
  }

  /** Cell under a viewport pixel, assuming the plane at height h. */
  viewToCell(px: number, py: number, h = 0): Cell {
    const w = this.camera.viewToWorld({ x: px, y: py });
    return screenToCell(w.x, w.y, h, this.iso);
  }

  /**
   * Make a drawn sprite available to entities whose Sprite component names it (`asset`).
   * Call again after the sprite is edited; views using it refresh on the next frame.
   */
  registerSprite(data: SpriteData): void {
    this.unregisterSprite(data.name);
    const sheet = exportSheet(data, { powerOfTwo: false, padding: 1, png: false });
    const canvas = document.createElement('canvas');
    canvas.width = sheet.width;
    canvas.height = sheet.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This computer cannot draw 2D canvases, so sprites cannot be shown.');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(sheet.rgba), sheet.width, sheet.height), 0, 0);
    const base = Texture.from(canvas);
    base.source.scaleMode = 'nearest';
    const textures = sheet.atlas.frames.map((f) => new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
    this.sprites.set(data.name, { atlas: sheet.atlas, textures, version: ++this.spriteVersion });
  }

  unregisterSprite(name: string): void {
    const old = this.sprites.get(name);
    if (!old) return;
    for (const t of old.textures) t.destroy(false);
    this.sprites.delete(name);
  }

  hasSprite(name: string): boolean {
    return this.sprites.has(name);
  }

  private viewFor(e: Entity, s: Sprite): EntityView {
    const sheet = s.asset ? this.sprites.get(s.asset) : undefined;
    const signature = sheet ? `asset|${s.asset}|${sheet.version}|${s.w}|${s.d}` : `${s.shape}|${s.color}|${s.w}|${s.d}|${s.height}`;
    let v = this.entityViews.get(e.id);
    if (!v || v.signature !== signature) {
      v?.gfx.destroy({ children: true });
      if (sheet) {
        const node = new Container();
        const shadow = new Graphics();
        shadow.ellipse(0, 0, Math.max(6, s.w * this.iso.tileW * 0.3), Math.max(3, s.d * this.iso.tileH * 0.3)).fill({ color: 0x000000, alpha: 0.28 });
        const spr = new PixiSprite();
        node.addChild(shadow, spr);
        v = { gfx: node, signature, spr, sheet };
      } else {
        const gfx = new Graphics();
        this.drawSprite(gfx, s);
        v = { gfx, signature };
      }
      this.world.addChild(v.gfx);
      this.entityViews.set(e.id, v);
    }
    if (v.spr && v.sheet) {
      const anim = e.get<Animator>(ANIMATOR);
      this.showFrame(v, anim?.frame ?? 0, anim?.flip ?? false);
    }
    return v;
  }

  /** Point the view's sprite at a frame, mirrored left-to-right around the feet if asked. */
  private showFrame(v: EntityView, frame: number, flip: boolean): void {
    const sheet = v.sheet!;
    const idx = frame >= 0 && frame < sheet.textures.length ? frame : 0;
    const f = sheet.atlas.frames[idx]!;
    const spr = v.spr!;
    spr.texture = sheet.textures[idx]!;
    const ox = f.trimX - sheet.atlas.origin.x;
    spr.scale.x = flip ? -1 : 1;
    spr.position.set(flip ? -ox : ox, f.trimY - sheet.atlas.origin.y);
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
