import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { actions, conditions } from './blocks';
import { light, lightingSystem } from './light';
import { LightingLayer } from './layer';
import { isLit, lightingOf } from './model';

export * from './light';
export * from './model';

export const lightingPlugin = definePlugin(manifest, {
  install(api) {
    api.assistantNote("Lighting: the light behaviour gives off light and walls cast shadows; the condition 'a spot is lit' and the action 'add a light' use it.");
    api.behaviors(light);
    api.conditions(...conditions);
    api.actions(...actions);
    // lighting is rebuilt after the lights have decided whether they are on; sensors read it on the next tick
    api.system('lighting', lightingSystem, 'gameplay', 'after-behaviors');
    // the darkness and the glow over the world, drawn from what the system above leaves each tick
    api.screenLayer({ id: 'lighting', create: () => new LightingLayer() });
    api.scriptMethod({ id: 'isLit', run: (ctx, _self, [x, y]) => isLit(lightingOf(ctx.runtime), Number(x), Number(y)) });
  },
});
