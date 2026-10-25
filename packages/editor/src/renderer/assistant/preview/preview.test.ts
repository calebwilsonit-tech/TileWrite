import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectSchema, decodePng, newScene } from '@tilewright/runtime';
import { Canvas } from './canvas';
import { fromDialogue, renderGraph } from './graph';
import { previewsFor } from './index';
import { renderScene } from './scene';
import { renderScreens } from './screen';
import { renderTileset } from './tileset';

const samples = path.join(process.cwd(), 'samples');
const read = (...p: string[]): unknown => JSON.parse(fs.readFileSync(path.join(samples, ...p), 'utf8'));
const project = (name: string) => ProjectSchema.parse(read(name, 'project.json'));
const ISO = { tileW: 64, tileH: 32, heightPx: 16 };

/** The colours in a picture, as 0xRRGGBB, with how many pixels each has. */
function colours(png: Uint8Array): Map<number, number> {
  const d = decodePng(png);
  const out = new Map<number, number>();
  for (let i = 0; i < d.width * d.height; i++) {
    const c = (d.rgba[i * 4]! << 16) | (d.rgba[i * 4 + 1]! << 8) | d.rgba[i * 4 + 2]!;
    out.set(c, (out.get(c) ?? 0) + 1);
  }
  return out;
}

describe('the drawing surface', () => {
  it('fills shapes, blends, and writes text in capitals whatever the case', () => {
    const c = new Canvas(40, 20, 0x000000);
    c.poly([[2, 2], [12, 2], [12, 12], [2, 12]], 0xff0000);
    c.text(16, 2, 'Ab1', 0x00ff00);
    const d = decodePng(c.toPng());
    const at = (x: number, y: number): number[] => [...d.rgba.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 3)];
    expect(at(6, 6)).toEqual([255, 0, 0]);
    expect(at(30, 15)).toEqual([0, 0, 0]);
    expect(colours(c.toPng()).has(0x00ff00)).toBe(true);
    const lower = new Canvas(40, 20, 0x000000);
    lower.text(16, 2, 'ab1', 0x00ff00);
    const upper = new Canvas(40, 20, 0x000000);
    upper.text(16, 2, 'AB1', 0x00ff00);
    expect(lower.rgba).toEqual(upper.rgba);
    c.rect(0, 0, 40, 20, 0xffffff, 0.5);
    expect(decodePng(c.toPng()).rgba[0]).toBeGreaterThan(120);
  });
});

describe('a picture of a scene', () => {
  const tileset = [
    { id: 1, name: 'grass', top: 0x44aa44, left: 0x226622, right: 0x338833 },
    { id: 2, name: 'stone', top: 0x999999, left: 0x555555, right: 0x777777 },
  ];

  it('draws the tiles in their colours, the heights, the objects and their names', () => {
    const data = newScene('Test', 8, 8);
    data.map.tiles[3]![3] = 2;
    data.map.heights[3]![3] = 2;
    data.entities = [{ id: 'p', name: 'Hero', tags: ['player'], components: { transform: { x: 1.5, y: 1.5, h: 0, facing: 2 } } }];
    const pic = renderScene(data, { tileset, iso: ISO })!;
    expect(pic).not.toBeNull();
    const seen = colours(pic.png);
    expect(seen.has(0x44aa44)).toBe(true); // grass top
    expect(seen.has(0x999999)).toBe(true); // the stone block's top
    expect(seen.has(0x555555)).toBe(true); // its side
    expect(seen.has(0xffd24a)).toBe(true); // the player's marker
    expect(pic.notes.join(' ')).toContain('Map 8 x 8 cells, ground up to 2 levels high; 1 object');
    expect(pic.notes.join(' ')).toContain('yellow marker');
    const decoded = decodePng(pic.png);
    expect([decoded.width, decoded.height]).toEqual([pic.width, pic.height]);
  });

  it('draws blocks of a stack, pits, water, regions and wires, and says what they are', () => {
    const data = newScene('Rich', 6, 6);
    data.map.stacks = [{ x: 2, y: 2, floor: 1, blocks: [{ z: 0, tile: 2 }, { z: 1, tile: 2, shape: 'stairs', rot: 1 }] }];
    data.map.flags[1]![1] = 1; // a pit
    data.map.flags[4]![4] = 8; // water
    data.regions = [{ id: 'r', name: 'Camp', x: 0, y: 0, w: 2, h: 2, cameraBounds: false, music: '', darkness: 0, bossActive: false }];
    data.entities = [
      { id: 'a', name: 'Plate', tags: [], components: { transform: { x: 4.5, y: 0.5, h: 0 } } },
      { id: 'b', name: 'Gate', tags: [], components: { transform: { x: 0.5, y: 4.5, h: 0 } } },
    ];
    data.wires = [{ id: 'w', from: { entity: 'a', output: 'pressed' }, to: { entity: 'b', input: 'open' } }];
    const pic = renderScene(data, { tileset, iso: ISO })!;
    const notes = pic.notes.join(' ');
    expect(notes).toContain('1 pit cell');
    expect(notes).toContain('1 water cell');
    expect(notes).toContain('1 region');
    expect(notes).toContain('1 wire');
    const seen = colours(pic.png);
    expect(seen.has(0x08090c)).toBe(true); // the pit
    expect(seen.has(0x2f6fd0)).toBe(true); // the water
    expect(seen.has(0x58d0e0)).toBe(true); // the wire
  });

  it('draws a huge map from above instead of at an angle, and refuses what is not a scene', () => {
    const pic = renderScene(newScene('Big', 300, 300), { tileset, iso: ISO })!;
    expect(pic.notes.join(' ')).toContain('seen from straight above');
    expect(pic.width).toBeLessThanOrEqual(1210);
    expect(renderScene({ not: 'a scene' }, { tileset, iso: ISO })).toBeNull();
  });

  it('draws every sample project scene without trouble', () => {
    let drawn = 0;
    for (const dir of fs.readdirSync(samples)) {
      if (!fs.existsSync(path.join(samples, dir, 'project.json'))) continue;
      const proj = project(dir);
      for (const scenePath of proj.scenes) {
        const pic = previewsFor(scenePath, JSON.parse(fs.readFileSync(path.join(samples, dir, scenePath), 'utf8')), { tileset: proj.tileset, iso: proj.iso });
        expect(pic, `${dir}/${scenePath}`).not.toBeNull();
        const first = decodePng(pic!.pictures[0]!.png);
        expect(first.width).toBeGreaterThan(50);
        expect(first.width).toBeLessThanOrEqual(1210);
        drawn++;
      }
    }
    expect(drawn).toBeGreaterThanOrEqual(8);
  });
});

describe('pictures of tiles', () => {
  it('shows each tile as a block with its number and name, and says which have pictures', () => {
    const pic = renderTileset([
      { id: 1, name: 'grass', top: 0x44aa44, left: 0x226622, right: 0x338833 },
      { id: 2, name: 'tree', top: 0x999999, left: 0x555555, right: 0x777777, art: 'tree' },
    ])!;
    expect(colours(pic.png).has(0x44aa44)).toBe(true);
    expect(pic.notes.join(' ')).toContain('2 tiles');
    expect(pic.notes.join(' ')).toContain('1 of them have pictures');
    expect(renderTileset([])).toBeNull();
    const proj = project('tiles-house');
    expect(previewsFor('project.json', { tileset: proj.tileset }, { tileset: proj.tileset, iso: proj.iso })!.pictures).toHaveLength(1);
  });
});

describe('pictures of screens', () => {
  it('lays out a screen from its file and names its buttons', () => {
    const shown = renderScreens(read('ui-showcase', 'assets', 'screens.json'))!;
    expect(shown.pictures.length).toBeGreaterThan(0);
    const first = shown.pictures[0]!;
    expect(first.notes.join(' ')).toContain('wireframe');
    expect(decodePng(first.png).width).toBe(960);
    expect(colours(first.png).size).toBeGreaterThan(5); // something other than the background was drawn
  });

  it('keeps fixed sizes, stacks a column with a gap and puts a bottom-right widget in the corner', () => {
    const node = (over: Record<string, unknown>) => ({ ...over });
    const doc = {
      screens: [
        {
          id: 's1',
          name: 'Test',
          root: node({
            id: 'root',
            type: 'panel',
            anchor: 'fill',
            layout: 'free',
            padding: 0,
            style: { fill: '#101010' },
            children: [
              node({
                id: 'col',
                type: 'panel',
                anchor: 'tl',
                x: 20,
                y: 20,
                w: 200,
                h: 200,
                layout: 'column',
                gap: 10,
                padding: 0,
                style: { fill: '#aa0000' },
                children: [node({ id: 'a', type: 'button', w: 100, h: 40, style: { fill: '#00aa00' } }), node({ id: 'b', type: 'button', w: 100, h: 40, style: { fill: '#0000aa' } })],
              }),
              node({ id: 'corner', type: 'panel', anchor: 'br', x: 10, y: 10, w: 50, h: 50, padding: 0, style: { fill: '#ffff00' } }),
            ],
          }),
        },
      ],
    };
    const pic = renderScreens(doc)!.pictures[0]!;
    const d = decodePng(pic.png);
    const at = (x: number, y: number): number => (d.rgba[(y * d.width + x) * 4]! << 16) | (d.rgba[(y * d.width + x) * 4 + 1]! << 8) | d.rgba[(y * d.width + x) * 4 + 2]!;
    expect(at(30, 30)).toBe(0x00aa00); // first button: x 20, y 20, 100 x 40
    expect(at(30, 80)).toBe(0x0000aa); // second: y 20 + 40 + gap 10 = 70 to 110
    expect(at(30, 65)).toBe(0xaa0000); // the column shows in the gap
    expect(at(960 - 10 - 25, 540 - 10 - 25)).toBe(0xffff00); // the corner box
    expect(renderScreens({ screens: [] })).toBeNull();
  });
});

describe('pictures of graphs', () => {
  it('draws a conversation from its start, with a label for each choice, and a logic graph where its boxes were put', () => {
    const dialogue = {
      name: 'Gatekeeper',
      start: 'hello',
      nodes: [
        { id: 'hello', type: 'line', speaker: 'Guard', text: 'Halt!', next: 'ask' },
        { id: 'ask', type: 'choice', prompt: 'Pass?', options: [{ text: 'Yes', next: 'ok' }, { text: 'No', next: 'bye' }] },
        { id: 'ok', type: 'give', item: 'key', amount: 1, next: 'bye' },
        { id: 'bye', type: 'end' },
      ],
    };
    const pic = previewsFor('assets/dialogues/gate.dialogue.json', dialogue, { tileset: [], iso: ISO })!;
    expect(pic.pictures[0]!.caption).toContain('Gatekeeper');
    expect(pic.notes.join(' ')).toContain('4 boxes, 4 arrows');
    expect(fromDialogue(dialogue as never).width).toBeGreaterThan(200);
    const logic = renderGraph('G', [{ id: 'a', label: 'START', color: 0x3a8f5c, x: 0, y: 0 }, { id: 'b', label: 'SET X', color: 0x4a4f60, x: 200, y: 60 }], [{ from: 'a', to: 'b' }]);
    expect(logic.width).toBeGreaterThan(200);
    expect(logic.notes[0]).toContain('2 boxes, 1 arrow');
  });

  it('copes with loops and does not get stuck', () => {
    const nodes = ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase(), color: 0x4a4f60 }));
    const pic = renderGraph('Loop', nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]);
    expect(pic.width).toBeGreaterThan(100);
  });

  it('gives a picture of nothing it does not know', () => {
    expect(previewsFor('assets/other.json', {}, { tileset: [], iso: ISO })).toBeNull();
    expect(previewsFor('assets/dialogues/bad.dialogue.json', { nope: true }, { tileset: [], iso: ISO })).toBeNull();
  });
});
