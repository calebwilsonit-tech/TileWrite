import { C, fieldDefault, type CustomBehaviorData, type CustomComponentData, type CustomField } from '@tilewright/runtime';
import { defineBehavior, forgetBehavior, getBehavior, shelvedBehavior, type BehaviorDef, type FieldSpec } from './framework';
import { runEventRows } from './events/sheet';

/**
 * Custom components and behaviours made in the editor with no code. A custom component is named data an object carries
 * (shown as settings in the Inspector); a custom behaviour is event rows with settings of their own that run for every
 * object that has it. Both are registered like built-in behaviours, so they show up in the Add menu, can be wired, listed
 * by event rows ("has the component...") and saved in prefabs.
 */

/** Component names the engine itself uses; a custom block may not take them. */
const RESERVED = new Set<string>([...Object.values(C), 'signals', 'animator', 'light', 'tags', 'persistent', 'state']);

const registered = new Set<string>();

function fieldSpec(f: CustomField): FieldSpec {
  const base: FieldSpec = { key: f.key, label: f.label || f.key, type: f.type === 'select' ? 'select' : f.type, help: f.help || undefined };
  if (f.type === 'select') base.options = f.options.map((o) => ({ value: o, label: o }));
  if (f.type === 'number') {
    if (f.min !== undefined) base.min = f.min;
    if (f.max !== undefined) base.max = f.max;
    if (f.step !== undefined) base.step = f.step;
  }
  if (f.type === 'tableRow') base.table = f.table;
  return base;
}

function defaultsOf(fields: readonly CustomField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.key, fieldDefault(f)]));
}

/** Why a name cannot be used, or null. */
export function customNameProblem(name: string, taken: ReadonlySet<string> = new Set()): string | null {
  if (!/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(name)) return 'Names use letters and numbers and start with a letter (for example "Stats" or "Shopkeeper").';
  if (RESERVED.has(name) || (shelvedBehavior(name) && !registered.has(name))) return `"${name}" is already used by the engine. Pick another name.`;
  if (taken.has(name)) return `There is already something called "${name}".`;
  return null;
}

/** Make a custom component's definition. */
export function componentDef(c: CustomComponentData): BehaviorDef {
  return {
    id: c.name,
    name: c.name,
    category: 'Custom components',
    description: c.description || `Data an object carries: ${c.fields.map((f) => f.label || f.key).join(', ') || 'no fields yet'}.`,
    phase: 'logic',
    dataOnly: true,
    defaults: defaultsOf(c.fields),
    fields: c.fields.map(fieldSpec),
    inputs: [],
    outputs: [],
    requires: {},
    update: () => undefined,
  };
}

/** Make a custom behaviour's definition. */
export function behaviorDefOf(b: CustomBehaviorData): BehaviorDef {
  const scoped = (b.params ?? []).map((p) => `self.${p.key}`);
  return {
    id: b.name,
    name: b.name,
    category: b.category || 'Custom',
    description: b.description || 'A behaviour made in the editor from event rows.',
    phase: 'actuator',
    defaults: defaultsOf(b.params),
    fields: b.params.map(fieldSpec),
    inputs: b.inputs.map((s) => ({ name: s.name, label: s.label || s.name })),
    outputs: b.outputs.map((s) => ({ name: s.name, label: s.label || s.name })),
    requires: {},
    update(ctx, e, settings) {
      const vars = ctx.runtime.vars;
      b.params.forEach((p, i) => {
        vars[scoped[i]!] = ((settings as Record<string, unknown>)[p.key] ?? fieldDefault(p)) as never;
      });
      vars['self.name'] = e.name;
      try {
        runEventRows(ctx, b.rows, e, `${b.name}@${e.id}:`);
      } finally {
        for (const k of scoped) delete vars[k];
        delete vars['self.name'];
      }
    },
  };
}

/**
 * Make the registry hold exactly these custom blocks (anything registered before is taken out first). Returns the
 * problems in plain English: blocks whose names clash with the engine's or with each other are left out.
 */
export function syncCustomBlocks(components: readonly CustomComponentData[], behaviors: readonly CustomBehaviorData[]): string[] {
  for (const id of registered) forgetBehavior(id);
  registered.clear();
  const problems: string[] = [];
  const taken = new Set<string>();
  const add = (kind: string, name: string, make: () => BehaviorDef): void => {
    const bad = customNameProblem(name, taken);
    if (bad) {
      problems.push(`The ${kind} "${name}" was left out: ${bad}`);
      return;
    }
    taken.add(name);
    defineBehavior(make());
    registered.add(name);
  };
  for (const c of components) add('component', c.name, () => componentDef(c));
  for (const b of behaviors) add('behaviour', b.name, () => behaviorDefOf(b));
  return problems;
}

export function isCustomBlock(id: string): boolean {
  return registered.has(id);
}

export function customBlockIds(): string[] {
  return [...registered];
}

/** The component names an object may have a field of, for a quick sanity check in tests and the checker. */
export function hasCustomBlock(id: string): boolean {
  return registered.has(id) && getBehavior(id) !== undefined;
}
