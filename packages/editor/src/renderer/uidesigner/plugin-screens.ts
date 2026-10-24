import { roleOfScreen, type UiDoc, type UiLayout, type UiNode, type UiScreen } from '@tilewright/runtime';
import { offeredScreen, screenHash, host } from '@tilewright/behaviors';

/**
 * Screens that come with plugins and a project's copies of them. A project plays with a plugin's screen as it is until it
 * makes its own copy (Customize); the copy remembers which screen it came from (`from`), so the designer can say whether the
 * plugin has a newer one, show what differs, and put the plugin's back.
 */

export type PluginScreenState =
  /** The project has no copy and no screen of its own for the role: the plugin's is in use as it is. */
  | { kind: 'as-offered' }
  /** The project has its own screen (not a copy) playing the role. */
  | { kind: 'replaced'; by: string }
  /** A copy that has not been changed and matches what the plugin offers now. */
  | { kind: 'copy'; copy: UiScreen }
  /** A copy that has not been changed, and the plugin has a newer screen. */
  | { kind: 'copy-outdated'; copy: UiScreen }
  /** A copy the project changed; the plugin's screen is the same as when it was copied. */
  | { kind: 'changed'; copy: UiScreen }
  /** A copy the project changed, and the plugin has a newer screen too. */
  | { kind: 'changed-outdated'; copy: UiScreen };

export interface PluginScreenRow {
  /** The plugin's id for it. */
  id: string;
  plugin: string;
  name: string;
  role: string;
  roleLabel: string;
  state: PluginScreenState;
}

/** The copy in a project of a plugin's screen, if there is one. */
export const copyOf = (doc: UiDoc, plugin: string, id: string): UiScreen | undefined => doc.screens.find((s) => s.from?.plugin === plugin && s.from.screen === id);

/** Where each screen the plugins offer stands in this project. */
export function pluginScreenRows(doc: UiDoc, layout: UiLayout | null = null): PluginScreenRow[] {
  const rows: PluginScreenRow[] = [];
  for (const def of host.ext.screens.values()) {
    const current = offeredScreen(def.plugin, def.id, { layout });
    if (!current) continue;
    const role = def.role ?? current.role ?? '';
    const copy = copyOf(doc, def.plugin, def.id);
    let state: PluginScreenState;
    if (copy) {
      const changed = screenHash(copy) !== (copy.from?.hash ?? '');
      const outdated = (copy.from?.hash ?? '') !== (current.from?.hash ?? '');
      state = changed ? { kind: outdated ? 'changed-outdated' : 'changed', copy } : { kind: outdated ? 'copy-outdated' : 'copy', copy };
    } else {
      const own = role ? doc.screens.find((s) => roleOfScreen(s) === role) : undefined;
      state = own ? { kind: 'replaced', by: own.name } : { kind: 'as-offered' };
    }
    rows.push({ id: def.id, plugin: def.plugin, name: current.name, role, roleLabel: host.ext.screenRoles.get(role)?.label ?? role, state });
  }
  return rows;
}

/** Make the project's own copy of a plugin's screen, which then plays its role instead of the plugin's. */
export function customize(doc: UiDoc, plugin: string, id: string, layout: UiLayout | null = null): { doc: UiDoc; screen: UiScreen } | null {
  const offered = offeredScreen(plugin, id, { layout });
  if (!offered) return null;
  const taken = new Set(doc.screens.flatMap((s) => [s.name, s.id]));
  let name = offered.name;
  // a project screen already has the name (the reserved names are the only ones that mean something): the copy keeps its role under another name
  for (let i = 2; taken.has(name); i++) name = `${offered.name} ${i}`;
  let sid = offered.id;
  for (let i = 2; taken.has(sid); i++) sid = `${offered.id}-${i}`;
  const screen: UiScreen = { ...offered, id: sid, name, role: offered.role ?? '' };
  return { doc: { ...doc, screens: [...doc.screens, screen] }, screen };
}

/** Put the plugin's screen back in a copy (the copy keeps its place in the list and its id). */
export function revert(doc: UiDoc, copyId: string, layout: UiLayout | null = null): UiDoc {
  const copy = doc.screens.find((s) => s.id === copyId);
  if (!copy?.from) return doc;
  const offered = offeredScreen(copy.from.plugin, copy.from.screen, { layout });
  if (!offered) return doc;
  const fresh: UiScreen = { ...offered, id: copy.id, name: offered.name === copy.name || !doc.screens.some((s) => s.id !== copy.id && s.name === offered.name) ? offered.name : copy.name, mapX: copy.mapX, mapY: copy.mapY };
  return { ...doc, screens: doc.screens.map((s) => (s.id === copyId ? fresh : s)) };
}

/** Take the copy away, so the plugin's screen plays the role again. */
export const removeCopy = (doc: UiDoc, copyId: string): UiDoc => ({ ...doc, screens: doc.screens.filter((s) => s.id !== copyId) });

const SCREEN_FIELDS: (keyof UiScreen)[] = ['modal', 'pauses', 'blocksInput', 'back', 'backTo', 'priority', 'dim', 'transition', 'opensOnStart', 'role'];

const short = (v: unknown): string => {
  const text = typeof v === 'string' ? JSON.stringify(v) : v === undefined ? '(not set)' : JSON.stringify(v);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

/**
 * What differs between a project's screen and the plugin's, in plain sentences, widget by widget (they are matched by id,
 * which a copy keeps). `mine` is the project's, `theirs` the plugin's. An empty list means they are the same.
 */
export function diffScreens(mine: UiScreen, theirs: UiScreen, limit = 40): string[] {
  const out: string[] = [];
  for (const f of SCREEN_FIELDS) {
    if (JSON.stringify(mine[f]) !== JSON.stringify(theirs[f])) out.push(`The screen's ${f}: ${short(mine[f])} here, ${short(theirs[f])} in the plugin's.`);
  }
  const a = new Map<string, UiNode>();
  const b = new Map<string, UiNode>();
  // a widget is named by where it sits ("Pause box > Resume > Label"), because many widgets share a name
  const path = new Map<string, string>();
  const index = (root: UiNode, into: Map<string, UiNode>): void => {
    const walk = (w: UiNode, trail: string[]): void => {
      into.set(w.id, w);
      const here = w === root ? [] : [...trail, w.name];
      if (!path.has(w.id)) path.set(w.id, here.join(' > ') || w.name);
      w.children.forEach((c) => walk(c, here));
    };
    walk(root, []);
  };
  index(mine.root, a);
  index(theirs.root, b);
  const at = (id: string): string => path.get(id) ?? id;
  for (const id of a.keys()) if (!b.has(id)) out.push(`"${at(id)}" is only in your copy.`);
  for (const id of b.keys()) if (!a.has(id)) out.push(`"${at(id)}" is only in the plugin's.`);
  for (const [id, mineW] of a) {
    const theirW = b.get(id);
    if (!theirW) continue;
    const keys = new Set([...Object.keys(mineW), ...Object.keys(theirW)].filter((k) => k !== 'children' && k !== 'id'));
    const changed: string[] = [];
    for (const k of keys) {
      const x = (mineW as unknown as Record<string, unknown>)[k];
      const y = (theirW as unknown as Record<string, unknown>)[k];
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      changed.push(typeof x === 'object' && x !== null ? k : `${k} ${short(x)} here, ${short(y)} in the plugin's`);
    }
    if (changed.length > 0) out.push(`"${at(id)}": ${changed.join('; ')}.`);
    // the same widgets in a different order
    const mineOrder = mineW.children.map((c) => c.id).filter((i) => b.has(i));
    const theirOrder = theirW.children.map((c) => c.id).filter((i) => a.has(i));
    if (JSON.stringify(mineOrder) !== JSON.stringify(theirOrder)) out.push(`"${at(id)}" has its parts in a different order.`);
  }
  if (out.length > limit) return [...out.slice(0, limit), `...and ${out.length - limit} more.`];
  return out;
}
