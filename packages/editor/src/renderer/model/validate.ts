import { behaviorList, checkMachine, checkSheet, checkTree, getBehavior, parsePoints, type BehaviorTree, type StateMachine } from '@tilewright/behaviors';
import { EMPTY_TILE, FLAG, SLOPE_RISE, findPath, groundHeightAt, reachableCells, textBridgeCells } from '@tilewright/runtime';
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
export function validateScene(doc: EditorDoc, sprites?: ReadonlySet<string>, prefabNames?: ReadonlySet<string>, storyVars?: ReadonlySet<string>, sounds?: ReadonlySet<string>): Problem[] {
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
    const asset = (e.components.sprite as { asset?: string } | undefined)?.asset;
    if (sprites && asset && !sprites.has(asset)) {
      out.push({
        id: `sprite-missing-${e.id}`,
        severity: 'warning',
        message: `"${e.name}" uses the sprite "${asset}", which is not in this project (it was deleted or renamed). It is drawn as a plain shape until you pick a sprite again.`,
        target: t ? pos('entity', e.id, t) : undefined,
      });
    }
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
    } else if (map.blockedAt(cx, cy, t.h, 1)) {
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

  // state machines: states and arrows that cannot work
  for (const e of doc.entities) {
    const m = e.components.stateMachine as StateMachine | undefined;
    if (!m) continue;
    const t = e.components.transform as T | undefined;
    for (const text of checkMachine(m, (b) => e.components[b] !== undefined)) {
      out.push({ id: `machine-${e.id}-${out.length}`, severity: 'warning', message: `The state machine of "${e.name}": ${text}`, target: t ? pos('entity', e.id, t) : undefined });
    }
  }

  // behaviour trees: nodes and branches that cannot work
  for (const e of doc.entities) {
    const tr = e.components.behaviorTree as BehaviorTree | undefined;
    if (!tr) continue;
    const t = e.components.transform as T | undefined;
    for (const text of checkTree(tr, (b) => e.components[b] !== undefined)) {
      out.push({ id: `tree-${e.id}-${out.length}`, severity: 'warning', message: `The behaviour tree of "${e.name}": ${text}`, target: t ? pos('entity', e.id, t) : undefined });
    }
    if (e.components.stateMachine !== undefined) out.push({ id: `tree-machine-${e.id}`, severity: 'warning', message: `"${e.name}" has both a Behaviour Tree and a State Machine, which would fight over which behaviours are switched on. Use one of them.`, target: t ? pos('entity', e.id, t) : undefined });
  }

  // behaviours that need something the object does not have
  for (const e of doc.entities) {
    const t = e.components.transform as T | undefined;
    for (const b of behaviorList()) {
      if (e.components[b.id] === undefined) continue;
      for (const need of Object.keys(b.requires)) {
        if (e.components[need] === undefined) {
          out.push({ id: `needs-${e.id}-${b.id}-${need}`, severity: 'warning', message: `"${e.name}" has the ${b.name} behaviour but is missing its ${need}, so it will not work. Remove and add the behaviour again.`, target: t ? pos('entity', e.id, t) : undefined });
        }
      }
    }
  }

  // scripts that were deleted or no longer compile
  for (const e of doc.entities) {
    for (const key of Object.keys(e.components)) {
      if (key.startsWith('script_') && !getBehavior(key)) {
        const t = e.components.transform as T | undefined;
        out.push({ id: `script-missing-${e.id}-${key}`, severity: 'error', message: `"${e.name}" uses the script "${key.slice(7).replace(/_/g, ' ')}", which does not exist (it was deleted, renamed, or has a mistake and cannot start). Open the Code editor to fix it, or remove the behaviour from the object.`, target: t ? pos('entity', e.id, t) : undefined });
      }
    }
  }
  // story-puzzle and echo settings that cannot work
  for (const e of doc.entities) {
    const t = e.components.transform as T | undefined;
    const stone = e.components.sentenceStone as { words?: string } | undefined;
    if (stone && (stone.words ?? '').split(',').filter((w) => w.trim()).length < 2) {
      out.push({ id: `stone-words-${e.id}`, severity: 'warning', message: `The sentence stone "${e.name}" has fewer than two swappable words, so there is nothing for the player to swap. Type words separated by commas.`, target: t ? pos('entity', e.id, t) : undefined });
    }
    const rec = e.components.echoRecorder as { capacity?: number; capacityVariable?: string } | undefined;
    if (rec && (rec.capacity ?? 0) <= 0 && !rec.capacityVariable) {
      out.push({ id: `echo-capacity-${e.id}`, severity: 'warning', message: `"${e.name}" can hold 0 echoes and has no variable to add more, so the Echo button will do nothing.`, target: t ? pos('entity', e.id, t) : undefined });
    }
  }

  // guards, patrols and bosses
  for (const e of doc.entities) {
    const t = e.components.transform as T | undefined;
    const target = t ? pos('entity', e.id, t) : undefined;
    const pat = e.components.patrol as { points?: string } | undefined;
    if (pat) {
      const pts = parsePoints(pat.points ?? '');
      if (pts.length < 2) {
        out.push({ id: `patrol-short-${e.id}`, severity: 'warning', message: `"${e.name}" has the Patrol behaviour but fewer than two route points, so it will stand still. Select it and use the Patrol path tool to click its route.`, target });
      } else {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]!;
          const b = pts[(i + 1) % pts.length]!;
          if (doc.map.inBounds(Math.floor(a.x), Math.floor(a.y)) === false) {
            out.push({ id: `patrol-out-${e.id}-${i}`, severity: 'warning', message: `Patrol point ${i + 1} of "${e.name}" is outside the map.`, target });
          } else if (i + 1 < pts.length && findPath(doc.map, a, b, { maxNodes: 6000 }) === null) {
            out.push({ id: `patrol-blocked-${e.id}-${i}`, severity: 'warning', message: `"${e.name}" cannot walk from patrol point ${i + 1} to point ${i + 2}: walls, pits, water or cliffs are in the way.`, target });
          }
        }
      }
    }
    if (e.components.bossPhases && (e.components.bossPhases as { onlyInRoom?: boolean }).onlyInRoom && t) {
      const room = doc.regions.find((r) => r.bossActive && t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h);
      if (!room) {
        out.push({ id: `boss-room-${e.id}`, severity: 'warning', message: `"${e.name}" only fights while the player is in its room, but it is not inside a Region marked "Bosses here only act while the player is inside". Draw a Region around it and tick that box (or turn off "Only fights while the player is in its room").`, target });
      }
    }
    const h = e.components.health as { max?: number } | undefined;
    if (e.components.damageOnTouch && !h && e.tags.includes('enemy')) {
      out.push({ id: `enemy-nohealth-${e.id}`, severity: 'warning', message: `"${e.name}" hurts on touch but has no Health, so it cannot be defeated.`, target });
    }
  }
  // switches and gates that are not connected to anything
  const sheetText = JSON.stringify(doc.events);
  for (const e of doc.entities) {
    const t = e.components.transform as T | undefined;
    const target = t ? pos('entity', e.id, t) : undefined;
    const talks = (id: string): boolean => sheetText.includes(`id:${id}`) || sheetText.includes(`name:${e.name}`);
    const sends = doc.wires.some((w) => w.from.entity === e.id) || talks(e.id);
    const kinds: [string, string][] = [['pressurePlate', 'pressure plate'], ['lever', 'lever'], ['lightSensor', 'light sensor'], ['triggerZone', 'trigger zone'], ['timer', 'timer']];
    for (const [id, label] of kinds) {
      if (e.components[id] !== undefined && !sends) {
        out.push({ id: `unused-${e.id}-${id}`, severity: 'warning', message: `The ${label} "${e.name}" is not connected to anything, so using it does nothing. Use the Wire tool to connect it to a gate or another object (or use it in an event row).`, target });
      }
    }
    const gate = e.components.gate as { invert?: boolean } | undefined;
    if (gate && !gate.invert && !doc.wires.some((w) => w.to.entity === e.id && w.to.input === 'open') && !talks(e.id)) {
      out.push({ id: `gate-shut-${e.id}`, severity: 'warning', message: `The gate "${e.name}" has nothing connected to open it, so it will stay shut for ever. Wire a plate, lever or logic gate to it.`, target });
    }
  }
  // wires must join real objects through signals they really have
  const signalsOf = (entityId: string, side: 'inputs' | 'outputs'): Set<string> => {
    const e = doc.getEntity(entityId);
    const names = new Set<string>();
    if (!e) return names;
    for (const b of behaviorList()) if (e.components[b.id] !== undefined) for (const s of b[side]) names.add(s.name);
    return names;
  };
  for (const w of doc.wires) {
    const from = doc.getEntity(w.from.entity);
    const to = doc.getEntity(w.to.entity);
    if (!from || !to) {
      out.push({ id: `wire-gone-${w.id}`, severity: 'warning', message: 'A wire connects to an object that no longer exists.' });
      continue;
    }
    const ft = from.components.transform as T | undefined;
    if (!signalsOf(from.id, 'outputs').has(w.from.output)) {
      out.push({ id: `wire-out-${w.id}`, severity: 'warning', message: `"${from.name}" does not send a signal called "${w.from.output}" (its behaviour was removed?), so the wire to "${to.name}" does nothing.`, target: ft ? pos('entity', from.id, ft) : undefined });
    } else if (!signalsOf(to.id, 'inputs').has(w.to.input)) {
      out.push({ id: `wire-in-${w.id}`, severity: 'warning', message: `"${to.name}" does not receive a signal called "${w.to.input}" (its behaviour was removed?), so the wire from "${from.name}" does nothing.`, target: ft ? pos('entity', from.id, ft) : undefined });
    }
  }

  if (sounds) {
    for (const r of doc.regions) {
      if (r.music && !sounds.has(r.music)) out.push({ id: `music-missing-${r.id}`, severity: 'warning', message: `The region "${r.name}" plays the music "${r.music}", which is not in Assets -> Sounds.`, target: { kind: 'region', id: r.id, x: r.x, y: r.y } });
    }
    for (const e of doc.entities) {
      const src = e.components.soundSource as { sound?: string } | undefined;
      if (!src) continue;
      const t = e.components.transform as { x: number; y: number } | undefined;
      const target = t ? { kind: 'entity' as const, id: e.id, x: t.x, y: t.y } : undefined;
      if (!src.sound) out.push({ id: `sound-empty-${e.id}`, severity: 'warning', message: `"${e.name}" is a Sound Source with no sound chosen, so it is silent.`, target });
      else if (!sounds.has(src.sound)) out.push({ id: `sound-missing-${e.id}`, severity: 'warning', message: `"${e.name}" plays the sound "${src.sound}", which is not in Assets -> Sounds.`, target });
    }
  }

  // the event sheet
  const names = { entity: (id: string): string | undefined => doc.getEntity(id)?.name };
  for (const p of checkSheet(doc.events, { entityIds: new Set(doc.entities.map((e) => e.id)), tags: new Set(doc.entities.flatMap((e) => e.tags)), variables: new Set([...doc.variables.map((v) => v.name), ...doc.entities.map((e) => (e.components.pickup as { variable?: string } | undefined)?.variable ?? '').filter(Boolean)]), prefabs: prefabNames ?? new Set<string>(), ...(storyVars ? { storyVariables: storyVars } : {}), ...(sounds ? { sounds } : {}) }, names)) {
    out.push({ id: `events-${p.rowId}-${out.length}`, severity: 'warning', message: `Event sheet: ${p.text}` });
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
      const reach = reachableCells(map, { x: Math.floor(t.x), y: Math.floor(t.y) }, { bridges: textBridgeCells(doc.entities, doc.wires) });
      let walkable = 0;
      let island: { x: number; y: number } | null = null;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const f = map.getFlags(x, y);
          if (map.getTile(x, y) === EMPTY_TILE || map.cellBlocked(x, y) || f & (FLAG.PIT | FLAG.WATER)) continue;
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
