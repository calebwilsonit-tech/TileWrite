import { describe, expect, it } from 'vitest';
import { newAction, newCondition, newRow, type EventRow, type EventAction, type EventCondition } from '@tilewright/plugin-sdk';
import { GRID_PLUS_X, flatScene, player, rig, thing } from '@tilewright/plugin-sdk/testing';
import '@tilewright/bundled-plugins';

const row = (partial: Partial<EventRow> & { id: string }): EventRow => ({ ...newRow(partial.id), conditions: [], ...partial });
const cond = (type: string, params: Record<string, unknown> = {}): EventCondition => ({ ...newCondition(type), params: { ...newCondition(type).params, ...params }, negate: false });
const act = (type: string, params: Record<string, unknown> = {}): EventAction => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });

describe('events from the plugins', () => {
  it('a pickup announces itself to the event sheet', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('coin', 'Coin', 6.5, 5.5, { pickup: { variable: 'coins' } }));
    scene.events = [row({ id: 'pick', conditions: [cond('onEvent', { name: 'pickup' })], actions: [act('message', { text: 'Coins: {coins}' })] })];
    const r = rig(scene);
    const msgs: unknown[] = [];
    r.sim.events.on('message', (e) => msgs.push(e.text));
    r.run(60, GRID_PLUS_X);
    expect(msgs).toEqual(['Coins: 1']);
  });
});
