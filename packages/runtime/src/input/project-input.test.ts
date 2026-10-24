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

  it('rejects action names that scripts could not use', () => {
    expect(ProjectInputSchema.safeParse({ actions: [{ id: 'Bad Name', label: 'x' }] }).success).toBe(false);
  });
});
