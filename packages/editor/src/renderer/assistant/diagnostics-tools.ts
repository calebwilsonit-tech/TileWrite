import type { ToolOutput } from '@tilewright/assistant';
import { replayPlaythrough } from '@tilewright/playbot';
import { store } from '../app/store';
import { assetFs } from '../project/assetFs';
import { listPlaythroughs, loadPlaythrough } from '../project/playthroughs';
import { fail, json, requireDoc } from './tool-core';

/**
 * What Claude uses to find out what is wrong or slow, without running the game on screen: the Console (what the editor and the
 * game said), a measured run of the open scene (where the time goes), the project's whole check (what Export insists on), and the
 * project's saved playthroughs (its tests: recorded buttons that must still end the way they did).
 */

const text = (t: string): ToolOutput => ({ content: t });

const clock = (t: number): string => new Date(t).toLocaleTimeString();

/** The Console, the game's last crash, and the problems the scripts have. */
function readConsole(input: Record<string, unknown>): ToolOutput {
  const level = input.level === 'warn' || input.level === 'error' ? input.level : 'all';
  const limit = Math.min(200, Math.max(1, Number(input.limit ?? 60)));
  const rank = { info: 0, warn: 1, error: 2 } as const;
  const log = store.state.log.filter((l) => rank[l.kind as keyof typeof rank] >= (level === 'all' ? 0 : rank[level]));
  const shown = log.slice(-limit);
  const out: string[] = [];
  out.push(log.length === 0 ? `The Console has nothing${level === 'all' ? '' : ` at the "${level}" level`}.` : `Console, oldest first (${shown.length} of ${log.length}${level === 'all' ? '' : `, ${level} and worse`}):`, ...shown.map((l) => `  ${clock(l.time)} [${l.kind}] ${l.text}`));
  const crash = store.state.runtimeError;
  if (crash) out.push(`The game stopped with an error: ${crash.headline}`, `  ${crash.message}`, ...(crash.system ? [`  in the "${crash.system}" step`] : []), ...(crash.entity ? [`  while working on "${crash.entity.name}"`] : []));
  const scripts = store.state.scriptProblems;
  if (scripts.length > 0) out.push(`Script problems (${scripts.length}):`, ...scripts.slice(0, 30).map((p) => `  ${p.script}, line ${p.line}: ${p.message}`));
  const bot = store.state.botLog.slice(0, 5);
  if (bot.length > 0) out.push('What the bot reported lately (newest first):', ...bot.map((b) => `  ${clock(b.time)} [${b.kind}] ${b.text}`));
  return text(out.join('\n'));
}

/** Run the open scene for a few seconds with no window and the profiler on: where the time goes. */
function profileGame(input: Record<string, unknown>): ToolOutput {
  requireDoc();
  const seconds = Math.min(60, Math.max(1, Number(input.seconds ?? 8)));
  const game = store.newHeadlessGame();
  if (!game) return fail('There is no scene to run.');
  game.sim.profiler.enabled = true;
  const started = performance.now();
  let ticks = 0;
  // the player stands still: this measures the world running by itself (movement and the like are in the playbot)
  while (game.seconds < seconds && ticks < 60 * 70) {
    game.step({});
    ticks++;
  }
  const wall = performance.now() - started;
  const snap = game.sim.profiler.snapshot();
  game.sim.profiler.enabled = false;
  const budget = 1000 / 60;
  const lines = [
    `Ran the open scene for ${game.seconds.toFixed(1)} game seconds (${ticks} steps) in ${(wall / 1000).toFixed(2)} s with nobody pressing anything.`,
    `A game step took ${snap.avgTickMs.toFixed(2)} ms on average (the slowest ${snap.maxTickMs.toFixed(2)} ms). At 60 steps a second there are ${budget.toFixed(1)} ms for a step and for drawing together: ${snap.avgTickMs > budget * 0.6 ? 'this is too much of it' : snap.avgTickMs > budget * 0.25 ? 'this is a fair share of it' : 'this is a small share of it'}.`,
    `${game.sim.world.count} objects.`,
    snap.behaviours.length > 0 ? 'Slowest behaviours (per step, how many objects it ran on):' : '',
    ...snap.behaviours.slice(0, 8).map((b) => `  ${b.name}: ${b.avgMs.toFixed(3)} ms (slowest single call ${b.maxMs.toFixed(3)} ms, ${b.calls.toFixed(0)} calls a step)`),
    snap.systems.length > 0 ? 'Slowest parts of the game (systems):' : '',
    ...snap.systems.slice(0, 6).map((s) => `  ${s.name}: ${s.avgMs.toFixed(3)} ms`),
    'Drawing is not measured here (there is no window): the profiler overlay in Play shows it. The machine is also busy with the editor, so compare numbers with each other, not with a goal.',
  ].filter(Boolean);
  return text(lines.join('\n'));
}

/** Everything Export checks, for every scene, conversation, cutscene and the lists the plugins keep. */
async function runProjectChecks(): Promise<ToolOutput> {
  const problems = await store.checkWholeProject();
  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');
  if (problems.length === 0) return text('The whole project was checked (every scene, conversation, cutscene, the lists the plugins keep, tiles, sounds, translations and controls): no problems.');
  const fmt = (p: (typeof problems)[number]): { where: string; message: string; object?: string; at?: string } => ({ where: p.scene || 'project', message: p.message, ...(p.entity ? { object: p.entity } : {}), ...(p.x !== undefined && p.y !== undefined ? { at: `${p.x}, ${p.y}` } : {}) });
  return text(
    json({
      summary: `${errors.length} error${errors.length === 1 ? '' : 's'} (Export refuses these) and ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      errors: errors.slice(0, 40).map(fmt),
      warnings: warnings.slice(0, 40).map(fmt),
      ...(problems.length > 80 ? { omitted: problems.length - Math.min(40, errors.length) - Math.min(40, warnings.length) } : {}),
    }),
  );
}

/** The project's tests: every saved playthrough is played again with its recorded buttons, and the ending is checked. */
async function runPlaythroughs(input: Record<string, unknown>): Promise<ToolOutput> {
  const p = store.state.project;
  if (!p) return fail('No project is open.');
  const names = await listPlaythroughs(assetFs, p.dir);
  if (names.length === 0) return text('The project has no saved playthroughs, so there is nothing to replay. A playthrough is recorded in Play (Record) and saved with what must be true at its end; it works as a test that the game still plays through.');
  const wanted = typeof input.name === 'string' && input.name ? [input.name] : names.slice(0, 30);
  const scenes = await store.loadAllScenes();
  const out: { playthrough: string; ok: boolean; seconds?: number; problems: string[] }[] = [];
  for (const name of wanted) {
    if (!names.includes(name)) {
      out.push({ playthrough: name, ok: false, problems: [`There is no playthrough "${name}". The saved ones are: ${names.join(', ')}.`] });
      continue;
    }
    try {
      const pt = await loadPlaythrough(assetFs, p.dir, name);
      const game = store.newHeadlessGame({ scenes, start: scenes.has(pt.scene) ? pt.scene : (store.state.scenePath ?? p.project.startScene) });
      if (!game) {
        out.push({ playthrough: name, ok: false, problems: ['Its scene could not be started.'] });
        continue;
      }
      const r = replayPlaythrough(game, pt);
      out.push({ playthrough: name, ok: r.ok, seconds: Math.round(r.seconds * 10) / 10, problems: r.problems });
    } catch (e) {
      out.push({ playthrough: name, ok: false, problems: [e instanceof Error ? e.message : 'It could not be run.'] });
    }
  }
  const failed = out.filter((o) => !o.ok).length;
  return text(json({ summary: `${out.length - failed} of ${out.length} playthrough${out.length === 1 ? '' : 's'} still end as recorded${failed > 0 ? `; ${failed} no longer do` : ''}.`, results: out }));
}

/** The tools that find out what is wrong or slow. Null when the name is not one of them. */
export async function runDiagnosticsRead(name: string, input: Record<string, unknown>): Promise<ToolOutput | null> {
  switch (name) {
    case 'read_console':
      return readConsole(input);
    case 'profile_game':
      return profileGame(input);
    case 'run_project_checks':
      return runProjectChecks();
    case 'run_playthroughs':
      return runPlaythroughs(input);
    default:
      return null;
  }
}
