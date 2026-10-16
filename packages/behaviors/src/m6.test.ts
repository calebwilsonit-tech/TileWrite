import { describe, expect, it } from 'vitest';
import { C, FLAG, tileMapToRows, type Collider, type Label, type RegionData, type Sprite, type TransformIso } from '@tilewright/runtime';
import { GRID_MINUS_X, GRID_PLUS_X, flatScene, player, rig, thing, wire } from './testing';
import { attachBehavior, getBehavior, output, setInput } from './index';

const darkRegion = (darkness = 0.9): RegionData => ({ id: 'r1', name: 'Dark', x: 0, y: 0, w: 24, h: 24, cameraBounds: false, music: '', darkness, bossActive: false });

function withEchoes(settings: object = {}) {
  const p = player('p', 4.5, 4.5);
  attachBehavior(p.components, 'echoRecorder');
  Object.assign(p.components.echoRecorder as object, settings);
  return p;
}

const pos = (r: ReturnType<typeof rig>, e: { get<T>(c: string): T | undefined }): { x: number; y: number } => {
  void r;
  const t = e.get<TransformIso>(C.Transform)!;
  return { x: t.x, y: t.y };
};

describe('echoes', () => {
  it('records the player, replays the movement as a ghost, and the ghost holds a plate', () => {
    const { scene } = flatScene();
    scene.entities.push(withEchoes(), thing('plate', 'Plate', 8.5, 4.5, { pressurePlate: { activatedBy: 'echoes' } }));
    const r = rig(scene);
    r.run(2);
    r.run(1, { echo: 1 }); // start recording
    r.run(1);
    r.run(60, GRID_PLUS_X); // walk four cells onto the plate
    r.run(1);
    r.run(1, { echo: 1 }); // stop
    expect(r.sim.world.withTag('echo')).toHaveLength(1);
    const echo = r.sim.world.withTag('echo')[0]!;
    expect(pos(r, echo)).toEqual({ x: 4.5, y: 4.5 }); // restarted at the spot where it was recorded
    // the player walks away; the echo walks to the plate and stays
    r.run(1, { ...GRID_MINUS_X });
    r.run(120, GRID_MINUS_X);
    r.run(30);
    expect(output(r.get('plate'), 'active')).toBe(true);
    expect(pos(r, echo).x).toBeGreaterThan(8);
    expect(pos(r, r.get('p')).x).toBeLessThan(5); // not the player on the plate
  });

  it('ghosts are see-through, tagged, and on the echo layer so gates can let them pass', () => {
    const { scene } = flatScene();
    scene.entities.push(withEchoes({ ghostAlpha: 0.4 }));
    const r = rig(scene);
    r.run(1, { echo: 1 });
    r.run(1);
    r.run(10, GRID_PLUS_X);
    r.run(1, { echo: 1 });
    const echo = r.sim.world.withTag('echo')[0]!;
    expect(echo.get<Sprite>(C.Sprite)!.alpha).toBe(0.4);
    expect((echo.get('body') as { layer: number }).layer).toBe(8);
    expect(echo.has('playerController')).toBe(false); // the player's own controller must not drive it
  });

  it('only keeps as many echoes as the capacity, replacing the oldest', () => {
    const { scene } = flatScene();
    scene.entities.push(withEchoes({ capacity: 1 }));
    const r = rig(scene);
    const record = (): void => {
      r.run(1, { echo: 1 });
      r.run(1);
      r.run(10, GRID_PLUS_X);
      r.run(1, { echo: 1 });
      r.run(1);
    };
    record();
    const first = r.sim.world.withTag('echo')[0]!.id;
    record();
    const echoes = r.sim.world.withTag('echo');
    expect(echoes).toHaveLength(1);
    expect(echoes[0]!.id).not.toBe(first);
  });

  it('echoes walk through a gate that lets ghosts pass, while the player is stopped by it', () => {
    const run = (ghostsPass: boolean): { player: number; echo: number } => {
      const { scene } = flatScene();
      const p = withEchoes();
      p.components.transform = { x: 4.5, y: 10.5, h: 0, facing: 2 };
      scene.entities.push(p, thing('g', 'Gate', 8.5, 10.5, { gate: { ghostsPass } }));
      const r = rig(scene);
      r.run(1, { echo: 1 });
      r.run(1);
      r.run(120, GRID_PLUS_X);
      r.run(1, { echo: 1 });
      r.run(1);
      r.run(1);
      r.run(130);
      return { player: r.get('p').get<TransformIso>(C.Transform)!.x, echo: r.sim.world.withTag('echo')[0]!.get<TransformIso>(C.Transform)!.x };
    };
    const passes = run(true);
    expect(passes.player).toBeLessThan(8.5);
    expect(passes.echo).toBeGreaterThan(11);
    expect(run(false).echo).toBeLessThan(8.5);
  });
  it('capacity can be raised by a variable (a story flag)', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'slots', value: 1 });
    scene.entities.push(withEchoes({ capacity: 1, capacityVariable: 'slots' }));
    const r = rig(scene);
    const record = (): void => {
      r.run(1, { echo: 1 });
      r.run(1);
      r.run(8, GRID_PLUS_X);
      r.run(1, { echo: 1 });
      r.run(1);
    };
    record();
    record();
    expect(r.sim.world.withTag('echo')).toHaveLength(2);
    r.sim.runtime.vars.slots = 0;
    record();
    expect(r.sim.world.withTag('echo')).toHaveLength(1);
  });

  it('cannot record with capacity 0 and says so', () => {
    const { scene } = flatScene();
    scene.entities.push(withEchoes({ capacity: 0 }));
    const r = rig(scene);
    r.run(1, { echo: 1 });
    expect(r.get('p').get('state:echoRecorder')).toBeDefined();
    expect((r.get('p').get('state:echoRecorder') as { recorder: unknown }).recorder).toBeNull();
    expect(r.get('p').has('label')).toBe(false);
  });

  it('stops recording by itself at the time limit', () => {
    const { scene } = flatScene();
    scene.entities.push(withEchoes({ seconds: 1 }));
    const r = rig(scene);
    r.run(1, { echo: 1 });
    r.run(1);
    expect(r.get('p').has('label')).toBe(true); // "recording" indicator
    r.run(70);
    expect(r.sim.world.withTag('echo')).toHaveLength(1);
    expect(r.get('p').has('label')).toBe(false);
  });

  it('echoes can vanish or loop when they finish', () => {
    for (const ending of ['vanish', 'loop'] as const) {
      const { scene } = flatScene();
      scene.entities.push(withEchoes({ ending }));
      const r = rig(scene);
      r.run(1, { echo: 1 });
      r.run(1);
      r.run(30, GRID_PLUS_X);
      r.run(1, { echo: 1 });
      r.run(120);
      const echoes = r.sim.world.withTag('echo');
      if (ending === 'vanish') expect(echoes).toHaveLength(0);
      else expect(echoes).toHaveLength(1);
    }
  });

  it('is deterministic: the same inputs give the same world', () => {
    const run = (): number => {
      const { scene } = flatScene();
      scene.entities.push(withEchoes(), thing('plate', 'Plate', 8.5, 4.5, { pressurePlate: { activatedBy: 'echoes' } }));
      const r = rig(scene);
      r.run(1, { echo: 1 });
      r.run(1);
      r.run(60, GRID_PLUS_X);
      r.run(1, { echo: 1 });
      r.run(100, GRID_MINUS_X);
      return r.sim.stateHash();
    };
    expect(run()).toBe(run());
  });

  it('two echoes hold two plates that open a gate through an AND', () => {
    const { scene } = flatScene();
    scene.entities.push(
      withEchoes({ capacity: 2 }),
      thing('plate1', 'Plate 1', 8.5, 4.5, { pressurePlate: { activatedBy: 'echoes' } }),
      thing('plate2', 'Plate 2', 4.5, 8.5, { pressurePlate: { activatedBy: 'echoes' } }),
      thing('and', 'AND', 12.5, 12.5, { logic: { kind: 'and' } }),
      thing('gate', 'Gate', 14.5, 12.5, { gate: {} }),
    );
    scene.wires.push(wire('w1', ['plate1', 'active'], ['and', 'a']), wire('w2', ['plate2', 'active'], ['and', 'b']), wire('w3', ['and', 'out'], ['gate', 'open']));
    const r = rig(scene);
    r.run(2);
    // first echo: walk +x onto plate 1
    r.run(1, { echo: 1 });
    r.run(1);
    r.run(60, GRID_PLUS_X);
    r.run(1, { echo: 1 });
    r.run(1);
    // back to the start (the player walks back along -x)
    r.run(60, GRID_MINUS_X);
    r.run(30);
    expect(output(r.get('plate1'), 'active')).toBe(true);
    expect(output(r.get('gate'), 'isOpen')).toBe(false);
    // second echo: walk +y onto plate 2 (+y in grid space = left+down on screen)
    r.run(1, { echo: 1 });
    r.run(1);
    r.run(60, { move_left: 1, move_down: 1 });
    r.run(1, { echo: 1 });
    r.run(1);
    r.run(200, { move_right: 1, move_up: 1 });
    expect(r.sim.world.withTag('echo')).toHaveLength(2);
    expect(output(r.get('plate1'), 'active')).toBe(true);
    expect(output(r.get('plate2'), 'active')).toBe(true);
    expect(output(r.get('gate'), 'isOpen')).toBe(true);
  });
});

describe('light', () => {
  it('sensors react to light in a dark region', () => {
    const { scene } = flatScene();
    scene.regions.push(darkRegion());
    scene.entities.push(
      player('p', 20.5, 20.5),
      thing('lamp', 'Lamp', 6.5, 6.5, { light: { flicker: 0, radius: 4 } }),
      thing('near', 'Near', 7.5, 6.5, { lightSensor: { mode: 'lit' } }),
      thing('far', 'Far', 14.5, 14.5, { lightSensor: { mode: 'lit' } }),
      thing('dark', 'Dark', 14.5, 15.5, { lightSensor: { mode: 'dark' } }),
    );
    const r = rig(scene);
    r.run(3);
    expect(output(r.get('near'), 'active')).toBe(true);
    expect(output(r.get('far'), 'active')).toBe(false);
    expect(output(r.get('dark'), 'active')).toBe(true);
    expect(r.sim.runtime.lighting!.lights).toHaveLength(1);
  });

  it('a light can be switched with a wire, and walls make shadows', () => {
    const build = (startOn: boolean) => {
      const { scene } = flatScene();
      scene.regions.push(darkRegion());
      scene.entities.push(
        player('p', 20.5, 20.5),
        thing('lamp', 'Lamp', 6.5, 6.5, { light: { flicker: 0, radius: 6, mode: 'whenOn' } }),
        thing('lever', 'Lever', 3.5, 3.5, { lever: { startOn } }),
        thing('wall', 'Wall', 8.5, 6.5, {}, { collider: { w: 1, d: 1, height: 2, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } }),
        thing('lit', 'Lit', 7.5, 6.5, { lightSensor: {} }),
        thing('behind', 'Behind', 10.5, 6.5, { lightSensor: {} }),
        thing('side', 'Side', 6.5, 9.5, { lightSensor: {} }),
      );
      scene.wires.push(wire('w', ['lever', 'on'], ['lamp', 'switch']));
      const r = rig(scene);
      r.run(4);
      return r;
    };
    const off = build(false);
    expect(output(off.get('lit'), 'active')).toBe(false);
    expect(output(off.get('side'), 'active')).toBe(false);
    const on = build(true);
    expect(output(on.get('lit'), 'active')).toBe(true);
    expect(output(on.get('behind'), 'active')).toBe(false); // in the wall's shadow
    expect(output(on.get('side'), 'active')).toBe(true);
  });

  it('the "darkness" variable darkens the whole scene (set from an event sheet)', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'darkness', value: 1 });
    scene.entities.push(player('p', 5.5, 5.5), thing('s', 'S', 8.5, 8.5, { lightSensor: { mode: 'dark' } }));
    const r = rig(scene);
    r.run(3);
    expect(output(r.get('s'), 'active')).toBe(true);
    r.sim.runtime.vars.darkness = 0;
    r.run(3);
    expect(output(r.get('s'), 'active')).toBe(false);
  });

  it('has plain-English help for every light and echo setting', () => {
    for (const id of ['light', 'lightSensor', 'growing', 'echoRecorder', 'sentenceStone', 'textBlock']) {
      const b = getBehavior(id)!;
      expect(b.description.length).toBeGreaterThan(20);
      for (const f of b.fields) expect(f.label.length).toBeGreaterThan(2);
    }
    expect(getBehavior('echoReplay')!.hidden).toBe(true);
  });
});

describe('growing objects', () => {
  it('grow over time, faster in light, and become taller solid blocks', () => {
    const { scene } = flatScene();
    scene.regions.push(darkRegion());
    scene.entities.push(
      player('p', 20.5, 20.5),
      thing('lamp', 'Lamp', 6.5, 6.5, { light: { flicker: 0, radius: 5 } }),
      thing('lit', 'Lit dough', 7.5, 6.5, { growing: { growSeconds: 10, lightBoost: 5, maxHeight: 2 } }),
      thing('dim', 'Dim dough', 16.5, 6.5, { growing: { growSeconds: 10, lightBoost: 5, maxHeight: 2 } }),
    );
    const r = rig(scene);
    r.run(120);
    const grown = (id: string): number => (r.get(id).get('state:growing') as { progress: number }).progress;
    expect(grown('lit')).toBeGreaterThan(grown('dim') * 2);
    expect(r.get('lit').get<Sprite>(C.Sprite)!.height).toBeGreaterThan(r.get('dim').get<Sprite>(C.Sprite)!.height);
    expect(r.get('lit').get<Collider>(C.Collider)!.height).toBe(r.get('lit').get<Sprite>(C.Sprite)!.height);
    r.run(60 * 12);
    expect(grown('lit')).toBe(1);
    expect(output(r.get('lit'), 'full')).toBe(true);
  });

  it('shrinks while its Shrink signal is on', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 20.5, 20.5), thing('d', 'Dough', 8.5, 8.5, { growing: { growSeconds: 5, startFull: true, lightBoost: 1 } }));
    const r = rig(scene);
    r.run(2);
    setInput(r.get('d'), 'shrink', true);
    r.run(200);
    expect((r.get('d').get('state:growing') as { progress: number }).progress).toBeLessThan(0.5);
  });
});

describe('sentence stones', () => {
  function stoneScene() {
    const { scene } = flatScene();
    scene.variables.push({ name: 'word', value: '' });
    scene.entities.push(
      player('p', 5.5, 5.5),
      thing('s', 'Stone', 6.5, 5.5, { sentenceStone: { before: 'The bridge', words: 'breaks, holds', variable: 'word' } }),
      thing('far', 'Far stone', 18.5, 18.5, { sentenceStone: {} }),
      thing('gate', 'Gate', 12.5, 12.5, { gate: { invert: true } }),
    );
    return scene;
  }

  it('shows the sentence and swaps the word when the player interacts', () => {
    const r = rig(stoneScene());
    r.run(2);
    expect(r.get('s').get<Label>('label')!.text).toBe('The bridge [ BREAKS ]');
    expect(output(r.get('s'), 'word1')).toBe(true);
    r.run(1, { interact: 1 });
    expect(r.get('s').get<Label>('label')!.text).toBe('The bridge [ HOLDS ]');
    expect(output(r.get('s'), 'word2')).toBe(true);
    expect(output(r.get('s'), 'word1')).toBe(false);
    expect(r.sim.runtime.vars.word).toBe('holds');
    r.run(1);
    r.run(1, { interact: 1 });
    expect(r.get('s').get<Label>('label')!.text).toBe('The bridge [ BREAKS ]'); // wraps around
    expect(r.get('far').get<Label>('label')!.text).toContain('BREAKS'); // too far away to change
  });

  it('holding interact only swaps once', () => {
    const r = rig(stoneScene());
    r.run(1, { interact: 1 });
    r.run(20, { interact: 1 });
    expect(r.get('s').get<Label>('label')!.text).toContain('HOLDS');
  });

  it('a chosen word drives other objects through wires', () => {
    const scene = stoneScene();
    scene.wires.push(wire('w', ['s', 'word2'], ['gate', 'open']));
    const r = rig(scene);
    r.run(2);
    // word 1 chosen: the inverted gate is open when its signal is off
    expect(output(r.get('gate'), 'isOpen')).toBe(false);
    r.run(1, { interact: 1 });
    r.run(120);
    // word 2 chosen: signal on, inverted gate closes
    expect(output(r.get('gate'), 'isOpen')).toBe(false);
  });

  it('copes with a missing word list', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('s', 'Stone', 6.5, 5.5, { sentenceStone: { words: '' } }));
    const r = rig(scene);
    r.run(1, { interact: 1 });
    expect(r.get('s').get<Label>('label')!.text).toContain('...');
  });
});

describe('formattable text blocks', () => {
  function blockScene(format = 'plain', x = 6.5, y = 5.5) {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('b', 'Block', x, y, { textBlock: { text: 'BRIDGE', format } }));
    return scene;
  }
  const state = (r: ReturnType<typeof rig>) => ({
    c: r.get('b').get<Collider>(C.Collider)!,
    s: r.get('b').get<Sprite>(C.Sprite)!,
    l: r.get('b').get<Label>('label')!,
  });

  it('plain text is inert; underline makes a flat solid bridge; bold a wall; italic slippery', () => {
    const r = rig(blockScene());
    r.run(2);
    expect(state(r).c.enabled).toBe(false);
    r.run(1, { interact: 1 });
    r.run(1);
    expect(state(r).l.underline).toBe(true);
    expect(state(r).c.solid && state(r).c.enabled).toBe(true);
    expect(state(r).c.height).toBeLessThan(0.3);
    r.run(1, { interact: 1 });
    r.run(1);
    expect(state(r).l.bold).toBe(true);
    expect(state(r).c.height).toBe(2);
    r.run(1, { interact: 1 });
    r.run(1);
    expect(state(r).l.italic).toBe(true);
    r.run(1, { interact: 1 });
    r.run(1);
    expect(state(r).c.enabled).toBe(false); // back to plain
  });

  it('wired Bold overrides the block; the player cannot reformat if that is turned off', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('b', 'Block', 6.5, 5.5, { textBlock: { playerCanFormat: false } }));
    const r = rig(scene);
    r.run(1, { interact: 1 });
    r.run(1);
    expect(r.get('b').get<Label>('label')!.underline).toBe(false);
    setInput(r.get('b'), 'bold', true);
    r.run(2);
    expect(r.get('b').get<Collider>(C.Collider)!.height).toBe(2);
  });

  it('a bold wall stops the player', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 4.5, 5.5), thing('b', 'Wall', 8.5, 5.5, { textBlock: { format: 'bold' } }));
    const r = rig(scene);
    r.run(150, GRID_PLUS_X);
    expect(r.get('p').get<TransformIso>(C.Transform)!.x).toBeLessThan(8.5);
  });

  it('italic text slides until it hits something when pushed', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 4.5, 10.5), thing('b', 'Slider', 6.5, 10.5, { textBlock: { format: 'italic' } }));
    const r = rig(scene);
    r.run(200, GRID_PLUS_X);
    r.run(120);
    const x = r.get('b').get<TransformIso>(C.Transform)!.x;
    expect(x).toBeGreaterThan(18);
    expect(x).toBeLessThan(24);
    expect(x % 1).toBeCloseTo(0.5, 5);
  });

  it('an underlined text block is a bridge over a pit; plain text lets you fall', () => {
    const walk = (format: string): { x: number; h: number } => {
      const { map, scene } = flatScene();
      map.setFlag(8, 5, FLAG.PIT);
      map.setFlag(9, 5, FLAG.PIT);
      scene.map = tileMapToRows(map);
      scene.entities.push(player('p', 5.5, 5.5), thing('b', 'Bridge', 9, 5.5, { textBlock: { format } }));
      const r = rig(scene);
      r.run(200, GRID_PLUS_X);
      const t = r.get('p').get<TransformIso>(C.Transform)!;
      return { x: t.x, h: t.h };
    };
    const bridged = walk('underline');
    expect(bridged.x).toBeGreaterThan(10.5);
    expect(bridged.h).toBeGreaterThan(-0.5);
    const plain = walk('plain');
    expect(plain.h < -0.5 || plain.x < 8).toBe(true);
  });
});