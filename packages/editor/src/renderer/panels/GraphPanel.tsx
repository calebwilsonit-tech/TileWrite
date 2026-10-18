import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTIONS,
  CONDITIONS,
  describeGraphNode,
  graphNodeKind,
  graphToRows,
  newRow,
  rowsToGraph,
  type GraphNodeKind,
} from '@tilewright/behaviors';
import type { EventAction, EventCondition, GraphData, GraphNodeData } from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import {
  addLink,
  addNode,
  boxChoices,
  collapseToFunction,
  moveNodes,
  newGraph,
  removeLink,
  removeNodes,
  searchBoxes,
  targetChoices,
  updateNode,
} from '../model/graph-edit';
import { ActionListEditor, ConditionListEditor } from './LogicEditors';
import { useFacts } from './EventsPanel';
import { CheckField, NumberField, SelectField, TextField } from './fields';

const WIDTH = 230;
const HEAD = 28;
const ROW = 22;
const FOOT = 40;

const heightOf = (n: GraphNodeData): number => HEAD + Math.max(1, graphNodeKind(n.type)?.outputs.length ?? 1) * ROW + FOOT;
const inPin = (n: GraphNodeData): { x: number; y: number } => ({ x: n.x, y: n.y + HEAD / 2 });
const outPin = (n: GraphNodeData, pin: string): { x: number; y: number } => {
  const i = Math.max(0, graphNodeKind(n.type)?.outputs.findIndex((o) => o.pin === pin) ?? 0);
  return { x: n.x + WIDTH, y: n.y + HEAD + i * ROW + ROW / 2 };
};

const curve = (a: { x: number; y: number }, b: { x: number; y: number }): string => {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
};

/** The set of boxes that ran within the last half second of a game played in the editor, for the glow. */
function useLive(graphId: string | null): Set<string> {
  const mode = useApp((s) => s.mode);
  const [lit, setLit] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (mode !== 'play' || !graphId) {
      setLit(new Set());
      return;
    }
    let raf = 0;
    const loop = (): void => {
      const play = (window as unknown as { __play?: { sim: { tick: number; runtime: { scratch: Map<string, unknown> } } } }).__play;
      const fired = play?.sim.runtime.scratch.get('fired') as Map<string, number> | undefined;
      const next = new Set<string>();
      if (play && fired) for (const [key, tick] of fired) if (key.startsWith(`g:${graphId}:`) && play.sim.tick - tick < 30) next.add(key.slice(`g:${graphId}:`.length).replace('#ran', ''));
      setLit((prev) => (prev.size === next.size && [...next].every((k) => prev.has(k)) ? prev : next));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, graphId]);
  return lit;
}

function NodeSettings({ graph, node, update }: { graph: GraphData; node: GraphNodeData; update(label: string, fn: (n: GraphNodeData) => void): void }) {
  const facts = useFacts();
  const functions = [...new Set(store.doc?.graphs.flatMap((g) => g.nodes.filter((n) => n.type === 'function').map((n) => String(n.params.name ?? ''))) ?? [])].filter(Boolean);
  const set = (key: string, v: unknown): void => update('Change the box', (n) => (n.params[key] = v));
  const conditions = (node.params.conditions as EventCondition[] | undefined) ?? [];
  const forEachOptions = [
    ...facts.tags.map((t) => ({ value: `tag:${t}`, label: `each thing tagged “${t}”` })),
    ...facts.tables.map((t) => ({ value: `table:${t}`, label: `each row of the table “${t}”` })),
    ...facts.entities.map((e) => ({ value: `id:${e.id}`, label: e.name })),
  ];
  const over = String(node.params.over ?? '');
  if (over && !forEachOptions.some((o) => o.value === over)) forEachOptions.push({ value: over, label: over });
  return (
    <div className="graph-settings" data-testid="graph-settings">
      <h4>{graphNodeKind(node.type)?.label ?? node.type}</h4>
      <p className="hint">{graphNodeKind(node.type)?.help}</p>
      {(node.type === 'event' || node.type === 'branch') && (
        <>
          <ConditionListEditor testId="gs-cond" conditions={conditions} mode={node.params.mode === 'any' ? 'any' : 'all'} onChange={(next, mode) => update('Change the conditions', (n) => ((n.params.conditions = next), (n.params.mode = mode)))} />
          <CheckField
            testId="gs-once"
            label={node.type === 'event' ? 'Only the moment it becomes true' : 'Only the moment it becomes true (otherwise every time the flow arrives)'}
            value={node.type === 'event' ? node.params.once !== false : node.params.once === true}
            onChange={(v) => set('once', v)}
          />
        </>
      )}
      {node.type === 'action' && (
        <ActionListEditor
          testId="gs-action"
          single
          actions={node.params.action ? [node.params.action as EventAction] : []}
          onChange={(next) => update('Change the action', (n) => (n.params.action = next[0] ?? n.params.action))}
        />
      )}
      {node.type === 'loop' && <NumberField testId="gs-count" label="How many times" min={0} max={1000} value={Number(node.params.count ?? 1)} onCommit={(v) => set('count', Math.round(v))} />}
      {node.type === 'forEach' && <SelectField<string> testId="gs-over" label="For" value={over} options={[{ value: '', label: '(choose)' }, ...forEachOptions]} onChange={(v) => set('over', v)} />}
      {node.type === 'delay' && <NumberField testId="gs-seconds" label="Seconds" min={0} max={3600} step={0.1} value={Number(node.params.seconds ?? 1)} onCommit={(v) => set('seconds', v)} />}
      {node.type === 'call' && <SelectField<string> testId="gs-function" label="Function" value={String(node.params.function ?? '')} options={[{ value: '', label: functions.length ? '(choose a function)' : '(no functions yet)' }, ...functions.map((f) => ({ value: f, label: f }))]} onChange={(v) => set('function', v)} />}
      {node.type === 'function' && <TextField testId="gs-name" label="Name" value={String(node.params.name ?? '')} onCommit={(v) => set('name', v.trim())} />}
      <CheckField testId="gs-breakpoint" label="Stop the game here when the flow reaches this box" value={node.breakpoint} onChange={(v) => update('Toggle breakpoint', (n) => (n.breakpoint = v))} />
      <TextField testId="gs-comment" label="Note" value={node.comment} onCommit={(v) => update('Edit note', (n) => (n.comment = v))} />
      <p className="hint">{describeGraphNode(node)} (in “{graph.name}”)</p>
    </div>
  );
}

export function GraphPanel() {
  useApp((s) => s.docVersion);
  const graphId = useApp((s) => s.graphId);
  const selectionIds = useApp((s) => s.selection);
  const doc = store.doc;
  const graphs = doc?.graphs ?? [];
  const graph = graphs.find((g) => g.id === graphId) ?? graphs[0] ?? null;
  const live = useLive(graph?.id ?? null);

  const [picked, setPicked] = useState<string[]>([]);
  const [pickedLink, setPickedLink] = useState<number | null>(null);
  const [view, setView] = useState({ x: 20, y: 20, zoom: 1 });
  const [drag, setDrag] = useState<{ from: string; pin: string; at: { x: number; y: number } } | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const canvas = useRef<HTMLDivElement>(null);

  const choices = useMemo(() => {
    const own = boxChoices(ACTIONS, CONDITIONS);
    const objects = (doc?.entities ?? []).filter((e) => selectionIds.includes(e.id) && !e.tags.includes('logic-node')).flatMap((e) => targetChoices(e));
    return [...objects, ...own];
  }, [doc, selectionIds, doc?.entities.length]);
  const results = useMemo(() => (search.trim() === '' ? [] : searchBoxes(choices, search)), [choices, search]);

  if (!doc) return null;
  const setGraphs = (label: string, next: GraphData[]): void => doc.setGraphs(label, next);
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom };
  };
  const centre = (): { x: number; y: number } => {
    const r = canvas.current?.getBoundingClientRect();
    return r ? toWorld(r.left + r.width / 2 - WIDTH / 2, r.top + 60) : { x: 40, y: 40 };
  };

  const create = (): void => {
    const made = newGraph(graphs, `Graph ${graphs.length + 1}`);
    setGraphs('Add a graph', made.graphs);
    store.set({ graphId: made.id });
    setPicked([]);
  };

  const place = (kind: { type: string; params: Record<string, unknown> }): void => {
    if (!graph) return;
    const c = centre();
    // a new box lands near the last one picked, or in the middle of the view
    const base = graph.nodes.find((n) => n.id === picked[picked.length - 1]);
    const x = base ? base.x + WIDTH + 50 : c.x;
    const y = base ? base.y : c.y;
    const added = addNode(graphs, graph.id, kind.type, x, y, kind.params);
    let next = added.graphs;
    // after a box with one obvious output, join the new one to it
    if (base) {
      const out = graphNodeKind(base.type)?.outputs[0];
      if (out && !graphNodeKind(kind.type)?.entry) next = addLink(next, graph.id, base.id, out.pin, added.id);
    }
    setGraphs('Add a box', next);
    setPicked([added.id]);
    setSearch('');
  };

  const fromSheet = (): void => {
    if (doc.events.length === 0) {
      setMessage('The event sheet is empty.');
      return;
    }
    let n = graphs.length + 1;
    while (graphs.some((g) => g.id === `g${n}`)) n++;
    const { graph: made, skipped } = rowsToGraph(doc.events, (p) => `${p}${n}${Math.random().toString(36).slice(2, 6)}`, 'Event sheet');
    made.id = `g${n}`;
    // every node needs a short id inside its graph
    const ids = new Map(made.nodes.map((node, i) => [node.id, `n${i + 1}`]));
    made.nodes = made.nodes.map((node) => ({ ...node, id: ids.get(node.id)! }));
    made.links = made.links.map((l) => ({ from: { node: ids.get(l.from.node)!, pin: l.from.pin }, to: { node: ids.get(l.to.node)!, pin: l.to.pin } }));
    doc.history.batch('Event sheet to graph', () => {
      doc.setGraphs('Add the graph', [...graphs, made]);
      doc.setEvents('Move the rows into the graph', []);
    });
    store.set({ graphId: made.id });
    setMessage(`Moved ${doc.events.length === 0 ? 'the' : ''} sheet into the graph “${made.name}”${skipped ? ` (${skipped} switched-off row${skipped === 1 ? ' was' : 's were'} left out)` : ''}. Undo brings the sheet back.`);
  };

  const toSheet = (): void => {
    if (!graph) return;
    const { rows, problems } = graphToRows(graph, (p) => doc.newId(p));
    if (problems.length > 0) {
      setMessage(`This graph cannot be an event sheet yet. ${problems.join(' ')}`);
      return;
    }
    doc.history.batch('Graph to event sheet', () => {
      doc.setEvents('Add the rows', [...doc.events, ...rows.map((r) => ({ ...newRow(r.id), ...r }))]);
      doc.setGraphs('Remove the graph', graphs.filter((g) => g.id !== graph.id));
    });
    setMessage(`The graph is now ${rows.length} row${rows.length === 1 ? '' : 's'} in the Events panel. Undo brings the graph back.`);
  };

  const collapse = (): void => {
    if (!graph) return;
    const name = window.prompt('Name for the new function', 'My function')?.trim();
    if (!name) return;
    const r = collapseToFunction(graphs, graph.id, picked, name);
    if (r.problem) {
      setMessage(r.problem);
      return;
    }
    setGraphs('Collapse into a function', r.graphs);
    setPicked([]);
    setMessage(`The boxes are now the function “${name}” (see the graph “Function: ${name}”) and a Call box stands where they were.`);
  };

  const onNodePointerDown = (e: React.PointerEvent, n: GraphNodeData): void => {
    if ((e.target as HTMLElement).closest('[data-pin]')) return;
    e.stopPropagation();
    const sel = e.shiftKey ? (picked.includes(n.id) ? picked.filter((p) => p !== n.id) : [...picked, n.id]) : picked.includes(n.id) ? picked : [n.id];
    setPicked(sel);
    setPickedLink(null);
    const start = toWorld(e.clientX, e.clientY);
    let last = start;
    let moved = false;
    const base = graphs;
    const move = (ev: PointerEvent): void => {
      const p = toWorld(ev.clientX, ev.clientY);
      if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 3) moved = true;
      if (!moved) return;
      last = p;
      // moved live in the document without a history step each frame; committed on release
      const g = base.find((x) => x.id === graph!.id)!;
      doc.graphs = moveNodes(base, graph!.id, sel, last.x - start.x, last.y - start.y);
      void g;
      doc.emit({ type: 'graphs' });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) {
        const final = doc.graphs;
        doc.graphs = structuredClone(base as GraphData[]);
        setGraphs('Move boxes', final);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPinDown = (e: React.PointerEvent, n: GraphNodeData, pin: string): void => {
    e.stopPropagation();
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    setDrag({ from: n.id, pin, at });
    const move = (ev: PointerEvent): void => setDrag({ from: n.id, pin, at: toWorld(ev.clientX, ev.clientY) });
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      const p = toWorld(ev.clientX, ev.clientY);
      const target = graph!.nodes.find((x) => x.id !== n.id && p.x >= x.x && p.x <= x.x + WIDTH && p.y >= x.y && p.y <= x.y + heightOf(x));
      if (target) {
        const next = addLink(graphs, graph!.id, n.id, pin, target.id);
        if (JSON.stringify(next) !== JSON.stringify(graphs)) setGraphs('Join two boxes', next);
        else setMessage('Those two cannot be joined that way (a flow cannot start inside a box, loop back on itself, or repeat a line).');
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && graph) {
      if (pickedLink !== null) {
        setGraphs('Remove a line', removeLink(graphs, graph.id, pickedLink));
        setPickedLink(null);
      } else if (picked.length > 0) {
        setGraphs('Remove boxes', removeNodes(graphs, graph.id, picked));
        setPicked([]);
      }
    }
  };

  const selectedNode = graph && picked.length === 1 ? graph.nodes.find((n) => n.id === picked[0]) : undefined;
  const extent = graph ? { w: Math.max(900, ...graph.nodes.map((n) => n.x + WIDTH + 200)), h: Math.max(500, ...graph.nodes.map((n) => n.y + heightOf(n) + 200)) } : { w: 900, h: 500 };

  return (
    <div className="panel graph-panel" data-testid="graph-panel" onKeyDown={onKey} tabIndex={-1}>
      <div className="row wrap graph-bar">
        <select data-testid="graph-select" aria-label="Graph" value={graph?.id ?? ''} onChange={(e) => (store.set({ graphId: e.target.value }), setPicked([]))}>
          {graphs.length === 0 && <option value="">(no graphs yet)</option>}
          {graphs.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button data-testid="graph-new" onClick={create}>
          + New graph
        </button>
        {graph && (
          <>
            <input
              data-testid="graph-name"
              aria-label="Graph name"
              defaultValue={graph.name}
              key={graph.id + graph.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== graph.name && setGraphs('Rename the graph', graphs.map((g) => (g.id === graph.id ? { ...g, name: e.target.value.trim() } : g)))}
            />
            <label className="check">
              <input data-testid="graph-enabled" type="checkbox" checked={graph.enabled} onChange={(e) => setGraphs('Switch the graph', graphs.map((g) => (g.id === graph.id ? { ...g, enabled: e.target.checked } : g)))} /> runs
            </label>
            <button data-testid="graph-delete" onClick={() => (setGraphs('Delete the graph', graphs.filter((g) => g.id !== graph.id)), setPicked([]))}>
              Delete graph
            </button>
            <button data-testid="graph-to-sheet" onClick={toSheet} title="Turn this graph into rows of the event sheet, when its shape allows it">
              To event sheet
            </button>
            <button data-testid="graph-collapse" disabled={picked.length === 0} onClick={collapse} title="Turn the selected boxes into a reusable function">
              Collapse into a function
            </button>
          </>
        )}
        <button data-testid="graph-from-sheet" onClick={fromSheet} title="Move the event sheet's rows into a new graph">
          From event sheet
        </button>
        <div className="graph-search">
          <input
            data-testid="graph-search"
            aria-label="Add a box"
            placeholder="Add a box: type to search (select an object first for its own actions)…"
            value={search}
            disabled={!graph}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) place(results[0].make());
              if (e.key === 'Escape') setSearch('');
            }}
          />
          {results.length > 0 && (
            <ul className="graph-results" data-testid="graph-results">
              {results.map((r, i) => (
                <li key={r.id}>
                  <button data-testid={`graph-result-${i}`} onClick={() => place(r.make())}>
                    {r.label} <small>{r.group}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="graph-kinds">
          {(['event', 'action', 'branch', 'loop', 'delay'] as const).map((k) => (
            <button key={k} data-testid={`graph-add-${k}`} disabled={!graph} onClick={() => place({ type: k, params: graphNodeKind(k)!.defaults })} title={graphNodeKind(k)!.help}>
              + {graphNodeKind(k)!.label}
            </button>
          ))}
        </span>
      </div>
      {message && (
        <p className="hint graph-message" data-testid="graph-message" onClick={() => setMessage('')}>
          {message}
        </p>
      )}
      {!graph ? (
        <p className="hint">
          A graph is boxes joined by lines: an event box starts a flow, which runs through actions, ifs, repeats and waits. It uses the same conditions and actions as the event sheet. Make a graph, or move your event sheet into one.
        </p>
      ) : (
        <div className="graph-body">
          <div
            className="graph-canvas"
            ref={canvas}
            data-testid="graph-canvas"
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('.graph-node')) return;
              setPicked([]);
              setPickedLink(null);
              const sx = e.clientX;
              const sy = e.clientY;
              const v0 = view;
              const move = (ev: PointerEvent): void => setView({ ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy });
              const up = (): void => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              setView((v) => ({ ...v, zoom: Math.min(1.6, Math.max(0.4, v.zoom * (e.deltaY < 0 ? 1.1 : 0.9))) }));
            }}
          >
            <div className="graph-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, width: extent.w, height: extent.h }}>
              <svg className="graph-links" width={extent.w} height={extent.h}>
                {graph.links.map((l, i) => {
                  const a = graph.nodes.find((n) => n.id === l.from.node);
                  const b = graph.nodes.find((n) => n.id === l.to.node);
                  if (!a || !b) return null;
                  const on = live.has(l.from.node);
                  return (
                    <g key={i} data-testid={`glink-${i}`}>
                      <path d={curve(outPin(a, l.from.pin), inPin(b))} className={`graph-link${on ? ' lit' : ''}${pickedLink === i ? ' picked' : ''}`} />
                      <path
                        d={curve(outPin(a, l.from.pin), inPin(b))}
                        className="graph-link-hit"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setPickedLink(i);
                          setPicked([]);
                        }}
                      />
                    </g>
                  );
                })}
                {drag && graph.nodes.find((n) => n.id === drag.from) && <path d={curve(outPin(graph.nodes.find((n) => n.id === drag.from)!, drag.pin), drag.at)} className="graph-link drag" />}
              </svg>
              {graph.nodes.map((n) => {
                const kind: GraphNodeKind | undefined = graphNodeKind(n.type);
                return (
                  <div
                    key={n.id}
                    className={`graph-node k-${n.type}${picked.includes(n.id) ? ' picked' : ''}${live.has(n.id) ? ' lit' : ''}`}
                    data-testid={`gnode-${n.id}`}
                    style={{ left: n.x, top: n.y, width: WIDTH, height: heightOf(n) }}
                    onPointerDown={(e) => onNodePointerDown(e, n)}
                  >
                    <div className="graph-head" style={{ height: HEAD }}>
                      {!kind?.entry && <span className="graph-pin in" data-pin="in" data-testid={`gpin-in-${n.id}`} style={{ top: HEAD / 2 - 6 }} />}
                      <button
                        className={`graph-bp${n.breakpoint ? ' on' : ''}`}
                        data-testid={`gbp-${n.id}`}
                        aria-label={n.breakpoint ? 'Remove breakpoint' : 'Add breakpoint'}
                        title="Breakpoint: stop the game when the flow reaches this box"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setGraphs('Toggle breakpoint', updateNode(graphs, graph.id, n.id, (x) => (x.breakpoint = !x.breakpoint)))}
                      />
                      <strong>{kind?.label ?? n.type}</strong>
                    </div>
                    {(kind?.outputs ?? []).map((o, i) => (
                      <div key={o.pin} className="graph-out" style={{ height: ROW }}>
                        <span>{o.label}</span>
                        <span className="graph-pin out" data-pin={o.pin} data-testid={`gpin-out-${n.id}-${o.pin}`} style={{ top: HEAD + i * ROW + ROW / 2 - 6 }} onPointerDown={(e) => onPinDown(e, n, o.pin)} />
                      </div>
                    ))}
                    <div className="graph-summary" title={describeGraphNode(n)}>
                      {describeGraphNode(n)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <aside className="graph-side">
            {selectedNode ? (
              <NodeSettings graph={graph} node={selectedNode} update={(label, fn) => setGraphs(label, updateNode(graphs, graph.id, selectedNode.id, fn))} />
            ) : (
              <p className="hint">
                Click a box to change it. Drag from a box's round pin to another box to join them. Delete removes the selected box or line. Ctrl + wheel zooms. Click the red dot on a box for a breakpoint.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
