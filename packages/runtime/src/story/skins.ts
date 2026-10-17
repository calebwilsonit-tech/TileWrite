import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION, type VariableValue } from '../project/schema';
import { C } from '../scene/components';
import type { Entity } from '../scene/world';
import { ITEM_PREFIX } from './items';

/**
 * Cosmetic skins: other looks for the player character (a different colour, or a different drawn sprite) that the
 * player picks in Settings -> Appearance. Plain data in `assets/skins.json`. A skin can be there from the start or
 * unlock when a flag is set, a counter reaches a number or an item is carried.
 */

export const SkinUnlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }),
  z.object({ kind: z.literal('variable'), name: z.string().default(''), atLeast: z.number().default(1) }),
  z.object({ kind: z.literal('item'), item: z.string().default('') }),
]);
export type SkinUnlock = z.infer<typeof SkinUnlockSchema>;

export const SkinSchema = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, 'Skin ids use letters, numbers, - and _'),
  name: z.string().min(1),
  /** The colour of the character's body, when the skin is a plain shape (0xRRGGBB); -1 keeps the original. */
  color: z.number().int().min(-1).max(0xffffff).default(-1),
  /** A drawn sprite to use instead ('' keeps the original). */
  sprite: z.string().default(''),
  unlock: SkinUnlockSchema.default({ kind: 'always' }),
});
export type SkinData = z.infer<typeof SkinSchema>;

export const SkinsFileSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  skins: z.array(SkinSchema).default([]),
});

export function newSkin(id: string, name: string): SkinData {
  return { id, name, color: -1, sprite: '', unlock: { kind: 'always' } };
}

/** Whether the player can use a skin now. */
export function skinUnlocked(skin: SkinData, vars: Record<string, VariableValue>): boolean {
  const u = skin.unlock;
  switch (u.kind) {
    case 'always':
      return true;
    case 'variable': {
      const v = vars[u.name];
      const n = typeof v === 'number' ? v : v === true ? 1 : Number(v);
      return Number.isFinite(n) && n >= u.atLeast;
    }
    case 'item': {
      const n = vars[ITEM_PREFIX + u.item];
      return typeof n === 'number' && n > 0;
    }
  }
}

/** The skins the player may pick from, the original look first. */
export function availableSkins(skins: readonly SkinData[], vars: Record<string, VariableValue>): SkinData[] {
  return skins.filter((s) => skinUnlocked(s, vars));
}

interface OriginalLook {
  color?: number;
  asset?: string;
  animator?: string;
}

/**
 * Put a skin on an object (or, with undefined, its original look back). The original look is remembered on the object
 * (as `state:skin`, which is never saved) so "Default" can restore it. Returns whether anything changed.
 */
export function applySkin(e: Entity, skin: SkinData | undefined): boolean {
  const sprite = e.get<{ color?: number; asset?: string }>(C.Sprite);
  if (!sprite) return false;
  const animator = e.get<{ asset?: string }>('animator');
  let orig = e.get<OriginalLook>('state:skin');
  if (!orig) {
    orig = { color: sprite.color, asset: sprite.asset, animator: animator?.asset };
    e.set('state:skin', orig);
  }
  const color = skin && skin.color >= 0 ? skin.color : orig.color;
  const asset = skin && skin.sprite ? skin.sprite : orig.asset;
  let changed = false;
  if (sprite.color !== color) {
    sprite.color = color;
    changed = true;
  }
  if (sprite.asset !== asset) {
    sprite.asset = asset;
    changed = true;
  }
  if (animator) {
    const a = skin && skin.sprite ? skin.sprite : orig.animator;
    if (animator.asset !== a) {
      animator.asset = a;
      changed = true;
    }
  }
  return changed;
}