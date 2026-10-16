import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, DEFAULT_INPUT_MAP, DomInputSource, bindingLabel, readGamepads } from '../input/keyboard';
import { InputMap } from '../input/input';
import { SettingsSchema, bindingChanges, defaultSettings, effectiveBindings, loadSettings, rebind, saveSettings, unboundActions } from './settings';

describe('rebinding', () => {
  it('replaces a key but keeps the gamepad button', () => {
    const b = rebind(DEFAULT_INPUT_MAP, 'attack', 'key:KeyF');
    expect(b.attack).toEqual(['key:KeyF', 'pad:button2']);
    const p = rebind(b, 'attack', 'pad:button7');
    expect(p.attack).toEqual(['pad:button7', 'key:KeyF']);
  });

  it('takes a key away from the action that had it', () => {
    const b = rebind(DEFAULT_INPUT_MAP, 'dodge', 'key:KeyJ'); // J was Attack
    expect(b.dodge?.[0]).toBe('key:KeyJ');
    expect(b.attack).not.toContain('key:KeyJ');
    expect(b.attack).toContain('mouse:0');
  });

  it('works through an InputMap, for keyboard and gamepad alike', () => {
    const map = new InputMap(rebind(DEFAULT_INPUT_MAP, 'interact', 'key:KeyF'));
    expect(map.resolve({ 'key:KeyF': 1 }).interact).toBe(1);
    expect(map.resolve({ 'key:KeyE': 1 }).interact).toBeUndefined();
    expect(map.resolve({ 'pad:button0': 1 }).interact).toBe(1);
  });

  it('saves only what changed, and warns about actions left with no binding', () => {
    expect(bindingChanges(DEFAULT_INPUT_MAP)).toEqual({});
    const b = rebind(DEFAULT_INPUT_MAP, 'echo', 'key:KeyG');
    expect(Object.keys(bindingChanges(b))).toEqual(['echo']);
    expect(unboundActions({ ...DEFAULT_INPUT_MAP, jump: [] }, ['jump', 'interact'])).toEqual(['jump']);
    expect(effectiveBindings(SettingsSchema.parse({ bindings: { echo: ['key:KeyG'] } })).echo).toEqual(['key:KeyG']);
  });
});

describe('settings storage', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it('round-trips, and falls back to defaults when missing, damaged, or the storage fails', () => {
    const st = memory();
    expect(loadSettings(st)).toEqual(defaultSettings());
    saveSettings(st, { ...defaultSettings(), master: 0.2, difficulty: 'hard' });
    expect(loadSettings(st)).toMatchObject({ master: 0.2, difficulty: 'hard' });
    st.m.set('tilewright.settings', '{ nope');
    expect(loadSettings(st)).toEqual(defaultSettings());
    st.m.set('tilewright.settings', JSON.stringify({ master: 7 }));
    expect(loadSettings(st)).toEqual(defaultSettings());
    expect(() => saveSettings({ getItem: () => null, setItem: () => { throw new Error('full'); } }, defaultSettings())).not.toThrow();
    expect(loadSettings(undefined)).toEqual(defaultSettings());
  });
});

describe('gamepads and labels', () => {
  it('reads buttons and sticks past the dead zone', () => {
    const pad = { connected: true, buttons: [{ pressed: true, value: 1 }, { pressed: false, value: 0 }, { pressed: false, value: 0.5 }], axes: [0.1, -0.8, 0.9] };
    expect(readGamepads([pad, null, { ...pad, connected: false }])).toEqual({ 'pad:button0': 1, 'pad:button2': 0.5, 'pad:axis1-': 0.8, 'pad:axis2+': 0.9 });
  });

  it('drives actions through the default map', () => {
    const map = new InputMap(DEFAULT_INPUT_MAP);
    const raw = readGamepads([{ connected: true, buttons: [], axes: [-1, 0] }]);
    expect(map.resolve(raw).move_left).toBe(1);
    expect(map.resolve({ 'pad:button9': 1 }).pause).toBe(1);
  });

  it('merges gamepad state into the input source and can capture the next press', async () => {
    const listeners = new Map<string, ((e: unknown) => void)[]>();
    const fakeWindow = {
      addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, [...(listeners.get(t) ?? []), f]),
      removeEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, (listeners.get(t) ?? []).filter((x) => x !== f)),
    } as unknown as Window;
    const fire = (type: string, e: object): void => listeners.get(type)?.slice().forEach((f) => f(e));
    let pressed = false;
    const src = new DomInputSource(fakeWindow, () => [{ connected: true, buttons: pressed ? [{ pressed: true, value: 1 }] : [{ pressed: false, value: 0 }], axes: [] }]);
    expect(src.read()).toEqual({});
    // a gamepad button
    const pad = src.captureNext(500);
    pressed = true;
    expect(await pad).toBe('pad:button0');
    pressed = false;
    // a key that is pressed and let go again before anything could poll for it
    const key = src.captureNext(500);
    fire('keydown', { code: 'KeyZ', repeat: false, preventDefault() {} });
    fire('keyup', { code: 'KeyZ' });
    expect(await key).toBe('key:KeyZ');
    // a mouse button, Escape to cancel, and a timeout
    const mouse = src.captureNext(500);
    fire('mousedown', { button: 2 });
    expect(await mouse).toBe('mouse:2');
    const cancel = src.captureNext(500);
    fire('keydown', { code: 'Escape', repeat: false, preventDefault() {} });
    expect(await cancel).toBeNull();
    expect(await src.captureNext(60)).toBeNull();
    expect(listeners.get('keydown')!.length).toBe(1); // only the source's own handler is left
  });
  it('names bindings and actions in words', () => {
    expect(bindingLabel('key:KeyE')).toBe('E');
    expect(bindingLabel('key:Digit1')).toBe('1');
    expect(bindingLabel('key:ShiftLeft')).toBe('Left Shift');
    expect(bindingLabel('key:ArrowUp')).toBe('Arrow Up');
    expect(bindingLabel('mouse:0')).toBe('Mouse left');
    expect(bindingLabel('pad:button0')).toBe('Gamepad A');
    expect(bindingLabel('pad:button9')).toBe('Gamepad Start');
    expect(bindingLabel('pad:axis0-')).toBe('Gamepad stick left');
    for (const a of Object.keys(DEFAULT_INPUT_MAP)) expect(ACTION_LABELS[a], a).toBeTruthy();
  });
});
