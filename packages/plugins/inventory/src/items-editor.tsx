import type { DataEditorProps } from '@tilewright/plugin-sdk';
import type { EditorUi } from '@tilewright/plugin-sdk/editor-ui';
import { ItemSchema, itemsKind, type ItemData } from './items';

/** The Items tab of the Story panel: every item the project defines, with what it looks like and what using it does. */
export function ItemsEditor(props: DataEditorProps) {
  const { TextField, NumberField, CheckField, numberToHex, hexToNumber } = props.ui as EditorUi;
  const items = props.records as readonly ItemData[];
  const update = (i: number, patch: Partial<ItemData>): void => props.change(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div className="story-body">
      <p className="hint">{itemsKind.blurb}</p>
      {items.map((it, i) => (
        <fieldset key={i} className="story-card" data-testid={`item-${it.id}`}>
          <legend>{it.name}</legend>
          <TextField
            label="Id (used in dialogues and event rows)"
            testId={`item-id-${i}`}
            value={it.id}
            onCommit={(v) => (ItemSchema.shape.id.safeParse(v).success && !items.some((o, j) => j !== i && o.id === v) ? update(i, { id: v }) : props.notify('warn', 'Item ids use letters, numbers, - and _, and each must be different.'))}
          />
          <TextField label="Name" testId={`item-name-${i}`} value={it.name} onCommit={(v) => update(i, { name: v || it.name })} />
          <TextField label="Description" value={it.description} onCommit={(v) => update(i, { description: v })} />
          <label className="field">
            <span>Colour</span>
            <input type="color" value={numberToHex(it.color)} onChange={(e) => update(i, { color: hexToNumber(e.target.value) })} />
          </label>
          <NumberField label="Most you can carry (0 = no limit)" value={it.max} min={0} step={1} onCommit={(v) => update(i, { max: Math.round(v) })} />
          <CheckField label="Can be used" testId={`item-usable-${i}`} value={!!it.use} onChange={(on) => update(i, { use: on ? ItemSchema.shape.use.unwrap().parse({}) : undefined })} />
          {it.use && (
            <div className="story-sub">
              <NumberField label="Heals (hit points)" testId={`item-heal-${i}`} value={it.use.heal} min={0} step={1} onCommit={(v) => update(i, { use: { ...it.use!, heal: v } })} />
              <TextField label="Sets this variable when used (optional)" value={it.use.setVariable} onCommit={(v) => update(i, { use: { ...it.use!, setVariable: v } })} />
              <TextField label="Message when used" value={it.use.message} onCommit={(v) => update(i, { use: { ...it.use!, message: v } })} />
              <CheckField label="Used up when used" value={it.use.consume} onChange={(v) => update(i, { use: { ...it.use!, consume: v } })} />
            </div>
          )}
          <button className="small" onClick={() => props.change(items.filter((_, j) => j !== i))}>
            Delete item
          </button>
        </fieldset>
      ))}
      <button data-testid="item-add" onClick={() => props.change([...items, itemsKind.create(items)])}>
        Add an item
      </button>
    </div>
  );
}
