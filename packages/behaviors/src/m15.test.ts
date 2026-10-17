import { describe, expect, it } from 'vitest';
import { C, ItemSchema, itemCount, newMinigame, symbolDirs, type MinigameData, type TransformIso } from '@tilewright/runtime';
import { GRID_PLUS_X, ctxOf, flatScene, player, rig, thing, type Rig } from './testing';
import { beginMinigame, newAction, newCondition, newRow, output } from './index';

const timing = (patch: Partial<MinigameData> = {}): MinigameData => ({ ...newMinigame('timing', 'Duel'), rounds: 1, allowedMisses: 0, ...patch }) as MinigameData;

function arcadeRig(m: MinigameData, extraScene?: (s: ReturnType<typeof flatScene>['scene']) => void): Rig {
  const { scene } = flatScene();
  scene.entities.push(player('p', 5.5, 5.5), thing('arcade', 'Arcade', 6.5, 5.5, { minigameStation: { minigame: m.name } }));
  extraScene?.(scene);
  const r = rig(scene);
  r.sim.assets.minigames.set(m.name, m);
  r.sim.assets.items.set('medal', ItemSchema.parse({ id: 'medal', name: 'Medal' }));
  return r;
}

describe('minigame station', () => {
  it('opens on Interact, freezes the world and returns control when the result is dismissed', () => {
    const r = arcadeRig(timing());
    r.run(2);
    expect(r.get('arcade').get<{ text: string }>('label')?.text).toBe('E: play');
    r.run(1, { interact: 1 });
    expect(r.sim.runtime.minigame?.phase).toBe('intro');
    expect(r.sim.modal).toBe('freeze');
    const x = r.get('p').get<TransformIso>(C.Transform)!.x;
    r.run(20, GRID_PLUS_X);
    expect(r.get('p').get<TransformIso>(C.Transform)!.x).toBe(x); // the player cannot walk away
    expect(output(r.get('arcade'), 'playing')).toBe(true);
    r.run(1);
    r.run(1, { pause: 1 }); // give up
    expect(r.sim.runtime.minigame).toBeNull();
    expect(r.sim.runtime.vars['minigame:Duel:played']).toBe(1);
    expect(r.sim.runtime.vars['minigame:Duel:won']).toBeUndefined();
    r.run(1);
    expect(output(r.get('arcade'), 'played')).toBe(true);
    expect(output(r.get('arcade'), 'won')).toBe(false);
  });

  it('winning sets the flags, the score, gives the reward once and lets the next player action through', () => {
    const r = arcadeRig(timing({ winVariable: 'duelWon', scoreVariable: 'duelScore', rewardItem: 'medal' }));
    const play = (): void => {
      r.run(1, { interact: 1 });
      r.run(1);
      r.run(1, { interact: 1 }); // start
      r.run(1);
      const st = r.sim.runtime.minigame!;
      for (let i = 0; i < 600 && st.phase === 'play'; i++) {
        const centre = st.zoneAt + st.zoneSize / 2;
        r.run(1, Math.abs(st.pos - centre) < 0.03 ? { interact: 1 } : {});
        r.run(1);
      }
      expect(st.phase).toBe('won');
      r.run(1, { interact: 1 });
      r.run(1);
    };
    play();
    expect(r.sim.runtime.minigame).toBeNull();
    r.run(1);
    expect(r.sim.runtime.vars['minigame:Duel:won']).toBe(true);
    expect(r.sim.runtime.vars['duelWon']).toBe(true);
    expect(r.sim.runtime.vars['duelScore']).toBe(100);
    expect(r.sim.runtime.vars['minigame:Duel:best']).toBe(100);
    expect(itemCount(r.sim.runtime.vars, 'medal')).toBe(1);
    expect(output(r.get('arcade'), 'won')).toBe(true);
    play(); // the reward is for the first win only
    expect(itemCount(r.sim.runtime.vars, 'medal')).toBe(1);
    expect(r.sim.runtime.vars['minigame:Duel:played']).toBe(2);
  });

  it('can refuse a second play after a win, and says so when the minigame is missing', () => {
    const r = arcadeRig(timing());
    r.sim.runtime.vars['minigame:Duel:won'] = true;
    r.get('arcade').get<{ onlyUntilWon: boolean }>('minigameStation')!.onlyUntilWon = true;
    r.run(2);
    r.run(1, { interact: 1 });
    expect(r.sim.runtime.minigame).toBeNull();
    const problems: string[] = [];
    r.sim.events.on('problem', (e) => void problems.push(String(e.text)));
    expect(beginMinigame(ctxOf(r), 'Nope')).toBe(false);
    r.run(1);
    expect(problems.join(' ')).toMatch(/minigame "Nope", which does not exist/);
  });

  it('can be started by an event row, and another row reacts when it ends and when it was won', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'ended', value: 0 }, { name: 'wonRow', value: 0 });
    const cond = (type: string, params: Record<string, unknown> = {}) => ({ ...newCondition(type), params: { ...newCondition(type).params, ...params } });
    const act = (type: string, params: Record<string, unknown> = {}) => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });
    scene.entities.push(player('p', 5.5, 5.5));
    scene.events = [
      { ...newRow('go'), conditions: [cond('start')], actions: [act('playMinigame', { minigame: 'Duel' })] },
      { ...newRow('end'), conditions: [cond('onEvent', { name: 'minigame-ended' })], actions: [act('setVariable', { name: 'ended', op: 'set', value: '1' })] },
      { ...newRow('won'), conditions: [cond('minigameWon', { minigame: 'Duel' })], actions: [act('setVariable', { name: 'wonRow', op: 'set', value: '1' })] },
    ];
    const r = rig(scene);
    r.sim.assets.minigames.set('Duel', timing());
    r.run(3);
    expect(r.sim.runtime.minigame).not.toBeNull();
    r.run(1, { pause: 1 }); // give up
    r.run(3);
    expect(r.sim.runtime.vars['ended']).toBe(1);
    expect(r.sim.runtime.vars['wonRow']).toBe(0);
    r.sim.runtime.vars['minigame:Duel:won'] = true;
    r.run(3);
    expect(r.sim.runtime.vars['wonRow']).toBe(1);
  });

  it('plays the pattern game with the arrow buttons', () => {
    const m = { ...newMinigame('sequence', 'Echo'), length: 3, buttons: 4, showSeconds: 0.2, allowedMistakes: 0 } as MinigameData;
    const r = arcadeRig(m);
    r.run(2);
    r.run(1, { interact: 1 });
    r.run(1);
    r.run(1, { interact: 1 });
    r.run(1);
    const st = r.sim.runtime.minigame!;
    for (let i = 0; i < 1000 && st.phase === 'show'; i++) r.run(1);
    expect(st.phase).toBe('play');
    const dirs = symbolDirs(4);
    for (const s of st.seq) {
      r.run(1, { [`move_${dirs[s]}`]: 1 });
      r.run(1);
    }
    expect(st.phase).toBe('won');
  });
});

describe('news of a finished conversation', () => {
  it('reaches event rows even though the world was frozen while it ended', async () => {
    const { DialogueSchema } = await import('@tilewright/runtime');
    const { scene } = flatScene();
    scene.variables.push({ name: 'after', value: 0 });
    const cond = (type: string, params: Record<string, unknown> = {}) => ({ ...newCondition(type), params: { ...newCondition(type).params, ...params } });
    const act = (type: string, params: Record<string, unknown> = {}) => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });
    scene.entities.push(player('p', 5.5, 5.5));
    scene.events = [
      { ...newRow('go'), conditions: [cond('start')], actions: [act('startDialogue', { dialogue: 'Hi' })] },
      { ...newRow('done'), conditions: [cond('onEvent', { name: 'dialogue-ended' })], actions: [act('setVariable', { name: 'after', op: 'set', value: '1' })] },
    ];
    const r = rig(scene);
    r.sim.assets.dialogues.set('Hi', DialogueSchema.parse({ name: 'Hi', start: 'a', nodes: [{ id: 'a', type: 'line', text: 'Hello', next: 'z' }, { id: 'z', type: 'end' }] }));
    r.run(3);
    expect(r.sim.runtime.dialogue).not.toBeNull();
    r.run(1, { interact: 1 });
    r.run(3);
    expect(r.sim.runtime.dialogue).toBeNull();
    expect(r.sim.runtime.vars['after']).toBe(1);
  });
});
