import { useEffect, useRef } from 'react';
import type { DockviewApi } from 'dockview-react';
import { host } from '@tilewright/behaviors';
import { usePlugins } from './hooks';

/** A panel a plugin added: the plugin draws into the element it is given. */
export function PluginPanelView({ panelId }: { panelId: string }) {
  const el = useRef<HTMLDivElement>(null);
  usePlugins();
  const def = host.editor.panels.get(panelId);
  useEffect(() => {
    const box = el.current;
    if (!box || !def) return;
    box.replaceChildren();
    const stop = def.mount(box, host.editorHostFor(def.plugin));
    return () => {
      if (typeof stop === 'function') stop();
      box.replaceChildren();
    };
  }, [def]);
  if (!def) return <p className="hint" data-testid="plugin-panel-off">This panel belongs to a plugin that is switched off.</p>;
  return <div className="panel plugin-panel" data-testid={`plugin-panel-${panelId}`} ref={el} />;
}

/** Keep the dock's plugin panels in step with the plugins that are on. */
export function syncPluginPanels(api: DockviewApi): () => void {
  const sync = (): void => {
    const wanted = new Map([...host.editor.panels.values()].map((p) => [`plugin:${p.id}`, p]));
    for (const panel of [...api.panels]) if (panel.id.startsWith('plugin:') && !wanted.has(panel.id)) api.removePanel(panel);
    for (const [id, p] of wanted) {
      if (api.getPanel(id)) continue;
      api.addPanel({ id, component: 'plugin', title: p.title, params: { panelId: p.id }, position: { referencePanel: 'problems', direction: 'within' } });
    }
  };
  sync();
  return host.onChange(() => sync());
}
