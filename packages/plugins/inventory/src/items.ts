import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, type Assets, type VariableValue } from '@tilewright/plugin-sdk'; // (loading the runtime sets up Zod before the schemas below are built)
import type { DataKindDef } from '@tilewright/plugin-sdk';

/**
 * Items are plain data (`assets/items.json`). How many of each the player carries is stored in the scene's
 * variables as `item:<id>`, so flags, counters and inventory are one thing: they save, load, replay and show
 * up in event sheets with no special cases. Quick slots are the variables `slot:1` .. `slot:4` (an item id or "").
 */

export const ItemSchema = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, 'Item ids use letters, numbers, - and _'),
  name: z.string().min(1),
  description: z.string().default(''),
  /** 0xRRGGBB, used for the icon when the item has no drawing. */
  color: z.number().int().min(0).max(0xffffff).default(0xcccccc),
  /** Most the player can carry (0 = no limit). */
  max: z.number().int().min(0).default(0),
  /** What using it does (from a quick slot or the inventory screen). */
  use: z
    .object({
      heal: z.number().min(0).default(0),
      /** Variable to set when used (optional). */
      setVariable: z.string().default(''),
      setValue: z.union([z.number(), z.string(), z.boolean()]).default(1),
      /** Used up when used. */
      consume: z.boolean().default(true),
      message: z.string().default(''),
    })
    .optional(),
});
export type ItemData = z.infer<typeof ItemSchema>;

export const ItemsFileSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  items: z.array(ItemSchema).default([]),
});
export type ItemsFile = z.infer<typeof ItemsFileSchema>;

/** Every item the project defines, by id (what the running game reads). */
export function itemsOf(assets: Pick<Assets, 'data'>): ReadonlyMap<string, ItemData> {
  return (assets.data.get('items') ?? new Map()) as ReadonlyMap<string, ItemData>;
}

/** The project's items as a kind of data: their file, their checks, the words in them. The editor adds the tab that edits them. */
export const itemsKind: DataKindDef = {
  id: 'items',
  label: 'Items',
  blurb: 'Things the player can carry. Pick them up with a Pickup (item setting), receive them from conversations and cutscenes, and use them from the quick slots (1-4) or the inventory.',
  file: 'assets/items.json',
  listKey: 'items',
  noun: 'item',
  keyName: 'id',
  alwaysWritten: true,
  carries: true,
  schema: ItemSchema,
  keyOf: (i: ItemData) => i.id,
  create: (existing: readonly ItemData[]) => {
    let n = existing.length + 1;
    while (existing.some((i) => i.id === `item${n}`)) n++;
    return ItemSchema.parse({ id: `item${n}`, name: 'New item' });
  },
  texts: (i: ItemData) => [i.name, i.description, i.use?.message ?? ''].filter((t) => t.trim() !== '').map((text) => ({ text, where: `Item ${i.name}` })),
  assistant: { description: "Replace the project's whole item list (start from story_overview and send everything back, changed). An item has an id (letters, digits, - and _), a name, a description, a colour as a number, a carry limit and what using it does." },
};

export const QUICK_SLOTS = 4;
export const ITEM_PREFIX = 'item:';
export const SLOT_PREFIX = 'slot:';

type Vars = Record<string, VariableValue>;

export function itemCount(vars: Vars, id: string): number {
  const v = vars[ITEM_PREFIX + id];
  return typeof v === 'number' ? v : 0;
}

/** Everything the player carries, as [id, count] with count above zero. */
export function carried(vars: Vars): [string, number][] {
  const out: [string, number][] = [];
  for (const [k, v] of Object.entries(vars)) if (k.startsWith(ITEM_PREFIX) && typeof v === 'number' && v > 0) out.push([k.slice(ITEM_PREFIX.length), v]);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Add (or, with a negative amount, remove) items. Honours the item's carry limit when known.
 * Returns how many were actually added or removed (never below zero in the bag).
 */
export function addItem(vars: Vars, id: string, amount: number, def?: Pick<ItemData, 'max'>): number {
  const have = itemCount(vars, id);
  let next = have + amount;
  if (def && def.max > 0) next = Math.min(def.max, next);
  next = Math.max(0, next);
  if (next === 0) delete vars[ITEM_PREFIX + id];
  else vars[ITEM_PREFIX + id] = next;
  // a quick slot that no longer has its item becomes empty
  if (next === 0) for (let i = 1; i <= QUICK_SLOTS; i++) if (vars[SLOT_PREFIX + i] === id) vars[SLOT_PREFIX + i] = '';
  return next - have;
}

export function quickSlots(vars: Vars): string[] {
  return Array.from({ length: QUICK_SLOTS }, (_, i) => {
    const v = vars[SLOT_PREFIX + (i + 1)];
    return typeof v === 'string' ? v : '';
  });
}

export function assignSlot(vars: Vars, slot: number, id: string): void {
  if (slot < 1 || slot > QUICK_SLOTS) return;
  // an item sits in one slot at a time
  for (let i = 1; i <= QUICK_SLOTS; i++) if (vars[SLOT_PREFIX + i] === id) vars[SLOT_PREFIX + i] = '';
  vars[SLOT_PREFIX + slot] = id;
}

/** Put a newly picked up item in the first free quick slot (if there is one). */
export function autoSlot(vars: Vars, id: string): void {
  const slots = quickSlots(vars);
  if (slots.includes(id)) return;
  const free = slots.indexOf('');
  if (free >= 0) vars[SLOT_PREFIX + (free + 1)] = id;
}
