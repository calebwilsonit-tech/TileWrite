import { useEffect, useRef, useState } from 'react';
import type * as MonacoTypes from 'monaco-editor';
import { contextOf, gameViewOf, type ScriptEntity, type ScriptGame } from '@tilewright/behaviors';
import { store, useApp } from '../app/store';
import { SCRIPT_TEMPLATES } from '../project/scripts';
import { evaluateWatch } from './script-manager';
import { setupMonaco } from './monaco-setup';

/** What `me` and `game` mean for the watch window: the script stopped at a breakpoint, or the selected object (the player if none). */
function watchContext(): { me?: ScriptEntity; game?: ScriptGame } {
  const hit = store.hitContext;
  if (hit) return { me: hit.me, game: hit.game };
  const play = window.__play;
  if (!play) return {};
  const sim = play.sim;
  const sel = store.state.selection[0];
  const entity = (sel ? sim.world.get(sim.runtime.ids.get(sel) ?? -1) : undefined) ?? sim.world.withTag('player')[0];
  if (!entity) return {};
  const game = gameViewOf(contextOf(sim), entity, { log: () => undefined });
  return { me: game.view(entity), game };
}

const WATCH_KEY = 'tilewright.watches';

export default function CodeView() {
  useApp((s) => s.scriptVersion);
  const theme = useApp((s) => s.theme);
  const breakpoints = useApp((s) => s.breakpoints);
  const hit = useApp((s) => s.debugHit);
  const problems = useApp((s) => s.scriptProblems);
  const mode = useApp((s) => s.mode);
  const log = useApp((s) => s.log);
  const open = useApp((s) => s.openScript);
  const names = [...store.scripts.keys()].sort((a, b) => a.localeCompare(b));
  const current = open && store.scripts.has(open) ? open : (names[0] ?? null);

  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, MonacoTypes.editor.ITextModel>());
  const decorations = useRef<MonacoTypes.editor.IEditorDecorationsCollection | null>(null);
  const monacoRef = useRef<typeof MonacoTypes | null>(null);
  const currentRef = useRef<string | null>(current);
  currentRef.current = current;
  const quiet = useRef(false);
  const [fresh, setFresh] = useState('');
  const [template, setTemplate] = useState('empty');
  const [watches, setWatches] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(WATCH_KEY) ?? '["me.x","me.y","game.vars"]') as string[];
    } catch {
      return ['me.x', 'me.y', 'game.vars'];
    }
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [watchDraft, setWatchDraft] = useState('');

  // the editor itself
  useEffect(() => {
    const monaco = setupMonaco();
    monacoRef.current = monaco;
    const ed = monaco.editor.create(host.current!, {
      theme: store.state.theme === 'dark' ? 'vs-dark' : 'vs',
      glyphMargin: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      tabSize: 2,
      model: null,
    });
    editor.current = ed;
    decorations.current = ed.createDecorationsCollection();
    ed.onMouseDown((e) => {
      const name = currentRef.current;
      if (name && (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) && e.target.position) {
        store.toggleBreakpoint(name, e.target.position.lineNumber);
      }
    });
    const modelMap = models.current;
    return () => {
      ed.dispose();
      for (const m of modelMap.values()) m.dispose();
      modelMap.clear();
      editor.current = null;
    };
  }, []);

  // one model per script, kept in step with the store
  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editor.current;
    if (!monaco || !ed) return;
    for (const [name, source] of store.scripts) {
      let m = models.current.get(name);
      if (!m) {
        m = monaco.editor.createModel(source, 'typescript', monaco.Uri.parse(`file:///scripts/${name}.ts`));
        m.onDidChangeContent(() => {
          if (!quiet.current) store.putScript(name, m!.getValue());
        });
        models.current.set(name, m);
      } else if (m.getValue() !== source) {
        quiet.current = true;
        m.setValue(source);
        quiet.current = false;
      }
    }
    for (const [name, m] of models.current) {
      if (!store.scripts.has(name)) {
        m.dispose();
        models.current.delete(name);
      }
    }
    const want = current ? (models.current.get(current) ?? null) : null;
    if (ed.getModel() !== want) ed.setModel(want);
  });

  // breakpoints, the line the game stopped at, and compile problems
  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editor.current;
    if (!monaco || !ed || !current) return;
    const lines = breakpoints[current] ?? [];
    const decs: MonacoTypes.editor.IModelDeltaDecoration[] = lines.map((l) => ({
      range: new monaco.Range(l, 1, l, 1),
      options: { glyphMarginClassName: 'tw-bp-glyph', glyphMarginHoverMessage: { value: 'Breakpoint: the game pauses after the step in which this line runs. Click to remove.' } },
    }));
    if (hit && hit.script === current) decs.push({ range: new monaco.Range(hit.line, 1, hit.line, 1), options: { isWholeLine: true, className: 'tw-hit-line', glyphMarginClassName: 'tw-hit-glyph' } });
    decorations.current?.set(decs);
    if (hit && hit.script === current) ed.revealLineInCenter(hit.line);
    const model = models.current.get(current);
    if (model) {
      monaco.editor.setModelMarkers(
        model,
        'tilewright',
        problems
          .filter((p) => p.script === current)
          .map((p) => ({ severity: monaco.MarkerSeverity.Error, message: p.message, startLineNumber: Math.max(1, p.line), startColumn: 1, endLineNumber: Math.max(1, p.line), endColumn: 200 })),
      );
    }
  }, [breakpoints, hit, current, problems]);

  useEffect(() => {
    monacoRef.current?.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
  }, [theme]);

  // the watch window
  useEffect(() => {
    const id = window.setInterval(() => {
      const { me, game } = watchContext();
      void Promise.all(watches.map(async (w) => [w, await evaluateWatch(w, me, game)] as const)).then((pairs) => setValues(Object.fromEntries(pairs)));
    }, 500);
    return () => window.clearInterval(id);
  }, [watches]);

  const saveWatches = (next: string[]): void => {
    setWatches(next);
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };

  const create = (): void => {
    const tpl = SCRIPT_TEMPLATES.find((t) => t.id === template) ?? SCRIPT_TEMPLATES[0]!;
    const name = fresh.trim();
    void store.newScript(name, tpl.source(name)).then((ok) => {
      if (ok) {
        store.set({ openScript: name });
        setFresh('');
      }
    });
  };

  return (
    <div className="code-view" data-testid="code-view">
      <aside className="code-side">
        <h3>Scripts</h3>
        <ul className="plain" data-testid="script-list">
          {names.map((n) => (
            <li key={n}>
              <button className={n === current ? 'on' : ''} data-testid={`script-${n}`} onClick={() => store.set({ openScript: n })}>
                {n}
                {problems.some((p) => p.script === n) ? ' (!)' : ''}
              </button>
            </li>
          ))}
          {names.length === 0 && <li className="hint">No scripts yet. Make one below.</li>}
        </ul>
        <input data-testid="script-new-name" placeholder="New script name" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <select data-testid="script-template" value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Start from">
          {SCRIPT_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <button data-testid="script-new" onClick={create}>
          Make a script
        </button>
        {current && (
          <button
            className="small"
            data-testid="script-delete"
            onClick={() => {
              void store.removeScript(current);
              store.set({ openScript: null });
            }}
          >
            Delete "{current}"
          </button>
        )}
        <p className="hint">Add a script to an object with Behaviours - Add in the Inspector. Click beside a line number to set a breakpoint.</p>
      </aside>
      <section className="code-main">
        {hit && (
          <div className="code-hit" data-testid="debug-hit">
            Stopped at line {hit.line} of "{hit.script}" (the game pauses after the step in which a breakpoint line runs).
            <button onClick={() => store.togglePause()}>Resume</button>
            <button onClick={() => store.step()}>Step</button>
            <button onClick={() => store.stop()}>Stop</button>
          </div>
        )}
        <div className="code-editor" ref={host} data-testid="code-editor" />
        <div className="code-bottom">
          <div className="code-col" data-testid="script-problems">
            <h4>Problems</h4>
            {problems.length === 0 ? <p className="hint ok">No problems in your scripts.</p> : null}
            <ul className="plain">
              {problems.map((p, i) => (
                <li key={i} className="error">
                  <button className="small" onClick={() => store.set({ openScript: p.script })}>
                    {p.script}
                    {p.line > 0 ? `:${p.line}` : ''}
                  </button>{' '}
                  {p.message}
                </li>
              ))}
            </ul>
          </div>
          <div className="code-col" data-testid="watch-window">
            <h4>Watch {mode === 'play' ? '' : '(while the game runs)'}</h4>
            <ul className="plain">
              {watches.map((w) => (
                <li key={w} className="watch">
                  <code>{w}</code> = <span data-testid={`watch-value-${w}`}>{values[w] ?? ''}</span>{' '}
                  <button className="small" aria-label={`Stop watching ${w}`} onClick={() => saveWatches(watches.filter((x) => x !== w))}>
                    x
                  </button>
                </li>
              ))}
            </ul>
            <input
              data-testid="watch-add"
              placeholder="me.x, game.vars.coins ... then Enter"
              value={watchDraft}
              onChange={(e) => setWatchDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && watchDraft.trim()) {
                  saveWatches([...new Set([...watches, watchDraft.trim()])]);
                  setWatchDraft('');
                }
              }}
            />
            <p className="hint">`me` is the object the script is on (or the selected object); `game` is the game.</p>
          </div>
          <div className="code-col" data-testid="code-console">
            <h4>Console</h4>
            <ul className="plain">
              {log
                .slice(-40)
                .reverse()
                .map((l, i) => (
                  <li key={i} className={l.kind}>
                    {l.text}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
