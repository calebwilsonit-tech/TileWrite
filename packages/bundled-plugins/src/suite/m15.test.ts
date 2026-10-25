import { describe, expect, it } from 'vitest';
import { C, type TransformIso } from '@tilewright/runtime';
import { ItemSchema, itemCount, newMinigame, openMinigame, putRecord, symbolDirs, type MinigameData } from '@tilewright/plugin-sdk';
import { GRID_PLUS_X, ctxOf, flatScene, player, rig, thing, type Rig } from '@tilewright/plugin-sdk/testing';
import { beginMinigame } from '@tilewright/plugin-story';
import { newAction, newCondition, newRow, output } from '@tilewright/behaviors';
import '@tilewright/bundled-plugins';

const timing = (patch: Partial<MinigameData> = {}): MinigameData => ({ ...newMinigame('timing', 'Duel'), rounds: 1, allowedMisses: 0, ...patch }) as MinigameData;

function arcadeRig(m: MinigameData, extraScene?: (s: ReturnType<typeof flatScene>['scene']) => void): Rig {
  const { scene } = flatScene();
  scene.entities.push(player('p', 5.5, 5.5), thing('arcade', 'Arcade', 6.5, 5.5, { minigameStation: { minigame: m.name } }));
  extraScene?.(scene);
  const r = rig(scene);
  putRecord(r.sim.assets, 'minigames', m.name, m);
  putRecord(r.sim.assets, 'items', 'medal', ItemSchema.parse({ id: 'medal', name: 'Medal' }));
  return r;
}

describe('minigame station', () => {
  it('opens on Interact, freezes the world and returns control when the result is dismissed', () => {
    const r = arcadeRig(timing());
    r.run(2);
    expect(r.get('arcade').get<{ text: string }>('label')?.text).toBe('E: play');
    r.run(1, { interact: 1 });
    expect(openMinigame(r.sim.runtime)?.phase).toBe('intro');
    expect(r.sim.modal).toBe('freeze');
    const x = r.get('p').get<TransformIso>(C.Transform)!.x;
    r.run(20, GRID_PLUS_X);
    expect(r.get('p').get<TransformIso>(C.Transform)!.x).toBe(x); // the player cannot walk away
    expect(output(r.get('arcade'), 'playing')).toBe(true);
    r.run(1);
    r.run(1, { pause: 1 }); // give up
    expect(openMinigame(r.sim.runtime)).toBeNull();
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
      const st = openMinigame(r.sim.runtime)!;
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
    expect(openMinigame(r.sim.runtime)).toBeNull();
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
    expect(openMinigame(r.sim.runtime)).toBeNull();
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
    putRecord(r.sim.assets, 'minigames', 'Duel', timing());
    r.run(3);
    expect(openMinigame(r.sim.runtime)).not.toBeNull();
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
    const st = openMinigame(r.sim.runtime)!;
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

describe('sound source', () => {
  const rigWith = (settings: object): Rig => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 2.5, 2.5), thing('drip', 'Drip', 8.5, 5.5, { soundSource: settings }));
    return rig(scene);
  };
  const sounds = (r: Rig) => r.sim.runtime.fx.filter((f) => f.kind === 'sound');

  it('an ambient source is audible while it loops, and a Silence signal turns it off', () => {
    const r = rigWith({ sound: 'waterfall', ambient: true });
    r.run(3);
    expect(r.get('drip').get<{ audible: boolean }>('state:soundSource')!.audible).toBe(true);
    expect(output(r.get('drip'), 'audible')).toBe(true);
    expect(sounds(r)).toHaveLength(0); // the loop is the host's job; no one-shots are queued
    (r.get('drip').get<{ inputs: Record<string, boolean> }>('signals')!).inputs.silence = true;
    r.run(2);
    expect(r.get('drip').get<{ audible: boolean }>('state:soundSource')!.audible).toBe(false);
  });

  it('a one-shot repeats every so often, from its own place with its own hearing range', () => {
    const r = rigWith({ sound: 'drip', ambient: false, every: 1, near: 3, far: 9, volume: 0.5 });
    r.run(130);
    const list = sounds(r);
    expect(list.length).toBe(2);
    expect(list[0]).toMatchObject({ kind: 'sound', name: 'drip', volume: 0.5, at: { x: 8.5, y: 5.5, near: 3, far: 9 } });
  });

  it('a one-shot with no repeat plays when its Play input rises, once per rise', () => {
    const r = rigWith({ sound: 'ding', ambient: false, every: 0 });
    r.run(5);
    expect(sounds(r)).toHaveLength(0);
    const sig = r.get('drip').get<{ inputs: Record<string, boolean> }>('signals')!;
    sig.inputs.play = true;
    r.run(5);
    expect(sounds(r)).toHaveLength(1);
    sig.inputs.play = false;
    r.run(2);
    sig.inputs.play = true;
    r.run(2);
    expect(sounds(r)).toHaveLength(2);
  });

  it('the Play a sound action can say where a sound comes from', () => {
    const { scene } = flatScene();
    const cond = (type: string) => ({ ...newCondition(type) });
    const act = (type: string, params: Record<string, unknown>) => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });
    scene.entities.push(player('p', 2.5, 2.5), thing('bell', 'Bell', 9.5, 4.5, {}));
    scene.events = [{ ...newRow('ring'), once: true, conditions: [cond('start')], actions: [act('sound', { name: 'bell', at: 'name:Bell', far: 20 }), act('sound', { name: 'plain' })] }];
    const r = rig(scene);
    r.run(3);
    expect(sounds(r)).toEqual([
      { kind: 'sound', name: 'bell', volume: 1, at: { x: 9.5, y: 4.5, near: 2, far: 20 } },
      { kind: 'sound', name: 'plain', volume: 1 },
    ]);
  });
});

describe('puzzle event blocks (echoes, light, words)', () => {
  const act = (type: string, params: Record<string, unknown> = {}) => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });
  const cond = (type: string, params: Record<string, unknown> = {}) => ({ ...newCondition(type), params: { ...newCondition(type).params, ...params } });

  it('a sentence stone can be read and changed by event rows', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'holds', value: 0 }, { name: 'breaks', value: 0 });
    scene.entities.push(player('p', 5.5, 5.5), thing('stone', 'Stone', 8.5, 5.5, { sentenceStone: { before: 'The bridge', words: 'breaks, holds, shakes', after: '', selected: 0 } }));
    scene.events = [
      { ...newRow('swap'), once: true, conditions: [cond('start')], actions: [act('setWord', { stone: 'name:Stone', word: 'Holds' })] },
      { ...newRow('says'), conditions: [cond('stoneSays', { stone: 'name:Stone', word: 'holds' })], actions: [act('setVariable', { name: 'holds', op: 'set', value: '1' })] },
      { ...newRow('old'), conditions: [cond('stoneSays', { stone: 'name:Stone', word: 'breaks' })], actions: [act('setVariable', { name: 'breaks', op: 'set', value: '1' })] },
    ];
    const r = rig(scene);
    const changes: unknown[] = [];
    r.sim.events.on('sentence-changed', (e) => void changes.push(e.word));
    r.run(5);
    expect(r.sim.runtime.vars.holds).toBe(1);
    expect(r.sim.runtime.vars.breaks).toBe(0); // the swap came first in the same tick
    expect(changes).toEqual(['holds']);
    expect(output(r.get('stone'), 'word2')).toBe(true);
  });

  it('a text block can be asked about and formatted by event rows', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'bridge', value: 0 });
    scene.entities.push(player('p', 5.5, 5.5), thing('t', 'Text', 8.5, 5.5, { textBlock: { text: 'BRIDGE', format: 'plain', playerCanFormat: false } }));
    scene.events = [
      { ...newRow('fmt'), once: true, conditions: [cond('start')], actions: [act('formatText', { block: 'name:Text', format: 'underline' })] },
      { ...newRow('is'), conditions: [cond('textIs', { block: 'name:Text', format: 'underline' })], actions: [act('setVariable', { name: 'bridge', op: 'set', value: '1' })] },
    ];
    const r = rig(scene);
    r.run(5);
    expect(r.sim.runtime.vars.bridge).toBe(1);
  });

  it('echoes can be counted and cleared, and a spot can be asked whether it is lit', () => {
    const { scene } = flatScene();
    scene.regions.push({ id: 'd', name: 'Dark', x: 0, y: 0, w: 24, h: 24, cameraBounds: false, music: '', darkness: 0.95, bossActive: false });
    scene.variables.push({ name: 'twoEchoes', value: 0 }, { name: 'gone', value: 0 }, { name: 'dark', value: 0 }, { name: 'lit', value: 0 });
    const hero = player('p', 5.5, 5.5);
    scene.entities.push(hero, thing('lamp', 'Lamp', 12.5, 12.5, { light: { radius: 3, flicker: 0 } }), thing('mark', 'Mark', 12.5, 12.5, {}), thing('far', 'Far', 20.5, 3.5, {}));
    scene.events = [
      { ...newRow('l'), conditions: [cond('litAt', { where: 'name:Mark', state: 'lit' })], actions: [act('setVariable', { name: 'lit', op: 'set', value: '1' })] },
      { ...newRow('d'), conditions: [cond('litAt', { where: 'name:Far', state: 'dark' })], actions: [act('setVariable', { name: 'dark', op: 'set', value: '1' })] },
      { ...newRow('two'), conditions: [cond('echoCount', { atLeast: 2 })], actions: [act('setVariable', { name: 'twoEchoes', op: 'set', value: '1' }), act('clearEchoes')] },
    ];
    const r = rig(scene);
    r.run(4);
    expect(r.sim.runtime.vars.lit).toBe(1);
    expect(r.sim.runtime.vars.dark).toBe(1);
    expect(r.sim.runtime.vars.twoEchoes).toBe(0);
    for (let i = 0; i < 2; i++) r.sim.world.spawn({ name: 'Echo', tags: ['echo'], components: { echoReplay: {} } });
    r.run(3);
    expect(r.sim.runtime.vars.twoEchoes).toBe(1);
    expect(r.sim.world.withTag('echo')).toHaveLength(0);
  });
});
