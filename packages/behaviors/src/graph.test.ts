import { describe, expect, it } from 'vitest';
import { TableSchema, type EventAction, type EventCondition, type EventRow, type GraphData, type GraphNodeData } from '@tilewright/runtime';
import { flatScene, rig, thing } from './testing';
import { checkGraphs, graphToRows, newAction, newCondition, newRow, rowsToGraph, setActivePacks } from './index';

setActivePacks(undefined);

const node = (id: string, type: string, params: Record<string, unknown> = {}): GraphNodeData => ({ id, type, x: 0, y: 0, params, breakpoint: false, comment: '' });
const link = (a: string, pin: string, b: string): GraphData['links'][number] => ({ from: { node: a, pin }, to: { node: b, pin: 'in' } });
const act = (a: EventAction): Record<string, unknown> => ({ action: a });
const setVar = (name: string, op: string, value: string): EventAction => ({ ...newAction('setVariable'), params: { name, op, value } });
const cond = (type: string, params: Record<string, unknown> = {}, negate = false): EventCondition => ({ ...newCondition(type), params, negate });
const graph = (nodes: GraphNodeData[], links: GraphData['links']): GraphData => ({ id: 'g1', name: 'Test', enabled: true, nodes, links });
const withGraph = (g: GraphData, extra?: (s: ReturnType<typeof flatScene>['scene']) => void) => {
  const { scene } = flatScene();
  scene.graphs = [g];
  extra?.(scene);
  return rig(scene);
};

describe('running a graph', () => {
  it('an event starts a flow once, through actions in order', () => {
    const g = graph(
      [node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true }), node('a', 'action', act(setVar('x', 'set', '5'))), node('b', 'action', act(setVar('x', 'add', '2')))],
      [link('e', 'out', 'a'), link('a', 'out', 'b')],
    );
    const r = withGraph(g);
    r.run(30);
    expect(r.sim.runtime.vars.x).toBe(7);
  });

  it('every-tick events keep running while true', () => {
    const g = graph([node('e', 'event', { conditions: [cond('always')], mode: 'all', once: false }), node('a', 'action', act(setVar('n', 'add', '1')))], [link('e', 'out', 'a')]);
    const r = withGraph(g);
    r.run(10);
    expect(r.sim.runtime.vars.n).toBe(10);
  });

  it('a branch goes down the yes or the no line', () => {
    const g = graph(
      [
        node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true }),
        node('b', 'branch', { conditions: [cond('variable', { name: 'gold', op: '>=', value: '10' })], mode: 'all', once: false }),
        node('y', 'action', act(setVar('result', 'set', 'rich'))),
        node('n', 'action', act(setVar('result', 'set', 'poor'))),
      ],
      [link('e', 'out', 'b'), link('b', 'true', 'y'), link('b', 'false', 'n')],
    );
    const rich = withGraph(g, (s) => s.variables.push({ name: 'gold', value: 20 }));
    rich.run(5);
    expect(rich.sim.runtime.vars.result).toBe('rich');
    const poor = withGraph(g, (s) => s.variables.push({ name: 'gold', value: 3 }));
    poor.run(5);
    expect(poor.sim.runtime.vars.result).toBe('poor');
  });

  it('loops repeat, and for-each visits tagged objects and table rows', () => {
    const { scene } = flatScene();
    scene.entities.push({ ...thing('a', 'A', 2, 2, {}), tags: ['coin'] }, { ...thing('b', 'B', 3, 3, {}), tags: ['coin'] });
    scene.graphs = [
      graph(
        [
          node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true }),
          node('l', 'loop', { count: 4 }),
          node('la', 'action', act(setVar('loops', 'add', '1'))),
          node('f', 'forEach', { over: 'tag:coin' }),
          node('fa', 'action', act({ type: 'destroy', params: { who: 'picked' } })),
          node('t', 'forEach', { over: 'table:Prices' }),
          node('ta', 'action', act(setVar('total', 'add', '{row.cost}'))),
          node('end', 'action', act(setVar('finished', 'set', '1'))),
        ],
        [link('e', 'out', 'l'), link('l', 'body', 'la'), link('l', 'done', 'f'), link('f', 'body', 'fa'), link('f', 'done', 't'), link('t', 'body', 'ta'), link('t', 'done', 'end')],
      ),
    ];
    const r = rig(scene);
    r.sim.assets.tables.set('Prices', TableSchema.parse({ name: 'Prices', columns: [{ id: 'cost', type: 'number' }], rows: [{ id: 'a', cost: 3 }, { id: 'b', cost: 4 }] }));
    r.run(5);
    expect(r.sim.runtime.vars.loops).toBe(4);
    expect(r.sim.world.withTag('coin')).toHaveLength(0);
    expect(r.sim.runtime.vars.total).toBe(7);
    expect(r.sim.runtime.vars.finished).toBe(1);
  });

  it('a wait carries on later, and a call runs a function from the same scene', () => {
    const g = graph(
      [
        node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true }),
        node('d', 'delay', { seconds: 1 }),
        node('c', 'call', { function: 'bump' }),
        node('after', 'action', act(setVar('after', 'set', '1'))),
        node('fn', 'function', { name: 'bump' }),
        node('fa', 'action', act(setVar('bumped', 'add', '1'))),
      ],
      [link('e', 'out', 'd'), link('d', 'out', 'c'), link('c', 'out', 'after'), link('fn', 'out', 'fa')],
    );
    const r = withGraph(g);
    r.run(30);
    expect(r.sim.runtime.vars.bumped).toBeUndefined();
    r.run(40);
    expect(r.sim.runtime.vars.bumped).toBe(1);
    expect(r.sim.runtime.vars.after).toBe(1);
  });

  it('a wait survives saving: its remaining time is plain state', () => {
    const g = graph([node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true }), node('d', 'delay', { seconds: 2 }), node('a', 'action', act(setVar('x', 'set', '1')))], [link('e', 'out', 'd'), link('d', 'out', 'a')]);
    const a = withGraph(g);
    const b = withGraph(g);
    a.run(50);
    b.run(50);
    expect(a.sim.stateHash()).toBe(b.sim.stateHash());
    expect(JSON.stringify(a.sim.runtime.rowState)).toContain('g:g1:d');
  });

  it('records what ran for the live highlighting, and announces a breakpoint', () => {
    const e = node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true });
    const a = { ...node('a', 'action', act(setVar('x', 'set', '1'))), breakpoint: true };
    const r = withGraph(graph([e, a], [link('e', 'out', 'a')]));
    const hits: string[] = [];
    r.sim.events.on('logic-break', (ev) => hits.push(String(ev.text)));
    r.run(3);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('Test');
    const fired = r.sim.runtime.scratch.get('fired') as Map<string, number>;
    expect(fired.has('g:g1:e#ran')).toBe(true);
    expect(fired.has('g:g1:a#ran')).toBe(true);
  });

  it('a disabled graph does nothing, and a runaway loop is cut short with a problem', () => {
    const e = node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true });
    const off = withGraph({ ...graph([e, node('a', 'action', act(setVar('x', 'set', '1')))], [link('e', 'out', 'a')]), enabled: false });
    off.run(3);
    expect(off.sim.runtime.vars.x).toBeUndefined();
    const loopy = graph([e, node('l', 'loop', { count: 1000 }), node('m', 'loop', { count: 1000 }), node('a', 'action', act(setVar('n', 'add', '1')))], [link('e', 'out', 'l'), link('l', 'body', 'm'), link('m', 'body', 'a')]);
    const r = withGraph(loopy);
    const problems: string[] = [];
    r.sim.events.on('problem', (ev) => problems.push(String(ev.text)));
    r.run(2);
    expect(problems.some((p) => p.includes('cut short'))).toBe(true);
    expect(Number(r.sim.runtime.vars.n)).toBeLessThan(4001);
  });
});

describe('graphs and event sheets', () => {
  const sheet = (): EventRow[] => [
    { ...newRow('r1'), conditions: [cond('start')], actions: [setVar('a', 'set', '1'), setVar('b', 'set', '2')], once: true },
    {
      ...newRow('r2'),
      conditions: [cond('variable', { name: 'a', op: '>=', value: '1' })],
      actions: [setVar('ticks', 'add', '1')],
      children: [{ ...newRow('r3'), conditions: [cond('variable', { name: 'ticks', op: '>=', value: '3' })], actions: [setVar('late', 'set', '1')], once: true }],
    },
    { ...newRow('r4'), conditions: [cond('start')], actions: [setVar('rep', 'add', '1')], repeat: 3, once: true },
  ];
  let n = 0;
  const ids = (p: string): string => `${p}${++n}`;

  it('a sheet becomes a graph that does the same thing', () => {
    const base = flatScene().scene;
    base.events = sheet();
    const direct = rig(structuredClone(base));
    direct.run(10);
    const { graph: g } = rowsToGraph(sheet(), ids);
    const viaGraph = flatScene().scene;
    viaGraph.graphs = [g];
    const converted = rig(viaGraph);
    converted.run(10);
    expect(converted.sim.runtime.vars).toEqual(direct.sim.runtime.vars);
    expect(direct.sim.runtime.vars.late).toBe(1);
    expect(direct.sim.runtime.vars.rep).toBe(3);
  });

  it('a graph shaped like a sheet becomes rows that do the same thing', () => {
    const { graph: g } = rowsToGraph(sheet(), ids);
    const { rows, problems } = graphToRows(g, ids);
    expect(problems).toEqual([]);
    const a = flatScene().scene;
    a.graphs = [g];
    const b = flatScene().scene;
    b.events = rows;
    const ra = rig(a);
    const rb = rig(b);
    ra.run(10);
    rb.run(10);
    expect(rb.sim.runtime.vars).toEqual(ra.sim.runtime.vars);
  });

  it('a for-each row survives the trip', () => {
    const rows: EventRow[] = [{ ...newRow('r1'), forEach: 'tag:coin', conditions: [cond('always')], actions: [{ type: 'destroy', params: { who: 'picked' } }], once: true }];
    const { graph: g } = rowsToGraph(rows, ids);
    expect(g.nodes.map((x) => x.type)).toEqual(['event', 'forEach', 'branch', 'action']);
    const back = graphToRows(g, ids);
    expect(back.problems).toEqual([]);
    expect(back.rows).toHaveLength(1);
    expect(back.rows[0]!.forEach).toBe('tag:coin');
    expect(back.rows[0]!.actions[0]!.type).toBe('destroy');
  });

  it('says which box does not fit a sheet', () => {
    const g = graph([node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true }), node('d', 'delay', { seconds: 1 }), node('a', 'action', act(setVar('x', 'set', '1')))], [link('e', 'out', 'd'), link('d', 'out', 'a')]);
    const r = graphToRows(g, ids);
    expect(r.rows).toEqual([]);
    expect(r.problems[0]).toContain('wait 1 s');
    const afterBranch = graph(
      [node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true }), node('b', 'branch', { conditions: [cond('always')], mode: 'all', once: false }), node('a', 'action', act(setVar('x', 'set', '1'))), node('z', 'action', act(setVar('y', 'set', '1')))],
      [link('e', 'out', 'b'), link('b', 'true', 'a'), link('e', 'out', 'z')],
    );
    expect(graphToRows(afterBranch, ids).rows).toEqual([]);
  });
});

describe('checking graphs', () => {
  it('finds lines to deleted boxes, boxes nothing leads to, missing actions and calls to nothing', () => {
    const g = graph(
      [node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true }), node('a', 'action', { action: { type: 'doesNotExist', params: {} } }), node('lonely', 'action', act(setVar('x', 'set', '1'))), node('c', 'call', { function: 'ghost' })],
      [link('e', 'out', 'a'), link('a', 'out', 'c'), link('a', 'out', 'gone')],
    );
    const text = checkGraphs([g]).map((p) => p.text);
    expect(text.some((t) => t.includes('deleted'))).toBe(true);
    expect(text.some((t) => t.includes('nothing leading into it'))).toBe(true);
    expect(text.some((t) => t.includes('missing'))).toBe(true);
    expect(text.some((t) => t.includes('"ghost", which does not exist'))).toBe(true);
    expect(checkGraphs([graph([node('e', 'event', { conditions: [cond('start')], mode: 'all', once: true }), node('a', 'action', act(setVar('x', 'set', '1')))], [link('e', 'out', 'a')])])).toEqual([]);
  });
});
