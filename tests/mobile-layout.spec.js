import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Layout on a phone — iPhone 16 metrics (393 × 852 pt portrait, DPR 3, touch only)
// plus the landscape case. Everything here is about geometry: nothing may fall off
// the edge of the screen, and nothing you need to tap may hide below the fold.
// See docs/responsive-layout.md.
// ---------------------------------------------------------------------------

const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return () => expect(errors, `browser errors:\n${errors.join('\n')}`).toHaveLength(0);
}

/** Every element matching `sel` must be fully inside the viewport horizontally. */
async function insideViewport(page, sel) {
  return page.evaluate((sel) => {
    const vw = window.innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue; // hidden variant (e.g. the keyboard hints)
      if (r.left < -1 || r.right > vw + 1) {
        bad.push({ id: el.id || el.className, left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
    return bad;
  }, sel);
}

// Cards pop in with an overshooting scale animation; measure geometry only once it has
// settled, or a card mid-pop legitimately sticks out by a few pixels.
const settle = (page) => page.waitForTimeout(500);

const PHONE = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

test.describe('iPhone 16 portrait', () => {
  test.use(PHONE);

  test('the menu fits the screen and speaks in gestures', async ({ page }) => {
    const assertNoErrors = watchErrors(page);
    await page.goto('/');
    await expect(page.locator('#menu-overlay .card')).toBeVisible();
    await settle(page);

    // Nothing hangs off either edge.
    expect(await insideViewport(page, '.hud-item, .card, .sound-toggle, .btn, .control'))
      .toEqual([]);

    // The card is fully within the viewport — no scrolling needed to start a run.
    const box = await page.locator('#menu-overlay .card').boundingBox();
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(394);

    // A phone has no arrow keys: the chips explain swipes, and the keyboard variant is
    // hidden (it stays in the DOM for desktop — same markup, CSS picks one).
    await expect(page.locator('#menu-overlay .gestures').first()).toBeVisible();
    await expect(page.locator('#menu-overlay .keys').first()).toBeHidden();

    for (const id of ['#start-btn', '#menu-shop-btn']) {
      await expect(page.locator(id)).toBeVisible();
      await expect(page.locator(id)).toBeEnabled();
    }
    // Thumb-sized tap targets.
    const btn = await page.locator('#start-btn').boundingBox();
    expect(btn.height).toBeGreaterThanOrEqual(44);

    await shot(page, '30-phone-menu');
    assertNoErrors();
  });

  test('every HUD chip is on screen and clear of the mute switch', async ({ page }) => {
    const assertNoErrors = watchErrors(page);
    await page.goto('/');
    await page.tap('#start-btn');
    await expect(page.locator('.hud-score')).toBeVisible();
    await page.waitForTimeout(1500);

    // The regression this suite exists for: five chips used to need 542 px of a 393 px
    // screen, so DAILY and ABILITY were simply never visible.
    expect(await insideViewport(page, '.hud-item')).toEqual([]);

    const toggle = await page.locator('#sound-toggle').boundingBox();
    for (const chip of await page.locator('.hud-item').all()) {
      const box = await chip.boundingBox();
      const overlaps =
        box.x < toggle.x + toggle.width && box.x + box.width > toggle.x &&
        box.y < toggle.y + toggle.height && box.y + box.height > toggle.y;
      expect(overlaps, `HUD chip ${await chip.getAttribute('class')} sits under the mute switch`).toBe(false);
    }

    await shot(page, '31-phone-hud');
    assertNoErrors();
  });

  test('the game-over card fits and both its buttons are tappable', async ({ page }) => {
    const assertNoErrors = watchErrors(page);
    await page.goto('/');
    await page.tap('#start-btn');
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__MONKEY_GAME.testSpawnBoulderAhead(2.5));
    await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 10_000 });
    await settle(page);

    expect(await insideViewport(page, '.card-over .btn, .stats > div, .daily-result'))
      .toEqual([]);
    const card = await page.locator('.card-over').boundingBox();
    expect(card.x + card.width).toBeLessThanOrEqual(394);

    // Both actions reachable without hunting for them.
    await expect(page.locator('#go-shop-btn')).toBeVisible();
    await expect(page.locator('#restart-btn')).toBeEnabled();

    await shot(page, '33-phone-over');
    assertNoErrors();
  });

  test('the costume shop is a scrollable sheet with all nine outfits reachable', async ({ page }) => {
    const assertNoErrors = watchErrors(page);
    await page.goto('/');
    await page.tap('#menu-shop-btn');
    await expect(page.locator('#shop-overlay')).toBeVisible();

    // Two readable columns instead of three clipped ones, nothing off-screen sideways.
    expect(await insideViewport(page, '.costume-card, .card-actions .btn-tiny, #shop-back-btn'))
      .toEqual([]);

    await settle(page);
    const sheet = await page.locator('.card-shop').boundingBox();
    expect(sheet.width).toBeGreaterThan(350); // a real panel, not a 204 px sliver
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(853);

    // The grid does not scroll inside itself; one finger scrolls the whole sheet.
    const cards = await page.locator('.costume-card').all();
    expect(cards).toHaveLength(9);
    const firstTryOn = page.locator('[data-costume="tuxedo"] .try-btn');
    await expect(firstTryOn).toBeVisible();

    // The last outfit is below the fold — scroll to it and tap it for real.
    const last = page.locator('[data-costume="rainsuit"] .try-btn');
    await last.scrollIntoViewIfNeeded();
    await shot(page, '32-phone-shop');
    await expect(last).toBeVisible();
    await last.tap();
    const worn = await page.evaluate(() => window.__MONKEY_GAME.getCostume());
    expect(worn).toBe('rainsuit');

    // And the way out is reachable too.
    const back = page.locator('#shop-back-btn');
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeVisible();
    await back.tap();
    await expect(page.locator('#menu-overlay')).toBeVisible();
    assertNoErrors();
  });
});

test.describe('iPhone 16 landscape', () => {
  test.use({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  test('the menu stays reachable when the phone is turned sideways', async ({ page }) => {
    const assertNoErrors = watchErrors(page);
    await page.goto('/');
    await expect(page.locator('#menu-overlay')).toBeVisible();
    await settle(page);

    // This used to put 🛍️ COSTUME SHOP below the fold with `overflow: hidden` on the body,
    // i.e. a button you could never press.
    const shop = await page.locator('#menu-shop-btn').boundingBox();
    expect(shop.y + shop.height).toBeLessThanOrEqual(394);

    expect(await insideViewport(page, '.card, .btn')).toEqual([]);
    await shot(page, '34-phone-landscape');

    // It still works as a button.
    await page.tap('#menu-shop-btn');
    await expect(page.locator('#shop-overlay')).toBeVisible();
    assertNoErrors();
  });
});
