import type { SimContext, Simulation } from '@tilewright/runtime';
import { TICK_DT } from '@tilewright/runtime';

/** A system context for code that runs between ticks (menus, the game host): same data the systems see. */
export function contextOf(sim: Simulation): SimContext {
  return {
    world: sim.world,
    input: sim.input,
    uiInput: sim.uiInput,
    rng: sim.rng,
    events: sim.events,
    tweens: sim.tweens,
    assets: sim.assets,
    runtime: sim.runtime,
    map: sim.map,
    modal: sim.modal,
    dt: TICK_DT,
    tick: sim.tick,
    compat: sim.compat,
  };
}
