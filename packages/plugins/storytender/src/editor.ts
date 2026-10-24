import type { PluginApi } from '@tilewright/plugin-sdk';
import { storytenderChecks } from './checks';
import { prefabs } from './prefabs';
import { holdPlatesStrategy, echoMove } from './playbot';
import { textBridges } from './bridges';

/** What this plugin adds to the editor (never part of an exported game). */
export function installEditor(api: PluginApi): void {
  for (const p of prefabs) api.prefab(p);
  api.playbotStrategy(holdPlatesStrategy);
  api.playbotMove(echoMove);
  api.bridgeSource(textBridges);
  api.validator(storytenderChecks);
}
