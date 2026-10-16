import {
  C,
  Simulation,
  loadScene,
  physicsSystem,
  type CutsceneData,
  type DialogueData,
  type Entity,
  type ItemData,
  type PrefabMap,
  type SceneData,
  type SimContext,
  type SpriteData,
  type TransformIso,
} from '@tilewright/runtime';
import { addStandardSystems, contextOf, resolveRef } from '@tilewright/behaviors';

export interface GameSetup {
  scene: SceneData;
  /** Path of the scene file (lanterns and saves remember it). */
  scenePath?: string;
  prefabs?: PrefabMap;
  items?: readonly ItemData[];
  dialogues?: ReadonlyMap<string, DialogueData>;
  cutscenes?: ReadonlyMap<string, CutsceneData>;
  sprites?: ReadonlyMap<string, SpriteData>;
  seed?: number;
}

/** A game running headless: the same simulation and systems as Play, driven by whoever calls `step`. */
export class Game {
  readonly sim: Simulation;
  readonly problems: string[];

  constructor(setup: GameSetup) {
    this.sim = new Simulation(setup.seed ?? 1);
    for (const [k, v] of setup.prefabs ?? []) this.sim.assets.prefabs.set(k, v);
    for (const i of setup.items ?? []) this.sim.assets.items.set(i.id, i);
    for (const [k, v] of setup.dialogues ?? []) this.sim.assets.dialogues.set(k, v);
    for (const [k, v] of setup.cutscenes ?? []) this.sim.assets.cutscenes.set(k, v);
    for (const [k, v] of setup.sprites ?? []) this.sim.assets.sprites.set(k, v);
    this.problems = loadScene(this.sim, setup.scene, { prefabs: setup.prefabs, scene: setup.scenePath ?? '' }).problems;
    addStandardSystems(this.sim, physicsSystem);
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
  }
}
