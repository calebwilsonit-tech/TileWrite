import { useDeferredValue, useMemo } from 'react';
import { useApp, store } from '../app/store';
import { viewportRef } from '../app/commands';
import { validateScene, type Problem } from '../model/validate';

export function useProblems(): Problem[] {
  const version = useApp((s) => s.docVersion);
  const deferred = useDeferredValue(version);
  return useMemo(() => (store.doc ? validateScene(store.doc) : []), [deferred]);
}

export function goTo(p: Problem): void {
  const t = p.target;
  if (!t) return;
  if (t.kind === 'entity') store.select([t.id]);
  else if (t.kind === 'region') store.set({ selection: [], selectedRegion: t.id });
  else store.select([]);
  if (t.kind === 'cell') viewportRef.current?.focusCell(t.x + 0.5, t.y + 0.5);
  else viewportRef.current?.focusCell(t.x, t.y);
}

export function ProblemsPanel() {
  const problems = useProblems();
  return (
    <div className="panel problems" data-testid="problems-panel">
      {problems.length === 0 ? (
        <p className="hint ok" data-testid="no-problems">
          No problems found.
        </p>
      ) : (
        <ul className="problem-list">
          {problems.map((p) => (
            <li key={p.id} className={p.severity} data-testid="problem">
              <span className="badge" aria-label={p.severity}>
                {p.severity === 'error' ? '✕' : '!'}
              </span>
              <span className="msg">{p.message}</span>
              {p.target && (
                <button onClick={() => goTo(p)} title="Select it and show it in the viewport">
                  Go to
                </button>
              )}
              <button disabled title="Arrives with the Claude assistant (M11)">
                Explain
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ConsolePanel() {
  const log = useApp((s) => s.log);
  return (
    <div className="panel console" data-testid="console-panel">
      {log.length === 0 ? (
        <p className="hint">Messages from the editor and from the game while it runs appear here.</p>
      ) : (
        <ul className="plain">
          {log.map((l, i) => (
            <li key={i} className={l.kind}>
              <time>{new Date(l.time).toLocaleTimeString()}</time> {l.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HistoryPanel() {
  useApp((s) => s.docVersion);
  const doc = store.doc;
  if (!doc) return null;
  return (
    <div className="panel history" data-testid="history-panel">
      <div className="row">
        <button disabled={!doc.history.canUndo} onClick={() => doc.undo()}>
          Undo{doc.history.undoLabel ? `: ${doc.history.undoLabel}` : ''}
        </button>
        <button disabled={!doc.history.canRedo} onClick={() => doc.redo()}>
          Redo{doc.history.redoLabel ? `: ${doc.history.redoLabel}` : ''}
        </button>
      </div>
      <ol className="plain">
        {doc.history.labels.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
    </div>
  );
}
