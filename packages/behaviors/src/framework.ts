import { SystemError, type Entity, type SimContext, type System } from '@tilewright/runtime';

export type FieldType = 'number' | 'boolean' | 'text' | 'select' | 'prefab' | 'color' | 'sprite' | 'sound' | 'tableRow';

/** One setting shown in the inspector. */
export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** For `tableRow`: the data table the row is picked from. */
  table?: string;
}

/** A named signal an object can send (output) or receive (input) over wires. */
export interface SignalSpec {
  name: string;
  label: string;
  help?: string;
}

/** When in the tick a behaviour runs: brains decide first, controls move things, sources make signals, logic combines them, actuators react. */
export type Phase = 'brain' | 'control' | 'source' | 'logic' | 'actuator';

export const PHASE_ORDER: Phase[] = ['brain', 'control', 'source', 'logic', 'actuator'];

export interface BehaviorDef<S extends object = Record<string, unknown>> {
  /** Component name the settings are stored under (also the id in saved files). */
  id: string;
  name: string;
  category: string;
  /** What it does, in plain English. */
  description: string;
  phase: Phase;
  /** Made and removed by the engine (echoes); not offered in the inspector's Add menu. */
  hidden?: boolean;
  /** Only carries settings (a custom component): there is nothing to run each tick. */
  dataOnly?: boolean;
  defaults: S;
  fields: FieldSpec[];
  inputs: SignalSpec[];
  outputs: SignalSpec[];
  /** Settings that are not simple fields have their own editor in the Inspector (a graph, for state machines). */
  editor?: 'stateMachine' | 'behaviorTree';
  /** Components that must exist for it to work, with the defaults to add when they are missing. */
  requires: Record<string, unknown>;
  /** Runs once per tick for every object that has this behaviour. */
  update(ctx: SimContext, entity: Entity, settings: S): void;
  /** A one-line plain-English summary of the current settings (shown under the fields). */
  summary?(settings: S): string;
}

const registry = new Map<string, BehaviorDef<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
/** Every behaviour ever defined, whether its pack is on or not (turning a pack back on takes them from here). */
const shelf = new Map<string, BehaviorDef<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any

/** A behaviour definition that is not registered by itself: a pack installs it. */
export function behaviorDef<S extends object>(def: BehaviorDef<S>): BehaviorDef<S> {
  return def;
}

/** Take a behaviour out of the registry AND the shelf (a custom block that was deleted). */
export function forgetBehavior(id: string): void {
  registry.delete(id);
  shelf.delete(id);
}

export function shelvedBehavior(id: string): BehaviorDef | undefined {
  return shelf.get(id);
}

/** Put a behaviour from the shelf back in the registry. False when there is none by that name. */
export function reshelveBehavior(id: string): boolean {
  const def = shelf.get(id);
  if (!def) return false;
  registry.set(id, def);
  return true;
}

/** Register a behaviour (done once at start-up for the built-ins; scripts may add their own later). */
export function defineBehavior<S extends object>(def: BehaviorDef<S>): BehaviorDef<S> {
  registry.set(def.id, def);
  shelf.set(def.id, def);
  return def;
}

/** Take a behaviour out of the registry (scripts being reloaded or deleted). */
export function undefineBehavior(id: string): void {
  registry.delete(id);
}

export function getBehavior(id: string): BehaviorDef | undefined {
  return registry.get(id);
}

export function behaviorList(): BehaviorDef[] {
  return [...registry.values()];
}

export function isBehavior(id: string): boolean {
  return registry.has(id);
}

/**
 * Runtime state a behaviour keeps between ticks (timers, "was pressed last tick", ...), stored on the object
 * next to its settings so it replays and saves with everything else. Never written to scene files.
 */
export function stateOf<T extends object>(e: Entity, id: string, init: () => T): T {
  const key = `state:${id}`;
  let s = e.get<T>(key);
  if (!s) {
    s = init();
    e.set(key, s);
  }
  return s;
}

/** Fill in settings that are missing (old scenes, hand-edited files) from the defaults. */
export function settingsOf<S extends object>(e: Entity, def: BehaviorDef<S>): S {
  const cur = e.get<Partial<S>>(def.id) ?? {};
  let changed = false;
  const out = cur as Record<string, unknown>;
  for (const [k, v] of Object.entries(def.defaults)) {
    if (out[k] === undefined) {
      out[k] = structuredClone(v);
      changed = true;
    }
  }
  if (changed) e.set(def.id, out);
  return out as S;
}

/** The system that runs every behaviour in one phase. */
export function behaviorPhase(phase: Phase): System {
  return (ctx) => {
    for (const def of registry.values()) {
      if (def.phase !== phase || def.dataOnly) continue;
      const prof = ctx.profiler;
      for (const e of ctx.world.query(def.id)) {
        if (!e.alive) continue;
        if (def.phase !== 'brain' && e.get<{ off: string[] }>('state:machineGate')?.off.includes(def.id)) continue; // a state machine has switched this behaviour off for now
        try {
          if (prof?.enabled) prof.behaviour(def.name, () => def.update(ctx, e, settingsOf(e, def)));
          else def.update(ctx, e, settingsOf(e, def));
        } catch (err) {
          if (err instanceof SystemError) throw err;
          throw new SystemError(`behaviours:${phase}`, err, e.id, `The ${def.name} behaviour on "${e.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  };
}

/** Add a behaviour to an object's component list (editor and spawners use this): defaults plus whatever it requires. */
export function attachBehavior(components: Record<string, unknown>, id: string): void {
  const def = registry.get(id);
  if (!def) throw new Error(`There is no behaviour called "${id}".`);
  if (components[id] === undefined) components[id] = structuredClone(def.defaults);
  for (const [name, defaults] of Object.entries(def.requires)) {
    if (components[name] === undefined) components[name] = structuredClone(defaults);
  }
}

export function detachBehavior(components: Record<string, unknown>, id: string): void {
  delete components[id];
}
