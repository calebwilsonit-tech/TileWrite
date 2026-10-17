import type { CutsceneData, DialogueData } from '@tilewright/runtime';

/**
 * The flags and counters that conversations and cutscenes set. An event row may legitimately check one of these,
 * so the sheet checker must not call it "never set".
 */
export function storyVariables(dialogues: ReadonlyMap<string, DialogueData>, cutscenes: ReadonlyMap<string, CutsceneData>): Set<string> {
  const out = new Set<string>();
  for (const d of dialogues.values()) for (const n of d.nodes) if (n.type === 'set' && n.variable) out.add(n.variable);
  for (const c of cutscenes.values()) for (const s of c.steps) if (s.type === 'setVariable' && s.name) out.add(s.name);
  return out;
}
