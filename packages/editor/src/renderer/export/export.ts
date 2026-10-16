import { defaultImporter, loadScript } from '@tilewright/behaviors';
import { SETTINGS_FILE, buildManifest, exeFileName, exportFolderName, listGameFiles, parseSettings, settingsProblems, type ExportJob, type ExportResult, type ExportSettings, type Platform, type ScriptsBundle } from '@tilewright/exporter';
import { store } from '../app/store';
import { getTranspiler } from '../code/script-manager';
import { api, joinPath } from '../project/api';
import { assetFs } from '../project/assetFs';

export interface ExportProblem {
  severity: 'error' | 'warn';
  text: string;
}

export interface ExportCheck {
  problems: ExportProblem[];
  /** Compiled scripts, ready to ship. */
  scripts: ScriptsBundle;
}

export async function loadExportSettings(): Promise<{ settings: ExportSettings; problem?: string }> {
  const p = store.state.project;
  if (!p) return { settings: parseSettings(null, '').settings };
  const file = joinPath(p.dir, SETTINGS_FILE);
  const text = (await assetFs.exists(file)) ? await assetFs.read(file) : null;
  return parseSettings(text, p.project.name);
}

export async function saveExportSettings(settings: ExportSettings): Promise<void> {
  const p = store.state.project;
  if (p) await assetFs.write(joinPath(p.dir, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Everything that must be true before a game is made: the project check (every scene, door, conversation and
 * cutscene), the settings, the icon, and every script compiling. Errors stop the export; warnings do not.
 */
export async function checkForExport(settings: ExportSettings): Promise<ExportCheck> {
  const p = store.state.project;
  const problems: ExportProblem[] = [];
  const scripts: ScriptsBundle = { format: 1, scripts: {} };
  if (!p) return { problems: [{ severity: 'error', text: 'No project is open.' }], scripts };
  for (const text of settingsProblems(settings)) problems.push({ severity: 'error', text });

  // the game is made from the files on disk, so what is open in the editor is saved first
  if (store.doc?.dirty) await store.save();
  await store.flushScripts();
  for (const r of await store.checkWholeProject()) {
    problems.push({ severity: r.severity === 'error' ? 'error' : 'warn', text: `${r.scene ? `${r.scene.replace(/^scenes\//, '').replace('.scene.json', '')}: ` : ''}${r.message}` });
  }

  if (settings.icon) {
    if (!/\.png$/i.test(settings.icon)) problems.push({ severity: 'error', text: `The icon "${settings.icon}" is not a PNG picture.` });
    else if (!(await assetFs.exists(joinPath(p.dir, ...settings.icon.split('/'))))) problems.push({ severity: 'error', text: `The icon file "${settings.icon}" does not exist in the project.` });
  }

  const transpiler = store.scripts.size > 0 ? await getTranspiler() : null;
  const importer = defaultImporter();
  const names = new Set<string>();
  for (const [name, source] of store.scripts) {
    const file = `assets/scripts/${name}.script.ts`;
    const out = transpiler!.transpile(source, file);
    const loaded = await loadScript(file, source, transpiler!, importer, []);
    const found = [...out.problems, ...loaded.problems];
    for (const f of found) problems.push({ severity: 'error', text: `Script "${name}"${f.line > 0 ? `, line ${f.line}` : ''}: ${f.message}` });
    const display = loaded.loaded?.def.name?.trim() || name;
    if (loaded.loaded && names.has(display)) problems.push({ severity: 'error', text: `Two scripts are both called "${display}". Give one a different name.` });
    names.add(display);
    if (found.length === 0) scripts.scripts[name] = { js: out.js, ...(out.map ? { map: out.map } : {}) };
  }
  return { problems, scripts };
}

/** Make the game. Returns where it is. Throws a UserError-style message if the main process refuses. */
export async function exportGame(settings: ExportSettings, scripts: ScriptsBundle, outRoot: string): Promise<ExportResult> {
  const p = store.state.project;
  if (!p) throw new Error('No project is open.');
  const info = await api().exporter.info();
  if (!info.canExport) throw new Error('This computer cannot export games from this editor (Windows and Linux are supported, and the editor must have been built with `npm run build`).');
  const platform = info.platform as Platform;
  await saveExportSettings(settings);
  const files = await listGameFiles(assetFs, p.dir, joinPath);
  const scriptNames = Object.keys(scripts.scripts).sort((a, b) => a.localeCompare(b));
  const manifest = buildManifest(settings, p.project.startScene, scriptNames, info.version);
  const job: ExportJob = {
    projectDir: p.dir,
    outRoot,
    platform,
    folderName: exportFolderName(settings, platform),
    exeName: exeFileName(settings, platform),
    files,
    generated: [
      { path: 'game.json', text: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: 'scripts.json', text: JSON.stringify(scripts) },
    ],
    icon: settings.icon,
    gameName: settings.gameName,
    version: settings.version,
  };
  return api().exporter.build(job);
}
