import type { EditorDoc } from '../model/doc';
import { madeVariables, storyVariables } from '../model/story-vars';
import { store } from './store';

/** Variables nobody sets in the open scene's event sheet but that the game itself makes: story variables, producers' resources, pickups. */
export function knownVariables(doc: EditorDoc): Set<string> {
  return new Set([...storyVariables(store.story.dialogues, store.story.cutscenes), ...madeVariables(doc.entities, store.prefabs.values(), store.tables)]);
}
