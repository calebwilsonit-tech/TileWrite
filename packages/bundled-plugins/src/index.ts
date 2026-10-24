import { host, setActivePacks, type PluginDefinition } from '@tilewright/plugin-sdk';
import { aiPlugin } from '@tilewright/plugin-ai';
import { combatPlugin } from '@tilewright/plugin-combat';
import { controlsPlugin } from '@tilewright/plugin-controls';
import { inventoryPlugin } from '@tilewright/plugin-inventory';
import { lightingPlugin } from '@tilewright/plugin-lighting';
import { prebuiltScreensPlugin } from '@tilewright/plugin-prebuilt-screens';
import { simPlugin } from '@tilewright/plugin-sim';
import { storyPlugin } from '@tilewright/plugin-story';
import { storytenderPlugin } from '@tilewright/plugin-storytender';
import { turnsPlugin } from '@tilewright/plugin-turns';

/** The plugins that ship with Tilewright. Each lives in its own package under packages/plugins and uses only the public SDK. */
export const BUNDLED_PLUGINS: readonly PluginDefinition[] = [
  combatPlugin,
  inventoryPlugin,
  storyPlugin,
  aiPlugin,
  lightingPlugin,
  storytenderPlugin,
  turnsPlugin,
  controlsPlugin,
  simPlugin,
  prebuiltScreensPlugin,
];

/** Make the bundled plugins known to the host (they are not on until a project turns them on). */
export function registerBundledPlugins(): void {
  for (const p of BUNDLED_PLUGINS) host.register(p);
}

registerBundledPlugins();
// until a project says which plugins it uses, every bundled plugin is on (a project made before plugins existed plays as it always did)
setActivePacks(undefined);

export * from '@tilewright/plugin-ai';
export * from '@tilewright/plugin-combat';
export * from '@tilewright/plugin-controls';
export * from '@tilewright/plugin-inventory';
export * from '@tilewright/plugin-lighting';
export * from '@tilewright/plugin-prebuilt-screens';
export * from '@tilewright/plugin-sim';
export * from '@tilewright/plugin-story';
export * from '@tilewright/plugin-storytender';
export * from '@tilewright/plugin-turns';
