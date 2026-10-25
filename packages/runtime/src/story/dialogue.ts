import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION, VariableValueSchema, type VariableValue } from '../project/schema';
import { richTextProblems } from './richtext';

/**
 * Dialogue graphs: lines, choices (with conditions), set a variable, give or take an item, branch on a
 * condition, end. Plain data in `assets/dialogues/<name>.dialogue.json`.
 */

const COMPARES = ['=', '!=', '>', '>=', '<', '<='] as const;

export const DialogueConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('variable'), name: z.string().default(''), op: z.enum(COMPARES).default('>='), value: VariableValueSchema.default(1) }),
  z.object({ kind: z.literal('item'), item: z.string().default(''), atLeast: z.number().default(1) }),
]);
export type DialogueCondition = z.infer<typeof DialogueConditionSchema>;

/** x and y are where the node sits in the graph view (unset = placed automatically). */
const base = { id: z.string().min(1), x: z.number().optional(), y: z.number().optional() };

export const DialogueNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('line'), speaker: z.string().default(''), text: z.string().default(''), next: z.string().optional() }),
  z.object({
    ...base,
    type: z.literal('choice'),
    speaker: z.string().default(''),
    prompt: z.string().default(''),
    options: z.array(z.object({ text: z.string().default(''), next: z.string().optional(), if: DialogueConditionSchema.optional() })).default([]),
  }),
  z.object({ ...base, type: z.literal('set'), variable: z.string().default(''), op: z.enum(['set', 'add', 'toggle']).default('set'), value: VariableValueSchema.default(1), next: z.string().optional() }),
  z.object({ ...base, type: z.literal('give'), item: z.string().default(''), amount: z.number().default(1), next: z.string().optional() }),
  z.object({ ...base, type: z.literal('branch'), if: DialogueConditionSchema, then: z.string().optional(), else: z.string().optional() }),
  z.object({ ...base, type: z.literal('end') }),
]);
export type DialogueNode = z.infer<typeof DialogueNodeSchema>;

export const DialogueSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  name: z.string().min(1),
  /** Id of the first node. */
  start: z.string().default(''),
  nodes: z.array(DialogueNodeSchema).default([]),
});
export type DialogueData = z.infer<typeof DialogueSchema>;

export function newDialogue(name: string): DialogueData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name, start: 'n1', nodes: [{ id: 'n1', type: 'line', speaker: '', text: 'Hello!' }] };
}

// ---------- running ----------

/**
 * What a plugin that keeps things the player carries offers to conversations and cutscenes: how many of a thing the player has, and
 * giving or taking some. The engine itself keeps no inventory; with none offered, nothing is carried and nothing can be given.
 */
export interface Carrying {
  count(id: string): number;
  /** Give (or, negative, take) some; returns how many actually were. */
  give(id: string, amount: number): number;
}

/** What a running conversation can change and look at. */
export interface DialogueHost {
  vars: Record<string, VariableValue>;
  carrying?: Carrying;
  /** Called when something noteworthy happens (an item is given, a variable set). */
  emit?(type: string, data: Record<string, unknown>): void;
  /** Turns written text into the player's language (before {placeholders} are filled in). */
  tr?(text: string): string;
}

/** What the player sees right now. */
export type DialogueView =
  | { kind: 'line'; speaker: string; text: string }
  | { kind: 'choice'; speaker: string; prompt: string; options: { text: string; index: number }[] };

export interface DialogueState {
  /** Name of the dialogue, or "" for a single line a cutscene is saying. */
  dialogue: string;
  node: string;
  view: DialogueView;
  /** Which listed option is highlighted (for choices). */
  selected: number;
}

export function evalCondition(c: DialogueCondition, vars: Record<string, VariableValue>, carrying?: Carrying): boolean {
  if (c.kind === 'item') return (carrying?.count(c.item) ?? 0) >= c.atLeast;
  const a = vars[c.name];
  const b = c.value;
  switch (c.op) {
    case '=':
      return a === b;
    case '!=':
      return a !== b;
  }
  const x = typeof a === 'number' ? a : Number(a);
  const y = typeof b === 'number' ? b : Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  switch (c.op) {
    case '>':
      return x > y;
    case '>=':
      return x >= y;
    case '<':
      return x < y;
    default:
      return x <= y;
  }
}

/** Replace {name} with a variable's value. */
export function fillText(text: string, vars: Record<string, VariableValue>): string {
  return text.replace(/\{([^{}]+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

const MAX_HOPS = 200;

/**
 * Walk from `nodeId` through the silent nodes (set, give, branch) until something the player must see.
 * Returns null when the conversation is over (an end node, a missing node, or a loop with no text in it).
 */
function settle(d: DialogueData, nodeId: string | undefined, host: DialogueHost): DialogueState | null {
  let id = nodeId;
  const tr = host.tr ?? ((s: string): string => s);
  for (let hops = 0; hops < MAX_HOPS; hops++) {
    if (!id) return null;
    const n = d.nodes.find((x) => x.id === id);
    if (!n || n.type === 'end') return null;
    switch (n.type) {
      case 'line':
        return { dialogue: d.name, node: n.id, selected: 0, view: { kind: 'line', speaker: tr(n.speaker), text: fillText(tr(n.text), host.vars) } };
      case 'choice': {
        const options = n.options.map((o, index) => ({ o, index })).filter(({ o }) => !o.if || evalCondition(o.if, host.vars, host.carrying)).map(({ o, index }) => ({ text: fillText(tr(o.text), host.vars), index }));
        if (options.length === 0) return null;
        return { dialogue: d.name, node: n.id, selected: 0, view: { kind: 'choice', speaker: tr(n.speaker), prompt: fillText(tr(n.prompt), host.vars), options } };
      }
      case 'set': {
        const cur = host.vars[n.variable];
        if (n.op === 'add') host.vars[n.variable] = (typeof cur === 'number' ? cur : 0) + (typeof n.value === 'number' ? n.value : Number(n.value) || 0);
        else if (n.op === 'toggle') host.vars[n.variable] = !(cur === true || cur === 1);
        else host.vars[n.variable] = n.value;
        host.emit?.('variable-set', { name: n.variable, value: host.vars[n.variable] });
        id = n.next;
        break;
      }
      case 'give': {
        const got = host.carrying?.give(n.item, n.amount) ?? 0;
        host.emit?.(n.amount >= 0 ? 'item-given' : 'item-taken', { item: n.item, amount: got });
        id = n.next;
        break;
      }
      case 'branch':
        id = evalCondition(n.if, host.vars, host.carrying) ? n.then : n.else;
        break;
    }
  }
  return null;
}

/** Begin a conversation. Null if the dialogue has nothing to show. */
export function startDialogue(d: DialogueData, host: DialogueHost): DialogueState | null {
  return settle(d, d.start, host);
}

/** The player pressed Continue on a line: go to the next node. Null when it ends. */
export function advanceDialogue(d: DialogueData, state: DialogueState, host: DialogueHost): DialogueState | null {
  const n = d.nodes.find((x) => x.id === state.node);
  if (!n || n.type !== 'line') return null;
  return settle(d, n.next, host);
}

/** The player picked option `index` (the original index, as listed in the view). */
export function chooseDialogue(d: DialogueData, state: DialogueState, index: number, host: DialogueHost): DialogueState | null {
  const n = d.nodes.find((x) => x.id === state.node);
  if (!n || n.type !== 'choice') return null;
  const listed = state.view.kind === 'choice' && state.view.options.some((o) => o.index === index);
  const opt = n.options[index];
  if (!listed || !opt) return state; // not a valid pick: stay where we are
  return settle(d, opt.next, host);
}

// ---------- checking ----------

export interface DialogueProblem {
  node?: string;
  text: string;
}

/** Plain-English problems in a dialogue: nodes that lead nowhere, missing items or variables, lines nobody can reach. */
export function checkDialogue(d: DialogueData, known: { carried: ReadonlySet<string>; variables: ReadonlySet<string> }): DialogueProblem[] {
  const out: DialogueProblem[] = [];
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (ids.has(n.id)) out.push({ node: n.id, text: `Two nodes are both called "${n.id}".` });
    ids.add(n.id);
  }
  if (d.nodes.length === 0) out.push({ text: `The dialogue "${d.name}" has no nodes yet.` });
  else if (!ids.has(d.start)) out.push({ text: `The dialogue "${d.name}" starts at "${d.start}", which does not exist. Pick a starting node.` });
  const target = (from: string, to: string | undefined, what: string): void => {
    if (to !== undefined && to !== '' && !ids.has(to)) out.push({ node: from, text: `${what} of "${from}" goes to "${to}", which does not exist.` });
  };
  const checkCond = (from: string, c: DialogueCondition): void => {
    if (c.kind === 'item' && c.item && !known.carried.has(c.item)) out.push({ node: from, text: `"${from}" checks for the item "${c.item}", which is not in your items list.` });
    if (c.kind === 'variable' && c.name === '') out.push({ node: from, text: `A condition in "${from}" has no variable chosen.` });
  };
  for (const n of d.nodes) {
    switch (n.type) {
      case 'line':
        target(n.id, n.next, 'The next step');
        if (n.text.trim() === '') out.push({ node: n.id, text: `The line "${n.id}" has no text.` });
        for (const p of richTextProblems(n.text)) out.push({ node: n.id, text: `In the line "${n.id}": ${p}` });
        break;
      case 'choice':
        if (n.options.length === 0) out.push({ node: n.id, text: `The choice "${n.id}" has no options, so the conversation would just end.` });
        n.options.forEach((o, i) => {
          target(n.id, o.next, `Option ${i + 1}`);
          if (o.if) checkCond(n.id, o.if);
          if (o.text.trim() === '') out.push({ node: n.id, text: `Option ${i + 1} of "${n.id}" has no text.` });
          for (const p of richTextProblems(o.text)) out.push({ node: n.id, text: `In option ${i + 1} of "${n.id}": ${p}` });
        });
        break;
      case 'set':
        target(n.id, n.next, 'The next step');
        if (n.variable === '') out.push({ node: n.id, text: `The "set a variable" step "${n.id}" has no variable name.` });
        break;
      case 'give':
        target(n.id, n.next, 'The next step');
        if (n.item === '') out.push({ node: n.id, text: `The "give an item" step "${n.id}" has no item chosen.` });
        else if (!known.carried.has(n.item)) out.push({ node: n.id, text: `"${n.id}" gives the item "${n.item}", which is not in your items list.` });
        break;
      case 'branch':
        target(n.id, n.then, 'The "yes" way');
        target(n.id, n.else, 'The "no" way');
        checkCond(n.id, n.if);
        break;
      case 'end':
        break;
    }
  }
  // lines nobody can reach
  const reach = new Set<string>();
  const stack = ids.has(d.start) ? [d.start] : [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    const n = d.nodes.find((x) => x.id === id);
    if (!n) continue;
    if (n.type === 'choice') {
      for (const o of n.options) if (o.next) stack.push(o.next);
    } else if (n.type === 'branch') {
      if (n.then) stack.push(n.then);
      if (n.else) stack.push(n.else);
    } else if (n.type !== 'end' && n.next) stack.push(n.next);
  }
  for (const n of d.nodes) if (!reach.has(n.id) && ids.has(d.start)) out.push({ node: n.id, text: `"${n.id}" can never be reached from the start.` });
  return out;
}
