import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_DIR, buildProject } from '../src/build';
import { CHAPTERS } from '../src/rooms';
import { openRole } from '@tilewright/runtime';
import type { Game } from '@tilewright/playbot';
import { gameOn as bareGame, loadProject, unload, type LoadedProject } from '../../../compat/harness/load';

export { PROJECT_DIR, CHAPTERS, unload };

/**
 * A game on one scene, with the two things the game's window does for the engine and a bare headless game does not:
 * "Start this area again" loads the scene afresh (flags and counters are kept), exactly as the window does it, and
 * with `title` the title screen is opened first, as it is for a project that has one.
 */
export function gameOn(p: LoadedProject, scene: string, opts: { title?: boolean } = {}): Game {
  const game = bareGame(p, scene);
  // the window loads the scene again once the step that asked for it is over
  let again = false;
  game.sim.events.on('restart-request', () => void (again = true));
  const step = game.step.bind(game);
  game.step = (actions) => {
    step(actions);
    if (again) {
      again = false;
      game.enterScene(game.scenePath);
    }
  };
  if (opts.title) openRole(game.sim, 'title');
  return game;
}

/** Every file under a folder, as path -> text (binary files as base64). */
export function filesOf(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '.tilewright' || e.name === 'saves' || e.name === 'logs') continue;
        walk(full);
      } else out.set(path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full).toString(/\.(json|ts|txt|md|gitignore)$/.test(e.name) || e.name === '.gitignore' ? 'utf8' : 'base64'));
    }
  };
  walk(dir);
  return out;
}

/** A fresh build of the game in a throw-away folder (what the committed project must be equal to). */
export function freshBuild(): { dir: string; rooms: ReturnType<typeof buildProject>['rooms'] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightgarden-build-'));
  const { rooms } = buildProject(CHAPTERS, path.join(dir, 'project'));
  return { dir: path.join(dir, 'project'), rooms };
}

let loaded: Promise<LoadedProject> | null = null;
/** The committed project, opened the way the editor and an exported game open it (scripts compiled, plugins on). */
export function project(): Promise<LoadedProject> {
  return (loaded ??= loadProject(PROJECT_DIR));
}

export const say = (text: string): void => void process.stdout.write(`${text}\n`);
