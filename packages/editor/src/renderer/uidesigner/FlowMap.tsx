import { useRef } from 'react';
import { screenBlocksInput, screenPauses, type UiDoc } from '@tilewright/runtime';
import { flowEdges } from './ui-edit';
import { designer, useDesigner } from './state';

const W = 150;
const H = 54;

/** The screens as boxes, with an arrow wherever a button opens another screen. Drag a box to put it where you like. */
export function FlowMap({ doc }: { doc: UiDoc }) {
  const screenId = useDesigner((s) => s.screenId);
  const svg = useRef<SVGSVGElement>(null);
  const edges = flowEdges(doc);
  const at = (name: string): { x: number; y: number } | null => {
    const s = doc.screens.find((x) => x.name === name);
    return s ? { x: s.mapX + W / 2, y: s.mapY + H / 2 } : null;
  };
  const extent = { w: Math.max(700, ...doc.screens.map((s) => s.mapX + W + 60)), h: Math.max(380, ...doc.screens.map((s) => s.mapY + H + 60)) };
  const backs = edges.filter((e) => e.to === '(back)');
  const grouped = new Map<string, number>();
  const drag = (e: React.PointerEvent, id: string): void => {
    e.stopPropagation();
    designer.set({ screenId: id });
    const sx = e.clientX;
    const sy = e.clientY;
    const before = doc;
    const s0 = doc.screens.find((s) => s.id === id)!;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (Math.hypot(dx, dy) < 3 && !moved) return;
      moved = true;
      designer.live({ ...before, screens: before.screens.map((s) => (s.id === id ? { ...s, mapX: Math.max(0, Math.round(s0.mapX + dx)), mapY: Math.max(0, Math.round(s0.mapY + dy)) } : s)) });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) designer.commit(before);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="ui-flow" data-testid="ui-flow">
      <svg ref={svg} width={extent.w} height={extent.h}>
        <defs>
          <marker id="flow-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
            <path d="M0,0 L10,4 L0,8 z" fill="#9fb4ff" />
          </marker>
        </defs>
        {edges
          .filter((e) => e.to !== '(back)')
          .map((e, i) => {
            const a = at(e.from);
            const b = at(e.to);
            if (!a || !b) return null;
            const key = `${e.from}>${e.to}`;
            const n = grouped.get(key) ?? 0;
            grouped.set(key, n + 1);
            const self = e.from === e.to;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - 24 - n * 16;
            const d = self ? `M ${a.x + W / 2} ${a.y} c 40 -30 40 30 0 0` : `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
            return (
              <g key={i} data-testid="ui-flow-edge">
                <path d={d} fill="none" stroke="#9fb4ff" strokeWidth={2} markerEnd="url(#flow-arrow)" />
                <text x={mx} y={my + 14} fill="#cfd6ff" fontSize={11} textAnchor="middle">
                  {e.label}
                </text>
              </g>
            );
          })}
        {doc.screens.map((s) => (
          <g key={s.id} data-testid={`ui-flow-screen-${s.name}`} onPointerDown={(e) => drag(e, s.id)} onDoubleClick={() => designer.set({ screenId: s.id, mode: 'layout' })} style={{ cursor: 'move' }}>
            <rect x={s.mapX} y={s.mapY} width={W} height={H} rx={8} fill={s.id === screenId ? '#32406e' : '#252a38'} stroke={s.id === screenId ? '#ffd34a' : '#5a6385'} strokeWidth={2} />
            <text x={s.mapX + W / 2} y={s.mapY + 24} textAnchor="middle" fill="#fff" fontSize={14} fontWeight={700}>
              {s.name}
            </text>
            <text x={s.mapX + W / 2} y={s.mapY + 42} textAnchor="middle" fill="#aab" fontSize={11}>
              {[s.opensOnStart ? 'opens first' : '', screenPauses(s) ? 'pauses the game' : '', screenBlocksInput(s) && !screenPauses(s) ? 'takes the buttons' : ''].filter(Boolean).join(' · ')}
            </text>
            {s.opensOnStart && <circle cx={s.mapX - 8} cy={s.mapY + H / 2} r={6} fill="#6fe08a" />}
          </g>
        ))}
      </svg>
      {backs.length > 0 && (
        <p className="hint">
          “Back” buttons: {backs.map((b) => `${b.from} (${b.label})`).join(', ')} return to the screen underneath.
        </p>
      )}
      <p className="hint">Drag a box to move it. Double-click a screen to design it. Arrows come from buttons that open another screen.</p>
    </div>
  );
}
