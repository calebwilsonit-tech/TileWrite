import '@tilewright/bundled-plugins';
import {
  C,
  Simulation,
  groundHeightAt,
  loadScene,
  openStartScreens,
  physicsSystem,
  teleportBody,
  type CompatFlags,
  type CutsceneData,
  type MinigameData,
  type TableData,
  type WorldMapData,
  type DialogueData,
  type Entity,
  type ItemData,
  type PrefabMap,
  type SceneData,
  type SimContext,
  type SpriteData,
  type TransformIso,
  type TileSet,
  type UiDoc,
} from '@tilewright/runtime';
import { addStandardSystems, contextOf, resolveRef, routeInput } from '@tilewright/behaviors';
import { placeAtSpawn } from '@tilewright/behaviors';

export interface GameSetup {
  scene: SceneData;
  /** Path of the scene file (lanterns and saves remember it). */
  scenePath?: string;
  /** Every scene of the game, by path. With this, portals, lanterns and "go to" actions change scene as they do in play. */
  scenes?: ReadonlyMap<string, SceneData>;
  prefabs?: PrefabMap;
  items?: readonly ItemData[];
  dialogues?: ReadonlyMap<string, DialogueData>;
  cutscenes?: ReadonlyMap<string, CutsceneData>;
  minigames?: readonly MinigameData[];
  worldMap?: WorldMapData | null;
  tables?: readonly TableData[];
  sprites?: ReadonlyMap<string, SpriteData>;
  /** The project's tiles (their properties apply on the map). */
  tileset?: TileSet;
  /** The project's interface screens. */
  ui?: UiDoc;
  /** The project's compatibility flags (default: every one off, as an older project plays). */
  compat?: CompatFlags;
  seed?: number;
}

/** A game running headless: the same simulation and systems as Play, driven by whoever calls `step`. */
export class Game {
  readonly sim: Simulation;
  readonly problems: string[];
  /** The scene that is running now. */
  scenePath: string;
  private readonly scenes: ReadonlyMap<string, SceneData> | undefined;
  private readonly prefabs: PrefabMap | undefined;
  /** The scene the game began with (a new run starts it again). */
  private readonly first: SceneData;
  private readonly tileset: TileSet | undefined;

  constructor(setup: GameSetup) {
    this.sim = new Simulation(setup.seed ?? 1);
    if (setup.compat) this.sim.compat = setup.compat;
    this.scenes = setup.scenes;
    this.first = setup.scene;
    this.prefabs = setup.prefabs;
    this.scenePath = setup.scenePath ?? '';
    for (const [k, v] of setup.prefabs ?? []) this.sim.assets.prefabs.set(k, v);
    for (const i of setup.items ?? []) this.sim.assets.items.set(i.id, i);
    for (const [k, v] of setup.dialogues ?? []) this.sim.assets.dialogues.set(k, v);
    for (const [k, v] of setup.cutscenes ?? []) this.sim.assets.cutscenes.set(k, v);
    for (const m of setup.minigames ?? []) this.sim.assets.minigames.set(m.name, m);
    for (const t of setup.tables ?? []) this.sim.assets.tables.set(t.name, t);
    this.sim.assets.worldMap = setup.worldMap ?? null;
    if (setup.ui) this.sim.assets.ui = setup.ui;
    this.tileset = setup.tileset;
    for (const [k, v] of setup.sprites ?? []) this.sim.assets.sprites.set(k, v);
    this.problems = loadScene(this.sim, setup.scene, { prefabs: setup.prefabs, tileset: setup.tileset, scene: setup.scenePath ?? '' }).problems;
    addStandardSystems(this.sim, physicsSystem);
    if (setup.ui) openStartScreens(this.sim);
  }

  get ctx(): SimContext {
    return contextOf(this.sim);
  }

  get player(): Entity {
    const p = this.sim.world.withTag('player')[0];
    if (!p) throw new Error('The scene has no player.');
    return p;
  }

  get position(): { x: number; y: number; h: number } {
    const t = this.player.require<TransformIso>(C.Transform);
    return { x: t.x, y: t.y, h: t.h };
  }

  get seconds(): number {
    return this.sim.tick / 60;
  }

  /** Objects by reference: "player", "id:e3", "tag:goal", "name:Keeper". */
  find(ref: string): Entity | undefined {
    return resolveRef(this.ctx, ref)[0];
  }

  step(actions: Record<string, number> = {}): void {
    this.sim.step(actions);
    // the game's interface takes its share of the buttons, as it does in Play (Back, and the keys that open Pause)
    routeInput({ sim: this.sim, builtinOpen: () => false, openMenu: () => undefined });
    const travel = this.sim.runtime.travel;
    if (travel?.fresh) {
      // a new run: the same scene again, nothing carried over
      this.sim.runtime.travel = null;
      this.enterScene(travel.scene || this.scenePath, { fresh: true });
    } else if (travel && this.scenes) {
      this.sim.runtime.travel = null;
      this.travelTo(travel);
    }
  }

  private placeAt(who: Entity, x: number, y: number, h?: number): void {
    const t = who.require<TransformIso>(C.Transform);
    const map = this.sim.map;
    const floor = h ?? (map && map.inBounds(Math.floor(x), Math.floor(y)) ? Math.max(groundHeightAt(map, x, y), map.getDeck(Math.floor(x), Math.floor(y))) : 0);
    t.x = x;
    t.y = y;
    t.h = floor;
    if (who.get(C.Body)) teleportBody(this.ctx, who, x, y, floor);
  }

  private travelTo(t: { scene: string; spawn: string; x?: number; y?: number }): void {
    const at = t.x !== undefined && t.y !== undefined ? { x: t.x, y: t.y } : undefined;
    if (t.scene === '' || t.scene === this.scenePath) {
      const p = this.sim.world.withTag('player')[0];
      if (!p) return;
      if (at) this.placeAt(p, at.x, at.y);
      else if (!placeAtSpawn(this.ctx, p, t.spawn)) this.problems.push(`There is no place called "${t.spawn}" to go to.`);
      return;
    }
    this.enterScene(t.scene, { spawn: t.spawn, ...(at ? { at } : {}) });
  }

  /** Change scene the way the game does: the world is replaced, what the player carries (items, flags, lit lanterns, health) stays. */
  enterScene(path: string, opts: { spawn?: string; at?: { x: number; y: number; h?: number }; fresh?: boolean } = {}): boolean {
    const scene = this.scenes?.get(path) ?? (path === this.scenePath || !this.scenes ? this.first : undefined);
    if (!scene) {
      this.problems.push(`The scene "${path}" does not exist.`);
      return false;
    }
    if (!scene.entities.some((e) => e.tags.includes('player'))) {
      this.problems.push(`The scene "${path}" has no player start.`);
      return false;
    }
    const hp = opts.fresh ? null : (this.sim.world.withTag('player')[0]?.get<{ hp: number }>('state:health')?.hp ?? null);
    this.scenePath = path;
    this.problems.push(...loadScene(this.sim, scene, { prefabs: this.prefabs, tileset: this.tileset, scene: path, travel: true }).problems);
    const player = this.player;
    if (opts.at) this.placeAt(player, opts.at.x, opts.at.y, opts.at.h);
    else if (opts.spawn) placeAtSpawn(this.ctx, player, opts.spawn);
    if (hp !== null) player.set('state:health', { hp, iframes: 1, dead: false, spawn: null, trail: [], knock: null, blinking: false });
    return true;
  }
}
