import { useSyncExternalStore } from 'react';
import { SLOPE, extractPrefab, type CrashReport, type InputRecording, resolveInstance, type CutsceneData, type DialogueData, type EntityData, type PrefabData, type SceneData, type SlopeDir } from '@tilewright/runtime';
import { EditorDoc } from '../model/doc';
import { isWallTile } from '../model/layers';
import { loadLanguages } from '../project/localization';
import { api, joinPath } from '../project/api';
import { applyAccessibility, cleanAccessibility } from './accessibility';
import { assetFs } from '../project/assetFs';
import { deletePrefab, loadAllPrefabs, prefabNameProblem, savePrefab } from '../project/prefabs';
import { deleteStructure, loadStructures, saveStructure } from '../project/structures';
import { structureNameProblem, type Region, type Structure } from '../structures/structure';
import { analyseLevel, analysePushPuzzles, type LevelIssue } from '@tilewright/playbot';
import { checkProject, type ProjectProblem } from '../project/check';
import { deletePlaythrough, listPlaythroughs, loadPlaythrough, nextPlaythroughName, savePlaythrough } from '../project/playthroughs';
import { Game, newPlaythrough, replayPlaythrough, type GameSetup } from '@tilewright/playbot';
import { dataKinds, dataKnown, eventsToScript, hudPieceKinds, setActivePacks, setProjectLayers, syncCustomBlocks, useProject, type DataKnown, type ProjectKnown } from '@tilewright/behaviors';
import { reloadScripts, type BreakHit, type ScriptProblemEntry } from '../code/script-manager';
import { deleteScript as deleteScriptFile, loadScripts as loadScriptFiles, saveScript as saveScriptFile } from '../project/scripts';
import { setPlayerRequired } from '../model/validate';
import { deleteComponent, deleteCustomBehavior, deleteTable, loadComponents, loadCustomBehaviors, loadEventDefs, loadTables, saveComponent, saveCustomBehavior, saveEventDefs, saveTable } from '../project/blocks';
import { loadProjectInput, loadUiDoc, loadUiLayout, saveProjectInput, saveUiDoc, saveUiLayout, storyNameProblem } from '../project/story';
import { deleteCutscene, deleteDialogue, loadCutscenes, loadData, loadDialogues, loadSkins, loadWorldMap, saveAllData, saveCutscene, saveData, saveDialogue, saveSkins, saveWorldMap } from '../project/story';
import {
  UserError,
  autosaveScene,
  clearAutosave,
  createProject,
  loadScene,
  openProject,
  readAutosave,
  safeFolderName,
  saveProject,
  saveScene,
  scenePathFor,
  type OpenProject,
  type ProjectFs,
} from '../project/io';
import { DEFAULT_TILESET, emptyUiDoc, type UiDoc, defaultUiLayout, completeLayout, type CustomBehaviorData, type CustomComponentData, type EventDef, type TableData, emptyProjectInput, groupOf, newScene, pauseButtonRow, compatOf, tilesetFromList, type AutotileRuleData, type ProjectData, type ProjectInput, type UiLayout, type SkinData, type WorldMapData, type TileDefData } from '@tilewright/runtime';

/** Everything the Story panel edits, as it is at one moment (the parts are replaced, never changed in place). */
interface StorySnapshot {
  data: Record<string, unknown[]>;
  dialogues: Map<string, DialogueData>;
  cutscenes: Map<string, CutsceneData>;
  skins: SkinData[];
  worldMap: WorldMapData | null;
}

interface StoryCommand {
  label: string;
  after: StorySnapshot;
  redo(): void;
  undo(): void;
}

export type ToolId =
  | 'plugin'
  | 'blocks'
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
  | 'attach'
  | 'blockbox'
  | 'structure'
  | 'patrol';

export interface ToolOptions {
  tile: number;
  size: number;
  height: number;
  density: number;
  slopeDir: SlopeDir;
  bridgeLevel: number;
  /** The blocker tool: first level it covers, and the level where it stops (0 = every height). */
  blockFrom: number;
  blockTo: number;
  prefab: string;
  /** Scatter props: the least distance between two of them (cells), and whether to keep off paths. */
  spacing: number;
  avoidPaths: boolean;
  /** The Attach tool: the sprite (a window, a torch...) to fix to a block face. */
  attachment: string;
  outline: boolean;
  edge: number;
  /** The Box select tool: the levels the box covers. */
  zFrom: number;
  zTo: number;
  /** The Blocks tool: what a click does. */
  blockMode: 'add' | 'replace' | 'face' | 'delete';
  /** The Blocks tool: the shape of the next block (a whole block, stairs or a ramp), the way stairs and ramps rise (0 north, 1 east, 2 south, 3 west) and whether bodies are stopped by it. */
  blockShape: 'cube' | 'stairs' | 'ramp';
  blockRot: 0 | 1 | 2 | 3;
  blockSolid: boolean;
  /** The Blocks tool: how many layers deep a Shift-drag builds. */
  blockHeight: number;
  /** The Blocks tool: the nine tiles of the hotbar (keys 1 to 9), and which slot the next new tile takes. */
  hotbar: number[];
  hotbarNext: number;
  /** The Plugin tool: which tool a plugin added is in use (its id). */
  pluginTool: string;
}

export interface ViewOptions {
  grid: boolean;
  collision: boolean;
  /** The collision colours as a walker at this level would meet them (null = at the floor of each cell). */
  collisionLevel: number | null;
  heightLabels: boolean;
  /** Trigger areas and solid objects. */
  triggers: boolean;
  /** Guard routes and view cones. */
  ai: boolean;
  /** How far lights reach. */
  lights: boolean;
  /** Draw order numbers. */
  depth: boolean;
  /** Show only the blocks below this level (0 = everything), to reach inner blocks. */
  slice: number;
  /** See through the world. */
  xray: boolean;
  /** Frame time and what is slow, while playing. */
  profiler: boolean;
  /** Which interface screens are open and which one handled the last press of Back, while playing. */
  screens: boolean;
  /** Gravity's direction, what each body touches, the boxes bodies are tested with and the line of sight that fades walls, while playing. */
  gravity: boolean;
  /** Wires between objects, lit while the game plays. */
  wires: boolean;
  ground: boolean;
  /** Tiles marked as walls. */
  walls: boolean;
  objects: boolean;
  /** Objects tagged decoration. */
  decoration: boolean;
  /** Objects that shine. */
  lightsLayer: boolean;
  regions: boolean;
}

export type Mode = 'edit' | 'play';
export type Workspace = 'world' | 'sprites' | 'code' | 'ui';

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
  locks: { ground: boolean; walls: boolean; objects: boolean; decoration: boolean; lightsLayer: boolean; regions: boolean };
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
  /** The box of blocks the Box select tool has marked (cells and levels), for copying, filling, hollowing and saving. */
  blockBox: Region | null;
  /** What the Place structure tool puts down: a saved structure or the copy on the clipboard, and its turns. */
  placing: { name: string; turns: number } | null;
  /** Saved structures (names), so panels re-render. */
  structureNames: string[];
  /** Bumped when items, dialogues or cutscenes change, so the Story panel re-renders. */
  storyVersion: number;
  /** Puzzle problems from the last check of the open scene. */
  analysis: { issues: LevelIssue[]; version: number; deep: boolean } | null;
  /** Problems from the last whole-project check. */
  projectCheck: { problems: ProjectProblem[]; at: number } | null;
  /** Why the game stopped, when it did. */
  runtimeError: CrashReport | null;
  /** Bumped when scripts change, so the Code panel and menus update. */
  scriptVersion: number;
  /** Scripts that did not compile, in plain English. */
  scriptProblems: ScriptProblemEntry[];
  /** Lines with breakpoints, by script name. */
  breakpoints: Record<string, number[]>;
  /** Set while the game is stopped at a breakpoint. */
  debugHit: { script: string; line: number } | null;
  /** Set while the game is stopped at a breakpoint on an event row, node or graph box. */
  logicHit: { text: string } | null;
  /** The logic graph open in the Graph panel. */
  graphId: string | null;
  /** The script the Code panel should show. */
  openScript: string | null;
  /** Saved playthroughs (recorded by playing or by the bot). */
  playthroughs: string[];
  /** What the bot and the checks reported, newest first. */
  botLog: { kind: 'info' | 'warn' | 'error'; text: string; time: number }[];
  /** Set while the wire dialog is open (two objects were just connected). */
  connect: { from: string; to: string } | null;
  testMode: boolean;
  /** Bumped whenever the document changes, so React panels re-render. */
  docVersion: number;
  /** While playing, reload the game with every edit (otherwise only when asked). */
  hotReload: boolean;
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
    blockFrom: 0,
    blockTo: 0,
    prefab: 'crate',
    spacing: 1,
    avoidPaths: true,
    attachment: '',
    outline: false,
    edge: 1,
    blockMode: 'add',
    blockShape: 'cube',
    blockRot: 0,
    blockSolid: true,
    blockHeight: 2,
    hotbar: [1, 2, 3, 4, 5, 6],
    hotbarNext: 0,
    pluginTool: '',
    zFrom: 0,
    zTo: 3,
  },
  view: { grid: true, collision: false, collisionLevel: null, heightLabels: false, triggers: false, ai: true, lights: false, depth: false, slice: 0, xray: false, profiler: false, screens: false, gravity: false, wires: true, ground: true, walls: true, objects: true, decoration: true, lightsLayer: true, regions: true },
  locks: { ground: false, walls: false, objects: false, decoration: false, lightsLayer: false, regions: false },
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
  blockBox: null,
  placing: null,
  structureNames: [],
  storyVersion: 0,
  hotReload: false,
  analysis: null,
  projectCheck: null,
  runtimeError: null,
  scriptVersion: 0,
  scriptProblems: [],
  breakpoints: {},
  debugHit: null,
  logicHit: null,
  graphId: null,
  openScript: null,
  playthroughs: [],
  botLog: [],
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
  /** Bumped to ask the running game to reload with the edits made while it runs. */
  hotToken = 0;
  private hotTimer: number | undefined;
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
    this.set({ testMode: info.testMode, recent, theme: settings.theme === 'light' ? 'light' : 'dark', hotReload: settings.hotReload === true });
    document.documentElement.dataset.theme = this.state.theme;
    applyAccessibility(cleanAccessibility(settings.accessibility));
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

  /** Create a project whose name is not taken yet ("Tutorial Room", "Tutorial Room 2"...). Returns whether one was made. */
  async newProjectUnique(baseName: string, templateId: string): Promise<boolean> {
    let ok = false;
    await this.guard('Creating the project', async () => {
      const parent = await this.chooseParentFolder();
      if (!parent) return;
      let name = baseName;
      for (let i = 2; await realFs.exists(joinPath(parent, safeFolderName(name), 'project.json')); i++) name = `${baseName} ${i}`;
      await this.openLoaded(await createProject(realFs, parent, name, templateId));
      ok = true;
    });
    return ok;
  }

  /** Copy a finished sample game into a folder the user picks, and open the copy. */
  async openSample(id: string): Promise<void> {
    await this.guard('Opening the sample', async () => {
      const parent = await this.chooseParentFolder();
      if (!parent) return;
      const dir = await api().samples.copy(id, parent);
      await this.openLoaded(await openProject(realFs, dir));
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

  /** Save the project file; the first save of a project made in an older format keeps a copy of the old file, and says so. */
  private async saveProjectFile(dir: string, project: ProjectData): Promise<void> {
    const r = await saveProject(realFs, dir, project);
    if (r.backedUp) this.notify('info', `The project file was upgraded to the newest format. The old one is kept in ${r.backedUp}.`);
  }

  private async openLoaded(p: OpenProject): Promise<void> {
    if (p.migratedFrom !== undefined) {
      this.notify('warn', `This project was made in an older format (${p.migratedFrom}). Tilewright reads it as the newest, and nothing on disk changes until you save. The first save keeps a copy of the project file as it was, because an older Tilewright cannot open the newer format.`);
    }
    if (p.addedPlugins?.length) {
      this.notify('info', `This project has data that belongs to the ${p.addedPlugins.join(', ')} plugin${p.addedPlugins.length === 1 ? '' : 's'}, which ${p.addedPlugins.length === 1 ? 'was' : 'were'} not on. ${p.addedPlugins.length === 1 ? 'It is' : 'They are'} on now, so that data keeps working as it did; the project file is updated on the next save.`);
    }
    useProject(p.project);
    setPlayerRequired(p.project.plugins === undefined);
    await api().recent.add(p.dir, p.project.name);
    this.set({ project: p, workspace: 'world', recent: await api().recent.list() });
    await this.loadPrefabs();
    await this.loadStory();
    await this.loadStructureFiles();
    await this.loadPlaythroughNames();
    await this.loadScripts();
    await this.openScene(p.project.startScene);
    // a game that has a player needs to keep one; a game with none (a tactics battle, a builder) plays without
    setPlayerRequired(p.project.plugins === undefined || (this.doc?.entities.some((e) => e.tags.includes('player')) ?? false));
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

  /** Give the open scene the project's tiles and autotile rules, and the guard that keeps a locked Walls layer untouched. */
  refreshTileContext(): void {
    const doc = this.doc;
    if (!doc) return;
    const project = this.state.project?.project;
    const tileset = tilesetFromList(project?.tileset ?? []) ?? DEFAULT_TILESET;
    doc.autotile = project && project.autotile.length > 0 ? { tileset, rules: project.autotile } : null;
    let warnedAt = 0;
    doc.cellGuard = (before, after) => {
      if (!this.state.locks.walls || (!isWallTile(tileset, before.tile) && !isWallTile(tileset, after.tile))) return true;
      if (Date.now() - warnedAt > 3000) {
        warnedAt = Date.now();
        this.notify('warn', 'The walls layer is locked, so walls were left as they are. Unlock it in the Layers panel.');
      }
      return false;
    };
  }

  /**
   * Change the project's tiles and autotile rules (new variants, new colours, edited rules). Saved at once, like the
   * rest of the project file. Cells that show a variant that no longer exists go back to its base tile.
   */
  async updateTiles(tileset: TileDefData[], autotile: AutotileRuleData[], opts: { reapply?: boolean } = {}): Promise<boolean> {
    const p = this.state.project;
    if (!p) return false;
    const ok = await this.guard('Saving the tiles', async () => {
      const old = tilesetFromList(p.project.tileset) ?? DEFAULT_TILESET;
      const keep = new Set(tileset.map((t) => t.id));
      const project = { ...p.project, tileset, autotile };
      await this.saveProjectFile(p.dir, project);
      this.set({ project: { ...p, project }, docVersion: this.state.docVersion + 1 });
      const doc = this.doc;
      if (doc) {
        const fix: { x: number; y: number; patch: { tile: number } }[] = [];
        for (let y = 0; y < doc.map.height; y++) {
          for (let x = 0; x < doc.map.width; x++) {
            const t = doc.map.getTile(x, y);
            if (t !== 0 && !keep.has(t)) fix.push({ x, y, patch: { tile: groupOf(old, t) } });
          }
        }
        this.refreshTileContext();
        doc.emit({ type: 'tiles' });
        if (fix.length > 0) doc.paint('Remove autotile variants', fix);
        if (opts.reapply) doc.reapplyAutotile('Apply autotiling');
      }
      return true;
    });
    return ok === true;
  }

  private attachDoc(doc: EditorDoc, scenePath: string): void {
    this.unsubDoc?.();
    this.doc = doc;
    this.refreshTileContext();
    this.unsubDoc = doc.subscribe(() => this.bumpDoc());
    this.set({ scenePath, selection: [], selectedRegion: null, mode: 'edit', paused: false, docVersion: this.state.docVersion + 1 });
  }

  /** Coalesce bursts of document events into one React update per frame. */
  private bumpDoc(): void {
    this.maybeHotReload();
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
    if (ok) {
      this.notify('info', 'Saved.');
      window.setTimeout(() => void this.runAnalysis(false), 0); // quick puzzle check after every save
    }
    return ok === true;
  }

  async newSceneInProject(name: string): Promise<void> {
    const p = this.state.project;
    if (!p) return;
    await this.guard('Adding the scene', async () => {
      const path = scenePathFor(name, p.project.scenes);
      // a project that has the pause button as a Quick Action starts every scene with it
      const scene = newScene(name.trim() || 'Scene', 32, 32, 1, compatOf(p.project).pauseAction ? [pauseButtonRow()] : []);
      await saveScene(realFs, p.dir, path, scene);
      const project = { ...p.project, scenes: [...p.project.scenes, path] };
      await this.saveProjectFile(p.dir, project);
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

  // ---- story: items, dialogues, cutscenes ----

  story = { dialogues: new Map<string, DialogueData>(), cutscenes: new Map<string, CutsceneData>() };
  /** The records of every kind of data the plugins that are on keep (items, minigames...), each saved in the kind's own file. */
  data: Record<string, unknown[]> = {};
  /** The player's other looks (Settings -> Appearance), saved in ssets/skins.json. */
  skins: SkinData[] = [];
  /** The map of places the player can open (Story -> Map), saved in assets/worldmap.json; null when there is none. */
  worldMap: WorldMapData | null = null;
  /** The project's data tables (assets/tables), custom components and behaviours (assets/components, assets/behaviors) and event names (assets/events.json). */
  tables: TableData[] = [];
  components: CustomComponentData[] = [];
  customBehaviors: CustomBehaviorData[] = [];
  eventDefs: EventDef[] = [];
  /** The game's own controls (Project settings -> Controls), saved in assets/input.json. */
  input: ProjectInput = emptyProjectInput();
  /** Structures saved from regions of the world (assets/structures). */
  structures = new Map<string, Structure>();
  /** The copy made by Copy or Cut: it lives only until the project closes. */
  blockClipboard: Structure | null = null;

  async loadStructureFiles(): Promise<void> {
    const p = this.state.project;
    if (!p) {
      this.structures = new Map();
      this.set({ structureNames: [] });
      return;
    }
    const { structures, problems } = await loadStructures(assetFs, p.dir);
    this.structures = new Map(structures.map((s) => [s.name, s]));
    for (const problem of problems) this.notify('warn', problem);
    this.set({ structureNames: [...this.structures.keys()] });
  }

  async addStructure(s: Structure): Promise<boolean> {
    const p = this.state.project;
    if (!p) return false;
    const problem = structureNameProblem(s.name, [...this.structures.keys()]);
    if (problem) {
      this.notify('warn', problem);
      return false;
    }
    const ok = await this.guard('Saving the structure', async () => {
      await saveStructure(assetFs, p.dir, s);
      this.structures = new Map(this.structures).set(s.name, s);
      this.set({ structureNames: [...this.structures.keys()].sort((a, b) => a.localeCompare(b)) });
      return true;
    });
    return ok === true;
  }

  async removeStructure(name: string): Promise<void> {
    const p = this.state.project;
    if (!p) return;
    await this.guard('Deleting the structure', async () => {
      await deleteStructure(assetFs, p.dir, name);
      const next = new Map(this.structures);
      next.delete(name);
      this.structures = next;
      if (this.state.placing?.name === name) this.set({ placing: null });
      this.set({ structureNames: [...next.keys()] });
    });
  }

  /** The theme and arrangement of the game's own screen (Story -> Interface), saved in assets/ui.json. */
  uiLayout: UiLayout = defaultUiLayout();
  /** The interface screens made in the UI designer, saved in assets/screens.json. */
  uiDoc: UiDoc = emptyUiDoc();
  /** Something to start as soon as the next Play begins (the Story panel's "Test" buttons). */
  autoPlay: { action: string; params: Record<string, unknown> } | null = null;
  private storyTimers = new Map<string, number>();
  /** Writes that have started but not finished, so a delete can wait for them instead of being undone by them. */
  private storyWrites = new Map<string, Promise<void>>();

  // ---- undo for story edits (items, conversations, cutscenes, skins, minigames, the world map) ----

  private storySnapshot(): StorySnapshot {
    return { data: this.data, dialogues: this.story.dialogues, cutscenes: this.story.cutscenes, skins: this.skins, worldMap: this.worldMap };
  }

  /** Put the story back as it was in a snapshot (the files follow: removed conversations and cutscenes are deleted from disk). */
  private restoreStory(s: StorySnapshot): void {
    const p = this.state.project;
    const goneDialogues = [...this.story.dialogues.keys()].filter((n) => !s.dialogues.has(n));
    const goneCutscenes = [...this.story.cutscenes.keys()].filter((n) => !s.cutscenes.has(n));
    const hadMap = this.worldMap !== null;
    this.story = { dialogues: s.dialogues, cutscenes: s.cutscenes };
    this.data = s.data;
    this.skins = s.skins;
    this.worldMap = s.worldMap;
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    if (!p) return;
    void (async () => {
      for (const n of goneDialogues) await deleteDialogue(assetFs, p.dir, n).catch(() => undefined);
      for (const n of goneCutscenes) await deleteCutscene(assetFs, p.dir, n).catch(() => undefined);
      if (hadMap && !s.worldMap) await assetFs.remove(joinPath(p.dir, 'assets/worldmap.json')).catch(() => undefined);
      await this.flushStory();
    })().catch((e) => this.notify('error', e instanceof UserError ? e.message : `Could not save: ${(e as Error).message}`));
  }

  private lastStory: { cmd: StoryCommand; key: string; at: number } | null = null;
  /** While set, story edits are recorded under this label and never merged (Claude's changes are single steps). */
  private storyStepLabel: string | null = null;

  /** Run a story edit as one named step of the undo history. */
  asStoryStep<T>(label: string, fn: () => T): T {
    this.storyStepLabel = label;
    try {
      return fn();
    } finally {
      this.storyStepLabel = null;
    }
  }

  /**
   * Record the edit just made as an undo step on the open scene's history. Quick edits to the same thing (typing in a
   * field) join the step before them instead of making one step per keystroke.
   */
  private recordStory(label: string, key: string, before: StorySnapshot): void {
    const doc = this.doc;
    if (!doc) return;
    const after = this.storySnapshot();
    const forced = this.storyStepLabel;
    const last = this.lastStory;
    if (!forced && last && last.key === key && Date.now() - last.at < 1200 && doc.history.top === last.cmd) {
      last.cmd.after = after;
      last.at = Date.now();
      return;
    }
    const cmd: StoryCommand = { label: forced ?? label, after, redo: () => this.restoreStory(cmd.after), undo: () => this.restoreStory(before) };
    doc.history.push(cmd);
    doc.emit({ type: 'history' });
    this.lastStory = { cmd, key, at: Date.now() };
  }

  async loadStory(): Promise<void> {
    const p = this.state.project;
    if (!p) {
      this.story = { dialogues: new Map(), cutscenes: new Map() };
      this.data = {};
      this.skins = [];
      this.worldMap = null;
      this.input = emptyProjectInput();
      this.uiLayout = defaultUiLayout();
      this.uiDoc = emptyUiDoc();
      this.tables = [];
      this.components = [];
      this.customBehaviors = [];
      this.eventDefs = [];
      syncCustomBlocks([], []);
      return;
    }
    const [data, dialogues, cutscenes, skins, world] = await Promise.all([loadData(assetFs, p.dir), loadDialogues(assetFs, p.dir), loadCutscenes(assetFs, p.dir), loadSkins(assetFs, p.dir), loadWorldMap(assetFs, p.dir)]);
    const [inputFile, uiFile, uiDocFile, tablesFile, componentsFile, behaviorsFile, eventsFile] = await Promise.all([loadProjectInput(assetFs, p.dir), loadUiLayout(assetFs, p.dir), loadUiDoc(assetFs, p.dir), loadTables(assetFs, p.dir), loadComponents(assetFs, p.dir), loadCustomBehaviors(assetFs, p.dir), loadEventDefs(assetFs, p.dir)]);
    this.tables = tablesFile.items;
    this.components = componentsFile.items;
    this.customBehaviors = behaviorsFile.items;
    this.eventDefs = eventsFile.events;
    for (const problem of syncCustomBlocks(this.components, this.customBehaviors)) this.notify('warn', problem);
    this.input = inputFile.input;
    this.uiLayout = uiFile.layout;
    this.uiDoc = uiDocFile.doc;
    this.worldMap = world.map;
    this.skins = skins.skins;
    this.data = data.data;
    this.story = { dialogues: dialogues.items, cutscenes: cutscenes.items };
    this.set({ storyVersion: this.state.storyVersion + 1 });
    for (const problem of [...data.problems, ...dialogues.problems, ...cutscenes.problems, ...skins.problems, ...world.problems, ...inputFile.problems, ...uiFile.problems, ...uiDocFile.problems, ...tablesFile.problems, ...componentsFile.problems, ...behaviorsFile.problems, ...eventsFile.problems]) this.notify('warn', problem);
  }

  /** Save a story file a moment after the last edit (typing in a field must not write a file per keystroke). */
  private persistLater(key: string, write: () => Promise<void>): void {
    window.clearTimeout(this.storyTimers.get(key));
    this.storyTimers.set(
      key,
      window.setTimeout(() => {
        this.storyTimers.delete(key);
        const done = write().catch((e) => this.notify('error', e instanceof UserError ? e.message : `Could not save: ${(e as Error).message}`));
        this.storyWrites.set(key, done);
        void done.finally(() => this.storyWrites.get(key) === done && this.storyWrites.delete(key));
      }, 350),
    );
  }

  /** Write any story edits that are still waiting (before playing, saving or closing). */
  async flushStory(): Promise<void> {
    for (const t of this.storyTimers.values()) window.clearTimeout(t);
    this.storyTimers.clear();
    const p = this.state.project;
    if (!p) return;
    await saveAllData(assetFs, p.dir, this.data);
    if (this.skins.length > 0 || (await assetFs.exists(joinPath(p.dir, 'assets/skins.json')))) await saveSkins(assetFs, p.dir, this.skins);
    if (this.worldMap) await saveWorldMap(assetFs, p.dir, this.worldMap);
    for (const t of this.tables) await saveTable(assetFs, p.dir, t);
    for (const c of this.components) await saveComponent(assetFs, p.dir, c);
    for (const b of this.customBehaviors) await saveCustomBehavior(assetFs, p.dir, b);
    if (this.eventDefs.length > 0 || (await assetFs.exists(joinPath(p.dir, 'assets/events.json')))) await saveEventDefs(assetFs, p.dir, this.eventDefs);
    if (this.input.actions.length > 0 || Object.keys(this.input.overrides).length > 0 || (await assetFs.exists(joinPath(p.dir, 'assets/input.json')))) await saveProjectInput(assetFs, p.dir, this.input);
    if (JSON.stringify(completeLayout(this.uiLayout, hudPieceKinds())) !== JSON.stringify(defaultUiLayout(hudPieceKinds())) || (await assetFs.exists(joinPath(p.dir, 'assets/ui.json')))) await saveUiLayout(assetFs, p.dir, this.uiLayout);
    if (this.uiDoc.screens.length > 0 || this.uiDoc.prefabs.length > 0 || (await assetFs.exists(joinPath(p.dir, 'assets/screens.json')))) await saveUiDoc(assetFs, p.dir, this.uiDoc);
    for (const d of this.story.dialogues.values()) await saveDialogue(assetFs, p.dir, d);
    for (const c of this.story.cutscenes.values()) await saveCutscene(assetFs, p.dir, c);
  }

  /** The records of one kind of data (empty when no plugin that is on keeps it). */
  dataList(kind: string): readonly unknown[] {
    return this.data[kind] ?? [];
  }

  /** What checks may ask about the data of the project: the names of the records of each kind, and of everything that can be carried. */
  dataKnown(): DataKnown {
    return dataKnown(this.data);
  }

  /** What a scene check may ask about the rest of the project. */
  projectKnown(): ProjectKnown {
    return { data: this.dataKnown(), dialogues: new Set(this.story.dialogues.keys()), cutscenes: new Set(this.story.cutscenes.keys()) };
  }

  /** The things that can be given or carried, for a list to choose from: `{ value, label }` for each record of a kind that carries. */
  carriedChoices(): { value: string; label: string }[] {
    return dataKinds()
      .filter((d) => d.carries)
      .flatMap((d) => this.dataList(d.id).map((r) => ({ value: d.keyOf(r), label: String((r as { name?: unknown }).name ?? d.keyOf(r)) })));
  }

  /** Replace the records of one kind (an edit in its Story tab, or a change by the assistant): one undo step, saved a moment later. */
  setData(kind: string, records: unknown[]): void {
    const def = dataKinds().find((d) => d.id === kind);
    if (!def) return;
    const before = this.storySnapshot();
    this.data = { ...this.data, [kind]: records };
    this.recordStory(`Edit the ${def.label.toLowerCase()}`, `data:${kind}`, before);
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    const p = this.state.project;
    if (p) this.persistLater(`data:${kind}`, () => saveData(assetFs, p.dir, def, this.dataList(kind)));
  }

  /** Read the data of the plugins that are on again (after the plugins of the project were changed): what was edited is saved first. */
  async reloadData(): Promise<void> {
    const p = this.state.project;
    if (!p) return;
    const r = await loadData(assetFs, p.dir);
    this.data = r.data;
    for (const problem of r.problems) this.notify('warn', problem);
    this.set({ storyVersion: this.state.storyVersion + 1 });
  }

  // ---- data tables, custom components and behaviours, event names ----

  /** Add or change a table. */
  setTable(t: TableData): void {
    const i = this.tables.findIndex((x) => x.name === t.name);
    this.tables = i >= 0 ? this.tables.map((x, j) => (j === i ? t : x)) : [...this.tables, t].sort((a, b) => a.name.localeCompare(b.name));
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    const p = this.state.project;
    if (p) this.persistLater(`t:${t.name}`, () => saveTable(assetFs, p.dir, t));
  }

  async removeTable(name: string): Promise<void> {
    this.tables = this.tables.filter((t) => t.name !== name);
    window.clearTimeout(this.storyTimers.get(`t:${name}`));
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    await this.storyWrites.get(`t:${name}`);
    const p = this.state.project;
    if (p) await deleteTable(assetFs, p.dir, name).catch(() => undefined);
  }

  /** Add or change a custom component; the Inspector offers it at once. */
  setComponent(c: CustomComponentData): void {
    const i = this.components.findIndex((x) => x.name === c.name);
    this.components = i >= 0 ? this.components.map((x, j) => (j === i ? c : x)) : [...this.components, c];
    this.resyncCustom();
    const p = this.state.project;
    if (p) this.persistLater(`c:${c.name}.cmp`, () => saveComponent(assetFs, p.dir, c));
  }

  async removeComponent(name: string): Promise<void> {
    this.components = this.components.filter((c) => c.name !== name);
    window.clearTimeout(this.storyTimers.get(`c:${name}.cmp`));
    this.resyncCustom();
    const p = this.state.project;
    if (p) await deleteComponent(assetFs, p.dir, name).catch(() => undefined);
  }

  setCustomBehavior(b: CustomBehaviorData): void {
    const i = this.customBehaviors.findIndex((x) => x.name === b.name);
    this.customBehaviors = i >= 0 ? this.customBehaviors.map((x, j) => (j === i ? b : x)) : [...this.customBehaviors, b];
    this.resyncCustom();
    const p = this.state.project;
    if (p) this.persistLater(`b:${b.name}`, () => saveCustomBehavior(assetFs, p.dir, b));
  }

  async removeCustomBehavior(name: string): Promise<void> {
    this.customBehaviors = this.customBehaviors.filter((b) => b.name !== name);
    window.clearTimeout(this.storyTimers.get(`b:${name}`));
    this.resyncCustom();
    const p = this.state.project;
    if (p) await deleteCustomBehavior(assetFs, p.dir, name).catch(() => undefined);
  }

  setEventDefs(events: EventDef[]): void {
    this.eventDefs = events;
    this.set({ storyVersion: this.state.storyVersion + 1 });
    const p = this.state.project;
    if (p) this.persistLater('events', () => saveEventDefs(assetFs, p.dir, this.eventDefs));
  }

  private resyncCustom(): void {
    for (const problem of syncCustomBlocks(this.components, this.customBehaviors)) this.notify('warn', problem);
    this.set({ storyVersion: this.state.storyVersion + 1, docVersion: this.state.docVersion + 1 });
    this.maybeHotReload();
  }

  /** The game's own controls. */
  setProjectInput(input: ProjectInput): void {
    this.input = input;
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    const p = this.state.project;
    if (p) this.persistLater('input', () => saveProjectInput(assetFs, p.dir, this.input));
  }

  /** The interface screens (the UI designer). Saved a moment after the last edit. */
  setUiDoc(doc: UiDoc): void {
    this.uiDoc = doc;
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    const p = this.state.project;
    if (p) this.persistLater('screens', () => saveUiDoc(assetFs, p.dir, this.uiDoc));
  }

  /** The look and arrangement of the game's own screen. */
  setUiLayout(layout: UiLayout): void {
    this.uiLayout = layout;
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    const p = this.state.project;
    if (p) this.persistLater('ui', () => saveUiLayout(assetFs, p.dir, this.uiLayout));
  }

  /** Change the project's name, first scene, tile size or title screen. Saved at once. */
  async updateProjectSettings(patch: Partial<Pick<ProjectData, 'name' | 'startScene' | 'iso' | 'title' | 'plugins' | 'compat' | 'assistantDeny' | 'collisionLayers'>>): Promise<boolean> {
    const p = this.state.project;
    if (!p) return false;
    const ok = await this.guard('Saving the project settings', async () => {
      const project = { ...p.project, ...patch };
      await this.saveProjectFile(p.dir, project);
      if (patch.collisionLayers) setProjectLayers(patch.collisionLayers);
      if (patch.plugins) {
        if (this.storyTimers.size > 0) await this.flushStory(); // (edits still waiting to be written belong to the plugins that were on)
        setActivePacks(patch.plugins);
        await this.reloadData();
        setPlayerRequired(this.doc?.entities.some((e) => e.tags.includes('player')) ?? false);
      }
      this.set({ project: { ...p, project }, docVersion: this.state.docVersion + 1, storyVersion: this.state.storyVersion + 1 });
      return true;
    });
    return ok === true;
  }

  setSkins(skins: SkinData[]): void {
    const before = this.storySnapshot();
    this.skins = skins;
    this.recordStory('Edit the skins', 'skins', before);
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    const p = this.state.project;
    if (p) this.persistLater('skins', () => saveSkins(assetFs, p.dir, this.skins));
  }

  setWorldMap(map: WorldMapData | null): void {
    const before = this.storySnapshot();
    this.worldMap = map;
    this.recordStory('Edit the world map', 'worldmap', before);
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    const p = this.state.project;
    if (p && map) this.persistLater('worldmap', () => saveWorldMap(assetFs, p.dir, map));
  }

  /** Remove the world map (the game then has none, and the M key opens the travel list). */
  async removeWorldMap(): Promise<void> {
    const p = this.state.project;
    const before = this.storySnapshot();
    this.worldMap = null;
    this.recordStory('Remove the world map', 'worldmap-removed', before);
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    if (p) await assetFs.remove(joinPath(p.dir, 'assets/worldmap.json')).catch(() => undefined);
  }

  putDialogue(d: DialogueData): void {
    const before = this.storySnapshot();
    this.story = { ...this.story, dialogues: new Map(this.story.dialogues).set(d.name, d) };
    this.recordStory(before.dialogues.has(d.name) ? `Edit the conversation "${d.name}"` : `Add the conversation "${d.name}"`, `d:${d.name}`, before);
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    const p = this.state.project;
    if (p) this.persistLater(`d:${d.name}`, () => saveDialogue(assetFs, p.dir, d));
  }

  async removeDialogue(name: string): Promise<void> {
    const p = this.state.project;
    const next = new Map(this.story.dialogues);
    next.delete(name);
    const before = this.storySnapshot();
    this.story = { ...this.story, dialogues: next };
    this.recordStory(`Delete the conversation "${name}"`, `d-del:${name}`, before);
    window.clearTimeout(this.storyTimers.get(`d:${name}`));
    this.set({ storyVersion: this.state.storyVersion + 1 });
    await this.storyWrites.get(`d:${name}`);
    if (p) await deleteDialogue(assetFs, p.dir, name).catch(() => undefined);
  }

  putCutscene(c: CutsceneData): void {
    const before = this.storySnapshot();
    this.story = { ...this.story, cutscenes: new Map(this.story.cutscenes).set(c.name, c) };
    this.recordStory(before.cutscenes.has(c.name) ? `Edit the cutscene "${c.name}"` : `Add the cutscene "${c.name}"`, `c:${c.name}`, before);
    this.set({ storyVersion: this.state.storyVersion + 1 });
    this.maybeHotReload();
    const p = this.state.project;
    if (p) this.persistLater(`c:${c.name}`, () => saveCutscene(assetFs, p.dir, c));
  }

  async removeCutscene(name: string): Promise<void> {
    const p = this.state.project;
    const next = new Map(this.story.cutscenes);
    next.delete(name);
    const before = this.storySnapshot();
    this.story = { ...this.story, cutscenes: next };
    this.recordStory(`Delete the cutscene "${name}"`, `c-del:${name}`, before);
    window.clearTimeout(this.storyTimers.get(`c:${name}`));
    this.set({ storyVersion: this.state.storyVersion + 1 });
    await this.storyWrites.get(`c:${name}`);
    if (p) await deleteCutscene(assetFs, p.dir, name).catch(() => undefined);
  }
  // ---- scripts (code) ----

  scripts = new Map<string, string>();
  /** Where the game is stopped at a breakpoint: the script object and the game, for the watch window. */
  hitContext: BreakHit | null = null;
  private scriptTimers = new Map<string, number>();
  private recompileTimer: number | undefined;

  async loadScripts(): Promise<void> {
    const p = this.state.project;
    if (!p) {
      this.scripts = new Map();
      return;
    }
    const { scripts, problems } = await loadScriptFiles(assetFs, p.dir);
    this.scripts = scripts;
    for (const problem of problems) this.notify('warn', problem);
    // (kept in the settings file, not localStorage: the first localStorage read after a crash can stall for seconds)
    const saved = ((await api().settings.get()).breakpoints ?? {}) as Record<string, Record<string, number[]>>;
    this.set({ breakpoints: saved[p.dir] ?? {} });
    await this.recompileScripts();
  }

  /** Compile every script and register it as a behaviour (the running game picks up the new code at once). */
  async recompileScripts(): Promise<void> {
    const r = await reloadScripts(this.scripts, this.state.breakpoints, {
      log: (kind, text) => this.logLine(kind === 'log' ? 'info' : kind === 'warn' ? 'warn' : 'error', text),
      onBreak: (hit) => {
        this.hitContext = hit;
        this.set({ paused: true, debugHit: { script: hit.script, line: hit.line } });
      },
    });
    this.set({ scriptProblems: r.problems, scriptVersion: this.state.scriptVersion + 1, docVersion: this.state.docVersion + 1 });
    for (const [script, lines] of Object.entries(r.unplaced)) this.logLine('warn', `Breakpoint${lines.length === 1 ? '' : 's'} on line${lines.length === 1 ? '' : 's'} ${lines.join(', ')} of "${script}" could not be placed: a breakpoint must be on the first line of a statement.`);
  }

  /** A line in the Console without a pop-up (script output). */
  logLine(kind: Notice['kind'], text: string): void {
    this.set({ log: [...this.state.log, { time: Date.now(), kind, text }].slice(-300) });
  }

  putScript(name: string, source: string): void {
    this.scripts = new Map(this.scripts).set(name, source);
    this.set({ scriptVersion: this.state.scriptVersion + 1 });
    const p = this.state.project;
    window.clearTimeout(this.scriptTimers.get(name));
    this.scriptTimers.set(
      name,
      window.setTimeout(() => {
        this.scriptTimers.delete(name);
        if (p) void saveScriptFile(assetFs, p.dir, name, source).catch((e) => this.notify('error', e instanceof Error ? e.message : 'The script could not be saved.'));
        window.clearTimeout(this.recompileTimer);
        this.recompileTimer = window.setTimeout(() => void this.recompileScripts(), 150);
      }, 450),
    );
  }

  async newScript(name: string, source: string): Promise<boolean> {
    const problem = storyNameProblem(name, [...this.scripts.keys()], 'script');
    if (problem) {
      this.notify('warn', problem);
      return false;
    }
    const p = this.state.project;
    if (!p) return false;
    this.scripts = new Map(this.scripts).set(name.trim(), source);
    await saveScriptFile(assetFs, p.dir, name.trim(), source);
    this.set({ scriptVersion: this.state.scriptVersion + 1 });
    await this.recompileScripts();
    return true;
  }

  async removeScript(name: string): Promise<void> {
    const p = this.state.project;
    const next = new Map(this.scripts);
    next.delete(name);
    this.scripts = next;
    window.clearTimeout(this.scriptTimers.get(name));
    if (p) await deleteScriptFile(assetFs, p.dir, name).catch(() => undefined);
    const bps = { ...this.state.breakpoints };
    delete bps[name];
    this.set({ breakpoints: bps });
    await this.recompileScripts();
  }

  /** Write script edits that are still waiting (before playing or closing). */
  async flushScripts(): Promise<void> {
    for (const t of this.scriptTimers.values()) window.clearTimeout(t);
    this.scriptTimers.clear();
    const p = this.state.project;
    if (!p) return;
    for (const [name, source] of this.scripts) await saveScriptFile(assetFs, p.dir, name, source).catch(() => undefined);
  }

  toggleBreakpoint(script: string, line: number): void {
    const cur = this.state.breakpoints[script] ?? [];
    const next = cur.includes(line) ? cur.filter((l) => l !== line) : [...cur, line].sort((a, b) => a - b);
    const breakpoints = { ...this.state.breakpoints, [script]: next };
    this.set({ breakpoints });
    const dir = this.state.project?.dir;
    if (dir) {
      void api()
        .settings.get()
        .then((cur) => api().settings.set({ ...cur, breakpoints: { ...((cur.breakpoints as Record<string, unknown> | undefined) ?? {}), [dir]: breakpoints } }))
        .catch(() => undefined); // breakpoints just will not be remembered
    }
    window.clearTimeout(this.recompileTimer);
    this.recompileTimer = window.setTimeout(() => void this.recompileScripts(), 150);
  }

  /** Turn the open scene's event sheet into a script file and open it. Returns the script's name. */
  async convertEventsToScript(): Promise<string | null> {
    const doc = this.doc;
    if (!doc) return null;
    if (doc.events.length === 0) {
      this.notify('warn', 'The event sheet has no rows to convert.');
      return null;
    }
    let name = 'Event sheet';
    for (let i = 2; this.scripts.has(name); i++) name = `Event sheet ${i}`;
    const names = { entity: (id: string): string | undefined => doc.getEntity(id)?.name };
    if (!(await this.newScript(name, eventsToScript(doc.events, names, name)))) return null;
    this.set({ openScript: name });
    this.notify('info', `Made the script "${name}". Attach it to an object (Behaviours -> Add) and delete the event rows to run the code instead.`);
    return name;
  }
  // ---- checking and the playbot ----

  /** Set for the next Play: record the buttons pressed and save them as a playthrough when it stops. */
  recordNext = false;

  async saveRecording(rec: InputRecording, scenePath: string, endNear: string | null): Promise<void> {
    const p = this.state.project;
    if (!p) return;
    const name = nextPlaythroughName(this.state.playthroughs);
    try {
      await savePlaythrough(assetFs, p.dir, newPlaythrough(name, scenePath, rec, 1, endNear ? { near: endNear, within: 2 } : {}));
      await this.loadPlaythroughNames();
      this.notify('info', `Saved the playthrough "${name}"${endNear ? ' (it must end near the goal)' : ''}. Replay it from the Playbot panel.`);
    } catch (e) {
      this.notify('error', e instanceof Error ? e.message : 'The playthrough could not be saved.');
    }
  }

  /** What a headless game is made from, for tools that start several games (the puzzle solver). */
  headlessSetup(): GameSetup | null {
    const scene = this.doc?.toScene();
    if (!scene) return null;
    return { scene, scenePath: this.state.scenePath ?? '', prefabs: this.prefabs, data: this.data, dialogues: this.story.dialogues, cutscenes: this.story.cutscenes, tables: this.tables };
  }

  /** The game, headless, from the open scene as it is now (unsaved edits included). */
  newHeadlessGame(over?: { scenes: Map<string, SceneData>; start: string }): Game | null {
    const doc = this.doc;
    const scene = over ? over.scenes.get(over.start) : doc?.toScene();
    if (!scene) return null;
    return new Game({
      scene,
      scenePath: over ? over.start : (this.state.scenePath ?? ''),
      ...(over ? { scenes: over.scenes } : {}),
      prefabs: this.prefabs,
      data: this.data,
      dialogues: this.story.dialogues,
      cutscenes: this.story.cutscenes,
      tables: this.tables,
    });
  }

  /** Every scene of the project (the open one with its unsaved edits), for games that travel between scenes. */
  async loadAllScenes(): Promise<Map<string, SceneData>> {
    const p = this.state.project;
    const out = new Map<string, SceneData>();
    if (!p) return out;
    for (const path of p.project.scenes) out.set(path, path === this.state.scenePath && this.doc ? this.doc.toScene() : await loadScene(realFs, p.dir, path));
    return out;
  }

  async runPlaythrough(name: string): Promise<void> {
    const p = this.state.project;
    if (!p) return;
    try {
      const pt = await loadPlaythrough(assetFs, p.dir, name);
      const scenes = await this.loadAllScenes();
      const game = this.newHeadlessGame({ scenes, start: scenes.has(pt.scene) ? pt.scene : (this.state.scenePath ?? p.project.startScene) });
      if (!game) return;
      const r = replayPlaythrough(game, pt);
      this.botSay(r.ok ? 'info' : 'warn', r.ok ? `Playthrough "${name}" still works: it ends as expected after ${r.seconds.toFixed(1)}s.` : `Playthrough "${name}" no longer works: ${r.problems.join(' ')}`);
    } catch (e) {
      this.botSay('error', e instanceof Error ? e.message : 'The playthrough could not be run.');
    }
  }

  async removePlaythrough(name: string): Promise<void> {
    const p = this.state.project;
    if (!p) return;
    await deletePlaythrough(assetFs, p.dir, name).catch(() => undefined);
    await this.loadPlaythroughNames();
  }

  /** Puzzle analysis (bypasses, unreachable goals, useless gates, and with `deep` crate puzzles) of the open scene. */
  runAnalysis(deep = false): LevelIssue[] {
    const doc = this.doc;
    if (!doc) return [];
    const scene = doc.toScene();
    const issues = [...analyseLevel(scene, this.prefabs), ...(deep ? analysePushPuzzles(scene, this.prefabs) : [])];
    this.set({ analysis: { issues, version: this.state.docVersion, deep } });
    return issues;
  }

  /** Check every scene, dialogue and cutscene in the project (what Export will insist on). */
  async checkWholeProject(): Promise<ProjectProblem[]> {
    const p = this.state.project;
    if (!p) return [];
    await this.flushStory().catch(() => undefined);
    const { studio } = await import('../studio/store');
    await studio.flushMixer().catch(() => undefined);
    const problems = await checkProject(realFs, p.dir, p.project, this.prefabs, this.story, new Set(studio.assets.keys()), new Set(studio.sounds.map((s) => s.name)), (await loadLanguages(assetFs, p.dir)).languages, this.skins, this.data, studio.mixer, this.worldMap, { input: this.input, layout: this.uiLayout, tables: this.tables });
    this.set({ projectCheck: { problems, at: Date.now() } });
    return problems;
  }

  setRuntimeError(report: CrashReport | null): void {
    this.set({ runtimeError: report });
  }

  async loadPlaythroughNames(): Promise<void> {
    const p = this.state.project;
    this.set({ playthroughs: p ? await listPlaythroughs(assetFs, p.dir) : [] });
  }

  botSay(kind: 'info' | 'warn' | 'error', text: string): void {
    this.set({ botLog: [{ kind, text, time: Date.now() }, ...this.state.botLog].slice(0, 30) });
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
    this.hitContext = null;
    this.set({ mode: 'edit', paused: false, debugHit: null, logicHit: null });
  }

  togglePause(): void {
    if (this.state.mode === 'play') {
      this.hitContext = null;
      this.set({ paused: !this.state.paused, debugHit: null, logicHit: null });
    }
  }

  /** Start the game in a window of its own, beside the editor (saves the open scene first). */
  async runInWindow(): Promise<void> {
    await this.guard('Starting the game window', async () => {
      const { runInWindow } = await import('../export/export');
      const problem = await runInWindow();
      if (problem) this.notify('error', problem);
      else this.notify('info', 'The game is running in its own window. Press this button again to restart it with your latest edits.');
    });
  }

  /** Turn the running game into one that has the edits made since it started (objects go back to their start; the player, items, flags and health stay). */
  requestHotReload(): void {
    if (this.state.mode !== 'play') return;
    this.hotToken++;
    this.set({ docVersion: this.state.docVersion });
  }

  setHotReload(on: boolean): void {
    this.set({ hotReload: on });
    void this.saveSetting('hotReload', on);
  }

  /** With 'Reload as I edit' on, an edit made while playing reloads the game a moment after the last change. */
  private maybeHotReload(): void {
    if (this.state.mode !== 'play' || !this.state.hotReload) return;
    window.clearTimeout(this.hotTimer);
    this.hotTimer = window.setTimeout(() => this.requestHotReload(), 450);
  }

  step(): void {
    if (this.state.mode !== 'play') return;
    this.stepToken++;
    this.set({ paused: true, logicHit: null, docVersion: this.state.docVersion });
  }
}

export const store = new AppStore();

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
