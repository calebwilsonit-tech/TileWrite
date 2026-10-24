import type { ProblemDef, ValidatorDef } from '@tilewright/plugin-sdk';

/** Mistakes in the puzzles of the reference game: sentence stones with nothing to swap, echo recorders that can hold no echo, light sensors wired to nothing. */
export const storytenderChecks: ValidatorDef = {
  id: 'storytender',
  check(doc) {
    const out: ProblemDef[] = [];
    const sheetText = JSON.stringify(doc.events);
    for (const e of doc.entities) {
      const stone = e.components.sentenceStone as { words?: string } | undefined;
      if (stone && (stone.words ?? '').split(',').filter((w) => w.trim()).length < 2) {
        out.push({ id: `stone-words-${e.id}`, severity: 'warning', message: `The sentence stone "${e.name}" has fewer than two swappable words, so there is nothing for the player to swap. Type words separated by commas.`, entity: e.id });
      }
      const rec = e.components.echoRecorder as { capacity?: number; capacityVariable?: string } | undefined;
      if (rec && (rec.capacity ?? 0) <= 0 && !rec.capacityVariable) {
        out.push({ id: `echo-capacity-${e.id}`, severity: 'warning', message: `"${e.name}" can hold 0 echoes and has no variable to add more, so the Echo button will do nothing.`, entity: e.id });
      }
      if (e.components.lightSensor !== undefined) {
        const talks = sheetText.includes(`id:${e.id}`) || sheetText.includes(`name:${e.name}`);
        if (!doc.wires.some((w) => w.from.entity === e.id) && !talks) {
          out.push({ id: `unused-${e.id}-lightSensor`, severity: 'warning', message: `The light sensor "${e.name}" is not connected to anything, so using it does nothing. Use the Wire tool to connect it to a gate or another object (or use it in an event row).`, entity: e.id });
        }
      }
    }
    return out;
  },
};
