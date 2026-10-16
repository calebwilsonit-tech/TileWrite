import { useEffect, useRef } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { useApp, store } from './store';
import { COMMANDS, viewportRef } from './commands';
import { CommandPalette, NewSceneDialog, RecoveryDialog, ShortcutsDialog, StatusBar, Toasts, useKeyDispatcher, useShortcuts } from './Chrome';
import { ViewportPanel } from '../panels/ViewportPanel';
import { ToolsPanel } from '../panels/ToolsPanel';
import { TilesPanel } from '../panels/TilesPanel';
import { InspectorPanel } from '../panels/InspectorPanel';
import { LayersPanel } from '../panels/LayersPanel';
import { ConsolePanel, HistoryPanel, ProblemsPanel, useProblems } from '../panels/BottomPanels';

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  viewport: () => <ViewportPanel />,
  tools: () => <ToolsPanel />,
  tiles: () => <TilesPanel />,
  inspector: () => <InspectorPanel />,
  layers: () => <LayersPanel />,
  history: () => <HistoryPanel />,
  problems: () => <ProblemsPanel />,
  console: () => <ConsolePanel />,
};

const LAYOUT_VERSION = 1;

function buildDefault(api: DockviewApi): void {
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  api.addPanel({ id: 'tools', component: 'tools', title: 'Tools', position: { referencePanel: 'viewport', direction: 'left' }, initialWidth: 250 });
  api.addPanel({ id: 'tiles', component: 'tiles', title: 'Tiles', position: { referencePanel: 'tools', direction: 'below' }, initialHeight: 230 });
  api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' }, initialWidth: 290 });
  api.addPanel({ id: 'layers', component: 'layers', title: 'Layers', position: { referencePanel: 'inspector', direction: 'within' } });
  api.addPanel({ id: 'history', component: 'history', title: 'History', position: { referencePanel: 'inspector', direction: 'within' } });
  api.addPanel({ id: 'problems', component: 'problems', title: 'Problems', position: { referencePanel: 'viewport', direction: 'below' }, initialHeight: 190 });
  api.addPanel({ id: 'console', component: 'console', title: 'Console', position: { referencePanel: 'problems', direction: 'within' } });
  api.getPanel('inspector')?.api.setActive();
  api.getPanel('problems')?.api.setActive();
}

function Toolbar() {
  const project = useApp((s) => s.project);
  const scenePath = useApp((s) => s.scenePath);
  const mode = useApp((s) => s.mode);
  const paused = useApp((s) => s.paused);
  const theme = useApp((s) => s.theme);
  useApp((s) => s.docVersion);
  const doc = store.doc;
  const problems = useProblems();
  const errors = problems.filter((p) => p.severity === 'error').length;
  const run = (id: string) => () => COMMANDS.find((c) => c.id === id)?.run();

  const switchScene = async (path: string): Promise<void> => {
    if (path === scenePath) return;
    if (doc?.dirty) await store.save();
    await store.guard('Opening the scene', () => store.openScene(path));
  };

  return (
    <header className="toolbar" data-testid="toolbar">
      <strong className="brand" title="Back to the project list" onClick={() => void store.closeProject()}>
        Tilewright
      </strong>
      <span className="project-name" data-testid="project-name">
        {project?.project.name}
      </span>
      <select data-testid="scene-select" aria-label="Scene" value={scenePath ?? ''} onChange={(e) => void switchScene(e.target.value)} disabled={mode === 'play'}>
        {project?.project.scenes.map((s) => (
          <option key={s} value={s}>
            {s.replace(/^scenes\//, '').replace(/\.scene\.json$/, '')}
          </option>
        ))}
      </select>
      <button data-testid="btn-new-scene" onClick={() => document.dispatchEvent(new CustomEvent('tw:new-scene'))} disabled={mode === 'play'} title="Add a new empty scene">
        + Scene
      </button>
      <span className="sep" />
      <button data-testid="btn-undo" onClick={run('edit.undo')} disabled={mode === 'play' || !doc?.history.canUndo} title={`Undo ${doc?.history.undoLabel ?? ''} (Ctrl+Z)`}>
        Undo
      </button>
      <button data-testid="btn-redo" onClick={run('edit.redo')} disabled={mode === 'play' || !doc?.history.canRedo} title={`Redo ${doc?.history.redoLabel ?? ''} (Ctrl+Y)`}>
        Redo
      </button>
      <button data-testid="btn-save" className={doc?.dirty ? 'primary' : ''} onClick={run('file.save')} disabled={mode === 'play'} title="Save the scene (Ctrl+S)">
        Save
      </button>
      <span className="sep" />
      {mode === 'edit' ? (
        <>
          <button data-testid="btn-play" className="play" onClick={() => store.play()} title="Play the scene in the editor (F5)">
            ▶ Play
          </button>
          <button data-testid="btn-play-here" onClick={run('play.fromHere')} title="Play starting at the cell under the mouse (Ctrl+Enter)">
            ▶ From here
          </button>
        </>
      ) : (
        <>
          <button data-testid="btn-pause" onClick={() => store.togglePause()} aria-pressed={paused} title="Pause or resume (F6)">
            {paused ? '▶ Resume' : '❚❚ Pause'}
          </button>
          <button data-testid="btn-step" onClick={() => store.step()} title="Advance one frame (F10)">
            ⏭ Step
          </button>
          <button data-testid="btn-stop" className="stop" onClick={() => store.stop()} title="Stop and return to editing (Shift+F5 or Esc)">
            ■ Stop
          </button>
        </>
      )}
      <span className="grow" />
      <span className={`problem-count${errors > 0 ? ' bad' : ''}`} data-testid="problem-count" title="Problems found in this scene">
        {problems.length === 0 ? 'No problems' : `${problems.length} problem${problems.length > 1 ? 's' : ''}`}
      </span>
      <button data-testid="btn-palette" onClick={() => document.dispatchEvent(new CustomEvent('tw:palette'))} title="Find any command (Ctrl+K)">
        Commands…
      </button>
      <button onClick={() => document.dispatchEvent(new CustomEvent('tw:shortcuts'))}>Shortcuts</button>
      <button data-testid="btn-theme" onClick={() => store.setTheme(theme === 'dark' ? 'light' : 'dark')} title="Switch light / dark theme">
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </header>
  );
}

export function EditorShell() {
  const theme = useApp((s) => s.theme);
  const [overrides, setKeys] = useShortcuts();
  useKeyDispatcher(overrides);
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const reset = (): void => {
      const api = apiRef.current;
      if (!api) return;
      api.clear();
      buildDefault(api);
      void store.saveSetting('layout', null);
    };
    document.addEventListener('tw:reset-layout', reset);
    return () => document.removeEventListener('tw:reset-layout', reset);
  }, []);

  const onReady = (e: DockviewReadyEvent): void => {
    apiRef.current = e.api;
    void window.tilewright.settings.get().then((s) => {
      const saved = s.layout as { version?: number; data?: unknown } | null | undefined;
      let restored = false;
      if (saved && saved.version === LAYOUT_VERSION && saved.data) {
        try {
          e.api.fromJSON(saved.data as Parameters<DockviewApi['fromJSON']>[0]);
          restored = e.api.panels.length >= 6;
        } catch {
          restored = false;
        }
      }
      if (!restored) {
        e.api.clear();
        buildDefault(e.api);
      }
      e.api.onDidLayoutChange(() => {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void store.saveSetting('layout', { version: LAYOUT_VERSION, data: e.api.toJSON() }), 600);
      });
    });
  };

  return (
    <div className="shell" data-testid="editor-shell">
      <Toolbar />
      <div className="dock">
        <DockviewReact className={`dockview-theme-${theme}`} components={components} onReady={onReady} />
      </div>
      <StatusBar />
      <Toasts />
      <CommandPalette overrides={overrides} />
      <ShortcutsDialog overrides={overrides} setKeys={setKeys} />
      <NewSceneDialog />
      <RecoveryDialog />
    </div>
  );
}

export { viewportRef };
