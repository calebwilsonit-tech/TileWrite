import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CutsceneData } from '@tilewright/runtime';
import { TRACKS, hasDuration, schedule, setDuration, totalTime, type Block } from '../model/cutscene-timeline';

const LABEL_W = 132;
const LANE_H = 26;
const TRACK_PAD = 8;
const RULER_H = 22;

const FILL: Record<string, string> = { camera: '#4f7fd1', people: '#2f9e6e', story: '#c9822e', world: '#7b61c2' };
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

/**
 * A cutscene on a time line: one row for the camera and screen, one for people, one for talking, one for the world and
 * sound. Steps that are marked "keep going" sit beside the next one. Click a block to edit it below; drag the right edge
 * of a timed block (a wait, a camera move, a fade, a shake) to change how long it lasts. Lengths of speech and walks
 * depend on the player and the walk, so those blocks are drawn with a dashed edge and are only a guess.
 */
export function CutsceneTimeline({ c, selected, onSelect, onChange }: { c: CutsceneData; selected: string | null; onSelect(id: string | null): void; onChange(next: CutsceneData): void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(70); // pixels per second
  const [drag, setDrag] = useState<{ id: string; start: number; seconds: number } | null>(null);
  const blocks = useMemo(() => schedule(c), [c]);
  const total = Math.max(5, Math.ceil(totalTime(blocks)) + 1);
  const lanes = (track: string): number => Math.max(1, ...blocks.filter((b) => b.track === track).map((b) => b.lane + 1));
  const trackTop: Record<string, number> = {};
  let y = RULER_H;
  for (const t of TRACKS) {
    trackTop[t.id] = y;
    y += lanes(t.id) * LANE_H + TRACK_PAD * 2;
  }
  const height = y + 4;
  const width = LABEL_W + total * zoom + 40;
  const xOf = (s: number): number => LABEL_W + s * zoom;
  const secondsAt = (clientX: number, start: number): number => (clientX - svg.current!.getBoundingClientRect().left - LABEL_W) / zoom - start;
  const shown = (b: Block): { w: number } => ({ w: Math.max(b.instant ? 14 : 22, (drag?.id === b.id ? drag.seconds : b.duration) * zoom) });

  const down = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    const el = (e.target as Element).closest('[data-block]');
    if (!el) {
      onSelect(null);
      return;
    }
    const id = el.getAttribute('data-block')!;
    onSelect(id);
    if ((e.target as Element).getAttribute('data-edge') !== null) {
      const b = blocks.find((x) => x.id === id)!;
      svg.current!.setPointerCapture(e.pointerId);
      setDrag({ id, start: b.start, seconds: b.duration });
    }
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (drag) setDrag({ ...drag, seconds: Math.max(0, secondsAt(e.clientX, drag.start)) });
  };
  const up = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    svg.current?.releasePointerCapture?.(e.pointerId);
    onChange(setDuration(c, drag.id, Math.max(0, secondsAt(e.clientX, drag.start))));
    setDrag(null);
  };

  return (
    <div className="ctimeline" data-testid="ct-wrap">
      <div className="row wrap">
        <button className="small" data-testid="ct-zoom-in" onClick={() => setZoom((z) => Math.min(200, z * 1.25))}>
          Zoom in
        </button>
        <button className="small" data-testid="ct-zoom-out" onClick={() => setZoom((z) => Math.max(20, z / 1.25))}>
          Zoom out
        </button>
        <small data-testid="ct-total">About {totalTime(blocks).toFixed(1)} seconds{blocks.some((b) => b.open) ? ' (more when the player reads or walks)' : ''}</small>
      </div>
      <div className="ct-scroll">
        <svg ref={svg} className="ct-canvas" data-testid="ct-canvas" width={width} height={height} role="application" aria-label="Cutscene timeline" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
          {Array.from({ length: total + 1 }, (_, s) => (
            <g key={s}>
              <line x1={xOf(s)} y1={RULER_H - 6} x2={xOf(s)} y2={height} stroke="#2a2d37" />
              <text x={xOf(s) + 3} y={13} fontSize={10} fill="#8b92a5">
                {s}s
              </text>
            </g>
          ))}
          {TRACKS.map((t) => (
            <g key={t.id}>
              <rect x={0} y={trackTop[t.id]} width={width} height={lanes(t.id) * LANE_H + TRACK_PAD * 2} fill={t.id === 'camera' || t.id === 'story' ? '#181b22' : 'transparent'} />
              <text x={8} y={trackTop[t.id]! + TRACK_PAD + 17} fontSize={11} fill="#aab1c2">
                {t.label}
              </text>
            </g>
          ))}
          {blocks.map((b) => {
            const top = trackTop[b.track]! + TRACK_PAD + b.lane * LANE_H;
            const { w } = shown(b);
            const on = selected === b.id;
            return (
              <g key={b.id} data-block={b.id} data-testid={`ct-block-${b.index}`}>
                {b.instant ? (
                  <polygon points={`${xOf(b.start)},${top + 12} ${xOf(b.start) + 7},${top + 3} ${xOf(b.start) + 14},${top + 12} ${xOf(b.start) + 7},${top + 21}`} fill={FILL[b.track]} stroke={on ? '#fff' : 'none'} strokeWidth={2}>
                    <title>{b.label}</title>
                  </polygon>
                ) : (
                  <>
                    <rect x={xOf(b.start)} y={top} width={w} height={LANE_H - 4} rx={5} fill={FILL[b.track]} stroke={on ? '#fff' : '#0d0f14'} strokeWidth={on ? 2.5 : 1} opacity={b.parallel ? 0.8 : 1}>
                      <title>{b.label}</title>
                    </rect>
                    <text x={xOf(b.start) + 6} y={top + 15} fontSize={11} fill="#fff" pointerEvents="none">
                      {clip(b.label, Math.floor(w / 6.5))}
                    </text>
                    {b.open && <line x1={xOf(b.start) + w} y1={top + 2} x2={xOf(b.start) + w} y2={top + LANE_H - 6} stroke="#fff" strokeWidth={2} strokeDasharray="3 3" pointerEvents="none" />}
                    {hasDuration(b.type) && <rect data-edge="" data-testid={`ct-edge-${b.index}`} x={xOf(b.start) + w - 6} y={top} width={8} height={LANE_H - 4} fill="#ffffff" opacity={0.35} style={{ cursor: 'ew-resize' }} />}
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="hint">Click a block to edit it below. Drag the right edge of a wait, camera move, fade or shake to change its length. Blocks drawn side by side were marked “keep going”.</p>
    </div>
  );
}
