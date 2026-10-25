import { useEffect, useMemo, useState } from 'react';
import { NODE_H, NODE_W, addNode, canHaveChild, duplicateNode, kindColor, layoutTree, moveNode, nodeOf, parentOf, removeNode, setAction, setCondition, startTree, updateNode, wrapNode } from '../model/tree-edit';
import { getPlay } from '../viewport/controller';
import { NumberField, SelectField, TextField } from './fields';
import { SoundField } from './SoundField';
import { ACTION_KIND_LABELS, CONDITION_KIND_LABELS, NODE_KIND_LABELS, archerTree, checkTree, describeNode, guardTree, newTreeAction, newTreeCondition, wandererTree, type BehaviorTree, type TreeAction, type TreeCondition, type TreeNode, type TreeNodeKind } from '@tilewright/behaviors';

const KINDS = Object.keys(NODE_KIND_LABELS) as TreeNodeKind[];
const COMPOSITE_AND_DECORATOR: TreeNodeKind[] = ['sequence', 'selector', 'parallel', 'inverter', 'succeeder', 'repeat', 'cooldown'];
const RESULT_COLOR: Record<string, string> = { success: '#3ccf7a', failure: '#e5484d', running: '#f5a623' };

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ConditionFields({ c, onChange }: { c: TreeCondition; onChange(c: TreeCondition): void }) {
  return (
    <>
      <SelectField<string>
        label="Asks whether"
        testId="bt-cond"
        value={c.type}
        options={(Object.keys(CONDITION_KIND_LABELS) as TreeCondition['type'][]).map((t) => ({ value: t, label: CONDITION_KIND_LABELS[t] }))}
        onChange={(t) => onChange(newTreeCondition(t as TreeCondition['type']))}
      />
      {c.type === 'lost' && <NumberField label="Seconds" testId="bt-seconds" value={c.seconds} min={0} step={0.5} onCommit={(v) => onChange({ ...c, seconds: v })} />}
      {(c.type === 'near' || c.type === 'far') && <NumberField label="Cells" testId="bt-cells" value={c.cells} min={0.5} step={0.5} onCommit={(v) => onChange({ ...c, cells: v })} />}
      {c.type === 'health' && <NumberField label="Health percent" testId="bt-percent" value={c.percent} min={0} max={100} step={5} onCommit={(v) => onChange({ ...c, percent: v })} />}
      {c.type === 'chance' && <NumberField label="Chance (percent)" testId="bt-chance" value={c.percent} min={0} max={100} step={5} onCommit={(v) => onChange({ ...c, percent: v })} />}
      {c.type === 'variable' && (
        <>
          <TextField label="Variable" testId="bt-var" value={c.name} onCommit={(v) => onChange({ ...c, name: v.trim() })} />
          <SelectField<string> label="Is" value={c.op} options={['=', '!=', '>', '>=', '<', '<='].map((o) => ({ value: o, label: o }))} onChange={(o) => onChange({ ...c, op: o as typeof c.op })} />
          <TextField label="Value" value={String(c.value)} onCommit={(v) => onChange({ ...c, value: v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v })} />
        </>
      )}
    </>
  );
}

function ActionFields({ a, has, onChange }: { a: TreeAction; has: string[]; onChange(a: TreeAction): void }) {
  return (
    <>
      <SelectField<string>
        label="Does"
        testId="bt-action"
        value={a.type}
        options={(Object.keys(ACTION_KIND_LABELS) as TreeAction['type'][]).map((t) => ({ value: t, label: ACTION_KIND_LABELS[t] }))}
        onChange={(t) => onChange(newTreeAction(t as TreeAction['type']))}
      />
      {a.type === 'wait' && <NumberField label="Seconds" testId="bt-seconds" value={a.seconds} min={0} step={0.5} onCommit={(v) => onChange({ ...a, seconds: v })} />}
      {a.type === 'moveToward' && (
        <>
          <NumberField label="Speed (cells per second)" value={a.speed} min={0.2} max={15} step={0.2} onCommit={(v) => onChange({ ...a, speed: v })} />
          <NumberField label="Stops this close (cells)" testId="bt-stop" value={a.stop} min={0.2} step={0.2} onCommit={(v) => onChange({ ...a, stop: v })} />
        </>
      )}
      {a.type === 'moveAway' && (
        <>
          <NumberField label="Speed (cells per second)" value={a.speed} min={0.2} max={15} step={0.2} onCommit={(v) => onChange({ ...a, speed: v })} />
          <NumberField label="Until this far away (cells)" value={a.cells} min={1} step={0.5} onCommit={(v) => onChange({ ...a, cells: v })} />
        </>
      )}
      {a.type === 'goHome' && <NumberField label="Speed (cells per second)" value={a.speed} min={0.2} max={15} step={0.2} onCommit={(v) => onChange({ ...a, speed: v })} />}
      {a.type === 'wander' && (
        <>
          <NumberField label="Speed (cells per second)" value={a.speed} min={0.2} max={15} step={0.2} onCommit={(v) => onChange({ ...a, speed: v })} />
          <NumberField label="Stays within (cells of home)" value={a.radius} min={1} max={30} step={0.5} onCommit={(v) => onChange({ ...a, radius: v })} />
        </>
      )}
      {a.type === 'animation' && <TextField label="Animation (clip name)" testId="bt-clip" value={a.clip} onCommit={(v) => onChange({ ...a, clip: v.trim() })} />}
      {a.type === 'say' && <TextField label="Message" testId="bt-text" value={a.text} onCommit={(v) => onChange({ ...a, text: v })} />}
      {a.type === 'sound' && <SoundField label="Sound" testId="bt-sound" value={a.name} onCommit={(v) => onChange({ ...a, name: v.trim() })} />}
      {a.type === 'setVariable' && (
        <>
          <TextField label="Variable" testId="bt-var" value={a.name} onCommit={(v) => onChange({ ...a, name: v.trim() })} />
          <TextField label="Value" value={String(a.value)} onCommit={(v) => onChange({ ...a, value: v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v })} />
        </>
      )}
      {(a.type === 'enable' || a.type === 'disable') && (
        <SelectField<string>
          label="Behaviour"
          testId="bt-behaviour"
          value={a.behaviour}
          options={[{ value: '', label: '(choose)' }, ...has.map((b) => ({ value: b, label: b }))]}
          onChange={(v) => onChange({ ...a, behaviour: v })}
        />
      )}
    </>
  );
}

/** What the running game says each node of this object's tree answered in the latest tick (empty when no game is running). */
function useLiveTrace(sceneId: string | undefined): Record<string, string> {
  const [trace, setTrace] = useState<Record<string, string>>({});
  useEffect(() => {
    const id = window.setInterval(() => {
      const play = getPlay();
      const runtimeId = sceneId && play ? play.sim.runtime.ids.get(sceneId) : undefined;
      const t = runtimeId !== undefined ? play!.sim.world.get(runtimeId)?.get<{ trace: Record<string, string> }>('state:tree')?.trace : undefined;
      setTrace((old) => {
        const next = t ?? {};
        return JSON.stringify(old) === JSON.stringify(next) ? old : { ...next };
      });
    }, 150);
    return () => window.clearInterval(id);
  }, [sceneId]);
  return trace;
}

/**
 * A behaviour tree drawn as a tree: the root on the left, a card for every node, lines to the children. Click a card to
 * edit it below, add children, wrap it in another node ("not"), move it up or down, copy a branch, delete it. While the
 * game runs, each card shows what it answered in the latest moment (green worked, red failed, orange is still going).
 */
export function BehaviorTreeEditor({ tree, has, sceneId, onChange }: { tree: BehaviorTree; has: string[]; sceneId?: string; onChange(next: BehaviorTree): void }) {
  const [sel, setSel] = useState<string | null>(tree.root || null);
  const [kind, setKind] = useState<TreeNodeKind>('sequence');
  const [wrap, setWrap] = useState<TreeNodeKind>('inverter');
  const [big, setBig] = useState(false);
  const live = useLiveTrace(sceneId);
  const { placed, width, height } = useMemo(() => layoutTree(tree), [tree]);
  const problems = useMemo(() => checkTree(tree, (b) => has.includes(b)), [tree, has]);
  const node = sel ? nodeOf(tree, sel) : undefined;
  const parent = node ? parentOf(tree, node.id) : undefined;
  const pad = 12;

  const edit = (next: BehaviorTree, select?: string | null): void => {
    onChange(next);
    if (select !== undefined) setSel(select);
  };
  const add = (parentId: string | null, k: TreeNodeKind): void => {
    const r = addNode(tree, parentId, k);
    if (r.tree !== tree) edit(r.tree, r.id);
  };
  const addLeaf = (parentId: string, k: 'condition' | 'action'): void => add(parentId, k);

  const links: { key: string; d: string; hot: boolean }[] = [];
  for (const [id, p] of placed) {
    const n = nodeOf(tree, id);
    if (!n) continue;
    const kids = n.type === 'sequence' || n.type === 'selector' || n.type === 'parallel' ? n.children : 'child' in n && n.child ? [n.child] : [];
    for (const c of kids) {
      const q = placed.get(c);
      if (!q) continue;
      const x1 = p.x + NODE_W;
      const y1 = p.y + NODE_H / 2;
      const x2 = q.x;
      const y2 = q.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      links.push({ key: `${id}>${c}`, d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, hot: sel === c || sel === id });
    }
  }

  return (
    <div className={big ? 'btedit dg-overlay' : 'btedit'} data-testid="bt-editor">
      <div className="row wrap">
        <SelectField<string>
          label="Start from an example"
          testId="bt-example"
          value=""
          options={[
            { value: '', label: '(choose)' },
            { value: 'guard', label: 'Guard: chases what it sees, looks around, wanders' },
            { value: 'archer', label: 'Archer: keeps its distance, follows when far' },
            { value: 'wanderer', label: 'Wanderer: ambles about, runs away when hurt' },
            { value: 'empty', label: 'Empty tree' },
          ]}
          onChange={(v) => {
            if (v === '') return;
            if (tree.nodes.length > 0 && !window.confirm('Replace the nodes below with the example?')) return;
            const base = v === 'guard' ? guardTree() : v === 'archer' ? archerTree() : v === 'wanderer' ? wandererTree() : startTree('selector');
            edit({ ...base, target: tree.target }, base.root);
          }}
        />
        <button className="small" data-testid="bt-big" onClick={() => setBig(!big)}>
          {big ? 'Make it smaller' : 'Make it bigger'}
        </button>
      </div>
      {tree.nodes.length === 0 && (
        <div className="row">
          <button data-testid="bt-first" onClick={() => add(null, 'selector')}>
            Add the first node
          </button>
        </div>
      )}
      <div className="bt-scroll" style={{ overflow: 'auto', maxHeight: big ? '70vh' : 320, border: '1px solid var(--border, #444)', borderRadius: 6 }}>
        <svg width={width + pad * 2} height={height + pad * 2} data-testid="bt-svg" style={{ display: 'block' }}>
          <g transform={`translate(${pad},${pad})`}>
            {links.map((l) => (
              <path key={l.key} d={l.d} fill="none" stroke={l.hot ? '#6aa8ff' : '#7a7f8c'} strokeWidth={l.hot ? 2 : 1.4} />
            ))}
            {[...placed.values()].map((p) => {
              const n = nodeOf(tree, p.id)!;
              const result = live[p.id];
              const selected = sel === p.id;
              return (
                <g key={p.id} transform={`translate(${p.x},${p.y})`} data-testid={`bt-node-${p.id}`} data-kind={n.type} data-result={result ?? ''} onClick={() => setSel(p.id)} style={{ cursor: 'pointer' }}>
                  <rect width={NODE_W} height={NODE_H} rx={7} fill={kindColor(n)} stroke={selected ? '#ffffff' : (result ? RESULT_COLOR[result] : '#00000055')} strokeWidth={selected ? 2.5 : result ? 3 : 1} />
                  <text x={8} y={NODE_H / 2 + 4} fill="#fff" fontSize={12}>
                    {short(describeNode(n), 28)}
                  </text>
                  {tree.root === p.id && (
                    <text x={NODE_W - 6} y={11} fill="#ffffffaa" fontSize={9} textAnchor="end">
                      start
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {Object.keys(live).length > 0 && <p className="hint">Live: green worked, red failed, orange is still going.</p>}
      {node && (
        <fieldset data-testid="bt-form">
          <legend>{describeNode(node)}</legend>
          <p className="hint">{NODE_KIND_LABELS[node.type]}</p>
          <TextField label="Name (optional)" testId="bt-name" value={node.name ?? ''} placeholder={describeNode({ ...node, name: '' })} onCommit={(v) => edit(updateNode(tree, node.id, { name: v.trim() }))} />
          {node.type === 'repeat' && <NumberField label="Times (0 = forever)" testId="bt-count" value={node.count} min={0} step={1} onCommit={(v) => edit(updateNode(tree, node.id, { count: Math.round(v) } as Partial<TreeNode>))} />}
          {node.type === 'cooldown' && <NumberField label="Rests for (seconds)" testId="bt-rest" value={node.seconds} min={0} step={0.5} onCommit={(v) => edit(updateNode(tree, node.id, { seconds: v } as Partial<TreeNode>))} />}
          {node.type === 'condition' && <ConditionFields c={node.condition} onChange={(c) => edit(setCondition(tree, node.id, c))} />}
          {node.type === 'action' && <ActionFields a={node.action} has={has} onChange={(a) => edit(setAction(tree, node.id, a))} />}
          <div className="row wrap">
            {canHaveChild(node) && (
              <>
                <SelectField<string> label="Add inside" testId="bt-add-kind" value={kind} options={KINDS.map((k) => ({ value: k, label: NODE_KIND_LABELS[k] }))} onChange={(k) => setKind(k as TreeNodeKind)} />
                <button data-testid="bt-add" onClick={() => add(node.id, kind)}>
                  Add
                </button>
                <button className="small" data-testid="bt-add-condition" onClick={() => addLeaf(node.id, 'condition')}>
                  + Question
                </button>
                <button className="small" data-testid="bt-add-action" onClick={() => addLeaf(node.id, 'action')}>
                  + Action
                </button>
              </>
            )}
          </div>
          <div className="row wrap">
            <SelectField<string> label="Wrap in" testId="bt-wrap-kind" value={wrap} options={COMPOSITE_AND_DECORATOR.map((k) => ({ value: k, label: NODE_KIND_LABELS[k] }))} onChange={(k) => setWrap(k as TreeNodeKind)} />
            <button className="small" data-testid="bt-wrap" onClick={() => edit(wrapNode(tree, node.id, wrap))}>
              Wrap
            </button>
          </div>
          <div className="row wrap">
            <button className="small" data-testid="bt-up" disabled={!parent} aria-label="Move earlier" onClick={() => edit(moveNode(tree, node.id, -1))}>
              ↑
            </button>
            <button className="small" data-testid="bt-down" disabled={!parent} aria-label="Move later" onClick={() => edit(moveNode(tree, node.id, 1))}>
              ↓
            </button>
            <button
              className="small"
              data-testid="bt-dup"
              disabled={!parent}
              onClick={() => {
                const r = duplicateNode(tree, node.id);
                edit(r.tree, r.id);
              }}
            >
              Copy branch
            </button>
            <button
              className="small"
              data-testid="bt-delete"
              onClick={() => {
                const next = removeNode(tree, node.id);
                edit(next, parent?.id ?? next.root ?? null);
              }}
            >
              Delete{node.type === 'action' || node.type === 'condition' ? '' : ' with everything inside'}
            </button>
          </div>
        </fieldset>
      )}
      {problems.map((p) => (
        <p key={p} className="hint warn">
          {p}
        </p>
      ))}
      {problems.length === 0 && tree.nodes.length > 0 && (
        <p className="hint ok" data-testid="bt-ok">
          No problems found.
        </p>
      )}
    </div>
  );
}
