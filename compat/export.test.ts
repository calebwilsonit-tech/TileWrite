/**
 * The game a project exports starts, and plays exactly as the project does. For every project in the corpus (samples, older samples, the
 * reference game, templates, and the owner's) the files an export ships are written the way an export writes them (`exportGameData`),
 * the exported folder is opened the way the player opens it (compiled scripts instead of sources), a game is started on its first scene,
 * and the same button list is played in it and in the project itself: every checkpoint must be the same. (The part with a window is
 * `e2e/m12-export.spec.ts` and `e2e/p2-export-samples.spec.ts`, which run exported games as programs.)
 */
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { corpus } from './harness/corpus';
import { exportGameData, readExported } from './harness/export-game';
import { gameOn, loadProject, unload } from './harness/load';
import { runKeys } from './harness/trace';

const entries = await corpus();
const only = process.env.COMPAT_ONLY;

describe('an exported game starts and plays as the project does', () => {
  for (const e of entries) {
    if (only && e.id !== only) continue;
    it(`${e.kind}: ${e.id}`, async () => {
      const out = path.join(os.tmpdir(), 'tilewright-compat-exports', `${e.kind}-${e.id}`);
      const { manifest, files } = await exportGameData(e.dir, out);
      expect(files).toContain('project.json');
      expect(files.some((f) => f.startsWith('scenes/'))).toBe(true);
      expect(files.some((f) => f.startsWith('assets/scripts/'))).toBe(false); // sources never ship
      const exported = readExported(out);
      expect(exported.manifest).toEqual(manifest);
      expect(Object.keys(exported.scripts.scripts).sort()).toEqual([...manifest.scripts].sort());

      const project = await loadProject(e.dir);
      const original = (() => {
        try {
          const game = gameOn(project, project.project.startScene);
          return { ...runKeys(game), problems: game.problems };
        } finally {
          unload();
        }
      })();

      const shipped = await loadProject(out, { compiled: exported.scripts.scripts, names: manifest.scripts });
      try {
        expect(shipped.problems.filter((p) => !project.problems.includes(p)), 'the exported game has problems the project does not').toEqual([]);
        const game = gameOn(shipped, manifest.startScene);
        const played = runKeys(game);
        expect(played.error).toBe(original.error);
        expect(game.problems).toEqual(original.problems);
        expect(played.checkpoints.length).toBeGreaterThan(5);
        expect(played.checkpoints).toEqual(original.checkpoints);
      } finally {
        unload();
      }
    });
  }
});
