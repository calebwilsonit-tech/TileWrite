import { definePlaybotMove, definePlaybotStrategy, formatTime, type Bot, type PlayReport } from '@tilewright/plugin-sdk';

/**
 * Hold several plates down with echoes: record an echo walking to each plate in turn (all but the last), then
 * stand on the last plate yourself. Needs an Echo Recorder with room for one echo fewer than there are plates.
 */
export function holdPlatesWithEchoes(bot: Bot, plateRefs: readonly string[]): PlayReport {
  for (let i = 0; i < plateRefs.length - 1; i++) {
    bot.press('echo'); // start recording
    const r = bot.walkToEntity(plateRefs[i]!, { arrive: 0.12 });
    if (!r.ok) return r;
    bot.wait(0.2);
    bot.press('echo'); // stop: the echo takes over this plate
  }
  const last = bot.standOn(plateRefs[plateRefs.length - 1]!, 0.6);
  return last.ok ? { ...last, message: `Held ${plateRefs.length} plates (${plateRefs.length - 1} with echoes) in ${formatTime(bot.game.seconds)}.` } : last;
}


/** The panel's button: hold every plate of the scene down, all but the last with echoes. */
export const holdPlatesStrategy = definePlaybotStrategy({
  id: 'echo',
  label: 'Hold the plates with echoes',
  help: 'Records an echo onto each pressure plate in turn and stands on the last one',
  unavailable(scene) {
    if (scene.entities.filter((e) => e.components.pressurePlate !== undefined).length < 2) return 'This needs at least two pressure plates.';
    if (!scene.entities.some((e) => e.tags.includes('player') && e.components.echoRecorder)) return 'The player has no Echo Recorder behaviour, so there are no echoes to hold the plates.';
    return null;
  },
  play(bot, scene) {
    const plates = scene.entities.filter((e) => e.components.pressurePlate !== undefined);
    const r = holdPlatesWithEchoes(bot, plates.map((p) => `id:${p.id}`));
    bot.wait(1);
    return r;
  },
});

/** The solver's step: record an echo walking onto a plate. */
export const echoMove = definePlaybotMove({
  id: 'echo',
  offer(entity, player) {
    if (player?.components.echoRecorder === undefined || entity.components.pressurePlate === undefined || entity.components.transform === undefined) return [];
    return [{ ref: `id:${entity.id}`, label: `record an echo onto "${entity.name}"` }];
  },
  perform(bot, game, ref, memory) {
    const seconds = (memory.echoSeconds ??= []) as number[];
    const started = game.seconds;
    bot.press('echo');
    const r = bot.walkToEntity(ref, { arrive: 0.12, maxSeconds: 30 });
    if (!r.ok) return false;
    bot.wait(0.25);
    bot.press('echo');
    seconds.push(game.seconds - started);
    // every echo walks its recording again from the start: wait until they have all arrived
    bot.wait(Math.max(...seconds) + 0.4);
    return true;
  },
});
