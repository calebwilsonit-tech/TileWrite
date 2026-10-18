import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  Conversation,
  DEFAULT_SETTINGS,
  MAX_STEPS,
  MODELS,
  NO_USAGE,
  SYSTEM_PROMPT,
  TOOLS,
  buildContext,
  checkToolInput,
  cleanSettings,
  compactDiff,
  diffStats,
  estimateCost,
  formatCost,
  lineDiff,
  toolDefinitions,
  userTurnText,
  type ModelCall,
  type ModelClient,
  type ToolCallInfo,
  type ToolOutput,
} from './index';
import { friendlyError } from './sdk-client';

// ---------- a scripted stand-in for the API ----------

type Reply = Partial<Anthropic.Message> & { content: Anthropic.ContentBlock[]; throws?: unknown; text?: string };

function message(r: Reply): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'test',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...r,
  } as unknown as Anthropic.Message;
}

const text = (t: string): Anthropic.TextBlock => ({ type: 'text', text: t, citations: null }) as Anthropic.TextBlock;
const toolUse = (id: string, name: string, input: unknown): Anthropic.ToolUseBlock => ({ type: 'tool_use', id, name, input }) as Anthropic.ToolUseBlock;

function scripted(replies: Reply[]): ModelClient & { calls: ModelCall[]; bodies: string[] } {
  const calls: ModelCall[] = [];
  const bodies: string[] = [];
  return {
    calls,
    bodies,
    async stream(call) {
      calls.push(call);
      bodies.push(JSON.stringify(call.request.messages));
      const r = replies.shift();
      if (!r) throw new Error('the script ran out of replies');
      if (r.throws) throw r.throws;
      for (const b of r.content) if (b.type === 'text') call.onText(b.text);
      return message(r);
    },
  };
}

function convo(client: ModelClient, runTool: (c: ToolCallInfo) => Promise<ToolOutput> = async () => ({ content: 'ok' })): Conversation {
  return new Conversation({ client, runTool: (c) => runTool(c), settings: () => ({ ...DEFAULT_SETTINGS, fallback: false }) });
}

const live = (): AbortSignal => new AbortController().signal;

// ---------- tools ----------

describe('tool definitions', () => {
  it('have unique names, plain JSON object schemas and streaming input turned on', () => {
    const defs = toolDefinitions();
    expect(new Set(defs.map((d) => d.name)).size).toBe(defs.length);
    for (const d of defs) {
      expect(d.input_schema.type).toBe('object');
      expect(d.eager_input_streaming).toBe(true);
      expect(d.description.length).toBeGreaterThan(20);
    }
    expect(JSON.stringify(defs)).not.toContain('$ref'); // the nested event-row schema is spelled out, not referenced
    expect(JSON.stringify(defs)).not.toContain('$schema');
  });

  it('are identical every time they are built (so the cached prefix never changes)', () => {
    expect(JSON.stringify(toolDefinitions())).toBe(JSON.stringify(toolDefinitions()));
  });

  it('keep reading and changing apart: every tool that changes the project is an act tool', () => {
    const act = TOOLS.filter((t) => t.kind === 'act').map((t) => t.name);
    expect(act).toEqual(['place_objects', 'update_objects', 'delete_objects', 'paint_tiles', 'connect_wires', 'remove_wires', 'set_event_sheet', 'write_dialogue', 'write_cutscene', 'write_items', 'write_minigames', 'write_skins', 'write_world_map', 'write_mixer', 'write_ui_layout', 'write_controls', 'set_project_settings', 'edit_event_rows', 'create_prefab', 'set_regions', 'write_translation', 'set_packs', 'write_table', 'set_variables', 'generate_map', 'write_ui_screen', 'write_script', 'write_project_notes']);
  });

  it('checks the genre tools\' inputs with messages Claude can act on', () => {
    expect(checkToolInput('set_packs', { enable: ['turns'] }).ok).toBe(true);
    expect(checkToolInput('generate_map', { kind: 'volcano', width: 40, height: 30 }).ok).toBe(false);
    expect(checkToolInput('generate_map', { kind: 'cave', width: 4, height: 30 }).ok).toBe(false);
    expect(checkToolInput('write_table', { name: '1bad', columns: [{ id: 'a' }], rows: [] }).ok).toBe(false);
    expect(checkToolInput('write_table', { name: 'Waves', columns: [{ id: 'count', type: 'number' }], rows: [{ id: 'w1', count: 5 }] }).ok).toBe(true);
    expect(checkToolInput('set_variables', { variables: [] }).ok).toBe(false);
  });

  it('checks the story tools\' inputs with messages Claude can act on', () => {
    const good = { name: 'Gate', start: 'a', nodes: [{ id: 'a', type: 'line', text: 'Hi', next: 'b' }, { id: 'b', type: 'choice', options: [{ text: 'Yes', next: 'c', if: { kind: 'item', item: 'key' } }] }, { id: 'c', type: 'end' }] };
    expect(checkToolInput('write_dialogue', good).ok).toBe(true);
    const noOptions = checkToolInput('write_dialogue', { ...good, nodes: [{ id: 'b', type: 'choice', options: [] }] });
    expect(noOptions.ok).toBe(false);
    expect(checkToolInput('write_dialogue', { ...good, name: 'bad/name' }).ok).toBe(false);
    expect(checkToolInput('write_cutscene', { name: 'Intro', steps: [{ type: 'say', speaker: 'Elder', text: 'Hi' }, { type: 'wait', seconds: 2, async: true }] }).ok).toBe(true);
    expect(checkToolInput('write_cutscene', { name: 'Intro', steps: [{ type: 'explode' }] }).ok).toBe(false);
    expect(checkToolInput('write_translation', { language: 'fr', name: 'Francais', strings: { Hello: 'Bonjour' } }).ok).toBe(true);
    expect(checkToolInput('write_translation', { language: 'French', strings: {} }).ok).toBe(false);
    expect(checkToolInput('set_regions', { regions: [{ name: 'Yard', x: 1, y: 1, w: 4, h: 4, darkness: 2 }] }).ok).toBe(false);
    expect(checkToolInput('set_regions', { regions: [{ name: 'Yard', x: 1, y: 1, w: 4, h: 4, darkness: 0.5, music: 'theme' }] }).ok).toBe(true);
    expect(checkToolInput('write_items', { items: [{ id: 'key', name: 'Key', use: { heal: 1 } }] }).ok).toBe(true);
    expect(checkToolInput('write_minigames', { minigames: [{ name: 'Duel', kind: 'timing', rounds: 3 }, { name: 'Cards', kind: 'pairs', pairs: 4 }] }).ok).toBe(true);
    expect(checkToolInput('write_minigames', { minigames: [{ name: 'Bad', kind: 'darts' }] }).ok).toBe(false);
    expect(checkToolInput('write_minigames', { minigames: [{ name: 'bad/name', kind: 'timing' }] }).ok).toBe(false);
    expect(checkToolInput('write_skins', { skins: [{ id: 'red', name: 'Red', color: 0xff0000, unlock: { kind: 'variable', name: 'won' } }] }).ok).toBe(true);
    expect(checkToolInput('write_skins', { skins: [{ id: 'red', name: 'Red', unlock: { kind: 'nonsense' } }] }).ok).toBe(false);
    expect(checkToolInput('write_world_map', { nodes: [{ id: 'hub', label: 'Hub', scene: 'scenes/main.scene.json', x: 400, y: 300, icon: 'town', unlock: { kind: 'always' } }], links: [] }).ok).toBe(true);
    expect(checkToolInput('write_world_map', { nodes: [{ id: 'hub', label: 'Hub', scene: 'x', x: 5000 }] }).ok).toBe(false);
    expect(checkToolInput('write_world_map', { remove: true }).ok).toBe(true);
    expect(checkToolInput('write_mixer', { buses: { music: 0.6 }, sounds: { hit: { volume: 0.5, variants: ['hit2'] } }, music: { theme: { loopStart: 4 } } }).ok).toBe(true);
    expect(checkToolInput('write_mixer', { buses: { music: 'loud' } }).ok).toBe(false);
    expect(checkToolInput('write_ui_layout', { theme: { font: 'mono', accent: '#00ff88' }, widgets: [{ id: 'coins', kind: 'counter', anchor: 'tr', x: 12, y: 12, label: 'Coins', variable: 'coins' }] }).ok).toBe(true);
    expect(checkToolInput('write_ui_layout', { widgets: [{ id: 'x y', kind: 'counter' }] }).ok).toBe(false);
    expect(checkToolInput('write_ui_layout', { theme: { font: 'comic' } }).ok).toBe(false);
    expect(checkToolInput('write_controls', { overrides: { interact: ['key:KeyF'] }, actions: [{ id: 'dash', label: 'Dash', bindings: ['key:KeyZ'] }] }).ok).toBe(true);
    expect(checkToolInput('write_controls', { actions: [{ id: 'Dash!', label: 'Dash' }] }).ok).toBe(false);
    expect(checkToolInput('set_project_settings', { name: 'My Game', titleScreen: true, subtitle: 'A tale' }).ok).toBe(true);
    expect(checkToolInput('edit_event_rows', { operations: [{ op: 'remove', id: 'r1' }, { op: 'add', row: { conditions: [], actions: [{ type: 'message', params: { text: 'Hi' } }] }, after: 'start' }, { op: 'update', id: 'r2', row: { once: true } }] }).ok).toBe(true);
    expect(checkToolInput('edit_event_rows', { operations: [] }).ok).toBe(false);
    expect(checkToolInput('edit_event_rows', { operations: [{ op: 'explode', id: 'r1' }] }).ok).toBe(false);
    expect(checkToolInput('create_prefab', { object: 'Guard', name: 'Elite guard' }).ok).toBe(true);
    expect(checkToolInput('create_prefab', { object: 'Guard', name: 'bad/name' }).ok).toBe(false);
  });

  it('check inputs before anything runs, with messages Claude can act on', () => {
    expect(checkToolInput('place_objects', { objects: [{ prefab: 'plate', x: 4.5, y: 7.5 }] }).ok).toBe(true);
    const bad = checkToolInput('place_objects', { objects: [{ prefab: 'plate', x: 'left' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/place_objects is not valid[\s\S]*x/);
    const unknown = checkToolInput('format_disk', {});
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toContain('There is no tool called "format_disk"');
    expect(checkToolInput('scene_summary', undefined).ok).toBe(true);
    expect(checkToolInput('write_script', { name: '../evil', source: 'x' }).ok).toBe(false);
    expect(checkToolInput('paint_tiles', { rects: [{ x: -1, y: 0, w: 1, h: 1 }] }).ok).toBe(false);
  });

  it('accept a nested event sheet', () => {
    const r = checkToolInput('set_event_sheet', {
      rows: [{ conditions: [{ type: 'start' }], actions: [{ type: 'say', params: { text: 'Hi' } }], children: [{ conditions: [], actions: [] }] }],
    });
    expect(r.ok).toBe(true);
  });
});

// ---------- conversation ----------

describe('Conversation', () => {
  it('sends the project context once, with the first question, and keeps the prompt prefix stable', async () => {
    const client = scripted([{ content: [text('One.')] }, { content: [text('Two.')] }]);
    const c = convo(client);
    const first = await c.send('Hello', { context: 'Project: "Demo".', signal: live() });
    expect(first).toEqual({ stopReason: 'end_turn', text: 'One.' });
    await c.send('Again', { context: 'Project: "Demo".', signal: live() });

    const [a, b] = client.calls;
    expect(a!.request.system).toBe(SYSTEM_PROMPT);
    expect(JSON.stringify(a!.request.tools)).toBe(JSON.stringify(b!.request.tools));
    expect(a!.request.cache_control).toEqual({ type: 'ephemeral' });
    expect(a!.request.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(a!.request.output_config.effort).toBe(DEFAULT_SETTINGS.effort);
    // the second request is the first one plus the new turns: nothing earlier was edited
    const earlier = JSON.parse(client.bodies[0]!) as unknown[];
    expect(JSON.parse(client.bodies[1]!).slice(0, earlier.length)).toEqual(earlier);
    expect(JSON.stringify(c.messages[0])).toContain('Project: \\"Demo\\".');
    expect(JSON.stringify(c.messages[2])).not.toContain('Project:'); // context only in the first message
  });

  it('runs a tool and sends every result of one reply back together', async () => {
    const seen: string[] = [];
    const client = scripted([
      { stop_reason: 'tool_use', content: [text('Looking.'), toolUse('t1', 'scene_summary', {}), toolUse('t2', 'get_selection', {})] },
      { content: [text('Done.')] },
    ]);
    const c = convo(client, async (call) => {
      seen.push(call.name);
      return { content: `result of ${call.name}` };
    });
    const r = await c.send('What is in the scene?', { signal: live() });
    expect(r.text).toBe('Done.');
    expect(seen.sort()).toEqual(['get_selection', 'scene_summary']);
    const results = c.messages.at(-2)!;
    expect(results.role).toBe('user');
    expect((results.content as Anthropic.ToolResultBlockParam[]).map((b) => [b.type, b.tool_use_id])).toEqual([
      ['tool_result', 't1'],
      ['tool_result', 't2'],
    ]);
  });

  it('answers a call with an invalid input by telling Claude what is wrong, without running anything', async () => {
    let ran = 0;
    const client = scripted([{ stop_reason: 'tool_use', content: [toolUse('t1', 'place_objects', { objects: 'a plate' })] }, { content: [text('Sorry.')] }]);
    const c = convo(client, async () => {
      ran++;
      return { content: 'ran' };
    });
    await c.send('Place a plate', { signal: live() });
    expect(ran).toBe(0);
    const block = (c.messages.at(-2)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(block.is_error).toBe(true);
    expect(String(block.content)).toMatch(/place_objects is not valid/);
  });

  it('turns a tool that throws into an error result instead of crashing the conversation', async () => {
    const client = scripted([{ stop_reason: 'tool_use', content: [toolUse('t1', 'scene_summary', {})] }, { content: [text('Hm.')] }]);
    const c = convo(client, async () => {
      throw new Error('no scene is open');
    });
    const r = await c.send('Go', { signal: live() });
    expect(r.stopReason).toBe('end_turn');
    const block = (c.messages.at(-2)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(block.is_error).toBe(true);
    expect(String(block.content)).toContain('no scene is open');
  });

  it('does not run tools from a reply that was cut off', async () => {
    let ran = 0;
    const client = scripted([{ stop_reason: 'max_tokens', content: [toolUse('t1', 'delete_objects', { targets: ['Gate'] })] }, { content: [text('OK, smaller.')] }]);
    const c = convo(client, async () => {
      ran++;
      return { content: 'ran' };
    });
    await c.send('Delete it', { signal: live() });
    expect(ran).toBe(0);
    expect(String((c.messages.at(-2)!.content as Anthropic.ToolResultBlockParam[])[0]!.content)).toMatch(/cut off/);
  });

  it('stops on a refusal and says so, keeping the history valid', async () => {
    const client = scripted([{ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'cyber', explanation: null } } as Reply]);
    const c = convo(client);
    const r = await c.send('Something', { signal: live() });
    expect(r.stopReason).toBe('refusal');
    expect(r.notice).toMatch(/declined/);
    expect(c.messages.map((m) => m.role)).toEqual(['user']); // no empty assistant message
  });

  it('tells the person when a reply without tools is cut off', async () => {
    const client = scripted([{ stop_reason: 'max_tokens', content: [text('Half a thou')] }]);
    const r = await convo(client).send('Long please', { signal: live() });
    expect(r.stopReason).toBe('max_tokens');
    expect(r.notice).toMatch(/cut off/);
  });

  it('adds up tokens and estimated cost across calls', async () => {
    const usage = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 4000 };
    const client = scripted([
      { stop_reason: 'tool_use', content: [toolUse('t1', 'scene_summary', {})], usage } as Reply,
      { content: [text('x')], usage } as Reply,
    ]);
    const c = convo(client);
    const totals: number[] = [];
    await c.send('Go', { signal: live(), hooks: { onUsage: (_u, cost) => totals.push(cost) } });
    expect(c.usage).toEqual({ inputTokens: 2000, outputTokens: 1000, cacheWriteTokens: 4000, cacheReadTokens: 8000 });
    expect(totals.length).toBe(2);
    expect(c.cost).toBeCloseTo(estimateCost(DEFAULT_SETTINGS.model, c.usage), 10);
    expect(c.cost).toBeGreaterThan(totals[0]!);
  });

  it('can be retried after the API failed, without asking again', async () => {
    const client = scripted([{ content: [], throws: new Error('network down') }, { content: [text('Back.')] }]);
    const c = convo(client);
    await expect(c.send('Hello', { signal: live() })).rejects.toThrow('network down');
    expect(c.canResume).toBe(true);
    const r = await c.resume({ signal: live() });
    expect(r.text).toBe('Back.');
    expect(c.messages.map((m) => m.role)).toEqual(['user', 'assistant']); // the question was kept once
  });

  it('stops cleanly when the person cancels while tools are running, leaving a valid history', async () => {
    const ctl = new AbortController();
    const client = scripted([{ stop_reason: 'tool_use', content: [toolUse('t1', 'run_playbot', { mode: 'walk_to_goal' })] }]);
    const c = convo(client, async () => {
      ctl.abort();
      return { content: 'finished anyway' };
    });
    const r = await c.send('Test it', { signal: ctl.signal });
    expect(r.stopReason).toBe('cancelled');
    // every tool_use has its tool_result
    expect(c.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('gives up after a bounded number of steps', async () => {
    const replies: Reply[] = Array.from({ length: MAX_STEPS + 2 }, (_, i) => ({ stop_reason: 'tool_use', content: [toolUse(`t${i}`, 'get_selection', {})] }));
    const r = await convo(scripted(replies)).send('Loop', { signal: live() });
    expect(r.stopReason).toBe('step_limit');
  });

  it('stops asking for the fallback beta when the API rejects it, and carries on without it', async () => {
    const rejection = Object.assign(new Error('400 fallbacks is not supported'), { status: 400 });
    const client = scripted([{ content: [], throws: rejection }, { content: [text('Fine.')] }, { content: [text('Again.')] }]);
    const c = new Conversation({ client, runTool: async () => ({ content: '' }), settings: () => ({ ...DEFAULT_SETTINGS, fallback: true }) });
    const r = await c.send('Hi', { signal: live() });
    expect(r.text).toBe('Fine.');
    await c.send('More', { signal: live() });
    expect(client.calls.map((x) => x.fallback)).toEqual([true, false, false]);
  });
});

// ---------- the rest ----------

describe('settings, cost and prompts', () => {
  it('cleans saved settings', () => {
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ model: ' x ', effort: 'bogus', fallback: 'yes' })).toEqual({ model: 'x', effort: DEFAULT_SETTINGS.effort, fallback: DEFAULT_SETTINGS.fallback });
    expect(cleanSettings({ model: MODELS[1]!.id, effort: 'low', fallback: false })).toEqual({ model: MODELS[1]!.id, effort: 'low', fallback: false });
  });

  it('prices usage per model, with cache reads far cheaper than fresh input', () => {
    const fresh = estimateCost(MODELS[0]!.id, { ...NO_USAGE, inputTokens: 1_000_000 });
    const cached = estimateCost(MODELS[0]!.id, { ...NO_USAGE, cacheReadTokens: 1_000_000 });
    expect(fresh).toBeCloseTo(MODELS[0]!.inputPerMillion);
    expect(cached).toBeLessThan(fresh / 10);
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.001)).toBe('< $0.01');
    expect(formatCost(1.234)).toBe('$1.23');
  });

  it('builds a short opening message with the project notes in it', () => {
    const t = buildContext({ projectName: 'Demo', scenePath: 'scenes/main.scene.json', sceneName: 'Main', mapSize: '32 x 32', objectCount: 3, selection: ['Gate (e4)'], problems: 1, notes: 'No puzzle may be bypassable.' });
    expect(t).toContain('Open scene: "Main"');
    expect(t).toContain('Selected: Gate (e4).');
    expect(t).toContain('No puzzle may be bypassable.');
    expect(buildContext({ projectName: 'D', scenePath: null, sceneName: null, mapSize: null, objectCount: 0, selection: [], problems: 0, notes: '' })).toContain('No scene is open.');
    expect(userTurnText('chat', 'hi')).toBe('hi');
    expect(userTurnText('fix', 'boom')).toMatch(/^Mode: Fix this error[\s\S]*boom$/);
  });

  it('never puts anything that changes between requests in the system prompt', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(SYSTEM_PROMPT).not.toMatch(/claude-[a-z]+-\d/); // no model names outside models.ts
  });
});

describe('line diff', () => {
  it('shows what was added and removed', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc\nd');
    expect(d.map((l) => `${l.kind}:${l.text}`)).toEqual(['same:a', 'del:b', 'add:B', 'same:c', 'add:d']);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
    expect(lineDiff('', 'x')).toEqual([{ kind: 'add', text: 'x' }]);
    expect(lineDiff('x', '')).toEqual([{ kind: 'del', text: 'x' }]);
    expect(lineDiff('', '')).toEqual([]);
  });

  it('folds long unchanged stretches', () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l15', 'CHANGED');
    const c = compactDiff(lineDiff(before, after), 2);
    expect(c.some((l) => l.kind === 'gap')).toBe(true);
    expect(c.filter((l) => l.kind !== 'gap').length).toBe(6); // 2 before, the removed and added line, 2 after
  });
});

describe('friendlyError', () => {
  const make = (status: number, body: object, msg: string): unknown => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: msg }, ...body }, msg, new Headers());

  it('explains each kind of failure and says whether Retry can help', () => {
    expect(friendlyError(make(401, {}, 'bad key'))).toMatchObject({ kind: 'key', retryable: false });
    expect(friendlyError(make(403, {}, 'nope'))).toMatchObject({ kind: 'permission', retryable: false });
    expect(friendlyError(make(404, {}, 'no model'))).toMatchObject({ kind: 'model', retryable: false });
    expect(friendlyError(make(429, {}, 'slow down'))).toMatchObject({ kind: 'rate', retryable: true });
    expect(friendlyError(make(529, {}, 'overloaded'))).toMatchObject({ kind: 'overloaded', retryable: true });
    expect(friendlyError(make(500, {}, 'oops'))).toMatchObject({ kind: 'overloaded', retryable: true });
    expect(friendlyError(make(400, {}, 'Your credit balance is too low'))).toMatchObject({ kind: 'credit', retryable: true });
    expect(friendlyError(make(400, {}, 'bad thing'))).toMatchObject({ kind: 'request', retryable: false });
    expect(friendlyError(new Anthropic.APIConnectionError({ message: 'down' }))).toMatchObject({ kind: 'network', retryable: true });
    expect(friendlyError(new Anthropic.APIUserAbortError())).toMatchObject({ kind: 'cancelled' });
    expect(friendlyError(new Error('plain'))).toMatchObject({ kind: 'unknown', message: 'plain' });
  });

  it('never repeats the key in a message', () => {
    const f = friendlyError(make(401, { error: { message: 'invalid x-api-key sk-ant-SECRET' } }, 'invalid x-api-key sk-ant-SECRET'));
    expect(f.message).not.toContain('SECRET');
  });
});
