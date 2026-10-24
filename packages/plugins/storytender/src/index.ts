import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json';
import { events } from './events';
import { actions, conditions } from './blocks';
import { checkpoint, litPosts } from './checkpoint';
import { echoRecorder, echoReplay } from './echo';
import { growing, lightResource, lightSensor } from './fuel';
import { sentenceStone, textBlock } from './text';

export * from './echo';
export * from './text';
export * from './fuel';
export * from './checkpoint';

export const storytenderPlugin = definePlugin(manifest, {
  install(api) {
    for (const e of events) api.event(e);
    api.behaviors(echoRecorder, echoReplay, lightResource, lightSensor, growing, checkpoint, sentenceStone, textBlock);
    api.conditions(...conditions);
    api.actions(...actions);
    api.collisionLayer({ name: 'echo', bit: 3, label: 'Echoes', ghost: true });
    api.whoFilter({ id: 'echoes', label: 'Echoes', match: (e) => e.tags.has('echo') });
    api.unlockRule({
      id: 'lantern',
      label: 'once a lantern post is lit there (they arrive at it)',
      met: (vars, node) => litPosts(vars).some((p) => p.scene === node.scene),
      arrival: (vars, node) => litPosts(vars).find((p) => p.scene === node.scene) ?? null,
    });
    api.inputAction('echo', { label: 'Record an echo', bindings: ['key:KeyR', 'pad:button4'] });
  },
});
