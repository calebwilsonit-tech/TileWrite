import type { ProblemDef, ValidatorDef } from '@tilewright/plugin-sdk';

/** Mistakes in fighting: things that hurt but cannot be defeated. */
export const combatChecks: ValidatorDef = {
  id: 'combat',
  check(doc) {
    const out: ProblemDef[] = [];
    for (const e of doc.entities) {
      if (e.components.damageOnTouch && !e.components.health && e.tags.includes('enemy')) {
        out.push({ id: `enemy-nohealth-${e.id}`, severity: 'warning', message: `"${e.name}" hurts on touch but has no Health, so it cannot be defeated.`, entity: e.id });
      }
    }
    return out;
  },
};
