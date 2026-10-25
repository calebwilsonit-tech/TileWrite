import { afterEach, describe, expect, it } from 'vitest';
import '../../bundled';
import { MAX_EXTRA_TOOLS } from '@tilewright/assistant';
import { definePlugin, host, setActivePacks } from '@tilewright/behaviors';
import { pluginToolDefs, toolsOffered } from './plugin-tools';

const many = (n: number) =>
  definePlugin({ id: 't-many', name: 'Many', version: '1.0.0', engine: '^1.0.0' }, {
    install(api) {
      for (let i = 0; i < n; i++) api.assistantTool({ id: `tool_${i}`, description: `Tool ${i}`, input: { properties: {} }, kind: 'read', run: () => 'ok' });
    },
  });

afterEach(() => {
  host.uninstall('t-many');
  setActivePacks([]);
});

describe('the tools plugins add, as the assistant is given them', () => {
  it('include the list tool of every kind of data that is on, made from the kind\'s own schema', () => {
    setActivePacks(['inventory', 'story']);
    const tools = pluginToolDefs();
    const items = tools.find((t) => t.name === 'write_items')!;
    expect(items.kind).toBe('act');
    expect(JSON.stringify(items.input_schema)).toContain('"required":["items"]');
    expect(tools.some((t) => t.name === 'write_minigames')).toBe(true);
    setActivePacks(['story']);
    expect(pluginToolDefs().some((t) => t.name === 'write_items')).toBe(false);
  });

  it('are all passed on (no more cut at twenty), and the ones that do not fit are named', () => {
    setActivePacks(['inventory']);
    host.register(many(30));
    host.install('t-many');
    const small = toolsOffered();
    expect(small.sent.length).toBe(31);
    expect(small.leftOut).toEqual([]);
    host.uninstall('t-many');
    host.register(many(MAX_EXTRA_TOOLS + 5));
    host.install('t-many');
    const big = toolsOffered();
    expect(big.sent.length).toBe(MAX_EXTRA_TOOLS);
    expect(big.leftOut.length).toBe(6); // (the 105 of the plugin, and the list tool of the items, less the 100 that fit)
    expect(big.leftOut.every((n) => n.startsWith('t-many__tool_'))).toBe(true);
  });
});
