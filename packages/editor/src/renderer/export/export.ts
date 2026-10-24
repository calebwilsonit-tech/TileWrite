import { defaultImporter, loadScript } from '@tilewright/behaviors';
import { SETTINGS_FILE, buildCredits, buildManifest, creditProblems, creditsOf, exeFileName, exportFolderName, listGameFiles, parseSettings, settingsProblems, type ExportJob, type ExportResult, type ExportSettings, type Platform, type ScriptsBundle } from '@tilewright/exporter';
import { host } from '@tilewright/behaviors';
import { store } from '../app/store';
import { pluginManager } from '../plugins/manager';
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

/** The text of what the project took from the library or the hub (who made it, under which licence), or null. */
async function readLinksText(dir: string): Promise<string | null> {
  const file = joinPath(dir, 'assets/library-links.json');
  return (await assetFs.exists(file)) ? assetFs.read(file) : null;
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

  const compiled = await compileScripts();
  problems.push(...compiled.problems);
  problems.push(...pluginsForGame().problems);
  for (const c of creditProblems(creditsOf(await readLinksText(p.dir)))) problems.push({ severity: 'warn', text: c.text });
  return { problems, scripts: compiled.scripts };
}

/**
 * The game part of every plugin the project uses that did not come with the editor, ready to ship, and what is wrong with the
 * project's plugins: one that is not installed here, or one the person has not allowed.
 */
export function pluginsForGame(): { bundle: { format: 1; plugins: { manifest: Record<string, unknown>; code: string; granted: string[] }[] }; problems: ExportProblem[] } {
  const problems: ExportProblem[] = [];
  const bundle = { format: 1 as const, plugins: [] as { manifest: Record<string, unknown>; code: string; granted: string[] }[] };
  const p = store.state.project;
  for (const id of p?.project.plugins ?? []) {
    const known = host.known.get(id);
    if (!known) {
      problems.push({ severity: 'error', text: `The game needs the plugin "${id}", which is not installed on this computer. Install it, or switch it off in Project settings.` });
      continue;
    }
    if (known.manifest.builtin || id.startsWith('example-')) continue; // these are in the player
    const chosen = pluginManager.chosen(id);
    if (!chosen?.pkg || chosen.state !== 'ready') {
      problems.push({ severity: 'error', text: `The plugin "${id}" has not been allowed to run here, so it cannot go into the game.` });
      continue;
    }
    if (chosen.pkg.runtimeCode) bundle.plugins.push({ manifest: chosen.pkg.manifest as unknown as Record<string, unknown>, code: chosen.pkg.runtimeCode, granted: host.permissionsOf(id).granted });
  }
  return { bundle, problems };
}

/** Compile every script the way an export does (and report each one that does not compile, or whose name is taken twice). */
export async function compileScripts(): Promise<{ problems: ExportProblem[]; scripts: ScriptsBundle }> {
  const problems: ExportProblem[] = [];
  const scripts: ScriptsBundle = { format: 1, scripts: {} };
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

/**
 * Run the game in a window of its own, beside the editor. The open scene is saved first (the game is made from the
 * files, like an export), scripts are compiled, and a throw-away copy of the game is started. Returns a problem in
 * plain English, or null when the window opened.
 */
export async function runInWindow(): Promise<string | null> {
  const p = store.state.project;
  if (!p) return 'No project is open.';
  if (store.doc?.dirty) await store.save();
  await store.flushScripts();
  await store.flushStory();
  const compiled = await compileScripts();
  if (compiled.problems.length > 0) return compiled.problems.map((x) => x.text).join(' ');
  const { settings } = await loadExportSettings();
  const files = await listGameFiles(assetFs, p.dir, joinPath);
  const names = Object.keys(compiled.scripts.scripts).sort((a, b) => a.localeCompare(b));
  // the window title says it is a test run, so it is never mistaken for the finished game
  const shipped = pluginsForGame();
  if (shipped.problems.length > 0) return shipped.problems.map((x) => x.text).join(' ');
  const manifest = buildManifest({ ...settings, gameName: `${settings.gameName} (running from the editor)` }, p.project.startScene, names, 'editor run', shipped.bundle.plugins.map((x) => String(x.manifest.id)));
  await api().preview.open({
    projectDir: p.dir,
    files,
    generated: [
      { path: 'game.json', text: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: 'scripts.json', text: JSON.stringify(compiled.scripts) },
      { path: 'plugins.json', text: JSON.stringify(shipped.bundle) },
    ],
    gameName: settings.gameName,
    version: settings.version,
    width: settings.windowWidth,
    height: settings.windowHeight,
  });
  return null;
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
  const shipped = pluginsForGame();
  if (shipped.problems.length > 0) throw new Error(shipped.problems.map((x) => x.text).join(' '));
  const manifest = buildManifest(settings, p.project.startScene, scriptNames, info.version, shipped.bundle.plugins.map((x) => String(x.manifest.id)));
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
      { path: 'plugins.json', text: JSON.stringify(shipped.bundle) },
    ],
    icon: settings.icon,
    gameName: settings.gameName,
    version: settings.version,
    credits: buildCredits(settings.gameName, creditsOf(await readLinksText(p.dir))) ?? '',
  };
  return api().exporter.build(job);
}
