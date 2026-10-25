import { useEffect, useMemo, useState } from 'react';
import { csvToStrings, stringsToCsv, type LanguageData } from '@tilewright/runtime';
import { api, joinPath } from '../project/api';
import { assetFs } from '../project/assetFs';
import { LOCALE_DIR, collectStrings, coverage, interfaceTexts, deleteLanguage, languageProblem, loadLanguages, makeLanguage, saveLanguage, type SourceString } from '../project/localization';
import { store, useApp } from './store';

/**
 * Translations: the text you wrote is the source language; add a language, press "Find text" and type a translation
 * beside each line. Anything left empty shows the original text in the game. Saved as one file per language.
 */
export function TranslationsDialog() {
  const project = useApp((s) => s.project);
  const [open, setOpen] = useState(false);
  const [languages, setLanguages] = useState<LanguageData[]>([]);
  const [code, setCode] = useState('');
  const [sources, setSources] = useState<SourceString[]>([]);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const scan = async (): Promise<SourceString[]> => {
    const scenes = await store.loadAllScenes();
    const found = collectStrings(store.story, [...scenes].map(([path, scene]) => ({ path, scene })), undefined, store.data, interfaceTexts(store.uiLayout, store.state.project?.project));
    setSources(found);
    return found;
  };

  useEffect(() => {
    const show = (): void => {
      const p = store.state.project;
      if (!p) return;
      setOpen(true);
      setBusy(true);
      void (async () => {
        const { languages: found, problems } = await loadLanguages(assetFs, p.dir);
        for (const text of problems) store.notify('warn', text);
        setLanguages(found);
        setCode((c) => (found.some((l) => l.code === c) ? c : (found[0]?.code ?? '')));
        setDirty(false);
        await scan();
        setBusy(false);
      })();
    };
    document.addEventListener('tw:translations', show);
    return () => document.removeEventListener('tw:translations', show);
  }, []);

  const lang = languages.find((l) => l.code === code);
  const cov = useMemo(() => (lang ? coverage(lang, sources) : null), [lang, sources]);
  if (!open || !project) return null;

  const update = (next: LanguageData): void => {
    setLanguages((all) => all.map((l) => (l.code === next.code ? next : l)));
    setDirty(true);
  };
  const setText = (source: string, text: string): void => {
    if (lang) update({ ...lang, strings: { ...lang.strings, [source]: text } });
  };
  const save = async (): Promise<void> => {
    if (!lang) return;
    setBusy(true);
    try {
      await saveLanguage(assetFs, project.dir, lang);
      setDirty(false);
      store.notify('info', `Saved ${lang.name}.`);
    } catch (e) {
      store.notify('error', e instanceof Error ? e.message : 'The language could not be saved.');
    }
    setBusy(false);
  };
  const add = async (): Promise<void> => {
    const problem = languageProblem(newCode, newName, languages.map((l) => l.code));
    if (problem) return store.notify('warn', problem);
    const fresh = makeLanguage(newCode, newName);
    await saveLanguage(assetFs, project.dir, fresh);
    setLanguages((all) => [...all, fresh].sort((a, b) => a.code.localeCompare(b.code)));
    setCode(fresh.code);
    setNewCode('');
    setNewName('');
  };
  const remove = async (): Promise<void> => {
    if (!lang || !window.confirm(`Delete the language "${lang.name}" and all its translations?`)) return;
    await deleteLanguage(assetFs, project.dir, lang.code);
    const rest = languages.filter((l) => l.code !== lang.code);
    setLanguages(rest);
    setCode(rest[0]?.code ?? '');
  };
  const exportCsv = async (): Promise<void> => {
    if (!lang) return;
    const file = joinPath(project.dir, LOCALE_DIR, `${lang.code}.csv`);
    await assetFs.write(file, stringsToCsv(sources.map((s) => [s.text, lang.strings[s.text] ?? ''])));
    store.notify('info', `Wrote ${LOCALE_DIR}/${lang.code}.csv in the project folder. Send it to a translator and bring it back with Import.`);
  };
  const importCsv = async (): Promise<void> => {
    if (!lang) return;
    try {
      const file = await api().importFile('Import a translated CSV file', ['csv']);
      if (!file) return;
      const r = csvToStrings(new TextDecoder().decode(file.bytes), new Set(sources.map((s) => s.text)));
      update({ ...lang, strings: { ...lang.strings, ...r.strings } });
      store.notify('info', `Took ${Object.keys(r.strings).length} translations from the file${r.skipped > 0 ? `; ${r.skipped} lines did not match any text in the game and were skipped` : ''}. Press Save to keep them.`);
    } catch (e) {
      store.notify('error', e instanceof Error ? e.message : 'The file could not be read.');
    }
  };
  const close = (): void => {
    if (dirty && !window.confirm('Close without saving your translations?')) return;
    setOpen(false);
  };
  const rows = sources.filter((s) => !onlyMissing || !(lang?.strings[s.text] ?? '').trim());

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="dialog wide translations" role="dialog" aria-label="Translations" data-testid="translations-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Translations</h2>
        <p className="hint">The text you wrote is the original. Add a language, then type its version of each line; lines left empty show the original. Players pick their language in Settings.</p>
        <div className="row wrap">
          <label className="field">
            <span>Language</span>
            <select data-testid="tr-language" value={code} onChange={(e) => setCode(e.target.value)} disabled={languages.length === 0}>
              {languages.length === 0 && <option value="">(none yet)</option>}
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} ({l.code})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>New language code</span>
            <input data-testid="tr-new-code" value={newCode} placeholder="fr" onChange={(e) => setNewCode(e.target.value.trim().toLowerCase())} />
          </label>
          <label className="field">
            <span>Its name, as its speakers write it</span>
            <input data-testid="tr-new-name" value={newName} placeholder="Français" onChange={(e) => setNewName(e.target.value)} />
          </label>
          <button data-testid="tr-add" onClick={() => void add()}>
            Add language
          </button>
        </div>
        {lang && cov && (
          <>
            <p data-testid="tr-progress">
              {cov.done} of {cov.total} lines translated
              {cov.unused.length > 0 && ` · ${cov.unused.length} translated line${cov.unused.length === 1 ? '' : 's'} no longer in the game`}
            </p>
            <div className="row wrap">
              <label className="field check">
                <input data-testid="tr-only-missing" type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
                <span>Only lines without a translation</span>
              </label>
              <button data-testid="tr-rescan" disabled={busy} onClick={() => void scan()} title="Look through every scene, conversation, cutscene and item for new or changed text">
                Find text
              </button>
              <button data-testid="tr-export" onClick={() => void exportCsv()}>
                Export CSV
              </button>
              <button data-testid="tr-import" onClick={() => void importCsv()}>
                Import CSV…
              </button>
              <button onClick={() => void remove()}>Delete this language</button>
            </div>
            <div className="tr-table" data-testid="tr-table">
              {rows.map((s, i) => (
                <div key={s.text} className="tr-row">
                  <div className="tr-source">
                    <span>{s.text}</span>
                    <small>{s.where}</small>
                  </div>
                  <textarea
                    aria-label={`Translation of: ${s.text}`}
                    data-testid={`tr-text-${i}`}
                    rows={s.text.length > 50 ? 3 : 1}
                    value={lang.strings[s.text] ?? ''}
                    placeholder={s.text}
                    onChange={(e) => setText(s.text, e.target.value)}
                  />
                </div>
              ))}
              {rows.length === 0 && <p className="hint">{sources.length === 0 ? 'No text found yet. Write a conversation or a message first.' : 'Everything is translated.'}</p>}
            </div>
          </>
        )}
        {!lang && <p className="hint">Add a language above to begin.</p>}
        <div className="row end">
          <button onClick={close}>Close</button>
          <button className="primary" data-testid="tr-save" disabled={!dirty || busy} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
