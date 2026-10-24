import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
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
    api.assistantNote("The Last Storytender mechanics: echoes (echoRecorder records the player and replays the recording as a helper; the button echo), sentence stones and text blocks (words that are walls or bridges), lantern posts (checkpoint behaviour; the world map unlock kind \"lantern\" means once a lantern post is lit there), lightResource makes the player's lantern a fuel meter, things that grow in the light.");
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
