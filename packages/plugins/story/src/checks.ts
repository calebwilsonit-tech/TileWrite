import type { EventRow, ProblemDef, ValidatorDef } from '@tilewright/plugin-sdk';

function* rowsOf(rows: readonly EventRow[]): Generator<EventRow> {
  for (const r of rows) {
    yield r;
    yield* rowsOf(r.children);
  }
}

/** Characters, stations and triggers (and event rows) that name a conversation, cutscene or minigame the project does not have. */
export const storyChecks: ValidatorDef = {
  id: 'story',
  check(scene, project) {
    if (!project) return [];
    const minigames = project.data.ids('minigames');
    const out: ProblemDef[] = [];
    for (const e of scene.entities) {
      const npc = e.components.npcTalk as { dialogue?: string } | undefined;
      if (npc) {
        if (!npc.dialogue) out.push({ id: `npc-empty-${e.id}`, severity: 'warning', entity: e.id, message: `"${e.name}" has no conversation chosen, so talking to it does nothing.` });
        else if (!project.dialogues.has(npc.dialogue)) out.push({ id: `npc-missing-${e.id}`, severity: 'error', entity: e.id, message: `"${e.name}" talks using the dialogue "${npc.dialogue}", which does not exist (check the Story panel).` });
      }
      const station = e.components.minigameStation as { minigame?: string } | undefined;
      if (station) {
        if (!station.minigame) out.push({ id: `mg-empty-${e.id}`, severity: 'warning', entity: e.id, message: `"${e.name}" has no minigame chosen, so using it does nothing.` });
        else if (!minigames.has(station.minigame)) out.push({ id: `mg-missing-${e.id}`, severity: 'error', entity: e.id, message: `"${e.name}" plays the minigame "${station.minigame}", which does not exist (check Story -> Minigames).` });
      }
      const trig = e.components.cutsceneTrigger as { cutscene?: string } | undefined;
      if (trig && (!trig.cutscene || !project.cutscenes.has(trig.cutscene))) {
        out.push({ id: `cut-missing-${e.id}`, severity: 'error', entity: e.id, message: trig.cutscene ? `"${e.name}" plays the cutscene "${trig.cutscene}", which does not exist.` : `"${e.name}" has no cutscene chosen.` });
      }
    }
    for (const row of rowsOf(scene.events)) {
      for (const a of row.actions) {
        const name = (k: string): string => String(a.params[k] ?? '');
        if (a.type === 'startDialogue' && !project.dialogues.has(name('dialogue'))) out.push({ id: `row-${row.id}-dlg`, severity: 'warning', message: `An event row starts the dialogue "${name('dialogue')}", which does not exist.` });
        if (a.type === 'playMinigame' && !minigames.has(name('minigame'))) out.push({ id: `row-${row.id}-mg`, severity: 'warning', message: `An event row plays the minigame "${name('minigame')}", which does not exist.` });
        if (a.type === 'playCutscene' && !project.cutscenes.has(name('cutscene'))) out.push({ id: `row-${row.id}-cut`, severity: 'warning', message: `An event row plays the cutscene "${name('cutscene')}", which does not exist.` });
      }
    }
    return out;
  },
};
