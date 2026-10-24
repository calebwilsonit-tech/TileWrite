import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json';
import { events } from './events';
import { actions, conditions } from './blocks';
import type { Entity } from '@tilewright/plugin-sdk';
import { damage, damageOnTouch, dodge, heal, health, meleeAttack } from './combat';
import { projectile } from './projectile';
import { rangedAttack } from './ranged';

export * from './combat';
export * from './ranged';
export * from './projectile';

export const combatPlugin = definePlugin(manifest, {
  install(api) {
    for (const e of events) api.event(e);
    api.behaviors(health, damageOnTouch, meleeAttack, rangedAttack, dodge, projectile);
    api.conditions(...conditions);
    api.actions(...actions);
    api.inputAction('attack', { label: 'Attack', bindings: ['key:KeyJ', 'mouse:0', 'pad:button2'] });
    api.inputAction('dodge', { label: 'Dodge', bindings: ['key:KeyQ', 'pad:button3'] });
    api.scriptMethod({ id: 'damage', run: (ctx, self, [target, amount]) => (target ? damage(ctx, target as Entity, Number(amount), { source: self }) : false) });
    api.scriptMethod({ id: 'heal', run: (ctx, _self, [target, amount]) => void (target && heal(ctx, target as Entity, Number(amount))) });
  },
});
