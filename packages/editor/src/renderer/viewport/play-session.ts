import {
  C,
  DEFAULT_INPUT_MAP,
  DomInputSource,
  GameRunner,
  InputMap,
  IsoRenderer,
  SLOT_NAMES,
  SaveManager,
  Simulation,
  applySave,
  bindingChanges,
  effectiveBindings,
  gridToScreen,
  groundHeightAt,
  loadScene,
  loadSettings,
  physicsSystem,
  rebind,
  saveSettings,
  serializeGame,
  teleportBody,
  type GameSettings,
  type PrefabData,
  type SaveData,
  type SceneData,
  type SpriteData,
  type TileSet,
  type TransformIso,
} from '@tilewright/runtime';
import {
  GameUi,
  addStandardSystems,
  beginDialogue,
  contextOf,
  litPosts,
  placeAtSpawn,
  playCutscene,
  type GameUiHost,
} from '@tilewright/behaviors';
import { assetFs } from '../project/assetFs';
import { joinPath } from '../project/api';
import { loadScene as loadSceneFile } from '../project/io';
import type { CutsceneData, DialogueData, ItemData } from '@tilewright/runtime';

export interface PlayOptions {
  renderer: IsoRenderer;
  /** Element the game's own interface is drawn in (it must be positioned). */
  uiParent: HTMLElement;
  scene: SceneData;
  scenePath: string;
  projectDir: string;
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
  autoPlay: { cutscene?: string; dialogue?: string } | null;
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
  settings: GameSettings;
  private readonly saves: SaveManager;
  private scenePath: string;
  private raf = 0;
  private traveling = false;
  private startedAt = 0;
  private disposed = false;

  constructor(private readonly o: PlayOptions) {
    const { sim } = this;
    const renderer = o.renderer;
    this.scenePath = o.scenePath;
    this.settings = loadSettings(typeof localStorage === 'undefined' ? undefined : localStorage);
    this.inputMap.bindings = effectiveBindings(this.settings);
    sim.runtime.difficulty = this.settings.difficulty;
    for (const [name, data] of o.sprites) sim.assets.sprites.set(name, data);
    for (const [name, data] of o.prefabs) sim.assets.prefabs.set(name, data);
    for (const item of o.story.items) sim.assets.items.set(item.id, item);
    for (const [name, d] of o.story.dialogues) sim.assets.dialogues.set(name, d);
    for (const [name, c] of o.story.cutscenes) sim.assets.cutscenes.set(name, c);
    this.saves = new SaveManager(
      {
        read: (p) => assetFs.read(p),
        write: (p, t) => assetFs.write(p, t),
        exists: (p) => assetFs.exists(p),
        remove: (p) => assetFs.remove(p),
      },
      joinPath(o.projectDir, 'saves'),
      (d, n) => joinPath(d, n),
    );

    const byId = loadScene(sim, o.scene, { prefabs: o.prefabs, scene: o.scenePath });
    for (const problem of byId.problems) o.notify('warn', problem);
    const player = sim.world.withTag('player')[0]!;
    if (o.from) this.placeAt(player, o.from.x, o.from.y);
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
    sim.events.on('lantern-lit', () => void this.saveTo('autosave'));
    sim.events.on('rested', () => void this.saveTo('autosave'));

    const cam = renderer.camera;
    cam.deadzoneW = 50;
    cam.deadzoneH = 30;
    cam.smoothing = 0.2;
    cam.zoom = 1;
    renderer.setGroundVisible(true);
    renderer.entitiesVisible = true;
    renderer.setTileMap(sim.map!, o.tileset());
    renderer.focus = player.id;
    const t0 = player.require<TransformIso>(C.Transform);
    cam.snapTo(gridToScreen(t0.x, t0.y, t0.h, renderer.iso));
    renderer.overlay.visible = false;

    this.runner = new GameRunner({
      sim,
      renderer,
      inputMap: this.inputMap,
      readInput: () => this.source.read(),
      follow: player.id,
      onTick: () => this.afterTick(),
      onError: (e) => o.onError(e),
    });
    this.runner.shakeEnabled = this.settings.screenShake;
    this.ui = new GameUi(o.uiParent, this.uiHost());
    this.startedAt = performance.now();
    if (o.autoPlay?.cutscene) playCutscene(contextOf(sim), o.autoPlay.cutscene);
    else if (o.autoPlay?.dialogue) beginDialogue(contextOf(sim), o.autoPlay.dialogue);
    this.runner.start();
    const loop = (): void => {
      if (this.disposed) return;
      this.ui.update();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---------- each tick ----------

  private afterTick(): void {
    const { sim, o } = this;
    const player = sim.world.withTag('player')[0];
    const t = player?.get<TransformIso>(C.Transform);
    if (t) {
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
      if (travel.scene === this.scenePath || travel.scene === '') {
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

  private async enterScene(path: string, opts: { spawn?: string; at?: { x: number; y: number; h?: number }; save?: SaveData } = {}): Promise<void> {
    const { sim, o } = this;
    let scene: SceneData | null = o.currentScene(path);
    try {
      scene ??= await loadSceneFile(assetFs, o.projectDir, path);
    } catch (e) {
      o.notify('error', e instanceof Error ? e.message : `The scene "${path}" could not be opened.`);
      return;
    }
    if (!scene.entities.some((e) => e.tags.includes('player'))) {
      o.notify('error', `The scene "${path}" has no player start, so the game cannot continue there.`);
      return;
    }
    const hp = sim.world.withTag('player')[0]?.get<{ hp: number }>('state:health')?.hp ?? null;
    this.scenePath = path;
    const byId = loadScene(sim, scene, { prefabs: o.prefabs, scene: path, travel: true });
    for (const problem of byId.problems) o.notify('warn', problem);
    o.renderer.setTileMap(sim.map!, o.tileset());
    const player = sim.world.withTag('player')[0]!;
    this.runner.follow = player.id;
    o.renderer.focus = player.id;
    if (opts.at) this.placeAt(player, opts.at.x, opts.at.y, opts.at.h);
    else if (opts.spawn) placeAtSpawn(contextOf(sim), player, opts.spawn);
    if (hp !== null && !opts.save) {
      // health comes along between scenes (it is created fresh on the first tick)
      player.set('state:health', { hp, iframes: 1, dead: false, spawn: null, trail: [], knock: null, blinking: false });
    }
    if (opts.save) applySave(sim, opts.save);
    const t = player.require<TransformIso>(C.Transform);
    o.renderer.camera.snapTo(gridToScreen(t.x, t.y, t.h, o.renderer.iso));
    void this.saveTo('autosave');
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
      bindings: () => effectiveBindings(this.settings),
      changeSettings: (patch) => {
        this.setSettings({ ...this.settings, ...patch });
        this.runner.shakeEnabled = this.settings.screenShake;
      },
      rebind: (action, binding) => {
        const next = rebind(effectiveBindings(this.settings), action, binding);
        this.setSettings({ ...this.settings, bindings: bindingChanges(next) });
        this.inputMap.bindings = next;
      },
      resetBindings: () => {
        this.setSettings({ ...this.settings, bindings: {} });
        this.inputMap.bindings = effectiveBindings(this.settings);
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
      quit: () => this.o.quit(),
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
    this.ui.dispose();
    this.o.renderer.shake = 0;
  }
}
