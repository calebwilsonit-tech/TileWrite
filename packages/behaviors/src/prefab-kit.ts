/** Small builders for the objects the Place tool puts down: a plain thing with a look and some behaviours, a solid collider, a walking body. Plugins use them for the prefabs they add. */
import type { EntityData } from '@tilewright/runtime';
import { attachBehavior } from './framework';

export interface Look {
  shape?: 'box' | 'diamond';
  color: number;
  w: number;
  d: number;
  height: number;
}

export function thing(name: string, tags: string[], look: Look, x: number, y: number, h: number, behaviours: string[] = [], extra: Record<string, unknown> = {}): Omit<EntityData, 'id'> {
  const components: Record<string, unknown> = {
    transform: { x, y, h, facing: 2 },
    sprite: { shape: look.shape ?? 'box', color: look.color, w: look.w, d: look.d, height: look.height, sortOffset: 0, visible: true },
    ...extra,
  };
  for (const b of behaviours) attachBehavior(components, b);
  return { name, tags, components };
}

export const solid = (w: number, d: number, height: number, layer = 16): Record<string, unknown> => ({
  collider: { w, d, height, solid: true, trigger: false, layer, mask: 65535, enabled: true, inside: [] },
});

/** A walking body on the enemy collision layer. */
export function enemyBody(radius = 0.3): Record<string, unknown> {
  return {
    body: {
      vx: 0, vy: 0, vz: 0, radius, height: 1.2, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false,
      gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null,
    },
  };
}
