import { describe, expect, it } from 'vitest';
import { emptyUiDoc, findWidget, walkWidgets, type UiDoc } from '@tilewright/runtime';
import { addScreen, addWidget, anchorForDrop, checkUiDoc, duplicateWidget, flowEdges, linkFocus, makePrefab, moveWidget, removePrefab, removeWidget, screenNameProblem, unlinkInstance, updateWidget, wrapInPanel, prefabUses, rootOf } from './ui-edit';

function withScreen(): { doc: UiDoc; screen: string; root: string } {
  const made = addScreen(emptyUiDoc(), 'Menu');
  return { doc: made.doc, screen: made.id, root: made.doc.screens[0]!.root.id };
}

describe('building screens', () => {
  it('adds screens with unique names, and a root that fills the screen', () => {
    const { doc } = withScreen();
    expect(doc.screens[0]!.root.anchor).toBe('fill');
    expect(screenNameProblem(doc, 'Menu')).toContain('already');
    expect(screenNameProblem(doc, '')).toContain('name');
    expect(screenNameProblem(doc, 'Menu', doc.screens[0]!.id)).toBeNull();
    const two = addScreen(doc, 'Options');
    expect(two.doc.screens.map((s) => s.id)).toEqual(['s1', 's2'].map((x, i) => (i === 0 ? doc.screens[0]!.id : two.id)));
  });

  it('adds widgets inside containers with names that differ and ids that never repeat', () => {
    const start = withScreen();
    let doc = start.doc;
    const { screen, root } = start;
    const a = addWidget(doc, screen, root, 'button');
    doc = a.doc;
    const b = addWidget(doc, screen, root, 'button');
    doc = b.doc;
    const kids = doc.screens[0]!.root.children;
    expect(kids.map((k) => k.name)).toEqual(['Button', 'Button 2']);
    expect(new Set(kids.map((k) => k.id)).size).toBe(2);
    const inner = addWidget(doc, screen, a.id, 'text');
    expect(findWidget(inner.doc.screens[0]!.root, a.id)!.children).toHaveLength(1);
  });

  it('removes, duplicates, moves and wraps widgets', () => {
    const start = withScreen();
    let doc = start.doc;
    const { screen, root } = start;
    const panel = addWidget(doc, screen, root, 'panel');
    doc = panel.doc;
    const btn = addWidget(doc, screen, root, 'button');
    doc = btn.doc;
    doc = moveWidget(doc, btn.id, panel.id);
    expect(findWidget(doc.screens[0]!.root, panel.id)!.children.map((c) => c.id)).toEqual([btn.id]);
    expect(moveWidget(doc, panel.id, btn.id)).toBe(doc); // not into itself or its own child
    const dup = duplicateWidget(doc, panel.id);
    doc = dup.doc;
    const ids: string[] = [];
    walkWidgets(doc.screens[0]!.root, (w) => ids.push(w.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(findWidget(doc.screens[0]!.root, dup.id)!.name).toBe('Panel 2');
    expect(findWidget(doc.screens[0]!.root, dup.id)!.children).toHaveLength(1);
    const wrapped = wrapInPanel(doc, btn.id);
    doc = wrapped.doc;
    expect(findWidget(doc.screens[0]!.root, wrapped.id)!.children.map((c) => c.id)).toEqual([btn.id]);
    doc = removeWidget(doc, wrapped.id);
    expect(findWidget(doc.screens[0]!.root, btn.id)).toBeNull();
  });

  it('changes a widget wherever it lives', () => {
    const start = withScreen();
    let doc = start.doc;
    const { screen, root } = start;
    const t = addWidget(doc, screen, root, 'text');
    doc = updateWidget(t.doc, t.id, (w) => (w.text = 'Hello {name}'));
    expect(findWidget(doc.screens[0]!.root, t.id)!.text).toBe('Hello {name}');
    expect(rootOf(doc, t.id)!.kind).toBe('screen');
  });
});

describe('UI prefabs', () => {
  it('make a reusable piece, change once and every use follows, and can be unlinked', () => {
    const start = withScreen();
    let doc = start.doc;
    const { screen, root } = start;
    const slot = addWidget(doc, screen, root, 'panel');
    doc = addWidget(slot.doc, screen, slot.id, 'text').doc;
    doc = updateWidget(doc, slot.id, (w) => (w.x = 30));
    const made = makePrefab(doc, slot.id, 'Slot');
    expect(made.problem).toBeUndefined();
    doc = made.doc;
    const inst = findWidget(doc.screens[0]!.root, made.id)!;
    expect(inst).toMatchObject({ type: 'instance', prefab: 'Slot', x: 30 });
    expect(doc.prefabs[0]!.widget.x).toBe(0);
    expect(makePrefab(doc, made.id, 'Slot').problem).toContain('already');
    expect(makePrefab(doc, made.id, '9x').problem).toContain('letters');
    expect(prefabUses(doc, 'Slot')).toHaveLength(1);
    // an instance can be unlinked into plain widgets again
    const plain = unlinkInstance(doc, made.id);
    expect(findWidget(plain.screens[0]!.root, made.id)).toBeNull(); // (its widgets got new ids)
    expect(plain.screens[0]!.root.children[0]!.type).toBe('panel');
    expect(plain.screens[0]!.root.children[0]!.children).toHaveLength(1);
    expect(removePrefab(doc, 'Slot').prefabs).toEqual([]);
  });
});

describe('placing by dropping', () => {
  it('pins to the nearest of nine places and keeps the distance', () => {
    const parent = { w: 1000, h: 600 };
    expect(anchorForDrop(parent, { x: 20, y: 10, w: 100, h: 40 })).toEqual({ anchor: 'tl', x: 20, y: 10 });
    expect(anchorForDrop(parent, { x: 880, y: 550, w: 100, h: 40 })).toEqual({ anchor: 'br', x: -20, y: -10 });
    expect(anchorForDrop(parent, { x: 450, y: 280, w: 100, h: 40 })).toEqual({ anchor: 'c', x: 0, y: 0 });
    expect(anchorForDrop(parent, { x: 450, y: 10, w: 100, h: 40 })).toEqual({ anchor: 't', x: 0, y: 10 });
  });
});

describe('focus order and flow', () => {
  it('draws arrows both ways, and finds which screen leads to which', () => {
    const start = withScreen();
    let doc = start.doc;
    const { screen, root } = start;
    const a = addWidget(doc, screen, root, 'button');
    const b = addWidget(a.doc, screen, root, 'button');
    doc = linkFocus(b.doc, a.id, b.id, 'down');
    expect(findWidget(doc.screens[0]!.root, a.id)!.focus.down).toBe(b.id);
    expect(findWidget(doc.screens[0]!.root, b.id)!.focus.up).toBe(a.id);
    doc = addScreen(doc, 'Settings').doc;
    doc = updateWidget(doc, a.id, (w) => {
      w.text = 'Settings';
      w.on.click = [{ type: 'uiScreen', params: { op: 'open', screen: 'Settings' } }];
    });
    doc = updateWidget(doc, b.id, (w) => {
      w.text = 'Back';
      w.on.click = [{ type: 'uiScreen', params: { op: 'back', screen: '' } }];
    });
    expect(flowEdges(doc)).toEqual([
      { from: 'Menu', to: 'Settings', label: 'Settings' },
      { from: 'Menu', to: '(back)', label: 'Back' },
    ]);
  });
});

describe('checking screens', () => {
  it('finds broken links, empty lists and widgets tied to nothing', () => {
    const start = withScreen();
    let doc = start.doc;
    const { screen, root } = start;
    const list = addWidget(doc, screen, root, 'list');
    const bar = addWidget(list.doc, screen, root, 'bar');
    const btn = addWidget(bar.doc, screen, root, 'button');
    doc = updateWidget(btn.doc, btn.id, (w) => (w.on.click = [{ type: 'uiScreen', params: { op: 'open', screen: 'Nowhere' } }]));
    doc = updateWidget(doc, list.id, (w) => (w.source = 'table:Missing'));
    const problems = checkUiDoc(doc, { tables: new Set(['Real']) });
    expect(problems.some((p) => p.includes('"Missing", which does not exist'))).toBe(true);
    expect(problems.some((p) => p.includes('nothing to repeat'))).toBe(true);
    expect(problems.some((p) => p.includes('not tied to anything'))).toBe(true);
    expect(problems.some((p) => p.includes('"Nowhere"'))).toBe(true);
    expect(checkUiDoc(withScreen().doc)).toEqual([]);
  });
});

describe('checking buttons that open screens', () => {
  const openFrom = (screen: string): UiDoc => {
    const start = withScreen();
    const made = addWidget(start.doc, start.screen, start.root, 'button');
    return updateWidget(made.doc, made.id, (w) => void (w.on.click = [{ type: 'uiScreen', params: { op: 'open', screen } }]));
  };

  it('a screen by name must exist, in the project or among the plugins\u2019', () => {
    expect(checkUiDoc(openFrom('Nope'))).toEqual([expect.stringContaining('opens the screen "Nope", which does not exist')]);
    expect(checkUiDoc(openFrom('Settings'), { pluginScreens: new Set(['Settings']) })).toEqual([]);
    expect(checkUiDoc(openFrom('Menu'))).toEqual([]);
  });

  it('a part ("role:pause") must be one a plugin offers or a screen of the project plays; a name with a {value} in it is worked out in the game', () => {
    expect(checkUiDoc(openFrom('role:pause'), { roles: new Set(['pause']) })).toEqual([]);
    expect(checkUiDoc(openFrom('role:journal'), { roles: new Set(['pause']) })).toEqual([expect.stringContaining('role:journal')]);
    expect(checkUiDoc(openFrom('{entry.opens}'))).toEqual([]);
  });
});
