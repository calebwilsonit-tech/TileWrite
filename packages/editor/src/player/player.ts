import 'pixi.js/unsafe-eval'; // Pixi's shader helpers without `new Function`, which the Content-Security-Policy forbids
import { IsoRenderer, crashReport, formatCrashReport, tilesetFromList, type SpriteData } from '@tilewright/runtime';
import { activate, defaultImporter, installScriptGlobals, loadScript, type Transpiler } from '@tilewright/behaviors';
import { GameManifestSchema, ScriptsBundleSchema, type GameManifest } from '@tilewright/exporter';
import { joinPath } from '../renderer/project/api';
import { assetFs } from '../renderer/project/assetFs';
import { loadScene, openProject } from '../renderer/project/io';
import { loadAllPrefabs } from '../renderer/project/prefabs';
import { loadCutscenes, loadDialogues, loadItems } from '../renderer/project/story';
import { loadAllSprites } from '../renderer/studio/assets';
import { PlaySession } from '../renderer/viewport/play-session';

/**
 * The game's own window contents: loads the exported data, starts the same PlaySession the editor's Play uses,
 * and turns any failure into a friendly screen plus a log file. No editor code runs here.
 */

interface GameApi {
  info(): Promise<{ name: string; version: string; dataDir: string; savesDir: string; logsDir: string; testMode: boolean }>;
  crash(text: string): Promise<string>;
  quit(): Promise<void>;
  toggleFullscreen(): Promise<void>;
}
const game = (): GameApi => (window.tilewright as unknown as { game: GameApi }).game;

const stage = document.getElementById('stage')!;
let session: PlaySession | null = null;
let crashed = false;

function overlay(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0b0c10', color: '#e6e8ee', textAlign: 'center', padding: '24px', zIndex: '100000', gap: '14px' });
  stage.appendChild(el);
  return el;
}

function button(label: string, testId: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.setAttribute('data-testid', testId);
  Object.assign(b.style, { font: 'inherit', padding: '8px 18px', borderRadius: '6px', border: '1px solid #4a4f60', background: '#2a2e38', color: 'inherit', cursor: 'pointer' });
  b.addEventListener('click', onClick);
  return b;
}

/** The friendly crash screen: what happened in a sentence, where the report was saved, Copy and Quit. */
async function showCrash(headline: string, report: string): Promise<void> {
  if (crashed) return;
  crashed = true;
  try {
    session?.runner.stop();
  } catch {
    /* already stopped */
  }
  const where = await game()
    .crash(report)
    .catch(() => '');
  const el = overlay();
  el.setAttribute('data-testid', 'game-crash');
  el.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = 'Sorry, the game has stopped';
  h.style.margin = '0';
  const p = document.createElement('p');
  p.textContent = headline;
  p.setAttribute('data-testid', 'game-crash-headline');
  p.style.maxWidth = '640px';
  const note = document.createElement('p');
  note.style.cssText = 'max-width:640px;color:#9aa0b2;font-size:13px;margin:0';
  note.setAttribute('data-testid', 'game-crash-where');
  note.textContent = where ? `A report was saved in case you want to send it to the people who made the game: ${where}` : 'The report could not be saved on this computer.';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px';
  row.append(
    button('Copy the details', 'game-crash-copy', () => void navigator.clipboard?.writeText(report)),
    button('Close the game', 'game-crash-quit', () => void game().quit()),
  );
  el.append(h, p, note, row);
}

window.addEventListener('error', (e) => void showCrash(`Something unexpected happened: ${e.message}`, `${e.message}\n${e.error instanceof Error ? (e.error.stack ?? '') : ''}`));
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
  void showCrash(`Something unexpected happened: ${err.message}`, `${err.message}\n${err.stack ?? ''}`);
});

function toast(text: string): void {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, { position: 'absolute', left: '50%', bottom: '24px', transform: 'translateX(-50%)', background: '#2a2e38ee', color: '#e6e8ee', padding: '8px 14px', borderRadius: '6px', zIndex: '99999', maxWidth: '80%' });
  stage.appendChild(el);
  window.setTimeout(() => el.remove(), 5000);
}

function splash(text: string): { done(minMs: number): Promise<void> } {
  const el = overlay();
  el.setAttribute('data-testid', 'game-splash');
  el.style.zIndex = '99999';
  const t = document.createElement('div');
  t.textContent = text;
  t.style.cssText = 'font-size:28px;letter-spacing:0.04em';
  el.append(t);
  const shown = performance.now();
  return {
    async done(minMs) {
      const wait = Math.max(0, minMs - (performance.now() - shown));
      await new Promise((r) => setTimeout(r, wait));
      el.remove();
    },
  };
}

async function boot(): Promise<void> {
  const info = await game().info();
  const root = info.dataDir;
  const manifest: GameManifest = GameManifestSchema.parse(JSON.parse(await assetFs.read(joinPath(root, 'game.json'))));
  document.title = manifest.name;
  const splashScreen = manifest.splashText ? splash(manifest.splashText) : null;

  const { project } = await openProject(assetFs, root);
  const [{ prefabs, problems: prefabProblems }, { sprites, problems: spriteProblems }, items, dialogues, cutscenes] = await Promise.all([
    loadAllPrefabs(assetFs, root),
    loadAllSprites(assetFs, root),
    loadItems(assetFs, root),
    loadDialogues(assetFs, root),
    loadCutscenes(assetFs, root),
  ]);
  for (const p of [...prefabProblems, ...spriteProblems, ...items.problems, ...dialogues.problems, ...cutscenes.problems]) console.warn(p);

  // scripts were compiled when the game was exported; they become behaviours exactly as in the editor
  const bundle = ScriptsBundleSchema.parse(JSON.parse(await assetFs.read(joinPath(root, 'scripts.json'))));
  installScriptGlobals({ log: (kind, text) => console[kind === 'log' ? 'log' : kind](text) });
  const precompiled: Transpiler = {
    transpile(_source, file) {
      const name = /([^/\\]+)\.script\.ts$/.exec(file)?.[1] ?? '';
      const s = bundle.scripts[name];
      return s ? { js: s.js, ...(s.map ? { map: s.map } : {}), problems: [] } : { js: '', problems: [{ line: 0, message: `The compiled script "${name}" is missing.` }] };
    },
  };
  const importer = defaultImporter();
  for (const name of manifest.scripts) {
    const r = await loadScript(`assets/scripts/${name}.script.ts`, '', precompiled, importer, []);
    if (!r.loaded) throw new Error(`The script "${name}" could not start: ${r.problems.map((p) => p.message).join(' ')}`);
    activate(r.loaded, { log: (kind, text) => console[kind === 'log' ? 'log' : kind](text) });
  }

  const renderer = new IsoRenderer({ antialias: true });
  await renderer.init(stage);
  const ro = new ResizeObserver(() => {
    if (stage.clientWidth > 0 && stage.clientHeight > 0) renderer.resize(stage.clientWidth, stage.clientHeight);
  });
  ro.observe(stage);
  for (const data of sprites.values() as Iterable<SpriteData>) renderer.registerSprite(data);

  const scenePath = project.startScene;
  const scene = await loadScene(assetFs, root, scenePath);
  if (!scene.entities.some((e) => e.tags.includes('player'))) throw new Error('This game has no player start in its first scene, so there is nothing to play.');
  const tileset = tilesetFromList(project.tileset);

  await splashScreen?.done(1500);
  const s: PlaySession = new PlaySession({
    renderer,
    uiParent: stage,
    scene,
    scenePath,
    projectDir: root,
    savesDir: info.savesDir,
    from: null,
    prefabs,
    sprites,
    story: { items: items.items, dialogues: dialogues.items, cutscenes: cutscenes.items },
    tileset: () => tileset,
    currentScene: () => null,
    notify: (kind, text) => {
      if (kind === 'error') toast(text);
      else console.warn(text);
    },
    onError: (error) => {
      const report = crashReport(s.sim, error);
      void showCrash(report.headline, formatCrashReport(report));
    },
    quit: () => void game().quit(),
    autoPlay: null,
    flags: () => ({ ai: false, triggers: false, lights: false, depth: false, profiler: false }),
    record: false,
  });
  session = s;
  if (info.testMode) (window as unknown as { __game: { session: PlaySession } }).__game = { session: s };
}

boot().catch((e) => {
  const err = e instanceof Error ? e : new Error(String(e));
  void showCrash(`The game could not start: ${err.message}`, `${err.message}\n${err.stack ?? ''}`);
});
