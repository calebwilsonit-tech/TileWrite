import { isPlayerRequired } from '../model/validate';
import { Graphics } from 'pixi.js';
import {
  C,
  DomInputSource,
  GameRunner,
  IsoRenderer,
  Simulation,
  World,
  boxAt,
  gridToScreen,
  screenRect,
  screenToGrid,
  tilesetFromList,
  type Cell,
  type TileSet,
  type TransformIso,
} from '@tilewright/runtime';
import { parsePoints } from '@tilewright/behaviors';
import { objectLayerOf, type ObjectLayer } from '../model/layers';
import { crashReport } from '@tilewright/runtime';
import type { EditorDoc, DocEvent } from '../model/doc';
import { store, type ToolId } from '../app/store';
import { studio } from '../studio/store';
import { TOOLS, toolMeta, type Pointer, type Preview, type ToolEnv } from '../tools/tools';
import { PREFABS, prefabById } from '../tools/prefabs';
import type { P } from '../tools/algorithms';
import { OverlayDrawer, cellTopHeight } from './overlay';
import { PlaySession } from './play-session';
import { shapesOf } from './debug-draw';

interface SpriteLike {
  shape: 'box' | 'diamond';
  color: number;
  w: number;
  d: number;
  height: number;
  sortOffset: number;
  visible: boolean;
}

interface PlayState {
  sim: Simulation;
  runner: GameRunner;
  source: DomInputSource;
  session: PlaySession;
  saved: { x: number; y: number; zoom: number; dzw: number; dzh: number; smoothing: number };
  stepToken: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

/**
 * Owns the viewport: the renderer, the editing camera, mouse handling, overlays and play-in-editor.
 * React only mounts it and forwards keys; everything visual lives here so it stays testable and fast.
 */
export class ViewportController {
  readonly renderer = new IsoRenderer({ antialias: true });
  doc: EditorDoc | null = null;
  hoverCell: P | null = null;

  private host!: HTMLElement;
  private overlay!: OverlayDrawer;
  private ghostG = new Graphics();
  private editWorld = new World();
  private docIdOf = new Map<number, string>();
  /** Which layer each drawn object is on (Objects, Decoration, Lights). */
  private layerOf = new Map<number, ObjectLayer>();
  private previews: Preview[] = [];
  private walk: Set<string> | null = null;
  private marqueeEl!: HTMLDivElement;
  private unsubDoc: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;
  private dirty = true;
  private raf = 0;
  private spaceDown = false;
  private panning: { x: number; y: number } | null = null;
  private pointerDown = false;
  private activeTool: ToolId | null = null;
  private play: PlayState | null = null;
  private lastStore = { tool: '', mode: '', paused: false, stepToken: 0, hot: 0, focus: 0 };
  private disposed = false;
  private reacting = false;
  private unsubStudio: (() => void) | null = null;
  private registeredSprites = new Map<string, unknown>();
  private tileset: TileSet | undefined;
  private readonly cleanup: (() => void)[] = [];

  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    await this.renderer.init(host);
    if (this.disposed) {
      this.renderer.destroy();
      return;
    }
    this.renderer.camera.zoom = 1;
    this.overlay = new OverlayDrawer(this.renderer.overlay);
    this.renderer.overlay.addChild(this.ghostG);

    this.marqueeEl = document.createElement('div');
    Object.assign(this.marqueeEl.style, { position: 'absolute', border: '1px dashed #6aa8ff', background: 'rgba(106,168,255,0.12)', display: 'none', pointerEvents: 'none' });
    host.appendChild(this.marqueeEl);

    const c = this.renderer.canvas;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(ev, fn as EventListener));
    };
    on(c, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    on(c, 'pointermove', (e: PointerEvent) => this.onMove(e));
    on(window, 'pointerup', (e: PointerEvent) => this.onUp(e));
    on(c, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(c, 'contextmenu', (e: Event) => e.preventDefault());
    on(c, 'pointerleave', () => {
      this.hoverCell = null;
      if (!this.pointerDown) this.setPreviews([]);
      this.dirty = true;
    });
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) this.spaceDown = true;
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0) {
        this.renderer.resize(w, h);
        this.dirty = true;
      }
    });
    ro.observe(host);
    this.cleanup.push(() => ro.disconnect());

    this.unsubStore = store.subscribe(() => this.onStore());
    this.unsubStudio = studio.subscribe(() => this.syncSprites());
    this.syncSprites();
    this.lastStore = this.snapshotStore();
    const loop = (): void => {
      if (this.disposed) return;
      if (!this.play && this.dirty) {
        this.dirty = false;
        this.redraw();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    if (store.doc) this.setDoc(store.doc);
  }

  get camera() {
    return this.renderer.camera;
  }

  get playing(): boolean {
    return this.play !== null;
  }

  /** The running play session, for tests and the debugger. */
  get session(): PlayState | null {
    return this.play;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.stopPlay();
    this.unsubDoc?.();
    this.unsubStore?.();
    this.unsubStudio?.();
    for (const c of this.cleanup) c();
    this.marqueeEl?.remove();
    try {
      this.renderer.destroy();
    } catch {
      /* renderer may not have finished initialising */
    }
  }

  /** Make the project's saved sprites available to the renderer (and refresh ones that were just saved). */
  private syncSprites(): void {
    for (const [name, data] of studio.assets) {
      if (this.registeredSprites.get(name) === data) continue;
      try {
        this.renderer.registerSprite(data);
        this.registeredSprites.set(name, data);
      } catch (e) {
        store.notify('error', `Sprite "${name}" could not be shown: ${(e as Error).message}`);
        this.registeredSprites.set(name, data);
      }
    }
    for (const name of [...this.registeredSprites.keys()]) {
      if (!studio.assets.has(name)) {
        this.renderer.unregisterSprite(name);
        this.registeredSprites.delete(name);
      }
    }
    this.dirty = true;
  }

  // ---- document ----

  setDoc(doc: EditorDoc): void {
    this.unsubDoc?.();
    this.doc = doc;
    this.unsubDoc = doc.subscribe((e) => this.onDocEvent(e));
    this.renderer.setTileMap(doc.map, this.tilesetFor());
    this.syncEntities();
    this.frameMap();
    this.dirty = true;
  }

  private tilesetFor(): TileSet | undefined {
    const p = store.state.project?.project.tileset;
    return (p && tilesetFromList(p)) ?? this.tileset;
  }

  private onDocEvent(e: DocEvent): void {
    if (e.type === 'cells') this.renderer.updateCells(e.cells);
    else if (e.type === 'tiles' && this.doc) this.renderer.setTileMap(this.doc.map, this.tilesetFor());
    else if (e.type === 'wires') this.dirty = true;
    else if (e.type === 'map' && this.doc) {
      this.renderer.setTileMap(this.doc.map, this.tilesetFor());
      this.frameMap();
    } else if (e.type === 'entities') this.syncEntities();
    this.dirty = true;
  }

  /** Rebuild the lightweight world used to draw entities while editing. */
  private syncEntities(): void {
    const doc = this.doc;
    this.editWorld.clear();
    this.docIdOf.clear();
    this.layerOf.clear();
    if (!doc) return;
    for (const e of doc.entities) {
      const t = e.components.transform as TransformIso | undefined;
      const s = e.components.sprite as SpriteLike | undefined;
      if (!t || !s) continue;
      const ent = this.editWorld.spawn({ name: e.name, components: { [C.Transform]: { ...t }, [C.Sprite]: { ...s } } });
      this.docIdOf.set(ent.id, e.id);
      this.layerOf.set(ent.id, objectLayerOf(e));
    }
  }

  /** Centre the camera on the middle of the map. */
  frameMap(): void {
    const m = this.doc?.map;
    if (!m) return;
    const c = gridToScreen(m.width / 2, m.height / 2, 0);
    this.camera.snapTo(c);
    const needW = (m.width + m.height) * 32 + 160;
    const needH = (m.width + m.height) * 16 + 200;
    this.camera.zoom = Math.max(MIN_ZOOM, Math.min(1, this.camera.viewW / needW, this.camera.viewH / needH));
    this.dirty = true;
  }

  /** Page coordinates (for real mouse events) of the middle of a cell's top face. Used by end-to-end tests. */
  cellToClient(cx: number, cy: number): { x: number; y: number } {
    const map = this.doc?.map;
    const h = map && map.inBounds(cx, cy) ? cellTopHeight(map, cx, cy) : 0;
    const v = this.camera.worldToView(gridToScreen(cx + 0.5, cy + 0.5, h, this.renderer.iso));
    const rect = this.renderer.canvas.getBoundingClientRect();
    return { x: rect.left + v.x, y: rect.top + v.y };
  }

  /** Page coordinates of the middle of an object (for real mouse events in end-to-end tests). */
  entityToClient(id: string): { x: number; y: number } | null {
    const e = this.doc?.getEntity(id);
    const t = e?.components.transform as TransformIso | undefined;
    const s = e?.components.sprite as SpriteLike | undefined;
    if (!t) return null;
    const v = this.camera.worldToView(gridToScreen(t.x, t.y, t.h + (s?.height ?? 1) / 2, this.renderer.iso));
    const rect = this.renderer.canvas.getBoundingClientRect();
    return { x: rect.left + v.x, y: rect.top + v.y };
  }

  focusCell(x: number, y: number): void {
    const h = this.doc?.map.inBounds(Math.floor(x), Math.floor(y)) ? cellTopHeight(this.doc.map, Math.floor(x), Math.floor(y)) : 0;
    this.camera.snapTo(gridToScreen(x, y, h));
    this.dirty = true;
  }

  requestRedraw(): void {
    this.dirty = true;
  }

  /** The viewport as a PNG (base64, no prefix), as the user sees it now. Null if it cannot be captured. */
  async screenshot(): Promise<string | null> {
    try {
      const app = this.renderer.app;
      const url = await app.renderer.extract.base64(app.stage);
      const i = url.indexOf('base64,');
      return i >= 0 ? url.slice(i + 7) : null;
    } catch {
      return null;
    }
  }

  // ---- store changes ----

  private snapshotStore() {
    const s = store.state;
    return { tool: s.tool, mode: s.mode, paused: s.paused, stepToken: store.stepToken, hot: store.hotToken, focus: store.focusRequest?.token ?? 0 };
  }

  /**
   * React to store changes. Our own reactions can change the store again (a failed Play calls Stop and
   * shows a message), so changes made while we are busy are picked up by looping, not by re-entering.
   */
  private onStore(): void {
    if (this.reacting) return;
    this.reacting = true;
    try {
      for (let pass = 0; pass < 5; pass++) {
        const s = store.state;
        const last = this.lastStore;
        this.lastStore = this.snapshotStore(); // remember first, so nested notifications cannot repeat the work
        if (store.doc && store.doc !== this.doc) this.setDoc(store.doc);
        if (s.tool !== last.tool) {
          this.cancelGesture();
          this.setPreviews([]);
        }
        if (s.mode !== last.mode) {
          if (s.mode === 'play') this.startPlay();
          else this.stopPlay();
        }
        if (this.play) {
          this.play.runner.paused = s.paused;
          if (store.stepToken !== this.play.stepToken) {
            this.play.stepToken = store.stepToken;
            this.play.runner.step();
          }
        }
        if (store.hotToken !== last.hot && this.play) store.notify('info', this.play.session.hotReload());
        if ((store.focusRequest?.token ?? 0) !== last.focus && store.focusRequest) this.focusCell(store.focusRequest.x, store.focusRequest.y);
        this.applyLayerView();
        this.dirty = true;
        const now = this.snapshotStore();
        const settled = now.tool === this.lastStore.tool && now.mode === this.lastStore.mode && now.paused === this.lastStore.paused && now.stepToken === this.lastStore.stepToken && now.hot === this.lastStore.hot;
        if (settled) break;
      }
    } finally {
      this.reacting = false;
    }
  }

  /** Show or hide ground, walls and the kinds of object, as the Layers panel says. */
  private applyLayerView(): void {
    const v = store.state.view;
    this.renderer.setGroundVisible(v.ground);
    this.renderer.setWallsVisible(v.walls);
    this.renderer.entitiesVisible = v.objects;
    this.renderer.entityHidden = this.play ? null : (e) => {
      const k = this.layerOf.get(e.id);
      return (k === 'decoration' && !store.state.view.decoration) || (k === 'lights' && !store.state.view.lightsLayer);
    };
  }

  /** Whether a placed object can be picked right now: its layer must be visible and unlocked. */
  private objectUsable(e: { tags: string[]; components: Record<string, unknown> }): boolean {
    const k = objectLayerOf(e);
    const { view, locks } = store.state;
    if (k === 'decoration') return view.decoration && !locks.decoration;
    if (k === 'lights') return view.lightsLayer && !locks.lightsLayer;
    return true;
  }

  // ---- drawing ----

  private redraw(): void {
    const doc = this.doc;
    if (!doc) return;
    const s = store.state;
    const cam = this.camera;
    const tl = cam.viewToWorld({ x: 0, y: 0 });
    const br = cam.viewToWorld({ x: cam.viewW, y: cam.viewH });
    this.overlay.draw({
      map: doc.map,
      iso: this.renderer.iso,
      grid: s.view.grid,
      collision: s.view.collision || !!toolMeta(s.tool).showsCollision,
      collisionLevel: s.view.collisionLevel,
      heightLabels: s.view.heightLabels,
      regions: { list: doc.regions, visible: s.view.regions, selected: s.selectedRegion },
      walk: this.walk,
      wires: this.wirePoints(),
      ...this.aiGizmos(),
      previews: this.previews,
      zoom: cam.zoom,
      visible: { minX: tl.x - 40, minY: tl.y - 40, maxX: br.x + 40, maxY: br.y + 40 },
    });
    const boxes = doc.entities
      .filter((e) => s.selection.includes(e.id))
      .map((e) => {
        const t = e.components.transform as TransformIso | undefined;
        const sp = e.components.sprite as SpriteLike | undefined;
        return t ? { x: t.x, y: t.y, h: t.h, w: sp?.w ?? 0.6, d: sp?.d ?? 0.6, height: sp?.height ?? 1 } : null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
    this.overlay.outline(boxes, this.renderer.iso);

    this.ghostG.clear();
    for (const pv of this.previews) {
      if (pv.kind === 'ghost') {
        const prefab = prefabById(pv.prefab, store.prefabs);
        const data = prefab.make(pv.x, pv.y, pv.h);
        const sp = data.components.sprite as SpriteLike | undefined;
        if (sp) this.overlay.ghost(this.ghostG, pv.x, pv.y, pv.h, sp.w, sp.d, sp.height, sp.color, this.renderer.iso);
      }
    }
    this.renderer.focus = undefined;
    this.renderer.render(this.editWorld);
  }

  /** Where wires attach to an object: its position, a little above the floor so lines clear the shape. */
  private anchorOf(id: string): { x: number; y: number; h: number } | null {
    const e = this.doc?.getEntity(id);
    const t = e?.components.transform as TransformIso | undefined;
    const s = e?.components.sprite as SpriteLike | undefined;
    if (!t) return null;
    return { x: t.x, y: t.y, h: t.h + Math.min(1, (s?.height ?? 0.5) / 2) };
  }

  private wirePoints(): { a: { x: number; y: number; h: number }; b: { x: number; y: number; h: number }; hot: boolean }[] {
    const doc = this.doc;
    if (!doc) return [];
    const sel = store.state.selection;
    const out: { a: { x: number; y: number; h: number }; b: { x: number; y: number; h: number }; hot: boolean }[] = [];
    for (const w of doc.wires) {
      const a = this.anchorOf(w.from.entity);
      const b = this.anchorOf(w.to.entity);
      if (a && b) out.push({ a, b, hot: sel.includes(w.from.entity) || sel.includes(w.to.entity) });
    }
    return out;
  }
  /** Debug shapes for the overlay: patrol routes and view cones, trigger areas and solid things, light reach. */
  private aiGizmos(): Pick<Parameters<OverlayDrawer['draw']>[0], 'paths' | 'cones' | 'footprints' | 'lights'> {
    const doc = this.doc;
    const out: Pick<Parameters<OverlayDrawer['draw']>[0], 'paths' | 'cones' | 'footprints' | 'lights'> = { paths: [], cones: [], footprints: [], lights: [] };
    if (!doc) return out;
    const sel = store.state.selection;
    const view = store.state.view;
    for (const e of doc.entities) {
      const t = e.components.transform as TransformIso | undefined;
      if (!t) continue;
      const hot = sel.includes(e.id);
      const shapes = shapesOf(e.components);
      if (view.ai) {
        const pat = e.components.patrol as { points?: string; mode?: string } | undefined;
        if (pat) {
          const pts = parsePoints(pat.points ?? '').map((p) => ({ x: p.x, y: p.y, h: t.h + 0.05 }));
          if (pts.length > 0) out.paths.push({ points: pts, loop: pat.mode !== 'pingpong', hot });
        }
        if (shapes.cone) out.cones.push({ ...shapes.cone, hot });
      }
      if (view.triggers && shapes.footprint) out.footprints.push(shapes.footprint);
      if (view.lights && shapes.light) out.lights.push(shapes.light);
    }
    return out;
  }
  private setPreviews(p: Preview[]): void {
    this.previews = p;
    this.dirty = true;
  }

  // ---- picking ----

  /** The cell under a screen point, taking raised ground into account (the nearest visible surface). */
  pickCell(sx: number, sy: number): Cell {
    const map = this.doc?.map;
    const w = this.camera.viewToWorld({ x: sx, y: sy });
    if (map) {
      for (let h = 12; h >= 0; h--) {
        const g = screenToGrid(w.x, w.y, h, this.renderer.iso);
        const cx = Math.floor(g.x);
        const cy = Math.floor(g.y);
        if (!map.inBounds(cx, cy) || map.getTile(cx, cy) === 0) continue;
        if (cellTopHeight(map, cx, cy) >= h) return { x: cx, y: cy };
      }
    }
    const g = screenToGrid(w.x, w.y, 0, this.renderer.iso);
    return { x: Math.floor(g.x), y: Math.floor(g.y) };
  }

  private entityScreenRect(t: TransformIso, s: SpriteLike) {
    return screenRect(boxAt(0, t.x, t.y, t.h, s.w, s.d, s.height), this.renderer.iso);
  }

  pickEntity(screen: { x: number; y: number }): string | null {
    const doc = this.doc;
    if (!doc || store.state.locks.objects || !store.state.view.objects) return null;
    const w = this.camera.viewToWorld(screen);
    let best: { id: string; key: number } | null = null;
    for (const e of doc.entities) {
      const t = e.components.transform as TransformIso | undefined;
      const s = e.components.sprite as SpriteLike | undefined;
      if (!t || !s || !this.objectUsable(e)) continue;
      const r = this.entityScreenRect(t, s);
      if (w.x < r.left - 4 || w.x > r.right + 4 || w.y < r.top - 4 || w.y > r.bottom + 4) continue;
      const key = t.x + t.y + t.h * 0.01;
      if (!best || key > best.key) best = { id: e.id, key };
    }
    return best?.id ?? null;
  }

  private entitiesInRect(r: { x0: number; y0: number; x1: number; y1: number }): string[] {
    const doc = this.doc;
    if (!doc || store.state.locks.objects) return [];
    const x0 = Math.min(r.x0, r.x1);
    const x1 = Math.max(r.x0, r.x1);
    const y0 = Math.min(r.y0, r.y1);
    const y1 = Math.max(r.y0, r.y1);
    const out: string[] = [];
    for (const e of doc.entities) {
      const t = e.components.transform as TransformIso | undefined;
      if (!t || !this.objectUsable(e)) continue;
      const v = this.camera.worldToView(gridToScreen(t.x, t.y, t.h, this.renderer.iso));
      if (v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1) out.push(e.id);
    }
    return out;
  }

  private pickRegion(cell: P): string | null {
    const doc = this.doc;
    if (!doc || store.state.locks.regions) return null;
    const hits = doc.regions.filter((r) => cell.x >= r.x && cell.x < r.x + r.w && cell.y >= r.y && cell.y < r.y + r.h);
    hits.sort((a, b) => a.w * a.h - b.w * b.h);
    return hits[0]?.id ?? null;
  }

  // ---- tool environment ----

  private env(): ToolEnv {
    const doc = this.doc!;
    const s = store.state;
    return {
      doc,
      opts: s.options,
      selection: s.selection,
      setPreview: (p) => this.setPreviews(p),
      select: (ids, region = null) => store.set({ selection: ids, selectedRegion: region }),
      notify: (kind, text) => store.notify(kind, text),
      setWalk: (cells) => {
        this.walk = cells;
        this.dirty = true;
      },
      setMarquee: (r) => this.showMarquee(r),
      pickEntity: (sc) => this.pickEntity(sc),
      pickRegion: (c) => this.pickRegion(c),
      prefabs: store.prefabs,
      connect: (from, to) => store.set({ connect: { from, to } }),
      entityAnchor: (id) => this.anchorOf(id),
      entitiesInRect: (r) => this.entitiesInRect(r),
      worldAt: (sc, h) => {
        const w = this.camera.viewToWorld(sc);
        return screenToGrid(w.x, w.y, h, this.renderer.iso);
      },
    };
  }

  private showMarquee(r: { x0: number; y0: number; x1: number; y1: number } | null): void {
    const el = this.marqueeEl;
    if (!r) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${Math.min(r.x0, r.x1)}px`;
    el.style.top = `${Math.min(r.y0, r.y1)}px`;
    el.style.width = `${Math.abs(r.x1 - r.x0)}px`;
    el.style.height = `${Math.abs(r.y1 - r.y0)}px`;
  }

  private pointer(e: PointerEvent): Pointer {
    const rect = this.renderer.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const cell = this.pickCell(screen.x, screen.y);
    return { cell, screen, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
  }

  // ---- mouse ----

  private onDown(e: PointerEvent): void {
    if (this.play || !this.doc) return;
    this.renderer.canvas.setPointerCapture?.(e.pointerId);
    const panButton = e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown);
    if (panButton) {
      this.panning = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    const meta = toolMeta(store.state.tool);
    const locks = store.state.locks;
    if ((meta.edits === 'ground' && locks.ground) || (meta.edits === 'objects' && locks.objects) || (meta.edits === 'regions' && locks.regions)) {
      store.notify('warn', `The ${meta.edits} layer is locked. Unlock it in the Layers panel to use ${meta.label}.`);
      return;
    }
    if (meta.edits === 'objects' && (store.state.tool === 'place' || store.state.tool === 'props')) {
      const prefab = PREFABS.find((x) => x.id === store.state.options.prefab);
      const kind = prefab ? objectLayerOf(prefab.make(0, 0, 0)) : 'objects';
      if ((kind === 'decoration' && locks.decoration) || (kind === 'lights' && locks.lightsLayer)) {
        store.notify('warn', `The ${kind === 'lights' ? 'lights' : 'decoration'} layer is locked. Unlock it in the Layers panel to place this.`);
        return;
      }
    }
    const p = this.pointer(e);
    this.pointerDown = true;
    this.activeTool = store.state.tool;
    TOOLS[store.state.tool].down(p, this.env());
    this.dirty = true;
  }

  private onMove(e: PointerEvent): void {
    if (this.play || !this.doc) return;
    if (this.panning) {
      const dx = e.clientX - this.panning.x;
      const dy = e.clientY - this.panning.y;
      this.panning = { x: e.clientX, y: e.clientY };
      this.camera.x -= dx / this.camera.zoom;
      this.camera.y -= dy / this.camera.zoom;
      this.dirty = true;
      return;
    }
    const p = this.pointer(e);
    this.hoverCell = p.cell;
    const tool = TOOLS[store.state.tool];
    if (this.pointerDown && this.activeTool === store.state.tool) tool.move(p, this.env());
    else tool.hover(p, this.env());
    store.set({ docVersion: store.state.docVersion }); // lets the status bar show the hover cell
    this.dirty = true;
  }

  private onUp(e: PointerEvent): void {
    if (this.panning) {
      this.panning = null;
      return;
    }
    if (this.play || !this.doc || !this.pointerDown) return;
    this.pointerDown = false;
    if (this.activeTool === store.state.tool) TOOLS[store.state.tool].up(this.pointer(e), this.env());
    this.activeTool = null;
    this.dirty = true;
  }

  private onWheel(e: WheelEvent): void {
    if (this.play) return;
    e.preventDefault();
    const rect = this.renderer.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = this.camera.viewToWorld({ x: sx, y: sy });
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.camera.zoom * factor));
    const after = this.camera.viewToWorld({ x: sx, y: sy });
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.dirty = true;
  }

  zoomBy(f: number): void {
    this.camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.camera.zoom * f));
    this.dirty = true;
  }

  cancelGesture(): void {
    if (this.pointerDown && this.activeTool && this.doc) {
      TOOLS[this.activeTool].cancel(this.env());
    }
    this.pointerDown = false;
    this.activeTool = null;
    this.showMarquee(null);
  }

  /** Keys the active tool wants (R to rotate, Esc to clear a pattern...). Returns true if it used the key. */
  toolKey(key: string): boolean {
    if (!this.doc || this.play) return false;
    const handled = TOOLS[store.state.tool].key?.(key, this.env()) ?? false;
    if (key.toLowerCase() === 'r' && (store.state.tool === 'stairs' || store.state.tool === 'ramp')) {
      const order = [1, 2, 3, 4] as const;
      const cur = store.state.options.slopeDir;
      store.setOptions({ slopeDir: order[(order.indexOf(cur as 1 | 2 | 3 | 4) + 1) % 4]! });
      return true;
    }
    if (key === 'Escape' && this.pointerDown) {
      this.cancelGesture();
      return true;
    }
    if (handled) this.dirty = true;
    return handled;
  }

  // ---- play in editor ----

  private startPlay(): void {
    const doc = this.doc;
    if (!doc || this.play) return;
    const scene = doc.toScene();
    const playerData = scene.entities.find((e) => e.tags.includes('player'));
    if (isPlayerRequired() && (!playerData || !playerData.components.transform)) {
      store.notify('error', 'This scene has no player start, so there is nothing to play. Use the Place tool to add a Player start, then press Play again.');
      store.stop();
      return;
    }
    const project = store.state.project;
    const cam = this.camera;
    const saved = { x: cam.x, y: cam.y, zoom: cam.zoom, dzw: cam.deadzoneW, dzh: cam.deadzoneH, smoothing: cam.smoothing };
    const autoPlay = store.autoPlay;
    store.autoPlay = null;
    const record = store.recordNext;
    store.recordNext = false;
    store.setRuntimeError(null);
    const from = store.playFrom;
    store.playFrom = null;
    let session: PlaySession;
    try {
      session = new PlaySession({
        renderer: this.renderer,
        uiParent: this.host.parentElement ?? this.host,
        scene,
        scenePath: store.state.scenePath ?? '',
        projectDir: project?.dir ?? '',
        from,
        prefabs: store.prefabs,
        sprites: studio.assets,
        story: store.story,
        tileset: () => this.tilesetFor(),
        currentScene: (path) => (path === store.state.scenePath && this.doc ? this.doc.toScene() : null),
        notify: (kind, text) => store.notify(kind, text),
        onError: (error) => {
          const report = crashReport(session.sim, error);
          store.notify('error', report.headline);
          store.setRuntimeError(report);
          store.set({ paused: true });
        },
        quit: () => store.stop(),
        autoPlay,
        ...(project?.project.title?.enabled ? { title: { text: project.project.name, subtitle: project.project.title.subtitle } } : {}),
        flags: () => store.state.view,
        record,
        skins: store.skins,
        minigames: store.minigames,
        worldMap: store.worldMap,
        layout: store.uiLayout,
        input: store.input,
        mixer: studio.mixerSource,
        liveAssets: () => ({ prefabs: store.prefabs, sprites: studio.assets, story: store.story, skins: store.skins, minigames: store.minigames, worldMap: store.worldMap, layout: store.uiLayout, input: store.input }),
      });
    } catch (e) {
      store.notify('error', `The game could not start: ${e instanceof Error ? e.message : String(e)}`);
      store.stop();
      return;
    }
    const { sim, runner, source } = session;
    this.play = { sim, runner, source, session, saved, stepToken: store.stepToken };
    window.__play = this.play;
  }

  private stopPlay(): void {
    const p = this.play;
    if (!p) return;
    const recording = p.session.recording();
    const near = p.session.sim.world.withTag('goal')[0] ?? p.session.sim.world.withTag('exit')[0];
    const me = p.session.sim.world.withTag('player')[0]?.get<TransformIso>('transform');
    const nt = near?.get<TransformIso>('transform');
    const endNear = near && me && nt && Math.hypot(nt.x - me.x, nt.y - me.y) <= 2 ? (near.tags.has('goal') ? 'tag:goal' : 'tag:exit') : null;
    p.session.dispose();
    if (recording && recording.length > 30) void store.saveRecording(recording, store.state.scenePath ?? '', endNear);
    this.play = null;
    window.__play = undefined;
    const cam = this.camera;
    cam.bounds = null;
    cam.x = p.saved.x;
    cam.y = p.saved.y;
    cam.zoom = p.saved.zoom;
    cam.deadzoneW = p.saved.dzw;
    cam.deadzoneH = p.saved.dzh;
    cam.smoothing = p.saved.smoothing;
    this.renderer.focus = undefined;
    this.renderer.lighting = null;
    this.renderer.overlay.visible = true;
    if (this.doc) {
      this.renderer.setTileMap(this.doc.map, this.tilesetFor());
      this.applyLayerView();
    }
    this.dirty = true;
  }
  /** Which cell the mouse is over, for "Play from here". */
  get playFromHere(): { x: number; y: number } | null {
    return this.hoverCell ? { x: this.hoverCell.x + 0.5, y: this.hoverCell.y + 0.5 } : null;
  }
}

declare global {
  interface Window {
    __play?: PlayState;
    __viewport?: ViewportController;
  }
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
