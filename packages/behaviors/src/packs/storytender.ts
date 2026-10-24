import { echoRecorder, echoReplay } from '../builtins/echo';
import { growing, lightResource, lightSensor } from '../builtins/fuel';
import { checkpoint } from '../builtins/checkpoint';
import { sentenceStone, textBlock } from '../builtins/text';
import { takeActions, takeConditions } from '../events/sheet';
import type { BehaviorDef } from '../framework';
import { registerPack, type Pack } from '../packs';

/** The event blocks that only make sense with the pack's objects, taken out of the core list so the pack installs them. */
const CONDITIONS = takeConditions(['echoCount', 'litAt', 'stoneSays', 'textIs']);
const ACTIONS = takeActions(['setWord', 'formatText', 'clearEchoes', 'addLight']);

/**
 * "The Last Storytender": the mechanics of the reference game. Echoes (record yourself and replay it as a helper),
 * sentence stones and formattable text blocks (words that are walls), lantern posts and the lantern's fuel, things that
 * grow in the light. Written against the same plugin API as any other pack: nothing here is known to the core.
 */
export const storytenderPack: Pack = {
  id: 'storytender',
  name: 'The Last Storytender',
  version: '1.0.0',
  description: 'Echoes, sentence stones, formattable text, lantern posts and lantern fuel, things that grow in the light. The mechanics of the reference game.',
  builtin: true,
  requires: ['lighting'],
  install(api) {
    const behaviors: BehaviorDef<any>[] = [echoRecorder, echoReplay, lightResource, lightSensor, growing, checkpoint, sentenceStone, textBlock]; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const b of behaviors) api.behavior(b);
    for (const c of CONDITIONS) api.condition(c);
    for (const a of ACTIONS) api.action(a);
    api.inputAction('echo', { label: 'Record an echo', bindings: ['key:KeyR', 'pad:button4'] });
  },
};

registerPack(storytenderPack);
