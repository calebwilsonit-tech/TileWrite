import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { templates } from './templates';
import { events } from './events';
import { actions, conditions } from './blocks';
import type { Entity } from '@tilewright/plugin-sdk';
import { damage, damageOnTouch, dodge, heal, health, meleeAttack } from './combat';
import { projectile } from './projectile';
import { rangedAttack } from './ranged';
import { bossBarsWidget, heartsWidget } from './hud';

export * from './combat';
export * from './ranged';
export * from './projectile';
export * from './hud';

export const combatPlugin = definePlugin(manifest, {
  templates,
  install(api) {
    api.assistantNote("Combat: health on objects, damage on touch, melee and ranged attacks (rangedAttack makes an enemy shoot), dodging, projectiles; the buttons attack and dodge.");
    for (const e of events) api.event(e);
    api.behaviors(health, damageOnTouch, meleeAttack, rangedAttack, dodge, projectile);
    // an object whose health has run out is defeated (what the playbot and the screens ask)
    api.defeatCheck({ id: 'health', defeated: (e) => e.get<{ dead: boolean }>('state:health')?.dead ?? false });
    api.conditions(...conditions);
    api.actions(...actions);
    api.inputAction('attack', { label: 'Attack', bindings: ['key:KeyJ', 'mouse:0', 'pad:button2'] });
    api.inputAction('dodge', { label: 'Dodge', bindings: ['key:KeyQ', 'pad:button3'] });
    api.widget(heartsWidget);
    api.widget(bossBarsWidget);
    api.scriptMethod({ id: 'damage', run: (ctx, self, [target, amount]) => (target ? damage(ctx, target as Entity, Number(amount), { source: self }) : false) });
    api.scriptMethod({ id: 'heal', run: (ctx, _self, [target, amount]) => void (target && heal(ctx, target as Entity, Number(amount))) });
  },
});
