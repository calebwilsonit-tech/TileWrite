import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { applySave, parseProject, parseSave, parseScene, serializeGame, stringifyScene } from '@tilewright/runtime';
import { tsTranspiler } from '@tilewright/behaviors';
import { buildManifest, listGameFiles, parseSettings, settingsProblems } from '@tilewright/exporter';
import { PlaythroughSchema, replayPlaythrough } from '@tilewright/playbot';
import { checkProject } from '../../packages/editor/src/renderer/project/check';
import { EditorDoc } from '../../packages/editor/src/renderer/model/doc';
import { projectText } from '../../packages/editor/src/renderer/project/io';
import { loadAllPrefabs } from '../../packages/editor/src/renderer/project/prefabs';
import { loadCutscenes, loadDialogues, loadItems, loadMinigames, loadSkins, loadWorldMap, loadProjectInput, loadUiLayout } from '../../packages/editor/src/renderer/project/story';
import { loadTables } from '../../packages/editor/src/renderer/project/blocks';
import { joinPath } from '../../packages/editor/src/renderer/project/api';
import { gameOn, loadProject, unload, type LoadedProject } from './load';
import { nodeFs } from './nodefs';
import { runKeys, runMouse, runSteps, sha, type Checkpoint } from './trace';
import { scenariosOf } from '../scenarios';
import { typecheckScripts } from './scripts';

export interface SceneReport {
  entities: number;
  map: string;
  /** Problems the scene reported when it was loaded into a game. */
  loadProblems: string[];
  /** Scene text -> data -> text -> data is stable. */
  roundTrip: boolean;
  keys: { checkpoints: Checkpoint[]; error: string };
  mouse: { checkpoints: Checkpoint[]; error: string };
  /** serializeGame -> text -> parseSave -> applySave into a fresh game -> serializeGame is stable. */
  saveRoundTrip: string;
}

export interface CompatReport {
  /** Everything the loaders complained about (should be empty for a healthy project). */
  loadProblems: string[];
  /** The whole-project check (what Export insists on). */
  check: string[];
  project: { schemaVersion: number; plugins: string; roundTrip: boolean };
  scenes: Record<string, SceneReport>;
  /** What the project's own scenarios (compat/scenarios) did. */
  scenarios: Record<string, { checkpoints: Checkpoint[]; error: string }>;
  scripts: { typecheck: Record<string, string[]>; compile: Record<string, string>; logs: string[] };
  /** The saves already in the project folder still open. */
  savedGames: Record<string, string>;
  playthroughs: Record<string, string>;
  /** What an export would ship. */
  exported: { files: Record<string, string>; manifest: string; settingsProblems: string[] };
}

/** Text files are hashed with line endings normalised, so a checkout with CRLF and one with LF agree. */
function fileHash(file: string): string {
  const bytes = fs.readFileSync(file);
  const isText = /\.(json|ts|js|md|txt|csv|glsl|frag|vert|html|css)$/i.test(file);
  return sha(isText ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes);
}

const stable = (v: unknown): string => JSON.stringify(v);

async function sceneReport(p: LoadedProject, scenePath: string): Promise<SceneReport> {
  const scene = p.scenes.get(scenePath)!;
  const text = stringifyScene(scene);
  const again = parseScene(JSON.parse(text));
  const roundTrip = again.ok && stringifyScene(again.value) === text;
  const doc = EditorDoc.fromScene(scene, p.prefabs);

  const g = gameOn(p, scenePath);
  const loadProblems = [...g.problems];
  const keys = runKeys(g);
  // the save round trip is taken at the end of the key script
  let saveRoundTrip = 'ok';
  try {
    const a = serializeGame(g.sim, { stamp: 'x' });
    const parsed = parseSave(JSON.stringify(a));
    const fresh = gameOn(p, scenePath);
    applySave(fresh.sim, parsed);
    const b = serializeGame(fresh.sim, { stamp: 'x' });
    if (stable({ ...a, objects: undefined, player: undefined }) !== stable({ ...b, objects: undefined, player: undefined })) saveRoundTrip = 'the saved variables or scene changed';
    else if (stable(a.player) !== stable(b.player)) saveRoundTrip = `the player changed: ${stable(a.player)} -> ${stable(b.player)}`;
    else if (stable(a.objects) !== stable(b.objects)) saveRoundTrip = 'a persistent object changed';
  } catch (e) {
    saveRoundTrip = `failed: ${(e as Error).message}`;
  }

  const g2 = gameOn(p, scenePath);
  const mouse = runMouse(g2);
  return {
    entities: scene.entities.length,
    map: sha(JSON.stringify(doc.map.tiles) + JSON.stringify(doc.map.heights)),
    loadProblems,
    roundTrip,
    keys,
    mouse,
    saveRoundTrip,
  };
}

/** The whole report for one project folder. The same folder must always give the same report until the engine changes behaviour. */
export async function buildReport(dir: string): Promise<CompatReport> {
  const p = await loadProject(dir);
  try {
    const projectOk = (() => {
      const parsed = parseProject(JSON.parse(JSON.stringify(p.project)));
      return parsed.ok && projectText(parsed.value) === projectText(p.project);
    })();

    const scenes: Record<string, SceneReport> = {};
    for (const s of p.project.scenes) if (p.scenes.has(s)) scenes[s] = await sceneReport(p, s);

    const scenarios: CompatReport['scenarios'] = {};
    for (const sc of scenariosOf(dir)) scenarios[sc.name] = runSteps(gameOn(p, sc.scene || p.project.startScene), sc.steps, sc.every ?? 30, sc.watch);

    const [prefabs, items, dialogues, cutscenes, skins, minigames, worldMap, controls, layout, tables] = await Promise.all([
      loadAllPrefabs(nodeFs, dir),
      loadItems(nodeFs, dir),
      loadDialogues(nodeFs, dir),
      loadCutscenes(nodeFs, dir),
      loadSkins(nodeFs, dir),
      loadMinigames(nodeFs, dir),
      loadWorldMap(nodeFs, dir),
      loadProjectInput(nodeFs, dir),
      loadUiLayout(nodeFs, dir),
      loadTables(nodeFs, dir),
    ]);
    const found = await checkProject(
      nodeFs,
      dir,
      p.project,
      prefabs.prefabs,
      { items: items.items, dialogues: dialogues.items, cutscenes: cutscenes.items },
      new Set(),
      undefined,
      [],
      skins.skins,
      minigames.minigames,
      undefined,
      worldMap.map,
      { input: controls.input, layout: layout.layout, tables: tables.items },
    );
    const check = found.map((r) => `${r.severity}: ${r.scene ? `${r.scene}: ` : ''}${r.message}`).sort();

    const transpiler = tsTranspiler(ts as unknown as Parameters<typeof tsTranspiler>[0]);
    const compile: Record<string, string> = {};
    for (const [name, source] of [...p.scripts].sort((a, b) => a[0].localeCompare(b[0]))) {
      const out = transpiler.transpile(source, `assets/scripts/${name}.script.ts`);
      compile[name] = out.problems.length > 0 ? out.problems.map((x) => `line ${x.line}: ${x.message}`).join('; ') : `ok ${sha(out.js)}`;
    }

    const savedGames: Record<string, string> = {};
    const savesDir = path.join(dir, 'saves');
    if (fs.existsSync(savesDir)) {
      for (const f of fs.readdirSync(savesDir).sort()) {
        if (!f.endsWith('.json')) continue;
        try {
          parseSave(fs.readFileSync(path.join(savesDir, f), 'utf8'));
          savedGames[f] = 'ok';
        } catch (e) {
          savedGames[f] = `cannot be opened: ${(e as Error).message}`;
        }
      }
    }

    const playthroughs: Record<string, string> = {};
    const ptDir = path.join(dir, 'playthroughs');
    if (fs.existsSync(ptDir)) {
      for (const f of fs.readdirSync(ptDir).sort()) {
        if (!f.endsWith('.playthrough.json')) continue;
        const pt = PlaythroughSchema.parse(JSON.parse(fs.readFileSync(path.join(ptDir, f), 'utf8')));
        const game = gameOn(p, pt.scene || p.project.startScene, pt.seed);
        const r = replayPlaythrough(game, pt);
        playthroughs[f] = r.ok ? `ok after ${r.seconds.toFixed(1)}s` : r.problems.join(' ');
      }
    }

    const settings = parseSettings(null, p.project.name).settings;
    const files = await listGameFiles(nodeFs, dir, joinPath);
    const shipped: Record<string, string> = {};
    for (const f of files) shipped[f] = fileHash(path.join(dir, ...f.split('/')));
    const manifest = buildManifest(settings, p.project.startScene, Object.keys(compile).sort(), 'compat');

    return {
      loadProblems: [...p.problems].sort(),
      check,
      project: { schemaVersion: p.project.schemaVersion, plugins: p.project.plugins === undefined ? '(none listed: the old built-in set)' : p.project.plugins.join(','), roundTrip: projectOk },
      scenes,
      scenarios,
      scripts: { typecheck: typecheckScripts(p.scripts), compile, logs: p.log },
      savedGames,
      playthroughs,
      exported: { files: shipped, manifest: sha(JSON.stringify(manifest)), settingsProblems: settingsProblems(settings) },
    };
  } finally {
    unload();
  }
}
