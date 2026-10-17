import { describe, expect, it } from 'vitest';
import { DialogueSchema, type DialogueData } from '@tilewright/runtime';
import { NODE_H, NODE_W, bounds, connect, edgesOf, layout, moveNode, portsOf, reachable, removeNode, spotForNew } from './dialogue-graph';

function elder(): DialogueData {
  return DialogueSchema.parse({
    name: 'Elder',
    start: 'hi',
    nodes: [
      { id: 'hi', type: 'line', speaker: 'Elder', text: 'Will you mend them?', next: 'ask' },
      { id: 'ask', type: 'choice', prompt: 'Well?', options: [{ text: 'I will.', next: 'flag' }, { text: 'Not yet.', next: 'bye' }] },
      { id: 'flag', type: 'set', variable: 'accepted', value: 1, next: 'check' },
      { id: 'check', type: 'branch', if: { kind: 'variable', name: 'accepted', op: '>=', value: 1 }, then: 'bye', else: 'ghost' },
      { id: 'bye', type: 'end' },
      { id: 'lost', type: 'line', text: 'Nobody gets here.' },
    ],
  });
}

describe('dialogue graph', () => {
  it('lists the places a link can start, per kind of node', () => {
    const d = elder();
    expect(portsOf(d.nodes[0]!).map((p) => p.kind)).toEqual(['next']);
    expect(portsOf(d.nodes[1]!).map((p) => [p.kind, p.index, p.label])).toEqual([['option', 0, 'I will.'], ['option', 1, 'Not yet.']]);
    expect(portsOf(d.nodes[3]!).map((p) => p.kind)).toEqual(['then', 'else']);
    expect(portsOf(d.nodes[4]!)).toEqual([]);
  });

  it('finds the links that go somewhere, and ignores links to nodes that do not exist', () => {
    const e = edgesOf(elder()).map((x) => `${x.from}->${x.to}`);
    expect(e).toEqual(['hi->ask', 'ask->flag', 'ask->bye', 'flag->check', 'check->bye']); // check -> ghost is not drawn
  });

  it('changes where a link goes, for each kind of node, without touching the original', () => {
    const d = elder();
    const a = connect(d, 'hi', portsOf(d.nodes[0]!)[0]!, 'bye');
    expect(edgesOf(a).find((x) => x.from === 'hi')!.to).toBe('bye');
    expect(edgesOf(d).find((x) => x.from === 'hi')!.to).toBe('ask'); // unchanged
    const b = connect(d, 'ask', portsOf(d.nodes[1]!)[1]!, 'flag');
    expect(edgesOf(b).filter((x) => x.from === 'ask').map((x) => x.to)).toEqual(['flag', 'flag']);
    const c = connect(d, 'check', portsOf(d.nodes[3]!)[1]!, 'flag');
    expect(edgesOf(c).filter((x) => x.from === 'check').map((x) => [x.port.kind, x.to])).toEqual([['then', 'bye'], ['else', 'flag']]);
    const gone = connect(d, 'hi', portsOf(d.nodes[0]!)[0]!, undefined);
    expect(edgesOf(gone).some((x) => x.from === 'hi')).toBe(false);
  });

  it('knows what the conversation can reach', () => {
    expect([...reachable(elder())].sort()).toEqual(['ask', 'bye', 'check', 'flag', 'hi']);
    expect(reachable({ ...elder(), start: '' }).size).toBe(0);
  });

  it('places nodes in columns by distance from the start, unreachable ones below, and keeps stored positions', () => {
    const d = elder();
    const p = layout(d);
    expect(p.get('hi')).toEqual({ x: 0, y: 0 });
    expect(p.get('ask')!.x).toBe(NODE_W + 70);
    expect(p.get('flag')!.x).toBeGreaterThan(p.get('ask')!.x);
    expect(p.get('bye')!.x).toBe(p.get('flag')!.x); // both are two steps from the start
    expect(p.get('check')!.x).toBeGreaterThan(p.get('flag')!.x);
    expect(p.get('lost')!.y).toBeGreaterThan(p.get('hi')!.y + NODE_H);
    const moved = layout(moveNode(d, 'ask', 300.4, 40.6));
    expect(moved.get('ask')).toEqual({ x: 300, y: 41 });
    const cells = [...p.values()].map((v) => `${v.x},${v.y}`);
    expect(new Set(cells).size).toBe(cells.length); // no two cards on top of each other
  });

  it('removes a node and every link to it, and the start if it was the start', () => {
    const d = removeNode(elder(), 'bye');
    expect(d.nodes.some((n) => n.id === 'bye')).toBe(false);
    expect(edgesOf(d).some((x) => x.to === 'bye')).toBe(false);
    const noStart = removeNode(elder(), 'hi');
    expect(noStart.start).toBe('');
  });

  it('puts a new card beside the one it will join, moving down past cards already there, and under everything otherwise', () => {
    const d = elder();
    const pos = layout(d);
    const beside = spotForNew(d, 'hi');
    expect(beside.x).toBe(pos.get('hi')!.x + NODE_W + 70);
    for (const [id, p] of pos) {
      const overlaps = beside.x < p.x + NODE_W && beside.x + NODE_W > p.x && beside.y < p.y + NODE_H && beside.y + NODE_H > p.y;
      expect(overlaps, `overlaps ${id}`).toBe(false); // "ask" already sits there, so the new card moves down
    }
    const under = spotForNew(d, undefined);
    expect(under.y).toBeGreaterThanOrEqual(bounds(pos).y + bounds(pos).h);
    expect(spotForNew({ ...d, nodes: [] }, undefined)).toEqual({ x: 0, y: 0 });
  });

  it('measures the graph for "fit"', () => {
    const b = bounds(layout(elder()));
    expect(b.x).toBe(0);
    expect(b.w).toBeGreaterThan(NODE_W);
    expect(bounds(new Map())).toEqual({ x: 0, y: 0, w: NODE_W, h: NODE_H });
  });
});
