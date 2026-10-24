import { minigameWon, str, type ActionDef, type ConditionDef } from '@tilewright/plugin-sdk';
import { beginDialogue, beginMinigame, playCutscene } from './director';

export const conditions: ConditionDef[] = [
  {
    id: 'minigameWon',
    label: 'A minigame has been won',
    category: 'Story',
    params: [{ key: 'minigame', label: 'Minigame (name)', type: 'text', default: '' }],
    describe: (p) => `the minigame "${str(p, 'minigame') || '(minigame)'}" has been won`,
    test: (ctx, p) => minigameWon(ctx.runtime.vars, str(p, 'minigame')),
  },
];

export const actions: ActionDef[] = [
  {
    id: 'startDialogue',
    label: 'Start a conversation',
    category: 'Story',
    params: [{ key: 'dialogue', label: 'Dialogue (name)', type: 'text', default: '' }],
    describe: (p) => `start the conversation "${str(p, 'dialogue') || '(dialogue)'}"`,
    run: (ctx, p) => void beginDialogue(ctx, str(p, 'dialogue')),
  },
  {
    id: 'playMinigame',
    label: 'Play a minigame',
    category: 'Story',
    params: [{ key: 'minigame', label: 'Minigame (name)', type: 'text', default: '' }],
    describe: (p) => `play the minigame "${str(p, 'minigame') || '(minigame)'}"`,
    run: (ctx, p) => void beginMinigame(ctx, str(p, 'minigame')),
  },
  {
    id: 'playCutscene',
    label: 'Play a cutscene',
    category: 'Story',
    params: [{ key: 'cutscene', label: 'Cutscene (name)', type: 'text', default: '' }],
    describe: (p) => `play the cutscene "${str(p, 'cutscene') || '(cutscene)'}"`,
    run: (ctx, p) => void playCutscene(ctx, str(p, 'cutscene')),
  },
];
