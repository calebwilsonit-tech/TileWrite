import {} from '@tilewright/runtime';

/**
 * Behaviour trees for enemies, bosses and anything that makes decisions. A tree is asked what to do many times a second:
 * it starts at the root and asks its children in order. *Sequences* do their children one after another and stop at the
 * first that fails ("see the player, then chase, then shoot"); *selectors* try their children until one works ("chase if
 * you can, otherwise patrol, otherwise wander"). *Conditions* ask a question, *actions* do something (walk, wait, shout,
 * switch a behaviour on or off). Plain data, drawn as a tree in the Inspector.
 */

interface NodeBase {
  id: string;
  /** A name for the node in the editor ('' = describe it from what it does). */
  name?: string;
  /** Stop the game (in the editor) when an action node starts to run, like a breakpoint on an event row. */
  breakpoint?: boolean;
  x?: number;
  y?: number;
}

export type TreeCompare = '=' | '!=' | '>' | '>=' | '<' | '<=';

export type TreeCondition =
  | { type: 'sees' }
  | { type: 'heard' }
  /** Has not seen or heard the target for this many seconds. */
  | { type: 'lost'; seconds: number }
  | { type: 'near'; cells: number }
  | { type: 'far'; cells: number }
  /** Health is at or below this percentage. */
  | { type: 'health'; percent: number }
  /** True this percent of the time (decided once each time the question comes up). */
  | { type: 'chance'; percent: number }
  /** A wire into this object's "trigger" input is on. */
  | { type: 'signal' }
  | { type: 'variable'; name: string; op: TreeCompare; value: number | string | boolean };

export type TreeAction =
  | { type: 'wait'; seconds: number }
  | { type: 'stop' }
  | { type: 'moveToward'; speed: number; stop: number }
  | { type: 'moveAway'; speed: number; cells: number }
  | { type: 'goHome'; speed: number }
  | { type: 'wander'; speed: number; radius: number }
  | { type: 'face' }
  | { type: 'animation'; clip: string }
  | { type: 'say'; text: string }
  | { type: 'sound'; name: string }
  | { type: 'setVariable'; name: string; value: number | string | boolean }
  | { type: 'enable'; behaviour: string }
  | { type: 'disable'; behaviour: string };

export type TreeNodeKind = 'sequence' | 'selector' | 'parallel' | 'inverter' | 'succeeder' | 'repeat' | 'cooldown' | 'condition' | 'action';

export type TreeNode =
  | (NodeBase & { type: 'sequence' | 'selector' | 'parallel'; children: string[] })
  | (NodeBase & { type: 'inverter' | 'succeeder'; child: string | null })
  | (NodeBase & { type: 'repeat'; child: string | null; count: number })
  | (NodeBase & { type: 'cooldown'; child: string | null; seconds: number })
  | (NodeBase & { type: 'condition'; condition: TreeCondition })
  | (NodeBase & { type: 'action'; action: TreeAction });

export interface BehaviorTree {
  /** Tag of what the object looks at and moves toward or away from. */
  target: string;
  /** Id of the node the tree starts from. */
  root: string;
  nodes: TreeNode[];
}

export const NODE_KIND_LABELS: Record<TreeNodeKind, string> = {
  sequence: 'Does these in order (stops at the first that fails)',
  selector: 'Tries these in order (stops at the first that works)',
  parallel: 'Does all of these at once',
  inverter: 'Turns a yes into a no, and a no into a yes',
  succeeder: 'Counts as done even if its child failed',
  repeat: 'Repeats its child',
  cooldown: 'Lets its child run, then waits before the next time',
  condition: 'Asks a question',
  action: 'Does something',
};

export const CONDITION_KIND_LABELS: Record<TreeCondition['type'], string> = {
  sees: 'it sees its target',
  heard: 'it hears its target',
  lost: 'it has lost its target for a while',
  near: 'its target is close',
  far: 'its target is far away',
  health: 'its health is low',
  chance: 'luck says so',
  signal: 'a wire sends it a signal',
  variable: 'a variable has a value',
};

export const ACTION_KIND_LABELS: Record<TreeAction['type'], string> = {
  wait: 'Wait',
  stop: 'Stand still',
  moveToward: 'Walk toward its target',
  moveAway: 'Walk away from its target',
  goHome: 'Walk back to where it started',
  wander: 'Wander around nearby',
  face: 'Turn to face its target',
  animation: 'Play an animation',
  say: 'Say something',
  sound: 'Play a sound',
  setVariable: 'Set a variable',
  enable: 'Switch a behaviour on',
  disable: 'Switch a behaviour off',
};

export function newTreeCondition(type: TreeCondition['type']): TreeCondition {
  switch (type) {
    case 'lost':
      return { type, seconds: 3 };
    case 'near':
    case 'far':
      return { type, cells: 3 };
    case 'health':
      return { type, percent: 50 };
    case 'chance':
      return { type, percent: 30 };
    case 'variable':
      return { type, name: '', op: '>=', value: 1 };
    default:
      return { type } as TreeCondition;
  }
}

export function newTreeAction(type: TreeAction['type']): TreeAction {
  switch (type) {
    case 'wait':
      return { type, seconds: 1 };
    case 'moveToward':
      return { type, speed: 3.2, stop: 1 };
    case 'moveAway':
      return { type, speed: 3.2, cells: 5 };
    case 'goHome':
      return { type, speed: 2.4 };
    case 'wander':
      return { type, speed: 1.6, radius: 3 };
    case 'animation':
      return { type, clip: '' };
    case 'say':
      return { type, text: '' };
    case 'sound':
      return { type, name: '' };
    case 'setVariable':
      return { type, name: '', value: 1 };
    case 'enable':
    case 'disable':
      return { type, behaviour: '' };
    default:
      return { type } as TreeAction;
  }
}

export function newTreeNode(id: string, kind: TreeNodeKind): TreeNode {
  switch (kind) {
    case 'sequence':
    case 'selector':
    case 'parallel':
      return { id, type: kind, children: [] };
    case 'inverter':
    case 'succeeder':
      return { id, type: kind, child: null };
    case 'repeat':
      return { id, type: kind, child: null, count: 0 };
    case 'cooldown':
      return { id, type: kind, child: null, seconds: 2 };
    case 'condition':
      return { id, type: kind, condition: newTreeCondition('sees') };
    case 'action':
      return { id, type: kind, action: newTreeAction('wait') };
  }
}

/** The ids of a node's children, in order. */
export function childrenOf(n: TreeNode): string[] {
  switch (n.type) {
    case 'sequence':
    case 'selector':
    case 'parallel':
      return n.children;
    case 'condition':
    case 'action':
      return [];
    default:
      return n.child ? [n.child] : [];
  }
}

export function isComposite(n: TreeNode): n is Extract<TreeNode, { children: string[] }> {
  return n.type === 'sequence' || n.type === 'selector' || n.type === 'parallel';
}

export function isDecorator(n: TreeNode): n is Extract<TreeNode, { child: string | null }> {
  return n.type === 'inverter' || n.type === 'succeeder' || n.type === 'repeat' || n.type === 'cooldown';
}

export function describeTreeCondition(c: TreeCondition): string {
  switch (c.type) {
    case 'lost':
      return `it has lost its target for ${c.seconds} s`;
    case 'near':
      return `its target is within ${c.cells} cells`;
    case 'far':
      return `its target is more than ${c.cells} cells away`;
    case 'health':
      return `its health is ${c.percent}% or less`;
    case 'chance':
      return `${c.percent}% chance`;
    case 'variable':
      return `${c.name || '(variable)'} ${c.op} ${String(c.value)}`;
    default:
      return CONDITION_KIND_LABELS[c.type];
  }
}

export function describeTreeAction(a: TreeAction): string {
  switch (a.type) {
    case 'wait':
      return `wait ${a.seconds} s`;
    case 'moveToward':
      return `walk toward its target (stop ${a.stop} cells away)`;
    case 'moveAway':
      return `walk ${a.cells} cells away from its target`;
    case 'goHome':
      return 'walk back to where it started';
    case 'wander':
      return `wander within ${a.radius} cells`;
    case 'animation':
      return `play the animation "${a.clip || '(clip)'}"`;
    case 'say':
      return `say "${a.text || '...'}"`;
    case 'sound':
      return `play the sound "${a.name || '(sound)'}"`;
    case 'setVariable':
      return `set ${a.name || '(variable)'} to ${String(a.value)}`;
    case 'enable':
      return `switch on ${a.behaviour || '(behaviour)'}`;
    case 'disable':
      return `switch off ${a.behaviour || '(behaviour)'}`;
    default:
      return ACTION_KIND_LABELS[a.type].toLowerCase();
  }
}

/** One line saying what a node is (its name, or what it does). */
export function describeNode(n: TreeNode): string {
  if (n.name) return n.name;
  switch (n.type) {
    case 'sequence':
      return 'In order';
    case 'selector':
      return 'First that works';
    case 'parallel':
      return 'All at once';
    case 'inverter':
      return 'Not';
    case 'succeeder':
      return 'Always OK';
    case 'repeat':
      return n.count > 0 ? `Repeat ${n.count} times` : 'Repeat forever';
    case 'cooldown':
      return `Then rest ${n.seconds} s`;
    case 'condition':
      return `If ${describeTreeCondition(n.condition)}`;
    case 'action':
      return describeTreeAction(n.action);
  }
}

/** Mistakes in a tree that would stop it doing what it says, in plain English. */
export function checkTree(t: BehaviorTree, has: (behaviour: string) => boolean = () => true): string[] {
  const out: string[] = [];
  if (t.nodes.length === 0) return ['It has no nodes yet.'];
  const byId = new Map<string, TreeNode>();
  for (const n of t.nodes) {
    if (byId.has(n.id)) out.push(`Two nodes share the id "${n.id}".`);
    byId.set(n.id, n);
  }
  if (!byId.has(t.root)) {
    out.push(`It starts from "${t.root}", which is not one of its nodes.`);
    return out;
  }
  const parents = new Map<string, number>();
  const seen = new Set<string>();
  const walk = (id: string, trail: string[]): void => {
    if (trail.includes(id)) {
      out.push(`The node "${describeNode(byId.get(id)!)}" leads back to itself, so the tree would never end.`);
      return;
    }
    const n = byId.get(id);
    if (!n) return;
    seen.add(id);
    for (const c of childrenOf(n)) {
      if (!byId.has(c)) {
        out.push(`"${describeNode(n)}" has a child that does not exist.`);
        continue;
      }
      parents.set(c, (parents.get(c) ?? 0) + 1);
      walk(c, [...trail, id]);
    }
  };
  walk(t.root, []);
  for (const [id, n] of parents) if (n > 1) out.push(`The node "${describeNode(byId.get(id)!)}" is used in more than one place.`);
  for (const n of t.nodes) {
    if (!seen.has(n.id)) {
      out.push(`The node "${describeNode(n)}" is not connected to the tree, so it never runs.`);
      continue;
    }
    if (isComposite(n) && n.children.length === 0) out.push(`"${describeNode(n)}" has nothing inside it.`);
    if (isDecorator(n) && !n.child) out.push(`"${describeNode(n)}" has nothing to work on: add a child.`);
    if (n.type === 'condition' && n.condition.type === 'variable' && !n.condition.name) out.push(`"${describeNode(n)}" checks a variable but no variable is chosen.`);
    if (n.type === 'action' && n.action.type === 'setVariable' && !n.action.name) out.push(`"${describeNode(n)}" sets a variable but no variable is chosen.`);
    if (n.type === 'action' && (n.action.type === 'enable' || n.action.type === 'disable')) {
      if (!n.action.behaviour) out.push(`"${describeNode(n)}" switches a behaviour but none is chosen.`);
      else if (!has(n.action.behaviour)) out.push(`"${describeNode(n)}" switches the behaviour "${n.action.behaviour}", which this object does not have.`);
    }
    if (n.type === 'action' && n.action.type === 'animation' && !n.action.clip) out.push(`"${describeNode(n)}" plays an animation but none is chosen.`);
  }
  // an infinite loop of instant nodes would freeze nothing (it runs once per tick) but also never do anything useful
  const only = t.nodes.filter((n) => seen.has(n.id));
  if (only.length > 0 && only.every((n) => n.type !== 'action' && n.type !== 'condition' && !isComposite(n) && !isDecorator(n))) out.push('The tree does nothing.');
  return out;
}

// ---------- examples ----------

const seq = (id: string, children: string[], name?: string): TreeNode => ({ id, type: 'sequence', children, ...(name ? { name } : {}) });

const sel = (id: string, children: string[], name?: string): TreeNode => ({ id, type: 'selector', children, ...(name ? { name } : {}) });

const cond = (id: string, condition: TreeCondition, name?: string): TreeNode => ({ id, type: 'condition', condition, ...(name ? { name } : {}) });

const action = (id: string, a: TreeAction, name?: string): TreeNode => ({ id, type: 'action', action: a, ...(name ? { name } : {}) });

/** The Guard example: chase what it sees, otherwise look around where it lost it, otherwise wander near home. */
export function guardTree(): BehaviorTree {
  return {
    target: 'player',
    root: 'root',
    nodes: [
      sel('root', ['chase', 'search', 'wander'], 'Guard'),
      seq('chase', ['sees', 'run'], 'Chase what it sees'),
      cond('sees', { type: 'sees' }),
      action('run', { type: 'moveToward', speed: 3.4, stop: 0.8 }),
      seq('search', ['lost', 'look', 'home'], 'Look around, then go back'),
      cond('lost', { type: 'lost', seconds: 0.2 }, 'It just lost sight'),
      action('look', { type: 'wait', seconds: 3 }, 'Look around'),
      action('home', { type: 'goHome', speed: 2.4 }),
      action('wander', { type: 'wander', speed: 1.4, radius: 3 }),
    ],
  };
}

/**
 * The Archer example: keeps its distance and closes in when the target is far. Give the object a Ranged Attack too; this
 * tree stands it still and turned toward the target while it is in range, so the shots find their mark.
 */
export function archerTree(): BehaviorTree {
  return {
    target: 'player',
    root: 'root',
    nodes: [
      sel('root', ['flee', 'shoot', 'approach', 'idle'], 'Archer'),
      seq('flee', ['close', 'back'], 'Too close: back off'),
      cond('close', { type: 'near', cells: 3 }),
      action('back', { type: 'moveAway', speed: 3.2, cells: 5 }),
      seq('shoot', ['sees', 'inRange', 'aim', 'hold'], 'In range: take aim'),
      cond('sees', { type: 'sees' }),
      { id: 'inRange', type: 'inverter', child: 'notFar', name: 'Not too far' },
      cond('notFar', { type: 'far', cells: 7 }),
      action('aim', { type: 'face' }),
      action('hold', { type: 'wait', seconds: 0.5 }, 'Hold still for the shot'),
      seq('approach', ['far', 'go'], 'Too far: get closer'),
      cond('far', { type: 'far', cells: 7 }),
      action('go', { type: 'moveToward', speed: 2.6, stop: 5 }),
      action('idle', { type: 'stop' }),
    ],
  };
}

/** The Wanderer example: ambles around home, pausing now and then, and runs when hurt. */
export function wandererTree(): BehaviorTree {
  return {
    target: 'player',
    root: 'root',
    nodes: [
      sel('root', ['hurt', 'amble'], 'Wanderer'),
      seq('hurt', ['low', 'flee'], 'Hurt: run away'),
      cond('low', { type: 'health', percent: 50 }),
      action('flee', { type: 'moveAway', speed: 3.6, cells: 8 }),
      seq('amble', ['go', 'rest'], 'Amble about'),
      action('go', { type: 'wander', speed: 1.3, radius: 4 }),
      action('rest', { type: 'wait', seconds: 2 }),
    ],
  };
}
