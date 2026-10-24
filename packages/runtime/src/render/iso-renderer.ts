import { Application, Container, Graphics, Rectangle, Sprite as PixiSprite, Text, Texture } from 'pixi.js';
import { ANIMATOR, type Animator } from '../anim/animator';
import type { CellMark } from '../story/cutscene';
import type { BlockFace, CellStack } from '../tilemap/tilemap';
import { DEFAULT_ISO, gridToScreen, relToScreen, rotateGrid, screenToCell, screenToGrid, unrotateVec, type Cell, type IsoConfig, type ViewRotation } from '../iso/math';
import type { LightingModel } from '../lighting/lighting';
import { ATTACH, C, LABEL, type Attach, type Label, type Sprite, type TransformIso } from '../scene/components';
import { gravityFrame, spriteBox } from '../physics/gravity';
import type { Body } from '../physics/physics';
import { LightingLayer } from './lighting-layer';
import { ParticleLayer } from './particles';
import type { SpriteData } from '../sprites/format';
import { compositeFrame } from '../sprites/raster';
import { exportSheet, type Atlas } from '../sprites/sheet';
import type { Entity, EntityId, World } from '../scene/world';
import { DEFAULT_TILESET, FLAG, SLOPE, TileMap, type TileDef, type TileSet } from '../tilemap/tilemap';
import { Camera } from './camera';
import { boxAt, isInFront, rectsOverlap, rotateBox, screenRect, sortBoxes, type DepthBox } from './depth';
import { blocksView, fadesLegacy, type OcclusionMode } from './occlusion';

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/** Depth-sort ids at or above this are entities (id - base); below are tile views. */
const ENTITY_ID_BASE = 2 ** 31;
/** Tiles are drawn in chunks this many cells wide. */
const CHUNK = 8;

/** A cell's position as it sits in the turned world (for ordering by depth). */
function rotateGridCell(x: number, y: number, iso: IsoConfig): { x: number; y: number } {
  return rotateGrid(x + 0.5, y + 0.5, iso);
}
/** Draw-order ids of the ground marks (move ranges, building footprints): above the tiles' ids, below the entities'. */
const MARK_ID_BASE = 2 ** 30;
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
  /** A tall prop whose upper part fades when something stands behind it: that part and the rest, as separate pictures per frame. */
  fade?: { top: (Texture | null)[]; bottom: (Texture | null)[]; splitY: number };
}

interface EntityView {
  /** Graphics for procedural shapes, a Container (shadow + sprite) for drawn sprites. */
  gfx: Container;
  signature: string;
  spr?: PixiSprite;
  /** The faded part of a tall prop (its canopy). */
  spr2?: PixiSprite;
  sheet?: SpriteSheetTextures;
  /** Whether this is a wall or floor attachment seen from the left, the right, or the top (it is rebuilt when that changes). */
  side?: string;
  /** How far the picture is turned right now (it eases to where gravity says is up). */
  angle?: number;
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
  /** Hid the followed thing on the last frame (so a block at the edge of the view does not flicker). */
  hiding?: boolean;
  /** The tile counts as a wall (Layers panel: Walls). */
  wall: boolean;
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
type Corner = 'n' | 'e' | 's' | 'w';
/** Where each corner of a cell (or footprint) is in its own frame. */
const CORNER_AT: Record<Corner, [number, number]> = { n: [0, 0], e: [1, 0], s: [1, 1], w: [0, 1] };
/** The two corners of the side whose outward direction is (x, y) in the world. */
const SIDE_CORNERS: Record<string, [Corner, Corner]> = { '0,1': ['w', 's'], '1,0': ['e', 's'], '0,-1': ['n', 'e'], '-1,0': ['n', 'w'] };

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
  /** Which rule says a wall is in the way of the thing being followed (see occlusion.ts). */
  occlusionMode: OcclusionMode = 'legacy';

  /** Overlay for editor gizmos; drawn above everything, in the same projected space as the world. */
  readonly overlay = new Container();
  /** Hide the ground (tiles, decks) - used by the editor's layer toggles. */
  groundVisible = true;
  /** Hide entities - used by the editor's layer toggles. */
  entitiesVisible = true;
  /** Hide walls only (tiles marked as walls), for the Layers panel. */
  wallsVisible = true;
  /** Hide some objects only (decoration, lights...), for the Layers panel. */
  entityHidden: ((e: Entity) => boolean) | null = null;
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
  /** Show only the blocks below this level (null = all): lets inner blocks be reached. */
  private sliceTop: number | null = null;
  /** See through the world (every tile drawn faint). */
  private xray = false;
  /** Cells to tint on the ground this frame (see ViewState.cells). */
  marks: readonly CellMark[] = [];
  private readonly markViews: Graphics[] = [];
  private readonly labelViews = new Map<number, LabelView>();
  /** Sparks, dust and other bursts; the runner throws them from the simulation's effect queue. */
  readonly particles: ParticleLayer;
  private lastFrameAt = 0;

  private cellViews = new Map<number, TileView[]>();
  private viewById = new Map<number, TileView>();
  private tileList: TileView[] = [];
  private tileListDirty = true;
  /** Chunks of tiles that are drawn right now, and the range the camera wanted last. */
  private builtChunks = new Set<number>();
  private chunkKey = '';
  /** The highest level in the map (the view looks that far up for tall things). */
  private maxLevel = 0;
  private nextTileId = 0;
  private readonly entityViews = new Map<number, EntityView>();
  private readonly sprites = new Map<string, SpriteSheetTextures>();
  /** Sprites kept whole (not trimmed) for covering the top faces of tiles, and the textures made from them on first use. */
  private readonly artSources = new Map<string, SpriteData>();
  private readonly artTextures = new Map<string, Texture>();
  private spriteVersion = 0;
  private ready = false;
  private tileset: TileSet = DEFAULT_TILESET;
  private tileMap: TileMap | null = null;

  constructor(private readonly opts: RendererOptions = {}) {
    this.iso = { ...(opts.iso ?? DEFAULT_ISO) };
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
    this.iso.mapW = tileMap.width;
    this.iso.mapH = tileMap.height;
    this.tileset = tileset;
    this.rebuildTiles();
  }

  /**
   * Rebuild all tile graphics (after loading or swapping the map). Tiles are drawn in chunks of CHUNK x CHUNK cells, built only
   * while they are near the camera, so a map of any size starts at once and costs what is on screen.
   */
  rebuildTiles(): void {
    for (const v of this.viewById.values()) v.gfx.destroy();
    this.cellViews = new Map();
    this.viewById = new Map();
    this.builtChunks = new Set();
    this.tileListDirty = true;
    this.maxLevel = 0;
    const map = this.tileMap;
    if (!map) return;
    for (let i = 0; i < map.heights.length; i++) if (map.heights[i]! > this.maxLevel) this.maxLevel = map.heights[i]!;
    for (const s of map.stacks.values()) for (const b of s.blocks) this.maxLevel = Math.max(this.maxLevel, b.z + 1);
    this.ensureChunks(true);
  }

  /** Build the chunks that are on (or just beside) the picture and drop the ones that are far from it. */
  private ensureChunks(force = false): void {
    const map = this.tileMap;
    if (!map) return;
    const cam = this.camera;
    const a = cam.viewToWorld({ x: 0, y: 0 });
    const z = cam.viewToWorld({ x: cam.viewW, y: cam.viewH });
    const margin = 128;
    const left = a.x - margin;
    const right = z.x + margin;
    const top = a.y - margin;
    const bottom = z.y + margin;
    const key0 = `${Math.round(left / 32)},${Math.round(top / 32)},${Math.round(right / 32)},${Math.round(bottom / 32)},${this.iso.view ?? 0}`;
    if (!force && key0 === this.chunkKey) return;
    this.chunkKey = key0;
    const c = CHUNK;
    const perRow = Math.ceil(map.width / c);
    const rows = Math.ceil(map.height / c);
    const top0 = this.maxLevel + 1;
    // does a chunk's picture (a diamond and its columns) touch the rectangle?
    const touches = (cx: number, cy: number, pad: number): boolean => {
      const x0 = cx * c;
      const y0 = cy * c;
      const x1 = Math.min(map.width, x0 + c);
      const y1 = Math.min(map.height, y0 + c);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [gx, gy] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const) {
        for (const h of [-1, top0]) {
          const p = gridToScreen(gx, gy, h, this.iso);
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
      return maxX >= left - pad && minX <= right + pad && maxY >= top - pad && minY <= bottom + pad;
    };
    // only the chunks inside the grid rectangle that the picture covers are worth asking about
    let gx0 = Infinity;
    let gy0 = Infinity;
    let gx1 = -Infinity;
    let gy1 = -Infinity;
    for (const p of [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]) {
      for (const h of [-1, top0]) {
        const g = screenToGrid(p.x, p.y, h, this.iso);
        gx0 = Math.min(gx0, g.x);
        gy0 = Math.min(gy0, g.y);
        gx1 = Math.max(gx1, g.x);
        gy1 = Math.max(gy1, g.y);
      }
    }
    const cx0 = Math.max(0, Math.floor(gx0 / c) - 1);
    const cy0 = Math.max(0, Math.floor(gy0 / c) - 1);
    const cx1 = Math.min(perRow - 1, Math.floor(gx1 / c) + 1);
    const cy1 = Math.min(rows - 1, Math.floor(gy1 / c) + 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * perRow + cx;
        if (this.builtChunks.has(key) || !touches(cx, cy, 0)) continue;
        this.builtChunks.add(key);
        for (let y = cy * c; y < Math.min(map.height, (cy + 1) * c); y++) for (let x = cx * c; x < Math.min(map.width, (cx + 1) * c); x++) if (map.getTile(x, y) !== 0 || map.getStack(x, y)) this.buildCell(map, x, y);
      }
    }
    for (const key of [...this.builtChunks]) {
      const cx = key % perRow;
      const cy = Math.floor(key / perRow);
      if (touches(cx, cy, margin)) continue;
      this.builtChunks.delete(key);
      for (let y = cy * c; y < Math.min(map.height, (cy + 1) * c); y++) for (let x = cx * c; x < Math.min(map.width, (cx + 1) * c); x++) this.clearCell(map, x, y);
    }
  }

  private cellBuilt(x: number, y: number): boolean {
    const map = this.tileMap;
    if (!map) return false;
    return this.builtChunks.has(Math.floor(y / CHUNK) * Math.ceil(map.width / CHUNK) + Math.floor(x / CHUNK));
  }

  /** Rebuild only these cells after an edit (the editor calls this per brush stroke). */
  updateCells(cells: readonly { x: number; y: number }[]): void {
    const map = this.tileMap;
    if (!map) return;
    for (const c of cells) {
      if (!this.cellBuilt(c.x, c.y)) {
        if (map.inBounds(c.x, c.y)) this.maxLevel = Math.max(this.maxLevel, map.topHeight(c.x, c.y));
        continue;
      }
      this.clearCell(map, c.x, c.y);
      if (map.inBounds(c.x, c.y) && (map.getTile(c.x, c.y) !== 0 || map.getStack(c.x, c.y))) {
        this.maxLevel = Math.max(this.maxLevel, map.topHeight(c.x, c.y));
        this.buildCell(map, c.x, c.y);
      }
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

  /** The block (and which of its faces) under a viewport pixel, counting every level of plain columns too; null over nothing. */
  pickBlock(px: number, py: number): { x: number; y: number; z: number; face: BlockFace } | null {
    const map = this.tileMap;
    if (!map) return null;
    const w = this.camera.viewToWorld({ x: px, y: py });
    const l = unrotateVec(0, 1, this.view);
    const r = unrotateVec(1, 0, this.view);
    const faceName = (nx: number, ny: number): BlockFace => (nx === 1 ? 'e' : nx === -1 ? 'w' : ny === 1 ? 's' : 'n');
    const leftFace = faceName(l.x, l.y);
    const rightFace = faceName(r.x, r.y);
    const inside = (pts: number[], x: number, y: number): boolean => {
      let c = false;
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const xi = pts[i]!;
        const yi = pts[i + 1]!;
        const xj = pts[j]!;
        const yj = pts[j + 1]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const hw = this.iso.tileW / 2;
    const hh = this.iso.tileH / 2;
    let best: { x: number; y: number; z: number; face: BlockFace; key: number } | null = null;
    const test = (x: number, y: number, z: number): void => {
      if (this.sliceTop !== null && z >= this.sliceTop) return;
      const c = gridToScreen(x + 0.5, y + 0.5, z + 1, this.iso);
      if (w.x < c.x - hw || w.x > c.x + hw || w.y < c.y - hh || w.y > c.y + hh + this.iso.heightPx) return;
      const rc = relToScreen;
      const P = (fx: number, fy: number, h: number): [number, number] => {
        const p = rc(fx - 0.5, fy - 0.5, h, this.iso);
        return [c.x + p.x, c.y + p.y];
      };
      const top = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)].flat();
      const CORNERS: Record<string, [number, number]> = { n: [0, 0], e: [1, 0], s: [1, 1], w: [0, 1] };
      const sideOf = (pair: [Corner, Corner]): number[] => {
        const [a, b] = pair;
        return [...P(CORNERS[a]![0], CORNERS[a]![1], 0), ...P(CORNERS[b]![0], CORNERS[b]![1], 0), ...P(CORNERS[b]![0], CORNERS[b]![1], -1), ...P(CORNERS[a]![0], CORNERS[a]![1], -1)];
      };
      const sides = this.visibleSides();
      let face: BlockFace | null = null;
      if (map.blockAt(x, y, z + 1) === undefined && inside(top, w.x, w.y)) face = 'top';
      else if (map.blockAt(x + l.x, y + l.y, z) === undefined && inside(sideOf(sides.left), w.x, w.y)) face = leftFace;
      else if (map.blockAt(x + r.x, y + r.y, z) === undefined && inside(sideOf(sides.right), w.x, w.y)) face = rightFace;
      if (!face) return;
      const rot = rotateGridCell(x, y, this.iso);
      const key = rot.x + rot.y + z * 1.0001;
      if (!best || key > best.key) best = { x, y, z, face, key };
    };
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getTile(x, y) === 0 && !map.getStack(x, y)) continue;
        const st = map.getStack(x, y);
        if (st) for (const b of st.blocks) test(x, y, b.z);
        else if (!map.getSlope(x, y) && map.getDeck(x, y) === 0) {
          // a cell with no blocks on it: its ground can be pointed at, so the first block of a building can go on it
          if (map.getHeight(x, y) === 0) test(x, y, -1);
          for (let z = 0; z < map.getHeight(x, y); z++) test(x, y, z);
        }
        else test(x, y, Math.max(0, Math.ceil(map.topHeight(x, y)) - 1));
        // a floor (the ground of a cell with no block on it) can be picked too
        if (st && st.floor !== 0 && !st.blocks.some((b) => b.z === 0)) test(x, y, -1);
      }
    }
    const hit = best as { x: number; y: number; z: number; face: BlockFace } | null;
    return hit ? { x: hit.x, y: hit.y, z: hit.z, face: hit.face } : null;
  }

  /** Show only the blocks below level `top` (null shows everything). */
  setSlice(top: number | null): void {
    if (this.sliceTop === top) return;
    this.sliceTop = top;
    this.rebuildTiles();
  }

  setXray(on: boolean): void {
    this.xray = on;
  }

  /** Turn the world a quarter turn at a time on screen. Everything is drawn again; the caller recentres the camera. */
  setView(view: ViewRotation): void {
    if ((this.iso.view ?? 0) === view) return;
    this.iso.view = view;
    this.rebuildTiles();
  }

  /** How see-through the canopy of a tall prop is right now (1 = solid, lower = faded because something stands behind it); null when it has no canopy. */
  canopyAlpha(entityId: number): number | null {
    const v = this.entityViews.get(entityId);
    return v?.spr2 ? v.spr2.alpha : null;
  }

  get view(): ViewRotation {
    return this.iso.view ?? 0;
  }

  /** The cell whose surface is under a viewport pixel (the top of a column, or the side of a tall one), or null over nothing. */
  pickCell(px: number, py: number): Cell | null {
    const map = this.tileMap;
    if (!map) return null;
    const w = this.camera.viewToWorld({ x: px, y: py });
    let top = 0;
    for (let i = 0; i < map.heights.length; i++) if (map.heights[i]! > top) top = map.heights[i]!;
    for (let h = top + 1; h >= 0; h--) {
      const c = screenToCell(w.x, w.y, h, this.iso);
      if (!map.inBounds(c.x, c.y) || map.getTile(c.x, c.y) === 0) continue;
      if (map.topHeight(c.x, c.y) >= h - 1e-6) return c;
    }
    return null;
  }

  /** Where a place in the world is on screen (in the picture's own pixels), in whichever view is showing. */
  worldToScreen(x: number, y: number, h = 0): { x: number; y: number } {
    return gridToScreen(x, y, h, this.iso);
  }

  /** A point on a cell (or object) in its own frame: (0,0) is its north corner, (1,1) its south corner, 0.5 the middle; turns with the view. */
  private local(fx: number, fy: number, h: number): [number, number] {
    const p = relToScreen(fx - 0.5, fy - 0.5, h, this.iso);
    return [p.x, p.y];
  }

  /** The corners of the two sides that face the camera in this view (left on screen, right on screen). */
  private visibleSides(): { left: [Corner, Corner]; right: [Corner, Corner] } {
    const l = unrotateVec(0, 1, this.view);
    const r = unrotateVec(1, 0, this.view);
    return { left: SIDE_CORNERS[`${l.x},${l.y}`]!, right: SIDE_CORNERS[`${r.x},${r.y}`]! };
  }

  private buildCell(map: TileMap, x: number, y: number): void {
    const tile = map.getTile(x, y);
    const height = map.getHeight(x, y);
    const def = this.tileset[tile] ?? MISSING_TILE;
    const flags = map.getFlags(x, y);
    const slope = map.getSlope(x, y);
    const views: TileView[] = [];
    const wall = def.wall === true;
    const add = (gfx: Graphics, h: number, box: DepthBox, occluder: boolean): void => {
      const p = gridToScreen(x + 0.5, y + 0.5, h, this.iso);
      gfx.position.set(p.x, p.y);
      gfx.visible = this.groundVisible && (this.wallsVisible || !wall);
      this.world.addChild(gfx);
      box.id = this.nextTileId++;
      const view = { gfx, box, occluder, wall };
      views.push(view);
      this.viewById.set(box.id, view);
    };

    const stack = map.getStack(x, y);
    if (stack) {
      this.buildStack(map, x, y, stack, add);
      this.cellViews.set(y * map.width + x, views);
      this.tileListDirty = true;
      return;
    }
    const g = new Graphics();
    const cut = this.sliceTop;
    // a column cut by the slice shows only its lower levels
    if (cut !== null && height > cut) {
      const low = Math.max(0, cut);
      if (low === 0) {
        this.cellViews.set(y * map.width + x, views);
        return;
      }
      this.drawCell(g, { n: 0, e: 0, s: 0, w: 0 }, -(low + 1), def);
      add(g, low, { id: 0, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: -1, maxZ: low }, true);
      this.cellViews.set(y * map.width + x, views);
      this.tileListDirty = true;
      return;
    }
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
      if (def.anim) this.addAnimation(g, def);
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
    this.applyTileVisibility();
  }

  /** Show or hide the tiles marked as walls. */
  setWallsVisible(v: boolean): void {
    this.wallsVisible = v;
    this.applyTileVisibility();
  }

  private applyTileVisibility(): void {
    for (const view of this.viewById.values()) view.gfx.visible = this.groundVisible && (this.wallsVisible || !view.wall);
  }

  private get tiles(): TileView[] {
    if (this.tileListDirty) {
      this.tileList = [...this.viewById.values()];
      this.tileListDirty = false;
    }
    return this.tileList;
  }

  /** A cell built block by block: its floor, then every block as its own cube with its own faces. */
  private buildStack(map: TileMap, x: number, y: number, stack: CellStack, add: (gfx: Graphics, h: number, box: DepthBox, occluder: boolean) => void): void {
    const def = (t: number): TileDef => this.tileset[t] ?? MISSING_TILE;
    const flat = { n: 0, e: 0, s: 0, w: 0 };
    const hasGround = stack.blocks.some((b) => b.z === 0);
    if (stack.floor !== 0 && !hasGround && (this.sliceTop === null || this.sliceTop > 0)) {
      const g = new Graphics();
      this.drawCell(g, flat, -1, def(stack.floor));
      add(g, 0, { id: 0, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: -1, maxZ: 0 }, true);
    }
    const l = unrotateVec(0, 1, this.view);
    const r = unrotateVec(1, 0, this.view);
    const faceName = (nx: number, ny: number): BlockFace => (nx === 1 ? 'e' : nx === -1 ? 'w' : ny === 1 ? 's' : 'n');
    const leftFace = faceName(l.x, l.y);
    const rightFace = faceName(r.x, r.y);
    for (const b of stack.blocks) {
      if (this.sliceTop !== null && b.z >= this.sliceTop) continue;
      const g = new Graphics();
      const own = def(b.tile);
      const faces = { top: def(b.faces?.top ?? b.tile), left: def(b.faces?.[leftFace] ?? b.tile), right: def(b.faces?.[rightFace] ?? b.tile) };
      if (b.shape === 'stairs' || b.shape === 'ramp') {
        // a stair or ramp block: the same pictures a stair or ramp column has, one level tall, turned the way it rises
        const dir = (b.rot ?? 0) + 1;
        if (b.shape === 'stairs') this.drawStairs(g, dir, 0, own);
        else this.drawCell(g, slopeCorners(dir), 0, own, faces);
        add(g, b.z, { id: 0, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: b.z, maxZ: b.z + 1 }, true);
        continue;
      }
      // a side that is against another block at the same level is never seen
      const hidden = (nx: number, ny: number): boolean => {
        const next = map.blockAt(x + nx, y + ny, b.z);
        return next !== undefined && (next.shape ?? 'cube') === 'cube';
      };
      const skip = { left: hidden(l.x, l.y), right: hidden(r.x, r.y) };
      this.drawCell(g, flat, -1, own, faces, skip);
      const wall = own.wall === true;
      add(g, b.z + 1, { id: 0, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: b.z, maxZ: b.z + 1 }, true);
      void wall;
    }
  }

  /** A column top with per-corner heights, plus the two camera-facing sides down to `bottom`. */
  private drawCell(g: Graphics, c: Corners, bottom: number, def: TileDef, faces?: { top: TileDef; left: TileDef; right: TileDef }, skip?: { left: boolean; right: boolean }): void {
    const P = (fx: number, fy: number, h: number): [number, number] => this.local(fx, fy, h);
    const [nx, ny] = P(0, 0, c.n);
    const [ex, ey] = P(1, 0, c.e);
    const [sx, sy] = P(1, 1, c.s);
    const [wx, wy] = P(0, 1, c.w);
    const sides = this.visibleSides();
    const side = (corners: [Corner, Corner], fill: number | { texture: Texture; textureSpace: 'local' }): void => {
      const [a, b] = corners;
      const A = P(CORNER_AT[a][0], CORNER_AT[a][1], c[a]);
      const B = P(CORNER_AT[b][0], CORNER_AT[b][1], c[b]);
      const Ab = P(CORNER_AT[a][0], CORNER_AT[a][1], bottom);
      const Bb = P(CORNER_AT[b][0], CORNER_AT[b][1], bottom);
      if (typeof fill === 'number') {
        g.poly([A[0], A[1], B[0], B[1], Bb[0], Bb[1], Ab[0], Ab[1]]).fill(fill);
        return;
      }
      // a picture on a face is repeated for every level the face is tall (a cliff of three levels shows it three times)
      const per = Math.max(0.5, def.faceLevels ?? 1);
      const total = Math.max(per, c[a] - bottom);
      for (let top = 0; top < total - 1e-6; top += per) {
        const hiA = P(CORNER_AT[a][0], CORNER_AT[a][1], c[a] - top);
        const hiB = P(CORNER_AT[b][0], CORNER_AT[b][1], c[b] - top);
        const loA = P(CORNER_AT[a][0], CORNER_AT[a][1], c[a] - Math.min(total, top + per));
        const loB = P(CORNER_AT[b][0], CORNER_AT[b][1], c[b] - Math.min(total, top + per));
        g.poly([hiA[0], hiA[1], hiB[0], hiB[1], loB[0], loB[1], loA[0], loA[1]]).fill(fill);
      }
    };
    if (!skip?.left) side(sides.left, this.sideFill(faces?.left ?? def, 'left'));
    if (!skip?.right) side(sides.right, this.sideFill(faces?.right ?? def, 'right'));
    const top = faces?.top ?? def;
    g.poly([nx, ny, ex, ey, sx, sy, wx, wy]).fill(this.topFill(top));
    g.poly([nx, ny, ex, ey, sx, sy, wx, wy]).stroke({ width: 1, color: shade(top.top, 0.85), alpha: this.hasTileArt(top) ? 0.15 : 0.6 });
    if (top.rim) this.drawRim(g, [nx, ny], [ex, ey], [sx, sy], [wx, wy], top.rim);
  }

  /** What fills a tile's top face: its art stretched over the face (the art's own picture of a diamond), or its flat colour. */
  private topFill(def: TileDef): number | { texture: Texture; textureSpace: 'local' } {
    const name = def.anim?.frames[0] ?? def.art;
    const t = name ? this.artTexture(name) : null;
    return t ? { texture: t, textureSpace: 'local' } : def.top;
  }

  /** What fills a side face: its art (drawn on the wall-face template), or the flat colour. */
  private sideFill(def: TileDef, which: 'left' | 'right'): number | { texture: Texture; textureSpace: 'local' } {
    const name = which === 'left' ? def.leftArt : def.rightArt;
    const t = name ? this.artTexture(name) : null;
    return t ? { texture: t, textureSpace: 'local' } : which === 'left' ? def.left : def.right;
  }

  /** Moving tops: a picture on the cell that changes with the clock, the same on every cell so the map moves together. */
  private addAnimation(g: Graphics, def: TileDef): void {
    const frames = (def.anim?.frames ?? []).map((n) => this.artTexture(n)).filter((t): t is Texture => t !== null);
    if (!def.anim || frames.length < 2) return;
    const spr = new PixiSprite(frames[0]);
    spr.position.set(-this.iso.tileW / 2, -this.iso.tileH / 2);
    spr.width = this.iso.tileW;
    spr.height = this.iso.tileH;
    g.addChild(spr);
    this.animated.push({ spr, frames, fps: def.anim.fps });
  }

  /** Switch the moving tops to the frame the clock says. */
  private tickAnimations(nowMs: number): void {
    if (this.animated.length === 0) return;
    for (let i = this.animated.length - 1; i >= 0; i--) {
      const a = this.animated[i]!;
      if (a.spr.destroyed) {
        this.animated.splice(i, 1);
        continue;
      }
      const tex = a.frames[Math.floor((nowMs / 1000) * a.fps) % a.frames.length]!;
      if (a.spr.texture !== tex) a.spr.texture = tex;
    }
  }

  /** Whether this tile's art is available now. */
  hasTileArt(def: TileDef): boolean {
    const name = def.anim?.frames[0] ?? def.art;
    return !!name && this.artSources.has(name.split('#')[0]!);
  }

  /** Sprites of moving tops currently on the map. */
  private readonly animated: { spr: PixiSprite; frames: Texture[]; fps: number }[] = [];

  private artTexture(name: string): Texture | null {
    const cached = this.artTextures.get(name);
    if (cached) return cached;
    // "water#2" is the third frame of the sprite "water"
    const [spriteName, frameText] = name.split('#');
    const frame = Math.max(0, Number(frameText ?? 0) || 0);
    const data = this.artSources.get(spriteName!);
    if (!data || frame >= data.frames.length) return null;
    const canvas = document.createElement('canvas');
    canvas.width = data.width;
    canvas.height = data.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(compositeFrame(data, frame)), data.width, data.height), 0, 0);
    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'nearest';
    this.artTextures.set(name, tex);
    return tex;
  }

  /** An outline along the sides of the top face that border something else, and a dot in the corners where only a diagonal does. */
  private drawRim(g: Graphics, n: [number, number], e: [number, number], s: [number, number], w: [number, number], rim: { sides: number; corners: number; color: number }): void {
    const line = (a: [number, number], b: [number, number]): void => {
      g.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ width: 4, color: rim.color, alpha: 0.95 });
    };
    if (rim.sides & 1) line(n, e); // north side of the cell
    if (rim.sides & 2) line(e, s); // east
    if (rim.sides & 4) line(w, s); // south
    if (rim.sides & 8) line(n, w); // west
    const cx = (n[0] + s[0]) / 2;
    const cy = (n[1] + s[1]) / 2;
    const dot = (p: [number, number]): void => {
      const x = p[0] + (cx - p[0]) * 0.22;
      const y = p[1] + (cy - p[1]) * 0.22;
      g.poly([x, y - 4, x + 6, y, x, y + 4, x - 6, y]).fill({ color: rim.color, alpha: 0.95 });
    };
    if (rim.corners & 1) dot(e); // the north-east diagonal touches the east corner
    if (rim.corners & 2) dot(s);
    if (rim.corners & 4) dot(w);
    if (rim.corners & 8) dot(n);
  }

  /** Stairs: STAIR_STEPS flat strips climbing one level, drawn far to near. */
  private drawStairs(g: Graphics, dir: number, bottom: number, def: TileDef): void {
    const P = (fx: number, fy: number, h: number): [number, number] => this.local(fx, fy, h);
    const strips: { fx0: number; fx1: number; fy0: number; fy1: number; h: number; light: number; depth: number }[] = [];
    for (let i = 0; i < STAIR_STEPS; i++) {
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
      const c = relToScreen((fx0 + fx1) / 2 - 0.5, (fy0 + fy1) / 2 - 0.5, 0, this.iso);
      strips.push({ fx0, fx1, fy0, fy1, h: a1, light: 0.92 + 0.08 * (i / (STAIR_STEPS - 1)), depth: c.y });
    }
    // far strips first, whichever way the view turns the stairs
    strips.sort((a, b) => a.depth - b.depth);
    const sides = this.visibleSides();
    for (const t of strips) {
      const at = (corner: Corner, h: number): [number, number] => {
        const [cx, cy] = CORNER_AT[corner];
        return P(cx === 0 ? t.fx0 : t.fx1, cy === 0 ? t.fy0 : t.fy1, h);
      };
      const side = (corners: [Corner, Corner], fill: number): void => {
        const [a, b] = corners;
        const A = at(a, t.h);
        const B = at(b, t.h);
        const Ab = at(a, bottom);
        const Bb = at(b, bottom);
        g.poly([A[0], A[1], B[0], B[1], Bb[0], Bb[1], Ab[0], Ab[1]]).fill(fill);
      };
      side(sides.left, def.left);
      side(sides.right, def.right);
      const [n1x, n1y] = at('n', t.h);
      const [e1x, e1y] = at('e', t.h);
      const [s1x, s1y] = at('s', t.h);
      const [w1x, w1y] = at('w', t.h);
      g.poly([n1x, n1y, e1x, e1y, s1x, s1y, w1x, w1y]).fill(shade(def.top, t.light));
      g.poly([n1x, n1y, e1x, e1y, s1x, s1y, w1x, w1y]).stroke({ width: 1, color: shade(def.top, 0.8), alpha: 0.7 });
    }
  }

  /** A hole: dark floor two levels down and the two far walls you can see into. */
  private drawPit(g: Graphics): void {
    const P = (fx: number, fy: number, h: number): [number, number] => this.local(fx, fy, h);
    const depth = -2;
    const floor = [P(0, 0, depth), P(1, 0, depth), P(1, 1, depth), P(0, 1, depth)].flat();
    g.poly(floor).fill(0x050608);
    // the far walls are the sides opposite the two that face the camera
    const l = unrotateVec(0, 1, this.view);
    const r = unrotateVec(1, 0, this.view);
    const wall = (nx: number, ny: number, fill: number): void => {
      const [a, b] = SIDE_CORNERS[`${-nx},${-ny}`]!;
      const A = P(CORNER_AT[a][0], CORNER_AT[a][1], 0);
      const B = P(CORNER_AT[b][0], CORNER_AT[b][1], 0);
      const Ab = P(CORNER_AT[a][0], CORNER_AT[a][1], depth);
      const Bb = P(CORNER_AT[b][0], CORNER_AT[b][1], depth);
      g.poly([A[0], A[1], B[0], B[1], Bb[0], Bb[1], Ab[0], Ab[1]]).fill(fill);
    };
    wall(l.x, l.y, 0x1f222b);
    wall(r.x, r.y, 0x161920);
    const [nx, ny] = P(0, 0, 0);
    const [ex, ey] = P(1, 0, 0);
    const [wx, wy] = P(0, 1, 0);
    g.poly([nx, ny, ex, ey, ...P(1, 1, 0), wx, wy]).stroke({ width: 1, color: 0x000000, alpha: 0.5 });
  }

  /** Draw one frame. */
  render(world: World): void {
    if (!this.ready) return;
    const t0 = performance.now();
    this.ensureChunks();
    const tiles = this.tiles;
    const boxes: DepthBox[] = tiles.map((v) => rotateBox(v.box, this.iso));
    const base = ENTITY_ID_BASE;
    const seen = new Set<number>();
    let focusBox: DepthBox | undefined;

    const canopies: { v: EntityView; box: DepthBox; id: number }[] = [];
    for (const e of world.query(C.Transform, C.Sprite)) {
      const t = e.require<TransformIso>(C.Transform);
      let s = e.require<Sprite>(C.Sprite);
      seen.add(e.id);
      // a picture fixed to a wall or floor: which of its two sprites shows depends on how the wall is seen
      const att = e.get<Attach>(ATTACH);
      let side = '';
      let flip: boolean | undefined;
      let hiddenFace = false;
      if (att) {
        const r = this.attachmentLook(att, t);
        if (r) {
          s = { ...s, asset: r.name, noShadow: true };
          side = r.key;
          flip = r.flip;
        } else hiddenFace = true;
      }
      // a body that gravity pulls somewhere other than down stands on that face: its box and its picture turn with it
      const gdir = e.get<Body>(C.Body)?.g;
      const turned = gdir !== undefined && gdir !== '-z';
      const frame = turned ? gravityFrame(gdir) : null;
      const oriented = frame ? spriteBox(frame, { x: t.x, y: t.y, h: t.h }, s.w, s.d, s.height) : null;
      // a picture of its own for this gravity, when the object has one (then it is drawn upright, as made)
      const own = gdir !== undefined ? s.byGravity?.[gdir] : undefined;
      const ownSheet = own !== undefined && own !== '' && this.sprites.has(own);
      const drawn: Sprite = ownSheet ? { ...s, asset: own } : s;
      const sheetBased = drawn.asset !== undefined && drawn.asset !== '' && this.sprites.has(drawn.asset);
      const look: Sprite = oriented && !sheetBased ? { ...drawn, w: oriented.x1 - oriented.x0, d: oriented.y1 - oriented.y0, height: oriented.z1 - oriented.z0, noShadow: true } : drawn;
      const view = this.viewFor(e, look, side, flip);
      view.gfx.visible = !hiddenFace && s.visible && this.entitiesVisible && !(this.entityHidden?.(e) ?? false);
      view.gfx.alpha = s.alpha ?? 1;
      const p = oriented && !sheetBased ? gridToScreen((oriented.x0 + oriented.x1) / 2, (oriented.y0 + oriented.y1) / 2, oriented.z0, this.iso) : gridToScreen(t.x, t.y, t.h, this.iso);
      view.gfx.position.set(p.x, p.y);
      if (sheetBased) {
        // the picture is turned so its head points the way up is on the screen (up the wall, down from the ceiling)
        let target = 0;
        if (frame && !ownSheet) {
          const away = gridToScreen(t.x + frame.up[0], t.y + frame.up[1], t.h + frame.up[2], this.iso);
          target = Math.atan2(away.x - p.x, -(away.y - p.y));
        }
        const have = view.angle ?? 0;
        let diff = target - have;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        view.angle = Math.abs(diff) < 0.01 ? target : have + diff * 0.25;
        view.gfx.rotation = view.angle;
      }
      this.syncLabel(e, t, s);
      const box = rotateBox(oriented ? { id: base + e.id, minX: oriented.x0, maxX: oriented.x1, minY: oriented.y0, maxY: oriented.y1, minZ: oriented.z0, maxZ: oriented.z1, sortOffset: s.sortOffset ?? 0 } : boxAt(base + e.id, t.x, t.y, t.h, s.w, s.d, s.height, s.sortOffset), this.iso);
      boxes.push(box);
      if (e.id === this.focus) focusBox = box;
      if (view.spr2) canopies.push({ v: view, box, id: e.id });
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

    // ground marks sit just above their cell's top
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i]!;
      boxes.push(rotateBox({ id: MARK_ID_BASE + i, minX: m.x, maxX: m.x + 1, minY: m.y, maxY: m.y + 1, minZ: m.h, maxZ: m.h + 0.02, sortOffset: 0.0001 }, this.iso));
    }
    this.drawMarks();
    const order = sortBoxes(boxes, this.iso);
    for (let rank = 0; rank < order.length; rank++) {
      const id = order[rank]!;
      if (id >= MARK_ID_BASE && id < base) {
        const g = this.markViews[id - MARK_ID_BASE];
        if (g) g.zIndex = rank;
      } else if (id < base) {
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
    this.fadeCanopies(focusBox, canopies);
    const nowMs = performance.now();
    this.tickAnimations(nowMs);
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

  private drawMarks(): void {
    while (this.markViews.length < this.marks.length) {
      const g = new Graphics();
      this.world.addChild(g);
      this.markViews.push(g);
    }
    for (let i = 0; i < this.markViews.length; i++) {
      const g = this.markViews[i]!;
      const m = this.marks[i];
      if (!m) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      g.clear();
      const p = gridToScreen(m.x + 0.5, m.y + 0.5, m.h, this.iso);
      g.position.set(p.x, p.y);
      const pts = [this.local(0, 0, 0), this.local(1, 0, 0), this.local(1, 1, 0), this.local(0, 1, 0)].flat();
      if (m.outline) g.poly(pts).stroke({ width: 2, color: m.color, alpha: m.alpha ?? 0.9 });
      else g.poly(pts).fill({ color: m.color, alpha: m.alpha ?? 0.45 });
    }
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

  /** Which picture a wall or floor attachment shows from here, and whether it is mirrored; null when its wall faces away. */
  private attachmentLook(att: Attach, t: TransformIso): { name: string; flip: boolean; key: string } | null {
    if (att.face === 'top') return att.left ? { name: att.left, flip: false, key: 'top' } : null;
    const nx = att.face === '+x' ? 1 : att.face === '-x' ? -1 : 0;
    const ny = att.face === '+y' ? 1 : att.face === '-y' ? -1 : 0;
    const p1 = gridToScreen(t.x, t.y, t.h, this.iso);
    const p2 = gridToScreen(t.x + nx * 0.2, t.y + ny * 0.2, t.h, this.iso);
    if (p2.y - p1.y <= 0) return null;
    const left = p2.x - p1.x < 0;
    if (left) return att.left ? { name: att.left, flip: false, key: 'left' } : att.right ? { name: att.right, flip: true, key: 'left' } : null;
    return att.right ? { name: att.right, flip: false, key: 'right' } : att.left ? { name: att.left, flip: true, key: 'right' } : null;
  }

  /** The canopy of a tall prop fades when the focus entity is behind it. */
  private fadeCanopies(focusBox: DepthBox | undefined, list: { v: EntityView; box: DepthBox; id: number }[]): void {
    const focusRect = focusBox ? screenRect(focusBox, this.iso) : undefined;
    for (const c of list) {
      let target = 1;
      if (this.occlusionFade && focusBox && focusRect && c.id !== this.focus && rectsOverlap(focusRect, screenRect(c.box, this.iso)) && isInFront(focusBox, c.box)) target = Math.min(0.35, this.fadeAlpha);
      if (this.xray) target = Math.min(target, 0.4);
      const spr = c.v.spr2!;
      spr.alpha = Math.abs(spr.alpha - target) < 0.02 ? target : spr.alpha + (target - spr.alpha) * 0.25;
    }
  }

  /** Walls in front of the focus entity (that rise above its feet) fade out so it stays visible. */
  private updateFade(focusBox: DepthBox | undefined): void {
    const focusRect = focusBox ? screenRect(focusBox, this.iso) : undefined;
    for (const v of this.tiles) {
      let target = 1;
      if (this.occlusionFade && focusBox && focusRect && v.occluder) {
        const vb = rotateBox(v.box, this.iso);
        const hides = this.occlusionMode === 'legacy' ? fadesLegacy(focusBox, vb, this.iso) : blocksView(focusBox, vb, this.iso, v.hiding === true);
        v.hiding = hides;
        if (hides) target = this.fadeAlpha;
      }
      if (this.xray) target = Math.min(target, 0.3);
      const a = v.gfx.alpha;
      v.gfx.alpha = Math.abs(a - target) < 0.02 ? target : a + (target - a) * 0.25;
    }
  }

  /** Alpha of the tile view for a cell's column, or of the block at level `z` of it (for tests and the debugger). */
  tileAlpha(x: number, y: number, z = -1): number | undefined {
    return this.cellViews.get(y * (this.tileMap?.width ?? 0) + x)?.find((v) => v.box.minZ === z)?.gfx.alpha;
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
    this.artSources.set(data.name, data);
    if (Object.values(this.tileset).some((d) => d.art === data.name || d.leftArt === data.name || d.rightArt === data.name || d.anim?.frames.some((f) => f.split('#')[0] === data.name))) this.rebuildTiles();
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
    const entry: SpriteSheetTextures = { atlas: sheet.atlas, textures, version: ++this.spriteVersion };
    const fade = data.meta?.fade;
    if (fade) {
      // cut every frame in two at the row where the fading part ends
      const split = fade.toY;
      entry.fade = {
        splitY: split,
        top: sheet.atlas.frames.map((f) => {
          const h = Math.max(0, Math.min(f.h, split - f.trimY));
          return h > 0 ? new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, h) }) : null;
        }),
        bottom: sheet.atlas.frames.map((f) => {
          const h = Math.max(0, Math.min(f.h, split - f.trimY));
          return f.h - h > 0 ? new Texture({ source: base.source, frame: new Rectangle(f.x, f.y + h, f.w, f.h - h) }) : null;
        }),
      };
    }
    this.sprites.set(data.name, entry);
  }

  unregisterSprite(name: string): void {
    this.artSources.delete(name);
    for (const key of [...this.artTextures.keys()]) {
      if (key === name || key.startsWith(`${name}#`)) {
        this.artTextures.get(key)?.destroy(true);
        this.artTextures.delete(key);
      }
    }
    const old = this.sprites.get(name);
    if (!old) return;
    for (const t of old.textures) t.destroy(false);
    for (const t of [...(old.fade?.top ?? []), ...(old.fade?.bottom ?? [])]) t?.destroy(false);
    this.sprites.delete(name);
  }

  hasSprite(name: string): boolean {
    return this.sprites.has(name);
  }

  private viewFor(e: Entity, s: Sprite, side = '', flip?: boolean): EntityView {
    const sheet = s.asset ? this.sprites.get(s.asset) : undefined;
    const signature = sheet ? `asset|${s.asset}|${sheet.version}|${s.w}|${s.d}|${s.noShadow ? 1 : 0}|${side}` : `${s.shape}|${s.color}|${s.w}|${s.d}|${s.height}|${s.noShadow ? 1 : 0}|${this.view}`;
    let v = this.entityViews.get(e.id);
    if (!v || v.signature !== signature) {
      v?.gfx.destroy({ children: true });
      if (sheet) {
        const node = new Container();
        const spr = new PixiSprite();
        if (!s.noShadow) {
          const shadow = new Graphics();
          shadow.ellipse(0, 0, Math.max(6, s.w * this.iso.tileW * 0.3), Math.max(3, s.d * this.iso.tileH * 0.3)).fill({ color: 0x000000, alpha: 0.28 });
          node.addChild(shadow);
        }
        node.addChild(spr);
        v = { gfx: node, signature, spr, sheet, side };
        if (sheet.fade) {
          v.spr2 = new PixiSprite();
          node.addChild(v.spr2);
        }
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
      this.showFrame(v, anim?.frame ?? 0, flip ?? anim?.flip ?? false);
    }
    return v;
  }

  /** Point the view's sprite at a frame, mirrored left-to-right around the feet if asked. */
  private showFrame(v: EntityView, frame: number, flip: boolean): void {
    const sheet = v.sheet!;
    const idx = frame >= 0 && frame < sheet.textures.length ? frame : 0;
    const f = sheet.atlas.frames[idx]!;
    const spr = v.spr!;
    const ox = f.trimX - sheet.atlas.origin.x;
    const place = (p: PixiSprite, tex: Texture | null, oy: number): void => {
      p.visible = tex !== null;
      if (!tex) return;
      p.texture = tex;
      p.scale.x = flip ? -1 : 1;
      p.position.set(flip ? -ox : ox, oy);
    };
    if (sheet.fade && v.spr2) {
      const topH = sheet.fade.top[idx]?.frame.height ?? 0;
      place(v.spr2, sheet.fade.top[idx] ?? null, f.trimY - sheet.atlas.origin.y);
      place(spr, sheet.fade.bottom[idx] ?? null, f.trimY - sheet.atlas.origin.y + topH);
    } else place(spr, sheet.textures[idx]!, f.trimY - sheet.atlas.origin.y);
  }

  /** Geometry is relative to the feet point (the entity's grid position at its height). */
  private drawSprite(g: Graphics, s: Sprite): void {
    const pt = (dx: number, dy: number, dh: number): [number, number] => {
      const p = relToScreen(dx, dy, dh, this.iso);
      return [p.x, p.y];
    };
    const hx = s.w / 2;
    const hy = s.d / 2;
    // soft contact shadow
    if (!s.noShadow) g.ellipse(0, 0, Math.max(6, s.w * this.iso.tileW * 0.3), Math.max(3, s.d * this.iso.tileH * 0.3)).fill({ color: 0x000000, alpha: 0.28 });
    const at: Record<Corner, [number, number]> = { n: [-hx, -hy], e: [hx, -hy], s: [hx, hy], w: [-hx, hy] };
    if (s.shape === 'diamond') {
      const [nx, ny] = pt(-hx, -hy, s.height);
      const [ex, ey] = pt(hx, -hy, s.height);
      const [sx, sy] = pt(hx, hy, s.height);
      const [wx, wy] = pt(-hx, hy, s.height);
      g.poly([nx, ny, ex, ey, sx, sy, wx, wy]).fill(s.color);
      return;
    }
    // box: top, and the two sides that face the camera in this view
    const sides = this.visibleSides();
    const side = (corners: [Corner, Corner], fill: number): void => {
      const [a, b] = corners;
      const A = pt(at[a][0], at[a][1], s.height);
      const B = pt(at[b][0], at[b][1], s.height);
      const Ab = pt(at[a][0], at[a][1], 0);
      const Bb = pt(at[b][0], at[b][1], 0);
      g.poly([A[0], A[1], B[0], B[1], Bb[0], Bb[1], Ab[0], Ab[1]]).fill(fill);
    };
    side(sides.left, shade(s.color, 0.7));
    side(sides.right, shade(s.color, 0.5));
    g.poly([...pt(-hx, -hy, s.height), ...pt(hx, -hy, s.height), ...pt(hx, hy, s.height), ...pt(-hx, hy, s.height)]).fill(s.color);
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
    this.ready = false;
  }
}
