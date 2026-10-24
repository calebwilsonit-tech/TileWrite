import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json';
import { actions, conditions } from './blocks';
import { light, lightingSystem } from './light';

export * from './light';

export const lightingPlugin = definePlugin(manifest, {
  install(api) {
    api.assistantNote("Lighting: the light behaviour gives off light and walls cast shadows; the condition 'a spot is lit' and the action 'add a light' use it.");
    api.behaviors(light);
    api.conditions(...conditions);
    api.actions(...actions);
    // lighting is rebuilt after the lights have decided whether they are on; sensors read it on the next tick
    api.system('lighting', lightingSystem, 'gameplay', 'after-behaviors');
  },
});
