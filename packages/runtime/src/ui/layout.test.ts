import { describe, expect, it } from 'vitest';
import { anchorAt, checkUiLayout, completeLayout, defaultUiLayout, fillVariables, newCustomWidget, offsetsFor, themeVars, UiLayoutSchema, widgetCss } from './layout';

describe('interface layout', () => {
  it('starts with the engine\'s own piece and the pieces plugins offer, where the game puts them', () => {
    expect(defaultUiLayout().widgets.map((w) => w.id)).toEqual(['toasts']); // the engine knows no other
    const l = defaultUiLayout(['hearts', 'lightbar', 'slots', 'bosses']);
    expect(l.widgets.map((w) => w.id)).toEqual(['hearts', 'lightbar', 'slots', 'bosses', 'toasts']);
    expect(l.widgets.every((w) => w.anchor === 'default' && w.visible)).toBe(true);
    expect(widgetCss(l.widgets[0]!)).toEqual({});
  });

  it('a file that leaves a piece out still shows it', () => {
    const parsed = UiLayoutSchema.parse({ widgets: [{ id: 'hearts', kind: 'hearts', anchor: 'tr', x: 4, y: 4 }] });
    expect(completeLayout(parsed, ['hearts', 'lightbar', 'slots', 'bosses']).widgets.map((w) => w.kind)).toEqual(['hearts', 'lightbar', 'slots', 'bosses', 'toasts']);
    // a file that names a piece no plugin offers (the plugin is off) keeps it, and is still read
    expect(completeLayout(parsed).widgets.map((w) => w.kind)).toEqual(['hearts', 'toasts']);
  });

  it('turns a theme into CSS variables', () => {
    const v = themeVars(defaultUiLayout().theme);
    expect(v['--tw-accent']).toBe('#ffd98a');
    expect(v['--tw-radius']).toBe('10px');
    expect(v['--tw-font']).toContain('Georgia');
    expect(UiLayoutSchema.safeParse({ theme: { accent: 'gold' } }).success).toBe(false);
  });

  it('pins pieces to corners, edges and the middle', () => {
    expect(widgetCss({ anchor: 'tl', x: 12, y: 8, scale: 1 })).toMatchObject({ position: 'absolute', left: '12px', top: '8px', 'transform-origin': 'left top' });
    expect(widgetCss({ anchor: 'br', x: 5, y: 6, scale: 2 })).toMatchObject({ right: '5px', bottom: '6px', transform: 'translate(0, 0) scale(2)' });
    expect(widgetCss({ anchor: 'c', x: 10, y: -20, scale: 1 })).toMatchObject({ left: 'calc(50% + 10px)', top: 'calc(50% + -20px)', transform: 'translate(-50%, -50%) scale(1)' });
    expect(widgetCss({ anchor: 'default', x: 0, y: 0, scale: 1.5 }, 1)).toEqual({ zoom: '1.5' });
  });

  it('picks the nearest of the nine places', () => {
    expect(anchorAt(0.1, 0.1)).toBe('tl');
    expect(anchorAt(0.5, 0.1)).toBe('tc');
    expect(anchorAt(0.9, 0.5)).toBe('cr');
    expect(anchorAt(0.5, 0.5)).toBe('c');
    expect(anchorAt(0.2, 0.95)).toBe('bl');
  });

  it('offsets are the opposite of the CSS so a drag lands where it shows', () => {
    const screen = { w: 1280, h: 720 };
    expect(offsetsFor('tr', { left: 1000, top: 40, w: 200, h: 30 }, screen)).toEqual({ x: 80, y: 40 });
    expect(offsetsFor('tl', { left: 1000, top: 40, w: 200, h: 30 }, screen)).toEqual({ x: 1000, y: 40 });
    expect(offsetsFor('bc', { left: 540, top: 650, w: 200, h: 40 }, screen)).toEqual({ x: 0, y: 30 });
    expect(offsetsFor('c', { left: 540, top: 330, w: 200, h: 60 }, screen)).toEqual({ x: 0, y: 0 });
  });

  it('fills in flags and counters', () => {
    expect(fillVariables('Coins: {coins} / {missing}!', { coins: 3.456 })).toBe('Coins: 3.46 / !');
  });

  it('makes new widgets with ids nobody uses', () => {
    expect(newCustomWidget('counter', []).id).toBe('counter1');
    expect(newCustomWidget('counter', ['counter1']).id).toBe('counter2');
  });

  it('explains what is wrong', () => {
    const l = UiLayoutSchema.parse({
      widgets: [
        { id: 'a', kind: 'counter', variable: '' },
        { id: 'a', kind: 'bar', variable: 'ghost' },
        { id: 't', kind: 'text', text: '' },
        { id: 'hearts', kind: 'hearts', visible: false },
        { id: 't2', kind: 'text', text: 'x {nope}' },
      ],
    });
    const p = checkUiLayout(l, { variables: new Set(['coins']), pieces: [{ piece: 'hearts', name: 'Hearts', hiddenWarning: 'The hearts are hidden, so the player cannot see their health.' }] }).join('\n');
    expect(p).toContain('Two pieces of the screen are both called "a"');
    expect(p).toContain('no flag or counter chosen');
    expect(p).toContain('"ghost", which nothing in your game ever sets');
    expect(p).toContain('no words in it');
    expect(p).toContain('{nope}');
    expect(p).toContain('hearts are hidden');
    expect(p).toContain('Messages are hidden');
    expect(checkUiLayout(defaultUiLayout())).toEqual([]);
    // a piece a plugin offers says what is wrong when it is hidden, in its own words
    const pieces = [{ piece: 'hearts', name: 'Hearts', hiddenWarning: 'The hearts are hidden.' }];
    const hidden = defaultUiLayout(['hearts']);
    hidden.widgets[0]!.visible = false;
    expect(checkUiLayout(hidden, { pieces })).toContain('The hearts are hidden.');
    expect(checkUiLayout(hidden)).not.toContain('The hearts are hidden.');
  });
});
