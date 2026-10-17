import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_TILESET, generateCliffSet, generateEdgeSet, tilesetFromList, type AutotileRuleData, type TileDefData } from '@tilewright/runtime';
import { addGeneratedSet, baseTiles, checkRules, nextPatternChar, nextTileId, ownTiles, removeAutotile, variantsOf, withPatternChar } from '../project/tiles';
import { hexToNumber, numberToHex } from '../panels/fields';
import { store, useApp } from './store';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Where each of the eight neighbours sits in the 3x3 picture: N, NE, E, SE, S, SW, W, NW. */
const GRID: (number | null)[] = [7, 0, 1, 6, null, 2, 5, 4, 3];
const MEANING: Record<string, string> = {
  '*': 'any',
  '1': 'same tile',
  '0': 'something else',
  L: 'lower ground',
  H: 'higher ground',
};
const COLOUR: Record<string, string> = { '*': 'transparent', '1': '#2ec27e', '0': '#d55e00', L: '#56b4e9', H: '#f0e442' };
const POSITION = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

function Swatch({ t, size = 28 }: { t: TileDefData; size?: number }) {
  return (
    <svg viewBox="0 0 64 56" width={size} height={size * 0.875} aria-hidden="true">
      <polygon points="32,0 64,16 32,32 0,16" fill={hex(t.top)} />
      <polygon points="0,16 32,32 32,56 0,40" fill={hex(t.left)} />
      <polygon points="32,32 64,16 64,40 32,56" fill={hex(t.right)} />
      {t.rim && (t.rim.sides & 1) !== 0 && <line x1="32" y1="0" x2="64" y2="16" stroke={hex(t.rim.color)} strokeWidth="5" />}
      {t.rim && (t.rim.sides & 2) !== 0 && <line x1="64" y1="16" x2="32" y2="32" stroke={hex(t.rim.color)} strokeWidth="5" />}
      {t.rim && (t.rim.sides & 4) !== 0 && <line x1="0" y1="16" x2="32" y2="32" stroke={hex(t.rim.color)} strokeWidth="5" />}
      {t.rim && (t.rim.sides & 8) !== 0 && <line x1="32" y1="0" x2="0" y2="16" stroke={hex(t.rim.color)} strokeWidth="5" />}
    </svg>
  );
}

/**
 * Autotiling: pick a tile, make its edges and corners (or cliff faces) with one button, and edit the rules that choose
 * between them by clicking the eight squares around the tile. Changes are kept in a working copy until you save.
 */
export function AutotileDialog() {
  const project = useApp((s) => s.project);
  const [open, setOpen] = useState(false);
  const [tiles, setTiles] = useState<TileDefData[]>([]);
  const [rules, setRules] = useState<AutotileRuleData[]>([]);
  const [base, setBase] = useState(1);
  const [rim, setRim] = useState(0xffffff);
  const [rock, setRock] = useState(0x6b5b4b);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const show = (): void => {
      const p = store.state.project?.project;
      if (!p) return;
      const own = ownTiles(p);
      setTiles(structuredClone(own));
      setRules(structuredClone(p.autotile));
      setBase(baseTiles(own).find((t) => t.id === store.state.options.tile)?.id ?? baseTiles(own)[0]?.id ?? 1);
      setDirty(false);
      setOpen(true);
    };
    document.addEventListener('tw:autotile', show);
    return () => document.removeEventListener('tw:autotile', show);
  }, []);

  const set = useMemo(() => tilesetFromList(tiles) ?? DEFAULT_TILESET, [tiles]);
  const bases = baseTiles(tiles);
  const current = tiles.find((t) => t.id === base);
  const variants = variantsOf(tiles, base);
  const mine = rules.map((r, index) => ({ r, index })).filter((x) => x.r.base === base);
  const problems = useMemo(() => checkRules(tiles, rules), [tiles, rules]);
  if (!open || !project || !current) return null;

  const edit = (nextTiles: TileDefData[], nextRules: AutotileRuleData[]): void => {
    setTiles(nextTiles);
    setRules(nextRules);
    setDirty(true);
  };
  const addSet = (kind: 'edges' | 'cliff'): void => {
    if (variants.length > 0 && !window.confirm(`"${current.name}" already has variants. Add more anyway?`)) return;
    const first = nextTileId(tiles);
    const gen = kind === 'edges' ? generateEdgeSet(base, set, first, rim) : generateCliffSet(base, set, first, rock);
    const added = addGeneratedSet(tiles, rules, gen);
    // a cliff rule must not hide the edge rules (or the reverse): the ones added later go after the earlier ones
    edit(added.tiles, added.rules);
  };
  const updateRule = (index: number, patch: Partial<AutotileRuleData>): void => edit(tiles, rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const move = (index: number, by: number): void => {
    const to = index + by;
    if (to < 0 || to >= rules.length) return;
    const next = rules.slice();
    [next[index], next[to]] = [next[to]!, next[index]!];
    edit(tiles, next);
  };
  const setWall = (wall: boolean): void =>
    edit(
      tiles.map((t) => (t.id === base || t.group === base ? (wall ? { ...t, wall: true } : (({ wall: _w, ...rest }) => rest)(t)) : t)),
      rules,
    );
  const save = async (reapply: boolean): Promise<void> => {
    if (await store.updateTiles(tiles, rules, { reapply })) {
      setDirty(false);
      store.notify('info', reapply ? 'Saved the rules and applied them to this scene.' : 'Saved the tiles and rules.');
    }
  };
  const close = (): void => {
    if (dirty && !window.confirm('Close without saving your changes to the tiles and rules?')) return;
    setOpen(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="dialog wide autotile" role="dialog" aria-label="Autotiling" data-testid="autotile-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Autotiling</h2>
        <p className="hint">
          Paint with one tile and let the editor choose the look of each cell from what is around it: shores for water, edges for grass, cliff faces where the ground drops. The rules below decide which variant shows; the first rule that fits wins.
        </p>
        <div className="row">
          <label className="field">
            <span>Tile</span>
            <select data-testid="at-base" value={base} onChange={(e) => setBase(Number(e.target.value))}>
              {bases.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Swatch t={current} size={40} />
          <label className="field check">
            <input data-testid="at-wall" type="checkbox" checked={current.wall === true} onChange={(e) => setWall(e.target.checked)} />
            <span>Counts as a wall (the Walls layer can hide and lock it)</span>
          </label>
        </div>

        <h3>Variants of “{current.name}” ({variants.length})</h3>
        <div className="row wrap">
          <label className="field">
            <span>Edge colour</span>
            <input data-testid="at-rim" type="color" value={numberToHex(rim)} onChange={(e) => setRim(hexToNumber(e.target.value))} />
          </label>
          <button data-testid="at-gen-edges" onClick={() => addSet('edges')} title="30 variants: an outline on every side that borders something else, and a dot in corners where only the diagonal differs">
            Make edges and corners
          </button>
          <label className="field">
            <span>Rock colour</span>
            <input data-testid="at-rock" type="color" value={numberToHex(rock)} onChange={(e) => setRock(hexToNumber(e.target.value))} />
          </label>
          <button data-testid="at-gen-cliff" onClick={() => addSet('cliff')} title="3 variants that colour the camera-facing wall where the ground beside it is lower">
            Make cliff faces
          </button>
          <button
            data-testid="at-remove"
            disabled={variants.length === 0 && mine.length === 0}
            onClick={() => {
              const r = removeAutotile(tiles, rules, base);
              edit(r.tiles, r.rules);
            }}
          >
            Remove all variants and rules
          </button>
        </div>
        <div className="variant-strip" data-testid="at-variants">
          {variants.map((v) => (
            <span key={v.id} title={v.name}>
              <Swatch t={v} />
            </span>
          ))}
          {variants.length === 0 && <small>No variants yet. Make edges and corners to start.</small>}
        </div>

        <h3>Rules for “{current.name}” ({mine.length})</h3>
        <ol className="rule-list" data-testid="at-rules">
          {mine.map(({ r, index }, n) => (
            <li key={r.id} data-testid={`at-rule-${n}`}>
              <div className="rule-grid" role="group" aria-label={`Neighbours for rule ${n + 1}`}>
                {GRID.map((nb, g) =>
                  nb === null ? (
                    <span key={g} className="centre" title="the cell itself">
                      <Swatch t={current} size={22} />
                    </span>
                  ) : (
                    <button
                      key={g}
                      data-testid={`at-cell-${n}-${nb}`}
                      className="nb"
                      style={{ background: COLOUR[r.pattern[nb]!] }}
                      title={`${POSITION[nb]}: ${MEANING[r.pattern[nb]!]} (click to change)`}
                      onClick={() => updateRule(index, { pattern: withPatternChar(r.pattern, nb, nextPatternChar(r.pattern[nb]!)) })}
                    >
                      {r.pattern[nb] === '*' ? '' : r.pattern[nb]}
                    </button>
                  ),
                )}
              </div>
              <div className="rule-body">
                <input aria-label={`Name of rule ${n + 1}`} value={r.name} onChange={(e) => updateRule(index, { name: e.target.value })} />
                <label className="field">
                  <span>then show</span>
                  <select data-testid={`at-result-${n}`} value={r.result} onChange={(e) => updateRule(index, { result: Number(e.target.value) })}>
                    <option value={base}>{current.name} (plain)</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="row">
                  <button aria-label="Move rule earlier" disabled={index === 0} onClick={() => move(index, -1)}>
                    Up
                  </button>
                  <button aria-label="Move rule later" disabled={index === rules.length - 1} onClick={() => move(index, 1)}>
                    Down
                  </button>
                  <button aria-label="Delete rule" onClick={() => edit(tiles, rules.filter((_, i) => i !== index))}>
                    Delete
                  </button>
                </div>
              </div>
              <Swatch t={tiles.find((t) => t.id === r.result) ?? current} size={36} />
            </li>
          ))}
        </ol>
        <div className="row">
          <button
            data-testid="at-add-rule"
            onClick={() => edit(tiles, [...rules, { id: `rule-${Date.now().toString(36)}-${rules.length}`, name: 'New rule', base, pattern: '********', result: base }])}
          >
            Add a rule
          </button>
          <small>
            Click a square to cycle: any → <b>1</b> same tile → <b>0</b> something else → <b>L</b> lower ground → <b>H</b> higher ground. Empty cells and the edge of the map count as “something else” and “lower”.
          </small>
        </div>
        {problems.length > 0 && (
          <ul className="plain problems-list" data-testid="at-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="row end">
          <button onClick={close}>Close</button>
          <button data-testid="at-save" disabled={!dirty} onClick={() => void save(false)}>
            Save
          </button>
          <button className="primary" data-testid="at-apply" onClick={() => void save(true)} title="Save, then work out the look of every cell in the open scene again (one undo step)">
            Save and apply to this scene
          </button>
        </div>
      </div>
    </div>
  );
}
