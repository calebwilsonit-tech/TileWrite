import fs from 'node:fs';
import path from 'node:path';
import { Bot, Game, extractPushPuzzle, solvePush, type PlayReport } from '@tilewright/playbot';
import type { SceneData } from '@tilewright/runtime';
import { loadScene, openProject } from '../packages/editor/src/renderer/project/io';
import { loadAllPrefabs } from '../packages/editor/src/renderer/project/prefabs';
import { loadCutscenes, loadDialogues, loadItems } from '../packages/editor/src/renderer/project/story';
import type { AssetFs } from '../packages/editor/src/renderer/studio/assets';

/** The project's files, read straight from disk (what an export would ship), for a bot that plays without the editor. */
const nodeFs: AssetFs = {
  read: (f) => fs.promises.readFile(f, 'utf8'),
  write: async (f, t) => {
    await fs.promises.mkdir(path.dirname(f), { recursive: true }); // like the app's own file bridge
    await fs.promises.writeFile(f, t, 'utf8');
  },
  writeBinary: async (f, b) => fs.promises.writeFile(f, b),
  readBinary: async (f) => new Uint8Array(await fs.promises.readFile(f)),
  exists: async (f) => fs.existsSync(f),
  remove: async (f) => fs.promises.rm(f, { force: true }),
  list: async (d) => (await fs.promises.readdir(d, { withFileTypes: true })).map((e) => ({ name: e.name, dir: e.isDirectory() })),
};

export { nodeFs };

export interface SliceRun {
  log: string[];
  game: Game;
  bot: Bot;
}

/**
 * Play "The Last Storytender" slice from the first frame to the exit with nothing but button presses: talk to the
 * elder and agree, light the lantern, go through the portal; in the dungeon hold the plates with an echo, clear the
 * guard, push the crate onto its plate, swap the stone's word, light the lantern, beat the boss, walk out.
 */
export async function loadSlice(projectDir: string): Promise<{ game: Game; scenes: Map<string, SceneData>; prefabs: Awaited<ReturnType<typeof loadAllPrefabs>>['prefabs'] }> {
  const { project } = await openProject(nodeFs, projectDir);
  const scenes = new Map<string, SceneData>();
  for (const p of project.scenes) scenes.set(p, await loadScene(nodeFs, projectDir, p));
  const { prefabs } = await loadAllPrefabs(nodeFs, projectDir);
  const items = await loadItems(nodeFs, projectDir);
  const dialogues = await loadDialogues(nodeFs, projectDir);
  const cutscenes = await loadCutscenes(nodeFs, projectDir);
  const game = new Game({ scene: scenes.get(project.startScene)!, scenePath: project.startScene, scenes, prefabs, items: items.items, dialogues: dialogues.items, cutscenes: cutscenes.items });
  return { game, scenes, prefabs };
}

/** A fresh game at the very start, as a player would begin it. */
export async function newSliceGame(projectDir: string): Promise<Game> {
  return (await loadSlice(projectDir)).game;
}

export async function playSlice(projectDir: string): Promise<SliceRun> {
  const { game, scenes, prefabs } = await loadSlice(projectDir);
  const bot = new Bot(game);
  const log: string[] = [];
  /** What the puzzle parts are doing right now, for the report when something goes wrong. */
  const parts = (): string =>
    game.sim.world
      .all()
      .filter((e) => e.has('gate') || e.has('pressurePlate') || e.has('logic') || e.has('textBlock'))
      .map((e) => {
        const out = e.get<{ outputs: Record<string, boolean> }>('signals')?.outputs ?? {};
        const c = e.get<{ enabled: boolean }>('collider');
        return e.name + ' ' + JSON.stringify(out) + (c ? ' solid=' + c.enabled : '');
      })
      .join('; ');
  const fail = (message: string): Error => new Error(`${message}\n${log.join('\n')}\nNow: ${parts()}; the player is at ${JSON.stringify(game.position)}`);
  const did = (what: string, r: PlayReport): void => {
    log.push(`${what}: ${r.message}`);
    if (!r.ok) throw fail(`The bot could not finish the slice: ${what} - ${r.message}`);
  };

  // the hub
  did('talk to the elder', bot.interact('name:Elder'));
  bot.talkThrough((options) => options.indexOf('I will.'));
  bot.wait(1);
  did('light the hub lantern', bot.interact('name:Hub lantern'));
  bot.wait(0.5);
  did('go through the portal', bot.walkToEntity('name:Portal'));
  bot.wait(0.3);
  if (game.scenePath !== 'scenes/dungeon.scene.json') throw new Error(`The portal did not lead to the dungeon (the game is in "${game.scenePath}").\n${log.join('\n')}`);

  // the dungeon: the echo puzzle on the plateau, then the second room
  did('hold both plates (one with an echo)', bot.holdPlatesWithEchoes(['name:Echo plate A', 'name:Echo plate B']));
  bot.wait(3); // the gate slides open
  did('clear the guard', bot.fight('name:Guard'));
  const puzzle = extractPushPuzzle(scenes.get('scenes/dungeon.scene.json')!, prefabs, { player: game.position }); // from where the player stands now
  if (!puzzle) throw fail('The dungeon has no crate puzzle for the bot to find.');
  const plan = solvePush(puzzle);
  if (!plan.solvable) throw fail('The bot found the crate puzzle impossible to solve (' + (plan.capped ? 'too big' : 'no solution') + '): ' + JSON.stringify(puzzle));
  did('push the crate onto its plate', bot.executePushes(plan.moves));
  bot.wait(1);
  did('swap the stone\'s word', bot.interact('name:Sentence stone'));
  bot.wait(1);
  did('light the dungeon lantern', bot.interact('name:Dungeon lantern'));
  bot.wait(0.5);
  did('beat the boss', bot.fight('name:Boss', { maxSeconds: 120 }));
  bot.wait(1);
  did('walk out through the exit gate', bot.walkToEntity('tag:goal'));
  return { log, game, bot };
}
