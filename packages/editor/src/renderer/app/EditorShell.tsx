import { Suspense, lazy, useEffect, useRef } from 'react';
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
import { StudioView } from '../studio/StudioView';
import { AssetsPanel } from '../panels/AssetsPanel';
import { EventsPanel } from '../panels/EventsPanel';
import { GraphPanel } from '../panels/GraphPanel';
import { StructuresPanel } from '../panels/StructuresPanel';
import { LibraryPanel } from '../panels/LibraryPanel';
import { HubPanel } from '../panels/HubPanel';
import { UiDesigner } from '../uidesigner/UiDesigner';
import { StoryPanel } from '../panels/StoryPanel';
import { DataPanel } from '../panels/DataPanel';
import { GeneratePanel } from '../panels/GeneratePanel';
import { PlaybotPanel } from '../panels/PlaybotPanel';
import { MixerPanel } from '../panels/MixerPanel';
import { ConnectDialog } from './ConnectDialog';
import { ExportDialog } from '../export/ExportDialog';
import { TutorialCard } from '../tutorial/TutorialCard';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { assistant } from '../assistant/store';
import { PluginPanelView, syncPluginPanels } from '../plugins/PluginPanel';

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  viewport: () => <ViewportPanel />,
  tools: () => <ToolsPanel />,
  tiles: () => <TilesPanel />,
  assets: () => <AssetsPanel />,
  inspector: () => <InspectorPanel />,
  layers: () => <LayersPanel />,
  history: () => <HistoryPanel />,
  events: () => <EventsPanel />,
  graphs: () => <GraphPanel />,
  structures: () => <StructuresPanel />,
  library: () => <LibraryPanel />,
  hub: () => <HubPanel />,
  story: () => <StoryPanel />,
  data: () => <DataPanel />,
  generate: () => <GeneratePanel />,
  playbot: () => <PlaybotPanel />,
  mixer: () => <MixerPanel />,
  assistant: () => <AssistantPanel />,
  problems: () => <ProblemsPanel />,
  console: () => <ConsolePanel />,
  plugin: (props) => <PluginPanelView panelId={String((props.params as { panelId?: string }).panelId ?? '')} />,
};

const CodeView = lazy(() => import('../code/CodeView'));

const LAYOUT_VERSION = 12;

function buildDefault(api: DockviewApi): void {
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  api.addPanel({ id: 'tools', component: 'tools', title: 'Tools', position: { referencePanel: 'viewport', direction: 'left' }, initialWidth: 250 });
  api.addPanel({ id: 'tiles', component: 'tiles', title: 'Tiles', position: { referencePanel: 'tools', direction: 'below' }, initialHeight: 230 });
  api.addPanel({ id: 'assets', component: 'assets', title: 'Assets', position: { referencePanel: 'tiles', direction: 'within' } });
  api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' }, initialWidth: 340 });
  api.addPanel({ id: 'layers', component: 'layers', title: 'Layers', position: { referencePanel: 'inspector', direction: 'within' } });
  api.addPanel({ id: 'history', component: 'history', title: 'History', position: { referencePanel: 'inspector', direction: 'within' } });
  api.addPanel({ id: 'assistant', component: 'assistant', title: 'Claude', position: { referencePanel: 'inspector', direction: 'within' } });
  api.addPanel({ id: 'problems', component: 'problems', title: 'Problems', position: { referencePanel: 'viewport', direction: 'below' }, initialHeight: 190 });
  api.addPanel({ id: 'console', component: 'console', title: 'Console', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'events', component: 'events', title: 'Events', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'graphs', component: 'graphs', title: 'Graph', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'structures', component: 'structures', title: 'Structures', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'library', component: 'library', title: 'Library', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'hub', component: 'hub', title: 'Hub', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'story', component: 'story', title: 'Story', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'data', component: 'data', title: 'Data', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'generate', component: 'generate', title: 'Generate', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'playbot', component: 'playbot', title: 'Playbot', position: { referencePanel: 'problems', direction: 'within' } });
  api.addPanel({ id: 'mixer', component: 'mixer', title: 'Mixer', position: { referencePanel: 'problems', direction: 'within' } });
  api.getPanel('tiles')?.api.setActive();
  api.getPanel('inspector')?.api.setActive();
  api.getPanel('problems')?.api.setActive();
}

function Toolbar() {
  const project = useApp((s) => s.project);
  const scenePath = useApp((s) => s.scenePath);
  const mode = useApp((s) => s.mode);
  const paused = useApp((s) => s.paused);
  const hotReload = useApp((s) => s.hotReload);
  const theme = useApp((s) => s.theme);
  const ws = useApp((s) => s.workspace);
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
      <nav className="workspaces" aria-label="Editors">
        <button data-testid="btn-ws-world" className={ws === 'world' ? 'on' : ''} aria-pressed={ws === 'world'} onClick={() => store.set({ workspace: 'world' })} title="Build the world (Ctrl+1)" disabled={mode === 'play'}>
          World
        </button>
        <button data-testid="btn-ws-sprites" className={ws === 'sprites' ? 'on' : ''} aria-pressed={ws === 'sprites'} onClick={() => store.set({ workspace: 'sprites' })} title="Draw and animate sprites (Ctrl+2)" disabled={mode === 'play'}>
          Sprites
        </button>
        <button data-testid="btn-ws-ui" className={ws === 'ui' ? 'on' : ''} aria-pressed={ws === 'ui'} onClick={() => store.set({ workspace: 'ui' })} title="Design the game's screens: menus, heads-up display, inventories (Ctrl+4)" disabled={mode === 'play'}>
          UI
        </button>
        <button data-testid="btn-ws-code" className={ws === 'code' ? 'on' : ''} aria-pressed={ws === 'code'} onClick={() => store.set({ workspace: 'code' })} title="Write scripts in code (Ctrl+3)">
          Code
        </button>
      </nav>
      {ws === 'world' && (
        <>
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
      <button data-testid="btn-export" onClick={run('file.export')} disabled={mode === 'play'} title="Make the game into a program you can give to other people">
        Export…
      </button>
        </>
      )}
      {(ws === 'world' || ws === 'code' || ws === 'ui') && (
        <>
          <span className="sep" />
          {mode === 'edit' ? (
            <>
              <button
                data-testid="btn-play"
                className="play"
                onClick={() => {
                  if (ws !== 'world') store.set({ workspace: 'world' });
                  store.play();
                }}
                title="Play the scene in the editor (F5)"
              >
                ▶ Play
              </button>
              <button data-testid="btn-run-window" aria-label="Run in a window" onClick={() => void store.runInWindow()} title="Run the game in a window of its own while you keep editing (F8). Press again to restart it with your latest edits.">
                Window
              </button>
              {ws === 'world' && (
                <button data-testid="btn-play-here" onClick={run('play.fromHere')} title="Play starting at the cell under the mouse (Ctrl+Enter)">
                  ▶ From here
                </button>
              )}
            </>
          ) : (
            <>
              <button data-testid="btn-pause" onClick={() => store.togglePause()} aria-pressed={paused} title="Pause or resume (F6)">
                {paused ? '▶ Resume' : '❚❚ Pause'}
              </button>
              <button data-testid="btn-step" onClick={() => store.step()} title="Advance one frame (F10)">
                ⏭ Step
              </button>
              <button data-testid="btn-hot-reload" onClick={() => store.requestHotReload()} title="Put the edits you made while playing into the running game (F7). Objects go back to their start; you, your items, flags and health stay.">
                ↻ Apply edits
              </button>
              <label className="field check inline" title="Reload the game a moment after every edit you make while it runs">
                <input data-testid="chk-hot-reload" type="checkbox" checked={hotReload} onChange={(e) => store.setHotReload(e.target.checked)} />
                <span>As I edit</span>
              </label>
              <button data-testid="btn-stop" className="stop" onClick={() => store.stop()} title="Stop and return to editing (Shift+F5 or Esc)">
                ■ Stop
              </button>
            </>
          )}
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
      <button data-testid="btn-access" onClick={() => document.dispatchEvent(new CustomEvent('tw:accessibility'))} title="Accessibility: text size, colour-blind-safe colours, less motion">
        Aa
      </button>
      <button data-testid="btn-theme" onClick={() => store.setTheme(theme === 'dark' ? 'light' : 'dark')} title="Switch light / dark theme">
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </header>
  );
}

export function EditorShell() {
  const theme = useApp((s) => s.theme);
  const ws = useApp((s) => s.workspace);
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
    const show = (e: Event): void => {
      store.set({ workspace: 'world' });
      const id = (e as CustomEvent<string>).detail;
      window.setTimeout(() => apiRef.current?.getPanel(id)?.api.setActive(), 0);
    };
    document.addEventListener('tw:reset-layout', reset);
    document.addEventListener('tw:show-panel', show);
    void assistant.init();
    return () => {
      document.removeEventListener('tw:reset-layout', reset);
      document.removeEventListener('tw:show-panel', show);
    };
  }, []);

  const stopPanels = useRef<(() => void) | null>(null);
  useEffect(() => () => stopPanels.current?.(), []);

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
      stopPanels.current?.();
      stopPanels.current = syncPluginPanels(e.api);
      e.api.onDidLayoutChange(() => {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void store.saveSetting('layout', { version: LAYOUT_VERSION, data: e.api.toJSON() }), 600);
      });
    });
  };

  return (
    <div className="shell" data-testid="editor-shell">
      <Toolbar />
      <div className="dock" style={ws === 'world' ? undefined : { display: 'none' }}>
        <DockviewReact className={`dockview-theme-${theme}`} components={components} onReady={onReady} />
      </div>
      {ws === 'sprites' && <StudioView />}
      {ws === 'ui' && <UiDesigner />}
      {ws === 'code' && (
        <Suspense fallback={<p className="hint">Loading the code editor...</p>}>
          <CodeView />
        </Suspense>
      )}
      <StatusBar />
      <Toasts />
      <CommandPalette overrides={overrides} />
      <ShortcutsDialog overrides={overrides} setKeys={setKeys} />
      <NewSceneDialog />
      <RecoveryDialog />
      <ConnectDialog />
      <ExportDialog />
      <TutorialCard />
    </div>
  );
}

export { viewportRef };
