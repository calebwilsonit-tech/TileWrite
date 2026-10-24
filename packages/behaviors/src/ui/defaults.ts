import { roleOfScreen, type UiDoc, type UiScreen } from '@tilewright/runtime';
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

/** The screen a plugin offers, ready to put in a project (with the role it plays and where it came from). */
export function offeredScreen(pluginId: string, id: string): UiScreen | null {
  const def = host.ext.screens.get(id);
  if (!def || def.plugin !== pluginId) return null;
  return { ...structuredClone(def.screen), role: def.role ?? def.screen.role, from: { plugin: def.plugin, screen: def.id, revision: def.revision, hash: screenHash(def.screen) } };
}

/**
 * The screens a game plays with: the project's own, and the plugins' screens for every role the project has no screen for.
 * Nothing is written to the project: the plugin's screens are used as they are, so a plugin update reaches the game, and a
 * project that makes its own screen for a role (or customizes the plugin's) is not touched.
 */
export function withPluginScreens(doc: UiDoc): UiDoc {
  const have = new Set(doc.screens.map(roleOfScreen).filter(Boolean));
  const names = new Set(doc.screens.flatMap((s) => [s.name, s.id]));
  const added: UiScreen[] = [];
  for (const def of host.ext.screens.values()) {
    const role = def.role ?? def.screen.role;
    if (role ? have.has(role) : false) continue;
    if (names.has(def.screen.name) || names.has(def.screen.id)) continue;
    const screen = offeredScreen(def.plugin, def.id);
    if (!screen) continue;
    added.push(screen);
    if (role) have.add(role);
    names.add(screen.name);
    names.add(screen.id);
  }
  return added.length === 0 ? doc : { ...doc, screens: [...doc.screens, ...added] };
}
