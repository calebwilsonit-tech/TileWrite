import { useState, useSyncExternalStore } from 'react';
import { DANGEROUS, describePermission, host, listPacks, packContents } from '@tilewright/behaviors';
import { store, useApp } from '../app/store';
import { api } from '../project/api';
import { CheckField } from '../panels/fields';
import { usePlugins } from './hooks';
import { pluginManager, type InstalledPlugin } from './manager';

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

function InstalledRow({ id, versions }: { id: string; versions: InstalledPlugin[] }) {
  const [reviewing, setReviewing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const chosen = pluginManager.chosen(id) ?? versions[0]!;
  const project = useApp((s) => s.project)!;
  const on = (project.project.plugins ?? []).includes(id);
  const toggle = (v: boolean): void => {
    const cur = project.project.plugins ?? listPacks().filter((p) => p.active).map((p) => p.id);
    void store.updateProjectSettings({ plugins: v ? [...new Set([...cur, id])] : cur.filter((x) => x !== id) });
  };
  const pkg = chosen.pkg;
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
        {chosen.dev ? (
          <button onClick={() => void pluginManager.closeDev(chosen.dir)}>Stop developing</button>
        ) : (
          <button data-testid={`remove-${id}`} onClick={() => void pluginManager.remove(id, versions.length > 1 ? chosen.version : undefined)}>
            Remove{versions.length > 1 ? ` ${chosen.version}` : ''}
          </button>
        )}
      </div>
      {showLog && pkg && <pre className="hint">{pkg.changelog}</pre>}
    </fieldset>
  );
}

export function PluginsTab() {
  const project = useApp((s) => s.project)!;
  useApp((s) => s.storyVersion);
  usePlugins();
  useSyncExternalStore((fn) => pluginManager.subscribe(fn), () => pluginManager.version);
  const [address, setAddress] = useState('');
  const [msg, setMsg] = useState('');
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
    void store.updateProjectSettings({ plugins: [...next] });
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
        </div>
      )}

      <h4>Came with the editor</h4>
      {bundled.map(card)}

      <h4>Installed on this computer</h4>
      {installedIds.length === 0 && <p className="hint">None yet. Install one from a folder or an address below.</p>}
      {installedIds.map((id) => (
        <InstalledRow key={id} id={id} versions={pluginManager.installed.filter((p) => p.id === id)} />
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
