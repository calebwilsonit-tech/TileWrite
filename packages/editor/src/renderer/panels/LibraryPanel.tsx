import { useEffect, useMemo, useState } from 'react';
import { store, useApp } from '../app/store';
import { buildBehaviourPack, buildSoundPack, buildSpritePack, buildStructurePack, buildTilePack, buildUiPack, guessBehaviourNeeds, type Built } from '../library/build';
import { updatesAvailable } from '../library/links';
import { PACK_KIND_LABELS, describePack, type Pack, type PackKind, type Resolution } from '../library/pack';
import { addFromLibrary, currentSource, exportItem, importPackFile, openLibrary, previewClashes, readLinks, saveToLibrary, updateLinked } from '../library/session';
import { useLibraryTick } from '../library/changes';
import { allTags, searchItems, type Library, type LibraryItem } from '../library/store';
import { ownTiles } from '../project/tiles';
import { studio, useStudio } from '../studio/store';

const SAVE_KINDS: PackKind[] = ['tile', 'tileset', 'prop', 'attachment', 'character', 'animation', 'ui', 'structure', 'behaviour', 'sound'];

/** Your own collection of art and building blocks, kept outside any project so every project can use it. */
export function LibraryPanel() {
  const project = useApp((s) => s.project);
  const [lib, setLib] = useState<Library | null>(null);
  const [version, setVersion] = useState(0);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<PackKind | ''>('');
  const [tag, setTag] = useState('');
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [updates, setUpdates] = useState(0);
  const tick = useLibraryTick();
  /** Counts reloads from disk: the library object stays the same, so the list is rebuilt when this changes. */
  const [loaded, setLoaded] = useState(0);
  const refresh = (): void => setVersion((v) => v + 1);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const l = await openLibrary();
        if (alive) {
          setLib(l);
          setLoaded((n) => n + 1);
        }
        if (project && alive) setUpdates(updatesAvailable(await readLinks(project.dir), l.index.items).length);
      } catch (e) {
        store.notify('error', (e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [version, project, tick]);

  const guard = async (what: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      refresh();
    } catch (e) {
      store.notify('error', `${what}: ${(e as Error).message}`);
    }
  };

  const items = useMemo(() => (lib ? searchItems(lib.index.items, { text, kind, tag, folder }) : []), [lib, text, kind, tag, folder, version, loaded]);
  if (!lib) return <div className="panel" data-testid="library-panel" />;

  return (
    <div className="panel library-panel" data-testid="library-panel">
      <div className="row library-search">
        <input data-testid="library-search" placeholder="Search by name, tag or kind" value={text} onChange={(e) => setText(e.target.value)} />
        <select data-testid="library-kind" value={kind} onChange={(e) => setKind(e.target.value as PackKind | '')} aria-label="Kind">
          <option value="">All kinds</option>
          {SAVE_KINDS.map((k) => (
            <option key={k} value={k}>
              {PACK_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select data-testid="library-tag" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
          <option value="">All tags</option>
          {allTags(lib.index.items).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="library-folders" data-testid="library-folders">
        <button className={folder === undefined ? 'on' : ''} data-testid="library-folder-all" onClick={() => setFolder(undefined)}>
          Everything
        </button>
        <button className={folder === '' ? 'on' : ''} data-testid="library-folder-none" onClick={() => setFolder('')}>
          No folder
        </button>
        {lib.index.folders.map((f) => (
          <button key={f} className={folder === f ? 'on' : ''} data-testid={`library-folder-${f}`} onClick={() => setFolder(f)}>
            {f}
          </button>
        ))}
        <input data-testid="library-newfolder" placeholder="New folder" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          void guard('Making the folder', async () => {
            const problem = await lib.addFolder(newFolder);
            if (problem) store.notify('warn', problem);
            else setNewFolder('');
          });
        }} />
      </div>

      <div className="row">
        <button data-testid="library-import" onClick={() => void guard('Importing the pack', async () => {
          const r = await importPackFile();
          if (r.error) store.notify('warn', r.error);
          else if (r.item) store.notify('info', `Added "${r.item.name}" to your library.`);
        })}>
          Import a pack file...
        </button>
        {project && updates > 0 && (
          <button data-testid="library-update" onClick={() => void guard('Updating', async () => {
            const r = await updateLinked();
            store.notify('info', r.updated.length > 0 ? `Updated: ${r.updated.join(', ')}.` : 'Everything is up to date.');
            if (r.gone.length > 0) store.notify('warn', `No longer in the library: ${r.gone.join(', ')}.`);
          })}>
            Update linked items ({updates})
          </button>
        )}
      </div>

      <h3>Your library</h3>
      {items.length === 0 && (
        <p className="hint" data-testid="library-empty">
          {lib.index.items.length === 0 ? 'Nothing here yet. Use "Save to the library" below to keep a tile, prop, character, structure or interface piece for every project.' : 'Nothing matches that search.'}
        </p>
      )}
      <div className="library-grid" data-testid="library-grid">
        {items.map((i) => (
          <div key={i.id} className={`library-card${open === i.id ? ' on' : ''}`} data-testid={`library-item-${i.id}`}>
            <button className="library-thumb" title="Details" onClick={() => setOpen(open === i.id ? null : i.id)}>
              {i.thumb ? <img src={i.thumb} alt="" width={48} height={48} style={{ imageRendering: 'pixelated' }} /> : <span>{PACK_KIND_LABELS[i.kind]}</span>}
            </button>
            <strong>{i.name}</strong>
            <span className="hint">
              {PACK_KIND_LABELS[i.kind]} - v{i.current}
              {i.code ? ' - has code' : ''}
            </span>
            <button disabled={!project} data-testid={`library-add-${i.id}`} onClick={() => setAdding(adding === i.id ? null : i.id)}>
              Add to project
            </button>
          </div>
        ))}
      </div>

      {adding && lib.item(adding) && <AddDialog lib={lib} item={lib.item(adding)!} onClose={() => setAdding(null)} />}
      {open && lib.item(open) && <Details lib={lib} item={lib.item(open)!} folders={lib.index.folders} onChange={refresh} guard={guard} onGone={() => setOpen(null)} />}

      <SaveSection lib={lib} onSaved={refresh} />
    </div>
  );
}

function AddDialog({ lib, item, onClose }: { lib: Library; item: LibraryItem; onClose: () => void }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [clashes, setClashes] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [mode, setMode] = useState<'link' | 'copy'>('link');
  const [how, setHow] = useState<Resolution>('rename');
  const [approved, setApproved] = useState(false);
  const [result, setResult] = useState('');
  useEffect(() => {
    void (async () => {
      const p = await lib.readPack(item.id);
      setPack(p);
      const r = await previewClashes(p);
      setClashes(r.clashes.map((c) => `${c.kind} "${c.name}"`));
      setProblems(r.problems);
    })().catch((e) => store.notify('error', (e as Error).message));
  }, [lib, item.id]);
  if (!pack) return null;
  const entries = describePack(pack);
  return (
    <div className="library-add" data-testid="library-add-dialog">
      <h3>Add "{item.name}" to this project</h3>
      <p className="hint" data-testid="library-add-contents">
        Brings in: {entries.map((e) => `${e.kind} ${e.name}`).join(', ') || 'nothing'}.
      </p>
      <label className="field">
        <span>How</span>
        <select data-testid="library-mode" value={mode} onChange={(e) => setMode(e.target.value as 'link' | 'copy')}>
          <option value="link">Link: follow the library (you can update it later)</option>
          <option value="copy">Copy: the project owns it from now on</option>
        </select>
      </label>
      {clashes.length > 0 && (
        <>
          <p className="warn" data-testid="library-clashes">
            Names already in this project: {clashes.join(', ')}.
          </p>
          <label className="field">
            <span>What to do</span>
            <select data-testid="library-how" value={how} onChange={(e) => setHow(e.target.value as Resolution)}>
              <option value="rename">Keep both (the new ones get a number)</option>
              <option value="replace">Replace the project's with these</option>
              <option value="skip">Keep the project's, skip these</option>
            </select>
          </label>
        </>
      )}
      {problems.map((p) => (
        <p key={p} className="warn">
          {p}
        </p>
      ))}
      {pack.code && (
        <label className="field">
          <input type="checkbox" data-testid="library-approve-code" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> <span>This pack contains code. I have looked at it and I trust it.</span>
        </label>
      )}
      <div className="row">
        <button
          data-testid="library-add-confirm"
          disabled={pack.code && !approved}
          onClick={() => {
            void addFromLibrary(item.id, { mode, how, approveCode: approved })
              .then((r) => {
                const msg = `Added "${item.name}": ${r.written} files, ${r.tiles} tiles${r.renamed.length ? `; renamed ${r.renamed.join(', ')}` : ''}.`;
                setResult(msg);
                store.notify('info', msg);
              })
              .catch((e) => store.notify('error', (e as Error).message));
          }}
        >
          Add
        </button>
        <button onClick={onClose}>Close</button>
      </div>
      {result && <p data-testid="library-add-result">{result}</p>}
    </div>
  );
}

function Details({ lib, item, folders, onChange, guard, onGone }: { lib: Library; item: LibraryItem; folders: string[]; onChange(): void; guard(what: string, fn: () => Promise<void>): Promise<void>; onGone(): void }) {
  const [name, setName] = useState(item.name);
  const [tags, setTags] = useState(item.tags.join(', '));
  useEffect(() => {
    setName(item.name);
    setTags(item.tags.join(', '));
  }, [item.id, item.name, item.tags.join(',')]);
  return (
    <div className="library-details" data-testid="library-details">
      <h3>{item.name}</h3>
      <label className="field">
        <span>Name</span>
        <input data-testid="library-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== item.name && void guard('Renaming', () => lib.update(item.id, { name }))} />
      </label>
      <label className="field">
        <span>Tags</span>
        <input data-testid="library-tags" value={tags} placeholder="grass, forest" onChange={(e) => setTags(e.target.value)} onBlur={() => void guard('Saving the tags', () => lib.update(item.id, { tags: tags.split(',') }))} />
      </label>
      <label className="field">
        <span>Folder</span>
        <select data-testid="library-move" value={item.folder} onChange={(e) => void guard('Moving', () => lib.update(item.id, { folder: e.target.value }))}>
          <option value="">(none)</option>
          {folders.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <p className="hint">Licence: {item.licence || 'not stated'}</p>
      <h3>Versions</h3>
      <ul className="library-versions" data-testid="library-versions">
        {[...item.versions].reverse().map((v) => (
          <li key={v.n}>
            v{v.n} - {v.savedAt.slice(0, 10)} - {v.note} {item.current === v.n ? <strong>(current)</strong> : <button data-testid={`library-restore-${v.n}`} onClick={() => void guard('Restoring', () => lib.restore(item.id, v.n))}>Use this one</button>}
          </li>
        ))}
      </ul>
      <div className="row">
        <button data-testid="library-export" onClick={() => void guard('Exporting', async () => {
          const where = await exportItem(item.id);
          if (where) store.notify('info', `Saved the pack to ${where}.`);
        })}>
          Save as a pack file...
        </button>
        <button
          className="danger"
          data-testid="library-delete"
          onClick={() => void guard('Deleting', async () => {
            await lib.remove(item.id);
            onGone();
            onChange();
          })}
        >
          Delete from the library
        </button>
      </div>
    </div>
  );
}

function SaveSection({ lib, onSaved }: { lib: Library; onSaved(): void }) {
  const project = useApp((s) => s.project);
  const structureNames = useApp((s) => s.structureNames);
  useApp((s) => s.storyVersion);
  const spriteNames = useStudio((s) => s.names);
  useStudio((s) => s.assetsVersion);
  const sprites = [...spriteNames].sort();
  const sounds = studio.sounds.map((x) => x.file);
  const [kind, setKind] = useState<PackKind>('tile');
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [licence, setLicence] = useState('CC0-1.0');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [replace, setReplace] = useState('');
  const [message, setMessage] = useState('');
  if (!project) return null;
  const src = currentSource()!;
  const options: { value: string; label: string }[] =
    kind === 'tile' || kind === 'tileset'
      ? ownTiles(project.project).filter((t) => t.group === undefined).map((t) => ({ value: String(t.id), label: t.name }))
      : kind === 'structure'
        ? structureNames.map((n) => ({ value: n, label: n }))
        : kind === 'ui'
          ? [...store.uiDoc.prefabs.map((p) => ({ value: `prefab:${p.name}`, label: p.name })), ...store.uiDoc.screens.map((s) => ({ value: `screen:${s.name}`, label: `Screen: ${s.name}` }))]
          : kind === 'behaviour'
            ? store.customBehaviors.map((b) => ({ value: b.name, label: b.name }))
            : kind === 'sound'
              ? sounds.map((n) => ({ value: n, label: n }))
              : sprites.map((n) => ({ value: n, label: n }));
  const toggle = (v: string): void => setPicked((p) => (kind === 'tile' || kind === 'structure' ? [v] : p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const sameKind = lib.index.items.filter((i) => i.kind === kind);

  const save = async (): Promise<void> => {
    if (name.trim().length === 0) return setMessage('Give it a name.');
    if (picked.length === 0) return setMessage('Pick what to save.');
    const info = { name, description, author, licence, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) };
    let built: Built;
    if (kind === 'tile' || kind === 'tileset') built = await buildTilePack(src, kind, info, picked.map(Number));
    else if (kind === 'structure') built = await buildStructurePack(src, info, picked[0]!);
    else if (kind === 'ui') built = buildUiPack(src, info, picked);
    else if (kind === 'sound') built = await buildSoundPack(src, info, picked);
    else if (kind === 'behaviour') {
      const text = JSON.stringify(store.customBehaviors.filter((b) => picked.includes(b.name)));
      const needs = guessBehaviourNeeds(text, store.components.map((c) => c.name), store.tables.map((t) => t.name));
      built = await buildBehaviourPack(src, info, picked, needs);
    } else built = await buildSpritePack(src, kind as 'character' | 'animation' | 'prop' | 'attachment', info, picked);
    const item = await saveToLibrary(built, { id: replace || undefined, tags: info.tags });
    setMessage(`Saved "${item.name}" (version ${item.current})${built.missing.length ? `. Missing from the project: ${built.missing.join(', ')}` : ''}.`);
    setPicked([]);
    setName('');
    onSaved();
  };

  return (
    <div className="library-save" data-testid="library-save">
      <h3>Save to the library</h3>
      <label className="field">
        <span>What</span>
        <select data-testid="library-save-kind" value={kind} onChange={(e) => { setKind(e.target.value as PackKind); setPicked([]); setReplace(''); }}>
          {SAVE_KINDS.map((k) => (
            <option key={k} value={k}>
              {PACK_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="library-picks" data-testid="library-picks">
        {options.length === 0 && <span className="hint">The project has none of these yet.</span>}
        {options.map((o) => (
          <label key={o.value} className="pick">
            <input type={kind === 'tile' || kind === 'structure' ? 'radio' : 'checkbox'} data-testid={`library-pick-${o.label}`} checked={picked.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
          </label>
        ))}
      </div>
      <label className="field">
        <span>Name</span>
        <input data-testid="library-save-name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Tags</span>
        <input data-testid="library-save-tags" value={tags} placeholder="grass, forest" onChange={(e) => setTags(e.target.value)} />
      </label>
      <label className="field">
        <span>Licence</span>
        <select data-testid="library-save-licence" value={licence} onChange={(e) => setLicence(e.target.value)}>
          <option value="CC0-1.0">CC0 (public domain)</option>
          <option value="CC-BY-4.0">CC-BY (credit the author)</option>
          <option value="CC-BY-NC-4.0">CC-BY-NC (credit, not for sale)</option>
          <option value="free-for-any-game">Free to use in any game</option>
          <option value="custom">Custom (explain in the description)</option>
        </select>
      </label>
      <label className="field">
        <span>Author</span>
        <input data-testid="library-save-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
      </label>
      <label className="field">
        <span>Notes</span>
        <input data-testid="library-save-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {sameKind.length > 0 && (
        <label className="field">
          <span>Save as</span>
          <select data-testid="library-save-as" value={replace} onChange={(e) => setReplace(e.target.value)}>
            <option value="">A new item</option>
            {sameKind.map((i) => (
              <option key={i.id} value={i.id}>
                A new version of "{i.name}"
              </option>
            ))}
          </select>
        </label>
      )}
      <button data-testid="library-save-go" onClick={() => void save().catch((e) => setMessage((e as Error).message))}>
        Save to the library
      </button>
      {message && (
        <p data-testid="library-save-message" className="hint">
          {message}
        </p>
      )}
    </div>
  );
}
