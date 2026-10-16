import type { EntityData } from '@tilewright/runtime';
import { crateEntity, playerEntity } from '../project/templates';

export interface Prefab {
  id: string;
  label: string;
  hint: string;
  /** Build entity data (without an id) standing at (x, y) on a floor at height h. */
  make(x: number, y: number, h: number): Omit<EntityData, 'id'>;
}

function strip({ id: _id, ...rest }: EntityData): Omit<EntityData, 'id'> {
  return rest;
}

export const PREFABS: Prefab[] = [
  {
    id: 'player',
    label: 'Player start',
    hint: 'Where the player begins. A scene has one; placing another moves it.',
    make: (x, y, h) => withHeight(strip(playerEntity('', x, y)), h),
  },
  {
    id: 'crate',
    label: 'Crate',
    hint: 'A solid box. Blocks the player.',
    make: (x, y, h) => withHeight(strip(crateEntity('', x, y)), h),
  },
  {
    id: 'pillar',
    label: 'Pillar',
    hint: 'A tall solid column, good for walking behind.',
    make: (x, y, h) =>
      withHeight(
        {
          name: 'Pillar',
          tags: ['pillar'],
          components: {
            transform: { x, y, h: 0, facing: 2 },
            sprite: { shape: 'box', color: 0x8e7cc3, w: 0.7, d: 0.7, height: 2.6, sortOffset: 0, visible: true },
            collider: { w: 0.7, d: 0.7, height: 2.6, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] },
          },
        },
        h,
      ),
  },
  {
    id: 'marker',
    label: 'Marker',
    hint: 'An invisible-in-game point you can refer to later (spawn points, targets).',
    make: (x, y, h) =>
      withHeight(
        {
          name: 'Marker',
          tags: ['marker'],
          components: {
            transform: { x, y, h: 0, facing: 2 },
            sprite: { shape: 'diamond', color: 0x4ad1c8, w: 0.5, d: 0.5, height: 0.05, sortOffset: 0, visible: true },
          },
        },
        h,
      ),
  },
];

export function prefabById(id: string): Prefab {
  return PREFABS.find((p) => p.id === id) ?? PREFABS[1]!;
}

function withHeight(e: Omit<EntityData, 'id'>, h: number): Omit<EntityData, 'id'> {
  const t = e.components.transform as { h: number };
  t.h = h;
  return e;
}
