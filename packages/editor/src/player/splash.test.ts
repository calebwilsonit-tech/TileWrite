import { describe, expect, it } from 'vitest';
import { HOLD_MS, mimeOf, splashCards } from './splash';

describe('the splash of an exported game', () => {
  it('shows the studio picture, then the text, then "Made with Tilewright"', () => {
    const cards = splashCards({ splashImage: 'assets/logo.png', splashText: 'A game', madeWith: true }, 'blob:x');
    expect(cards.map((c) => c.kind)).toEqual(['image', 'text', 'made']);
  });
  it('leaves out what is not set, and a picture that could not be read', () => {
    expect(splashCards({ splashImage: 'assets/logo.png', madeWith: false }, null)).toEqual([]);
    expect(splashCards({ madeWith: true }, null).map((c) => c.kind)).toEqual(['made']);
  });
  it('keeps every card short', () => {
    for (const ms of Object.values(HOLD_MS)) expect(ms).toBeLessThanOrEqual(2000);
  });
  it('knows the picture types', () => {
    expect(mimeOf('a.PNG')).toBe('image/png');
    expect(mimeOf('a.webp')).toBe('image/webp');
    expect(mimeOf('a.jpg')).toBe('image/jpeg');
  });
});
