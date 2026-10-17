import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';

type Snapshot = Record<string, number>;
const GRID_PLUS_X: Snapshot = { move_right: 1, move_down: 1 };
const GRID_MINUS_X: Snapshot = { move_left: 1, move_up: 1 };
const GRID_PLUS_Y: Snapshot = { move_left: 1, move_down: 1 };

async function play(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      // pausing through the store keeps the editor from resuming the runner when a toast comes or goes
      window.__store!.set({ paused: true });
      const r = window.__play!.runner;
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
      r.inputSource = () => ({}); // if the editor ever steps the game on its own between calls, nothing is held down
    },
    { snapshot, ticks },
  );
}

/** Walk towards a named object and swing at it whenever it is close, until it is gone or defeated (or we run out of ticks). */
async function fight(page: Page, targetName: string, maxTicks: number): Promise<number> {
  return page.evaluate(
    ({ targetName, maxTicks }) => {
      window.__store!.set({ paused: true });
      const play = window.__play!;
      const r = play.runner;
      r.paused = true;
      let tick = 0;
      r.inputSource = () => {
        const s = play.sim;
        const target = s.world.all().find((e) => e.name === targetName);
        const p = s.world.withTag('player')[0]!;
        if (!target) return {};
        const tt = target.get<{ x: number; y: number }>('transform')!;
        const pt = p.get<{ x: number; y: number }>('transform')!;
        const dx = tt.x - pt.x;
        const dy = tt.y - pt.y;
        const dist = Math.hypot(dx, dy);
        const snap: Record<string, number> = {};
        if (dist > 1.3) {
          // grid direction -> the screen keys that produce it
          const sx = (dx - dy) / 2;
          const sy = (dx + dy) / 2;
          if (sx > 0.25) snap.move_right = 1;
          if (sx < -0.25) snap.move_left = 1;
          if (sy > 0.25) snap.move_down = 1;
          if (sy < -0.25) snap.move_up = 1;
        }
        if (dist < 1.9 && tick % 24 === 0) snap.attack = 1;
        return snap;
      };
      for (; tick < maxTicks; tick++) {
        const e = play.sim.world.all().find((x) => x.name === targetName);
        const dead = !e || (e.get<{ dead: boolean }>('state:health')?.dead ?? false);
        if (dead) break;
        r.step();
      }
      r.inputSource = () => ({});
      return tick;
    },
    { targetName, maxTicks },
  );
}

const byName = (page: Page, name: string): Promise<string> => page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);

async function clickEntity(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, id);
  await page.mouse.click(p.x, p.y);
}

async function dragEntities(page: Page, a: string, b: string): Promise<void> {
  const pa = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, a);
  const pb = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, b);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(pa.x + ((pb.x - pa.x) * i) / 8, pa.y + ((pb.y - pa.y) * i) / 8);
  await page.mouse.up();
}

async function addBehavior(page: Page, id: string): Promise<void> {
  await page.getByTestId('add-behavior').selectOption(id);
  await page.getByTestId('add-behavior-ok').click();
  await expect(page.getByTestId(`behavior-${id}`)).toBeVisible();
}

async function setField(page: Page, behaviour: string, key: string, value: string): Promise<void> {
  const f = page.getByTestId(`behavior-${behaviour}`).getByTestId(`bf-${key}`);
  await f.fill(value);
  await f.press('Enter');
}

const status = (page: Page) =>
  page.evaluate(() => {
    const s = window.__play!.sim;
    const all = s.world.all();
    const guard = all.find((e) => e.name === 'Guard');
    const boss = all.find((e) => e.name === 'Boss');
    const p = s.world.withTag('player')[0]!;
    const hp = (e: typeof p | undefined): number | null => (e ? (e.get<{ hp: number }>('state:health')?.hp ?? null) : null);
    return {
      guard: guard ? { x: guard.get<{ x: number; y: number }>('transform')!.x, y: guard.get<{ x: number; y: number }>('transform')!.y, mode: (guard.get<{ mode: string }>('state:chase')?.mode ?? 'idle') } : null,
      boss: boss ? { hp: hp(boss), phase: boss.get<{ phase: number }>('state:boss')?.phase ?? 1, active: boss.get<{ outputs: Record<string, boolean> }>('signals')?.outputs.active ?? null, defeated: boss.get<{ outputs: Record<string, boolean> }>('signals')?.outputs.defeated ?? false } : null,
      player: { hp: hp(p), x: p.get<{ x: number; y: number }>('transform')!.x, y: p.get<{ x: number; y: number }>('transform')!.y },
      gateOpen: all.find((e) => e.name === 'Gate')!.get<{ enabled: boolean }>('collider')!.enabled === false,
    };
  });

test('M7: a stealth guard with a patrol route and a two-phase boss with an arena, built in the editor and fought', async () => {
  test.setTimeout(240_000);
  const { app, page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Combat Game', 'empty-iso');

  // ---- the hero: health, quill, dodge ----
  await pickTool(page, 'select');
  const playerId = await byName(page, 'Player');
  await clickEntity(page, playerId);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await addBehavior(page, 'health');
  await setField(page, 'health', 'max', '20');
  await page.getByTestId('behavior-health').getByTestId('bf-onDeath').selectOption('respawn');
  await addBehavior(page, 'meleeAttack');
  await setField(page, 'meleeAttack', 'damage', '2');
  await setField(page, 'meleeAttack', 'arc', '360');
  await addBehavior(page, 'dodge');

  // ---- a guard with a route drawn with the Patrol path tool ----
  await pickTool(page, 'place');
  const place = async (prefab: string, x: number, y: number): Promise<void> => {
    await page.getByTestId('opt-prefab').selectOption(prefab);
    await clickCell(page, x, y);
  };
  await place('guard', 22, 13);
  await pickTool(page, 'select');
  const guardId = await byName(page, 'Guard');
  await clickEntity(page, guardId);
  await expect(page.getByTestId('behavior-patrol')).toContainText('Needs at least two points');
  await expect(page.getByTestId('problem-count')).not.toHaveText('No problems'); // "fewer than two route points"
  await pickTool(page, 'patrol');
  await clickCell(page, 22, 15);
  await clickCell(page, 22, 19);
  await clickCell(page, 22, 17);
  await clickCell(page, 22, 17, ['Shift']); // shift-click removes the last point
  expect(await page.evaluate((id) => (window.__store!.doc!.getEntity(id)!.components.patrol as { points: string }).points, guardId)).toBe('22.5,15.5; 22.5,19.5');
  await pickTool(page, 'select');
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');
  await page.screenshot({ path: shot('m7-guard-gizmos.png') });

  // ---- an arena with a boss ----
  await pickTool(page, 'region');
  await dragCells(page, [10, 21], [18, 26]);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await page.getByLabel('Bosses here only act while the player is inside').click();
  expect(await page.evaluate(() => window.__store!.doc!.regions[0]!.bossActive)).toBe(true);
  await pickTool(page, 'place');
  await place('boss', 14, 24);
  await place('gate', 22, 24);
  await pickTool(page, 'select');
  const bossId = await byName(page, 'Boss');
  await clickEntity(page, bossId);
  await setField(page, 'health', 'max', '8');
  await setField(page, 'health', 'invulnerableSeconds', '0.4');
  const gateId = await byName(page, 'Gate');
  await pickTool(page, 'wire');
  await dragEntities(page, bossId, gateId);
  await page.getByTestId('connect-output').selectOption('defeated');
  await page.getByTestId('connect-ok').click();
  await pickTool(page, 'select');
  expect(await page.evaluate(() => window.__store!.doc!.wires.map((w) => `${w.from.output}->${w.to.input}`))).toEqual(['defeated->open']);
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');
  await page.keyboard.press('Control+s');

  // ---- play: sneak, get heard, win the fight ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 5);
  await expect(page.getByTestId('tw-hearts')).toBeVisible();
  let st = await status(page);
  expect(st.player.hp).toBe(20);
  expect(st.boss!.active).toBe(false); // the player is not in the arena: the boss is idle
  const bossStart = await page.evaluate(() => window.__play!.sim.world.all().find((e) => e.name === 'Boss')!.get<{ x: number; y: number }>('transform')!);

  await play(page, {}, 120); // stand still out of earshot: the guard just walks its route
  st = await status(page);
  expect(st.guard!.mode).toBe('idle');
  expect(st.guard!.y).toBeGreaterThan(14.5);
  expect(st.player.hp).toBe(20);

  await play(page, GRID_PLUS_X, 70); // walk towards the route: within earshot, so it notices
  await play(page, {}, 20);
  st = await status(page);
  expect(['chase', 'search']).toContain(st.guard!.mode);
  await page.screenshot({ path: shot('m7-guard-chasing.png') });
  const ticks = await fight(page, 'Guard', 900);
  expect(ticks).toBeLessThan(900);
  await play(page, {}, 10);
  st = await status(page);
  expect(st.guard).toBeNull(); // defeated and gone
  expect(st.player.hp).toBeGreaterThan(0);

  // the boss waits until we enter its arena
  await play(page, GRID_MINUS_X, 70);
  await play(page, GRID_PLUS_Y, 30);
  st = await status(page);
  expect(st.boss!.active).toBe(false);
  const bossStill = await page.evaluate(() => window.__play!.sim.world.all().find((e) => e.name === 'Boss')!.get<{ x: number; y: number }>('transform')!);
  expect(bossStill.x).toBeCloseTo(bossStart.x, 1);
  expect(bossStill.y).toBeCloseTo(bossStart.y, 1);
  await play(page, GRID_PLUS_Y, 60); // into the arena
  await play(page, {}, 3);
  st = await status(page);
  expect(st.boss!.active).toBe(true);
  expect(st.gateOpen).toBe(false);
  await page.screenshot({ path: shot('m7-boss-arena.png') });

  const phases = new Set<number>();
  let defeated = false;
  for (let round = 0; round < 40 && !defeated; round++) {
    await fight(page, 'Boss', 60);
    st = await status(page);
    phases.add(st.boss!.phase);
    defeated = st.boss!.defeated === true;
    if (st.player.hp !== null && st.player.hp <= 0) break;
  }
  await play(page, {}, 60);
  st = await status(page);
  expect(st.boss!.defeated).toBe(true);
  expect(st.boss!.hp).toBe(0);
  expect(phases.has(2) || st.boss!.phase === 3).toBe(true);
  expect(st.boss!.phase).toBe(3);
  expect(st.gateOpen).toBe(true); // "Defeated" is wired to the gate
  expect(st.player.hp).toBeGreaterThan(0);
  await page.screenshot({ path: shot('m7-boss-defeated.png') });
  await page.getByTestId('btn-stop').click();

  expect(errors).toEqual([]);
  await app.close();
});
