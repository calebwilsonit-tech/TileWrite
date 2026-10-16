import { EMPTY_TILE, FLAG, SLOPE_RISE, groundHeightAt, reachableCells } from '@tilewright/runtime';
import { highSide, lowSide, meetsTop } from '../tools/algorithms';
import type { EditorDoc } from './doc';

export interface Problem {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  /** Where "go to" takes you. */
  target?: { kind: 'entity'; id: string; x: number; y: number } | { kind: 'cell'; x: number; y: number } | { kind: 'region'; id: string; x: number; y: number };
}

interface T {
  x: number;
  y: number;
  h: number;
}

/**
 * Checks a scene for mistakes a designer can fix, in plain English.
 * (M3 covers the basics; M9 adds bypass and soft-lock detection.)
 */
export function validateScene(doc: EditorDoc): Problem[] {
  const out: Problem[] = [];
  const map = doc.map;

  const players = doc.entities.filter((e) => e.tags.includes('player'));
  if (players.length === 0) {
    out.push({ id: 'no-player', severity: 'error', message: 'This scene has no player start, so the game has nowhere to begin. Use the Place tool to add one.' });
  } else if (players.length > 1) {
    out.push({
      id: 'many-players',
      severity: 'warning',
      message: `This scene has ${players.length} player starts; only the first one will be used.`,
      target: pos('entity', players[1]!.id, players[1]!.components.transform as T),
    });
  }

  for (const e of doc.entities) {
    const t = e.components.transform as T | undefined;
    if (!t) continue;
    const cx = Math.floor(t.x);
    const cy = Math.floor(t.y);
    if (!map.inBounds(cx, cy)) {
      out.push({ id: `outside-${e.id}`, severity: 'error', message: `"${e.name}" is outside the map.`, target: pos('entity', e.id, t) });
      continue;
    }
    if (map.getTile(cx, cy) === EMPTY_TILE) {
      out.push({ id: `void-${e.id}`, severity: 'warning', message: `"${e.name}" is standing on empty space.`, target: pos('entity', e.id, t) });
    } else if (map.getFlags(cx, cy) & FLAG.PIT && map.getDeck(cx, cy) === 0 && e.components.body) {
      out.push({ id: `pit-${e.id}`, severity: 'warning', message: `"${e.name}" starts over a pit and will fall.`, target: pos('entity', e.id, t) });
    } else if (map.getFlags(cx, cy) & FLAG.BLOCK) {
      out.push({ id: `blocked-${e.id}`, severity: 'warning', message: `"${e.name}" is inside a blocked cell.`, target: pos('entity', e.id, t) });
    } else if (e.tags.includes('player') && Math.abs(groundHeightAt(map, t.x, t.y) - t.h) > 0.5 && map.getDeck(cx, cy) === 0) {
      out.push({
        id: `height-${e.id}`,
        severity: 'warning',
        message: `"${e.name}" is at height ${t.h} but the ground here is at ${groundHeightAt(map, t.x, t.y).toFixed(1)}; it will drop or be stuck.`,
        target: pos('entity', e.id, t),
      });
    }
  }

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const slope = map.getSlope(x, y);
      if (!slope) continue;
      const base = map.getHeight(x, y);
      const low = lowSide(x, y, slope.dir);
      const high = highSide(x, y, slope.dir);
      const label = slope.style === 'stairs' ? 'Stairs' : 'Ramp';
      if (!map.inBounds(low.x, low.y) || map.getTile(low.x, low.y) === EMPTY_TILE) {
        out.push({ id: `slope-low-${x}-${y}`, severity: 'warning', message: `${label} at (${x}, ${y}) have nothing to climb up from.`, target: { kind: 'cell', x, y } });
      } else if (map.topHeight(low.x, low.y) !== base) {
        out.push({
          id: `slope-base-${x}-${y}`,
          severity: 'warning',
          message: `${label} at (${x}, ${y}) start at level ${base} but the floor below them is at level ${map.topHeight(low.x, low.y)}, so there is a step you cannot climb.`,
          target: { kind: 'cell', x, y },
        });
      }
      if (!map.inBounds(high.x, high.y) || map.getTile(high.x, high.y) === EMPTY_TILE) {
        out.push({ id: `slope-high-${x}-${y}`, severity: 'warning', message: `${label} at (${x}, ${y}) lead nowhere.`, target: { kind: 'cell', x, y } });
      } else if (!meetsTop(map, high.x, high.y, base + SLOPE_RISE)) {
        out.push({
          id: `slope-top-${x}-${y}`,
          severity: 'warning',
          message: `${label} at (${x}, ${y}) top out at level ${base + SLOPE_RISE} but the next cell is at level ${map.getHeight(high.x, high.y)}.`,
          target: { kind: 'cell', x, y },
        });
      }
    }
  }

  for (const r of doc.regions) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > map.width || r.y + r.h > map.height) {
      out.push({ id: `region-${r.id}`, severity: 'warning', message: `Region "${r.name}" sticks out past the edge of the map.`, target: { kind: 'region', id: r.id, x: r.x + r.w / 2, y: r.y + r.h / 2 } });
    }
  }

  // Walkable ground the player can never reach is usually a mistake (a missing staircase).
  if (players.length > 0) {
    const t = players[0]!.components.transform as T | undefined;
    if (t && map.inBounds(Math.floor(t.x), Math.floor(t.y))) {
      const reach = reachableCells(map, { x: Math.floor(t.x), y: Math.floor(t.y) });
      let walkable = 0;
      let island: { x: number; y: number } | null = null;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const f = map.getFlags(x, y);
          if (map.getTile(x, y) === EMPTY_TILE || f & (FLAG.BLOCK | FLAG.PIT | FLAG.WATER)) continue;
          walkable++;
          if (!reach.has(`${x},${y}`) && !island && map.getHeight(x, y) === 0) island = { x, y };
        }
      }
      if (walkable > 0 && island) {
        out.push({
          id: 'unreachable',
          severity: 'warning',
          message: `Some floor cannot be reached from the player start (for example around (${island.x}, ${island.y})). Add stairs or a bridge if it should be reachable.`,
          target: { kind: 'cell', x: island.x, y: island.y },
        });
      }
    }
  }

  return out;
}

function pos<K extends 'entity' | 'region'>(kind: K, id: string, t: T | undefined): Problem['target'] {
  return { kind, id, x: t?.x ?? 0, y: t?.y ?? 0 } as Problem['target'];
}
