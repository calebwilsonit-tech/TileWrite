import type { AssetFs } from '../studio/assets';
import { joinPath } from './api';
import { storyNameProblem } from './story';

export const SCRIPT_DIR = 'assets/scripts';
const EXT = '.script.ts';

export const scriptPath = (name: string): string => `${SCRIPT_DIR}/${name}${EXT}`;

export async function listScripts(fs: AssetFs, dir: string): Promise<string[]> {
  try {
    return (await fs.list(joinPath(dir, SCRIPT_DIR))).filter((e) => !e.dir && e.name.endsWith(EXT)).map((e) => e.name.slice(0, -EXT.length)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function loadScripts(fs: AssetFs, dir: string): Promise<{ scripts: Map<string, string>; problems: string[] }> {
  const scripts = new Map<string, string>();
  const problems: string[] = [];
  for (const name of await listScripts(fs, dir)) {
    try {
      scripts.set(name, await fs.read(joinPath(dir, SCRIPT_DIR, `${name}${EXT}`)));
    } catch (e) {
      problems.push(`The script "${name}" could not be read (${(e as Error).message}).`);
    }
  }
  return { scripts, problems };
}

export async function saveScript(fs: AssetFs, dir: string, name: string, source: string): Promise<void> {
  const problem = storyNameProblem(name, [], 'script');
  if (problem) throw new Error(problem);
  await fs.write(joinPath(dir, SCRIPT_DIR, `${name}${EXT}`), source.endsWith('\n') ? source : `${source}\n`);
}

export async function deleteScript(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(joinPath(dir, SCRIPT_DIR, `${name}${EXT}`));
}

export interface ScriptTemplate {
  id: string;
  label: string;
  source(name: string): string;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'empty',
    label: 'Empty script',
    source: (name) => `// A script is a behaviour you write in code. Add it to an object with Behaviours -> Add.
// Press Ctrl+Space for suggestions: every function of the game is described as you type.
export default defineScript({
  name: ${JSON.stringify(name)},
  description: 'What this script does, in one sentence.',
  // Settings appear in the Inspector. A number, true/false or text; or { value, label, min, max }.
  settings: { speed: 1 },
  start(me, game) {
    // runs once, when the object appears
  },
  update(me, game) {
    // runs every update, 60 times a second
  },
});
`,
  },
  {
    id: 'spinner',
    label: 'Turn on the spot',
    source: (name) => `export default defineScript({
  name: ${JSON.stringify(name)},
  description: 'Turns to face the next direction every so often.',
  settings: { everySeconds: { value: 0.5, label: 'Turn every (seconds)', min: 0.1, step: 0.1 }, clockwise: true },
  update(me, game) {
    me.state.timer = (me.state.timer ?? 0) + game.dt;
    if (me.state.timer >= me.settings.everySeconds) {
      me.state.timer = 0;
      me.facing += me.settings.clockwise ? 1 : -1;
    }
  },
});
`,
  },
  {
    id: 'greeter',
    label: 'Say hello when the player is near',
    source: (name) => `export default defineScript({
  name: ${JSON.stringify(name)},
  description: 'Shows a message the first time the player comes close.',
  settings: { distance: 3, message: 'Hello there!' },
  update(me, game) {
    const player = game.player;
    if (!player || me.state.greeted) return;
    if (me.distanceTo(player) < me.settings.distance) {
      me.state.greeted = true;
      game.say(me.settings.message);
      me.lookAt(player);
    }
  },
});
`,
  },
  {
    id: 'chaser',
    label: 'Follow the player',
    source: (name) => `export default defineScript({
  name: ${JSON.stringify(name)},
  description: 'Walks towards the player (around walls and pits) and stops when close.',
  settings: { speed: 2.5, stopAt: 1.2 },
  update(me, game) {
    const player = game.player;
    if (!player) return;
    if (me.distanceTo(player) > me.settings.stopAt) me.walkTo(player.x, player.y, me.settings.speed);
  },
});
`,
  },
];
