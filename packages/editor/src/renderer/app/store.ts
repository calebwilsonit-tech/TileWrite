import { useSyncExternalStore } from 'react';
import { SLOPE, extractPrefab, resolveInstance, type EntityData, type PrefabData, type SlopeDir } from '@tilewright/runtime';
import { EditorDoc } from '../model/doc';
import { api } from '../project/api';
import { assetFs } from '../project/assetFs';
import { deletePrefab, loadAllPrefabs, prefabNameProblem, savePrefab } from '../project/prefabs';
import {
  UserError,
  autosaveScene,
  clearAutosave,
  createProject,
  loadScene,
  openProject,
  readAutosave,
  saveProject,
  saveScene,
  scenePathFor,
  type OpenProject,
  type ProjectFs,
} from '../project/io';
import { newScene } from '@tilewright/runtime';

export type ToolId =
  | 'select'
  | 'paint'
  | 'rect'
  | 'line'
  | 'fill'
  | 'eraser'
  | 'scatter'
  | 'stamp'
  | 'raise'
  | 'lower'
  | 'setheight'
  | 'smooth'
  | 'stairs'
  | 'ramp'
  | 'cliff'
  | 'pit'
  | 'water'
  | 'bridge'
  | 'block'
  | 'oneway'
  | 'walktest'
  | 'place'
  | 'region'
  | 'room'
  | 'corridor'
  | 'props'
  | 'wire'
  | 'patrol';

export interface ToolOptions {
  tile: number;
  size: number;
  height: number;
  density: number;
  slopeDir: SlopeDir;
  bridgeLevel: number;
  prefab: string;
  outline: boolean;
  edge: number;
}

export interface ViewOptions {
  grid: boolean;
  collision: boolean;
  heightLabels: boolean;
  ground: boolean;
  objects: boolean;
  regions: boolean;
}

export type Mode = 'edit' | 'play';
export type Workspace = 'world' | 'sprites';

export interface Notice {
  id: number;
  kind: 'info' | 'warn' | 'error';
  text: string;
}

export interface AppState {
  screen: 'projects' | 'editor';
  /** Which editor is showing: the world, or the sprite studio. */
  workspace: Workspace;
  project: OpenProject | null;
  scenePath: string | null;
  tool: ToolId;
  options: ToolOptions;
  view: ViewOptions;
  locks: { ground: boolean; objects: boolean; regions: boolean };
  selection: string[];
  selectedRegion: string | null;
  mode: Mode;
  paused: boolean;
  theme: 'dark' | 'light';
  notices: Notice[];
  log: { time: number; kind: Notice['kind']; text: string }[];
  recent: { dir: string; name: string; opened: number }[];
  busy: boolean;
  /** Names of the project's prefabs. */
  prefabNames: string[];
  /** Set while the wire dialog is open (two objects were just connected). */
  connect: { from: string; to: string } | null;
  testMode: boolean;
  /** Bumped whenever the document changes, so React panels re-render. */
  docVersion: number;
  /** Set when a crash left unsaved work behind. */
  recovery: { scene: ReturnType<EditorDoc['toScene']> } | null;
}

const initial: AppState = {
  screen: 'projects',
  workspace: 'world',
  project: null,
  scenePath: null,
  tool: 'select',
  options: {
    tile: 1,
    size: 1,
    height: 1,
    density: 0.3,
    slopeDir: SLOPE.E,
    bridgeLevel: 1,
    prefab: 'crate',
    outline: false,
    edge: 1,
  },
  view: { grid: true, collision: false, heightLabels: false, ground: true, objects: true, regions: true },
  locks: { ground: false, objects: false, regions: false },
  selection: [],
  selectedRegion: null,
  mode: 'edit',
  paused: false,
  theme: 'dark',
  notices: [],
  log: [],
  recent: [],
  busy: false,
  prefabNames: [],
  connect: null,
  testMode: false,
  docVersion: 0,
  recovery: null,
};

export const realFs: ProjectFs = {
  read: (f) => api().fs.read(f),
  write: (f, t) => api().fs.write(f, t),
  exists: (f) => api().fs.exists(f),
  remove: (f) => api().fs.remove(f),
};

type Listener = () => void;

/**
 * App-wide state. Panels read it with `useApp`, tools and commands change it with `set`.
 * The open document (`doc`) lives beside it because it has its own change events and history.
 */
class AppStore {
  state: AppState = initial;
  doc: EditorDoc | null = null;
  clipboard: EntityData[] = [];
  /** The project's prefabs (reusable objects). */
  prefabs = new Map<string, PrefabData>();
  /** Where the camera should look next (set by "go to" links in the Problems panel). */
  focusRequest: { x: number; y: number; token: number } | null = null;
  /** "Play from here" start position. */
  playFrom: { x: number; y: number } | null = null;
  /** Bumped to ask the viewport to step one frame while paused. */
  stepToken = 0;
  private listeners = new Set<Listener>();
  private unsubDoc: (() => void) | null = null;
  private autosaveTimer: number | undefined;
  private noticeId = 1;
  private docTick: number | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): AppState => this.state;

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  setOptions(patch: Partial<ToolOptions>): void {
    this.set({ options: { ...this.state.options, ...patch } });
  }

  setView(patch: Partial<ViewOptions>): void {
    this.set({ view: { ...this.state.view, ...patch } });
  }

  notify(kind: Notice['kind'], text: string): void {
    const n: Notice = { id: this.noticeId++, kind, text };
    this.set({ notices: [...this.state.notices, n].slice(-4), log: [...this.state.log, { time: Date.now(), kind, text }].slice(-300) });
    window.setTimeout(() => this.set({ notices: this.state.notices.filter((x) => x.id !== n.id) }), kind === 'info' ? 3500 : 7000);
  }

  /** Run `fn`, showing a plain-English message instead of crashing if it fails. */
  async guard<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    this.set({ busy: true });
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof UserError ? e.message : `${what} did not work: ${(e as Error).message}`;
      this.notify('error', msg);
      return undefined;
    } finally {
      this.set({ busy: false });
    }
  }

  // ---- startup ----

  async init(): Promise<void> {
    const info = await api().info();
    const settings = await api().settings.get();
    const recent = await api().recent.list();
    this.set({ testMode: info.testMode, recent, theme: settings.theme === 'light' ? 'light' : 'dark' });
    document.documentElement.dataset.theme = this.state.theme;
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.set({ theme });
    document.documentElement.dataset.theme = theme;
    void this.saveSetting('theme', theme);
  }

  async saveSetting(key: string, value: unknown): Promise<void> {
    const cur = await api().settings.get();
    await api().settings.set({ ...cur, [key]: value });
  }

  // ---- projects ----

  async chooseParentFolder(): Promise<string | null> {
    return api().chooseFolder('Choose where to create the project');
  }

  async newProject(name: string, templateId: string): Promise<void> {
    await this.guard('Creating the project', async () => {
      const parent = await this.chooseParentFolder();
      if (!parent) return;
      const created = await createProject(realFs, parent, name, templateId);
      await this.openLoaded(created);
    });
  }

  async openProjectDialog(): Promise<void> {
    await this.guard('Opening the project', async () => {
      const dir = await api().chooseFolder('Open a Tilewright project folder');
      if (!dir) return;
      await this.openLoaded(await openProject(realFs, dir));
    });
  }

  async openRecent(dir: string): Promise<void> {
    await this.guard('Opening the project', async () => {
      await api().recent.allow(dir);
      await this.openLoaded(await openProject(realFs, dir));
    });
  }

  async forgetRecent(dir: string): Promise<void> {
    await api().recent.remove(dir);
    this.set({ recent: await api().recent.list() });
  }

  private async openLoaded(p: OpenProject): Promise<void> {
    await api().recent.add(p.dir, p.project.name);
    this.set({ project: p, workspace: 'world', recent: await api().recent.list() });
    await this.loadPrefabs();
    await this.openScene(p.project.startScene);
    this.set({ screen: 'editor' });
    this.startAutosave();
    const { studio } = await import('../studio/store');
    await studio.loadAssets();
    for (const problem of studio.state.problems) this.notify('warn', problem);
  }

  async openScene(scenePath: string): Promise<void> {
    const p = this.state.project;
    if (!p) return;
    const scene = await loadScene(realFs, p.dir, scenePath);
    const recovered = await readAutosave(realFs, p.dir, scenePath);
    this.attachDoc(EditorDoc.fromScene(scene, this.prefabs), scenePath);
    if (recovered && JSON.stringify(recovered) !== JSON.stringify(scene)) this.set({ recovery: { scene: recovered } });
  }

  /** Replace the open scene with the recovered unsaved work. */
  acceptRecovery(): void {
    const r = this.state.recovery;
    if (!r || !this.state.scenePath) return;
    this.attachDoc(EditorDoc.fromScene(r.scene, this.prefabs), this.state.scenePath);
    if (this.doc) this.doc.dirty = true;
    this.set({ recovery: null, docVersion: this.state.docVersion + 1 });
    this.notify('info', 'Recovered your unsaved changes. Save to keep them.');
  }

  async discardRecovery(): Promise<void> {
    const p = this.state.project;
    if (p && this.state.scenePath) await clearAutosave(realFs, p.dir, this.state.scenePath).catch(() => undefined);
    this.set({ recovery: null });
  }

  private attachDoc(doc: EditorDoc, scenePath: string): void {
    this.unsubDoc?.();
    this.doc = doc;
    this.unsubDoc = doc.subscribe(() => this.bumpDoc());
    this.set({ scenePath, selection: [], selectedRegion: null, mode: 'edit', paused: false, docVersion: this.state.docVersion + 1 });
  }

  /** Coalesce bursts of document events into one React update per frame. */
  private bumpDoc(): void {
    if (this.docTick !== null) return;
    this.docTick = window.requestAnimationFrame(() => {
      this.docTick = null;
      this.set({ docVersion: this.state.docVersion + 1 });
    });
  }

  async save(): Promise<boolean> {
    const p = this.state.project;
    const doc = this.doc;
    if (!p || !doc || !this.state.scenePath) return false;
    const ok = await this.guard('Saving', async () => {
      await saveScene(realFs, p.dir, this.state.scenePath!, doc.toScene());
      doc.markSaved();
      this.bumpDoc();
      return true;
    });
    if (ok) this.notify('info', 'Saved.');
    return ok === true;
  }

  async newSceneInProject(name: string): Promise<void> {
    const p = this.state.project;
    if (!p) return;
    await this.guard('Adding the scene', async () => {
      const path = scenePathFor(name, p.project.scenes);
      const scene = newScene(name.trim() || 'Scene', 32, 32);
      await saveScene(realFs, p.dir, path, scene);
      const project = { ...p.project, scenes: [...p.project.scenes, path] };
      await saveProject(realFs, p.dir, project);
      this.set({ project: { ...p, project } });
      await this.openScene(path);
    });
  }

  async closeProject(): Promise<void> {
    window.clearInterval(this.autosaveTimer);
    this.unsubDoc?.();
    this.doc = null;
    const { studio } = await import('../studio/store');
    if (studio.isDirty()) await studio.save(); // leaving the project never silently drops drawing work
    studio.closeSprite();
    this.set({ screen: 'projects', workspace: 'world', project: null, scenePath: null, selection: [], mode: 'edit', recent: await api().recent.list() });
  }

  private startAutosave(): void {
    window.clearInterval(this.autosaveTimer);
    this.autosaveTimer = window.setInterval(() => {
      void this.autosaveNow();
    }, 20_000);
  }

  async autosaveNow(): Promise<void> {
    const p = this.state.project;
    const doc = this.doc;
    if (!p || !doc || !doc.dirty || !this.state.scenePath) return;
    try {
      await autosaveScene(realFs, p.dir, this.state.scenePath, doc.toScene());
    } catch {
      /* autosave is best effort; a failed one must never interrupt editing */
    }
  }

  // ---- prefabs ----

  async loadPrefabs(): Promise<void> {
    const p = this.state.project;
    if (!p) {
      this.prefabs = new Map();
      this.set({ prefabNames: [] });
      return;
    }
    const { prefabs, problems } = await loadAllPrefabs(assetFs, p.dir);
    this.prefabs = prefabs;
    this.set({ prefabNames: [...prefabs.keys()] });
    for (const problem of problems) this.notify('warn', problem);
  }

  private setPrefabs(next: Map<string, PrefabData>): void {
    this.prefabs = next;
    if (this.doc) this.doc.setPrefabs(next);
    this.set({ prefabNames: [...next.keys()].sort((a, b) => a.localeCompare(b)), docVersion: this.state.docVersion + 1 });
  }

  /** Turn an object in the scene into a prefab (it becomes the first instance). */
  async createPrefab(entityId: string, name: string): Promise<boolean> {
    const p = this.state.project;
    const doc = this.doc;
    const e = doc?.getEntity(entityId);
    if (!p || !doc || !e) return false;
    const problem = prefabNameProblem(name, this.state.prefabNames);
    if (problem) {
      this.notify('warn', problem);
      return false;
    }
    const prefab = extractPrefab(e, name.trim());
    const ok = await this.guard('Making the prefab', async () => {
      await savePrefab(assetFs, p.dir, prefab);
      return true;
    });
    if (!ok) return false;
    this.setPrefabs(new Map(this.prefabs).set(prefab.name, prefab));
    doc.updateEntities([entityId], `Make prefab "${prefab.name}"`, (x) => {
      x.prefab = prefab.name;
    });
    this.notify('info', `Made the prefab "${prefab.name}". Objects made from it follow it, except for settings you change on them.`);
    return true;
  }

  /** Copy this instance's settings back into its prefab, so every instance (that has not overridden them) follows. */
  async applyToPrefab(entityId: string): Promise<void> {
    const p = this.state.project;
    const e = this.doc?.getEntity(entityId);
    const old = e?.prefab ? this.prefabs.get(e.prefab) : undefined;
    if (!p || !e || !old) return;
    const fresh = extractPrefab(e, old.name);
    const next: PrefabData = { ...old, root: { ...old.root, components: fresh.root.components, tags: fresh.root.tags } };
    await this.guard('Updating the prefab', async () => {
      await savePrefab(assetFs, p.dir, next);
      this.setPrefabs(new Map(this.prefabs).set(next.name, next));
    });
    this.notify('info', `Updated the prefab "${next.name}" from this object.`);
  }

  revertInstance(entityId: string): void {
    const doc = this.doc;
    const e = doc?.getEntity(entityId);
    if (!doc || !e?.prefab) return;
    const t = e.components.transform as Record<string, unknown> | undefined;
    const base = resolveInstance({ id: e.id, name: e.name, tags: [], prefab: e.prefab, components: t ? { transform: { x: t.x, y: t.y, h: t.h } } : {} }, this.prefabs);
    if (!base) return;
    doc.updateEntities([entityId], 'Revert to prefab', (x) => {
      x.components = base.components;
      x.tags = base.tags;
    });
  }

  unlinkInstance(entityId: string): void {
    this.doc?.updateEntities([entityId], 'Unlink from prefab', (x) => {
      delete x.prefab;
    });
  }

  async removePrefab(name: string): Promise<void> {
    const p = this.state.project;
    if (!p) return;
    await this.guard('Deleting the prefab', async () => {
      await deletePrefab(assetFs, p.dir, name);
      const next = new Map(this.prefabs);
      next.delete(name);
      this.setPrefabs(next);
    });
  }
  // ---- selection and clipboard ----

  select(ids: string[]): void {
    this.set({ selection: ids, selectedRegion: null });
  }

  focusOn(x: number, y: number): void {
    this.focusRequest = { x, y, token: (this.focusRequest?.token ?? 0) + 1 };
    this.set({ docVersion: this.state.docVersion + 1 });
  }

  // ---- play ----

  play(from?: { x: number; y: number }): void {
    if (!this.doc) return;
    this.playFrom = from ?? null;
    this.set({ mode: 'play', paused: false });
  }

  stop(): void {
    this.set({ mode: 'edit', paused: false });
  }

  togglePause(): void {
    if (this.state.mode === 'play') this.set({ paused: !this.state.paused });
  }

  step(): void {
    if (this.state.mode !== 'play') return;
    this.stepToken++;
    this.set({ paused: true, docVersion: this.state.docVersion });
  }
}

export const store = new AppStore();

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
