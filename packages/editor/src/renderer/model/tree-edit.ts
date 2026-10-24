import {
  childrenOf,
  isComposite,
  isDecorator,
  newTreeNode,
  type BehaviorTree,
  type TreeAction,
  type TreeCondition,
  type TreeNode,
  type TreeNodeKind,
} from '@tilewright/plugin-ai';


/**
 * Edits of a behaviour tree as pure functions (each returns a new tree), and the layout the editor draws.
 * Nothing here knows about React, so it is easy to test.
 */

export const NODE_W = 196;
export const NODE_H = 36;
export const GAP_X = 56;
export const GAP_Y = 14;

/** A fresh node id that is not used yet. */
export function freshId(t: BehaviorTree, prefix = 'n'): string {
  let n = t.nodes.length + 1;
  while (t.nodes.some((x) => x.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const replace = (t: BehaviorTree, id: string, fn: (n: TreeNode) => TreeNode): BehaviorTree => ({ ...t, nodes: t.nodes.map((n) => (n.id === id ? fn(n) : n)) });

export function nodeOf(t: BehaviorTree, id: string): TreeNode | undefined {
  return t.nodes.find((n) => n.id === id);
}

/** The node that has `id` as a child, if any. */
export function parentOf(t: BehaviorTree, id: string): TreeNode | undefined {
  return t.nodes.find((n) => childrenOf(n).includes(id));
}

/** A node and everything under it. */
export function subtreeIds(t: BehaviorTree, id: string): string[] {
  const out: string[] = [];
  const walk = (x: string): void => {
    if (out.includes(x)) return;
    out.push(x);
    const n = nodeOf(t, x);
    if (n) for (const c of childrenOf(n)) walk(c);
  };
  walk(id);
  return out;
}

/** Can this node take another child? (A decorator only holds one.) */
export function canHaveChild(n: TreeNode): boolean {
  if (isComposite(n)) return true;
  if (isDecorator(n)) return !n.child;
  return false;
}

/** Make a tree with just a root of the given kind. */
export function startTree(kind: TreeNodeKind = 'selector', target = 'player'): BehaviorTree {
  return { target, root: 'root', nodes: [{ ...newTreeNode('root', kind) }] };
}

/** Add a new node of `kind` under `parentId` (at the end), or as the root of an empty tree. Returns the new tree and the new node's id. */
export function addNode(t: BehaviorTree, parentId: string | null, kind: TreeNodeKind): { tree: BehaviorTree; id: string } {
  const id = freshId(t);
  const node = newTreeNode(id, kind);
  if (parentId === null) {
    if (t.nodes.length === 0) return { tree: { ...t, root: id, nodes: [node] }, id };
    return { tree: t, id: t.root };
  }
  const parent = nodeOf(t, parentId);
  if (!parent || !canHaveChild(parent)) return { tree: t, id: parentId };
  const next = replace(t, parentId, (n) => (isComposite(n) ? { ...n, children: [...n.children, id] } : isDecorator(n) ? { ...n, child: id } : n));
  return { tree: { ...next, nodes: [...next.nodes, node] }, id };
}

/** Remove a node and everything under it. */
export function removeNode(t: BehaviorTree, id: string): BehaviorTree {
  const gone = new Set(subtreeIds(t, id));
  const nodes = t.nodes
    .filter((n) => !gone.has(n.id))
    .map((n) => (isComposite(n) ? { ...n, children: n.children.filter((c) => !gone.has(c)) } : isDecorator(n) && n.child && gone.has(n.child) ? { ...n, child: null } : n));
  return { ...t, nodes, root: gone.has(t.root) ? (nodes[0]?.id ?? '') : t.root };
}

/** Change the settings of a node (what it asks or does, its name, its numbers). */
export function updateNode(t: BehaviorTree, id: string, patch: Partial<TreeNode>): BehaviorTree {
  return replace(t, id, (n) => ({ ...n, ...patch }) as TreeNode);
}

export function setCondition(t: BehaviorTree, id: string, c: TreeCondition): BehaviorTree {
  return replace(t, id, (n) => (n.type === 'condition' ? { ...n, condition: c } : n));
}

export function setAction(t: BehaviorTree, id: string, a: TreeAction): BehaviorTree {
  return replace(t, id, (n) => (n.type === 'action' ? { ...n, action: a } : n));
}

/** Move a node earlier (-1) or later (+1) among its brothers and sisters. */
export function moveNode(t: BehaviorTree, id: string, delta: -1 | 1): BehaviorTree {
  const p = parentOf(t, id);
  if (!p || !isComposite(p)) return t;
  const i = p.children.indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= p.children.length) return t;
  const children = [...p.children];
  [children[i], children[j]] = [children[j]!, children[i]!];
  return replace(t, p.id, (n) => ({ ...n, children }) as TreeNode);
}

/** Put a node inside a new decorator or composite (so "the player is close" can become "the player is NOT close"). */
export function wrapNode(t: BehaviorTree, id: string, kind: TreeNodeKind): BehaviorTree {
  const wrapper = newTreeNode(freshId(t), kind);
  if (!canHaveChild(wrapper)) return t;
  const parent = parentOf(t, id);
  const filled: TreeNode = isComposite(wrapper) ? { ...wrapper, children: [id] } : isDecorator(wrapper) ? { ...wrapper, child: id } : wrapper;
  let nodes = t.nodes.map((n) => {
    if (parent && n.id === parent.id) {
      if (isComposite(n)) return { ...n, children: n.children.map((c) => (c === id ? filled.id : c)) };
      if (isDecorator(n)) return { ...n, child: filled.id };
    }
    return n;
  });
  nodes = [...nodes, filled];
  return { ...t, nodes, root: t.root === id ? filled.id : t.root };
}

/** A copy of a node and everything under it, added next to the original. Returns the copy's id. */
export function duplicateNode(t: BehaviorTree, id: string): { tree: BehaviorTree; id: string } {
  const parent = parentOf(t, id);
  if (!parent || !isComposite(parent)) return { tree: t, id };
  const ids = subtreeIds(t, id);
  const map = new Map<string, string>();
  let tree = t;
  for (const old of ids) {
    const fresh = freshId(tree);
    map.set(old, fresh);
    tree = { ...tree, nodes: [...tree.nodes, { ...nodeOf(t, old)!, id: fresh } as TreeNode] }; // reserve the id
  }
  const remap = (n: TreeNode): TreeNode => (isComposite(n) ? { ...n, children: n.children.map((c) => map.get(c) ?? c) } : isDecorator(n) && n.child ? { ...n, child: map.get(n.child) ?? n.child } : n);
  const copies = new Set(map.values());
  tree = { ...tree, nodes: tree.nodes.map((n) => (copies.has(n.id) ? { ...remap(n), x: undefined, y: undefined } : n)) };
  const copyId = map.get(id)!;
  const at = parent.children.indexOf(id);
  tree = replace(tree, parent.id, (n) => ({ ...n, children: [...(n as { children: string[] }).children.slice(0, at + 1), copyId, ...(n as { children: string[] }).children.slice(at + 1)] }) as TreeNode);
  return { tree, id: copyId };
}

// ---------- layout ----------

export interface Placed {
  id: string;
  x: number;
  y: number;
  depth: number;
}

/** Tidy layout, root on the left: leaves get a row each, a parent sits in the middle of its children. */
export function layoutTree(t: BehaviorTree): { placed: Map<string, Placed>; width: number; height: number } {
  const placed = new Map<string, Placed>();
  let row = 0;
  const visit = (id: string, depth: number, seen: Set<string>): number => {
    const n = nodeOf(t, id);
    if (!n || seen.has(id)) return row * (NODE_H + GAP_Y);
    const trail = new Set(seen).add(id);
    const kids = childrenOf(n).filter((c) => nodeOf(t, c));
    let y: number;
    if (kids.length === 0) {
      y = row * (NODE_H + GAP_Y);
      row++;
    } else {
      const ys = kids.map((c) => visit(c, depth + 1, trail));
      y = (ys[0]! + ys[ys.length - 1]!) / 2;
    }
    placed.set(id, { id, x: depth * (NODE_W + GAP_X), y, depth });
    return y;
  };
  if (nodeOf(t, t.root)) visit(t.root, 0, new Set());
  // nodes that are not connected to the root are listed below the tree
  const loose = t.nodes.filter((n) => !placed.has(n.id));
  const baseRow = row;
  loose.forEach((n, i) => placed.set(n.id, { id: n.id, x: 0, y: (baseRow + i) * (NODE_H + GAP_Y) + 20, depth: 0 }));
  const all = [...placed.values()];
  return { placed, width: Math.max(...all.map((p) => p.x), 0) + NODE_W, height: Math.max(...all.map((p) => p.y), 0) + NODE_H };
}

/** The colour family of a node kind (for the editor's cards). */
export function kindColor(n: TreeNode): string {
  switch (n.type) {
    case 'sequence':
      return '#3a7d55';
    case 'selector':
      return '#2f6fb3';
    case 'parallel':
      return '#7b5aa6';
    case 'inverter':
    case 'succeeder':
    case 'repeat':
    case 'cooldown':
      return '#9a7a2a';
    case 'condition':
      return '#b0563a';
    case 'action':
      return '#4a5568';
  }
}
