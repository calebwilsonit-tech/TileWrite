import { useEffect, useMemo, useState } from 'react';
import { activeInput } from '@tilewright/behaviors';
import { PluginsTab } from '../plugins/PluginsTab';
import {
  COMPAT_FLAGS,
  COMPAT_NAMES,
  DomInputSource,
  bindingChanges,
  bindingLabel,
  checkProjectInput,
  projectDefaults,
  rebind,
  type ProjectInput,
} from '@tilewright/runtime';
import { CheckField, SelectField, TextField } from '../panels/fields';
import { store, useApp } from './store';

type Tab = 'game' | 'packs' | 'controls' | 'compat';

/**
 * The project's own settings: its name, the first scene, the title screen, and the game's controls (which keys and
 * buttons the built-in actions start with, and extra actions of your own). Players can still change their controls in
 * the game's Settings.
 */
export function ProjectSettingsDialog() {
  const project = useApp((s) => s.project);
  useApp((s) => s.storyVersion);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('game');
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [titleOn, setTitleOn] = useState(false);
  const [subtitle, setSubtitle] = useState('');
  const [deny, setDeny] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  const [fresh, setFresh] = useState({ id: '', label: '' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const show = (which?: Event): void => {
      const p = store.state.project?.project;
      if (!p) return;
      setName(p.name);
      setStart(p.startScene);
      setTitleOn(p.title?.enabled ?? false);
      setSubtitle(p.title?.subtitle ?? '');
      setDeny((p.assistantDeny ?? []).join('\n'));
      setTab((which as CustomEvent<Tab> | undefined)?.detail === 'controls' ? 'controls' : 'game');
      setSaved(false);
      setOpen(true);
    };
    document.addEventListener('tw:project-settings', show);
    return () => document.removeEventListener('tw:project-settings', show);
  }, []);

  const input = store.input;
  const base = activeInput();
  const problems = useMemo(() => checkProjectInput(input, base), [input, base]);
  if (!open || !project) return null;

  const close = (): void => setOpen(false);
  const nameProblem = name.trim() === '' ? 'The game needs a name.' : '';
  const save = async (): Promise<void> => {
    if (nameProblem) return;
    const ok = await store.updateProjectSettings({ name: name.trim(), startScene: start, title: { enabled: titleOn, subtitle }, assistantDeny: deny.split('\n').map((l) => l.trim()).filter(Boolean) });
    setSaved(ok);
  };

  const map = projectDefaults(input, base.map);
  const builtin = Object.keys(base.map);

  /** Store a changed set of starting bindings: built-in ones as differences from the standard, your own whole. */
  const commit = (next: Record<string, string[]>): void => {
    const overrides: Record<string, string[]> = {};
    const standard = bindingChanges(Object.fromEntries(builtin.map((a) => [a, next[a] ?? []])), base.map);
    for (const [a, list] of Object.entries(standard)) overrides[a] = list;
    store.setProjectInput({ ...input, overrides, actions: input.actions.map((c) => ({ ...c, bindings: next[c.id] ?? c.bindings })) });
  };
  const change = (action: string): void => {
    if (capturing) return;
    setCapturing(action);
    const source = new DomInputSource();
    void source.captureNext(10000).then((id) => {
      source.dispose();
      setCapturing(null);
      if (id) commit(rebind(map, action, id));
    });
  };
  const addAction = (): void => {
    const id = fresh.id.trim();
    const label = fresh.label.trim() || id;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(id)) return store.notify('warn', 'Action names use lower-case letters, numbers and _, and start with a letter (for example "dash").');
    if (id in base.labels || input.actions.some((c) => c.id === id)) return store.notify('warn', `There is already an action called "${id}".`);
    store.setProjectInput({ ...input, actions: [...input.actions, { id, label, bindings: [] }] });
    setFresh({ id: '', label: '' });
  };
  const updateAction = (id: string, patch: Partial<ProjectInput['actions'][number]>): void => store.setProjectInput({ ...input, actions: input.actions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="dialog wide" role="dialog" aria-label="Project settings" data-testid="project-settings" style={{ maxHeight: '86vh', overflow: 'auto' }} onMouseDown={(e) => e.stopPropagation()}>
        <h2>Project settings</h2>
        <div className="seg" role="tablist">
          {(['game', 'packs', 'controls', 'compat'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} data-testid={`ps-tab-${t}`} onClick={() => setTab(t)}>
              {t === 'game' ? 'Game' : t === 'packs' ? 'Plugins' : t === 'controls' ? 'Controls' : 'Compatibility'}
            </button>
          ))}
        </div>

        {tab === 'game' && (
          <div data-testid="ps-game">
            <TextField label="Name of the game" testId="ps-name" value={name} onCommit={setName} />
            {nameProblem && <p className="hint">{nameProblem}</p>}
            <SelectField<string> label="Scene the game starts in" testId="ps-start" value={start} options={project.project.scenes.map((s) => ({ value: s, label: s.replace(/^.*\//, '').replace('.scene.json', '') }))} onChange={setStart} />
            <CheckField label="Show a title screen first (New game, Continue, Load game, Settings, Quit)" testId="ps-title-enabled" value={titleOn} onChange={setTitleOn} />
            {titleOn && <TextField label="Line under the title" testId="ps-subtitle" value={subtitle} onCommit={setSubtitle} placeholder="A tale of the old road" />}
            <label className="field">
              <span>Files the assistant may not read (one pattern a line)</span>
              <textarea data-testid="ps-assistant-deny" rows={3} value={deny} onChange={(e) => setDeny(e.target.value)} placeholder="private/**" />
            </label>
            <p className="hint">Files that may hold secrets (.env, *.pem, *.key, SSH and cloud credentials, .git) are always kept from the assistant, in every project. Add your own patterns here: * is any run of letters, and private/** is everything below private.</p>
            <p className="hint">The title screen shows when you press Play with no scene or spot chosen, and in the exported game. Continue appears once the player has a save.</p>
            <div className="row end">
              {saved && <span data-testid="ps-saved">Saved.</span>}
              <button onClick={close}>Close</button>
              <button className="primary" data-testid="ps-save" disabled={!!nameProblem} onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        )}

        {tab === 'packs' && <PluginsTab />}

        {tab === 'compat' && <CompatTab />}

        {tab === 'controls' && (
          <div data-testid="ps-controls">
            <p className="hint">The keys and buttons a new player starts with. Click Change, then press the key, mouse button or gamepad button (Esc cancels). Players can still change them in the game under Settings, Controls.</p>
            <table className="controls-table">
              <tbody>
                {builtin.map((a) => (
                  <tr key={a} data-testid={`ctl-${a}`}>
                    <td>{base.labels[a]}</td>
                    <td data-testid={`ctl-keys-${a}`}>{(map[a] ?? []).map(bindingLabel).join(', ') || 'not set'}</td>
                    <td>
                      <button className="small" data-testid={`ctl-change-${a}`} onClick={() => change(a)}>
                        {capturing === a ? 'press a key or button...' : 'Change'}
                      </button>
                      {a in input.overrides && (
                        <button className="small" data-testid={`ctl-reset-${a}`} onClick={() => commit({ ...map, [a]: base.map[a] ?? [] })}>
                          Standard
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Your own actions</h3>
            <p className="hint">Make up actions such as &ldquo;dash&rdquo; or &ldquo;torch&rdquo;. Event rows use them with the &ldquo;A button is pressed&rdquo; condition (type the action name), and scripts read them with <code>input.pressed(&quot;dash&quot;)</code>. They appear in the game&rsquo;s Controls screen.</p>
            {input.actions.map((c) => (
              <div className="row" key={c.id} data-testid={`ctl-custom-${c.id}`}>
                <code>{c.id}</code>
                <TextField label="Name shown" testId={`ctl-label-${c.id}`} value={c.label} onCommit={(v) => updateAction(c.id, { label: v.trim() || c.label })} />
                <span data-testid={`ctl-keys-${c.id}`}>{c.bindings.map(bindingLabel).join(', ') || 'not set'}</span>
                <button className="small" data-testid={`ctl-change-${c.id}`} onClick={() => change(c.id)}>
                  {capturing === c.id ? 'press a key or button...' : 'Change'}
                </button>
                <button className="small" data-testid={`ctl-remove-${c.id}`} onClick={() => store.setProjectInput({ ...input, actions: input.actions.filter((x) => x.id !== c.id) })}>
                  Remove
                </button>
              </div>
            ))}
            <div className="row">
              <TextField label="Action name" testId="ctl-new-id" value={fresh.id} onCommit={(v) => setFresh({ ...fresh, id: v })} placeholder="dash" />
              <TextField label="Name shown" testId="ctl-new-label" value={fresh.label} onCommit={(v) => setFresh({ ...fresh, label: v })} placeholder="Dash" />
              <button data-testid="ctl-add" onClick={addAction}>
                Add action
              </button>
            </div>
            {problems.length > 0 && (
              <ul className="problems" data-testid="ctl-problems">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="row end">
              <button data-testid="ctl-reset-all" onClick={() => store.setProjectInput({ ...input, overrides: {}, actions: input.actions.map((c) => c) })}>
                Standard keys for the built-in actions
              </button>
              <button className="primary" onClick={close}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Behaviour that changed after this project was made. A project made before a change plays as it always did (the box is
 * empty); a new project has every box ticked. Tick one to get the newer behaviour, untick it to go back.
 */
function CompatTab() {
  const project = useApp((s) => s.project)!;
  useApp((s) => s.storyVersion);
  const flags = project.project.compat ?? {};
  return (
    <div data-testid="ps-compat">
      <p className="hint">
        {project.project.compat === undefined
          ? 'This project was made before these options existed, so it plays exactly as it always did. Tick a box to try the newer behaviour; untick it to go back.'
          : 'Each box is a behaviour that changed after older projects were made. Untick one to play it the way older projects do.'}
      </p>
      {COMPAT_NAMES.map((name) => (
        <fieldset className="story-card" key={name} data-testid={`compat-${name}`}>
          <CheckField label={COMPAT_FLAGS[name].label} testId={`compat-toggle-${name}`} value={flags[name] === true} onChange={(v) => void store.updateProjectSettings({ compat: { ...flags, [name]: v } })} />
          <p className="hint">{COMPAT_FLAGS[name].help}</p>
        </fieldset>
      ))}
    </div>
  );
}

/** Which packs (the engine's modules, the reference game's mechanics, anything a programmer added) the game uses. */
