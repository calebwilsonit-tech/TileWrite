import { describe, expect, it } from 'vitest';
import { onTopOf } from './screens-dom';

describe('animations on a widget placed by its middle', () => {
  it('keep the widget where it is while they play', () => {
    const frames = onTopOf([{ transform: 'translateY(-30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], 'translateX(-50%)');
    expect(frames).toEqual([{ transform: 'translateX(-50%) translateY(-30px)', opacity: 0 }, { transform: 'translateX(-50%)', opacity: 1 }]);
  });
  it('leave a widget placed by its corner, and a fade, alone', () => {
    const slide = [{ transform: 'scale(0.6)' }, { transform: 'none' }];
    expect(onTopOf(slide, '')).toBe(slide);
    expect(onTopOf([{ opacity: 0 }, { opacity: 1 }], 'translate(-50%, -50%)')).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
});
