import { describe, expect, it } from 'vitest';
import { approvalClass, mayRunUnasked, pluginToolKind, whyAsked } from './approval';
import { TOOLS } from './tools';

describe('what the assistant may do without asking', () => {
  it('lets ordinary edits inside the project go ahead', () => {
    for (const [name, input] of [
      ['place_objects', { objects: [] }],
      ['paint_tiles', {}],
      ['write_dialogue', {}],
      ['update_objects', { updates: [{ id: 'a', name: 'B' }] }],
      ['edit_event_rows', { operations: [{ op: 'add' }, { op: 'update', id: 'x' }] }],
      ['place_blocks', { boxes: [] }],
      ['draw_sprite', {}],
    ] as [string, Record<string, unknown>][]) {
      expect(approvalClass(name, input), name).toBe('edit');
      expect(mayRunUnasked(approvalClass(name, input))).toBe(true);
    }
  });

  it('always asks before taking something away', () => {
    for (const [name, input] of [
      ['delete_objects', { ids: ['a'] }],
      ['remove_wires', {}],
      ['update_objects', { updates: [{ id: 'a', remove_behaviors: ['health'] }] }],
      ['edit_event_rows', { operations: [{ op: 'add' }, { op: 'remove', id: 'r1' }] }],
      ['write_world_map', { remove: true }],
      ['place_blocks', { remove: true }],
      ['write_ui_layout', { reset: true }],
      ['write_controls', { resetOverrides: true }],
    ] as [string, Record<string, unknown>][]) {
      expect(approvalClass(name, input), name).toBe('delete');
      expect(mayRunUnasked(approvalClass(name, input))).toBe(false);
    }
  });

  it('always asks before changing plugins or using the network, and says why', () => {
    expect(approvalClass('set_plugins', { enable: ['combat'] })).toBe('plugins');
    expect(approvalClass('generate_image', {})).toBe('network');
    expect(whyAsked('plugins')).toMatch(/plugins/);
    expect(whyAsked('network')).toMatch(/network/);
    expect(whyAsked('delete')).toMatch(/takes something away/);
    expect(whyAsked('edit')).toBe('');
  });

  it('knows every tool that deletes, changes plugins or uses the network by name (a new tool with such a name must be classified)', () => {
    const risky = TOOLS.filter((t) => t.kind === 'act' && /delete|remove|plugin|generate_image|network|fetch|download/i.test(t.name)).map((t) => t.name);
    for (const name of risky) {
      const cls = approvalClass(name, { remove: true, ids: ['x'] });
      expect(cls, `${name} is neither classified nor an edit with a remove option`).not.toBe('edit');
    }
  });

  it('does not let a plugin make its own tool skip the question by calling it "read"', () => {
    expect(pluginToolKind('read', [])).toBe('read');
    expect(pluginToolKind('read', ['project.read'])).toBe('read');
    expect(pluginToolKind('read', ['project.read', 'project.write'])).toBe('act');
    expect(pluginToolKind('read', ['network:api.example.com'])).toBe('act');
    expect(pluginToolKind('read', ['programs'])).toBe('act');
    expect(pluginToolKind('change', [])).toBe('act');
  });
});
