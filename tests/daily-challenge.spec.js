import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { DAILY_TARGETS, dayKey, addDays, targetFor, rewardFor } from '../src/daily/store.js';

// ---------------------------------------------------------------------------
// Daily distance challenge. Fresh context per test → localStorage does not
// survive between tests, so every test pins "today" through __MONKEY_DAILY and
// gets a deterministic target. See docs/daily-challenge.md.
// ---------------------------------------------------------------------------

const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return () => expect(errors, `browser errors:\n${errors.join('\n')}`).toHaveLength(0);
}

const dailyState = (page) => page.evaluate(() => ({ ...window.__MONKEY_DAILY.getState() }));
const setDay = (page, key) => page.evaluate((k) => ({ ...window.__MONKEY_DAILY.setDay(k) }), key);
const setTarget = (page, metres) =>
  page.evaluate((m) => ({ ...window.__MONKEY_DAILY.setTarget(m) }), metres);
const wallet = (page) => page.evaluate(() => window.__MONKEY_SHOP.getState().wallet);
const runDistance = (page) => page.evaluate(() => Math.floor(window.__MONKEY_GAME.distance));

/** Die on purpose: a boulder 2.5 m ahead is unavoidable. */
async function crash(page) {
  await page.evaluate(() => window.__MONKEY_GAME.testSpawnBoulderAhead(2.5));
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 8000 });
}

/** Start a run and keep restarting until the monkey has covered `metres`. */
async function runUntilDistance(page, metres) {
  await page.click('#start-btn');
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({
      d: window.__MONKEY_GAME.distance,
      over: !!document.querySelector('#gameover-overlay'),
    }));
    if (st.d >= metres) return true;
    if (st.over) await page.click('#restart-btn'); // died short — try again
    await page.waitForTimeout(500);
  }
  return false;
}

test('the daily target is a pure function of the date', () => {
  // Same key, same answer — no clock or browser involved.
  expect(targetFor('2026-01-14')).toBe(targetFor('2026-01-14'));

  const seen = new Set();
  for (let i = 0; i < 365; i++) {
    const key = addDays(dayKey(), i);
    expect(DAILY_TARGETS).toContain(targetFor(key));
    seen.add(targetFor(key));
  }
  // A year of days visits every rung of the ladder: difficulty wanders.
  expect([...seen].sort((a, b) => a - b)).toEqual([...DAILY_TARGETS].sort((a, b) => a - b));

  expect(DAILY_TARGETS.map(rewardFor)).toEqual([18, 24, 30, 36, 45, 60]);
});

test('the menu shows today’s challenge', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');

  const day = '2099-01-01';
  const s = await setDay(page, day);
  expect(s.target).toBe(targetFor(day));

  await expect(page.locator('#menu-daily')).toContainText(`travel ${s.target} m today`);
  await expect(page.locator('#menu-daily')).toContainText('best 0 m');
  await shot(page, '16-menu-daily');
  assertNoErrors();
});

test('a run counts toward today and shows up on the game-over card', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  const day = '2099-01-02';
  const s = await setDay(page, day); // real target (>= 180 m) — far out of reach here

  await page.click('#start-btn');
  await expect(page.locator('#daily-chip')).toBeVisible();
  await page.waitForTimeout(2000);

  const chip = await page.locator('#daily-chip .hud-value').innerText();
  const counted = Number(chip.split('/')[0].trim());
  expect(counted).toBeGreaterThan(0); // the chip counts up while you play
  expect(counted).toBeLessThan(s.target);
  await shot(page, '17-hud-daily');

  await crash(page);
  const after = await dailyState(page);
  expect(after.best).toBeGreaterThan(0);
  expect(after.completed).toBe(false);
  await expect(page.locator('#over-daily')).toContainText(`travel ${s.target} m today`);
  await expect(page.locator('#over-daily')).toContainText(`best ${after.best} m`);
  await expect(page.locator('#daily-reward')).toHaveCount(0);
  assertNoErrors();
});

test('completing the goal pays once, and never twice', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');

  const day = '2099-03-05';
  await setDay(page, day);
  const s = await setTarget(page, 60); // reachable in a few seconds of play
  expect(s.reward).toBe(6);

  const before = await wallet(page);
  expect(await runUntilDistance(page, 72)).toBe(true);
  await crash(page);

  const bananas = await page.evaluate(() => window.__MONKEY_GAME.bananaCount);
  const after = await dailyState(page);
  expect(after).toMatchObject({ completed: true, paid: true, streak: 1 });
  await expect(page.locator('#over-daily')).toContainText(`Daily done: ${s.target} m`);
  await expect(page.locator('#daily-reward')).toHaveText(`+${s.reward} 🍌 banked!`);
  // Run bananas plus the daily reward, nothing else.
  expect(await wallet(page)).toBe(before + s.reward + bananas);
  await shot(page, '18-daily-complete');

  // A second run the same day pays nothing at all.
  await page.click('#restart-btn');
  await crash(page);
  const bananas2 = await page.evaluate(() => window.__MONKEY_GAME.bananaCount);
  await expect(page.locator('#daily-reward')).toHaveCount(0);
  await expect(page.locator('#over-daily')).toContainText('Daily done');
  expect(await wallet(page)).toBe(before + s.reward + bananas + bananas2);
  assertNoErrors();
});

test('the streak grows day over day and dies on a gap', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');

  const d0 = '2099-06-01';
  const s0 = await setDay(page, d0);
  const paid0 = await page.evaluate((d) => window.__MONKEY_DAILY.recordRun(d), s0.target);
  expect(paid0).toMatchObject({ reward: s0.reward, completedNow: true });
  expect(await dailyState(page)).toMatchObject({ streak: 1, paid: true });

  // Back-to-back completion continues the streak.
  const d1 = addDays(d0, 1);
  const s1 = await setDay(page, d1);
  expect(s1).toMatchObject({ best: 0, completed: false, paid: false });
  await page.evaluate((d) => window.__MONKEY_DAILY.recordRun(d), s1.target);
  expect(await dailyState(page)).toMatchObject({ streak: 2, lastCompletedDay: d1 });

  // Skipping days resets it to a fresh one.
  const s3 = await setDay(page, addDays(d1, 3));
  await page.evaluate((d) => window.__MONKEY_DAILY.recordRun(d), s3.target);
  expect(await dailyState(page)).toMatchObject({ streak: 1 });
  assertNoErrors();
});

test('a new day resets today but keeps the streak', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');

  const day = '2099-07-02';
  const s = await setDay(page, day);
  await page.evaluate((d) => window.__MONKEY_DAILY.recordRun(d + 50), s.target);
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('monkey-dash-daily')));
  expect(stored).toMatchObject({ v: 1, day, best: s.target + 50, streak: 1 });

  await page.reload();
  const rolled = await dailyState(page);
  expect(rolled.day).not.toBe(day); // the clock moved on → fresh challenge
  expect(rolled).toMatchObject({ best: 0, completed: false, paid: false, streak: 1 });
  assertNoErrors();
});

test('corrupt storage falls back to defaults', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('monkey-dash-daily', 'not json {{{'));
  await page.reload();

  const fresh = await dailyState(page);
  expect(fresh.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(fresh).toMatchObject({
    best: 0, paidOn: null, streak: 0, lastCompletedDay: null, completed: false, paid: false,
  });

  // A hand-edited blob cannot pay itself, keep a negative best or a fake streak.
  const smuggled = await page.evaluate(() => {
    const day = window.__MONKEY_DAILY.getState().day;
    localStorage.setItem('monkey-dash-daily', JSON.stringify({
      v: 1, day, best: -9, paidOn: day, completed: true, streak: -5, lastCompletedDay: 'yesterday',
    }));
    return day;
  });
  await page.reload();
  expect(await dailyState(page)).toMatchObject({
    day: smuggled, best: 0, paid: false, completed: false, streak: 0, lastCompletedDay: null,
  });
  assertNoErrors();
});
