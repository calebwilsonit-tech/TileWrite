import { useState } from 'react';
import type { UiDoc } from '@tilewright/runtime';
import { offeredScreen } from '@tilewright/behaviors';
import { store } from '../app/store';
import { designer } from './state';
import { customize, diffScreens, pluginScreenRows, removeCopy, revert, type PluginScreenRow } from './plugin-screens';

const SAYS: Record<PluginScreenRow['state']['kind'], string> = {
  'as-offered': 'In use just as it comes.',
  replaced: 'Your own screen is used instead.',
  outranked: 'Another plugin’s screen for this part is used instead.',
  copy: 'Your copy, not changed.',
  'copy-outdated': 'Your copy, not changed. The plugin has a newer one.',
  changed: 'Your copy, with your changes.',
  'changed-outdated': 'Your copy, with your changes. The plugin has a newer one too.',
};

/**
 * The screens plugins ship (the title, the pause menu, the inventory...), and what the project has done with each: nothing
 * (the plugin's is played as it is), its own copy (Customize), or a copy that can be compared with a newer version and put back.
 */
export function PluginScreens({ doc }: { doc: UiDoc }) {
  const [comparing, setComparing] = useState<string | null>(null);
  const rows = pluginScreenRows(doc, store.uiLayout);
  if (rows.length === 0) return null;
  const layout = store.uiLayout;

  const open = (screenId: string): void => designer.set({ screenId, prefab: null, selected: null, mode: 'layout' });

  return (
    <section data-testid="ui-plugin-screens">
      <h3>Screens from plugins</h3>
      <p className="hint">A game plays with these unless the project has a screen of its own for the same part. Customize makes a copy you can change; the plugin&apos;s own stays as it was.</p>
      <ul className="ui-plugin-screens">
        {rows.map((r) => {
          const copy = 'copy' in r.state ? r.state.copy : null;
          const lines = comparing === r.id && copy ? diffScreens(copy, offeredScreen(r.plugin, r.id, { layout })!) : null;
          return (
            <li key={r.id} data-testid={`ui-plugin-screen-${r.id}`}>
              <strong>{r.name}</strong> {r.roleLabel && <small>({r.roleLabel})</small>}
              <div className="hint" data-testid={`ui-plugin-screen-${r.id}-state`}>
                {SAYS[r.state.kind]}
                {r.state.kind === 'replaced' && ` “${r.state.by}”.`}
                {r.state.kind === 'outranked' && ` (the plugin “${r.state.by}”)`}
              </div>
              <div className="row wrap">
                {!copy && (
                  <button
                    data-testid={`ui-plugin-screen-${r.id}-customize`}
                    onClick={() => {
                      const made = customize(doc, r.plugin, r.id, layout);
                      if (!made) return;
                      designer.edit(made.doc);
                      open(made.screen.id);
                    }}
                  >
                    Customize
                  </button>
                )}
                {copy && (
                  <button data-testid={`ui-plugin-screen-${r.id}-open`} onClick={() => open(copy.id)}>
                    Open my copy
                  </button>
                )}
                {copy && (r.state.kind === 'changed' || r.state.kind === 'changed-outdated' || r.state.kind === 'copy-outdated') && (
                  <button data-testid={`ui-plugin-screen-${r.id}-compare`} onClick={() => setComparing(comparing === r.id ? null : r.id)}>
                    {comparing === r.id ? 'Hide the differences' : 'Compare with the plugin’s'}
                  </button>
                )}
                {copy && (r.state.kind === 'changed' || r.state.kind === 'changed-outdated' || r.state.kind === 'copy-outdated') && (
                  <button
                    data-testid={`ui-plugin-screen-${r.id}-revert`}
                    title={r.state.kind === 'copy-outdated' ? 'Replace the copy with the plugin’s newer screen' : 'Throw away your changes and use the plugin’s screen again'}
                    onClick={() => {
                      designer.edit(revert(doc, copy.id, layout));
                      setComparing(null);
                    }}
                  >
                    {r.state.kind === 'copy-outdated' ? 'Update to the newer one' : 'Revert to the plugin’s'}
                  </button>
                )}
                {copy && (
                  <button
                    data-testid={`ui-plugin-screen-${r.id}-remove`}
                    title="Delete the copy, so the plugin's own screen is played again"
                    onClick={() => {
                      designer.edit(removeCopy(doc, copy.id));
                      designer.set({ screenId: null, selected: null });
                    }}
                  >
                    Use the plugin’s again
                  </button>
                )}
              </div>
              {lines && (
                <ul className="hint" data-testid={`ui-plugin-screen-${r.id}-diff`}>
                  {lines.length === 0 ? <li>No differences.</li> : lines.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
