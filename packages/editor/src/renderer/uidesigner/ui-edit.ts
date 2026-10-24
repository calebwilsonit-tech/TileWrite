import {
  UI_ANCHORS,
  findWidget,
  newWidget,
  roleOfScreen,
  parentOf,
  walkWidgets,
  type UiAnchor,
  type UiDoc,
  type UiNode,
  type UiPrefab,
  type UiScreen,
  type WidgetType,
} from '@tilewright/runtime';

/** Pure edits of the interface document; the designer hands each result to `store.setUiDoc`. */

const clone = <T,>(v: T): T => structuredClone(v);

export function nextId(doc: UiDoc, prefix = 'w'): string {
  const used = new Set<string>();
  for (const s of doc.screens) {
    used.add(s.id);
    walkWidgets(s.root, (w) => used.add(w.id));
  }
  for (const p of doc.prefabs) walkWidgets(p.widget, (w) => used.add(w.id));
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** A name nothing else has: "Button", "Button 2"... among the widgets of one screen or prefab. */
export function freshName(root: UiNode, base: string): string {
  const names = new Set<string>();
  walkWidgets(root, (w) => names.add(w.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function screenNameProblem(doc: UiDoc, name: string, except?: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the screen a name.';
  if (n.length > 32) return 'Screen names are at most 32 letters.';
  if (doc.screens.some((s) => s.id !== except && s.name === n)) return `There is already a screen called "${n}".`;
  return null;
}

export function addScreen(doc: UiDoc, name: string): { doc: UiDoc; id: string } {
  const next = clone(doc);
  const id = nextId(next, 's');
  const rootId = nextId(next, 'w');
  const root = { ...newWidget('panel', rootId, `${name} root`), anchor: 'fill' as UiAnchor, layout: 'free' as const, style: {}, padding: 0 };
  const col = next.screens.length % 3;
  const row = Math.floor(next.screens.length / 3);
  next.screens.push({ id, name, root, modal: false, back: 'auto', backTo: '', priority: 0, dim: 0, transition: 'none', mapX: 40 + col * 220, mapY: 40 + row * 130, opensOnStart: false });
  return { doc: next, id };
}

export function removeScreen(doc: UiDoc, id: string): UiDoc {
  const next = clone(doc);
  next.screens = next.screens.filter((s) => s.id !== id);
  return next;
}

export function updateScreen(doc: UiDoc, id: string, fn: (s: UiScreen) => void): UiDoc {
  const next = clone(doc);
  const s = next.screens.find((x) => x.id === id);
  if (s) fn(s);
  return next;
}

/** The screen or prefab tree a widget id belongs to. */
export function rootOf(doc: UiDoc, widgetId: string): { kind: 'screen' | 'prefab'; root: UiNode; key: string } | null {
  for (const s of doc.screens) if (findWidget(s.root, widgetId)) return { kind: 'screen', root: s.root, key: s.id };
  for (const p of doc.prefabs) if (findWidget(p.widget, widgetId)) return { kind: 'prefab', root: p.widget, key: p.name };
  return null;
}

/** Change a widget wherever it lives (a screen or a prefab). */
export function updateWidget(doc: UiDoc, widgetId: string, fn: (w: UiNode) => void): UiDoc {
  const next = clone(doc);
  for (const s of next.screens) {
    const w = findWidget(s.root, widgetId);
    if (w) {
      fn(w);
      return next;
    }
  }
  for (const p of next.prefabs) {
    const w = findWidget(p.widget, widgetId);
    if (w) {
      fn(w);
      return next;
    }
  }
  return doc;
}

/** Add a new widget of a type inside a container (the screen's root when none is given). Returns its id. */
export function addWidget(doc: UiDoc, rootId: string, parentId: string | null, type: WidgetType, at?: { x: number; y: number; anchor?: UiAnchor }): { doc: UiDoc; id: string } {
  const next = clone(doc);
  const id = nextId(next, 'w');
  let id2 = '';
  const place = (root: UiNode): boolean => {
    const parent = parentId ? findWidget(root, parentId) : root;
    if (!parent) return false;
    const w = newWidget(type, id);
    w.name = freshName(root, w.name);
    if (at) Object.assign(w, { x: at.x, y: at.y, anchor: at.anchor ?? 'tl' });
    // a panel that stacks its children, or a list, takes the widget into the flow
    parent.children.push(w);
    id2 = id;
    return true;
  };
  const screen = next.screens.find((s) => s.id === rootId);
  if (screen) place(screen.root);
  else {
    const prefab = next.prefabs.find((p) => p.name === rootId);
    if (prefab) place(prefab.widget);
  }
  return { doc: next, id: id2 };
}

export function removeWidget(doc: UiDoc, widgetId: string): UiDoc {
  const next = clone(doc);
  const strip = (root: UiNode): void => {
    walkWidgets(root, (w) => {
      w.children = w.children.filter((c) => c.id !== widgetId);
    });
  };
  for (const s of next.screens) if (s.root.id !== widgetId) strip(s.root);
  for (const p of next.prefabs) if (p.widget.id !== widgetId) strip(p.widget);
  return next;
}

/** A copy of a widget (with new ids) next to the original. */
export function duplicateWidget(doc: UiDoc, widgetId: string): { doc: UiDoc; id: string } {
  const next = clone(doc);
  const root = rootOf(next, widgetId);
  if (!root) return { doc, id: '' };
  const parent = parentOf(root.root, widgetId);
  const original = findWidget(root.root, widgetId);
  if (!parent || !original) return { doc, id: '' };
  const copy = clone(original);
  const used = new Set<string>();
  for (const sc of next.screens) walkWidgets(sc.root, (w) => used.add(w.id));
  for (const p of next.prefabs) walkWidgets(p.widget, (w) => used.add(w.id));
  let n = used.size + 1;
  walkWidgets(copy, (w) => {
    while (used.has(`w${n}`)) n++;
    w.id = `w${n}`;
    used.add(w.id);
  });
  copy.name = freshName(root.root, original.name);
  if (copy.anchor !== 'fill' && parent.layout === 'free') {
    copy.x += 16;
    copy.y += 16;
  }
  const at = parent.children.findIndex((c) => c.id === widgetId);
  parent.children.splice(at + 1, 0, copy);
  return { doc: next, id: copy.id };
}

/** Move a widget into a container (or to another place in the same one), before the sibling `before` when given. */
export function moveWidget(doc: UiDoc, widgetId: string, newParentId: string, before?: string): UiDoc {
  const next = clone(doc);
  const root = rootOf(next, widgetId);
  const target = rootOf(next, newParentId);
  if (!root || !target || root.root !== undefined && root.key !== target.key) return doc;
  const w = findWidget(root.root, widgetId);
  const parent = parentOf(root.root, widgetId);
  const dest = findWidget(target.root, newParentId);
  if (!w || !parent || !dest) return doc;
  // a widget cannot go inside itself
  if (findWidget(w, newParentId)) return doc;
  parent.children = parent.children.filter((c) => c.id !== widgetId);
  const i = before ? dest.children.findIndex((c) => c.id === before) : -1;
  if (i >= 0) dest.children.splice(i, 0, w);
  else dest.children.push(w);
  return next;
}

/** Put the widget inside a new panel that takes its place. */
export function wrapInPanel(doc: UiDoc, widgetId: string): { doc: UiDoc; id: string } {
  const next = clone(doc);
  const root = rootOf(next, widgetId);
  if (!root) return { doc, id: '' };
  const parent = parentOf(root.root, widgetId);
  const w = findWidget(root.root, widgetId);
  if (!parent || !w) return { doc, id: '' };
  const id = nextId(next, 'w');
  const panel = newWidget('panel', id, freshName(root.root, 'Panel'));
  Object.assign(panel, { anchor: w.anchor, x: w.x, y: w.y, w: w.w + 16, h: w.h + 16, wMode: 'auto', hMode: 'auto', layout: 'column' });
  Object.assign(w, { anchor: 'tl', x: 0, y: 0 });
  const at = parent.children.findIndex((c) => c.id === widgetId);
  panel.children.push(w);
  parent.children.splice(at, 1, panel);
  return { doc: next, id };
}

// ---------- what the picture shows ----------

/** A made-up screen that shows one UI prefab in the middle, so a prefab can be designed in the same picture. */
export function prefabScreen(doc: UiDoc, name: string): UiScreen | null {
  const p = doc.prefabs.find((x) => x.name === name);
  if (!p) return null;
  const root = { ...newWidget('panel', `prefab-root-${name}`, 'Preview'), anchor: 'fill' as UiAnchor, layout: 'free' as const, style: {}, padding: 0, children: [{ ...structuredClone(p.widget), anchor: 'c' as UiAnchor, x: 0, y: 0 }] };
  return { id: name, name: `(prefab ${name})`, root, modal: false, back: 'auto', backTo: '', priority: 0, dim: 0, transition: 'none', mapX: 0, mapY: 0, opensOnStart: false };
}

/** The screen being designed: the chosen one (the first when none is chosen), or the prefab being edited. */
export function designScreen(doc: UiDoc, screenId: string | null, prefab: string | null): UiScreen | null {
  if (prefab) return prefabScreen(doc, prefab);
  return doc.screens.find((s) => s.id === screenId) ?? doc.screens[0] ?? null;
}

// ---------- prefabs ----------

export function prefabNameProblem(doc: UiDoc, name: string): string | null {
  if (!/^[A-Za-z][A-Za-z0-9 _-]{0,31}$/.test(name)) return 'Names use letters, numbers, spaces, - and _, and start with a letter.';
  if (doc.prefabs.some((p) => p.name === name)) return `There is already a UI prefab called "${name}".`;
  return null;
}

/** Make a reusable piece from a widget; the widget is replaced by an instance of it. */
export function makePrefab(doc: UiDoc, widgetId: string, name: string): { doc: UiDoc; id: string; problem?: string } {
  const problem = prefabNameProblem(doc, name);
  if (problem) return { doc, id: '', problem };
  const next = clone(doc);
  const root = rootOf(next, widgetId);
  if (!root || root.kind === 'prefab') return { doc, id: '', problem: 'Choose a widget on a screen.' };
  const parent = parentOf(root.root, widgetId);
  const w = findWidget(root.root, widgetId);
  if (!parent || !w) return { doc, id: '', problem: 'That widget is gone.' };
  const prefabRoot = clone(w);
  Object.assign(prefabRoot, { anchor: 'tl', x: 0, y: 0 });
  next.prefabs.push({ name, widget: prefabRoot } satisfies UiPrefab);
  const inst = newWidget('instance', w.id, name);
  Object.assign(inst, { anchor: w.anchor, x: w.x, y: w.y, w: w.w, h: w.h, wMode: w.wMode, hMode: w.hMode, prefab: name });
  const at = parent.children.findIndex((c) => c.id === widgetId);
  parent.children.splice(at, 1, inst);
  return { doc: next, id: inst.id };
}

/** Turn an instance back into plain widgets (it no longer follows the prefab). */
export function unlinkInstance(doc: UiDoc, widgetId: string): UiDoc {
  const next = clone(doc);
  const root = rootOf(next, widgetId);
  if (!root) return doc;
  const parent = parentOf(root.root, widgetId);
  const inst = findWidget(root.root, widgetId);
  const prefab = inst ? next.prefabs.find((p) => p.name === inst.prefab) : undefined;
  if (!parent || !inst || !prefab) return doc;
  const copy = clone(prefab.widget);
  const used = new Set<string>();
  for (const s of next.screens) walkWidgets(s.root, (w) => used.add(w.id));
  let n = used.size + 1;
  walkWidgets(copy, (w) => {
    while (used.has(`w${n}`)) n++;
    w.id = `w${n}`;
    used.add(w.id);
  });
  walkWidgets(copy, (w) => {
    const over = inst.overrides[w.name];
    if (over) Object.assign(w, clone(over));
  });
  Object.assign(copy, { anchor: inst.anchor, x: inst.x, y: inst.y, name: inst.name });
  if (inst.wMode !== 'auto') Object.assign(copy, { w: inst.w, wMode: inst.wMode });
  if (inst.hMode !== 'auto') Object.assign(copy, { h: inst.h, hMode: inst.hMode });
  const at = parent.children.findIndex((c) => c.id === widgetId);
  parent.children.splice(at, 1, copy);
  return next;
}

export function removePrefab(doc: UiDoc, name: string): UiDoc {
  const next = clone(doc);
  next.prefabs = next.prefabs.filter((p) => p.name !== name);
  return next;
}

/** Where on a screen each prefab is used. */
export function prefabUses(doc: UiDoc, name: string): string[] {
  const out: string[] = [];
  const scan = (label: string, root: UiNode): void =>
    walkWidgets(root, (w) => {
      if ((w.type === 'instance' && w.prefab === name) || w.template === name) out.push(`${label}: ${w.name}`);
    });
  for (const s of doc.screens) scan(s.name, s.root);
  for (const p of doc.prefabs) scan(`prefab ${p.name}`, p.widget);
  return out;
}

// ---------- layout from the picture ----------

const ANCHOR_AT = (fx: number, fy: number): UiAnchor => {
  const col = fx < 1 / 3 ? 0 : fx < 2 / 3 ? 1 : 2;
  const row = fy < 1 / 3 ? 0 : fy < 2 / 3 ? 1 : 2;
  return (['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'] as const)[row * 3 + col]!;
};

/**
 * Where a widget's anchor and offsets go when it is dropped at a point inside its parent: it pins itself to the nearest of the
 * nine places and keeps the distance it was left at (like the HUD editor does). `rect` is the parent's size and `box` the widget's.
 */
export function anchorForDrop(rect: { w: number; h: number }, box: { x: number; y: number; w: number; h: number }): { anchor: UiAnchor; x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const anchor = ANCHOR_AT(cx / Math.max(1, rect.w), cy / Math.max(1, rect.h));
  const h = anchor.endsWith('l') || anchor === 'l' ? 'l' : anchor.endsWith('r') || anchor === 'r' ? 'r' : 'c';
  const v = anchor.startsWith('t') ? 't' : anchor.startsWith('b') ? 'b' : 'c';
  const x = h === 'l' ? box.x : h === 'r' ? box.x + box.w - rect.w : cx - rect.w / 2;
  const y = v === 't' ? box.y : v === 'b' ? box.y + box.h - rect.h : cy - rect.h / 2;
  return { anchor, x: Math.round(x), y: Math.round(y) };
}

export const ANCHOR_CHOICES: UiAnchor[] = [...UI_ANCHORS];

// ---------- focus order ----------

export type Dir = 'up' | 'down' | 'left' | 'right';
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** The arrow from one widget to another, by which way the second lies; the way back too when asked. */
export function linkFocus(doc: UiDoc, fromId: string, toId: string, direction: Dir, both = true): UiDoc {
  let next = updateWidget(doc, fromId, (w) => (w.focus[direction] = toId));
  if (both) next = updateWidget(next, toId, (w) => (w.focus[OPPOSITE[direction]] = fromId));
  return next;
}

export function clearFocus(doc: UiDoc, widgetId: string): UiDoc {
  return updateWidget(doc, widgetId, (w) => (w.focus = { up: '', down: '', left: '', right: '' }));
}

// ---------- the flow of screens ----------

export interface FlowEdge {
  from: string;
  to: string;
  label: string;
}

/** Which screen leads to which: every button whose actions open (or toggle) another screen. */
export function flowEdges(doc: UiDoc): FlowEdge[] {
  const out: FlowEdge[] = [];
  for (const s of doc.screens) {
    walkWidgets(s.root, (w) => {
      for (const a of [...w.on.click, ...w.on.change, ...w.on.hover]) {
        if (a.type !== 'uiScreen') continue;
        const op = String(a.params.op ?? 'open');
        const target = String(a.params.screen ?? '');
        if ((op === 'open' || op === 'toggle') && doc.screens.some((x) => x.name === target)) out.push({ from: s.name, to: target, label: w.text || w.name });
        if (op === 'back') out.push({ from: s.name, to: '(back)', label: w.text || w.name });
      }
    });
  }
  return out;
}

/** Problems with the screens, in plain English. */
export function checkUiDoc(doc: UiDoc, known: { tables?: ReadonlySet<string>; sprites?: ReadonlySet<string>; /** Screens plugins ship, by name (a button may open them). */ pluginScreens?: ReadonlySet<string>; /** Parts plugins say a screen can play, so "role:pause" can be checked. */ roles?: ReadonlySet<string> } = {}): string[] {
  const out: string[] = [];
  const names = new Set<string>();
  for (const s of doc.screens) {
    if (names.has(s.name)) out.push(`Two screens are both called "${s.name}".`);
    names.add(s.name);
  }
  const prefabNames = new Set(doc.prefabs.map((p) => p.name));
  const scan = (label: string, root: UiNode): void => {
    const ids = new Set<string>();
    walkWidgets(root, (w) => {
      if (ids.has(w.id)) out.push(`${label}: two widgets share the id "${w.id}".`);
      ids.add(w.id);
      if (w.type === 'instance' && !prefabNames.has(w.prefab)) out.push(`${label}: "${w.name}" uses the UI prefab "${w.prefab}", which does not exist.`);
      if (w.template && !prefabNames.has(w.template)) out.push(`${label}: "${w.name}" repeats the UI prefab "${w.template}", which does not exist.`);
      if ((w.type === 'list' || w.type === 'grid' || w.type === 'hand') && w.source === '') out.push(`${label}: "${w.name}" has no source of rows yet.`);
      if (w.source.startsWith('table:') && known.tables && !known.tables.has(w.source.slice(6))) out.push(`${label}: "${w.name}" reads the table "${w.source.slice(6)}", which does not exist.`);
      if ((w.type === 'list' || w.type === 'grid' || w.type === 'hand') && w.template === '' && w.children.length === 0) out.push(`${label}: "${w.name}" has nothing to repeat. Put a widget inside it or choose a UI prefab.`);
      if (w.type === 'image' && w.sprite && known.sprites && !known.sprites.has(w.sprite)) out.push(`${label}: "${w.name}" shows the sprite "${w.sprite}", which does not exist.`);
      for (const a of [...w.on.click, ...w.on.change, ...w.on.hover]) {
        if (a.type === 'uiScreen') {
          const op = String(a.params.op ?? 'open');
          const target = String(a.params.screen ?? '');
          // a name with {a value} in it is worked out while the game runs
          const exists = target.includes('{') || (target.startsWith('role:') ? doc.screens.some((s) => roleOfScreen(s) === target.slice(5)) || (known.roles?.has(target.slice(5)) ?? true) : doc.screens.some((s) => s.name === target) || (known.pluginScreens?.has(target) ?? false));
          if ((op === 'open' || op === 'toggle' || op === 'close') && !exists) out.push(`${label}: "${w.name}" ${op}s the screen "${target}", which does not exist.`);
        }
      }
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const id = w.focus[dir];
        if (id && !findWidget(root, id)) out.push(`${label}: the ${dir} arrow of "${w.name}" points at a widget that is gone.`);
      }
      if ((w.type === 'bar' || w.type === 'slider' || w.type === 'toggle' || w.type === 'dropdown') && w.value === '') out.push(`${label}: "${w.name}" is not tied to anything (choose a value for it).`);
    });
  };
  for (const s of doc.screens) scan(`Screen "${s.name}"`, s.root);
  for (const p of doc.prefabs) scan(`UI prefab "${p.name}"`, p.widget);
  return out;
}
