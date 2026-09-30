import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { COSTUMES } from '../src/game/costumes.js';

const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return () => expect(errors, `browser errors:\n${errors.join('\n')}`).toHaveLength(0);
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

// --- shop state is seeded through the store hook: fresh context per test ----
const seedBananas = (page, n) =>
  page.evaluate((amount) => window.__MONKEY_SHOP.addBananas(amount), n);
const shopState = (page) => page.evaluate(() => {
  const s = window.__MONKEY_SHOP.getState();
  return { wallet: s.wallet, owned: [...s.owned], purchases: s.purchases, worn: s.worn, price: s.price };
});
const wornCostume = (page) => page.evaluate(() => window.__MONKEY_GAME.getCostume());

async function openShopFromMenu(page) {
  await page.click('#menu-shop-btn');
  await expect(page.locator('#shop-overlay')).toBeVisible();
}

/** Collect a banana, then die on purpose so the run's bananas get banked. */
async function crashWithBananas(page, count = 1) {
  await page.click('#start-btn');
  await page.waitForTimeout(900);
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => window.__MONKEY_GAME.testSpawnBananaAtPlayer());
    await expect(async () => {
      const text = await page.locator('.hud-bananas .hud-value').innerText();
      expect(text.replace(/\D/g, '')).toBe(String(i + 1));
    }).toPass({ timeout: 5000 });
  }
  await page.evaluate(() => window.__MONKEY_GAME.testSpawnBoulderAhead(2.5));
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 8000 });
}

test('death banks the run bananas and offers the costume shop', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  expect((await shopState(page)).wallet).toBe(0);

  await crashWithBananas(page, 2);
  await expect(page.locator('.banked')).toContainText('+2');
  expect((await shopState(page)).wallet).toBe(2); // banked exactly once per death

  await page.click('#go-shop-btn');
  await expect(page.locator('#shop-overlay')).toBeVisible();
  await expect(page.locator('.costume-card')).toHaveCount(COSTUMES.length);
  await expect(page.locator('#shop-wallet')).toHaveText('🍌 2');
  await expect(page.locator('#shop-price')).toHaveText('1000');
  for (const c of COSTUMES) {
    await expect(page.locator(`[data-costume="${c.id}"] .costume-price`)).toHaveText('🍌 1000');
  }

  // leaving the shop returns to the game-over card and must not re-bank
  const before = await shopState(page);
  await page.click('#shop-back-btn');
  await expect(page.locator('#gameover-overlay')).toBeVisible();
  expect(await shopState(page)).toEqual(before);
  await shot(page, '10-gameover-banked');
  assertNoErrors();
});

test('trying on is free and reverts when you leave', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await openShopFromMenu(page);
  expect(await wornCostume(page)).toBeNull();

  await page.click('[data-costume="tuxedo"] .try-btn');
  await expect(async () => expect(await wornCostume(page)).toBe('tuxedo')).toPass();
  const after = await shopState(page);
  expect(after).toEqual({ wallet: 0, owned: [], purchases: 0, worn: null, price: 1000 });

  await page.click('#shop-back-btn');
  await expect(page.locator('#menu-overlay')).toBeVisible();
  expect(await wornCostume(page)).toBeNull(); // unpaid preview dropped
  assertNoErrors();
});

test('buying unlocks forever and raises every price by 200', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await seedBananas(page, 5000);
  await openShopFromMenu(page);

  await page.click('[data-costume="tuxedo"] .buy-btn');
  await expect(page.locator('#shop-wallet')).toHaveText('🍌 4000');
  await expect(page.locator('#shop-price')).toHaveText('1200');
  await expect(page.locator(`[data-costume="clown"] .costume-price`)).toHaveText('🍌 1200');
  await expect(page.locator('[data-costume="tuxedo"] .owned-badge')).toBeVisible();
  await expect(page.locator('[data-costume="tuxedo"] .worn-badge')).toBeVisible();
  await expect(page.locator('[data-costume="tuxedo"] .wear-btn')).toBeDisabled(); // already worn
  expect(await wornCostume(page)).toBe('tuxedo');

  // second purchase costs the new price and pushes everyone up again
  await page.click('[data-costume="clown"] .buy-btn');
  const after = await shopState(page);
  expect(after).toEqual({ wallet: 2800, owned: ['tuxedo', 'clown'], purchases: 2, worn: 'clown', price: 1400 });
  await shot(page, '11-shop-two-unlocked');

  // owned costumes wear for free without touching the wallet
  await page.click('[data-costume="tuxedo"] .wear-btn');
  expect(await shopState(page)).toEqual({ ...after, worn: 'tuxedo', price: 1400 });
  expect(await wornCostume(page)).toBe('tuxedo');

  // buying an owned costume is a no-op (no double charge / double inflation)
  expect(await page.evaluate(() => window.__MONKEY_SHOP.buy('tuxedo'))).toBe(false);
  expect(await shopState(page)).toEqual({ ...after, worn: 'tuxedo' });
  assertNoErrors();
});

test('you cannot spend bananas you do not have', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await openShopFromMenu(page);
  await expect(page.locator('.buy-btn')).toHaveCount(COSTUMES.length);
  await expect(page.locator('.buy-btn').first()).toBeDisabled();

  const result = await page.evaluate(() => window.__MONKEY_SHOP.buy('bunny'));
  expect(result).toBe(false);
  expect(await shopState(page)).toEqual({ wallet: 0, owned: [], purchases: 0, worn: null, price: 1000 });
  assertNoErrors();
});

test('wallet, unlocks and worn outfit survive a reload', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await seedBananas(page, 3000);
  expect(await page.evaluate(() => window.__MONKEY_SHOP.buy('bunny'))).toBe(true);

  await page.reload();
  await expect(page.locator('#menu-overlay')).toBeVisible();
  expect(await shopState(page)).toEqual({ wallet: 2000, owned: ['bunny'], purchases: 1, worn: 'bunny', price: 1200 });
  expect(await wornCostume(page)).toBe('bunny'); // saved outfit is worn from boot

  await openShopFromMenu(page);
  await expect(page.locator('[data-costume="bunny"] .owned-badge')).toBeVisible();
  assertNoErrors();
});

test('the shop never restarts a run and Esc closes it', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await openShopFromMenu(page);

  await page.keyboard.press('Space'); // would start a run on the menu
  await expect(page.locator('#shop-overlay')).toBeVisible();
  expect(await page.evaluate(() => window.__MONKEY_GAME.state)).toBe('shop');

  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-overlay')).toBeVisible();
  assertNoErrors();
});

test('corrupt storage falls back to defaults', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('monkey-dash-shop', 'not json {{{'));
  await page.reload();
  await expect(page.locator('#menu-overlay')).toBeVisible();
  expect(await shopState(page)).toEqual({ wallet: 0, owned: [], purchases: 0, worn: null, price: 1000 });

  // a hand-edited blob cannot smuggle in unknown ids or an unowned outfit
  await page.evaluate(() => localStorage.setItem('monkey-dash-shop', JSON.stringify({
    v: 1, wallet: -5, owned: ['cat', 'cat', 'gremlin'], purchases: -3, worn: 'gremlin', price: 1,
  })));
  await page.reload();
  expect(await shopState(page)).toEqual({ wallet: 0, owned: ['cat'], purchases: 0, worn: null, price: 1000 });

  // ...and a worn costume that is owned does get applied on boot
  await page.evaluate(() => localStorage.setItem('monkey-dash-shop', JSON.stringify({
    v: 1, wallet: 50, owned: ['cat'], purchases: 4, worn: 'cat',
  })));
  await page.reload();
  expect(await shopState(page)).toEqual({ wallet: 50, owned: ['cat'], purchases: 4, worn: 'cat', price: 1800 });
  expect(await wornCostume(page)).toBe('cat');
  assertNoErrors();
});

for (const c of COSTUMES) {
  test(`outfit renders on the monkey: ${c.id}`, async ({ page }) => {
    const assertNoErrors = watchErrors(page);
    await page.goto('/');
    await openShopFromMenu(page);

    await page.click(`[data-costume="${c.id}"] .try-btn`);
    await expect(async () => expect(await wornCostume(page)).toBe(c.id)).toPass();

    // let the fitting camera glide in and the monkey turn a little
    await page.waitForTimeout(2500);
    await shot(page, `12-costume-${c.id}`);
    assertNoErrors();
  });
}
