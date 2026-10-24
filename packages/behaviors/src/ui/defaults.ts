import { roleOfScreen, type UiDoc, type UiLayout, type UiScreen } from '@tilewright/runtime';
import { host } from '../plugins/host';

/** A short fingerprint of a screen's content, so a project copy can tell whether it still matches the plugin's. */
export function screenHash(screen: UiScreen): string {
  const text = JSON.stringify({ root: screen.root, modal: screen.modal, pauses: screen.pauses, blocksInput: screen.blocksInput, back: screen.back, backTo: screen.backTo, priority: screen.priority, dim: screen.dim, transition: screen.transition, opensOnStart: screen.opensOnStart });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** What a plugin's screens may depend on in the project. */
export interface ScreenContext {
  /** The project's interface layout (Story, Interface), when it has one. */
  layout?: UiLayout | null;
}

/** The screen a plugin offers, ready to put in a project (with the role it plays and where it came from). For a screen that follows the project, `project` says which. */
export function offeredScreen(pluginId: string, id: string, project?: ScreenContext): UiScreen | null {
  const def = host.ext.screens.get(id);
  if (!def || def.plugin !== pluginId) return null;
  const screen = def.build ? def.build({ layout: project?.layout ?? null }) : def.screen;
  return { ...structuredClone(screen), role: def.role ?? screen.role, from: { plugin: def.plugin, screen: def.id, revision: def.revision, hash: screenHash(screen) } };
}

/** The screens this module added to a document, so a second call does not add them again. */
const ADDED = new WeakSet<UiScreen>();

/**
 * The screens a game plays with: the project's own, and the plugins' screens for every role the project has no screen for.
 * Nothing is written to the project: the plugin's screens are used as they are, so a plugin update reaches the game, and a
 * project that makes its own screen for a role (or customizes the plugin's) is not touched.
 */
export function withPluginScreens(doc: UiDoc, project?: ScreenContext): UiDoc {
  // a document that already went through here: start from what the project itself has
  if (doc.screens.some((s) => ADDED.has(s))) doc = { ...doc, screens: doc.screens.filter((s) => !ADDED.has(s)) };
  const have = new Set(doc.screens.map(roleOfScreen).filter(Boolean));
  const names = new Set(doc.screens.flatMap((s) => [s.name, s.id]));
  const added: UiScreen[] = [];
  for (const def of host.ext.screens.values()) {
    const role = def.role ?? def.screen.role;
    if (role ? have.has(role) : false) continue;
    const screen = offeredScreen(def.plugin, def.id, project);
    if (!screen) continue;
    ADDED.add(screen);
    // the project already has a screen of that name for something else: the plugin's keeps its role under another name
    if (names.has(screen.name)) screen.name = `${screen.name} (built-in)`;
    if (names.has(screen.id)) screen.id = `${def.plugin}.${screen.id}`;
    added.push(screen);
    if (role) have.add(role);
    names.add(screen.name);
    names.add(screen.id);
  }
  return added.length === 0 ? doc : { ...doc, screens: [...doc.screens, ...added] };
}
