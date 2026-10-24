import { Container, Graphics } from 'pixi.js';
import {
  AudioEngine,
  C,
  DEFAULT_INPUT_MAP,
  DomInputSource,
  GameRunner,
  InputMap,
  InputRecorder,
  IsoRenderer,
  SLOT_NAMES,
  SaveManager,
  Simulation,
  applySave,
  applySkin,
  availableSkins,
  bindingChanges,
  effectiveBindings,
  projectActionLabels,
  projectDefaults,
  type InputMapDef,
  type ProjectInput,
  type UiLayout,
  type UiDoc,
  type TableData,
  gridToScreen,
  groundHeightAt,
  loadScene,
  loadSettings,
  physicsSystem,
  rebind,
  saveSettings,
  serializeGame,
  teleportBody,
  type FxEvent,
  type GameSettings,
  type InputRecording,
  type PrefabData,
  type SkinData,
  type MinigameData,
  type MixerData,
  type WorldMapData,
  spatialize,
  type AmbientRequest,
  type SaveData,
  type SceneData,
  type SpriteData,
  type TileSet,
  type TransformIso,
} from '@tilewright/runtime';
import {
  GameUi,
  describeScreens,
  addStandardSystems,
  beginDialogue,
  beginMinigame,
  contextOf,
  litPosts,
  placeAtSpawn,
  playCutscene,
  output,
  type GameUiHost,
  activeInput,
} from '@tilewright/behaviors';
import { POINTER_BINDINGS } from '@tilewright/runtime';
import { drawCone, drawFootprint, drawLightRadius, drawPath, drawWire, shapesOf, wireShapes } from './debug-draw';
import { assetFs } from '../project/assetFs';
import { joinPath } from '../project/api';
import { loadScene as loadSceneFile } from '../project/io';
import { loadMixer, loadSounds } from '../studio/audio';
import { loadLanguages } from '../project/localization';
import type { CutsceneData, DialogueData, ItemData } from '@tilewright/runtime';

export interface PlayOptions {
  renderer: IsoRenderer;
  /** Element the game's own interface is drawn in (it must be positioned). */
  uiParent: HTMLElement;
  scene: SceneData;
  scenePath: string;
  projectDir: string;
  /** Where save files go (default: a `saves` folder in the project; an exported game uses its own writable folder). */
  savesDir?: string;
  /** Start here instead of at the player start ("Play from here"). */
  from: { x: number; y: number } | null;
  prefabs: ReadonlyMap<string, PrefabData>;
  sprites: ReadonlyMap<string, SpriteData>;
  story: { items: readonly ItemData[]; dialogues: ReadonlyMap<string, DialogueData>; cutscenes: ReadonlyMap<string, CutsceneData> };
  tileset: () => TileSet | undefined;
  /** The scene as it is in the editor right now (so Restart and travel use unsaved edits of the open scene). */
  currentScene: (path: string) => SceneData | null;
  notify(kind: 'info' | 'warn' | 'error', text: string): void;
  onError(error: unknown): void;
  /** Quit the game (back to editing). */
  quit(): void;
  /** A row, node or graph box with a breakpoint ran: the editor stops the game and says where. */
  onLogicBreak?(text: string): void;
  autoPlay: { cutscene?: string; dialogue?: string; minigame?: string } | null;
  /** Which debugging aids are on right now (read every frame). */
  flags: () => { ai: boolean; triggers: boolean; lights: boolean; depth: boolean; profiler: boolean; screens?: boolean; wires?: boolean };
  /** Record the buttons pressed, to save as a playthrough. */
  record: boolean;
  /** Switch the window to or from full screen (only a game in its own window can). */
  setFullscreen?: (on: boolean) => void;
  /** The project's prefabs, sprites and story as they are now (for hot reload while playing in the editor). */
  liveAssets?: () => { prefabs: ReadonlyMap<string, PrefabData>; sprites: ReadonlyMap<string, SpriteData>; story: PlayOptions['story']; skins?: readonly SkinData[]; minigames?: readonly MinigameData[]; worldMap?: WorldMapData | null; layout?: UiLayout; uiDoc?: UiDoc; input?: ProjectInput; tables?: readonly TableData[] };
  /** The player's other looks. */
  skins?: readonly SkinData[];
  /** The project's minigames. */
  minigames?: readonly MinigameData[];
  /** The world map (Story -> Map), if the game has one. */
  worldMap?: WorldMapData | null;
  /** The project's mix, when the host keeps it live (the editor's Mixer panel); otherwise it is read from the project folder. */
  mixer?: { get(): MixerData; subscribe(fn: () => void): () => void };
  /** Show the title screen first (the game's name and a line under it). */
  title?: { text: string; subtitle: string };
  /** The project's data tables. */
  tables?: readonly TableData[];
  /** The interface screens made in the UI designer. */
  uiDoc?: UiDoc;
  /** How the game's own screen looks and where its pieces sit (Story -> Interface). */
  layout?: UiLayout;
  /** The game's own controls (assets/input.json). */
  input?: ProjectInput;
}

/**
 * One run of the game inside the editor: the simulation and its runner, the game's interface (HUD, dialogue,
 * pause menu), scene changes (portals, lanterns, fast travel), save slots and the player's settings.
 * An exported game does the same job with its own shell.
 */
export class PlaySession {
  readonly sim = new Simulation(1);
  readonly source = new DomInputSource();
  readonly runner: GameRunner;
  readonly ui: GameUi;
  readonly inputMap = new InputMap(DEFAULT_INPUT_MAP);
  /** Sounds and music (files in `assets/audio`); silent when there are none. */
  readonly audio = new AudioEngine();
  /** The music asked for by the room the player stands in; '' when the room has none. */
  private roomMusic: string | null = null;
  /** The skins on offer (replaced by hot reload). */
  private skinsNow: readonly SkinData[] = [];
  /** The bindings a player starts with (the built-in ones with this game's changes and its own actions). */
  private defaults: InputMapDef = projectDefaults(null);
  private labels: Record<string, string> = projectActionLabels(null);
  private readonly unlockAudio = (): void => void this.audio.unlock();
  /** Stops listening to the editor's mixer. */
  private offMixer: (() => void) | null = null;
  settings: GameSettings;
  private readonly saves: SaveManager;
  private scenePath: string;
  private raf = 0;
  private traveling = false;
  private startedAt = 0;
  private disposed = false;
  private readonly debugLayer = new Container();
  private readonly debugG = new Graphics();
  private readonly fpsEl = document.createElement('div');

  constructor(private readonly o: PlayOptions) {
    const { sim } = this;
    const renderer = o.renderer;
    this.scenePath = o.scenePath;
    this.settings = loadSettings(typeof localStorage === 'undefined' ? undefined : localStorage);
    this.useInput(o.input);
    sim.runtime.difficulty = this.settings.difficulty;
    for (const [name, data] of o.sprites) sim.assets.sprites.set(name, data);
    for (const [name, data] of o.prefabs) sim.assets.prefabs.set(name, data);
    for (const item of o.story.items) sim.assets.items.set(item.id, item);
    for (const [name, d] of o.story.dialogues) sim.assets.dialogues.set(name, d);
    for (const [name, c] of o.story.cutscenes) sim.assets.cutscenes.set(name, c);
    for (const m of o.minigames ?? []) sim.assets.minigames.set(m.name, m);
    sim.assets.worldMap = o.worldMap ?? null;
    for (const t of o.tables ?? []) sim.assets.tables.set(t.name, t);
    if (o.uiDoc) sim.assets.ui = o.uiDoc;
    this.saves = new SaveManager(
      {
        read: (p) => assetFs.read(p),
        write: (p, t) => assetFs.write(p, t),
        exists: (p) => assetFs.exists(p),
        remove: (p) => assetFs.remove(p),
      },
      o.savesDir ?? joinPath(o.projectDir, 'saves'),
      (d, n) => joinPath(d, n),
    );

    const byId = loadScene(sim, o.scene, { prefabs: o.prefabs, tileset: o.tileset(), scene: o.scenePath });
    for (const problem of byId.problems) o.notify('warn', problem);
    const player = sim.world.withTag('player')[0];
    if (o.from && player) this.placeAt(player, o.from.x, o.from.y);
    this.skinsNow = o.skins ?? [];
    this.applySkinToPlayer();
    addStandardSystems(sim, physicsSystem);
    const warned = new Set<string>();
    sim.events.on('problem', (e) => {
      const text = String(e.text ?? '');
      if (!warned.has(text)) {
        warned.add(text);
        o.notify('warn', text);
      }
    });
    sim.events.on('save-request', () => void this.saveTo('autosave'));
    sim.events.on('logic-break', (e) => o.onLogicBreak?.(String(e.text ?? '')));
    sim.events.on('load-request', (e) => void this.loadFrom(String(e.slot ?? 'autosave')));
    sim.events.on('quit-request', () => o.quit());
    sim.events.on('lantern-lit', () => void this.saveTo('autosave'));
    sim.events.on('rested', () => void this.saveTo('autosave'));

    const cam = renderer.camera;
    cam.deadzoneW = 50;
    cam.deadzoneH = 30;
    cam.smoothing = 0.2;
    cam.zoom = 1;
    renderer.setGroundVisible(true);
    renderer.setWallsVisible(true);
    renderer.entityHidden = null;
    renderer.entitiesVisible = true;
    renderer.setTileMap(sim.map!, o.tileset());
    renderer.focus = player?.id;
    const t0 = player?.require<TransformIso>(C.Transform);
    // a scene with no controlled character starts with the camera over the middle of the map
    if (t0) cam.snapTo(gridToScreen(t0.x, t0.y, t0.h, renderer.iso));
    else cam.snapTo(gridToScreen(sim.map!.width / 2, sim.map!.height / 2, 0, renderer.iso));
    renderer.overlay.visible = false;

    this.runner = new GameRunner({
      sim,
      renderer,
      inputMap: this.inputMap,
      readInput: () => this.source.read(),
      follow: player?.id,
      onTick: () => this.afterTick(),
      onFx: (fx) => this.onFx(fx),
      onError: (e) => o.onError(e),
    });
    this.applyFeelSettings();
    this.applyVolumes();
    this.fpsEl.setAttribute('data-testid', 'tw-fps');
    Object.assign(this.fpsEl.style, { position: 'absolute', right: '10px', top: '8px', font: '12px/1.2 monospace', color: '#9fe6a0', background: '#0b0c10aa', padding: '3px 6px', borderRadius: '4px', pointerEvents: 'none', zIndex: '5', display: 'none' });
    o.uiParent.appendChild(this.fpsEl);
    this.applyVideo(true);
    window.addEventListener('keydown', this.unlockAudio);
    window.addEventListener('pointerdown', this.unlockAudio);
    // translations load first, so a conversation started on the first frame is already in the player's language
    const languagesReady = loadLanguages(assetFs, o.projectDir).then(({ languages, problems }) => {
      for (const p of problems) o.notify('warn', p);
      for (const l of languages) sim.assets.strings.set(l);
      this.applyLanguage();
    });
    if (o.mixer) {
      this.audio.setMixer(o.mixer.get());
      this.offMixer = o.mixer.subscribe(() => this.audio.setMixer(o.mixer!.get()));
    } else {
      void loadMixer(assetFs, o.projectDir).then(({ mixer, problems }) => {
        for (const p of problems) o.notify('warn', p);
        this.audio.setMixer(mixer);
      });
    }
    void loadSounds(assetFs, o.projectDir, this.audio).then((problems) => {
      for (const p of problems) o.notify('warn', p);
      this.roomMusic = null; // start the room's music now that it can play
    });
    this.debugLayer.zIndex = 9e8;
    this.debugLayer.addChild(this.debugG);
    this.debugLayer.visible = false;
    renderer.world.addChild(this.debugLayer);
    if (o.record) this.runner.recorder = new InputRecorder();
    this.ui = new GameUi(o.uiParent, this.uiHost());
    // the mouse reaches the game as cells under the pointer (control schemes read them)
    this.source.setPointer(
      renderer.canvas,
      (x, y) => (this.ui.menuOpen ? null : renderer.pickCell(x, y)),
      () => ({ x: renderer.camera.x, y: renderer.camera.y, zoom: renderer.camera.zoom, w: renderer.camera.viewW, h: renderer.camera.viewH }),
    );
    if (o.layout) this.ui.setLayout(o.layout);
    this.startedAt = performance.now();
    const auto = o.autoPlay;
    if (!auto && !o.from) this.ui.openStart();
    if (o.title && !auto && !o.from) this.ui.openTitle(o.title);
    if (auto) {
      void languagesReady.then(() => {
        if (this.disposed) return;
        if (auto.cutscene) playCutscene(contextOf(sim), auto.cutscene);
        else if (auto.dialogue) beginDialogue(contextOf(sim), auto.dialogue);
        else if (auto.minigame) beginMinigame(contextOf(sim), auto.minigame);
      });
    }
    this.runner.start();
    const loop = (): void => {
      if (this.disposed) return;
      this.ui.update();
      this.drawDebug();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---------- hot reload ----------

  /**
   * Bring the running game up to date with the edits made since it started: the open scene is loaded again (objects go
   * back to where they start), and prefabs, sprites, items, conversations and cutscenes are replaced. The player stays
   * where they are with their items, flags, health and the event rows that already ran.
   */
  hotReload(): string {
    const { sim, o } = this;
    const live = o.liveAssets?.();
    if (live) {
      for (const [name, data] of live.sprites) sim.assets.sprites.set(name, data);
      sim.assets.prefabs.clear();
      for (const [name, data] of live.prefabs) sim.assets.prefabs.set(name, data);
      sim.assets.items.clear();
      for (const item of live.story.items) sim.assets.items.set(item.id, item);
      sim.assets.dialogues.clear();
      for (const [name, d] of live.story.dialogues) sim.assets.dialogues.set(name, d);
      sim.assets.cutscenes.clear();
      for (const [name, c] of live.story.cutscenes) sim.assets.cutscenes.set(name, c);
      if (live.worldMap !== undefined) sim.assets.worldMap = live.worldMap;
      if (live.tables) {
        sim.assets.tables.clear();
        for (const t of live.tables) sim.assets.tables.set(t.name, t);
      }
      if (live.minigames) {
        sim.assets.minigames.clear();
        for (const m of live.minigames) sim.assets.minigames.set(m.name, m);
      }
    }
    const scene = o.currentScene(this.scenePath);
    if (!scene) return 'Reloaded the story and prefabs. This scene has no editing copy, so it was left as it is.';
    const old = sim.world.withTag('player')[0];
    const at = old?.get<TransformIso>(C.Transform);
    const keep = at ? { x: at.x, y: at.y, h: at.h, facing: at.facing } : null;
    const health = old?.get<Record<string, unknown>>('state:health');
    const rows = sim.runtime.rowState;
    const prefabs = live?.prefabs ?? o.prefabs;
    const byId = loadScene(sim, scene, { prefabs, tileset: o.tileset(), scene: this.scenePath, travel: true });
    for (const problem of byId.problems) o.notify('warn', problem);
    sim.runtime.rowState = rows;
    o.renderer.setTileMap(sim.map!, o.tileset());
    const player = sim.world.withTag('player')[0];
    this.runner.follow = player?.id;
    o.renderer.focus = player?.id;
    if (keep && player) {
      this.placeAt(player, keep.x, keep.y, keep.h);
      player.require<TransformIso>(C.Transform).facing = keep.facing;
      if (health) player.set('state:health', { ...health, trail: [], knock: null });
    }
    if (live?.skins) this.skinsNow = live.skins;
    if (live?.layout) this.ui.setLayout(live.layout);
    if (live?.uiDoc) sim.assets.ui = live.uiDoc;
    if (live?.input) this.useInput(live.input);
    this.applySkinToPlayer();
    return 'Reloaded the game with your changes.';
  }

  /** Start from this game's own controls: the bindings a new player gets and the names shown on the Controls screen. */
  private useInput(input: ProjectInput | undefined): void {
    const base = activeInput();
    this.defaults = projectDefaults(input, base.map);
    this.labels = projectActionLabels(input, base.labels);
    this.inputMap.bindings = { ...effectiveBindings(this.settings, this.defaults), ...POINTER_BINDINGS };
  }

  // ---------- sound and effects ----------

  /** Open a minigame by name, as an event row's "Play a minigame" action would (for tests and the Console). */
  openMinigame(name: string): boolean {
    return beginMinigame(contextOf(this.sim), name);
  }

  /** Put the skin the player chose on the player character (nothing changes while it is already worn). */
  private applySkinToPlayer(): void {
    const sim = this.sim;
    sim.assets.skins = [...this.skinsNow];
    const player = sim.world.withTag('player')[0];
    if (!player) return;
    const chosen = availableSkins(sim.assets.skins, sim.runtime.vars).find((s) => s.id === this.settings.skin);
    applySkin(player, chosen);
  }

  /** The player's language, if the game has it; otherwise the text as written. */
  private applyLanguage(): void {
    const tables = this.sim.assets.strings;
    tables.language = tables.get(this.settings.language) ? this.settings.language : '';
  }

  /** Camera zoom, the frame-rate corner and (in an exported game) full screen, from the player's settings. */
  private applyVideo(initial = false): void {
    const s = this.settings;
    if (!this.sim.runtime.view.cameraZoom) this.o.renderer.camera.zoom = s.cameraZoom;
    this.fpsEl.style.display = s.showFps ? 'block' : 'none';
    if (initial && s.fullscreen !== undefined) this.o.setFullscreen?.(s.fullscreen);
  }

  private applyVolumes(): void {
    const s = this.settings;
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx, voice: s.voice });
  }

  /** Screen shake, freeze frames and sparks follow the player's settings and the editor's reduce-motion switch. */
  private applyFeelSettings(): void {
    const calm = typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion');
    this.runner.shakeEnabled = this.settings.screenShake && !calm;
    this.runner.hitStopEnabled = this.settings.screenShake && !calm;
    this.o.renderer.particles.enabled = !calm;
  }

  private onFx(fx: FxEvent): void {
    if (fx.kind === 'sound') {
      const heard = fx.at ? this.heard(fx.at) : null;
      if (heard === null) this.audio.play(fx.name, fx.volume ?? 1);
      else if (heard.gain > 0) this.audio.play(fx.name, (fx.volume ?? 1) * heard.gain, undefined, { pan: heard.pan });
    }
    else if (fx.kind === 'music') this.audio.playMusic(fx.name);
  }

  /** Where the player's ears are: the player, or nowhere in particular when there is none. */
  private listener(): { x: number; y: number } | null {
    const t = this.sim.world.withTag('player')[0]?.get<TransformIso>(C.Transform);
    return t ? { x: t.x, y: t.y } : null;
  }

  /** How loud and from which side a sound at a place is heard (null when nobody is listening: it plays plainly). */
  private heard(at: { x: number; y: number; near: number; far: number }): { gain: number; pan: number } | null {
    const l = this.listener();
    return l ? spatialize(l.x, l.y, at.x, at.y, { near: at.near, far: at.far }) : null;
  }

  /** The looping sounds of Sound Source objects: audible ones loop with the volume and side the player would hear. */
  private syncAmbient(): void {
    const l = this.listener();
    const active = new Map<string, AmbientRequest>();
    if (l) {
      for (const e of this.sim.world.query('soundSource', C.Transform)) {
        const s = e.get<{ sound: string; near: number; far: number; volume: number }>('soundSource')!;
        if (!e.get<{ audible: boolean }>('state:soundSource')?.audible) continue;
        const t = e.require<TransformIso>(C.Transform);
        const h = spatialize(l.x, l.y, t.x, t.y, { near: s.near, far: s.far });
        active.set(String(e.id), { name: s.sound, gain: h.gain * s.volume, pan: h.pan });
      }
    }
    this.audio.syncAmbient(active);
  }

  /** Music follows the room: leaving a room with music for one without lets the last track keep playing until something else asks. */
  private followRoomMusic(x: number, y: number): void {
    const room = this.sim.runtime.regions.find((rg) => rg.music && x >= rg.x && x < rg.x + rg.w && y >= rg.y && y < rg.y + rg.h);
    const want = room?.music ?? '';
    if (want === this.roomMusic) return;
    this.roomMusic = want;
    if (want) this.audio.playMusic(want, 1.5);
  }

  // ---------- each tick ----------

  /** The tick each wire last carried a signal (for the glow). */
  private readonly wireOn = new Map<string, number>();
  private nodeCount = 0;

  private trackWires(): void {
    const { sim } = this;
    this.nodeCount = sim.world.query('actionNode').length;
    for (const w of sim.runtime.wires) {
      const from = sim.world.get(sim.runtime.ids.get(w.from.entity) ?? -1);
      if (from && output(from, w.from.output)) this.wireOn.set(w.id, sim.tick);
    }
  }

  private afterTick(): void {
    const { sim, o } = this;
    this.trackWires();
    this.ui.tick();
    const player = sim.world.withTag('player')[0];
    const t = player?.get<TransformIso>(C.Transform);
    this.syncAmbient();
    if (t) {
      this.followRoomMusic(t.x, t.y);
      const cam = o.renderer.camera;
      const r = sim.runtime.regions.find((rg) => rg.cameraBounds && t.x >= rg.x && t.x < rg.x + rg.w && t.y >= rg.y && t.y < rg.y + rg.h);
      if (r) {
        const iso = o.renderer.iso;
        const pts = [gridToScreen(r.x, r.y, 0, iso), gridToScreen(r.x + r.w, r.y, 0, iso), gridToScreen(r.x + r.w, r.y + r.h, 0, iso), gridToScreen(r.x, r.y + r.h, 0, iso)];
        cam.bounds = { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
      } else cam.bounds = null;
    }
    const travel = sim.runtime.travel;
    if (travel && !this.traveling) {
      sim.runtime.travel = null;
      this.traveling = true;
      const done = (): void => void (this.traveling = false);
      if (travel.fresh) {
        void this.enterScene(travel.scene || this.scenePath, { fresh: true }).finally(done);
      } else if (travel.scene === this.scenePath || travel.scene === '') {
        const p = sim.world.withTag('player')[0];
        if (p) {
          if (travel.x !== undefined && travel.y !== undefined) this.placeAt(p, travel.x, travel.y);
          else if (!placeAtSpawn(contextOf(sim), p, travel.spawn)) o.notify('warn', `There is no place called "${travel.spawn}" to go to.`);
        }
        done();
      } else {
        void this.enterScene(travel.scene, { spawn: travel.spawn, at: travel.x !== undefined && travel.y !== undefined ? { x: travel.x, y: travel.y } : undefined }).finally(done);
      }
    }
  }

  private placeAt(player: ReturnType<Simulation['world']['withTag']>[number], x: number, y: number, h?: number): void {
    const t = player.require<TransformIso>(C.Transform);
    const map = this.sim.map;
    const floor = h ?? (map && map.inBounds(Math.floor(x), Math.floor(y)) ? Math.max(groundHeightAt(map, x, y), map.getDeck(Math.floor(x), Math.floor(y))) : 0);
    t.x = x;
    t.y = y;
    t.h = floor;
    if (player.get(C.Body)) teleportBody(contextOf(this.sim), player, x, y, floor);
  }

  // ---------- scenes ----------

  private async enterScene(path: string, opts: { spawn?: string; at?: { x: number; y: number; h?: number }; save?: SaveData; fresh?: boolean } = {}): Promise<void> {
    const { sim, o } = this;
    let scene: SceneData | null = o.currentScene(path);
    try {
      scene ??= await loadSceneFile(assetFs, o.projectDir, path);
    } catch (e) {
      o.notify('error', e instanceof Error ? e.message : `The scene "${path}" could not be opened.`);
      return;
    }
    const hp = opts.fresh ? null : (sim.world.withTag('player')[0]?.get<{ hp: number }>('state:health')?.hp ?? null);
    this.scenePath = path;
    const byId = loadScene(sim, scene, { prefabs: o.prefabs, tileset: o.tileset(), scene: path, travel: true });
    for (const problem of byId.problems) o.notify('warn', problem);
    o.renderer.setTileMap(sim.map!, o.tileset());
    const player = sim.world.withTag('player')[0];
    this.runner.follow = player?.id;
    o.renderer.focus = player?.id;
    if (player && opts.at) this.placeAt(player, opts.at.x, opts.at.y, opts.at.h);
    else if (player && opts.spawn) placeAtSpawn(contextOf(sim), player, opts.spawn);
    if (player && hp !== null && !opts.save) {
      // health comes along between scenes (it is created fresh on the first tick)
      player.set('state:health', { hp, iframes: 1, dead: false, spawn: null, trail: [], knock: null, blinking: false });
    }
    if (opts.save) applySave(sim, opts.save);
    this.applySkinToPlayer();
    const t = player?.require<TransformIso>(C.Transform);
    if (t) o.renderer.camera.snapTo(gridToScreen(t.x, t.y, t.h, o.renderer.iso));
    else o.renderer.camera.snapTo(gridToScreen(sim.map!.width / 2, sim.map!.height / 2, 0, o.renderer.iso));
    void this.saveTo('autosave');
  }

  // ---------- debugging aids: overlays and the profiler ----------

  private frames = 0;
  private lastStats = 0;
  private fps = 0;
  private profilerEl: HTMLElement | null = null;
  private screensEl: HTMLElement | null = null;

  private drawDebug(): void {
    const flags = this.o.flags();
    const { sim, o } = this;
    o.renderer.debugDepth = flags.depth;
    const g = this.debugG.clear();
    const iso = o.renderer.iso;
    if (flags.ai || flags.triggers) {
      for (const e of sim.world.all()) {
        const comps = Object.fromEntries(e.components) as Record<string, unknown>;
        const shapes = shapesOf(comps);
        if (flags.triggers && shapes.footprint) drawFootprint(g, shapes.footprint, iso);
        if (flags.ai) {
          if (shapes.cone) drawCone(g, { ...shapes.cone, hot: true }, iso);
          const t = comps.transform as { h: number } | undefined;
          const live = [comps['state:chase'], comps['state:patrol']] as ({ nav?: { path?: { x: number; y: number }[] } } | undefined)[];
          for (const s of live) {
            const path = s?.nav?.path;
            if (path && path.length > 0 && t) drawPath(g, { points: path.map((p) => ({ x: p.x, y: p.y, h: t.h + 0.05 })), loop: false, hot: true }, iso);
          }
        }
      }
    }
    if (flags.lights) for (const l of sim.runtime.lighting?.lights ?? []) drawLightRadius(g, { x: l.x, y: l.y, h: l.h, radius: l.radius }, iso);
    if (flags.wires !== false && sim.runtime.wires.length + this.nodeCount > 0) {
      // wires and the lines from action nodes to what they change, lit while a signal runs through them
      const ends = sim.world.all().map((e) => ({ id: e.get<{ sceneId?: string }>('meta')?.sceneId ?? String(e.id), components: Object.fromEntries(e.components) as Record<string, unknown> }));
      const fired = sim.runtime.scratch.get('fired') as Map<string, number> | undefined;
      const lit = (id: string): number => {
        if (id.startsWith('ref:')) {
          const at = fired?.get(`e:${id.split(':')[1]}`);
          return at === undefined ? 0 : Math.max(0, 1 - (sim.tick - at) / 30);
        }
        const on = this.wireOn.get(id);
        return on === undefined ? 0 : Math.max(0, 1 - (sim.tick - on) / 30);
      };
      for (const w of wireShapes(ends, sim.runtime.wires, [], lit)) drawWire(g, w, iso);
    }
    this.debugLayer.visible = flags.ai || flags.triggers || flags.lights || (flags.wires !== false && (sim.runtime.wires.length > 0 || this.nodeCount > 0));

    this.drawScreensOverlay(flags.screens === true);
    // profiler: switched on only while it is shown
    sim.profiler.enabled = flags.profiler;
    this.frames++;
    const now = performance.now();
    if (now - this.lastStats >= 700) {
      this.fps = (this.frames * 1000) / (now - this.lastStats || 1);
      if (this.settings.showFps) this.fpsEl.textContent = `${this.fps.toFixed(0)} fps`;
      this.frames = 0;
      this.lastStats = now;
      if (flags.profiler) this.showProfile();
      else if (this.profilerEl) {
        this.profilerEl.remove();
        this.profilerEl = null;
      }
    }
  }

  /** The screen stack, as the game sees it: what is open, what Back does on each, and who handled the last press. */
  private drawScreensOverlay(on: boolean): void {
    if (!on) {
      this.screensEl?.remove();
      this.screensEl = null;
      return;
    }
    if (!this.screensEl) {
      this.screensEl = document.createElement('div');
      this.screensEl.setAttribute('data-testid', 'tw-screens-overlay');
      Object.assign(this.screensEl.style, { position: 'absolute', left: '10px', top: '34px', background: '#0b0c10dd', color: '#9fd0ff', font: '12px/1.4 monospace', padding: '8px 10px', borderRadius: '6px', pointerEvents: 'none', whiteSpace: 'pre', zIndex: '5', maxWidth: '60%' });
      this.o.uiParent.appendChild(this.screensEl);
    }
    this.screensEl.textContent = describeScreens(this.sim);
  }

  private showProfile(): void {
    const snap = this.sim.profiler.snapshot();
    this.sim.profiler.reset();
    const st = this.o.renderer.stats();
    if (!this.profilerEl) {
      this.profilerEl = document.createElement('div');
      this.profilerEl.setAttribute('data-testid', 'tw-profiler');
      Object.assign(this.profilerEl.style, { position: 'absolute', left: '10px', bottom: '10px', background: '#0b0c10dd', color: '#9fe6a0', font: '12px/1.4 monospace', padding: '8px 10px', borderRadius: '6px', pointerEvents: 'none', whiteSpace: 'pre', zIndex: '5' });
      this.o.uiParent.appendChild(this.profilerEl);
    }
    const slow = [...snap.behaviours.slice(0, 3).map((b) => `${b.name} ${b.avgMs.toFixed(2)} ms (${b.calls.toFixed(0)} per tick)`), ...snap.systems.slice(0, 2).map((s) => `[${s.name}] ${s.avgMs.toFixed(2)} ms`)];
    this.profilerEl.textContent = [
      `${this.fps.toFixed(0)} frames per second`,
      `game step ${snap.avgTickMs.toFixed(2)} ms (worst ${snap.maxTickMs.toFixed(2)})`,
      `drawing ${st.renderMs.toFixed(2)} ms, sorting ${st.sortMs.toFixed(2)} ms`,
      `${this.sim.world.count} objects, ${st.tiles} tiles, ${st.lights} lights`,
      slow.length ? 'slowest:' : '',
      ...slow.map((s) => `  ${s}`),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Everything pressed so far, if this run is being recorded as a playthrough. */
  recording(): InputRecording | null {
    return this.runner.recorder ? this.runner.recorder.finish() : null;
  }
  // ---------- the game's screens ----------

  private hostObj!: GameUiHost;

  /** Change the player's settings: remembered on this machine and shown by the menus at once. */
  private setSettings(next: GameSettings): void {
    this.settings = next;
    if (this.hostObj) this.hostObj.settings = next;
    saveSettings(typeof localStorage === 'undefined' ? undefined : localStorage, next);
  }

  private uiHost(): GameUiHost {
    this.hostObj = {
      sim: this.sim,
      settings: this.settings,
      bindings: () => effectiveBindings(this.settings, this.defaults),
      actionLabels: () => this.labels,
      changeSettings: (patch) => {
        this.setSettings({ ...this.settings, ...patch });
        this.applyFeelSettings();
        this.applyVolumes();
        this.applyLanguage();
        this.applyVideo();
        this.applySkinToPlayer();
      },
      rebind: (action, binding) => {
        const next = rebind(effectiveBindings(this.settings, this.defaults), action, binding);
        this.setSettings({ ...this.settings, bindings: bindingChanges(next, this.defaults) });
        this.inputMap.bindings = { ...next, ...POINTER_BINDINGS };
      },
      resetBindings: () => {
        this.setSettings({ ...this.settings, bindings: {} });
        this.inputMap.bindings = { ...effectiveBindings(this.settings, this.defaults), ...POINTER_BINDINGS };
      },
      captureNext: () => this.source.captureNext(),
      restart: () => {
        const cp = this.sim.runtime.checkpoint;
        void this.enterScene(this.scenePath, cp && cp.scene === this.scenePath ? { at: cp } : {});
      },
      saveTo: (slot) => this.saveTo(slot),
      loadFrom: (slot) => this.loadFrom(slot),
      slots: () => this.saves.list(),
      travelTo: (post) => {
        const here = post.scene === this.scenePath || post.scene === '';
        if (here) {
          const p = this.sim.world.withTag('player')[0];
          if (p) this.placeAt(p, post.x, post.y, post.h);
        } else void this.enterScene(post.scene, { at: { x: post.x, y: post.y, h: post.h } });
      },
      travelToScene: (scene, spawn) => {
        if (scene === this.scenePath || scene === '') {
          const p = this.sim.world.withTag('player')[0];
          if (p && spawn !== '' && !placeAtSpawn(contextOf(this.sim), p, spawn)) this.o.notify('warn', `There is no place called "${spawn}" to go to.`);
        } else void this.enterScene(scene, spawn !== '' ? { spawn } : {});
      },
      quit: () => this.o.quit(),
      fullscreen: this.o.setFullscreen ? { get: () => window.outerWidth >= screen.width && window.outerHeight >= screen.height, set: (on) => this.o.setFullscreen?.(on) } : undefined,
    };
    return this.hostObj;
  }

  async saveTo(slot: string): Promise<string> {
    if (!SLOT_NAMES.includes(slot as (typeof SLOT_NAMES)[number])) return 'That is not a save slot.';
    try {
      const seconds = (performance.now() - this.startedAt) / 1000;
      const name = this.scenePath.replace(/^.*\//, '').replace('.scene.json', '');
      const save = serializeGame(this.sim, { stamp: new Date().toISOString(), label: `${name}, ${Math.max(1, Math.round(seconds / 60))} min`, playSeconds: seconds });
      await this.saves.write(slot, save);
      return slot === 'autosave' ? 'Autosaved.' : `Saved to slot ${slot.replace('slot', '')}.`;
    } catch (e) {
      return `The game could not be saved: ${e instanceof Error ? e.message : 'unknown problem'}.`;
    }
  }

  async loadFrom(slot: string): Promise<string> {
    try {
      const { data, recovered } = await this.saves.read(slot);
      await this.enterScene(data.scene || this.scenePath, { save: data });
      return recovered ? 'That save was damaged; an older copy of it was loaded.' : 'Game loaded.';
    } catch (e) {
      return e instanceof Error ? e.message : 'The game could not be loaded.';
    }
  }

  /** Litter-free list for tests and the debugger. */
  get litLanterns(): ReturnType<typeof litPosts> {
    return litPosts(this.sim.runtime.vars);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.runner.stop();
    this.source.dispose();
    window.removeEventListener('keydown', this.unlockAudio);
    window.removeEventListener('pointerdown', this.unlockAudio);
    this.offMixer?.();
    this.audio.dispose();
    this.o.renderer.particles.system.clear();
    this.ui.dispose();
    this.o.renderer.shake = 0;
    this.o.renderer.debugDepth = false;
    this.sim.profiler.enabled = false;
    this.profilerEl?.remove();
    this.fpsEl.remove();
    this.debugLayer.destroy({ children: true });
  }
}
