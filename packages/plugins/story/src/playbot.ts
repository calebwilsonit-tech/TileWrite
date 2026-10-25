import { formatTime, type Bot, type PlayReport } from '@tilewright/plugin-sdk';
import { minigamesOf, openMinigame, pairColumns, symbolDirs } from './minigames';

/**
 * Play the minigame that is open, with the buttons a player has, the way a careful player would: press at the right
 * moment on the timing bar, watch the pattern and repeat it, flip cards while remembering only what it has seen.
 * Leaves the result screen too. Gives up after `maxSeconds` of game time.
 */
export function playMinigame(bot: Bot, maxSeconds = 120): PlayReport {
  const sim = bot.game.sim;
  const start = sim.tick;
  const done = (ok: boolean, message: string): PlayReport => ({ ok, kind: ok ? 'reached' : 'blocked', seconds: (sim.tick - start) / 60, message, at: { ...bot.pos() } });
  const first = openMinigame(sim.runtime);
  if (!first) return done(false, 'There is no minigame open.');
  const name = first.name;
  const memory = new Map<number, number>(); // cards seen so far: place -> picture
  const dirKey = { up: 'move_up', down: 'move_down', left: 'move_left', right: 'move_right' } as const;
  for (let st = openMinigame(sim.runtime); st && sim.tick - start < maxSeconds * 60; st = openMinigame(sim.runtime)) {
    const m = minigamesOf(sim.assets).get(st.name);
    if (!m) return done(false, `The minigame "${name}" is not in the project.`);
    if (st.phase === 'intro' || st.phase === 'won' || st.phase === 'lost') {
      bot.press('interact');
      continue;
    }
    if (m.kind === 'timing') {
      const centre = st.zoneAt + st.zoneSize / 2;
      // press a little before the marker reaches the middle of the zone, as a person aims ahead
      if (Math.abs(st.pos - centre) < 0.02 + (m.speed / 1.1) / 60) bot.press('interact');
      else bot.step();
    } else if (m.kind === 'sequence') {
      if (st.phase !== 'play') bot.step();
      else {
        const want = st.seq[st.entered]!;
        bot.press(dirKey[symbolDirs(m.buttons)[want]!]);
      }
    } else {
      for (let i = 0; i < st.faces.length; i++) if (st.faces[i] !== 'down') memory.set(i, st.cards[i]!);
      if (st.lock > 0) {
        bot.step();
        continue;
      }
      // flip a known pair if there is one, otherwise a card not yet seen; the second card is its match if known
      const down = st.faces.map((f, i) => (f === 'down' ? i : -1)).filter((i) => i >= 0);
      let target: number;
      if (st.open.length === 1) {
        const seen = memory.get(st.open[0]!)!;
        target = down.find((i) => memory.get(i) === seen) ?? down.find((i) => !memory.has(i)) ?? down[0] ?? -1;
      } else {
        const byPicture = new Map<number, number[]>();
        for (const i of down) if (memory.has(i)) byPicture.set(memory.get(i)!, [...(byPicture.get(memory.get(i)!) ?? []), i]);
        const pair = [...byPicture.values()].find((v) => v.length === 2);
        target = pair ? pair[0]! : (down.find((i) => !memory.has(i)) ?? down[0] ?? -1);
      }
      if (target < 0) {
        bot.step();
        continue;
      }
      // walk the cursor there with the arrow buttons, then flip
      const cols = pairColumns(st.cards.length);
      const cx = st.cursor % cols;
      const cy = Math.floor(st.cursor / cols);
      const tx = target % cols;
      const ty = Math.floor(target / cols);
      if (cx < tx) bot.press('move_right');
      else if (cx > tx) bot.press('move_left');
      else if (cy < ty) bot.press('move_down');
      else if (cy > ty) bot.press('move_up');
      else bot.press('interact');
    }
  }
  if (openMinigame(sim.runtime)) return done(false, `The minigame "${name}" was not finished within ${formatTime(maxSeconds)}.`);
  const won = sim.runtime.vars[`minigame:${name}:won`] === true;
  return done(won, won ? `Won the minigame "${name}" in ${formatTime((sim.tick - start) / 60)}.` : `Lost or gave up on the minigame "${name}".`);
}
