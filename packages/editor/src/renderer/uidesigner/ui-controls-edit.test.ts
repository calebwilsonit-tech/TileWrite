import { describe, expect, it } from 'vitest';
import { UiDocSchema, findWidget, walkWidgets, type UiDoc } from '@tilewright/runtime';
import { UI_STYLES, stylePrefabs, styleParts } from '@tilewright/behaviors';
import { addScreen, addWidget, applyControlStyle, setPart } from './ui-edit';

function withWidget(type: Parameters<typeof addWidget>[3]): { doc: UiDoc; id: string } {
  const made = addScreen(UiDocSchema.parse({}), 'Menu');
  const added = addWidget(made.doc, made.id, made.doc.screens[0]!.root.id, type);
  return { doc: added.doc, id: added.id };
}
const widget = (doc: UiDoc, id: string) => findWidget(doc.screens[0]!.root, id)!;

describe('the parts of a control, chosen in the designer', () => {
  it('names a UI prefab for a part, takes it away again, and keeps the other settings', () => {
    const base = withWidget('slider');
    let doc = base.doc;
    const id = base.id;
    doc = setPart(doc, id, 'slider', 'thumb', 'Brass knob');
    doc = setPart(doc, id, 'slider', 'value', '');
    expect(widget(doc, id).slider?.parts).toEqual({ thumb: 'Brass knob', value: '' });
    doc = setPart(doc, id, 'slider', 'thumb', undefined);
    expect(widget(doc, id).slider?.parts).toEqual({ value: '' });
    expect(widget(doc, id).slider?.angle).toBe(0); // a slider made now has all its settings
    doc = setPart(doc, id, 'slider', 'tick', 'x');
    expect(() => UiDocSchema.parse(doc)).not.toThrow();
  });

  it('parts of a scrollbar live in its scroller, of a drop-down in its pop-up, of a tick box on the widget', () => {
    const base = withWidget('list');
    let doc = base.doc;
    const id = base.id;
    doc = setPart(doc, id, 'bar', 'thumb', 'Gem');
    expect(widget(doc, id).scroller?.bar?.parts).toEqual({ thumb: 'Gem' });
    const d = withWidget('dropdown');
    expect(widget(setPart(d.doc, d.id, 'popup', 'option', 'My option'), d.id).popup?.parts).toEqual({ option: 'My option' });
    const t = withWidget('toggle');
    expect(widget(setPart(t.doc, t.id, 'widget', 'box', 'My box'), t.id).parts).toEqual({ box: 'My box' });
  });
});

describe('starting styles: very different, and only starting points', () => {
  it('there are four and each makes valid UI prefabs for every kind of control', () => {
    expect(UI_STYLES.map((s) => s.id)).toEqual(['flat', 'paper', 'scifi', 'pixel']);
    for (const s of UI_STYLES) {
      const prefabs = stylePrefabs(s.id);
      const names = new Set(prefabs.map((p) => p.name));
      expect(prefabs.length).toBeGreaterThanOrEqual(14);
      for (const kind of ['slider', 'scrollbar', 'popup', 'toggle', 'textfield', 'tabs', 'map']) {
        const parts = styleParts(s.id, kind);
        expect(Object.keys(parts).length, `${s.id} ${kind}`).toBeGreaterThan(0);
        for (const n of Object.values(parts)) expect(names.has(n), `${s.id}: ${n}`).toBe(true);
      }
    }
  });

  it('look nothing alike', () => {
    const fills = UI_STYLES.map((s) => stylePrefabs(s.id).find((p) => p.name.endsWith('pop-up list'))!.widget.style);
    expect(new Set(fills.map((f) => f.fill)).size).toBe(4);
    expect(new Set(fills.map((f) => f.radius)).size).toBeGreaterThanOrEqual(3);
    expect(fills.find((f, i) => UI_STYLES[i]!.id === 'pixel')!.radius).toBe(0);
  });

  it('applying one copies its prefabs into the project (once) and names them in the widget’s parts', () => {
    const base = withWidget('slider');
    let doc = base.doc;
    const id = base.id;
    doc = applyControlStyle(doc, id, 'paper');
    const names = doc.prefabs.map((p) => p.name);
    expect(names).toContain('Old paper slider thumb');
    expect(widget(doc, id).slider?.parts).toMatchObject({ track: 'Old paper slider track', fill: 'Old paper slider fill', thumb: 'Old paper slider thumb' });
    // the prefabs are ordinary: their widgets have ids no other widget has
    const ids: string[] = [];
    for (const s of doc.screens) walkWidgets(s.root, (w) => ids.push(w.id));
    for (const p of doc.prefabs) walkWidgets(p.widget, (w) => ids.push(w.id));
    expect(new Set(ids).size).toBe(ids.length);
    const again = applyControlStyle(doc, id, 'paper');
    expect(again.prefabs).toHaveLength(doc.prefabs.length);
    // another style on top: the parts change, the first style's prefabs stay
    const other = applyControlStyle(doc, id, 'scifi');
    expect(widget(other, id).slider?.parts?.thumb).toBe('Sci-fi slider thumb');
    expect(other.prefabs.map((p) => p.name)).toContain('Old paper slider thumb');
    expect(() => UiDocSchema.parse(other)).not.toThrow();
  });

  it('a list with a scrollbar gets the scrollbar’s parts; a map gets its markers', () => {
    const base = withWidget('list');
    let doc = base.doc;
    const id = base.id;
    doc = applyControlStyle(doc, id, 'pixel');
    expect(widget(doc, id).scroller).toBeUndefined(); // a list that does not scroll has no scrollbar to style
    doc = setPart(doc, id, 'bar', 'track', '');
    doc = applyControlStyle(doc, id, 'pixel');
    expect(widget(doc, id).scroller?.bar?.parts).toMatchObject({ thumb: 'Pixel art scrollbar thumb', track: 'Pixel art scrollbar track' });
    const m = withWidget('map');
    const withMarkers = { ...m.doc, screens: m.doc.screens.map((s) => ({ ...s })) };
    const node = findWidget(withMarkers.screens[0]!.root, m.id)!;
    node.map = { ...(node.map ?? ({} as never)), markers: [{ id: 'pins', name: '', from: 'hand', source: '', x: 'x', y: 'y', prefab: '', state: '', statePrefabs: {}, show: '', sort: '', cluster: 0, clusterPrefab: '', follows: true, label: '', scaleWithZoom: false, choosable: true, hand: [], settings: {} }] } as never;
    const styled = applyControlStyle(withMarkers, m.id, 'scifi');
    expect(widget(styled, m.id).map?.markers[0]!.prefab).toBe('Sci-fi marker');
  });
});
