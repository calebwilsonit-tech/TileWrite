import type { SimContext } from '../core/simulation';
import type { Entity } from '../scene/world';

/**
 * Things that change how bodies move before each step: wind, ice, a conveyor belt, a tide. A plugin adds one; the physics
 * asks every one for every body, in order, after behaviours have set the bodies' velocities and before the step is made.
 */
export interface PhysicsModifier {
  /** Unique (the plugin's id and the modifier's). */
  id: string;
  plugin: string;
  /** Lower runs first. */
  order: number;
  apply(ctx: SimContext, entity: Entity, body: Record<string, unknown>): void;
}

let modifiers: PhysicsModifier[] = [];

export function addPhysicsModifier(m: PhysicsModifier): void {
  modifiers = [...modifiers.filter((x) => x.id !== m.id), m].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function removePhysicsModifiersOf(plugin: string): void {
  modifiers = modifiers.filter((m) => m.plugin !== plugin);
}

/** The modifiers now, in the order they run. */
export function physicsModifiers(): readonly PhysicsModifier[] {
  return modifiers;
}
