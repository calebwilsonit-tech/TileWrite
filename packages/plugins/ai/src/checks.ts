import { checkMachine, checkTree, findPath, parsePoints, type BehaviorTree, type ProblemDef, type StateMachine, type ValidatorDef } from '@tilewright/plugin-sdk';

/** Mistakes in the thinking of characters: state machines and behaviour trees that cannot work, patrol routes that lead nowhere, bosses outside their room. */
export const aiChecks: ValidatorDef = {
  id: 'ai',
  check(doc) {
    const out: ProblemDef[] = [];
    let n = 0;
    for (const e of doc.entities) {
      const m = e.components.stateMachine as StateMachine | undefined;
      if (!m) continue;
      for (const text of checkMachine(m, (b) => e.components[b] !== undefined)) out.push({ id: `machine-${e.id}-${n++}`, severity: 'warning', message: `The state machine of "${e.name}": ${text}`, entity: e.id });
    }
    for (const e of doc.entities) {
      const tr = e.components.behaviorTree as BehaviorTree | undefined;
      if (!tr) continue;
      for (const text of checkTree(tr, (b) => e.components[b] !== undefined)) out.push({ id: `tree-${e.id}-${n++}`, severity: 'warning', message: `The behaviour tree of "${e.name}": ${text}`, entity: e.id });
      if (e.components.stateMachine !== undefined) {
        out.push({ id: `tree-machine-${e.id}`, severity: 'warning', message: `"${e.name}" has both a Behaviour Tree and a State Machine, which would fight over which behaviours are switched on. Use one of them.`, entity: e.id });
      }
    }
    for (const e of doc.entities) {
      const t = e.components.transform as { x: number; y: number } | undefined;
      const pat = e.components.patrol as { points?: string } | undefined;
      if (pat) {
        const pts = parsePoints(pat.points ?? '');
        if (pts.length < 2) {
          out.push({ id: `patrol-short-${e.id}`, severity: 'warning', message: `"${e.name}" has the Patrol behaviour but fewer than two route points, so it will stand still. Select it and use the Patrol path tool to click its route.`, entity: e.id });
        } else {
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i]!;
            const b = pts[(i + 1) % pts.length]!;
            if (doc.map.inBounds(Math.floor(a.x), Math.floor(a.y)) === false) {
              out.push({ id: `patrol-out-${e.id}-${i}`, severity: 'warning', message: `Patrol point ${i + 1} of "${e.name}" is outside the map.`, entity: e.id });
            } else if (i + 1 < pts.length && findPath(doc.map, a, b, { maxNodes: 6000 }) === null) {
              out.push({ id: `patrol-blocked-${e.id}-${i}`, severity: 'warning', message: `"${e.name}" cannot walk from patrol point ${i + 1} to point ${i + 2}: walls, pits, water or cliffs are in the way.`, entity: e.id });
            }
          }
        }
      }
      if (e.components.bossPhases && (e.components.bossPhases as { onlyInRoom?: boolean }).onlyInRoom && t) {
        const room = doc.regions.find((r) => r.bossActive && t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h);
        if (!room) {
          out.push({ id: `boss-room-${e.id}`, severity: 'warning', message: `"${e.name}" only fights while the player is in its room, but it is not inside a Region marked "Bosses here only act while the player is inside". Draw a Region around it and tick that box (or turn off "Only fights while the player is in its room").`, entity: e.id });
        }
      }
    }
    return out;
  },
};
