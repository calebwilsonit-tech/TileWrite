import { damage, heal } from '../builtins/combat';
import { beginDialogue, cutsceneSystem, dialogueSystem, minigameSystem, playCutscene } from '../story/director';
import { quickSlotSystem } from '../story/inventory';
import { lightingSystem } from '../builtins/light';
import type { Entity } from '@tilewright/runtime';
import { registerPack, type Pack, type PluginApi } from '../packs';

/**
 * The engine's own optional parts. Each is a pack whose members the engine already defines; turning one off takes its
 * behaviours and event blocks out of the pickers (and the checker says so if an object still uses one).
 * A new project turns on none of them; a template turns on the ones it needs.
 */
const module_ = (id: string, name: string, description: string, members: Parameters<PluginApi['adopt']>[0], requires: string[] = [], extra?: (api: PluginApi) => void): Pack => ({
  id,
  name,
  version: '1.0.0',
  description,
  builtin: true,
  requires,
  install: (api) => {
    api.adopt(members);
    extra?.(api);
  },
});

export const combatPack = module_(
  'combat',
  'Combat',
  'Health, damage on touch, melee and ranged attacks, dodging, projectiles.',
  {
    behaviors: ['health', 'damageOnTouch', 'meleeAttack', 'rangedAttack', 'dodge', 'projectile'],
    conditions: ['health'],
    actions: ['damage', 'heal'],
    inputs: { attack: { label: 'Attack (quill)', bindings: ['key:KeyJ', 'mouse:0', 'pad:button2'] }, dodge: { label: 'Dodge', bindings: ['key:KeyQ', 'pad:button3'] } },
  },
  [],
  (api) => {
    api.scriptMethod({ id: 'damage', run: (ctx, self, [target, amount]) => (target ? damage(ctx, target as Entity, Number(amount), { source: self }) : false) });
    api.scriptMethod({ id: 'heal', run: (ctx, _self, [target, amount]) => void (target && heal(ctx, target as Entity, Number(amount))) });
  },
);

export const inventoryPack = module_('inventory', 'Inventory', 'Items you carry, pickups, quick slots and the inventory screen.', {
  behaviors: ['pickup'],
  conditions: ['hasItem'],
  actions: ['giveItem', 'takeItem'],
  inputs: {
    inventory: { label: 'Inventory', bindings: ['key:KeyI', 'pad:button8'] },
    quick_1: { label: 'Quick slot 1', bindings: ['key:Digit1'] },
    quick_2: { label: 'Quick slot 2', bindings: ['key:Digit2'] },
    quick_3: { label: 'Quick slot 3', bindings: ['key:Digit3'] },
    quick_4: { label: 'Quick slot 4', bindings: ['key:Digit4'] },
  },
}, [], (api) => {
  api.system('quick-slots', quickSlotSystem, 'player', 'after-player');
});

export const storyPack = module_('story', 'Story', 'Characters that talk, cutscene triggers, minigame stations, the world map.', {
  behaviors: ['npcTalk', 'cutsceneTrigger', 'minigameStation'],
  conditions: ['minigameWon'],
  actions: ['startDialogue', 'playMinigame', 'playCutscene'],
  inputs: { map: { label: 'Travel map', bindings: ['key:KeyM'] } },
}, [], (api) => {
  // conversations and cutscenes listen to the real buttons and run even while the world is frozen
  api.system('dialogue', dialogueSystem, 'always', 'first');
  api.system('minigame', minigameSystem, 'always', 'first');
  api.system('cutscene', cutsceneSystem, 'always', 'first');
  api.scriptMethod({ id: 'startDialogue', run: (ctx, _self, [name]) => beginDialogue(ctx, String(name)) });
  api.scriptMethod({ id: 'playCutscene', run: (ctx, _self, [name]) => playCutscene(ctx, String(name)) });
});

export const aiPack = module_('ai', 'AI', 'Patrolling, chasing, seeing, boss phases and behaviour trees for characters the player does not control.', {
  behaviors: ['vision', 'chase', 'patrol', 'bossPhases', 'behaviorTree'],
});

export const lightingPack = module_('lighting', 'Lighting', 'Lights, darkness and shadows.', { behaviors: ['light'] }, [], (api) => {
  // lighting is rebuilt after the lights have decided whether they are on; sensors read it on the next tick
  api.system('lighting', lightingSystem, 'gameplay', 'after-behaviors');
});

for (const p of [combatPack, inventoryPack, storyPack, aiPack, lightingPack]) registerPack(p);
