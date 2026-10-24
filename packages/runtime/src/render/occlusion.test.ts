import { describe, expect, it } from 'vitest';
import { boxAt, type DepthBox } from './depth';
import { FADE_OFF, FADE_ON, blocksView, cameraDirection, fadesLegacy, fadingOccluders, viewOverlap } from './occlusion';

const column = (x: number, y: number, top: number): DepthBox => ({ id: y * 100 + x, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: -1, maxZ: top });

describe('which blocks hide the thing being followed', () => {
  it('looks along one fixed direction: toward +x and +y and up', () => {
    expect(cameraDirection()).toEqual({ x: 1, y: 1, z: 2 });
  });

  it('a tall wall in front of a body on the floor hides it; one beside or behind it does not', () => {
    const body = boxAt(0, 5.5, 5.5, 0, 0.6, 0.6, 1.2);
    expect(blocksView(body, column(6, 5, 3))).toBe(true); // next to it, toward the camera
    expect(blocksView(body, column(6, 6, 3))).toBe(true); // diagonally in front
    expect(blocksView(body, column(5, 6, 3))).toBe(true);
    expect(blocksView(body, column(7, 3, 3))).toBe(false); // off to the right
    expect(blocksView(body, column(3, 7, 3))).toBe(false); // off to the left
    expect(blocksView(body, column(4, 4, 3))).toBe(false); // behind
    expect(blocksView(body, column(5, 5, 0))).toBe(false); // the floor it stands on
  });

  it('a low wall does not hide a body that stands higher than it', () => {
    const body = boxAt(0, 5.5, 5.5, 4, 0.6, 0.6, 1.2);
    expect(blocksView(body, column(6, 5, 1))).toBe(false);
    expect(blocksView(body, column(6, 5, 3))).toBe(false);
  });

  it('a body inside a block (leaning into a wall) is not hidden by it', () => {
    // 0.15 into the column that fills x 0..1
    const body = boxAt(0, 1.15, 5.5, 2, 0.6, 0.6, 1.2);
    expect(viewOverlap(body, column(0, 5, 10))).toBe(0);
    expect(blocksView(body, column(0, 5, 10))).toBe(false);
  });

  it('a block that covers only a sliver of the way does not start to fade, and one already fading holds on a little longer', () => {
    const body = boxAt(0, 5.5, 5.5, 0, 0.6, 0.6, 1.2);
    // a column whose near corner is pushed in along x by `gap`: the further it is from the line of sight, the less it covers
    const column1 = (gap: number): DepthBox => ({ id: 1, minX: 5.8 + gap, maxX: 8, minY: 5, maxY: 6.05, minZ: -1, maxZ: 5 });
    const covers = (gap: number): number => viewOverlap(body, column1(gap));
    // find a gap whose cover lies between the two thresholds
    let gap = 0;
    while (covers(gap) > (FADE_ON + FADE_OFF) / 2) gap += 0.001;
    const between = covers(gap);
    expect(between).toBeLessThan(FADE_ON);
    expect(between).toBeGreaterThan(FADE_OFF);
    expect(blocksView(body, column1(gap), undefined, false)).toBe(false); // not faded yet: it has to cover more
    expect(blocksView(body, column1(gap), undefined, true)).toBe(true); // already faded: it stays until it covers less
    expect(blocksView(body, column1(gap + 0.2), undefined, true)).toBe(false);
  });
});

describe('a body on a wall, on the ceiling', () => {
  // the owner's gravity puzzle: a body glued to the west wall (x = 1.15, 0.15 in front of the wall face) while the
  // wall is a column of cells that is ten levels tall; every cell of it is a block of its own
  const wall = (y: number): DepthBox => column(0, y, 10);

  it('the older rule fades a wall cell that is nowhere near the line of sight, and flips as the body moves along the wall', () => {
    let flips = 0;
    let last: boolean | null = null;
    let wrong = 0;
    for (let u = 1.3; u < 8.7; u += 0.05) {
      const body = boxAt(0, 1.15, u, 2, 0.6, 0.6, 1.2);
      const legacy = fadesLegacy(body, wall(Math.floor(u) + 1));
      const sight = blocksView(body, wall(Math.floor(u) + 1));
      if (legacy && !sight) wrong++;
      if (last !== null && legacy !== last) flips++;
      last = legacy;
    }
    expect(wrong).toBeGreaterThan(0); // a block turns see-through although nothing is behind it...
    expect(flips).toBeGreaterThan(1); // ...at some points along the wall and not at others
  });

  it('the sight rule never fades the cell the body is leaning against, wherever the body is', () => {
    for (let u = 1.3; u < 8.7; u += 0.05) {
      for (let h = 0; h < 6; h += 0.5) {
        const body = boxAt(0, 1.15, u, h, 0.6, 0.6, 1.2);
        for (let y = 0; y < 10; y++) {
          const cell = wall(y);
          // a cell whose footprint holds the body's own centre line of travel (the one it leans on) is not in the way
          if (Math.abs(y + 0.5 - u) < 0.5) expect(blocksView(body, cell), `u=${u} h=${h} cell ${y}`).toBe(false);
        }
      }
    }
  });

  it('a platform above a body hides it from a camera that looks down; a body standing on it, or to the side of it, is not hidden', () => {
    const slab: DepthBox = { id: 5, minX: 4, maxX: 8, minY: 4, maxY: 8, minZ: 5, maxZ: 6 };
    const hanging = boxAt(0, 5.5, 5.5, 3.8, 0.6, 0.6, 1.2); // its head against the underside (z = 5)
    expect(blocksView(hanging, slab)).toBe(true); // the camera sees the top of the slab, not the one hanging under it
    const standingOn = boxAt(0, 5.5, 5.5, 6, 0.6, 0.6, 1.2);
    expect(blocksView(standingOn, slab)).toBe(false);
    const beside = boxAt(0, 2.5, 5.5, 3.8, 0.6, 0.6, 1.2); // off the slab's edge
    expect(blocksView(beside, slab)).toBe(false);
  });

  it('lists the blocks to fade for a body', () => {
    const body = boxAt(0, 5.5, 5.5, 0, 0.6, 0.6, 1.2);
    const ids = fadingOccluders(body, [{ id: 1, box: column(6, 5, 3) }, { id: 2, box: column(2, 2, 3) }], 'swept');
    expect(ids).toEqual([1]);
  });
});
