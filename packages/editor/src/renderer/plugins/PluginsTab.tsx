import { useEffect, useState, useSyncExternalStore } from 'react';
import { DANGEROUS, describePermission, host, listPacks, packContents } from '@tilewright/behaviors';
import { store, useApp } from '../app/store';
import { api } from '../project/api';
import { CheckField } from '../panels/fields';
import { usePlugins } from './hooks';
import { pluginManager, type InstalledPlugin } from './manager';
import { hubClient } from './hub-plugins';
import { describeUsage, pluginUsage } from './usage';
import type { HubItem } from '../library/hub';

const isExample = (id: string): boolean => id.startsWith('example-');

/** Plugins other people wrote: what they want to be allowed to do, and the person's yes or no. */
function Approval({ plugin, done }: { plugin: InstalledPlugin; done(): void }) {
  const m = plugin.pkg!.manifest;
  const [allowed, setAllowed] = useState<string[]>(m.permissions.filter((p) => !(DANGEROUS as readonly string[]).includes(p)));
  const toggle = (p: string, on: boolean): void => setAllowed(on ? [...allowed, p] : allowed.filter((x) => x !== p));
  return (
    <div className="plugin-approval" data-testid={`approve-${m.id}`}>
      <p>
        <strong>{m.name}</strong> {m.version} {m.author && <>by {m.author}</>}
      </p>
      <p>{m.description || 'It does not say what it does.'}</p>
      <p className="hint">
        This plugin is a program. Once you allow it, it runs inside the editor and the game with the same access to your game as the engine itself. Only allow plugins from people you trust. If its
        code changes (a new version), you will be asked again.
      </p>
      {m.permissions.length === 0 ? (
        <p className="hint">It asks for no extra permissions.</p>
      ) : (
        m.permissions.map((p) => (
          <CheckField key={p} testId={`perm-${m.id}-${p}`} label={`${describePermission(p)}${(DANGEROUS as readonly string[]).includes(p) ? ' (dangerous)' : ''}`} value={allowed.includes(p)} onChange={(v) => toggle(p, v)} />
        ))
      )}
      <div className="row">
        <button className="primary" data-testid={`allow-${m.id}`} onClick={() => void pluginManager.approve(m.id, m.version, allowed).then(done)}>
          Allow this plugin to run
        </button>
        <button onClick={done}>Not now</button>
      </div>
    </div>
  );
}

/** Ask what depends on a plugin in the open project before it goes; `go` runs at once when nothing does, else after the person says so. */
type AskBefore = (id: string, what: 'turn off' | 'remove', go: () => void) => void;

async function stopsWorking(id: string): Promise<string[]> {
  const scenes = await store.loadAllScenes();
  return describeUsage(pluginUsage(id, scenes, store.uiDoc, (kind) => store.dataList(kind).length));
}

function UsedBy({ id }: { id: string }) {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    void pluginManager.usedBy(id).then((n) => live && setNames(n));
    return () => {
      live = false;
    };
  }, [id]);
  if (names === null) return null;
  return (
    <p className="hint" data-testid={`used-by-${id}`}>
      {names.length === 0 ? 'None of your recent projects use it.' : `Used by: ${names.join(', ')}.`}
    </p>
  );
}

function InstalledRow({ id, versions, ask }: { id: string; versions: InstalledPlugin[]; ask: AskBefore }) {
  const [checking, setChecking] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const chosen = pluginManager.chosen(id) ?? versions[0]!;
  const project = useApp((s) => s.project)!;
  const on = (project.project.plugins ?? []).includes(id);
  const toggle = (v: boolean): void => {
    const cur = project.project.plugins ?? listPacks().filter((p) => p.active).map((p) => p.id);
    const go = (): void => void store.updateProjectSettings({ plugins: v ? [...new Set([...cur, id])] : cur.filter((x) => x !== id) });
    if (v) go();
    else ask(id, 'turn off', go);
  };
  const pkg = chosen.pkg;
  const source = pluginManager.sourceOf(id);
  return (
    <fieldset className="story-card" data-testid={`installed-${id}`}>
      <legend>
        {pkg?.manifest.name ?? id} <small>v{chosen.version}{chosen.dev ? ' (development)' : ''}</small>
      </legend>
      {chosen.state === 'ready' && <CheckField label={pkg?.manifest.description || 'Switch it on in this project'} testId={`plugin-toggle-${id}`} value={on} onChange={toggle} />}
      {chosen.state === 'needs-approval' && (
        <>
          <p className="hint">You have not allowed this plugin to run yet.</p>
          {!reviewing && (
            <button data-testid={`review-${id}`} onClick={() => setReviewing(true)}>
              Look at what it wants…
            </button>
          )}
          {reviewing && <Approval plugin={chosen} done={() => setReviewing(false)} />}
        </>
      )}
      {chosen.problems.map((p) => (
        <p key={p} className="error" data-testid={`plugin-problem-${id}`}>
          {p}
        </p>
      ))}
      {pkg && pkg.manifest.permissions.length > 0 && chosen.state === 'ready' && (
        <p className="hint">
          Allowed to: {host.permissionsOf(id).granted.map(describePermission).join('; ') || 'nothing extra'}.
        </p>
      )}
      <div className="row wrap">
        {pkg?.changelog && (
          <button onClick={() => setShowLog(!showLog)} data-testid={`changelog-${id}`}>
            What changed
          </button>
        )}
        {versions.length > 1 &&
          versions
            .filter((v) => v.version !== chosen.version)
            .map((v) => (
              <button key={v.version} data-testid={`pin-${id}-${v.version}`} onClick={() => void pluginManager.pin(id, v.version)}>
                Go back to {v.version}
              </button>
            ))}
        {pluginManager.pinnedVersion(id) && <button onClick={() => void pluginManager.unpin(id)}>Use the newest again</button>}
        {source && (
          <button data-testid={`update-${id}`} onClick={() => void pluginManager.update(id).then((r) => setChecking(r.message), (e: unknown) => setChecking(e instanceof Error ? e.message : String(e)))}>
            Look for a newer version
          </button>
        )}
        {chosen.dev ? (
          <button onClick={() => void pluginManager.closeDev(chosen.dir)}>Stop developing</button>
        ) : (
          <button data-testid={`remove-${id}`} onClick={() => ask(id, 'remove', () => void pluginManager.remove(id, versions.length > 1 ? chosen.version : undefined))}>
            Remove{versions.length > 1 ? ` ${chosen.version}` : ''}
          </button>
        )}
      </div>
      {checking && (
        <p className="hint" data-testid={`update-message-${id}`}>
          {checking}
        </p>
      )}
      <UsedBy id={id} />
      {showLog && pkg && <pre className="hint">{pkg.changelog}</pre>}
    </fieldset>
  );
}

/** Plugins shared on the asset hub (the address and sign-in of the Asset Hub panel): a list to install from. */
function HubPlugins({ onInstalled, query = '' }: { onInstalled(name: string): void; query?: string }) {
  const [q, setQ] = useState(query);
  const [items, setItems] = useState<HubItem[] | null>(null);
  const [msg, setMsg] = useState('');
  const search = (): void => {
    setMsg('');
    void hubClient()
      .search({ kind: 'plugin', ...(q.trim() ? { q: q.trim() } : {}), sort: 'rating' })
      .then(
        (r) => setItems(r.items),
        (e: unknown) => setMsg(e instanceof Error ? e.message : String(e)),
      );
  };
  return (
    <div data-testid="plugin-hub">
      <div className="row">
        <input data-testid="plugin-hub-q" placeholder="Search plugins on the hub" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button data-testid="plugin-hub-search" onClick={search}>
          Search
        </button>
      </div>
      {msg && <p className="hint">{msg}</p>}
      {items?.length === 0 && <p className="hint">No plugins found on the hub.</p>}
      {items?.map((i) => (
        <fieldset className="story-card" key={i.id} data-testid={`hub-plugin-${i.id}`}>
          <legend>
            {i.name} <small>by {i.author}</small>
          </legend>
          <p>{i.description}</p>
          <p className="hint">Licence: {i.licence}. A plugin is a program: it runs only after you have read what it wants and allowed it.</p>
          <button
            data-testid={`hub-plugin-install-${i.id}`}
            onClick={() =>
              void pluginManager.installFromHub(i.id).then(
                (p) => onInstalled(p.pkg?.manifest.name ?? p.id),
                (e: unknown) => setMsg(e instanceof Error ? e.message : String(e)),
              )
            }
          >
            Install
          </button>
        </fieldset>
      ))}
    </div>
  );
}

/** For a plugin the project needs that is not here: look for it on the hub. */
function HubOffer({ id, onInstalled }: { id: string; onInstalled(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`offer-${id}`}>
      <button data-testid={`offer-look-${id}`} onClick={() => setOpen(!open)}>
        Look for "{id}" on the asset hub
      </button>
      {open && <HubPlugins query={id} onInstalled={() => onInstalled()} />}
    </div>
  );
}

export function PluginsTab() {
  const project = useApp((s) => s.project)!;
  useApp((s) => s.storyVersion);
  usePlugins();
  useSyncExternalStore((fn) => pluginManager.subscribe(fn), () => pluginManager.version);
  const [address, setAddress] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState<{ id: string; what: 'turn off' | 'remove'; lines: string[]; go(): void } | null>(null);
  const ask: AskBefore = (id, what, go) => {
    void stopsWorking(id).then(
      (lines) => (lines.length === 0 ? go() : setPending({ id, what, lines, go })),
      () => go(),
    );
  };
  const explicit = project.project.plugins;
  const all = listPacks();
  const on = new Set(explicit ?? all.filter((p) => p.active).map((p) => p.id));
  const installedIds = [...new Set(pluginManager.installed.map((p) => p.id))];
  const missing = pluginManager.missing(explicit ?? []);
  const set = (id: string, enabled: boolean): void => {
    const next = new Set(on);
    if (enabled) {
      next.add(id);
      for (const dep of all.find((p) => p.id === id)?.requires ?? []) next.add(dep);
    } else {
      next.delete(id);
      for (const p of all) if (p.requires.includes(id)) next.delete(p.id);
    }
    const go = (): void => void store.updateProjectSettings({ plugins: [...next] });
    if (enabled) go();
    else ask(id, 'turn off', go);
  };
  const run = async (what: () => Promise<unknown>, ok: string): Promise<void> => {
    try {
      await what();
      setMsg(ok);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const bundled = all.filter((p) => !isExample(p.id) && !installedIds.includes(p.id));
  const examples = all.filter((p) => isExample(p.id));
  const card = (p: (typeof all)[number]) => {
    const contents = packContents(p.id);
    return (
      <fieldset className="story-card" key={p.id} data-testid={`pack-${p.id}`}>
        <legend>
          {p.name} <small>v{p.version}</small>
        </legend>
        <CheckField label={p.description} testId={`pack-toggle-${p.id}`} value={on.has(p.id)} onChange={(v) => set(p.id, v)} />
        {p.requires.length > 0 && <p className="hint">Needs: {p.requires.join(', ')}.</p>}
        {contents && contents.behaviors.length > 0 && <p className="hint">Behaviours: {contents.behaviors.join(', ')}.</p>}
      </fieldset>
    );
  };
  return (
    <div data-testid="ps-packs">
      <p className="hint">
        {explicit === undefined
          ? 'This project was made before plugins existed, so everything that came with the editor is switched on. Changing any box makes your choice permanent.'
          : 'A plugin adds behaviours, event blocks, tools and more. Turning one off hides what it added; objects that still use it do nothing, and the Problems panel says so.'}
      </p>
      {missing.length > 0 && (
        <div className="warn" data-testid="plugins-missing">
          This project needs {missing.map((m) => `"${m}"`).join(', ')}, which {missing.length === 1 ? 'is' : 'are'} not installed on this computer. What they added is kept in your scenes and starts working again once the plugin is installed.
          {missing.map((m) => (
            <HubOffer key={m} id={m} onInstalled={() => setMsg(`Installed "${m}". Allow it below for it to run.`)} />
          ))}
        </div>
      )}
      {pending && (
        <div className="warn" data-testid="plugin-stops">
          <p>
            <strong>
              If you {pending.what} "{pending.id}":
            </strong>
          </p>
          <ul className="plain">
            {pending.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="hint">Nothing is deleted: it is all kept in your files and works again when the plugin is back.</p>
          <div className="row">
            <button
              className="primary"
              data-testid="plugin-stops-go"
              onClick={() => {
                pending.go();
                setPending(null);
              }}
            >
              {pending.what === 'remove' ? 'Remove it anyway' : 'Turn it off anyway'}
            </button>
            <button data-testid="plugin-stops-keep" onClick={() => setPending(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}

      <h4>Came with the editor</h4>
      {bundled.map(card)}

      <h4>Installed on this computer</h4>
      {installedIds.length === 0 && <p className="hint">None yet. Install one from a folder or an address below.</p>}
      {installedIds.map((id) => (
        <InstalledRow key={id} id={id} versions={pluginManager.installed.filter((p) => p.id === id)} ask={ask} />
      ))}
      <div className="row wrap">
        <button
          data-testid="plugin-install-folder"
          onClick={() =>
            void run(async () => {
              const dir = await api().chooseFolder('Choose a plugin folder (it has a plugin.json in it)');
              if (dir) await pluginManager.installFromFolder(dir);
            }, 'Installed.')
          }
        >
          Install from a folder…
        </button>
        <button
          data-testid="plugin-dev-folder"
          title="Use a plugin where it is while you write it: changes are picked up as soon as you save"
          onClick={() =>
            void run(async () => {
              const dir = await api().chooseFolder('Choose the folder of the plugin you are writing');
              if (dir) await pluginManager.openDev(dir);
            }, 'Opened for development.')
          }
        >
          Open a folder for development…
        </button>
      </div>
      <div className="row">
        <input data-testid="plugin-address" placeholder="https://… address of a plugin bundle" value={address} onChange={(e) => setAddress(e.target.value)} />
        <button data-testid="plugin-install-address" disabled={!address.trim()} onClick={() => void run(() => pluginManager.installFromAddress(address.trim()), 'Installed.')}>
          Install
        </button>
      </div>
      {msg && (
        <p className="hint" data-testid="plugin-message">
          {msg}
        </p>
      )}

      <h4>Find plugins on the asset hub</h4>
      <HubPlugins onInstalled={(name) => setMsg(`Installed "${name}". Allow it above for it to run.`)} />

      {examples.length > 0 && (
        <>
          <h4>Examples (for people writing plugins)</h4>
          <p className="hint">One small working plugin for every kind of thing a plugin can add. Switch one on to see what it does; the code is in docs/plugins.</p>
          {examples.map(card)}
        </>
      )}
      {host.failures().length > 0 && (
        <div className="warn" data-testid="plugin-failures">
          {host.failures().map((f) => (
            <p key={f.plugin}>{f.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
