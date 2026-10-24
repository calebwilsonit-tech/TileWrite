import type { PluginApi } from '@tilewright/plugin-sdk';
import { prefabs } from './prefabs';

/** What this plugin adds to the editor (never part of an exported game). */
export function installEditor(api: PluginApi): void {
  for (const p of prefabs) api.prefab(p);
}
