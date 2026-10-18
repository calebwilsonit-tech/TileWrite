import type { Entity, SimContext } from '@tilewright/runtime';
import { PHASE_ORDER, behaviorPhase } from './framework';
import { lightingSystem } from './builtins/light';

export const SIGNALS = 'signals';

/** On/off levels an object receives (inputs) and sends (outputs). Wires copy outputs to inputs. */
export interface Signals {
  inputs: Record<string, boolean>;
  outputs: Record<string, boolean>;
}

export function signalsOf(e: Entity): Signals {
  let s = e.get<Signals>(SIGNALS);
  if (!s) {
    s = { inputs: {}, outputs: {} };
    e.set(SIGNALS, s);
  }
  return s;
}

export function input(e: Entity, name: string): boolean {
  return signalsOf(e).inputs[name] === true;
}

export function output(e: Entity, name: string): boolean {
  return signalsOf(e).outputs[name] === true;
}

export function setOutput(e: Entity, name: string, on: boolean): void {
  signalsOf(e).outputs[name] = on;
}

export function setInput(e: Entity, name: string, on: boolean): void {
  signalsOf(e).inputs[name] = on;
}

const MAX_PASSES = 8;

/**
 * Copies outputs to inputs along the scene's wires (an input is ON if any wire feeding it is ON), then lets
 * logic nodes react, and repeats until nothing changes, so chains like plate -> AND -> gate settle in one tick.
 */
export function propagateSignals(ctx: SimContext): void {
  // pulses sent by the "send a signal" action last two ticks, then go off again
  const pulses = ctx.runtime.scratch.get('pulses') as { id: number; name: string; tick: number }[] | undefined;
  if (pulses && pulses.length > 0) {
    const keep = pulses.filter((p) => {
      if (ctx.tick < p.tick + 2) return true;
      const e = ctx.world.get(p.id);
      if (e) setInput(e, p.name, false);
      return false;
    });
    ctx.runtime.scratch.set('pulses', keep);
  }
  const wires = ctx.runtime.wires;
  const logic = behaviorPhase('logic');
  if (wires.length === 0) {
    logic(ctx);
    return;
  }
  const targets = new Map<string, { entity: Entity; input: string; sources: { entity: Entity; output: string }[] }>();
  for (const w of wires) {
    const from = ctx.world.get(ctx.runtime.ids.get(w.from.entity) ?? -1);
    const to = ctx.world.get(ctx.runtime.ids.get(w.to.entity) ?? -1);
    if (!from || !to) continue;
    const key = `${to.id}:${w.to.input}`;
    let t = targets.get(key);
    if (!t) targets.set(key, (t = { entity: to, input: w.to.input, sources: [] }));
    t.sources.push({ entity: from, output: w.from.output });
  }
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (const t of targets.values()) {
      const on = t.sources.some((s) => output(s.entity, s.output));
      const sig = signalsOf(t.entity);
      if (sig.inputs[t.input] !== on) {
        sig.inputs[t.input] = on;
        changed = true;
      }
    }
    if (!changed && pass > 0) break;
    logic(ctx);
    if (!changed) break;
  }
}

/** Run order of everything the behaviour framework adds to a simulation. */
export function behaviorSystems(): { name: string; fn: (ctx: SimContext) => void }[] {
  const out: { name: string; fn: (ctx: SimContext) => void }[] = [];
  for (const phase of PHASE_ORDER) {
    // logic nodes run inside the signal pass (they must settle together with the wires)
    if (phase === 'logic') out.push({ name: 'wires+logic', fn: propagateSignals });
    else out.push({ name: `behaviours:${phase}`, fn: behaviorPhase(phase) });
  }
  // lighting is rebuilt after the lights have decided whether they are on; sensors read it on the next tick
  out.push({ name: 'lighting', fn: lightingSystem });
  return out;
}
