import { describe, expect, it } from 'vitest';
import { newSprite, type EntityData, type SpriteData } from '@tilewright/runtime';
import { applySprite, guessLocomotion, setLocomotionClips, setPlainClip } from './apply';
import { crateEntity, playerEntity } from '../project/templates';

function sprite(...clips: string[]): SpriteData {
  const s = newSprite('hero', 8, 8);
  s.clips = clips.map((name) => ({ name, loop: true, mirror: false, all: [0], dirs: {}, events: [] }));
  return s;
}

describe('guessLocomotion', () => {
  it('matches animations by their names', () => {
    expect(guessLocomotion(sprite('Walk cycle', 'Idle pose', 'jump'))).toEqual({ idle: 'Idle pose', walk: 'Walk cycle', air: 'jump' });
    expect(guessLocomotion(sprite('stand', 'run'))).toEqual({ idle: 'stand', walk: 'run', air: '' });
  });

  it('falls back to the first two animations when names say nothing', () => {
    expect(guessLocomotion(sprite('a', 'b'))).toEqual({ idle: 'a', walk: 'b', air: '' });
  });

  it('returns null without enough information', () => {
    expect(guessLocomotion(sprite())).toBeNull();
    expect(guessLocomotion(sprite('only'))).toBeNull();
    expect(guessLocomotion(sprite('walk'))).toBeNull();
  });
});

describe('applySprite', () => {
  it('gives a moving object a locomotion controller', () => {
    const e: EntityData = playerEntity('e1', 1, 1);
    applySprite(e, sprite('idle', 'walk'));
    expect((e.components.sprite as { asset: string }).asset).toBe('hero');
    const a = e.components.animator as { asset: string; clip: string; controller: { initial: string; states: Record<string, { clip: string }> } };
    expect(a.asset).toBe('hero');
    expect(a.clip).toBe('idle');
    expect(a.controller.initial).toBe('idle');
    expect(a.controller.states.walk!.clip).toBe('walk');
  });

  it('gives a still object its first animation without a controller', () => {
    const e: EntityData = crateEntity('e2', 1, 1);
    applySprite(e, sprite('shine'));
    const a = e.components.animator as { clip: string; controller: unknown };
    expect(a.clip).toBe('shine');
    expect(a.controller).toBeNull();
  });

  it('works for an object with no sprite component yet, and a sprite with no animations', () => {
    const e: EntityData = { id: 'e3', name: 'Thing', tags: [], components: { transform: { x: 0, y: 0, h: 0, facing: 2 } } };
    applySprite(e, sprite());
    expect((e.components.sprite as { asset: string }).asset).toBe('hero');
    expect((e.components.animator as { clip: string }).clip).toBe('');
  });

  it('clears the sprite and the animator', () => {
    const e: EntityData = playerEntity('e1', 1, 1);
    applySprite(e, sprite('idle', 'walk'));
    applySprite(e, undefined);
    expect((e.components.sprite as { asset?: string }).asset).toBeUndefined();
    expect(e.components.animator).toBeUndefined();
    applySprite({ id: 'x', name: 'x', tags: [], components: {} }, undefined); // nothing to clear: no crash
  });

  it('lets the designer pick the animations', () => {
    const e: EntityData = playerEntity('e1', 1, 1);
    const data = sprite('a', 'b', 'c');
    setLocomotionClips(e, data, { idle: 'c', walk: 'a', air: 'b' });
    const a = e.components.animator as { clip: string; controller: { states: Record<string, { clip: string }> } };
    expect(a.clip).toBe('c');
    expect(a.controller.states.air!.clip).toBe('b');
    setPlainClip(e, data, 'b');
    expect((e.components.animator as { controller: unknown; clip: string }).controller).toBeNull();
    expect((e.components.animator as { clip: string }).clip).toBe('b');
  });

  it('produces plain JSON that survives a save', () => {
    const e: EntityData = playerEntity('e1', 1, 1);
    applySprite(e, sprite('idle', 'walk', 'jump'));
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });
});
