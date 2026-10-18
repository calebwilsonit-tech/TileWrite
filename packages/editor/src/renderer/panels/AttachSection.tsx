import type { Attach, EntityData } from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { attachmentSpot, attachmentSprites, type AttachFace } from '../tools/prefabs';
import { NumberField, SelectField } from './fields';

/** For an object fixed to a block face: slide it along the wall, move it up or down, turn it to another face, pick its pictures. */
export function AttachSection({ entity }: { entity: EntityData }) {
  useApp((s) => s.docVersion);
  const doc = store.doc;
  const a = entity.components.attach as Attach | undefined;
  if (!doc || !a || !a.cell) return null;
  const sprites = attachmentSprites();
  const set = (label: string, patch: Partial<Attach>): void =>
    doc.updateEntities([entity.id], label, (x) => {
      const cur = { ...(x.components.attach as Attach), ...patch };
      x.components.attach = cur;
      const top = doc.map.inBounds(cur.cell!.x, cur.cell!.y) ? doc.map.topHeight(cur.cell!.x, cur.cell!.y) : (cur.z ?? 0) + 1;
      const spot = attachmentSpot(cur.cell!, cur.face as AttachFace, cur.along ?? 0.5, cur.z ?? 0, top);
      Object.assign(x.components.transform as object, spot);
    });
  const options = [{ value: '', label: '(mirror the other one)' }, ...sprites.map((s) => ({ value: s.name, label: s.name }))];
  const wall = a.face !== 'top';
  const hasBlock = doc.map.inBounds(a.cell.x, a.cell.y) && doc.map.getTile(a.cell.x, a.cell.y) !== 0 && (a.face === 'top' || doc.map.topHeight(a.cell.x, a.cell.y) > (a.z ?? 0));
  return (
    <fieldset data-testid="insp-attach">
      <legend>Fixed to a block</legend>
      <p className="hint">
        On the cell {a.cell.x}, {a.cell.y}, level {a.z ?? 0}, {a.face === 'top' ? 'top' : `the ${a.face} face`}.
        {!hasBlock && ' There is no block there any more: this is floating. Delete it, or move it to a block that is there.'}
      </p>
      {wall && (
        <SelectField<string> testId="attach-face" label="Face" value={a.face} options={[{ value: '+x', label: 'east (+x)' }, { value: '-x', label: 'west (-x)' }, { value: '+y', label: 'south (+y)' }, { value: '-y', label: 'north (-y)' }]} onChange={(v) => set('Turn the attachment', { face: v as Attach['face'] })} />
      )}
      {wall && <NumberField testId="attach-along" label="Along the wall (0 to 1)" min={0.05} max={0.95} step={0.05} value={Math.round((a.along ?? 0.5) * 100) / 100} onCommit={(v) => set('Slide the attachment', { along: v })} />}
      <NumberField testId="attach-level" label="Level of the block it is on" min={0} max={40} step={1} value={a.z ?? 0} onCommit={(v) => set('Move the attachment', { z: Math.round(v) })} />
      <SelectField<string> testId="attach-left" label="Picture when it faces left" value={a.left} options={options} onChange={(v) => set('Change the picture', { left: v })} />
      <SelectField<string> testId="attach-right" label="Picture when it faces right" value={a.right} options={options} onChange={(v) => set('Change the picture', { right: v })} />
    </fieldset>
  );
}
