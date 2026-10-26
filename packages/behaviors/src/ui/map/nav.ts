import type { MapSpec } from '@tilewright/runtime';
import type { MapMarker } from './markers';

/**
 * Moving the highlight from marker to marker: by the direction on the screen, in list order, or to the nearest one; round the ends or
 * stopping at them. Pure functions of where the markers are on the screen.
 */

export type Dir = 'up' | 'down' | 'left' | 'right';
const VECTOR: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** The markers the highlight can land on, in the order the list gives them. */
export const choosable = (markers: MapMarker[]): MapMarker[] => markers.filter((m) => m.choosable);

/** The marker the highlight is on, or null. */
export const highlighted = (markers: MapMarker[], id: string): MapMarker | null => markers.find((m) => m.id === id) ?? null;

/** Where the highlight starts: the first marker, the one where the followed object is, or nowhere. */
export function startMarker(markers: MapMarker[], start: MapSpec['nav']['start'], here: { x: number; y: number } | null): MapMarker | null {
  const list = choosable(markers);
  if (start === 'none' || list.length === 0) return null;
  if (start === 'here' && here) {
    let best: MapMarker | null = null;
    let d = Infinity;
    for (const m of list) {
      const dd = Math.hypot(m.x - here.x, m.y - here.y);
      if (dd < d) {
        d = dd;
        best = m;
      }
    }
    return best;
  }
  return list[0]!;
}

/**
 * The marker one move away in a direction. `direction` weighs how well a marker lines up with the way pressed; `nearest` takes the
 * closest of those that lie that way; `order` goes through the list (up and left are before, down and right after). With nothing that
 * way, `wrap` goes to the marker at the far side; without it the highlight stays (and null says nothing moved).
 */
export function moveHighlight(markers: MapMarker[], from: string, dir: Dir, mode: MapSpec['nav']['mode'], wrap: boolean): MapMarker | null {
  const list = choosable(markers);
  if (list.length === 0) return null;
  const cur = list.find((m) => m.id === from);
  if (!cur) return list[0]!;
  if (mode === 'order') return stepHighlight(markers, from, dir === 'up' || dir === 'left' ? -1 : 1, wrap);
  const [vx, vy] = VECTOR[dir];
  let best: MapMarker | null = null;
  let score = Infinity;
  for (const m of list) {
    if (m.id === cur.id) continue;
    const dx = m.sx - cur.sx;
    const dy = m.sy - cur.sy;
    const along = dx * vx + dy * vy;
    if (along <= 0.5) continue;
    const across = Math.abs(dx * vy - dy * vx);
    // by direction: a marker straight that way beats a nearer one off to the side; nearest: only the distance counts
    const s = mode === 'nearest' ? Math.hypot(dx, dy) : along + across * 2;
    if (s < score) {
      score = s;
      best = m;
    }
  }
  if (best || !wrap) return best;
  // nothing that way: come round to the other side, the marker furthest back in line with this one
  let far: MapMarker | null = null;
  let farScore = -Infinity;
  for (const m of list) {
    if (m.id === cur.id) continue;
    const dx = m.sx - cur.sx;
    const dy = m.sy - cur.sy;
    const along = dx * vx + dy * vy;
    const across = Math.abs(dx * vy - dy * vx);
    const s = -along - across * 2;
    if (s > farScore) {
      farScore = s;
      far = m;
    }
  }
  return far;
}

/** The next or the earlier marker in list order. */
export function stepHighlight(markers: MapMarker[], from: string, delta: -1 | 1, wrap: boolean): MapMarker | null {
  const list = choosable(markers);
  if (list.length === 0) return null;
  const i = list.findIndex((m) => m.id === from);
  if (i < 0) return list[delta > 0 ? 0 : list.length - 1]!;
  const j = i + delta;
  if (j < 0) return wrap ? list[list.length - 1]! : null;
  if (j >= list.length) return wrap ? list[0]! : null;
  return list[j]!;
}
