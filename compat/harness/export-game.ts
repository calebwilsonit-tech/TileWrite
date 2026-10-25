import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { tsTranspiler } from '@tilewright/behaviors';
import { GameManifestSchema, ScriptsBundleSchema, buildManifest, listGameFiles, parseSettings, type GameManifest, type ScriptsBundle } from '@tilewright/exporter';
import { joinPath } from '../../packages/editor/src/renderer/project/api';
import { loadScripts } from '../../packages/editor/src/renderer/project/scripts';
import { nodeFs } from './nodefs';

const transpiler = tsTranspiler(ts as unknown as Parameters<typeof tsTranspiler>[0]);

/**
 * What an export does to a project's files, without the part that needs a window: the files that ship are copied into the game's data folder,
 * the scripts are compiled into one `scripts.json`, and `game.json` says how the game starts. (The editor's Export button then puts that
 * folder beside the player; `e2e/m12-export.spec.ts` and `e2e/p2-export-samples.spec.ts` run the whole thing as programs.)
 */
export async function exportGameData(projectDir: string, out: string): Promise<{ manifest: GameManifest; files: string[] }> {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const project = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8')) as { name: string; startScene: string };
  const files = await listGameFiles(nodeFs, projectDir, joinPath);
  for (const rel of files) {
    const to = path.join(out, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(projectDir, ...rel.split('/')), to);
  }
  const scripts = await loadScripts(nodeFs, projectDir);
  const bundle: ScriptsBundle = { format: 1, scripts: {} };
  for (const [name, source] of [...scripts.scripts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const compiled = transpiler.transpile(source, `assets/scripts/${name}.script.ts`);
    if (compiled.problems.length > 0) throw new Error(`The script "${name}" does not compile: ${compiled.problems.map((p) => p.message).join('; ')}`);
    bundle.scripts[name] = { js: compiled.js, ...(compiled.map ? { map: compiled.map } : {}) };
  }
  const manifest = buildManifest(parseSettings(null, project.name).settings, project.startScene, Object.keys(bundle.scripts), 'compat');
  fs.writeFileSync(path.join(out, 'game.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'scripts.json'), `${JSON.stringify(bundle)}\n`);
  return { manifest, files };
}

/** The exported game's own files, read back the way the player reads them. */
export function readExported(out: string): { manifest: GameManifest; scripts: ScriptsBundle } {
  return {
    manifest: GameManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(out, 'game.json'), 'utf8'))),
    scripts: ScriptsBundleSchema.parse(JSON.parse(fs.readFileSync(path.join(out, 'scripts.json'), 'utf8'))),
  };
}
