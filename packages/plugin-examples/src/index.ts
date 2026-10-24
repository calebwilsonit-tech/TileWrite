import type { PluginDefinition } from '@tilewright/plugin-sdk';
import { behaviorExample, blockExample, bridgeExample, componentExample, eventsExample, inputExample, layerExample, physicsExample, scriptExample, systemExample, unlockExample, whoExample } from './game';
import { gameUiExample, listSourceExample, menuEntryExample, screenExample, stringsExample, widgetExample } from './ui';
import { exportTargetExample, exporterExample, importerExample, inspectorExample, panelExample, prefabExample, templateExample, toolExample, validatorExample } from './editor';
import { assistantExample, moveExample, strategyExample } from './tools';
import { parchmentPlugin } from './parchment';

export * from './game';
export * from './ui';
export * from './editor';
export * from './tools';
export * from './parchment';

/** One example for each thing a plugin can add: the name is what the plugin API calls it. */
export const EXAMPLES: { point: string; plugin: PluginDefinition }[] = [
  { point: 'behavior', plugin: behaviorExample },
  { point: 'condition / action / event', plugin: eventsExample },
  { point: 'system', plugin: systemExample },
  { point: 'inputAction', plugin: inputExample },
  { point: 'component', plugin: componentExample },
  { point: 'collisionLayer', plugin: layerExample },
  { point: 'physicsModifier', plugin: physicsExample },
  { point: 'blockType', plugin: blockExample },
  { point: 'whoFilter', plugin: whoExample },
  { point: 'scriptMethod', plugin: scriptExample },
  { point: 'unlockRule', plugin: unlockExample },
  { point: 'bridgeSource', plugin: bridgeExample },
  { point: 'widget', plugin: widgetExample },
  { point: 'screen / screenRole', plugin: screenExample },
  { point: 'listSource', plugin: listSourceExample },
  { point: 'a re-skin of the screens (the Parchment UI kit)', plugin: parchmentPlugin },
  { point: 'menuEntry', plugin: menuEntryExample },
  { point: 'strings', plugin: stringsExample },
  { point: 'gameUi', plugin: gameUiExample },
  { point: 'panel', plugin: panelExample },
  { point: 'tool', plugin: toolExample },
  { point: 'importer', plugin: importerExample },
  { point: 'exporter', plugin: exporterExample },
  { point: 'exportTarget', plugin: exportTargetExample },
  { point: 'inspector', plugin: inspectorExample },
  { point: 'prefab', plugin: prefabExample },
  { point: 'template', plugin: templateExample },
  { point: 'validator', plugin: validatorExample },
  { point: 'playbotStrategy', plugin: strategyExample },
  { point: 'playbotMove', plugin: moveExample },
  { point: 'assistantNote / assistantTool / fileReader / imageProvider', plugin: assistantExample },
];
