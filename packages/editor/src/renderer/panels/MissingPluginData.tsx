import type { EntityData } from '@tilewright/runtime';
import { host, knownPackOfBehavior } from '@tilewright/behaviors';
import { store, useApp } from '../app/store';
import { usePlugins } from '../plugins/hooks';
import { pluginManager } from '../plugins/manager';

/**
 * What an object carries that no plugin that is on understands: kept as it is, shown here (never dropped, never edited), and said whose
 * it is when that is known: a plugin that ships with the editor but is off in this project (one click turns it on), or a plugin the
 * project needs that is not installed on this computer.
 */
export function MissingPluginData({ entity, hidden }: { entity: EntityData; hidden(key: string): boolean }) {
  usePlugins();
  const project = useApp((s) => s.project);
  const keys = Object.keys(entity.components).filter((k) => !hidden(k) && !host.ext.components.has(k));
  if (keys.length === 0) return null;
  const wanted = project?.project.plugins ?? [];
  const absent = pluginManager.missing(wanted);
  return (
    <fieldset data-testid="insp-missing-plugin-data">
      <legend>Settings of a plugin that is not on</legend>
      <p className="hint">These are kept exactly as they are, and do nothing until their plugin is on.</p>
      {keys.map((k) => {
        const owner = knownPackOfBehavior(k);
        return (
          <details key={k} data-testid={`missing-${k}`}>
            <summary>
              {k}
              {owner ? ` (the plugin "${owner}")` : ''}
            </summary>
            <pre className="hint">{JSON.stringify(entity.components[k], null, 2)}</pre>
            {owner && !wanted.includes(owner) && (
              <button data-testid={`turn-on-${owner}`} onClick={() => void store.updateProjectSettings({ plugins: [...wanted, owner] })}>
                Turn on "{owner}"
              </button>
            )}
            {!owner && absent.length > 0 && <p className="hint">This project needs {absent.map((m) => `"${m}"`).join(', ')}, which {absent.length === 1 ? 'is' : 'are'} not installed here: it may be from {absent.length === 1 ? 'that' : 'one of them'}. Install it in Project settings, Plugins.</p>}
          </details>
        );
      })}
    </fieldset>
  );
}
