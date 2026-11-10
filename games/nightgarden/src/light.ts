/**
 * The light rule of Nightgarden, in one place. The solver uses this file as it is, and the build writes the part between
 * the two marks into the Room script, so the game and the checks can never disagree about what is lit.
 *
 * A lamp lights every bed within two cells of it, less the four far corners; a brazier lights the eight beds round it.
 * Light is stopped by a hedge, and by anything that stands two levels above the lamp's own ground: a risen bloom, a screen,
 * a shut gate, the side of a terrace. It squeezes past one corner, but not between two.
 */
export interface LightModel {
  w: number;
  h: number;
  /** One character per cell, row by row: # hedge, . path, ~ sunken bed, ^ terrace, w pond, _ nothing. */
  ground: string;
  /** How high something tall stands on each cell, in levels above its ground (0 for most cells). */
  tall: number[];
  lights: { x: number; y: number; range: number }[];
}

/* LIGHT-RULE-BEGIN */
function groundTop(ch: string): number {
  return ch === '~' ? 0 : ch === '^' ? 4 : 2;
}

/** Which cells are lit: one true or false per cell, row by row. */
function litCells(m: { w: number; h: number; ground: string; tall: number[]; lights: { x: number; y: number; range: number }[] }): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < m.w * m.h; i++) out.push(false);
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < m.w && y < m.h;
  for (const l of m.lights) {
    if (!inside(l.x, l.y)) continue;
    const base = groundTop(m.ground[l.y * m.w + l.x]!);
    // does this cell stop light from this lamp?
    const stops = (x: number, y: number): boolean => {
      if (!inside(x, y)) return true;
      const ch = m.ground[y * m.w + x]!;
      if (ch === '#') return true;
      if (ch === '_') return false;
      return groundTop(ch) + (m.tall[y * m.w + x] ?? 0) >= base + 2;
    };
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = l.x + dx;
        const y = l.y + dy;
        if (!inside(x, y) || dx * dx + dy * dy > l.range * l.range) continue;
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        const sx = Math.sign(dx);
        const sy = Math.sign(dy);
        let clear = true;
        if (ax === 2 && ay === 0) clear = !stops(l.x + sx, l.y);
        else if (ax === 0 && ay === 2) clear = !stops(l.x, l.y + sy);
        else if (ax === 1 && ay === 1) clear = !(stops(l.x + sx, l.y) && stops(l.x, l.y + sy));
        else if (ax === 2 && ay === 1) clear = !stops(l.x + sx, l.y) && !stops(l.x + sx, l.y + sy);
        else if (ax === 1 && ay === 2) clear = !stops(l.x, l.y + sy) && !stops(l.x + sx, l.y + sy);
        if (clear) out[y * m.w + x] = true;
      }
    }
  }
  return out;
}
/* LIGHT-RULE-END */

export { groundTop, litCells };
