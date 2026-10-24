import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION } from '../project/schema';
import type { InputMapDef } from './input';
import { activeActionLabels, activeInputMap } from './keyboard';

/**
 * The game's own controls, kept in `assets/input.json`: which keys and buttons the built-in actions start with, and
 * extra actions the game makes up ("dash", "torch") that event rows, scripts and the Controls screen can use.
 * Players can still change any of it in the game's Settings -> Controls.
 */

const BindingList = z.array(z.string().min(1)).max(8);

export const CustomActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'Action names use lower-case letters, numbers and _, and start with a letter'),
  label: z.string().min(1),
  bindings: BindingList.default([]),
});
export type CustomAction = z.infer<typeof CustomActionSchema>;

export const ProjectInputSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  /** Starting keys and buttons that differ from the built-in ones, by action. */
  overrides: z.record(z.string(), BindingList).default({}),
  actions: z.array(CustomActionSchema).default([]),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export const emptyProjectInput = (): ProjectInput => ProjectInputSchema.parse({});

/** The actions a game cannot work without. */
export const REQUIRED_ACTIONS = ['move_left', 'move_right', 'move_up', 'move_down', 'interact', 'pause'] as const;

/** The bindings a new player starts with: the built-in ones, this game's changes, then its own actions. */
export function projectDefaults(p: ProjectInput | null | undefined, base: InputMapDef = activeInputMap()): InputMapDef {
  const out: InputMapDef = { ...base };
  if (!p) return out;
  for (const [a, list] of Object.entries(p.overrides)) if (a in base) out[a] = [...list];
  for (const c of p.actions) out[c.id] = [...c.bindings];
  return out;
}

/** Plain-English names for every action, the game's own included. */
export function projectActionLabels(p: ProjectInput | null | undefined, labels: Record<string, string> = activeActionLabels()): Record<string, string> {
  const out: Record<string, string> = { ...labels };
  for (const c of p?.actions ?? []) out[c.id] = c.label;
  return out;
}

/** Mistakes in the controls, in plain English. */
export function checkProjectInput(p: ProjectInput, base: { map: InputMapDef; labels: Record<string, string> } = { map: activeInputMap(), labels: activeActionLabels() }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of p.actions) {
    if (c.id in base.labels) out.push(`The action "${c.id}" is already one of the built-in actions. Pick another name.`);
    if (seen.has(c.id)) out.push(`Two of your own actions are called "${c.id}".`);
    seen.add(c.id);
    if (c.bindings.length === 0) out.push(`The action "${c.label}" has no key or button yet, so the player can never do it.`);
  }
  for (const a of Object.keys(p.overrides)) if (!(a in base.map)) out.push(`The setting for "${a}" does nothing: there is no built-in action with that name.`);
  const map = projectDefaults(p, base.map);
  for (const a of REQUIRED_ACTIONS) if ((map[a] ?? []).length === 0) out.push(`"${base.labels[a] ?? a}" has no key or button, so the game could not be played.`);
  const owner = new Map<string, string>();
  const labels = projectActionLabels(p, base.labels);
  for (const [a, list] of Object.entries(map)) {
    for (const b of list) {
      const other = owner.get(b);
      if (other && other !== a) out.push(`"${b.replace(/^key:/, '')}" is used by both "${labels[other] ?? other}" and "${labels[a] ?? a}".`);
      owner.set(b, a);
    }
  }
  return out;
}
