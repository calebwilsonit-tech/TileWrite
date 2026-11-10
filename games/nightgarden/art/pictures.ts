import { D, E, L, R, type Frame, type Ink, type Op, type Picture } from './draw';

/** Everything that stands in the garden, and the small pictures the screens use. Sizes are in pixels; a cell is 64 x 32 and a level 16. */

/** A flat diamond `h` pixels tall (twice as wide), centred on (cx, cy), a row at a time. */
function diamond(c: Ink, cx: number, cy: number, h: number): Op[] {
  const out: Op[] = [];
  const y0 = cy - h / 2;
  for (let j = 0; j < h; j++) {
    const d = Math.min(j, h - 1 - j);
    out.push(L(c, cx - 2 * d - 2, y0 + j, cx + 2 * d + 1, y0 + j));
  }
  return out;
}

/** The outline of that diamond. */
function diamondEdge(c: Ink, cx: number, cy: number, h: number): Op[] {
  const y0 = cy - h / 2;
  const pts: [number, number][] = [];
  for (let j = 0; j < h; j++) {
    const d = Math.min(j, h - 1 - j);
    pts.push([cx - 2 * d - 2, y0 + j], [cx - 2 * d - 1, y0 + j], [cx + 2 * d, y0 + j], [cx + 2 * d + 1, y0 + j]);
  }
  return [D(c, ...pts)];
}

/** A box seen at the game's angle: its base diamond is `h` pixels tall and centred on (cx, cy); it stands `z` pixels high. */
function isoBox(cx: number, cy: number, h: number, z: number, top: Ink, left: Ink, right: Ink): Op[] {
  const out: Op[] = [];
  const ytop = cy - z - h / 2;
  for (let i = 0; i < h; i++) {
    const y = ytop + h - Math.floor(i / 2);
    out.push(L(left, cx - 1 - i, y, cx - 1 - i, y + z - 1), L(right, cx + i, y, cx + i, y + z - 1));
  }
  out.push(...diamond(top, cx, cy - z, h));
  return out;
}

const one = (name: string, w: number, h: number, feet: [number, number], ops: Op[]): Picture => ({ name, w, h, feet, frames: [{ ops }] });

// ---------- the gardener ----------

/** The gardener seen from the front (walking down-right) or from behind (walking up-right), with the legs in one of three poses. */
function gardener(back: boolean, pose: 0 | 1 | 2): Op[] {
  const bob = pose === 0 ? 0 : 1;
  const y = bob; // the body dips a pixel on a step
  const legs: Op[] =
    pose === 0
      ? [R('night', 9, 26, 11, 31), R('night', 13, 26, 15, 31), R('wood', 9, 32, 11, 33), R('wood', 13, 32, 15, 33)]
      : pose === 1
        ? [R('night', 8, 26, 10, 30), R('night', 13, 26, 15, 31), R('wood', 7, 31, 10, 32), R('wood', 13, 32, 15, 33)]
        : [R('night', 9, 26, 11, 31), R('night', 14, 26, 16, 30), R('wood', 9, 32, 11, 33), R('wood', 14, 31, 17, 32)];
  const coat: Op[] = [
    R('teal', 8, 15 + y, 16, 26),
    R('aqua', 8, 15 + y, 9, 25), // the lit side
    L('pine', 8, 22 + y, 16, 22 + y), // belt
    R('teal', 6, 16 + y, 7, 22 + y),
    R('teal', 17, 16 + y, 18, 22 + y),
    D('skin', [6, 23 + y], [7, 23 + y], [17, 23 + y], [18, 23 + y]),
  ];
  const head: Op[] = back
    ? [R('tan', 9, 9 + y, 15, 14 + y), R('wood', 9, 9 + y, 15, 12 + y)]
    : [R('skin', 9, 9 + y, 15, 14 + y), D('tan', [9, 14 + y], [15, 14 + y]), D('ink', [11, 12 + y], [14, 12 + y]), D('pink', [10, 13 + y], [15, 13 + y])];
  const hat: Op[] = [E('gold', 4, 6 + y, 20, 10 + y), E('amber', 8, 2 + y, 16, 8 + y), L('red', 8, 7 + y, 16, 7 + y), D('glow', [10, 3 + y], [11, 3 + y])];
  // the lamplighter's pole, carried on the right
  const pole: Op[] = [L('oak', 20, 10 + y, 20, 27 + y), D('gold', [20, 9 + y], [20, 8 + y], [19, 8 + y], [21, 8 + y]), D('glow', [20, 7 + y])];
  return [...legs, ...coat, ...head, ...hat, ...(back ? [] : pole), ...(back ? [L('pine', 12, 16 + y, 12, 21 + y)] : [D('gold', [12, 17 + y], [12, 19 + y])])];
}

const GARDENER: Picture = {
  name: 'gardener',
  w: 26,
  h: 36,
  feet: [12, 33],
  frames: ([[false, 0], [false, 1], [false, 2], [true, 0], [true, 1], [true, 2]] as const).map(([back, pose]): Frame => ({ from: 'blank', ms: 130, ops: gardener(back, pose) })),
  clips: [
    { name: 'stand', mirror: true, all: '1', dirs: { E: '1', SE: '1', S: '1', NE: '4', N: '4' } },
    { name: 'walk', mirror: true, all: '2, 1, 3, 1', dirs: { E: '2, 1, 3, 1', SE: '2, 1, 3, 1', S: '2, 1, 3, 1', NE: '5, 4, 6, 4', N: '5, 4, 6, 4' } },
  ],
};

// ---------- lamps ----------

function lamp(glass: Ink, core: Ink | null, metal: Ink, dark: Ink): Op[] {
  return [
    E('ink', 6, 41, 17, 46), // foot
    E(dark, 7, 40, 16, 44),
    R(dark, 11, 18, 12, 41), // post
    D(metal, [11, 20], [11, 24], [11, 28], [11, 32], [11, 36]),
    R(metal, 8, 17, 15, 18), // collar
    R(glass, 7, 7, 16, 16), // lantern glass
    ...(core ? [R(core, 9, 9, 14, 15), E('glow', 10, 10, 13, 14)] : [R('slate', 9, 9, 14, 15)]),
    L(dark, 7, 7, 7, 16),
    L(dark, 16, 7, 16, 16),
    L(dark, 11, 7, 12, 7),
    R(dark, 6, 5, 17, 6), // cap
    R(metal, 8, 3, 15, 4),
    D(metal, [11, 2], [12, 2], [11, 1], [12, 1]),
  ];
}

// ---------- blooms ----------

const BED = (): Op[] => [...diamond('loam', 32, 48, 28), ...diamondEdge('wood', 32, 48, 28)];

function moonbloom(stage: 0 | 1 | 2 | 3): Op[] {
  const out = BED();
  if (stage === 0) {
    // a rosette of leaves lying on the bed, with a closed bud
    out.push(E('moss', 20, 43, 44, 54), E('leaf', 24, 44, 40, 52), L('moss', 32, 44, 32, 52), L('moss', 25, 48, 39, 48), E('sky', 30, 45, 34, 49), D('petal', [32, 46], [31, 47]));
    return out;
  }
  const top = stage === 1 ? 36 : stage === 2 ? 26 : 16; // where the stalk ends
  // a skirt of leaves that fills the bed more as it grows, so a grown bloom reads as something in the way
  if (stage === 1) out.push(E('moss', 22, 44, 42, 53), E('leaf', 26, 45, 38, 51));
  else if (stage === 2) out.push(E('pine', 14, 41, 50, 57), E('moss', 17, 41, 47, 54), E('leaf', 22, 42, 42, 51));
  else out.push(E('pine', 8, 38, 56, 60), E('moss', 11, 38, 53, 57), E('leaf', 17, 39, 47, 53), D('lime', [20, 44], [27, 41], [38, 42], [44, 46], [24, 50], [40, 51]));
  out.push(R('moss', 29, top, 34, 48), L('leaf', 29, top, 30, 48), L('pine', 34, top, 34, 48));
  // leaves up the stalk
  for (let y = 42; y > top + 6; y -= 8) out.push(E('leaf', 22, y - 3, 30, y + 1), E('moss', 34, y - 7, 42, y - 3), D('lime', [24, y - 2], [39, y - 6]));
  // the flower: a bud, then half open, then wide open and glowing
  if (stage === 1) out.push(E('sky', 28, top - 5, 35, top + 2), D('petal', [31, top - 4], [30, top - 3]));
  else if (stage === 2) out.push(E('sky', 25, top - 8, 38, top + 2), E('petal', 28, top - 6, 35, top), D('glow', [31, top - 4], [32, top - 3]));
  else out.push(E('sky', 20, top - 10, 43, top + 4), E('petal', 23, top - 9, 40, top + 1), E('moon', 27, top - 8, 36, top - 2), E('glow', 30, top - 6, 33, top - 3), D('sky', [22, top - 3], [41, top - 3], [31, top + 4], [32, top + 4]));
  return out;
}

function duskcap(stage: 0 | 1 | 2 | 3): Op[] {
  const out = BED();
  if (stage === 0) {
    // a cluster of button caps
    out.push(E('plum', 23, 45, 31, 50), E('violet', 24, 45, 30, 48), E('plum', 32, 46, 41, 52), E('violet', 33, 46, 40, 50), D('lilac', [26, 46], [35, 47], [38, 48]));
    return out;
  }
  const top = stage === 1 ? 36 : stage === 2 ? 26 : 16;
  if (stage === 1) out.push(E('plum', 24, 46, 40, 53));
  else if (stage === 2) out.push(E('plum', 16, 43, 48, 56), E('violet', 21, 46, 28, 50), E('violet', 36, 47, 44, 52), D('lilac', [23, 47], [39, 48]));
  else out.push(E('plum', 9, 40, 55, 59), E('violet', 14, 44, 24, 50), E('violet', 38, 46, 50, 54), E('violet', 24, 51, 33, 56), D('lilac', [17, 45], [42, 48], [27, 52], [46, 50]));
  out.push(R('petal', 28, top, 35, 49), L('moon', 29, top, 29, 49), L('pale', 34, top, 34, 49), D('pale', [31, top + 6], [32, top + 12], [31, top + 18]));
  if (stage === 1) out.push(E('plum', 24, top - 5, 39, top + 3), E('violet', 25, top - 5, 38, top), D('lilac', [29, top - 3], [34, top - 2]));
  else if (stage === 2) out.push(E('plum', 20, top - 8, 43, top + 4), E('violet', 21, top - 8, 42, top - 1), D('lilac', [26, top - 5], [33, top - 6], [38, top - 3], [30, top - 2]));
  else
    out.push(
      E('plum', 14, top - 11, 49, top + 6),
      E('violet', 15, top - 11, 48, top),
      E('lilac', 22, top - 10, 36, top - 6),
      D('glow', [24, top - 6], [34, top - 4], [41, top - 5], [19, top - 3], [29, top - 2]),
      L('plum', 18, top + 4, 45, top + 4),
      D('pink', [22, top + 5], [28, top + 6], [35, top + 6], [41, top + 5]),
    );
  return out;
}

// ---------- things to push ----------

const CRATE: Op[] = [
  ...isoBox(32, 40, 28, 16, 'oak', 'wood', 'soil'),
  ...diamondEdge('wood', 32, 24, 28),
  L('soil', 4, 26, 4, 39), L('soil', 17, 32, 17, 47), L('soil', 31, 39, 31, 54), // boards, left face
  L('loam', 46, 32, 46, 47), L('loam', 59, 26, 59, 39),
  L('gold', 18, 20, 44, 20), D('gold', [20, 27], [43, 27]),
];

const BRAZIER: Op[] = [
  ...isoBox(32, 44, 20, 8, 'stone', 'slate', 'night'), // stone foot
  ...isoBox(32, 36, 24, 8, 'iron', 'steel', 'ink'), // iron bowl
  ...diamond('ember', 32, 28, 16),
  E('ember', 24, 12, 39, 29),
  E('amber', 26, 9, 37, 27),
  E('gold', 28, 13, 35, 26),
  E('glow', 30, 18, 33, 25),
  D('amber', [31, 7], [32, 5], [27, 10], [36, 9]),
  D('gold', [32, 8], [29, 12]),
];

const SCREEN: Op[] = [
  ...isoBox(32, 56, 28, 32, 'oak', 'wood', 'soil'),
  // lattice on the two faces
  ...[0, 8, 16, 24].flatMap((k): Op[] => [L('loam', 5, 30 + k, 30, 43 + k), L('ink', 33, 43 + k, 58, 30 + k)]),
  ...[8, 18, 28].flatMap((x): Op[] => [L('loam', x - 4, 24 + Math.floor(x / 2), x - 4, 54 + Math.floor(x / 2)), L('ink', 63 - x + 4, 24 + Math.floor(x / 2), 63 - x + 4, 54 + Math.floor(x / 2))]),
  ...diamondEdge('gold', 32, 24, 28),
  E('leaf', 8, 30, 14, 35), E('leaf', 20, 46, 26, 51), E('moss', 44, 44, 50, 49), D('lime', [10, 31], [22, 47]),
];

// ---------- switches ----------

const PLATE = (down: boolean): Op[] => [
  ...diamond('steel', 32, 17, 26),
  ...diamond(down ? 'iron' : 'pale', 32, down ? 17 : 15, 22),
  ...diamondEdge(down ? 'steel' : 'moon', 32, down ? 17 : 15, 22),
  ...diamond(down ? 'amber' : 'iron', 32, down ? 17 : 15, 8),
];

const STONE = (rim: Ink, gem: Ink, shine: Ink, core: Ink): Op[] => [
  ...diamond('steel', 32, 17, 22),
  ...diamondEdge(rim, 32, 17, 22),
  ...diamond(gem, 32, 15, 14),
  ...diamond(shine, 32, 14, 8),
  D(core, [31, 13], [32, 13], [30, 14], [33, 14]),
];

function gate(open: 0 | 1 | 2): Op[] {
  // two stone posts and iron bars between them; the bars sink into the sill as it opens
  const bar = open === 0 ? 30 : open === 1 ? 14 : 0;
  const out: Op[] = [...diamond('slate', 32, 56, 30), ...diamondEdge('night', 32, 56, 30)];
  out.push(...isoBox(8, 52, 8, 36, 'pale', 'stone', 'slate')); // far-left post
  if (bar > 0) {
    for (let i = 0; i < 6; i++) {
      const x = 14 + i * 4;
      const y = 53 + i * 2;
      out.push(L('iron', x, y - bar, x, y), L('steel', x + 1, y - bar, x + 1, y), D('pale', [x, y - bar - 1]));
    }
    out.push(L('steel', 13, 51 - bar + 6, 37, 63 - bar + 6), L('steel', 13, 47, 37, 59));
  } else {
    for (let i = 0; i < 6; i++) out.push(D('iron', [14 + i * 4, 53 + i * 2], [15 + i * 4, 53 + i * 2]));
  }
  out.push(...isoBox(44, 68, 8, 36, 'pale', 'stone', 'slate')); // near-right post
  out.push(D('gold', [8, 13], [44, 29]));
  return out;
}

const EXIT = (bright: boolean): Op[] => [
  ...diamond('pine', 32, 16, 28),
  ...diamondEdge(bright ? 'lime' : 'leaf', 32, 16, 28),
  ...diamond('moss', 32, 16, 20),
  ...diamondEdge(bright ? 'glow' : 'lime', 32, 16, 14),
  ...diamond(bright ? 'lime' : 'leaf', 32, 16, 6),
  D(bright ? 'glow' : 'lime', [31, 15], [32, 15], [31, 16], [32, 16]),
];

const FIREFLY = (wing: boolean): Op[] => [
  E('amber', 4, 5, 11, 12),
  E('gold', 5, 6, 10, 11),
  E('glow', 6, 7, 9, 10),
  ...(wing ? [D('petal', [3, 4], [2, 3], [12, 4], [13, 3])] : [D('petal', [3, 7], [2, 7], [12, 7], [13, 7])]),
  D('ink', [7, 4], [8, 4]),
];

const CURSOR: Op[] = [L('gold', 2, 2, 7, 7), L('gold', 8, 7, 13, 2), L('glow', 2, 1, 7, 6), L('glow', 8, 6, 13, 1), L('amber', 2, 3, 7, 8), L('amber', 8, 8, 13, 3)];

/** The same strokes, moved. */
function moved(ops: Op[], dx: number, dy: number): Op[] {
  const m = ([x, y]: [number, number]): [number, number] => [x + dx, y + dy];
  return ops.map((o): Op => (o.t === 'dots' ? { ...o, pts: o.pts.map(m) } : o.t === 'fill' ? { ...o, at: m(o.at) } : { ...o, a: m(o.a), b: m(o.b) }));
}

// the picture over the name of the game on the title screen: a lit lamp, a moonbloom and a duskcap under a crescent moon
const TITLE_MARK: Op[] = [
  E('moon', 116, 2, 142, 28),
  E('ink', 124, 0, 148, 24), // the dark of the moon (the colour of the panel behind it)
  D('petal', [12, 8], [40, 4], [58, 14], [92, 6], [104, 20], [150, 30], [6, 26], [72, 2]),
  D('sky', [26, 16], [84, 18], [134, 36], [48, 24]),
  R('pine', 0, 56, 159, 63),
  R('moss', 0, 54, 159, 56),
  D('leaf', [6, 55], [19, 54], [33, 55], [47, 54], [62, 55], [90, 54], [101, 55], [117, 54], [139, 55], [151, 54]),
  D('lime', [12, 57], [56, 58], [97, 57], [144, 58]),
  ...moved(lamp('amber', 'gold', 'gold', 'wood'), 22, 10),
  E('moss', 68, 48, 92, 57),
  R('moss', 78, 28, 81, 54),
  L('leaf', 78, 28, 78, 54),
  E('leaf', 68, 40, 78, 45),
  E('moss', 82, 34, 92, 39),
  E('sky', 66, 12, 93, 30),
  E('petal', 69, 13, 90, 27),
  E('moon', 74, 15, 85, 23),
  E('glow', 77, 17, 82, 21),
  R('petal', 118, 40, 122, 55),
  L('pale', 122, 40, 122, 55),
  E('plum', 104, 28, 137, 44),
  E('violet', 105, 28, 136, 39),
  E('lilac', 112, 29, 126, 33),
  D('glow', [110, 35], [121, 36], [130, 34]),
];

const stages = (name: string, draw: (s: 0 | 1 | 2 | 3) => Op[]): Picture[] => ([0, 1, 2, 3] as const).map((s) => one(`${name}_${s}`, 64, 64, [32, 48], draw(s)));

export const PICTURES: Picture[] = [
  GARDENER,
  one('lamp_off', 24, 48, [12, 44], lamp('slate', null, 'iron', 'steel')),
  one('lamp_on', 24, 48, [12, 44], lamp('amber', 'gold', 'gold', 'wood')),
  one('wirelamp_off', 24, 48, [12, 44], lamp('night', null, 'teal', 'steel')),
  one('wirelamp_on', 24, 48, [12, 44], lamp('teal', 'aqua', 'aqua', 'steel')),
  one('glowlamp', 24, 48, [12, 44], lamp('moon', 'petal', 'pale', 'stone')),
  ...stages('moonbloom', moonbloom),
  ...stages('duskcap', duskcap),
  one('crate', 64, 56, [32, 40], CRATE),
  one('brazier', 64, 52, [32, 44], BRAZIER),
  one('screen', 64, 72, [32, 56], SCREEN),
  one('plate_up', 64, 32, [32, 17], PLATE(false)),
  one('plate_down', 64, 32, [32, 17], PLATE(true)),
  one('moonstone_off', 64, 32, [32, 17], STONE('stone', 'slate', 'stone', 'pale')),
  one('moonstone_on', 64, 32, [32, 17], STONE('petal', 'sky', 'petal', 'glow')),
  one('shadestone_off', 64, 32, [32, 17], STONE('stone', 'slate', 'stone', 'pale')),
  one('shadestone_on', 64, 32, [32, 17], STONE('lilac', 'violet', 'lilac', 'glow')),
  one('gate_shut', 64, 76, [32, 56], gate(0)),
  one('gate_half', 64, 76, [32, 56], gate(1)),
  one('gate_open', 64, 76, [32, 56], gate(2)),
  { name: 'exit', w: 64, h: 32, feet: [32, 16], frames: [{ ms: 500, ops: EXIT(false) }, { from: 'blank', ms: 500, ops: EXIT(true) }], clips: [{ name: 'glow', all: '1, 2' }] },
  { name: 'firefly', w: 16, h: 16, feet: [8, 16], frames: [{ ms: 160, ops: FIREFLY(true) }, { from: 'blank', ms: 160, ops: FIREFLY(false) }], clips: [{ name: 'fly', all: '1, 2' }] },
  one('cursor', 16, 10, [8, 10], CURSOR),
  one('title_mark', 160, 64, [80, 63], TITLE_MARK),
];
