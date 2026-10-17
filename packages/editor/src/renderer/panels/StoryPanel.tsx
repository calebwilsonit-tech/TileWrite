import { useState, type ReactElement } from 'react';
import {
  CUTSCENE_STEP_LABELS,
  CutsceneStepSchema,
  ItemSchema,
  checkCutscene,
  checkDialogue,
  newCutscene,
  newDialogue,
  newSkin,
  type SkinData,
  type CutsceneData,
  type CutsceneStep,
  type DialogueCondition,
  type DialogueData,
  type DialogueNode,
  type ItemData,
} from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { useStudio } from '../studio/store';
import { storyNameProblem } from '../project/story';
import { SoundField } from './SoundField';
import { DialogueGraph } from './DialogueGraph';
import { CutsceneTimeline } from './CutsceneTimeline';
import { connect, linkTarget, nodeHeight, portsOf, spotForNew } from '../model/dialogue-graph';
import { CheckField, NumberField, SelectField, TextField, hexToNumber, numberToHex } from './fields';

type Tab = 'items' | 'dialogues' | 'cutscenes' | 'skins';

export function StoryPanel() {
  useApp((s) => s.storyVersion);
  const [tab, setTab] = useState<Tab>('items');
  return (
    <div className="story-panel" data-testid="story-panel">
      <div className="seg" role="tablist">
        {(['items', 'dialogues', 'cutscenes', 'skins'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} data-testid={`story-tab-${t}`} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="row">
        <button data-testid="btn-translations" onClick={() => document.dispatchEvent(new CustomEvent('tw:translations'))} title="Add languages and translate every line of text">
          Translations…
        </button>
      </div>
      {tab === 'items' && <ItemsTab />}
      {tab === 'dialogues' && <DialoguesTab />}
      {tab === 'cutscenes' && <CutscenesTab />}
      {tab === 'skins' && <SkinsTab />}
    </div>
  );
}

// ---------- items ----------

function ItemsTab() {
  const items = store.story.items;
  const update = (i: number, patch: Partial<ItemData>): void => store.setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const add = (): void => {
    let n = items.length + 1;
    while (items.some((i) => i.id === `item${n}`)) n++;
    store.setItems([...items, ItemSchema.parse({ id: `item${n}`, name: 'New item' })]);
  };
  return (
    <div className="story-body">
      <p className="hint">Things the player can carry. Pick them up with a Pickup (item setting), receive them from conversations and cutscenes, and use them from the quick slots (1-4) or the inventory.</p>
      {items.map((it, i) => (
        <fieldset key={i} className="story-card" data-testid={`item-${it.id}`}>
          <legend>{it.name}</legend>
          <TextField label="Id (used in dialogues and event rows)" testId={`item-id-${i}`} value={it.id} onCommit={(v) => ItemSchema.shape.id.safeParse(v).success && !items.some((o, j) => j !== i && o.id === v) ? update(i, { id: v }) : store.notify('warn', 'Item ids use letters, numbers, - and _, and each must be different.')} />
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
          <button className="small" onClick={() => store.setItems(items.filter((_, j) => j !== i))}>Delete item</button>
        </fieldset>
      ))}
      <button data-testid="item-add" onClick={add}>
        Add an item
      </button>
    </div>
  );
}

// ---------- dialogues ----------

const NODE_TYPES: { value: DialogueNode['type']; label: string }[] = [
  { value: 'line', label: 'Someone says a line' },
  { value: 'choice', label: 'The player chooses' },
  { value: 'set', label: 'Set a variable (flag, counter)' },
  { value: 'give', label: 'Give or take an item' },
  { value: 'branch', label: 'Branch on a condition' },
  { value: 'end', label: 'End the conversation' },
];

function freshNode(d: DialogueData, type: DialogueNode['type']): DialogueNode {
  let n = d.nodes.length + 1;
  while (d.nodes.some((x) => x.id === `n${n}`)) n++;
  const id = `n${n}`;
  switch (type) {
    case 'line':
      return { id, type, speaker: '', text: '' };
    case 'choice':
      return { id, type, speaker: '', prompt: '', options: [{ text: 'Option 1' }, { text: 'Option 2' }] };
    case 'set':
      return { id, type, variable: '', op: 'set', value: 1 };
    case 'give':
      return { id, type, item: '', amount: 1 };
    case 'branch':
      return { id, type, if: { kind: 'variable', name: '', op: '>=', value: 1 } };
    default:
      return { id, type: 'end' };
  }
}

function parseValue(raw: string): number | string | boolean {
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

function DialoguesTab() {
  const dialogues = [...store.story.dialogues.values()].sort((a, b) => a.name.localeCompare(b.name));
  const [name, setName] = useState<string>('');
  const [fresh, setFresh] = useState('');
  const d = store.story.dialogues.get(name) ?? dialogues[0];
  const create = (): void => {
    const problem = storyNameProblem(fresh, dialogues.map((x) => x.name), 'dialogue');
    if (problem) return store.notify('warn', problem);
    store.putDialogue(newDialogue(fresh.trim()));
    setName(fresh.trim());
    setFresh('');
  };
  return (
    <div className="story-body">
      <p className="hint">Conversations: lines, choices (some only when a condition holds), setting flags, giving items, and branches. Put one on an NPC with the NPC Talk behaviour.</p>
      <div className="row">
        <input data-testid="dialogue-new-name" placeholder="New dialogue name" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button data-testid="dialogue-new" onClick={create}>
          Create
        </button>
      </div>
      {dialogues.length > 0 && (
        <SelectField<string> label="Editing" testId="dialogue-select" value={d?.name ?? ''} options={dialogues.map((x) => ({ value: x.name, label: x.name }))} onChange={setName} />
      )}
      {d && <DialogueEditor key={d.name} d={d} onDeleted={() => setName('')} />}
    </div>
  );
}

function DialogueEditor({ d, onDeleted }: { d: DialogueData; onDeleted(): void }) {
  const items = store.story.items;
  const [mode, setMode] = useState<'list' | 'graph'>(() => {
    try {
      return localStorage.getItem('tw.dialogueView') === 'graph' ? 'graph' : 'list';
    } catch {
      return 'list';
    }
  });
  const [sel, setSel] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const chooseMode = (m: 'list' | 'graph'): void => {
    setMode(m);
    try {
      localStorage.setItem('tw.dialogueView', m);
    } catch {
      /* the choice just is not remembered */
    }
  };
  const known = { items: new Set(items.map((i) => i.id)), variables: new Set<string>() };
  const problems = checkDialogue(d, known);
  const put = (next: DialogueData): void => store.putDialogue(next);
  const setNode = (i: number, node: DialogueNode): void => put({ ...d, nodes: d.nodes.map((n, j) => (j === i ? node : n)) });
  const targets = [{ value: '', label: '(end the conversation)' }, ...d.nodes.map((n) => ({ value: n.id, label: `${n.id}: ${describeNode(n)}` }))];
  const move = (i: number, by: number): void => {
    const nodes = [...d.nodes];
    const j = i + by;
    if (j < 0 || j >= nodes.length) return;
    [nodes[i], nodes[j]] = [nodes[j]!, nodes[i]!];
    put({ ...d, nodes });
  };
  return (
    <div data-testid="dialogue-editor" className={mode === 'graph' && big ? 'dg-overlay' : ''}>
      <SelectField<string> label="Starts at" testId="dialogue-start" value={d.start} options={[{ value: '', label: '(choose)' }, ...d.nodes.map((n) => ({ value: n.id, label: `${n.id}: ${describeNode(n)}` }))]} onChange={(v) => put({ ...d, start: v })} />
      <div className="seg" role="group" aria-label="How to show the conversation">
        <button className={mode === 'list' ? 'on' : ''} data-testid="dialogue-view-list" aria-pressed={mode === 'list'} onClick={() => chooseMode('list')}>
          List
        </button>
        <button className={mode === 'graph' ? 'on' : ''} data-testid="dialogue-view-graph" aria-pressed={mode === 'graph'} onClick={() => chooseMode('graph')}>
          Graph
        </button>
        {mode === 'graph' && (
          <button data-testid="dg-big" aria-pressed={big} onClick={() => setBig(!big)} title="Fill the window with the conversation, for more room">
            {big ? 'Back to the panel' : 'Make it bigger'}
          </button>
        )}
      </div>
      {mode === 'graph' && <DialogueGraph d={d} selected={sel} onSelect={setSel} onChange={put} />}
      {d.nodes.map((n, i) => (mode === 'graph' && n.id !== sel ? null : (
        <fieldset key={n.id} className="story-card" data-testid={`dnode-${n.id}`}>
          <legend>
            {n.id} - {NODE_TYPES.find((t) => t.value === n.type)?.label}
          </legend>
          <NodeFields n={n} targets={targets} onChange={(node) => setNode(i, node)} />
          <div className="row">
            <button className="small" onClick={() => move(i, -1)} aria-label="Move up">
              Up
            </button>
            <button className="small" onClick={() => move(i, 1)} aria-label="Move down">
              Down
            </button>
            <button className="small" onClick={() => put({ ...d, nodes: d.nodes.filter((_, j) => j !== i), start: d.start === n.id ? '' : d.start })}>
              Delete step
            </button>
          </div>
        </fieldset>
      )))}
      <div className="row wrap">
        {NODE_TYPES.map((t) => (
          <button
            key={t.value}
            className="small"
            data-testid={`dnode-add-${t.value}`}
            onClick={() => {
              const node = freshNode(d, t.value);
              if (mode === 'graph') {
                // in the graph a new card goes under the others, and joins the selected card's first free link
                const spot = spotForNew(d, sel ?? undefined, nodeHeight(node));
                const placed = { ...node, ...spot } as DialogueNode;
                let next = { ...d, nodes: [...d.nodes, placed], start: d.start === '' || d.nodes.length === 0 ? placed.id : d.start };
                const from = d.nodes.find((n) => n.id === sel);
                const free = from ? portsOf(from).find((p) => !linkTarget(from, p)) : undefined;
                if (from && free) next = connect(next, from.id, free, placed.id);
                put(next);
                setSel(placed.id);
                return;
              }
              // a new step joins the end of the chain: the previous step (if it has a "next") now goes to it
              const nodes = [...d.nodes];
              const last = nodes[nodes.length - 1];
              if (last && (last.type === 'line' || last.type === 'set' || last.type === 'give') && !last.next) nodes[nodes.length - 1] = { ...last, next: node.id };
              put({ ...d, nodes: [...nodes, node], start: d.start === '' || d.nodes.length === 0 ? node.id : d.start });
            }}
          >
            + {t.label}
          </button>
        ))}
      </div>
      {problems.length > 0 ? (
        <ul className="story-problems" data-testid="dialogue-problems">
          {problems.map((p, i) => (
            <li key={i}>{p.text}</li>
          ))}
        </ul>
      ) : (
        <p className="hint ok" data-testid="dialogue-ok">
          No problems found.
        </p>
      )}
      <div className="row">
        <button
          data-testid="dialogue-test"
          onClick={() => {
            void store.flushStory().then(() => {
              store.autoPlay = { dialogue: d.name };
              store.play();
            });
          }}
        >
          Test in the game
        </button>
        <button
          className="small"
          onClick={() => {
            void store.removeDialogue(d.name).then(onDeleted);
          }}
        >
          Delete dialogue
        </button>
      </div>
    </div>
  );
}

function describeNode(n: DialogueNode): string {
  switch (n.type) {
    case 'line':
      return n.text ? `"${n.text.slice(0, 28)}${n.text.length > 28 ? '...' : ''}"` : '(empty line)';
    case 'choice':
      return `choice of ${n.options.length}`;
    case 'set':
      return `set ${n.variable || '(variable)'}`;
    case 'give':
      return `${n.amount >= 0 ? 'give' : 'take'} ${n.item || '(item)'}`;
    case 'branch':
      return 'branch';
    default:
      return 'end';
  }
}

type TargetOptions = { value: string; label: string }[];

function ConditionFields({ c, onChange }: { c: DialogueCondition; onChange(c: DialogueCondition): void }) {
  const items = store.story.items;
  return (
    <div className="story-sub">
      <SelectField<'variable' | 'item'>
        label="Checks"
        value={c.kind}
        options={[
          { value: 'variable', label: 'a variable' },
          { value: 'item', label: 'an item the player carries' },
        ]}
        onChange={(k) => onChange(k === 'item' ? { kind: 'item', item: items[0]?.id ?? '', atLeast: 1 } : { kind: 'variable', name: '', op: '>=', value: 1 })}
      />
      {c.kind === 'variable' ? (
        <>
          <TextField label="Variable" value={c.name} onCommit={(v) => onChange({ ...c, name: v })} />
          <SelectField<string>
            label="Is"
            value={c.op}
            options={['=', '!=', '>', '>=', '<', '<='].map((o) => ({ value: o, label: o }))}
            onChange={(o) => onChange({ ...c, op: o as typeof c.op })}
          />
          <TextField label="Value" value={String(c.value)} onCommit={(v) => onChange({ ...c, value: parseValue(v) })} />
        </>
      ) : (
        <>
          <SelectField<string> label="Item" value={c.item} options={[{ value: '', label: '(choose)' }, ...items.map((i) => ({ value: i.id, label: i.name }))]} onChange={(v) => onChange({ ...c, item: v })} />
          <NumberField label="At least how many" value={c.atLeast} min={1} step={1} onCommit={(v) => onChange({ ...c, atLeast: v })} />
        </>
      )}
    </div>
  );
}

function NodeFields({ n, targets, onChange }: { n: DialogueNode; targets: TargetOptions; onChange(n: DialogueNode): void }) {
  const items = store.story.items;
  const next = (value: string | undefined, apply: (v: string | undefined) => DialogueNode, label = 'Then go to'): ReactElement => (
    <SelectField<string> label={label} value={value ?? ''} options={targets.filter((t) => t.value !== n.id)} onChange={(v) => onChange(apply(v === '' ? undefined : v))} />
  );
  switch (n.type) {
    case 'line':
      return (
        <>
          <TextField label="Who speaks" testId={`dn-speaker-${n.id}`} value={n.speaker} onCommit={(v) => onChange({ ...n, speaker: v })} />
          <TextField label="What they say (use {variable} to show a value)" testId={`dn-text-${n.id}`} value={n.text} onCommit={(v) => onChange({ ...n, text: v })} />
          {next(n.next, (v) => ({ ...n, next: v }))}
        </>
      );
    case 'choice':
      return (
        <>
          <TextField label="Who asks" value={n.speaker} onCommit={(v) => onChange({ ...n, speaker: v })} />
          <TextField label="The question" testId={`dn-prompt-${n.id}`} value={n.prompt} onCommit={(v) => onChange({ ...n, prompt: v })} />
          {n.options.map((o, i) => (
            <div key={i} className="story-sub" data-testid={`dn-option-${n.id}-${i}`}>
              <TextField label={`Option ${i + 1}`} testId={`dn-option-text-${n.id}-${i}`} value={o.text} onCommit={(v) => onChange({ ...n, options: n.options.map((x, j) => (j === i ? { ...x, text: v } : x)) })} />
              <SelectField<string>
                label="Goes to"
                testId={`dn-option-next-${n.id}-${i}`}
                value={o.next ?? ''}
                options={targets.filter((t) => t.value !== n.id)}
                onChange={(v) => onChange({ ...n, options: n.options.map((x, j) => (j === i ? { ...x, next: v === '' ? undefined : v } : x)) })}
              />
              <CheckField label="Only shown when a condition holds" value={!!o.if} onChange={(on) => onChange({ ...n, options: n.options.map((x, j) => (j === i ? { ...x, if: on ? ({ kind: 'item', item: items[0]?.id ?? '', atLeast: 1 } as DialogueCondition) : undefined } : x)) })} />
              {o.if && <ConditionFields c={o.if} onChange={(c) => onChange({ ...n, options: n.options.map((x, j) => (j === i ? { ...x, if: c } : x)) })} />}
              <button className="small" onClick={() => onChange({ ...n, options: n.options.filter((_, j) => j !== i) })}>
                Remove option
              </button>
            </div>
          ))}
          <button className="small" data-testid={`dn-add-option-${n.id}`} onClick={() => onChange({ ...n, options: [...n.options, { text: `Option ${n.options.length + 1}` }] })}>
            Add an option
          </button>
        </>
      );
    case 'set':
      return (
        <>
          <TextField label="Variable" testId={`dn-var-${n.id}`} value={n.variable} onCommit={(v) => onChange({ ...n, variable: v })} />
          <SelectField<'set' | 'add' | 'toggle'>
            label="Do"
            value={n.op}
            options={[
              { value: 'set', label: 'set it to' },
              { value: 'add', label: 'add' },
              { value: 'toggle', label: 'flip it (true / false)' },
            ]}
            onChange={(op) => onChange({ ...n, op })}
          />
          {n.op !== 'toggle' && <TextField label="Value" testId={`dn-value-${n.id}`} value={String(n.value)} onCommit={(v) => onChange({ ...n, value: parseValue(v) })} />}
          {next(n.next, (v) => ({ ...n, next: v }))}
        </>
      );
    case 'give':
      return (
        <>
          <SelectField<string> label="Item" testId={`dn-item-${n.id}`} value={n.item} options={[{ value: '', label: '(choose)' }, ...items.map((i) => ({ value: i.id, label: i.name }))]} onChange={(v) => onChange({ ...n, item: v })} />
          <NumberField label="How many (negative takes away)" value={n.amount} step={1} onCommit={(v) => onChange({ ...n, amount: v })} />
          {next(n.next, (v) => ({ ...n, next: v }))}
        </>
      );
    case 'branch':
      return (
        <>
          <ConditionFields c={n.if} onChange={(c) => onChange({ ...n, if: c })} />
          {next(n.then, (v) => ({ ...n, then: v }), 'If yes, go to')}
          {next(n.else, (v) => ({ ...n, else: v }), 'If no, go to')}
        </>
      );
    default:
      return <p className="hint">The conversation closes here.</p>;
  }
}

// ---------- cutscenes ----------

type FieldKind = 'text' | 'number' | 'colour' | 'dialogue' | 'item' | 'value' | 'sound';
interface StepField {
  key: string;
  label: string;
  kind: FieldKind;
  step?: number;
}

const STEP_FIELDS: Record<CutsceneStep['type'], StepField[]> = {
  wait: [{ key: 'seconds', label: 'Seconds', kind: 'number', step: 0.1 }],
  waitInput: [],
  say: [{ key: 'speaker', label: 'Who speaks', kind: 'text' }, { key: 'text', label: 'What they say', kind: 'text' }],
  dialogue: [{ key: 'dialogue', label: 'Dialogue', kind: 'dialogue' }],
  cameraTo: [{ key: 'target', label: 'Look at (player, name:Keeper, tag:..., id:..., or x,y)', kind: 'text' }, { key: 'seconds', label: 'Seconds to get there', kind: 'number', step: 0.1 }, { key: 'zoom', label: 'Zoom', kind: 'number', step: 0.25 }],
  cameraReset: [{ key: 'seconds', label: 'Seconds', kind: 'number', step: 0.1 }],
  move: [{ key: 'who', label: 'Who (player, name:..., tag:..., id:...)', kind: 'text' }, { key: 'to', label: 'Walk to (a reference or x,y)', kind: 'text' }, { key: 'speed', label: 'Speed (cells per second)', kind: 'number', step: 0.5 }],
  face: [{ key: 'who', label: 'Who', kind: 'text' }, { key: 'toward', label: 'Turn towards (a reference or x,y)', kind: 'text' }],
  fade: [{ key: 'to', label: 'Fade to (0 = clear, 1 = black)', kind: 'number', step: 0.1 }, { key: 'seconds', label: 'Seconds', kind: 'number', step: 0.1 }, { key: 'color', label: 'Colour', kind: 'colour' }],
  animation: [{ key: 'who', label: 'Who', kind: 'text' }, { key: 'clip', label: 'Animation name', kind: 'text' }],
  shake: [{ key: 'amount', label: 'Strength (pixels)', kind: 'number', step: 1 }, { key: 'seconds', label: 'Seconds', kind: 'number', step: 0.1 }],
  sound: [{ key: 'name', label: 'Sound name', kind: 'sound' }],
  music: [{ key: 'name', label: 'Music name (empty = silence)', kind: 'sound' }],
  setVariable: [{ key: 'name', label: 'Variable', kind: 'text' }, { key: 'value', label: 'Value', kind: 'value' }],
  give: [{ key: 'item', label: 'Item', kind: 'item' }, { key: 'amount', label: 'How many', kind: 'number', step: 1 }],
  message: [{ key: 'text', label: 'Message', kind: 'text' }],
};

function CutscenesTab() {
  const list = [...store.story.cutscenes.values()].sort((a, b) => a.name.localeCompare(b.name));
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState('');
  const c = store.story.cutscenes.get(name) ?? list[0];
  const create = (): void => {
    const problem = storyNameProblem(fresh, list.map((x) => x.name), 'cutscene');
    if (problem) return store.notify('warn', problem);
    store.putCutscene(newCutscene(fresh.trim()));
    setName(fresh.trim());
    setFresh('');
  };
  return (
    <div className="story-body">
      <p className="hint">Scripted moments: steps run one after another; tick "keep going" to let a step run alongside the next. Play one with a Cutscene Trigger or the "Play a cutscene" action.</p>
      <div className="row">
        <input data-testid="cutscene-new-name" placeholder="New cutscene name" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button data-testid="cutscene-new" onClick={create}>
          Create
        </button>
      </div>
      {list.length > 0 && <SelectField<string> label="Editing" testId="cutscene-select" value={c?.name ?? ''} options={list.map((x) => ({ value: x.name, label: x.name }))} onChange={setName} />}
      {c && <CutsceneEditor key={c.name} c={c} onDeleted={() => setName('')} />}
    </div>
  );
}

function CutsceneEditor({ c, onDeleted }: { c: CutsceneData; onDeleted(): void }) {
  const known = { dialogues: new Set(store.story.dialogues.keys()), items: new Set(store.story.items.map((i) => i.id)) };
  const problems = checkCutscene(c, known);
  const put = (next: CutsceneData): void => store.putCutscene(next);
  const [mode, setMode] = useState<'list' | 'timeline'>(() => {
    try {
      return localStorage.getItem('tw.cutsceneView') === 'timeline' ? 'timeline' : 'list';
    } catch {
      return 'list';
    }
  });
  const [sel, setSel] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const chooseMode = (m: 'list' | 'timeline'): void => {
    setMode(m);
    try {
      localStorage.setItem('tw.cutsceneView', m);
    } catch {
      /* the choice just is not remembered */
    }
  };
  const setStep = (i: number, step: CutsceneStep): void => put({ ...c, steps: c.steps.map((s, j) => (j === i ? step : s)) });
  const freshId = (): string => {
    let n = c.steps.length + 1;
    while (c.steps.some((s) => s.id === `s${n}`)) n++;
    return `s${n}`;
  };
  const move = (i: number, by: number): void => {
    const steps = [...c.steps];
    const j = i + by;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j]!, steps[i]!];
    put({ ...c, steps });
  };
  return (
    <div data-testid="cutscene-editor" className={mode === 'timeline' && big ? 'dg-overlay' : ''}>
      <CheckField label="The player can skip it" value={c.skippable} onChange={(v) => put({ ...c, skippable: v })} />
      <div className="seg" role="group" aria-label="How to show the cutscene">
        <button className={mode === 'list' ? 'on' : ''} data-testid="cutscene-view-list" aria-pressed={mode === 'list'} onClick={() => chooseMode('list')}>
          List
        </button>
        <button className={mode === 'timeline' ? 'on' : ''} data-testid="cutscene-view-timeline" aria-pressed={mode === 'timeline'} onClick={() => chooseMode('timeline')}>
          Timeline
        </button>
        {mode === 'timeline' && (
          <button data-testid="ct-big" aria-pressed={big} onClick={() => setBig(!big)} title="Fill the window with the cutscene, for more room">
            {big ? 'Back to the panel' : 'Make it bigger'}
          </button>
        )}
      </div>
      {mode === 'timeline' && <CutsceneTimeline c={c} selected={sel} onSelect={setSel} onChange={put} />}
      {c.steps.map((s, i) => (mode === 'timeline' && s.id !== sel ? null : (
        <fieldset key={s.id} className="story-card" data-testid={`cstep-${i}`}>
          <legend>
            {i + 1}. {CUTSCENE_STEP_LABELS[s.type]}
          </legend>
          <SelectField<string>
            label="Step"
            testId={`cstep-type-${i}`}
            value={s.type}
            options={Object.entries(CUTSCENE_STEP_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(type) => setStep(i, CutsceneStepSchema.parse({ id: s.id, type, async: s.async }))}
          />
          {STEP_FIELDS[s.type].map((f) => {
            const value = (s as unknown as Record<string, unknown>)[f.key];
            const set = (v: unknown): void => setStep(i, { ...s, [f.key]: v } as CutsceneStep);
            const tid = `cstep-${f.key}-${i}`;
            switch (f.kind) {
              case 'number':
                return <NumberField key={f.key} label={f.label} testId={tid} value={Number(value)} step={f.step ?? 1} onCommit={set} />;
              case 'colour':
                return (
                  <label key={f.key} className="field">
                    <span>{f.label}</span>
                    <input type="color" value={numberToHex(Number(value))} onChange={(e) => set(hexToNumber(e.target.value))} />
                  </label>
                );
              case 'dialogue':
                return <SelectField<string> key={f.key} label={f.label} testId={tid} value={String(value)} options={[{ value: '', label: '(choose)' }, ...[...store.story.dialogues.keys()].map((n) => ({ value: n, label: n }))]} onChange={set} />;
              case 'item':
                return <SelectField<string> key={f.key} label={f.label} testId={tid} value={String(value)} options={[{ value: '', label: '(choose)' }, ...store.story.items.map((n) => ({ value: n.id, label: n.name }))]} onChange={set} />;
              case 'value':
                return <TextField key={f.key} label={f.label} testId={tid} value={String(value)} onCommit={(v) => set(parseValue(v))} />;
              case 'sound':
                return <SoundField key={f.key} label={f.label} testId={tid} value={String(value ?? '')} onCommit={set} />;
              default:
                return <TextField key={f.key} label={f.label} testId={tid} value={String(value ?? '')} onCommit={set} />;
            }
          })}
          {s.type !== 'waitInput' && <CheckField label="Keep going without waiting for it to finish" value={s.async} onChange={(v) => setStep(i, { ...s, async: v })} />}
          <div className="row">
            <button className="small" onClick={() => move(i, -1)} aria-label="Move up">
              Up
            </button>
            <button className="small" onClick={() => move(i, 1)} aria-label="Move down">
              Down
            </button>
            <button className="small" onClick={() => put({ ...c, steps: c.steps.filter((_, j) => j !== i) })}>
              Delete step
            </button>
          </div>
        </fieldset>
      )))}
      {mode === 'timeline' && (
        <div className="row wrap">
          {(Object.keys(CUTSCENE_STEP_LABELS) as CutsceneStep['type'][]).map((t) => (
            <button
              key={t}
              className="small"
              data-testid={`cstep-add-${t}`}
              onClick={() => {
                const step = CutsceneStepSchema.parse({ id: freshId(), type: t });
                put({ ...c, steps: [...c.steps, step] });
                setSel(step.id);
              }}
            >
              + {CUTSCENE_STEP_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      <button data-testid="cstep-add" onClick={() => put({ ...c, steps: [...c.steps, CutsceneStepSchema.parse({ id: freshId(), type: 'wait' })] })}>
        Add a step
      </button>
      {problems.length > 0 ? (
        <ul className="story-problems" data-testid="cutscene-problems">
          {problems.map((p, i) => (
            <li key={i}>{p.text}</li>
          ))}
        </ul>
      ) : (
        <p className="hint ok">No problems found.</p>
      )}
      <div className="row">
        <button
          data-testid="cutscene-test"
          onClick={() => {
            void store.flushStory().then(() => {
              store.autoPlay = { cutscene: c.name };
              store.play();
            });
          }}
        >
          Test in the game
        </button>
        <button
          className="small"
          onClick={() => {
            void store.removeCutscene(c.name).then(onDeleted);
          }}
        >
          Delete cutscene
        </button>
      </div>
    </div>
  );
}

// ---------- skins ----------

function SkinsTab() {
  const skins = store.skins;
  const sprites = useStudio((s) => s.names);
  const [fresh, setFresh] = useState('');
  const update = (i: number, patch: Partial<SkinData>): void => store.setSkins(skins.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const create = (): void => {
    const problem = storyNameProblem(fresh, skins.map((s) => s.name), 'skin');
    if (problem) return store.notify('warn', problem);
    let id = fresh.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skin';
    for (let n = 2; skins.some((s) => s.id === id); n++) id = `${id}-${n}`;
    store.setSkins([...skins, { ...newSkin(id, fresh.trim()), color: 0x4aa3df }]);
    setFresh('');
  };
  return (
    <div className="story-body" data-testid="skins-tab">
      <p className="hint">Other looks for the player character. Players choose one in the pause menu (Settings, Appearance) once it is unlocked. A skin is a colour for a plain shape, or a sprite from the Sprite studio.</p>
      <div className="row">
        <input data-testid="skin-new-name" placeholder="New skin name" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button data-testid="skin-new" onClick={create}>
          Create
        </button>
      </div>
      {skins.map((s, i) => (
        <fieldset key={s.id} className="story-card" data-testid={`skin-${s.id}`}>
          <legend>{s.name}</legend>
          <TextField label="Name" testId={`skin-name-${s.id}`} value={s.name} onCommit={(v) => update(i, { name: v.trim() || s.name })} />
          <CheckField label="Changes the colour of the character" testId={`skin-usecolor-${s.id}`} value={s.color >= 0} onChange={(on) => update(i, { color: on ? 0x4aa3df : -1 })} />
          {s.color >= 0 && (
            <label className="field">
              <span>Colour</span>
              <input data-testid={`skin-color-${s.id}`} type="color" value={numberToHex(s.color)} onChange={(e) => update(i, { color: hexToNumber(e.target.value) })} />
            </label>
          )}
          <SelectField<string> label="Sprite" testId={`skin-sprite-${s.id}`} value={s.sprite} options={[{ value: '', label: '(keep the original)' }, ...sprites.map((n) => ({ value: n, label: n }))]} onChange={(v) => update(i, { sprite: v })} />
          <SelectField<string>
            label="Available"
            testId={`skin-unlock-${s.id}`}
            value={s.unlock.kind}
            options={[
              { value: 'always', label: 'from the start' },
              { value: 'variable', label: 'when a flag or counter is set' },
              { value: 'item', label: 'while the player carries an item' },
            ]}
            onChange={(k) => update(i, { unlock: k === 'item' ? { kind: 'item', item: store.story.items[0]?.id ?? '' } : k === 'variable' ? { kind: 'variable', name: '', atLeast: 1 } : { kind: 'always' } })}
          />
          {s.unlock.kind === 'variable' && (
            <>
              <TextField label="Variable" testId={`skin-var-${s.id}`} value={s.unlock.name} onCommit={(v) => update(i, { unlock: { kind: 'variable', name: v.trim(), atLeast: (s.unlock as { atLeast: number }).atLeast } })} />
              <NumberField label="At least" value={s.unlock.atLeast} step={1} onCommit={(v) => update(i, { unlock: { kind: 'variable', name: (s.unlock as { name: string }).name, atLeast: v } })} />
            </>
          )}
          {s.unlock.kind === 'item' && (
            <SelectField<string> label="Item" value={s.unlock.item} options={[{ value: '', label: '(choose)' }, ...store.story.items.map((n) => ({ value: n.id, label: n.name }))]} onChange={(v) => update(i, { unlock: { kind: 'item', item: v } })} />
          )}
          <button className="small" onClick={() => store.setSkins(skins.filter((_, j) => j !== i))}>
            Delete skin
          </button>
        </fieldset>
      ))}
      {skins.length === 0 && <p className="hint">No skins yet.</p>}
    </div>
  );
}
