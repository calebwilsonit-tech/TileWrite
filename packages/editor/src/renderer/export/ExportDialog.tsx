import { useEffect, useRef, useState } from 'react';
import { PLATFORM_LABEL, defaultSettings, type ExportResult, type ExportSettings, type Platform, type ScriptsBundle } from '@tilewright/exporter';
import { host } from '@tilewright/behaviors';
import { store } from '../app/store';
import { usePlugins } from '../plugins/hooks';
import { api } from '../project/api';
import { checkForExport, exportGame, loadExportSettings, saveExportSettings, type ExportProblem } from './export';

/** File > Export: choose the game's name, window and icon, see what must be fixed first, then make a folder and a zip. */
export function ExportDialog() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<ExportSettings>(defaultSettings(''));
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<ExportProblem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [failure, setFailure] = useState('');
  const [platform, setPlatform] = useState<Platform>('win32');
  const [alsoMake, setAlsoMake] = useState<string[]>([]);
  const [targetNotes, setTargetNotes] = useState<string[]>([]);
  usePlugins();
  const [canExport, setCanExport] = useState(true);
  const scripts = useRef<ScriptsBundle>({ format: 1, scripts: {} });
  const run = useRef(0);

  const recheck = async (s: ExportSettings): Promise<void> => {
    const mine = ++run.current;
    setProblems(null);
    const c = await checkForExport(s);
    if (mine !== run.current) return;
    scripts.current = c.scripts;
    setProblems(c.problems);
  };

  useEffect(() => {
    const show = (): void => {
      setOpen(true);
      setResult(null);
      setFailure('');
      setProgress('');
      void (async () => {
        const [loaded, info] = await Promise.all([loadExportSettings(), api().exporter.info()]);
        setSettings(loaded.settings);
        setNote(loaded.problem ?? '');
        setPlatform(info.platform as Platform);
        setCanExport(info.canExport);
        await recheck(loaded.settings);
      })();
    };
    document.addEventListener('tw:export', show);
    return () => document.removeEventListener('tw:export', show);
  }, []);

  useEffect(() => api().exporter.onProgress((t) => setProgress(t)), []);

  if (!open) return null;
  const errors = problems?.filter((p) => p.severity === 'error') ?? [];
  const warnings = problems?.filter((p) => p.severity === 'warn') ?? [];
  const change = (patch: Partial<ExportSettings>): void => setSettings((s) => ({ ...s, ...patch }));
  const close = (): void => {
    if (busy) return;
    void saveExportSettings(settings).catch(() => undefined);
    setOpen(false);
  };

  const go = async (): Promise<void> => {
    setFailure('');
    setResult(null);
    const out = await api().chooseFolder('Choose where to put the finished game');
    if (!out) return;
    setBusy(true);
    setTargetNotes([]);
    try {
      const made = await exportGame(settings, scripts.current, out);
      setResult(made);
      const notes: string[] = [];
      for (const id of alsoMake) {
        const t = host.ext.exportTargets.get(id);
        if (!t?.finish) continue;
        try {
          notes.push(`${t.label}: ${await t.finish({ folder: made.folder, exe: made.exe, zip: made.zip, name: settings.gameName }, host.editorHostFor(t.plugin))}`);
        } catch (e) {
          notes.push(`${t.label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setTargetNotes(notes);
    } catch (e) {
      setFailure(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The game could not be exported.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="dialog export-dialog" role="dialog" aria-label="Export the game" data-testid="export-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Export the game for {PLATFORM_LABEL[platform]}</h2>
        <p className="hint">Makes a folder with a program you can run (and a zip of it). It runs without Tilewright or the internet.</p>
        {note && <p className="warn-text">{note}</p>}
        <div className="export-grid">
          <label className="field">
            <span>Game name</span>
            <input data-testid="export-name" value={settings.gameName} onChange={(e) => change({ gameName: e.target.value })} onBlur={() => void recheck(settings)} />
          </label>
          <label className="field">
            <span>Version</span>
            <input data-testid="export-version" value={settings.version} onChange={(e) => change({ version: e.target.value })} onBlur={() => void recheck(settings)} />
          </label>
          <label className="field">
            <span>Window width</span>
            <input data-testid="export-width" type="number" value={settings.windowWidth} onChange={(e) => change({ windowWidth: Number(e.target.value) })} onBlur={() => void recheck(settings)} />
          </label>
          <label className="field">
            <span>Window height</span>
            <input data-testid="export-height" type="number" value={settings.windowHeight} onChange={(e) => change({ windowHeight: Number(e.target.value) })} onBlur={() => void recheck(settings)} />
          </label>
          <label className="field check">
            <input data-testid="export-fullscreen" type="checkbox" checked={settings.fullscreen} onChange={(e) => change({ fullscreen: e.target.checked })} />
            <span>Start full screen (F11 switches)</span>
          </label>
          <label className="field">
            <span>Splash screen text (optional)</span>
            <input data-testid="export-splash" value={settings.splashText} onChange={(e) => change({ splashText: e.target.value })} />
          </label>
          <label className="field wide">
            <span>Window icon (a PNG in the project, optional)</span>
            <input data-testid="export-icon" placeholder="assets/icon.png" value={settings.icon} onChange={(e) => change({ icon: e.target.value.trim() })} onBlur={() => void recheck(settings)} />
          </label>
        </div>

        {[...host.ext.exportTargets.values()].filter((t) => !t.platforms || t.platforms.includes(platform)).length > 0 && (
          <section data-testid="export-targets">
            <h3>Also make</h3>
            {[...host.ext.exportTargets.values()]
              .filter((t) => !t.platforms || t.platforms.includes(platform))
              .map((t) => {
                const why = store.state.project ? (t.check?.(store.state.project.project) ?? []) : [];
                return (
                  <label key={t.id} className="field check">
                    <input data-testid={`export-target-${t.id}`} type="checkbox" checked={alsoMake.includes(t.id)} disabled={why.length > 0} onChange={(e) => setAlsoMake(e.target.checked ? [...alsoMake, t.id] : alsoMake.filter((x) => x !== t.id))} />
                    <span>
                      {t.label}: {t.describe()} {why.length > 0 && <em className="warn-text">{why.join(' ')}</em>}
                    </span>
                  </label>
                );
              })}
          </section>
        )}

        <section data-testid="export-checks">
          <h3>Before exporting</h3>
          {problems === null && <p className="hint">Checking the whole project...</p>}
          {problems !== null && errors.length === 0 && (
            <p className="hint ok" data-testid="export-ready">
              The project checks out{warnings.length > 0 ? `, with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}.
            </p>
          )}
          {errors.length > 0 && (
            <>
              <p className="warn-text">These must be fixed before the game can be exported:</p>
              <ul className="plain" data-testid="export-errors">
                {errors.map((p, i) => (
                  <li key={i} className="error">
                    {p.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {warnings.length > 0 && (
            <ul className="plain" data-testid="export-warnings">
              {warnings.map((p, i) => (
                <li key={i} className="warn-text">
                  {p.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        {busy && (
          <p className="hint" data-testid="export-progress">
            {progress || 'Working...'}
          </p>
        )}
        {failure && (
          <p className="warn-text" role="alert" data-testid="export-failure">
            {failure}
          </p>
        )}
        {result && (
          <div data-testid="export-result" className="hint ok">
            <p>
              Done: <strong data-testid="export-exe">{result.exe}</strong> ({result.files} game files).
            </p>
            {result.zip && (
              <p>
                Zip: <span data-testid="export-zip">{result.zip}</span>
              </p>
            )}
            {result.zipProblem && <p className="warn-text">{result.zipProblem}</p>}
            {targetNotes.map((n) => (
              <p key={n} data-testid="export-target-note">
                {n}
              </p>
            ))}
          </div>
        )}
        {!canExport && <p className="warn-text">This editor cannot make games here: it needs to be built first (npm run build), on Windows or Linux.</p>}
        <div className="row end">
          <button onClick={close} disabled={busy} data-testid="export-close">
            Close
          </button>
          <button className="primary" data-testid="export-go" disabled={busy || problems === null || errors.length > 0 || !canExport} onClick={() => void go()}>
            {busy ? 'Exporting...' : 'Export...'}
          </button>
        </div>
      </div>
    </div>
  );
}
