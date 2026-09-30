import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

/** Attach error collectors; returns an assert helper. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return () => expect(errors, `browser errors:\n${errors.join('\n')}`).toHaveLength(0);
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function bananaCount(page) {
  const text = await page.locator('.hud-bananas .hud-value').innerText();
  return parseInt(text.replace(/\D/g, ''), 10);
}

const press = (page, key, ms = 120) =>
  page.keyboard.press(key).then(() => page.waitForTimeout(ms));

test('menu renders with title, controls and start button', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('.title')).toHaveText('MONKEY DASH');
  await expect(page.locator('#start-btn')).toBeVisible();
  await expect(page.locator('.control')).toHaveCount(3);

  // let the WebGL scene paint a few frames before capturing
  await page.waitForTimeout(1500);
  await shot(page, '01-menu');
  assertNoErrors();
});

test('gameplay: monkey runs on curved track, scores increase', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#start-btn')).toBeVisible();
  await shot(page, '02-menu-ready');

  await page.click('#start-btn');
  await expect(page.locator('.hud-score')).toBeVisible();
  await expect(page.locator('#menu-overlay')).toHaveCount(0);

  const scoreText = () => page.locator('.hud-score .hud-value').innerText();
  await page.waitForTimeout(2500);
  const earlyScore = parseInt(await scoreText(), 10);
  expect(earlyScore).toBeGreaterThan(0);

  // jump for an action shot (~apex)
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await shot(page, '03-jump-midair');

  // play a while: lane changes + jumps
  const script = [
    ['ArrowLeft', 700], ['Space', 500], ['ArrowRight', 600],
    ['Space', 400], ['ArrowLeft', 800], ['Space', 500],
  ];
  for (const [key, wait] of script) await press(page, key, wait);

  // boulders have entered the frame by now (~7s in)
  await shot(page, '04-gameplay-boulders');

  const lateScore = parseInt(await scoreText(), 10);
  expect(lateScore).toBeGreaterThan(earlyScore);
  assertNoErrors();
});

test('banana pickup works', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await page.waitForTimeout(1500);
  expect(await bananaCount(page)).toBe(0);

  // deterministic: drop a banana right at the monkey's position
  await page.evaluate(() => window.__MONKEY_GAME.testSpawnBananaAtPlayer());
  await expect(async () => {
    expect(await bananaCount(page)).toBe(1);
  }).toPass({ timeout: 5000 });
  assertNoErrors();
});

test('running into a boulder ends the run and shows game over', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await page.waitForTimeout(1500);

  // natural collision: materialize a boulder in the monkey's lane just ahead
  await page.evaluate(() => window.__MONKEY_GAME.testSpawnBoulderAhead(2.5));
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 8000 });

  const finalScore = parseInt(await page.locator('#final-score').innerText(), 10);
  expect(finalScore).toBeGreaterThan(0);

  // let the tumble animation settle, then capture
  await page.waitForTimeout(1600);
  await shot(page, '05-game-over');

  // restart works and resets state
  await page.click('#restart-btn');
  await expect(page.locator('#gameover-overlay')).toHaveCount(0);
  await expect(page.locator('.hud-score')).toBeVisible();
  expect(await bananaCount(page)).toBe(0);
  assertNoErrors();
});

test('jump onto a giant cliff, ride the banana trail, survive', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await page.waitForTimeout(1200);

  // clear any scheduled cliffs, then spawn one full-road cliff ahead
  const cliff = await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    g.testClearCliffs();
    return g.testSpawnCliffAhead();
  });

  // jump at the right moment: lead distance scales with current speed
  await page.waitForFunction(
    ({ sStart }) => {
      const g = window.__MONKEY_GAME;
      return g.s >= sStart - (g.speed * 0.24 + 0.6);
    },
    cliff,
    { timeout: 20_000 }
  );
  await page.keyboard.press('Space');

  // riding the top: collect trail bananas without crashing
  await expect(async () => {
    expect(await bananaCount(page)).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 10_000 });
  await shot(page, '07-cliff-ride');

  // still alive → he rode the cliff (a crash would have shown the overlay)
  await expect(page.locator('#gameover-overlay')).toHaveCount(0);

  // and after the trail ends he falls back down: keep running a bit more
  await page.waitForTimeout(1500);
  await expect(page.locator('.hud-score')).toBeVisible();

  // REGRESSION (clipping bug): jump TOO LATE so the monkey meets the cliff
  // face while still rising. Old code ghosted through the slab; now it must
  // crash into the wall instead.
  //
  // Both the setup and the jump are driven from inside the page: after the ride
  // he is still airborne (a jump cannot start, and an airborne crossing can land
  // him on top of the cliff), and Playwright's key-press latency moves the take-off
  // point by a metre at speed. Either way the outcome becomes a coin flip.
  await page.waitForFunction(() => {
    const g = window.__MONKEY_GAME;
    return g.grounded && Math.abs(g.py) < 0.05; // settled back onto the road
  }, null, { timeout: 20_000 });

  const lateCliff = await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    g.testClearCliffs();
    return g.testSpawnCliffAhead();
  });
  await page.waitForFunction(
    ({ sStart }) => {
      const g = window.__MONKEY_GAME;
      if (g.s < sStart - g.speed * 0.04 || !g.grounded) return false;
      g.jump(); // as late as it can be and still leave him rising at the wall
      return true;
    },
    lateCliff,
    { timeout: 20_000 }
  );
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 8000 });
  await shot(page, '09-cliff-clip-crash');
  assertNoErrors();
});

test('keyboard-only flow: Enter starts the game', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.keyboard.press('Enter');
  await expect(page.locator('#menu-overlay')).toHaveCount(0);
  await expect(page.locator('.hud-score')).toBeVisible();
  await shot(page, '08-keyboard-start');
  assertNoErrors();
});
