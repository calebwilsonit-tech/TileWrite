import { useProject } from '@tilewright/behaviors';
import { store } from '../app/store';
import { connectPluginHost } from './editor-host';
import { pluginManager } from './manager';
import { watchPluginCommands } from './commands';

/** Called once when the editor starts: plugins can see the editor, and the ones on this computer are found. */
export function startPlugins(): void {
  connectPluginHost();
  watchPluginCommands();
  // when a plugin is installed, updated or removed, the open project turns on what it asks for again
  pluginManager.subscribe(() => {
    const p = store.state.project;
    if (p) useProject(p.project);
  });
  void pluginManager.init().catch((e: unknown) => store.notify('error', `Could not look for plugins: ${e instanceof Error ? e.message : String(e)}`));
}
