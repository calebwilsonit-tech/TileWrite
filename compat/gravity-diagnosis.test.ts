/**
 * Phase 3, step 4.2: the owner's two gravity problems, reproduced on their own project ("Upside Down").
 * These tests describe what the project does TODAY, so the write-up in docs/gravity_diagnosis.md stays checkable; when the
 * owner's script is changed (with their approval), the expectations change with it.
 * They are skipped only when the owner's project is not in compat/projects, or its script "Gravity Flip" (what all three are about) is not
 * there; if the script is there and the walk does not do what it did, they FAIL: that is the point of them. (They are not skipped by what
 * they find, so an engine change that stops the player gluing to the wall cannot hide as a skip.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { C, FLAG, boxAt, type TransformIso } from '@tilewright/runtime';
import { gameOn, loadProject, unload } from './harness/load';
import { COMPAT } from './harness/corpus';
import { scenariosOf } from './scenarios';

const dir = path.join(COMPAT, 'projects', 'Demo');
const have = fs.existsSync(path.join(dir, 'project.json')) && fs.existsSync(path.join(dir, 'assets', 'scripts', 'Gravity Flip.script.ts'));

describe.skipIf(!have)('the owner\'s gravity project: problem 2, blocks that are not "wall" blocks are passed through', () => {
  it('while the script holds the player to a surface it walks straight through a blocker cell the engine would stop it at', async () => {
    const p = await loadProject(dir);
    try {
      const wall = scenariosOf(dir)[0]!;
      const g = gameOn(p, wall.scene!);
      const map = g.sim.map!;
      let glued = 0;
      let insideBlocker = 0;
      const where: string[] = [];
      for (const step of wall.steps) {
        for (let i = 0; i < step.ticks; i++) {
          g.step(i === 0 || step.ticks > 2 ? step.hold : {});
          const t = g.player.get<TransformIso>(C.Transform)!;
          if (g.sim.runtime.vars.gravityFlipped === 1) {
            glued++;
            const cx = Math.floor(t.x);
            const cy = Math.floor(t.y);
            if (map.getFlags(cx, cy) & FLAG.BLOCK) {
              insideBlocker++;
              if (!where.includes(`${cx},${cy}`)) where.push(`${cx},${cy}`);
            }
          }
        }
      }
      expect(glued).toBeGreaterThan(300);
      expect(insideBlocker, `the player was inside blocker cells ${where.join(' ')} while glued`).toBeGreaterThan(0);

      // the same walk on the ground is stopped by that cell: the engine's own collision does what the owner expects
      const h = gameOn(p, wall.scene!);
      const start = h.player.get<TransformIso>(C.Transform)!;
      let entered = 0;
      for (let i = 0; i < 400; i++) {
        h.step({ move_up: 1, move_right: 1 }); // along -y, up the room, into the wall segment across it at y = 5
        const t = h.player.get<TransformIso>(C.Transform)!;
        if (map.getFlags(Math.floor(t.x), Math.floor(t.y)) & FLAG.BLOCK) entered++;
      }
      void start;
      expect(entered).toBe(0);
    } finally {
      unload();
    }
  });

  it('the script turns collision off for the player (noclip) and moves it by writing its position', async () => {
    const source = fs.readFileSync(path.join(dir, 'assets', 'scripts', 'Gravity Flip.script.ts'), 'utf8');
    expect(source).toMatch(/body\.noclip = true/);
    expect(source).toMatch(/me\.x = st\.x; me\.y = st\.y; me\.h = st\.h;/);
    // and it only knows about solid things that carry the tag "protrusion" (Wall Platform objects) or that were typed into its lists
    expect(source).toMatch(/findAll\("tag:protrusion"\)/);
    expect(source).toMatch(/ledgeSouth/);
    // it never asks the map what is solid
    expect(source).not.toMatch(/cellBlocked|blockedAt|FLAG/);
  });
});

describe.skipIf(!have)('the owner\'s gravity project: problem 1, a block turns see-through as if the player were behind it', () => {
  it('on the west wall the old rule fades the next tall cell for some positions and not others, though it is never in the way', async () => {
    const p = await loadProject(dir);
    try {
      const g = gameOn(p, 'scenes/main.scene.json');
      const map = g.sim.map!;
      const { fadesLegacy, blocksView } = await import('@tilewright/runtime');
      let wrong = 0;
      const cells = new Set<string>();
      for (let u = 1.5; u <= 8.5; u += 0.1) {
        for (let h = 0.5; h <= 5; h += 0.5) {
          const focus = boxAt(0, 1.15, u, h, 0.6, 0.6, 1.2, 3); // where the script puts the player on the west wall: 0.15 in front of the wall face
          for (let y = 0; y < map.height; y++) {
            const box = map.boxFor(0, y, 0);
            if (fadesLegacy(focus, box) && !blocksView(focus, box)) {
              wrong++;
              cells.add(`0,${y}`);
            }
          }
        }
      }
      expect(wrong).toBeGreaterThan(50);
      expect([...cells].length).toBeGreaterThan(3);
    } finally {
      unload();
    }
  });
});
