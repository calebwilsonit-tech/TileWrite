import { expect, test, type Page } from '@playwright/test';
import { launchEditor, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

/** Step the game by hand with these buttons held. */
async function steps(page: Page, snapshot: Record<string, number>, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      window.__store!.set({ paused: true });
      const r = window.__play!.runner;
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
    },
    { snapshot, ticks },
  );
  await page.waitForTimeout(60);
}

async function create(page: Page, name: string, kind: 'timing' | 'sequence' | 'pairs'): Promise<void> {
  await page.getByTestId('minigame-new-name').fill(name);
  await page.getByTestId('minigame-new-kind').selectOption(kind);
  await page.getByTestId('minigame-new').click();
  await expect(page.getByTestId(`minigame-${name}`)).toBeVisible();
}

test('M15: minigames are made in the Story panel, tested in the game and played with the mouse and the buttons', async () => {
  test.setTimeout(150_000);
  const { page, app, errors } = await launchEditor();
  await page.getByTestId('sample-last-storytender').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);

  await tab(page, 'Story').click();
  await page.getByTestId('story-tab-minigames').click();
  await create(page, 'Duel', 'timing');
  await create(page, 'Cards', 'pairs');
  await create(page, 'Echo', 'sequence');
  await page.getByTestId('minigame-rounds-Duel').fill('2');
  await page.getByTestId('minigame-rounds-Duel').press('Enter');
  await page.getByTestId('minigame-pairs-Cards').fill('3');
  await page.getByTestId('minigame-pairs-Cards').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__store!.minigames.map((m) => `${m.name}:${m.kind}`))).toEqual(['Duel:timing', 'Cards:pairs', 'Echo:sequence']);
  await page.screenshot({ path: shot('m15-minigames-panel.png') });

  // ---- the timing bar: test it, start it by clicking, hit the zone twice ----
  await page.getByTestId('minigame-test-Duel').click();
  await page.waitForFunction(() => window.__play !== undefined && window.__play.sim.runtime.minigame !== null);
  await expect(page.getByTestId('tw-minigame')).toBeVisible();
  await page.screenshot({ path: shot('m15-minigame-intro.png') });
  await page.getByTestId('tw-minigame').click(); // click = confirm
  await expect.poll(() => page.evaluate(() => window.__play!.sim.runtime.minigame!.phase)).toBe('play');
  await expect(page.getByTestId('tw-minigame-bar')).toBeVisible();
  await page.evaluate(() => {
    window.__store!.set({ paused: true });
    const r = window.__play!.runner;
    r.paused = true;
    const st = window.__play!.sim.runtime.minigame!;
    for (let round = 0; round < 2; round++) {
      const target = round + 1;
      for (let i = 0; i < 5000 && st.round < target && st.phase === 'play'; i++) {
        const centre = st.zoneAt + st.zoneSize / 2;
        const press = Math.abs(st.pos - centre) < 0.03;
        r.inputSource = () => (press ? ({ interact: 1 } as Record<string, number>) : ({} as Record<string, number>));
        r.step();
        r.inputSource = () => ({});
        r.step();
      }
    }
  });
  await expect(page.getByTestId('tw-minigame-result')).toHaveText('You won!');
  await page.screenshot({ path: shot('m15-minigame-won.png') });
  await page.getByTestId('tw-minigame').click();
  await expect.poll(() => page.evaluate(() => window.__play!.sim.runtime.minigame)).toBeNull();
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['minigame:Duel:won'])).toBe(true);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['minigame:Duel:best'])).toBe(200);

  // ---- the cards: opened by the event action, flipped with real mouse clicks ----
  await page.evaluate(() => {
    const play = window.__play!;
    play.sim.runtime.minigame = null;
  });
  expect(await page.evaluate(() => window.__play!.session.openMinigame('Cards'))).toBe(true);
  await expect(page.getByTestId('tw-minigame')).toBeVisible();
  await page.getByTestId('tw-minigame').click({ position: { x: 5, y: 5 } }); // start
  await expect.poll(() => page.evaluate(() => window.__play!.sim.runtime.minigame!.phase)).toBe('play');
  const cards: number[] = await page.evaluate(() => [...window.__play!.sim.runtime.minigame!.cards]);
  expect(cards).toHaveLength(6);
  const byPicture = new Map<number, number[]>();
  cards.forEach((c, i) => byPicture.set(c, [...(byPicture.get(c) ?? []), i]));
  for (const [, [a, b]] of byPicture) {
    await page.getByTestId(`tw-minigame-card-${a}`).click();
    await page.getByTestId(`tw-minigame-card-${b}`).click();
  }
  await expect(page.getByTestId('tw-minigame-result')).toHaveText('You won!');
  await page.screenshot({ path: shot('m15-minigame-cards.png') });
  await page.getByTestId('tw-minigame').click();
  await expect.poll(() => page.evaluate(() => window.__play!.sim.runtime.minigame)).toBeNull();
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['minigame:Cards:won'])).toBe(true);
  await steps(page, {}, 2);
  expect(errors).toEqual([]);
  await app.close();
});
