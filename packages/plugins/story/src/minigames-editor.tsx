import { useState } from 'react';
import type { DataEditorProps } from '@tilewright/plugin-sdk';
import type { EditorUi } from '@tilewright/plugin-sdk/editor-ui';
import { MINIGAME_KINDS, checkMinigame, defaultInstructions, minigamesKind, newMinigame, type MinigameData, type MinigameKind } from './minigames';

/** Names are kept simple and portable (they are also used as file and variable names). */
function nameProblem(name: string, existing: readonly string[]): string | null {
  const n = name.trim();
  if (n.length === 0) return 'Give the minigame a name.';
  if (n.length > 40) return 'Minigame names can be at most 40 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(n)) return 'Use letters, numbers, spaces, - and _ in a minigame name, starting with a letter or number.';
  if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) return `A minigame called "${n}" already exists.`;
  return null;
}

/** The Minigames tab of the Story panel: the small games the project defines, how hard each is, and what winning gives. */
export function MinigamesEditor(props: DataEditorProps) {
  const { TextField, NumberField, CheckField, SelectField } = props.ui as EditorUi;
  const list = props.records as readonly MinigameData[];
  const [fresh, setFresh] = useState('');
  const [kind, setKind] = useState<MinigameKind>('timing');
  const update = (i: number, patch: Partial<MinigameData>): void => props.change(list.map((m, j) => (j === i ? ({ ...m, ...patch } as MinigameData) : m)));
  const create = (): void => {
    const problem = nameProblem(fresh, list.map((m) => m.name));
    if (problem) return props.notify('warn', problem);
    props.change([...list, newMinigame(kind, fresh.trim())]);
    setFresh('');
  };
  return (
    <div className="story-body" data-testid="minigames-tab">
      <p className="hint">{minigamesKind.blurb}</p>
      <div className="row">
        <input data-testid="minigame-new-name" placeholder="New minigame name" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <select data-testid="minigame-new-kind" value={kind} onChange={(e) => setKind(e.target.value as MinigameKind)}>
          {MINIGAME_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <button data-testid="minigame-new" onClick={create}>
          Create
        </button>
      </div>
      <p className="hint">{MINIGAME_KINDS.find((k) => k.kind === kind)?.blurb}</p>
      {list.map((m, i) => {
        const problems = checkMinigame(m, props.known);
        const id = m.name.replace(/[^A-Za-z0-9]+/g, '-');
        return (
          <fieldset key={m.name} className="story-card" data-testid={`minigame-${id}`}>
            <legend>
              {m.name} ({MINIGAME_KINDS.find((k) => k.kind === m.kind)?.label})
            </legend>
            <TextField label="Heading shown to the player" testId={`minigame-title-${id}`} value={m.title} placeholder={m.name} onCommit={(v) => update(i, { title: v })} />
            <TextField label="What to do" value={m.instructions} placeholder={defaultInstructions(m.kind)} onCommit={(v) => update(i, { instructions: v })} />
            {m.kind === 'timing' && (
              <>
                <NumberField label="Rounds to win" testId={`minigame-rounds-${id}`} value={m.rounds} min={1} max={12} step={1} onCommit={(v) => update(i, { rounds: Math.round(v) })} />
                <NumberField label="Width of the zone (0.05 - 0.6 of the bar)" value={m.zone} min={0.05} max={0.6} step={0.01} onCommit={(v) => update(i, { zone: v })} />
                <NumberField label="Speed of the marker" value={m.speed} min={0.2} max={4} step={0.1} onCommit={(v) => update(i, { speed: v })} />
                <CheckField label="The zone shrinks every round" value={m.shrink} onChange={(v) => update(i, { shrink: v })} />
                <NumberField label="Misses allowed" value={m.allowedMisses} min={0} max={9} step={1} onCommit={(v) => update(i, { allowedMisses: Math.round(v) })} />
              </>
            )}
            {m.kind === 'sequence' && (
              <>
                <NumberField label="Length of the pattern" testId={`minigame-length-${id}`} value={m.length} min={2} max={14} step={1} onCommit={(v) => update(i, { length: Math.round(v) })} />
                <NumberField label="Different arrows (2 - 4)" value={m.buttons} min={2} max={4} step={1} onCommit={(v) => update(i, { buttons: Math.round(v) })} />
                <NumberField label="Seconds each arrow is shown" value={m.showSeconds} min={0.15} max={2} step={0.05} onCommit={(v) => update(i, { showSeconds: v })} />
                <NumberField label="Mistakes allowed" value={m.allowedMistakes} min={0} max={9} step={1} onCommit={(v) => update(i, { allowedMistakes: Math.round(v) })} />
              </>
            )}
            {m.kind === 'pairs' && (
              <>
                <NumberField label="Pairs of cards" testId={`minigame-pairs-${id}`} value={m.pairs} min={2} max={10} step={1} onCommit={(v) => update(i, { pairs: Math.round(v) })} />
                <NumberField label="Wrong guesses allowed" value={m.allowedMisses} min={0} max={40} step={1} onCommit={(v) => update(i, { allowedMisses: Math.round(v) })} />
              </>
            )}
            <TextField label="Variable set to true when won (optional)" value={m.winVariable} onCommit={(v) => update(i, { winVariable: v.trim() })} />
            <TextField label="Variable that receives the score (optional)" value={m.scoreVariable} onCommit={(v) => update(i, { scoreVariable: v.trim() })} />
            <SelectField<string> label="Item given for the first win" value={m.rewardItem} options={[{ value: '', label: '(none)' }, ...props.carriedChoices]} onChange={(v) => update(i, { rewardItem: v })} />
            <CheckField label="The player may give up (Esc / P)" value={m.canQuit} onChange={(v) => update(i, { canQuit: v })} />
            {problems.map((p) => (
              <p key={p} className="hint warn">
                {p}
              </p>
            ))}
            <div className="row">
              <button data-testid={`minigame-test-${id}`} onClick={() => props.playWith({ action: 'playMinigame', params: { minigame: m.name } })}>
                Test in the game
              </button>
              <button className="small" onClick={() => props.change(list.filter((_, j) => j !== i))}>
                Delete minigame
              </button>
            </div>
          </fieldset>
        );
      })}
      {list.length === 0 && <p className="hint">No minigames yet.</p>}
    </div>
  );
}
