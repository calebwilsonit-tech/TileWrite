import { LAYER } from '@tilewright/runtime';
import { host } from './host';

/** The collision layers there are: the engine's own and those the plugins that are on added. A layer is a bit of the number a collider or body stores. */
export function collisionLayers(): Record<string, number> {
  const out: Record<string, number> = { default: LAYER.DEFAULT, player: LAYER.PLAYER, enemy: LAYER.ENEMY, prop: LAYER.PROP, ghost: LAYER.GHOST };
  for (const l of host.ext.collisionLayers.values()) out[l.name] = 1 << l.bit;
  return out;
}

/** The number of a layer by its name (undefined when there is none: the plugin that adds it is off). */
export function layerNamed(name: string): number | undefined {
  return collisionLayers()[name];
}
