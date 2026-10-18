import { useState } from 'react';
import { store, useApp } from '../app/store';
import { readCell } from '../model/cells';
import { ownTiles } from '../project/tiles';
import { CLIPBOARD, clearEdits, fillEdits, hollowEdits, makeStructure, normalise, regionSize, replaceEdits, structureNameProblem, type Edit, type Region } from '../structures/structure';
import { NumberField, SelectField } from './fields';

/** Blocks by the box: copy, cut, fill, hollow, replace, delete, and save a region (with the objects in it) as a structure to place again. */
export function StructuresPanel() {
  useApp((s) => s.docVersion);
  const box = useApp((s) => s.blockBox);
  const names = useApp((s) => s.structureNames);
  const placing = useApp((s) => s.placing);
  const tile = useApp((s) => s.options.tile);
  const project = useApp((s) => s.project?.project);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [from, setFrom] = useState(0);
  const doc = store.doc;
  const tiles = project ? ownTiles(project).filter((t) => t.group === undefined) : [];
  if (!doc) return null;
  const tileName = (id: number): string => tiles.find((t) => t.id === id)?.name ?? `tile ${id}`;
  const cellAt = (x: number, y: number) => (doc.map.inBounds(x, y) ? readCell(doc.map, x, y) : null);
  const apply = (label: string, edits: Edit[], r: Region): void => {
    const refused = edits.filter((e) => Object.keys(e.patch(cellAt(e.x, e.y)!)).length === 0).length;
    doc.paint(label, edits);
    if (refused > 0) store.notify('warn', `${refused} cell${refused === 1 ? ' is' : 's are'} a stair, ramp or deck and was left alone.`);
    store.set({ blockBox: r });
  };
  const size = box ? regionSize(normalise(box)) : null;
  const copy = (cut: boolean): void => {
    if (!box) return;
    const s = makeStructure(CLIPBOARD, box, doc, cellAt);
    store.blockClipboard = s;
    store.set({ placing: { name: CLIPBOARD, turns: 0 }, tool: 'structure' });
    if (cut) apply('Cut blocks', clearEdits(box, project ? 1 : 1), box);
    store.notify('info', `${cut ? 'Cut' : 'Copied'} ${s.blocks.length} block${s.blocks.length === 1 ? '' : 's'}${s.entities.length ? ` and ${s.entities.length} object${s.entities.length === 1 ? '' : 's'}` : ''}. Click in the world to paste (R turns it).`);
  };
  const save = async (): Promise<void> => {
    if (!box) return;
    const p = structureNameProblem(name, names);
    setProblem(p ?? '');
    if (p) return;
    const s = makeStructure(name.trim(), box, doc, cellAt);
    if (s.blocks.length === 0) {
      setProblem('There are no blocks in the marked box.');
      return;
    }
    if (await store.addStructure(s)) {
      setName('');
      store.notify('info', `Saved the structure "${s.name}" (${s.blocks.length} blocks${s.entities.length ? `, ${s.entities.length} objects` : ''}). Pick it below and click in the world to place it.`);
    }
  };
  return (
    <div className="panel structures-panel" data-testid="structures-panel">
      <h4>The marked box</h4>
      {!box || !size ? (
        <p className="hint" data-testid="structures-nobox">
          Choose the Box select tool (Blocks group) and drag across the ground. The levels it covers are set in the tool options.
        </p>
      ) : (
        <>
          <p data-testid="structures-box">
            {size.w} x {size.d} cells, levels {normalise(box).z0} to {normalise(box).z1} ({size.w * size.d * size.h} spots).
          </p>
          <div className="row wrap">
            <NumberField testId="box-z0" label="From level" min={0} max={40} value={normalise(box).z0} onCommit={(v) => store.set({ blockBox: { ...normalise(box), z0: Math.min(v, normalise(box).z1) } })} />
            <NumberField testId="box-z1" label="To level" min={0} max={40} value={normalise(box).z1} onCommit={(v) => store.set({ blockBox: { ...normalise(box), z1: Math.max(v, normalise(box).z0) } })} />
          </div>
          <div className="row wrap">
            <button data-testid="box-copy" onClick={() => copy(false)}>
              Copy
            </button>
            <button data-testid="box-cut" onClick={() => copy(true)}>
              Cut
            </button>
            <button data-testid="box-fill" title="Fill the whole box with blocks of the chosen tile" onClick={() => apply('Fill the box', fillEdits(box, tile), box)}>
              Fill with {tileName(tile)}
            </button>
            <button data-testid="box-hollow" title="Empty the inside, leaving a shell one block thick" onClick={() => apply('Hollow out', hollowEdits(box, 1), box)}>
              Hollow out
            </button>
            <button data-testid="box-clear" onClick={() => apply('Remove blocks', clearEdits(box, 1), box)}>
              Remove the blocks
            </button>
          </div>
          <div className="row wrap">
            <SelectField<number> testId="box-replace-from" label="Replace" value={from || (tiles[0]?.id ?? 0)} options={tiles.map((t) => ({ value: t.id, label: t.name }))} onChange={setFrom} />
            <button data-testid="box-replace" onClick={() => apply('Replace blocks', replaceEdits(box, from || (tiles[0]?.id ?? 0), tile), box)}>
              with {tileName(tile)}
            </button>
          </div>
          <div className="row">
            <input data-testid="structure-name" aria-label="Structure name" placeholder="Name: house, ruin, bridge..." value={name} onChange={(e) => setName(e.target.value)} />
            <button className="primary" data-testid="structure-save" onClick={() => void save()}>
              Save as a structure
            </button>
          </div>
          {problem && <p className="warn-text">{problem}</p>}
          <p className="hint">A structure keeps the blocks (with their faces and gaps) and the objects inside the box, windows and torches included.</p>
        </>
      )}
      <h4>Saved structures</h4>
      {names.length === 0 && !store.blockClipboard && <p className="hint">None yet.</p>}
      <ul className="structure-list" data-testid="structure-list">
        {store.blockClipboard && (
          <li>
            <button data-testid="structure-clipboard" className={placing?.name === CLIPBOARD ? 'on' : ''} onClick={() => store.set({ placing: { name: CLIPBOARD, turns: 0 }, tool: 'structure' })}>
              The copy ({store.blockClipboard.w} x {store.blockClipboard.d} x {store.blockClipboard.h})
            </button>
          </li>
        )}
        {names.map((n) => {
          const s = store.structures.get(n);
          return (
            <li key={n}>
              <button data-testid={`structure-${n}`} className={placing?.name === n ? 'on' : ''} onClick={() => store.set({ placing: { name: n, turns: 0 }, tool: 'structure' })} title="Click, then click in the world to place it (R turns it)">
                {n} {s ? `(${s.w} x ${s.d} x ${s.h}, ${s.blocks.length} blocks${s.entities.length ? `, ${s.entities.length} objects` : ''})` : ''}
              </button>
              <button aria-label={`Delete ${n}`} onClick={() => void store.removeStructure(n)}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      {placing && (
        <p className="hint" data-testid="structure-placing">
          Placing “{placing.name === CLIPBOARD ? 'the copy' : placing.name}”, turned {placing.turns * 90}°. Click in the world; R turns it.{' '}
          <button onClick={() => store.set({ placing: null })}>Stop</button>
        </p>
      )}
    </div>
  );
}
