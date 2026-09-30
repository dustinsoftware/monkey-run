import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { COSTUMES } from '../src/game/costumes.js';
import { COSTUME_PRICE as PRICE } from '../src/shop/store.js';

const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

// One price for every costume, forever. Read from the store so a rebalance can never leave a
// stale expectation in this file — see docs/costume-shop.md.
const VICTORY_MESSAGE =
  "You beat the game! You're the top banana! Thanks for playing our game. -The Masters";
const ALL_IDS = COSTUMES.map((c) => c.id);

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
  return {
    wallet: s.wallet, owned: [...s.owned], purchases: s.purchases,
    worn: s.worn, victory: s.victory, price: s.price,
  };
});
const emptyState = { wallet: 0, owned: [], purchases: 0, worn: null, victory: false, price: PRICE };
const wornCostume = (page) => page.evaluate(() => window.__MONKEY_GAME.getCostume());
const engineS = (page) => page.evaluate(() => window.__MONKEY_GAME.s);

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
  const crashedAt = await engineS(page);
  expect(crashedAt).toBeGreaterThan(5); // he really did run before dying

  await page.click('#go-shop-btn');
  await expect(page.locator('#shop-overlay')).toBeVisible();
  await expect(page.locator('.costume-card')).toHaveCount(COSTUMES.length);
  await expect(page.locator('#shop-wallet')).toHaveText('🍌 2');
  await expect(page.locator('#shop-price')).toHaveText(String(PRICE));
  // the fitting room is at the trailhead: he is put back to the start of the run
  expect(await engineS(page)).toBe(0);
  for (const c of COSTUMES) {
    await expect(page.locator(`[data-costume="${c.id}"] .costume-price`)).toHaveText(`🍌 ${PRICE}`);
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
  expect(after).toEqual(emptyState);

  await page.click('#shop-back-btn');
  await expect(page.locator('#menu-overlay')).toBeVisible();
  expect(await wornCostume(page)).toBeNull(); // unpaid preview dropped
  assertNoErrors();
});

test('buying unlocks forever and the price never moves', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await seedBananas(page, PRICE * COSTUMES.length); // enough for the whole set
  await openShopFromMenu(page);

  await page.click('[data-costume="tuxedo"] .buy-btn');
  await expect(page.locator('#shop-wallet')).toHaveText(`🍌 ${PRICE * (COSTUMES.length - 1)}`);
  await expect(page.locator('#shop-price')).toHaveText(String(PRICE)); // still the flat price
  await expect(page.locator(`[data-costume="clown"] .costume-price`)).toHaveText(`🍌 ${PRICE}`);
  await expect(page.locator('[data-costume="tuxedo"] .owned-badge')).toBeVisible();
  await expect(page.locator('[data-costume="tuxedo"] .worn-badge')).toBeVisible();
  await expect(page.locator('[data-costume="tuxedo"] .wear-btn')).toBeDisabled(); // already worn

  // second purchase costs the same as the first: no inflation anywhere
  await page.click('[data-costume="clown"] .buy-btn');
  const after = await shopState(page);
  expect(after).toEqual({
    ...emptyState,
    wallet: PRICE * (COSTUMES.length - 2),
    owned: ['tuxedo', 'clown'],
    purchases: 2,
    worn: 'clown',
  });
  await shot(page, '11-shop-two-unlocked');

  // owned costumes wear for free without touching the wallet
  await page.click('[data-costume="tuxedo"] .wear-btn');
  expect(await shopState(page)).toEqual({ ...after, worn: 'tuxedo' });
  expect(await wornCostume(page)).toBe('tuxedo');

  // buying an owned costume is a no-op (never charges twice)
  expect(await page.evaluate(() => window.__MONKEY_SHOP.buy('tuxedo'))).toBe(false);
  expect(await shopState(page)).toEqual({ ...after, worn: 'tuxedo' });
  assertNoErrors();
});

test('the last costume makes you the top banana', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await seedBananas(page, PRICE * COSTUMES.length);
  await openShopFromMenu(page);

  // unlock all but one through the store: no celebration yet
  const missing = COSTUMES[COSTUMES.length - 1].id;
  for (const id of ALL_IDS.filter((id) => id !== missing)) {
    expect(await page.evaluate((i) => window.__MONKEY_SHOP.buy(i), id)).toBe(true);
  }
  expect((await shopState(page)).victory).toBe(false);
  await expect(page.locator('#victory-overlay')).toHaveCount(0);

  // the purchase that completes the set pops the modal, with this exact wording
  await page.click(`[data-costume="${missing}"] .buy-btn`);
  await expect(page.locator('#victory-overlay')).toBeVisible();
  await expect(page.locator('#victory-message')).toHaveText(VICTORY_MESSAGE);
  const walletAfter = await shopState(page);
  expect(walletAfter).toEqual({
    ...emptyState, owned: ALL_IDS, purchases: COSTUMES.length, worn: missing, victory: true,
  });
  await shot(page, '13-top-banana');

  // dismissing is permanent for this save
  await page.click('#victory-ok-btn');
  await expect(page.locator('#victory-overlay')).toHaveCount(0);
  expect((await shopState(page)).victory).toBe(false);
  assertNoErrors();
});

test('an undismissed celebration survives a reload and swallows its keys', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.evaluate((ids) => {
    localStorage.setItem('monkey-dash-shop', JSON.stringify({
      v: 1, wallet: 0, owned: ids, purchases: ids.length, worn: ids[0], victory: true,
    }));
  }, ALL_IDS);
  await page.reload();

  // pending celebration is shown over the menu and eats Enter/Space/Esc
  await expect(page.locator('#victory-overlay')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('#victory-overlay')).toHaveCount(0);
  await expect(page.locator('#menu-overlay')).toBeVisible(); // no run started
  expect(await page.evaluate(() => window.__MONKEY_GAME.state)).toBe('menu');

  await page.reload();
  await expect(page.locator('#victory-overlay')).toHaveCount(0);
  assertNoErrors();
});

test('you cannot spend bananas you do not have', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await openShopFromMenu(page);
  await expect(page.locator('.buy-btn')).toHaveCount(COSTUMES.length);
  await expect(page.locator('.buy-btn').first()).toBeDisabled();

  expect(await page.evaluate(() => window.__MONKEY_SHOP.buy('bunny'))).toBe(false);
  expect(await shopState(page)).toEqual(emptyState);

  // one banana short of a costume is still one banana short
  await seedBananas(page, PRICE - 1);
  expect(await page.evaluate(() => window.__MONKEY_SHOP.buy('bunny'))).toBe(false);
  expect((await shopState(page)).wallet).toBe(PRICE - 1);

  // ...and the button agrees
  await expect(page.locator('[data-costume="bunny"] .buy-btn')).toBeDisabled();
  assertNoErrors();
});

test('wallet, unlocks and worn outfit survive a reload', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await seedBananas(page, PRICE * 6);
  expect(await page.evaluate(() => window.__MONKEY_SHOP.buy('bunny'))).toBe(true);

  await page.reload();
  await expect(page.locator('#menu-overlay')).toBeVisible();
  expect(await shopState(page)).toEqual({
    ...emptyState, wallet: PRICE * 5, owned: ['bunny'], purchases: 1, worn: 'bunny',
  });
  expect(await wornCostume(page)).toBe('bunny'); // saved outfit is worn from boot

  await openShopFromMenu(page);
  await expect(page.locator('[data-costume="bunny"] .owned-badge')).toBeVisible();
  assertNoErrors();
});

test('corrupt storage falls back to defaults', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('monkey-dash-shop', 'not json {{{'));
  await page.reload();
  await expect(page.locator('#menu-overlay')).toBeVisible();
  expect(await shopState(page)).toEqual(emptyState);

  // a hand-edited blob cannot smuggle in unknown ids, an unowned outfit, a made-up
  // price or a celebration it did not earn
  await page.evaluate(() => localStorage.setItem('monkey-dash-shop', JSON.stringify({
    v: 1, wallet: -5, owned: ['cat', 'cat', 'gremlin'], purchases: -3, worn: 'gremlin',
    price: 1, victory: 'yes please',
  })));
  await page.reload();
  expect(await shopState(page)).toEqual({ ...emptyState, owned: ['cat'] });

  // ...and a worn costume that is owned does get applied on boot
  await page.evaluate(() => localStorage.setItem('monkey-dash-shop', JSON.stringify({
    v: 1, wallet: 73, owned: ['cat'], purchases: 4, worn: 'cat', victory: true,
  })));
  await page.reload();
  expect(await shopState(page)).toEqual({ ...emptyState, wallet: 73, owned: ['cat'], purchases: 4, worn: 'cat' });
  expect(await wornCostume(page)).toBe('cat');
  assertNoErrors();
});

/** Is the monkey actually inside the camera frame (NDC, in front of the lens)? */
const monkeyOnScreen = (page) =>
  page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    const v = g.monkey.group.position.clone().project(g.camera);
    const dist = g.monkey.group.position.distanceTo(g.camera.position);
    return { x: v.x, y: v.y, inFront: v.z < 1, dist };
  });

test('he is framed at the start of a run and after leaving the shop', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');

  // A fresh run: the chase camera cannot sit *on* him just because the path has
  // no samples behind index 0 — otherwise the first seconds show an empty trail.
  await page.click('#start-btn');
  await page.waitForTimeout(500);
  expect(await monkeyOnScreen(page)).toMatchObject({ inFront: true });
  expect(Math.abs((await monkeyOnScreen(page)).x)).toBeLessThan(0.9);

  // Die, browse, come back: the rewind to s = 0 must not lose him either.
  await page.evaluate(() => window.__MONKEY_GAME.testSpawnBoulderAhead(2.5));
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 8000 });
  await page.click('#go-shop-btn');
  await expect(page.locator('#shop-overlay')).toBeVisible();
  await page.click('#shop-back-btn');
  await expect(page.locator('#gameover-overlay')).toBeVisible();
  await page.waitForTimeout(2500); // camera glides back from the fitting view
  const framed = await monkeyOnScreen(page);
  expect(framed.inFront).toBe(true);
  expect(Math.abs(framed.x)).toBeLessThan(0.9);
  expect(Math.abs(framed.y)).toBeLessThan(0.9);
  expect(framed.dist).toBeGreaterThan(5);
  await shot(page, '15-framed-at-trailhead');
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

test('bananas are bananas, not macaroni', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');

  // One shared geometry: vertex-coloured (yellow body, brown tips) and long
  // relative to its thickness. A torus arc fails both checks.
  const shape = await page.evaluate(() => {
    const geo = window.__MONKEY_GAME.bananaGeo;
    geo.computeBoundingBox();
    const { min, max } = geo.boundingBox;
    return {
      coloured: !!geo.attributes.color,
      length: max.x - min.x, width: max.y - min.y, thickness: max.z - min.z,
    };
  });
  expect(shape.coloured).toBe(true);
  expect(shape.length).toBeGreaterThan(0.7);
  expect(shape.length / Math.max(shape.width, shape.thickness)).toBeGreaterThanOrEqual(2.5);

  // and they render as such: a row of them down the trail ahead of the run
  await page.click('#start-btn');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    for (let i = 0; i < 6; i++) {
      const b = g.getFreeBanana();
      Object.assign(b, { active: true, s: g.s + 22 + i * 1.4, x: g.x, y: 0.9 });
      b.group.visible = true;
    }
  });
  await page.waitForTimeout(350);
  await shot(page, '14-banana-row');
  assertNoErrors();
});

for (const c of COSTUMES) {
  test(`outfit renders on the monkey: ${c.id}`, async ({ page }) => {
    const assertNoErrors = watchErrors(page);
    await page.goto('/');
    await openShopFromMenu(page);

    await page.click(`[data-costume="${c.id}"] .try-btn`);
    await expect(async () => expect(await wornCostume(page)).toBe(c.id)).toPass();

    // let the fitting camera settle and the monkey turn a little
    await page.waitForTimeout(2500);
    await shot(page, `12-costume-${c.id}`);
    assertNoErrors();
  });
}
