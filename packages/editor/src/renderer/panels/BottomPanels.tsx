import { useDeferredValue, useMemo } from 'react';
import { formatCrashReport } from '@tilewright/runtime';
import { useApp, store } from '../app/store';
import { viewportRef } from '../app/commands';
import { validateScene, type Problem } from '../model/validate';
import { storyVariables } from '../model/story-vars';
import type { ProjectProblem } from '../project/check';
import { studio, useStudio } from '../studio/store';
import { assistant } from '../assistant/store';

const problemText = (p: Pick<Problem, 'severity' | 'message' | 'target'>): string => {
  const e = p.target?.kind === 'entity' ? store.doc?.getEntity(p.target.id) : undefined;
  return `Problems panel (${p.severity}): ${p.message}${e ? ` (about the object "${e.name}" with id ${e.id})` : ''}`;
};

export function useProblems(): Problem[] {
  const version = useApp((s) => s.docVersion);
  const assets = useStudio((s) => s.assetsVersion);
  const prefabs = useApp((s) => s.prefabNames);
  const analysis = useApp((s) => s.analysis);
  const storyVersion = useApp((s) => s.storyVersion);
  const deferred = useDeferredValue(version);
  const scene = useMemo(() => (store.doc ? validateScene(store.doc, new Set(studio.assets.keys()), new Set(prefabs), storyVariables(store.story.dialogues, store.story.cutscenes)) : []), [deferred, assets, prefabs, storyVersion]);
  // puzzle checks (bypasses, soft-locks) come from the last time they were run
  const puzzles = useMemo<Problem[]>(
    () =>
      (analysis?.issues ?? []).map((i) => ({
        id: `puzzle-${i.id}`,
        severity: i.severity,
        message: i.message,
        target: i.entity && i.x !== undefined ? { kind: 'entity' as const, id: i.entity, x: i.x + 0.5, y: i.y! + 0.5 } : i.x !== undefined ? { kind: 'cell' as const, x: i.x, y: i.y! } : undefined,
      })),
    [analysis],
  );
  return useMemo(() => [...scene, ...puzzles], [scene, puzzles]);
}

export function goTo(p: Pick<Problem, 'target'>): void {
  const t = p.target;
  if (!t) return;
  if (t.kind === 'entity') store.select([t.id]);
  else if (t.kind === 'region') store.set({ selection: [], selectedRegion: t.id });
  else store.select([]);
  if (t.kind === 'cell') viewportRef.current?.focusCell(t.x + 0.5, t.y + 0.5);
  else viewportRef.current?.focusCell(t.x, t.y);
}

async function openAndGo(p: ProjectProblem): Promise<void> {
  if (p.scene && p.scene !== store.state.scenePath) await store.guard('Opening the scene', () => store.openScene(p.scene));
  if (p.x === undefined || p.y === undefined) return;
  goTo({ target: p.entity ? { kind: 'entity', id: p.entity, x: p.x + 0.5, y: p.y + 0.5 } : { kind: 'cell', x: p.x, y: p.y } });
}

function RuntimeError() {
  const err = useApp((s) => s.runtimeError);
  if (!err) return null;
  const text = formatCrashReport(err);
  return (
    <section className="runtime-error" data-testid="runtime-error">
      <p className="msg">
        <strong>The game stopped.</strong> <span data-testid="runtime-error-headline">{err.headline}</span>
      </p>
      <details>
        <summary>Details for finding the cause</summary>
        <pre data-testid="runtime-error-details">{text}</pre>
      </details>
      <div className="row">
        {err.entity?.sceneId && (
          <button
            data-testid="runtime-error-goto"
            onClick={() => {
              store.stop();
              const e = err.entity!;
              goTo({ target: e.x !== undefined ? { kind: 'entity', id: e.sceneId!, x: e.x, y: e.y! } : undefined });
            }}
          >
            Go to that object
          </button>
        )}
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => store.notify('info', 'Copied the report.'), () => store.notify('warn', 'The report could not be copied.'));
          }}
        >
          Copy report
        </button>
        <button data-testid="runtime-error-explain" onClick={() => assistant.ask('explain', `The game stopped with this error report:\n${text}`)} title="Ask Claude what went wrong">
          Explain
        </button>
        <button data-testid="runtime-error-fix" onClick={() => assistant.ask('fix', `The game stopped with this error report:\n${text}`)} title="Ask Claude to fix it (you approve each change)">
          Fix with Claude
        </button>
        <button onClick={() => store.setRuntimeError(null)}>Dismiss</button>
      </div>
    </section>
  );
}

export function ProblemsPanel() {
  const problems = useProblems();
  const analysis = useApp((s) => s.analysis);
  const project = useApp((s) => s.projectCheck);
  const busy = useApp((s) => s.busy);
  return (
    <div className="panel problems" data-testid="problems-panel">
      <RuntimeError />
      <div className="row wrap">
        <button
          data-testid="check-puzzles"
          onClick={() => {
            const n = store.runAnalysis(true).length;
            store.notify('info', n === 0 ? 'No puzzle problems found.' : `Puzzle check found ${n} thing${n === 1 ? '' : 's'} to look at.`);
          }}
          title="Can a gate be bypassed? Is the goal reachable? Can the crates get stuck?"
        >
          Check puzzles
        </button>
        <button
          data-testid="check-project"
          disabled={busy}
          onClick={() => {
            void store.checkWholeProject().then((r) => store.notify('info', r.length === 0 ? 'The whole project checks out.' : `The project check found ${r.length} problem${r.length === 1 ? '' : 's'}.`));
          }}
          title="Every scene, door, conversation and cutscene. Run this before you export."
        >
          Check the whole project
        </button>
        {analysis && <small className="hint">Puzzle check: {analysis.deep ? 'full' : 'quick'}, run after {analysis.version === store.state.docVersion ? 'the latest change' : 'an earlier change'}.</small>}
      </div>
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
              <button data-testid="problem-explain" onClick={() => assistant.ask('explain', problemText(p))} title="Ask Claude what this means">
                Explain
              </button>
              <button data-testid="problem-fix" onClick={() => assistant.ask('fix', problemText(p))} title="Ask Claude to fix it (you approve each change)">
                Fix with Claude
              </button>
            </li>
          ))}
        </ul>
      )}
      {project && (
        <section data-testid="project-check">
          <h4>
            Whole project ({new Date(project.at).toLocaleTimeString()}): {project.problems.length === 0 ? 'all clear' : `${project.problems.length} problem${project.problems.length === 1 ? '' : 's'}`}
          </h4>
          <ul className="problem-list">
            {project.problems.map((p) => (
              <li key={p.id} className={p.severity} data-testid="project-problem">
                <span className="badge" aria-label={p.severity}>
                  {p.severity === 'error' ? '✕' : '!'}
                </span>
                <span className="msg">
                  {p.scene ? <em>{p.scene.replace(/^scenes\//, '').replace('.scene.json', '')}: </em> : null}
                  {p.message}
                </span>
                {p.scene && (
                  <button onClick={() => void openAndGo(p)} title="Open that scene and show the problem">
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
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
