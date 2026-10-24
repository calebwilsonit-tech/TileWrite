import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { events } from './events';
import { actions, conditions } from './blocks';
import { beginDialogue, cutsceneSystem, dialogueSystem, minigameSystem, playCutscene } from './director';
import { cutsceneTrigger, minigameStation, npcTalk } from './story';

export * from './story';
export * from './director';

export const storyPlugin = definePlugin(manifest, {
  install(api) {
    api.assistantNote("Story: npcTalk (characters that talk), cutsceneTrigger, minigameStation (lets the player play a minigame), and the world map button.");
    for (const e of events) api.event(e);
    api.behaviors(npcTalk, cutsceneTrigger, minigameStation);
    api.conditions(...conditions);
    api.actions(...actions);
    api.inputAction('map', { label: 'Travel map', bindings: ['key:KeyM'] });
    // conversations and cutscenes listen to the real buttons and run even while the world is frozen
    api.system('dialogue', dialogueSystem, 'always', 'first');
    api.system('minigame', minigameSystem, 'always', 'first');
    api.system('cutscene', cutsceneSystem, 'always', 'first');
    api.scriptMethod({ id: 'startDialogue', run: (ctx, _self, [name]) => beginDialogue(ctx, String(name)) });
    api.scriptMethod({ id: 'playCutscene', run: (ctx, _self, [name]) => playCutscene(ctx, String(name)) });
  },
});
