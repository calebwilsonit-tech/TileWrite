import { describe, expect, it } from 'vitest';
import { makeSprite, pictureForGravity } from './components';

describe('a picture for each way gravity pulls (Sprite.byGravity)', () => {
  it('is used for the direction it is chosen for, and the one picture is turned for every other', () => {
    const s = makeSprite({ asset: 'hero', byGravity: { '-x': 'hero-on-wall', '+z': 'hero-hanging' } });
    expect(pictureForGravity(s, '-x')).toBe('hero-on-wall');
    expect(pictureForGravity(s, '+z')).toBe('hero-hanging');
    expect(pictureForGravity(s, '+y')).toBeUndefined();
    expect(pictureForGravity(s, '-z')).toBeUndefined();
    expect(pictureForGravity(s, undefined)).toBeUndefined();
  });

  it('ignores an empty choice, and an object with none at all', () => {
    expect(pictureForGravity(makeSprite({ byGravity: { '-x': '' } }), '-x')).toBeUndefined();
    expect(pictureForGravity(makeSprite({}), '-x')).toBeUndefined();
  });
});
