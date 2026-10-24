import { describe, expect, it } from 'vitest';
import { NODE_H, NODE_W, addNode, canHaveChild, duplicateNode, layoutTree, moveNode, nodeOf, parentOf, removeNode, setAction, setCondition, startTree, subtreeIds, wrapNode } from './tree-edit';
import { checkTree, guardTree } from '@tilewright/plugin-ai';

describe('behaviour tree edits', () => {
  it('builds a tree node by node, and a decorator holds only one child', () => {
    let t = startTree('selector');
    expect(t.nodes).toHaveLength(1);
    const a = addNode(t, 'root', 'sequence');
    t = a.tree;
    const c = addNode(t, a.id, 'condition');
    t = c.tree;
    const act = addNode(t, a.id, 'action');
    t = act.tree;
    expect(nodeOf(t, a.id)).toMatchObject({ type: 'sequence', children: [c.id, act.id] });
    const inv = addNode(t, 'root', 'inverter');
    t = inv.tree;
    expect(canHaveChild(nodeOf(t, inv.id)!)).toBe(true);
    const inner = addNode(t, inv.id, 'condition');
    t = inner.tree;
    expect(canHaveChild(nodeOf(t, inv.id)!)).toBe(false);
    expect(addNode(t, inv.id, 'action').tree).toBe(t); // refused
    expect(addNode(t, c.id, 'action').tree).toBe(t); // a leaf cannot have children
    expect(new Set(t.nodes.map((n) => n.id)).size).toBe(t.nodes.length);
  });

  it('starts an empty tree with its first node', () => {
    const r = addNode({ target: 'player', root: '', nodes: [] }, null, 'selector');
    expect(r.tree.root).toBe(r.id);
    expect(r.tree.nodes).toHaveLength(1);
  });

  it('removes a node together with everything under it, and the tree stays valid', () => {
    const t = guardTree();
    const sub = subtreeIds(t, 'chase');
    expect(sub).toEqual(['chase', 'sees', 'run']);
    const next = removeNode(t, 'chase');
    expect(next.nodes.some((n) => sub.includes(n.id))).toBe(false);
    expect(nodeOf(next, 'root')).toMatchObject({ children: ['search', 'wander'] });
    expect(checkTree(next)).toEqual([]);
    const emptied = removeNode(t, 'root');
    expect(emptied.nodes.length).toBe(0);
    const dec = removeNode({ target: 'player', root: 'i', nodes: [{ id: 'i', type: 'inverter', child: 'x' }, { id: 'x', type: 'action', action: { type: 'stop' } }] }, 'x');
    expect(nodeOf(dec, 'i')).toMatchObject({ child: null });
  });

  it('moves a node earlier or later among its brothers and sisters', () => {
    const t = guardTree();
    const moved = moveNode(t, 'wander', -1);
    expect(nodeOf(moved, 'root')).toMatchObject({ children: ['chase', 'wander', 'search'] });
    expect(moveNode(t, 'chase', -1)).toBe(t); // already first
    expect(moveNode(t, 'root', 1)).toBe(t); // the root has no brothers
  });

  it('wraps a node (to ask the opposite question) and keeps the tree connected', () => {
    const t = guardTree();
    const wrapped = wrapNode(t, 'sees', 'inverter');
    const inv = parentOf(wrapped, 'sees')!;
    expect(inv.type).toBe('inverter');
    expect(parentOf(wrapped, inv.id)!.id).toBe('chase');
    expect(nodeOf(wrapped, 'chase')).toMatchObject({ children: [inv.id, 'run'] });
    expect(checkTree(wrapped)).toEqual([]);
    const rootWrapped = wrapNode(t, 'root', 'sequence');
    expect(rootWrapped.root).not.toBe('root');
    expect(checkTree(rootWrapped)).toEqual([]);
  });

  it('duplicates a branch with new ids next to the original', () => {
    const t = guardTree();
    const { tree, id } = duplicateNode(t, 'chase');
    expect(id).not.toBe('chase');
    const root = nodeOf(tree, 'root') as { children: string[] };
    expect(root.children).toEqual(['chase', id, 'search', 'wander']);
    expect(subtreeIds(tree, id)).toHaveLength(3);
    expect(new Set(tree.nodes.map((n) => n.id)).size).toBe(tree.nodes.length);
    expect(checkTree(tree)).toEqual([]);
  });

  it('changes what a condition asks and what an action does', () => {
    const t = guardTree();
    const a = setCondition(t, 'sees', { type: 'near', cells: 2 });
    expect(nodeOf(a, 'sees')).toMatchObject({ condition: { type: 'near', cells: 2 } });
    const b = setAction(t, 'run', { type: 'wait', seconds: 4 });
    expect(nodeOf(b, 'run')).toMatchObject({ action: { type: 'wait', seconds: 4 } });
    expect(setAction(t, 'sees', { type: 'stop' })).toEqual(t); // a condition is not an action
  });
});

describe('the tree layout', () => {
  it('puts the root on the left, children to its right in order, parents between their children', () => {
    const t = guardTree();
    const { placed, width, height } = layoutTree(t);
    expect(placed.get('root')!.x).toBe(0);
    expect(placed.get('chase')!.x).toBe(NODE_W + 56);
    expect(placed.get('sees')!.x).toBe(2 * (NODE_W + 56));
    expect(placed.get('sees')!.y).toBeLessThan(placed.get('run')!.y);
    const ys = (id: string): number => placed.get(id)!.y;
    expect(ys('chase')).toBeCloseTo((ys('sees') + ys('run')) / 2);
    expect(ys('root')).toBeCloseTo((ys('chase') + ys('wander')) / 2);
    expect(width).toBe(3 * NODE_W + 2 * 56);
    expect(height).toBeGreaterThan(5 * NODE_H);
    // no two cards overlap
    const all = [...placed.values()];
    for (const a of all) for (const b of all) if (a !== b && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(NODE_H);
  });

  it('lists nodes that are not part of the tree below it', () => {
    const t = { ...guardTree(), nodes: [...guardTree().nodes, { id: 'orphan', type: 'action' as const, action: { type: 'stop' as const } }] };
    const { placed } = layoutTree(t);
    expect(placed.get('orphan')!.y).toBeGreaterThan(placed.get('wander')!.y);
  });
});
