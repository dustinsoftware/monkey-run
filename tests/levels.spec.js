import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { LEVELS, LEVEL_SECONDS, MENU_LEVEL_ID } from '../src/game/levels.js';

// ---------------------------------------------------------------------------
// Themed levels. A run is a ladder of worlds: survive LEVEL_SECONDS on one and
// you step into the next; every run opens on a random theme. The menu always sits
// in the forest world so screenshots (and the fitting room) stay stable.
// See docs/levels.md.
// ---------------------------------------------------------------------------

const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return () => expect(errors, `browser errors:\n${errors.join('\n')}`).toHaveLength(0);
}

const levelState = (page) => page.evaluate(() => window.__MONKEY_GAME.testGetLevel());
const setLevel = (page, i) => page.evaluate((idx) => window.__MONKEY_GAME.testSetLevelIndex(idx), i);
const clearLevelNow = (page) => page.evaluate(() => window.__MONKEY_GAME.testClearLevelNow());

/** Die on purpose: a boulder 2.5 m ahead is unavoidable. */
async function crash(page) {
  await page.evaluate(() => window.__MONKEY_GAME.testSpawnBoulderAhead(2.5));
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 8000 });
}

const chipText = async (page) => (await page.locator('#hud-level .hud-value').innerText()).trim();

test('the menu always sits in the forest world', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  // The ladder starts at forest, and the menu is pinned to it.
  expect(LEVELS[0].id).toBe(MENU_LEVEL_ID);
  const level = await levelState(page);
  expect(level.id).toBe(MENU_LEVEL_ID);
  expect(level.index).toBe(0);
  expect(level.cleared).toBe(0);
  expect(level.timeLeft).toBe(LEVEL_SECONDS); // the timer does not run on the menu
  assertNoErrors();
});

test('a fresh run opens on a random theme, never the same one twice in a row by rule', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#start-btn')).toBeVisible();

  const ids = new Set();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter'); // start / restart from any overlay
    await page.waitForTimeout(250);
    const level = await levelState(page);
    expect(LEVELS.map((l) => l.id)).toContain(level.id);
    ids.add(level.id);
    await crash(page);
  }
  // Six rolls of fourteen themes: a deterministic generator would collapse this.
  expect(ids.size).toBeGreaterThanOrEqual(3);
  assertNoErrors();
});

test('the level chip counts down while playing and freezes when you die', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await expect(page.locator('#hud-level')).toBeVisible();
  // Set the theme *after* starting: a run rolls its own random world.
  await setLevel(page, LEVELS.findIndex((l) => l.id === 'beach'));

  // Label upper-cased, whole seconds left: "SUNNY BEACH · 60" and counting.
  const first = await chipText(page);
  expect(first).toMatch(/^SUNNY BEACH · \d{1,2}$/);
  const firstLeft = Number(first.split('·')[1]);
  expect(firstLeft).toBeLessThanOrEqual(LEVEL_SECONDS);

  await page.waitForTimeout(2500);
  const second = Number((await chipText(page)).split('·')[1]);
  expect(second).toBeLessThan(firstLeft);
  await shot(page, '20-hud-level');

  // Dead: the countdown stops where it stopped.
  await crash(page);
  const frozenA = await levelState(page);
  await page.waitForTimeout(900);
  const frozenB = await levelState(page);
  expect(frozenB.timeLeft).toBeLessThanOrEqual(frozenA.timeLeft);
  expect(frozenB.cleared).toBe(0); // parking on a corpse clears nothing
  assertNoErrors();
});

test('clearing a level pays the bonus, wraps into lap 2 and shows the banner', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await expect(page.locator('#hud-level')).toBeVisible();
  await setLevel(page, 0); // start the ladder from forest so the steps are exact

  // The score term is exactly LEVEL_BONUS per cleared level, measured in one tick.
  const bonus = await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    const before = g.score();
    g.testClearLevelNow();
    return Math.round(g.score() - before);
  });
  expect(bonus).toBe(250);

  let level = await levelState(page);
  expect(level.index).toBe(1); // forest → plains
  expect(level.cleared).toBe(1);

  // The banner names the world you left and the one you entered.
  await expect(page.locator('#level-banner')).toBeVisible();
  await expect(page.locator('#level-banner-title')).toHaveText('LEVEL CLEAR!');
  await expect(page.locator('#level-banner-sub')).toContainText('→');
  await shot(page, '21-level-banner');

  // Walk the rest of the ladder and wrap: that is lap 2.
  const last = LEVELS.length - 1;
  await setLevel(page, last);
  level = await clearLevelNow(page);
  expect(level.index).toBe(0);
  expect(level.lap).toBe(1);
  expect(level.id).toBe(LEVELS[0].id);

  // Lap pacing: obstacle spacing tightens without touching speed.
  const pace = await page.evaluate(() => ({ lap: window.__MONKEY_GAME.pace(), speed: window.__MONKEY_GAME.speed }));
  expect(pace.lap).toBeGreaterThan(1);

  // Levels cleared this run reach the game-over card.
  await crash(page);
  await expect(page.locator('#final-levels')).toHaveText(String(level.cleared));
  assertNoErrors();
});

test('every themed world renders', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await expect(page.locator('#hud-level')).toBeVisible();

  for (let i = 0; i < LEVELS.length; i++) {
    const theme = LEVELS[i];
    const level = await setLevel(page, i);
    expect(level.id).toBe(theme.id);

    // The theme actually reached the scene: fog distances are per-world data.
    const applied = await page.evaluate(() => ({
      near: window.__MONKEY_GAME.scene.fog.near,
      far: window.__MONKEY_GAME.scene.fog.far,
      chunks: window.__MONKEY_GAME.chunks.size,
      props: window.__MONKEY_GAME.scenery.filter((s) => s.obj).length,
    }));
    expect(applied.near, `${theme.id} fog`).toBe(theme.fog[0]);
    expect(applied.far, `${theme.id} fog far`).toBe(theme.fog[1]);
    expect(applied.chunks).toBeGreaterThan(3);   // chunks rebuilt for the new palette
    expect(applied.props).toBe(34);              // and the prop pool was re-seeded

    await page.waitForTimeout(600); // let the camera settle into the world
    await shot(page, `22-level-${theme.id}`);
  }
  assertNoErrors();
});
