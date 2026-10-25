import type { EventRow, ProblemDef, ValidatorDef } from '@tilewright/plugin-sdk';

function* rowsOf(rows: readonly EventRow[]): Generator<EventRow> {
  for (const r of rows) {
    yield r;
    yield* rowsOf(r.children);
  }
}

/** Pickups and event rows that name an item the project does not have. */
export const inventoryChecks: ValidatorDef = {
  id: 'inventory',
  check(scene, project) {
    if (!project) return [];
    const items = project.data.ids('items');
    const out: ProblemDef[] = [];
    for (const e of scene.entities) {
      const pickup = e.components.pickup as { item?: string } | undefined;
      if (pickup?.item && !items.has(pickup.item)) out.push({ id: `pickup-item-${e.id}`, severity: 'error', entity: e.id, message: `"${e.name}" gives the item "${pickup.item}", which is not in the Items list.` });
    }
    for (const row of rowsOf(scene.events)) {
      for (const a of row.actions) {
        if ((a.type === 'giveItem' || a.type === 'takeItem') && !items.has(String(a.params.item ?? ''))) out.push({ id: `row-${row.id}-item`, severity: 'warning', message: `An event row uses the item "${String(a.params.item ?? '')}", which is not in the Items list.` });
      }
    }
    return out;
  },
};
