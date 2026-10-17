import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { DialogueData, DialogueNode } from '@tilewright/runtime';
import { NODE_W, bounds, connect, edgesOf, layout, moveNode, nodeHeight, portOffset, portsOf, reachable, removeNode, summary, type Port } from '../model/dialogue-graph';

const COLOURS: Record<DialogueNode['type'], string> = { line: '#4f7fd1', choice: '#c9822e', set: '#7b61c2', give: '#2f9e6e', branch: '#b8456f', end: '#6b7280' };
const NAMES: Record<DialogueNode['type'], string> = { line: 'Line', choice: 'Choice', set: 'Set', give: 'Item', branch: 'Branch', end: 'End' };

type Drag =
  | { kind: 'node'; id: string; dx: number; dy: number; x: number; y: number; moved: boolean }
  | { kind: 'link'; from: string; port: Port; x: number; y: number }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean };

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * A conversation as a graph: a card for every step, a line for every "then go to". Drag a card to move it, drag from
 * the dot on its right edge to another card to connect them (drop on empty space to cut the link), drag the
 * background to pan and use the wheel to zoom. The selected card is edited in the form under the graph.
 */
export function DialogueGraph({ d, selected, onSelect, onChange }: { d: DialogueData; selected: string | null; onSelect(id: string | null): void; onChange(next: DialogueData): void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 24, y: 24, zoom: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const base = useMemo(() => layout(d), [d]);
  const edges = useMemo(() => edgesOf(d), [d]);
  const live = useMemo(() => reachable(d), [d]);
  const pos = (id: string): { x: number; y: number } => (drag?.kind === 'node' && drag.id === id ? { x: drag.x, y: drag.y } : (base.get(id) ?? { x: 0, y: 0 }));
  const byId = new Map(d.nodes.map((n) => [n.id, n]));

  const toGraph = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom };
  };
  const nodeAt = (p: { x: number; y: number }): string | null => {
    for (const n of [...d.nodes].reverse()) {
      const q = pos(n.id);
      if (p.x >= q.x && p.x <= q.x + NODE_W && p.y >= q.y && p.y <= q.y + nodeHeight(n)) return n.id;
    }
    return null;
  };
  const fit = (): void => {
    const el = svg.current;
    if (!el) return;
    const b = bounds(base);
    const zoom = Math.max(0.3, Math.min(1.2, (el.clientWidth - 48) / b.w, (el.clientHeight - 48) / b.h));
    setView({ zoom, x: 24 - b.x * zoom, y: 24 - b.y * zoom });
  };

  const down = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    svg.current!.setPointerCapture(e.pointerId);
    const p = toGraph(e);
    const target = e.target as Element;
    const portEl = target.closest('[data-port]');
    if (portEl) {
      const [from, idx] = portEl.getAttribute('data-port')!.split('|');
      const n = byId.get(from!);
      const port = n ? portsOf(n)[Number(idx)] : undefined;
      if (port) {
        onSelect(from!);
        setDrag({ kind: 'link', from: from!, port, x: p.x, y: p.y });
        return;
      }
    }
    const id = nodeAt(p);
    if (id) {
      const q = pos(id);
      onSelect(id);
      setDrag({ kind: 'node', id, dx: p.x - q.x, dy: p.y - q.y, x: q.x, y: q.y, moved: false });
      return;
    }
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3;
      setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
      setDrag({ ...drag, moved });
      return;
    }
    const p = toGraph(e);
    if (drag.kind === 'node') setDrag({ ...drag, x: p.x - drag.dx, y: p.y - drag.dy, moved: drag.moved || Math.hypot(p.x - drag.dx - drag.x, p.y - drag.dy - drag.y) > 2 });
    else setDrag({ ...drag, x: p.x, y: p.y });
  };
  const up = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    svg.current?.releasePointerCapture?.(e.pointerId);
    if (drag.kind === 'node' && drag.moved) onChange(moveNode(d, drag.id, drag.x, drag.y));
    else if (drag.kind === 'link') {
      const target = nodeAt(toGraph(e));
      onChange(connect(d, drag.from, drag.port, target && target !== drag.from ? target : undefined));
    } else if (drag.kind === 'pan' && !drag.moved) onSelect(null);
    setDrag(null);
  };
  const wheel = (e: ReactWheelEvent<SVGSVGElement>): void => {
    const p = toGraph(e);
    const zoom = Math.max(0.3, Math.min(2, view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const r = svg.current!.getBoundingClientRect();
    setView({ zoom, x: e.clientX - r.left - p.x * zoom, y: e.clientY - r.top - p.y * zoom });
  };

  const edgePath = (from: DialogueNode, port: Port, to: string): string => {
    const a = pos(from.id);
    const idx = portsOf(from).findIndex((x) => x.kind === port.kind && x.index === port.index);
    const o = portOffset(from, Math.max(0, idx));
    const t = byId.get(to)!;
    const b = pos(to);
    const x1 = a.x + o.x;
    const y1 = a.y + o.y;
    const x2 = b.x;
    const y2 = b.y + nodeHeight(t) / 2;
    const k = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`;
  };

  return (
    <div className="dgraph" data-testid="dg-wrap">
      <div className="row wrap">
        <button className="small" data-testid="dg-fit" onClick={fit} title="Zoom to show every card">
          Fit
        </button>
        <button className="small" data-testid="dg-zoom-in" onClick={() => setView((v) => ({ ...v, zoom: Math.min(2, v.zoom * 1.2) }))}>
          Zoom in
        </button>
        <button className="small" data-testid="dg-zoom-out" onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.3, v.zoom / 1.2) }))}>
          Zoom out
        </button>
        <button className="small" data-testid="dg-tidy" onClick={() => onChange({ ...d, nodes: d.nodes.map(({ x: _x, y: _y, ...n }) => n as DialogueNode) })} title="Forget where you moved the cards and lay them out again">
          Tidy up
        </button>
        <button className="small" data-testid="dg-delete" disabled={!selected} onClick={() => selected && (onChange(removeNode(d, selected)), onSelect(null))}>
          Delete the selected card
        </button>
      </div>
      <svg
        ref={svg}
        className="dg-canvas"
        data-testid="dg-canvas"
        role="application"
        aria-label="Conversation graph"
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onWheel={wheel}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
            onChange(removeNode(d, selected));
            onSelect(null);
          }
        }}
      >
        <defs>
          <marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#9aa3b2" />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {edges.map((e, i) => (
            <path key={i} d={edgePath(byId.get(e.from)!, e.port, e.to)} className="dg-edge" data-testid={`dg-edge-${e.from}-${e.to}`} fill="none" stroke="#9aa3b2" strokeWidth={2} markerEnd="url(#dg-arrow)" />
          ))}
          {drag?.kind === 'link' &&
            (() => {
              const n = byId.get(drag.from)!;
              const a = pos(n.id);
              const idx = Math.max(0, portsOf(n).findIndex((x) => x.kind === drag.port.kind && x.index === drag.port.index));
              const o = portOffset(n, idx);
              return <path d={`M${a.x + o.x},${a.y + o.y} L${drag.x},${drag.y}`} stroke="#6aa8ff" strokeWidth={2} strokeDasharray="5 4" fill="none" />;
            })()}
          {d.nodes.map((n) => {
            const p = pos(n.id);
            const h = nodeHeight(n);
            const ports = portsOf(n);
            const on = selected === n.id;
            return (
              <g key={n.id} transform={`translate(${p.x} ${p.y})`} data-testid={`dg-node-${n.id}`} opacity={live.has(n.id) || d.start === '' ? 1 : 0.5}>
                <rect width={NODE_W} height={h} rx={8} fill="#1b1e27" stroke={on ? '#6aa8ff' : '#3a3d48'} strokeWidth={on ? 3 : 1.5} />
                <rect width={NODE_W} height={22} rx={8} fill={COLOURS[n.type]} />
                <rect y={14} width={NODE_W} height={8} fill={COLOURS[n.type]} />
                <text x={10} y={16} fontSize={12} fontWeight={700} fill="#fff">
                  {NAMES[n.type]} · {n.id}
                  {d.start === n.id ? '  ▶ start' : ''}
                </text>
                <text x={10} y={40} fontSize={12} fill="#d6dbe6">
                  {clip(summary(n), 30)}
                </text>
                {n.type === 'choice' &&
                  n.options.map((o, i) => (
                    <text key={i} x={14} y={40 + 20 * (i + 1) - 2} fontSize={11} fill="#f0c98a">
                      {i + 1}. {clip(o.text || '(empty)', 24)}
                    </text>
                  ))}
                {n.type === 'branch' && (
                  <>
                    <text x={NODE_W - 38} y={h * 0.38 + 4} fontSize={11} fill="#9fe6a0">
                      yes
                    </text>
                    <text x={NODE_W - 32} y={h * 0.72 + 4} fontSize={11} fill="#ff9aa2">
                      no
                    </text>
                  </>
                )}
                <circle cx={0} cy={h / 2} r={5} fill="#9aa3b2" />
                {ports.map((port, i) => {
                  const o = portOffset(n, i);
                  return <circle key={i} cx={o.x} cy={o.y} r={7} fill="#6aa8ff" stroke="#0d0f14" strokeWidth={2} className="dg-port" data-port={`${n.id}|${i}`} data-testid={`dg-port-${n.id}-${i}`} />;
                })}
              </g>
            );
          })}
        </g>
      </svg>
      <p className="hint">Drag a card to move it. Drag from a blue dot to another card to connect them; drop on empty space to cut the link. Drag the background to pan, wheel to zoom.</p>
    </div>
  );
}

