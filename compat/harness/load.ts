import path from 'node:path';
import ts from 'typescript';
import { tilesetFromList, type ItemData, type ProjectData, type SceneData, type TableData, type UiDoc, type DialogueData, type CutsceneData, type PrefabData } from '@tilewright/runtime';
import { activate, clearScripts, defaultImporter, installScriptGlobals, loadScript, packsOfProject, setActivePacks, syncCustomBlocks, tsTranspiler } from '@tilewright/behaviors';
import { Game } from '@tilewright/playbot';
import { loadScene, openProject } from '../../packages/editor/src/renderer/project/io';
import { loadAllPrefabs } from '../../packages/editor/src/renderer/project/prefabs';
import { loadCutscenes, loadDialogues, loadItems, loadUiDoc, loadMinigames, loadSkins, loadWorldMap, loadProjectInput } from '../../packages/editor/src/renderer/project/story';
import { loadComponents, loadCustomBehaviors, loadTables } from '../../packages/editor/src/renderer/project/blocks';
import { loadScripts } from '../../packages/editor/src/renderer/project/scripts';
import { nodeFs } from './nodefs';

export interface LoadedProject {
  dir: string;
  project: ProjectData;
  scenes: Map<string, SceneData>;
  prefabs: Map<string, PrefabData>;
  items: ItemData[];
  dialogues: Map<string, DialogueData>;
  cutscenes: Map<string, CutsceneData>;
  tables: TableData[];
  ui: UiDoc;
  scripts: Map<string, string>;
  /** Everything the loaders complained about, in plain English. */
  problems: string[];
  /** What scripts printed while loading. */
  log: string[];
}

const transpiler = tsTranspiler(ts as unknown as Parameters<typeof tsTranspiler>[0]);

/**
 * Open a project folder the way the editor and an exported game do: every loader runs, every script is compiled and
 * registered as a behaviour, and the project's packs are switched on. Call `unload()` when finished with it, because
 * the behaviour registry is global.
 */
export async function loadProject(dir: string): Promise<LoadedProject> {
  const problems: string[] = [];
  const log: string[] = [];
  clearScripts();
  const { project } = await openProject(nodeFs, dir);
  setActivePacks(packsOfProject(project));
  const [tables, components, behaviours] = await Promise.all([loadTables(nodeFs, dir), loadComponents(nodeFs, dir), loadCustomBehaviors(nodeFs, dir)]);
  problems.push(...syncCustomBlocks(components.items, behaviours.items));
  const scenes = new Map<string, SceneData>();
  for (const p of project.scenes) {
    try {
      scenes.set(p, await loadScene(nodeFs, dir, p));
    } catch (e) {
      problems.push(`Scene ${p}: ${(e as Error).message}`);
    }
  }
  const { prefabs, problems: prefabProblems } = await loadAllPrefabs(nodeFs, dir);
  const [items, dialogues, cutscenes, ui, skins, minigames, worldMap, controls, scripts] = await Promise.all([
    loadItems(nodeFs, dir),
    loadDialogues(nodeFs, dir),
    loadCutscenes(nodeFs, dir),
    loadUiDoc(nodeFs, dir),
    loadSkins(nodeFs, dir),
    loadMinigames(nodeFs, dir),
    loadWorldMap(nodeFs, dir),
    loadProjectInput(nodeFs, dir),
    loadScripts(nodeFs, dir),
  ]);
  problems.push(
    ...prefabProblems,
    ...tables.problems,
    ...components.problems,
    ...behaviours.problems,
    ...items.problems,
    ...dialogues.problems,
    ...cutscenes.problems,
    ...ui.problems,
    ...skins.problems,
    ...minigames.problems,
    ...worldMap.problems,
    ...controls.problems,
    ...scripts.problems,
  );

  installScriptGlobals({ log: (kind, text) => log.push(`${kind}: ${text}`) });
  const importer = defaultImporter();
  for (const [name, source] of [...scripts.scripts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const file = `assets/scripts/${name}.script.ts`;
    const r = await loadScript(file, source, transpiler, importer, []);
    if (!r.loaded) {
      for (const p of r.problems) problems.push(`Script ${name}${p.line > 0 ? `, line ${p.line}` : ''}: ${p.message}`);
      continue;
    }
    activate(r.loaded, { log: (kind, text) => log.push(`${kind}: ${text}`) });
  }
  return {
    dir,
    project,
    scenes,
    prefabs,
    items: items.items,
    dialogues: dialogues.items,
    cutscenes: cutscenes.items,
    tables: tables.items,
    ui: ui.doc,
    scripts: scripts.scripts,
    problems,
    log,
  };
}

export function unload(): void {
  clearScripts();
  setActivePacks([]);
}

/** A game on one scene of the project, as Play starts it. */
export function gameOn(p: LoadedProject, scenePath: string, seed = 1): Game {
  const scene = p.scenes.get(scenePath);
  if (!scene) throw new Error(`The project has no scene ${scenePath}.`);
  return new Game({
    scene,
    scenePath,
    scenes: p.scenes,
    prefabs: p.prefabs,
    items: p.items,
    dialogues: p.dialogues,
    cutscenes: p.cutscenes,
    tables: p.tables,
    ui: p.ui,
    tileset: tilesetFromList(p.project.tileset),
    seed,
  });
}

export const relative = (root: string, file: string): string => path.relative(root, file).split(path.sep).join('/');
