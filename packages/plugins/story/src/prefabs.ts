import { thing, type PrefabDef } from '@tilewright/plugin-sdk';

/** What this plugin adds to the editor's Place tool. */
export const prefabs: PrefabDef[] = [
  {
      id: 'npc',
      label: 'NPC (talks)',
      group: 'Story',
      hint: 'A character the player talks to with Interact. Choose its conversation in the Inspector; write conversations in the Story panel.',
      make: (x, y, h) => thing('Villager', ['npc'], { color: 0x3d8fe8, w: 0.6, d: 0.6, height: 1.2 }, x, y, h, ['npcTalk']),
    },
  {
      id: 'minigame',
      label: 'Minigame (arcade)',
      group: 'Story',
      hint: 'The player plays a small game with Interact. Choose its minigame in the Inspector; make minigames in the Story panel.',
      make: (x, y, h) => thing('Arcade', ['minigame'], { color: 0xd06a1a, w: 0.7, d: 0.7, height: 1.2 }, x, y, h, ['minigameStation']),
    },
  {
      id: 'cutscene',
      label: 'Cutscene trigger',
      group: 'Story',
      hint: 'Plays a cutscene when the player walks into it. Write cutscenes in the Story panel.',
      make: (x, y, h) => thing('Cutscene trigger', ['cutscene'], { shape: 'diamond', color: 0xffd34a, w: 2, d: 2, height: 0.05 }, x, y, h, ['cutsceneTrigger']),
    },
];
