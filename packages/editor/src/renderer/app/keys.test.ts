import { describe, expect, it } from 'vitest';
import { eventKeySpec, findConflicts, formatKeySpec, isModifierOnly, matches, parseKeySpec } from './keys';

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('key specs', () => {
  it('parses and formats', () => {
    expect(parseKeySpec('Ctrl+Shift+z')).toEqual({ ctrl: true, shift: true, alt: false, key: 'Z' });
    expect(formatKeySpec(parseKeySpec('shift+ctrl+Z'))).toBe('Ctrl+Shift+Z');
    expect(parseKeySpec('F5').key).toBe('F5');
    expect(parseKeySpec('Space').key).toBe('Space');
  });

  it('matches plain letters case-insensitively but not with extra modifiers', () => {
    expect(matches('B', ev('b'))).toBe(true);
    expect(matches('B', ev('B', { shiftKey: true }))).toBe(false);
    expect(matches('B', ev('b', { ctrlKey: true }))).toBe(false);
  });

  it('treats Cmd as Ctrl', () => {
    expect(matches('Ctrl+S', ev('s', { metaKey: true }))).toBe(true);
  });

  it('requires shift only when asked', () => {
    expect(matches('Ctrl+Shift+Z', ev('Z', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('Ctrl+Z', ev('z', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches('F5', ev('F5'))).toBe(true);
    expect(matches('F5', ev('F5', { shiftKey: true }))).toBe(false);
    expect(matches('Shift+F5', ev('F5', { shiftKey: true }))).toBe(true);
  });

  it('lets symbols ignore shift (layouts differ)', () => {
    expect(matches('+', ev('+', { shiftKey: true }))).toBe(true);
    expect(matches('-', ev('-'))).toBe(true);
  });

  it('knows modifier-only presses and conflicts', () => {
    expect(isModifierOnly('Shift')).toBe(true);
    expect(isModifierOnly('a')).toBe(false);
    expect(findConflicts({ a: 'Ctrl+S', b: 'ctrl+s', c: 'Ctrl+Z', d: '' })).toEqual([['a', 'b']]);
    expect(eventKeySpec(ev(' ')).key).toBe('Space');
  });
});
