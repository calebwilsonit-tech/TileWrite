import { Bot, extractPushPuzzle, solvePuzzles, solvePush, type PlayReport } from '@tilewright/playbot';
import { host } from '@tilewright/behaviors';
import { store, useApp } from '../app/store';

/** The bot that plays the open scene with the same buttons a player has, and the playthroughs it (or you) recorded. */
let lastRun: { bot: Bot; ok: boolean } | null = null;

function runBot(what: string, run: (bot: Bot) => PlayReport): void {
  const game = store.newHeadlessGame();
  if (!game) return;
  if (!game.sim.world.withTag('player')[0]) {
    store.botSay('error', 'There is no player start in this scene, so the bot has nobody to move.');
    return;
  }
  try {
    const bot = new Bot(game);
    const r = run(bot);
    lastRun = { bot, ok: r.ok };
    store.botSay(r.ok ? 'info' : 'warn', r.message);
  } catch (e) {
    store.botSay('error', `${what} did not work: ${e instanceof Error ? e.message : String(e)}`);
  }
  store.set({ docVersion: store.state.docVersion }); // re-render
}

function goalRef(): string | null {
  const g = store.doc?.entities.find((e) => e.tags.includes('goal') || e.tags.includes('exit'));
  return g ? (g.tags.includes('goal') ? 'tag:goal' : 'tag:exit') : null;
}

function needGoal(): string | null {
  const ref = goalRef();
  if (!ref) store.botSay('warn', 'There is no goal in this scene. Place a "Goal / exit" (Puzzle group) where the level should end.');
  return ref;
}

export function PlaybotPanel() {
  const log = useApp((s) => s.botLog);
  const names = useApp((s) => s.playthroughs);
  useApp((s) => s.docVersion);
  return (
    <div className="panel playbot" data-testid="playbot-panel">
      <p className="hint">The bot plays your level with the same buttons a player has (no teleporting) and tells you how it went.</p>
      <div className="row wrap">
        <button
          data-testid="bot-walk"
          onClick={() => {
            const ref = needGoal();
            if (ref) runBot('Walking to the goal', (bot) => bot.walkToEntity(ref, { maxSeconds: 120 }));
          }}
        >
          Walk to the goal
        </button>
        <button
          data-testid="bot-solve"
          onClick={() => {
            const ref = needGoal();
            if (ref) runBot('Playing to the goal', (bot) => bot.solveToGoal(ref, { maxSeconds: 120 }));
          }}
        >
          Play to the goal (using switches)
        </button>
        <button
          data-testid="bot-push"
          onClick={() => {
            const scene = store.doc?.toScene();
            const puzzle = scene ? extractPushPuzzle(scene, store.prefabs) : null;
            if (!puzzle) return store.botSay('warn', 'There is no crate puzzle here: it needs a pushable crate and a plate that takes crates.');
            const plan = solvePush(puzzle);
            if (!plan.solvable) return store.botSay('warn', plan.capped ? 'The crate puzzle is too big to solve completely.' : 'The crate puzzle cannot be solved: the crates cannot all reach the plates.');
            runBot('Solving the crate puzzle', (bot) => {
              const r = bot.executePushes(plan.moves);
              bot.wait(1);
              return r.ok ? { ...r, message: `Solved the crate puzzle in ${plan.moves.length} pushes (${bot.game.seconds.toFixed(1)}s).` } : r;
            });
          }}
        >
          Solve the crate puzzle
        </button>
        <button
          data-testid="bot-search"
          title="Tries short plans (stand on a plate, flip a lever, push the crates, and whatever the plugins add) until one lets the bot reach the goal"
          onClick={() => {
            const ref = needGoal();
            const setup = store.headlessSetup();
            if (!ref || !setup) return;
            store.botSay('info', 'Searching for a way to the goal...');
            // let the message show before the search takes over the window for a moment
            window.setTimeout(() => {
              try {
                const r = solvePuzzles(setup, { goal: ref, maxMs: 40_000 });
                store.botSay(r.found ? 'info' : 'warn', r.message + (r.found ? ` (${r.plans} plan${r.plans === 1 ? '' : 's'} tried)` : ''));
              } catch (e) {
                store.botSay('error', `The search did not work: ${e instanceof Error ? e.message : String(e)}`);
              }
            }, 30);
          }}
        >
          Search for a solution
        </button>
        {[...host.ext.playbotStrategies.values()].map((s) => (
          <button
            key={s.id}
            data-testid={`bot-${s.id}`}
            title={s.help}
            onClick={() => {
              const scene = { entities: store.doc?.entities ?? [] };
              const why = s.unavailable?.(scene) ?? null;
              if (why) return store.botSay('warn', why);
              runBot(s.label, (bot) => s.play(bot, scene) as PlayReport);
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <h4>Playthroughs</h4>
      <p className="hint">A playthrough is a recording of every button pressed. Replay it any time to check the level can still be finished.</p>
      <div className="row wrap">
        <button
          data-testid="bot-record"
          onClick={() => {
            store.recordNext = true;
            store.play();
          }}
          title="Starts the game; everything you press is saved when you press Stop"
        >
          Record one by playing
        </button>
        <button
          data-testid="bot-save-run"
          disabled={!lastRun}
          onClick={() => {
            if (lastRun) void store.saveRecording(lastRun.bot.recording(), store.state.scenePath ?? '', lastRun.ok ? goalRef() : null);
          }}
          title="Keep what the bot just did as a playthrough"
        >
          Keep the bot's last run
        </button>
      </div>
      {names.length === 0 ? (
        <p className="hint">No playthroughs yet.</p>
      ) : (
        <ul className="plain" data-testid="playthrough-list">
          {names.map((n) => (
            <li key={n} className="row">
              <span style={{ flex: 1 }}>{n}</span>
              <button data-testid={`playthrough-run-${n}`} onClick={() => void store.runPlaythrough(n)}>
                Replay
              </button>
              <button className="small" onClick={() => void store.removePlaythrough(n)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <h4>What happened</h4>
      {log.length === 0 ? (
        <p className="hint">Reports from the bot appear here.</p>
      ) : (
        <ul className="plain" data-testid="bot-log">
          {log.map((l, i) => (
            <li key={`${l.time}-${i}`} className={l.kind} data-testid="bot-log-item">
              <time>{new Date(l.time).toLocaleTimeString()}</time> {l.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
