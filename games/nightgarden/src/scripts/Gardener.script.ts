// The gardener walks the garden one bed at a time: a press of a direction walks to the middle of the next cell.
// The four directions follow the paths of the garden (up-right, down-right, down-left, up-left on the screen).
// Hold Run with a direction to turn on the spot. The lamp the gardener would light is kept in the variable ng_target.
const STEP: Record<string, [number, number, number]> = {
  // direction: dx, dy, facing (0 east .. 7 north-east, clockwise on the screen)
  move_right: [1, 0, 1],
  move_down: [0, 1, 3],
  move_left: [-1, 0, 5],
  move_up: [0, -1, 7],
};
const ORDER = ['move_right', 'move_down', 'move_left', 'move_up'];

export default defineScript({
  name: 'Gardener',
  description: 'Walks one cell for each press of a direction, along the garden paths (the four directions are the four diagonals of the screen). Run + a direction turns on the spot. Pushes crates by walking into them.',
  settings: {
    speed: { value: 5, label: 'Walking speed (cells per second)', min: 1, max: 12, step: 0.5 },
  },
  phase: 'control',
  update(me, game) {
    const b = me.get<{ vx: number; vy: number; vz: number; state: string }>('body');
    if (!b) return;
    const st = me.state;
    const speed = Number(me.settings.speed);
    const cx = Math.floor(me.x) + 0.5;
    const cy = Math.floor(me.y) + 0.5;

    // which direction is wanted: the one pressed last wins; a held one repeats
    for (const k of ORDER) if (game.input.pressed(k)) st.last = k;
    let want: string | undefined;
    if (st.last && game.input.down(st.last)) want = st.last;
    else want = ORDER.find((k) => game.input.down(k));
    if (want && game.input.pressed(want)) st.queued = want;

    if (st.tx === undefined) {
      const ox = cx - me.x;
      const oy = cy - me.y;
      const off = Math.hypot(ox, oy);
      const go = want ?? st.queued;
      if (go && off < 0.12 && b.state === 'ground') {
        st.queued = undefined;
        const [dx, dy, facing] = STEP[go]!;
        me.facing = facing;
        if (!game.input.down('run')) {
          st.tx = cx + dx;
          st.ty = cy + dy;
          st.hx = cx;
          st.hy = cy;
          st.best = 2;
          st.stall = 0;
          st.back = false;
        }
      }
      if (st.tx === undefined) {
        // rest in the middle of the cell
        const v = Math.min(speed, off / game.dt);
        b.vx = off > 0.004 ? (ox / off) * v : 0;
        b.vy = off > 0.004 ? (oy / off) * v : 0;
      }
    }
    if (st.tx !== undefined) {
      const dx = st.tx - me.x;
      const dy = st.ty - me.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.02) {
        b.vx = 0;
        b.vy = 0;
        st.tx = undefined;
        if (!st.back) game.emit('step', {});
      } else {
        const v = Math.min(speed, dist / game.dt);
        b.vx = (dx / dist) * v;
        b.vy = (dy / dist) * v;
        // not getting any closer: something is in the way, so step back to where the walk began
        if (dist < st.best - 0.002) {
          st.best = dist;
          st.stall = 0;
        } else if (++st.stall > 9 && !st.back) {
          st.tx = st.hx;
          st.ty = st.hy;
          st.best = 2;
          st.stall = 0;
          st.back = true;
          game.emit('bump', {});
        } else if (st.stall > 30) {
          st.tx = undefined; // wedged: give up and rest where it is
        }
      }
    }
    const moving = st.tx !== undefined || b.state !== 'ground';
    game.vars.ng_moving = moving ? 1 : 0;

    // the lamp Interact would light: the one faced, else the only one beside the gardener, else the next one clockwise
    let target = 0;
    let mark: { x: number; y: number; h: number } | undefined;
    if (!moving) {
      const beside: { id: number; turn: number; at: { x: number; y: number; h: number } }[] = [];
      const f = ((Math.round(me.facing) % 8) + 8) % 8;
      for (const l of game.findAll('tag:handlamp')) {
        if (Math.abs(me.h - l.h) > 1.3) continue;
        const lx = Math.floor(l.x) - Math.floor(me.x);
        const ly = Math.floor(l.y) - Math.floor(me.y);
        const k = ORDER.find((o) => STEP[o]![0] === lx && STEP[o]![1] === ly);
        if (k) beside.push({ id: l.id, turn: (STEP[k]![2] - f + 8) % 8, at: { x: l.x, y: l.y, h: l.h } });
      }
      beside.sort((p, q) => p.turn - q.turn);
      if (beside.length > 0) {
        target = beside[0]!.id;
        mark = beside[0]!.at;
      }
    }
    game.vars.ng_target = target;
    // the little mark that hovers over that lamp
    const cursor = game.find('tag:cursor');
    if (cursor) {
      cursor.visible = mark !== undefined;
      if (mark) {
        cursor.x = mark.x;
        cursor.y = mark.y;
        cursor.h = mark.h + 3.3 + 0.1 * Math.sin(game.time * 5);
      }
    }
  },
});
