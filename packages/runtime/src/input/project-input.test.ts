import { describe, expect, it } from 'vitest';
import { checkProjectInput, emptyProjectInput, projectActionLabels, projectDefaults, ProjectInputSchema } from './project-input';
import { DEFAULT_INPUT_MAP } from './keyboard';

describe('the game\'s own controls', () => {
  it('start from the built-in bindings', () => {
    expect(projectDefaults(null)).toEqual(DEFAULT_INPUT_MAP);
    expect(projectDefaults(emptyProjectInput())).toEqual(DEFAULT_INPUT_MAP);
    expect(checkProjectInput(emptyProjectInput())).toEqual([]);
  });

  it('apply changes and add the game\'s own actions', () => {
    const p = ProjectInputSchema.parse({ overrides: { interact: ['key:KeyF'], nonsense: ['key:KeyZ'] }, actions: [{ id: 'dash', label: 'Dash', bindings: ['key:KeyX'] }] });
    const m = projectDefaults(p);
    expect(m.interact).toEqual(['key:KeyF']);
    expect(m.dash).toEqual(['key:KeyX']);
    expect('nonsense' in m).toBe(false);
    expect(projectActionLabels(p).dash).toBe('Dash');
    expect(projectActionLabels(p).jump).toBe('Jump');
  });

  it('explain what is wrong in plain English', () => {
    const p = ProjectInputSchema.parse({
      overrides: { interact: [], ghost: ['key:KeyG'], run: ['key:KeyX'] },
      actions: [{ id: 'jump', label: 'Hop', bindings: [] }, { id: 'lamp', label: 'Lamp', bindings: ['key:KeyX'] }, { id: 'dash', label: 'Dash', bindings: ['key:KeyZ'] }, { id: 'dash', label: 'Dash 2', bindings: ['key:KeyY'] }],
    });
    const problems = checkProjectInput(p).join('\n');
    expect(problems).toContain('already one of the built-in actions');
    expect(problems).toContain('Two of your own actions are called "dash"');
    expect(problems).toContain('has no key or button yet');
    expect(problems).toContain('no built-in action with that name');
    expect(problems).toContain('Interact / talk / confirm" has no key or button');
    expect(problems).toContain('"KeyX" is used by both');
  });

  it('does not warn about keys the engine and its plugins chose to share (the builder cancel and the pause key, the end-turn and jump): only about keys the project picked', () => {
    // the buttons plugins add are given with the plugin's own default keys, some of which are the same as the game's: they work in different parts of a game
    const shared = { map: { ...DEFAULT_INPUT_MAP, cancel_build: ['key:Escape'], end_turn: ['key:Space'] }, labels: { ...Object.fromEntries(Object.keys(DEFAULT_INPUT_MAP).map((k) => [k, k])), cancel_build: 'Put the building away', end_turn: 'End the turn' } };
    expect(checkProjectInput(emptyProjectInput(), shared)).toEqual([]);
    // the moment the project picks a key that is already used, it is told
    const picked = ProjectInputSchema.parse({ overrides: { interact: ['key:Escape'] } });
    expect(checkProjectInput(picked, shared).join('\n')).toContain('"Escape" is used by both');
    const own = ProjectInputSchema.parse({ actions: [{ id: 'wave', label: 'Wave', bindings: ['key:Space'] }] });
    expect(checkProjectInput(own, shared).join('\n')).toContain('"Space" is used by both');
  });

  it('rejects action names that scripts could not use', () => {
    expect(ProjectInputSchema.safeParse({ actions: [{ id: 'Bad Name', label: 'x' }] }).success).toBe(false);
  });
});
