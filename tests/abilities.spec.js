import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { COSTUMES, ABILITY_DEFAULTS, BARE_ABILITY, abilityFor } from '../src/game/costumes.js';

// ---------------------------------------------------------------------------
// Costume abilities. Every outfit is data (see docs/abilities.md): the engine
// reads that table and nothing else decides what an outfit does, so these tests
// import the same numbers instead of restating them.
// ---------------------------------------------------------------------------

const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return () => expect(errors, `browser errors:\n${errors.join('\n')}`).toHaveLength(0);
}

const STAT_KEYS = Object.keys(ABILITY_DEFAULTS);
const abilityState = (page) => page.evaluate(() => ({ ...window.__MONKEY_GAME.ability }));
const setCostume = (page, id) => page.evaluate((c) => window.__MONKEY_GAME.setCostume(c), id);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the catalogue is well-formed and the bare baseline is all defaults', async () => {
  const ids = new Set();
  for (const c of COSTUMES) {
    expect(c.ability, `${c.id} has no ability`).toBeTruthy();
    expect(c.ability.id, `${c.id} has no ability id`).toBeTruthy();
    expect(c.ability.label.length, `${c.id} has no label`).toBeGreaterThan(0);
    expect(c.ability.text.length, `${c.id} has no description`).toBeGreaterThan(10);
    expect(ids.has(c.ability.id), `duplicate ability ${c.ability.id}`).toBe(false);
    ids.add(c.ability.id);

    // Every stat named by a costume is a real stat; nothing else may exist.
    for (const key of Object.keys(c.ability)) {
      if (key === 'id' || key === 'label' || key === 'text') continue;
      expect(STAT_KEYS, `${c.id} invents stat ${key}`).toContain(key);
    }
  }

  // Two outfits are explicitly worse than the bare monkey, and say so.
  const worse = COSTUMES.filter((c) => (c.ability.speedMul ?? 1) > 1 || (c.ability.hitboxScale ?? 1) > 1);
  expect(worse.map((c) => c.id).sort()).toEqual(['tophat', 'tuxedo']);

  // Every resolved stat block is complete and finite: a missing stat would become
  // NaN arithmetic in the engine loop (it did once — this assertion is scar tissue).
  for (const c of COSTUMES) {
    const a = abilityFor(c.id);
    for (const key of STAT_KEYS) {
      expect(Number.isFinite(a[key]), `${c.id}.${key} = ${a[key]}`).toBe(true);
    }
  }

  const bare = abilityFor(null);
  expect(bare.id).toBeNull();
  for (const key of STAT_KEYS) expect(bare[key]).toBe(ABILITY_DEFAULTS[key]);
  // An unknown outfit from stale storage resolves to the baseline, never to NaN.
  expect(abilityFor('never-shipped')).toEqual(bare);
});

test('equipping an outfit makes the engine match the catalogue', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.click('#start-btn');

  // Bare baseline first.
  await setCostume(page, null);
  expect(await abilityState(page)).toEqual(abilityFor(null));

  for (const c of COSTUMES) {
    await setCostume(page, c.id);
    const got = await abilityState(page);
    expect(got, c.id).toEqual(abilityFor(c.id));
    // The stat block is also what the monkey *looks* like: scale follows sizeScale,
    // and the run survives the swap (no NaN speed means no NaN position).
    const after = await page.evaluate(() => {
      const g = window.__MONKEY_GAME;
      return { scale: g.monkey.group.scale.x, s: g.s, speed: g.speed };
    });
    expect(after.scale, c.id).toBeCloseTo(0.85 * (c.ability.sizeScale ?? 1), 6);
    expect(Number.isFinite(after.s), `${c.id} broke the run`).toBe(true);
    expect(Number.isFinite(after.speed), `${c.id} broke the speed`).toBe(true);
  }

  await setCostume(page, null);
  expect(await abilityState(page)).toEqual(BARE_ABILITY);
  assertNoErrors();
});

test('a double jump raises the apex; a single jump cannot', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.click('#start-btn');
  await page.waitForTimeout(900);
  await setCostume(page, 'clown');
  // No obstacles while we measure a pure ballistic arc.
  await page.evaluate(() => window.__MONKEY_GAME.testClearCliffs());

  const apex = (secondJump) => page.evaluate(async ({ second }) => {
    const g = window.__MONKEY_GAME;
    // Wait for ground, but bail out if the monkey dies while we wait.
    while (!g.grounded && g.state === 'playing') await new Promise((r) => requestAnimationFrame(r));
    if (g.state !== 'playing') return null;
    g.jump();
    const t0 = performance.now();
    let max = 0, usedSecond = false, frames = 0;
    return await new Promise((resolve) => {
      const step = () => {
        max = Math.max(max, g.py);
        if (!usedSecond && second && performance.now() - t0 > 200) { g.jump(); usedSecond = true; }
        const done = (g.grounded && performance.now() - t0 > 400) ||
          g.state !== 'playing' || ++frames > 600;
        if (done) return resolve(max);
        requestAnimationFrame(step);
      };
      step();
    });
  }, { second: secondJump });

  const single = await apex(false);
  const double = await apex(true);
  expect(single).toBeGreaterThan(1.5);   // a real jump happened
  expect(double).toBeGreaterThan(single + 0.6);
  assertNoErrors();
});

test('the dog sniffs out a banana one lane over; the bare monkey walks past it', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.click('#start-btn');
  await page.waitForTimeout(900);

  /** Park a banana in the lane next to him, ahead of him, and see if he gets it. */
  const tryMagnet = async (costumeId) => {
    await setCostume(page, costumeId);
    const setup = await page.evaluate(() => {
      const g = window.__MONKEY_GAME;
      g.testClearCliffs(); // no boulders in the way, no random slabs
      const lane = g.laneIndex === 0 ? 1 : g.laneIndex - 1; // one lane over
      const spot = g.testSpawnBananaAhead({ d: 5, lane });
      return { spot, lane, s: g.s };
    });
    expect(setup.spot, 'banana refused its own reachability rules').toBeTruthy();
    await page.waitForFunction(
      ({ s }) => window.__MONKEY_GAME.s > s + 9 || window.__MONKEY_GAME.state !== 'playing',
      setup, { timeout: 15_000 }
    );
    return page.evaluate(() => window.__MONKEY_GAME.bananaCount);
  };

  const bare = await tryMagnet(null);
  expect(bare).toBe(0); // no outfit, no help

  const doggy = await tryMagnet('dog');
  expect(doggy).toBeGreaterThan(0); // sniffed out of the scenery without a lane change
  assertNoErrors();
});

test('the doctor gets one crash forgiven, then dies like everyone else', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.click('#start-btn');
  await page.waitForTimeout(900);

  // Any costume can be tested for a revive without buying it.
  await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    g.testSetRevives(1);
    g.testClearCliffs();
  });

  await page.evaluate(() => window.__MONKEY_GAME.testSpawnBoulderAhead(2.5));
  // The crash is called off: no game-over card, the run keeps rolling.
  await page.waitForTimeout(700);
  await expect(page.locator('#gameover-overlay')).toHaveCount(0);
  const left = await page.evaluate(() => window.__MONKEY_GAME.revivesLeft);
  expect(left).toBe(0);

  // Grace has to expire before the next boulder counts, or nothing was proven.
  // (The revive itself cleared every boulder within 12 m of him.)
  await page.waitForFunction(() => window.__MONKEY_GAME.invulnerableT <= 0, null, { timeout: 5000 });
  const near = await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    return g.obstacles.filter((o) => o.active && Math.abs(o.s - g.s) < 20).length;
  });
  expect(near).toBe(0); // the lane ahead of him is genuinely clear

  // Second opinion spent: the very next unavoidable boulder ends the run.
  await page.evaluate(() => window.__MONKEY_GAME.testSpawnBoulderAhead(6));
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 10_000 });
  assertNoErrors();
});

test('the shop prints every ability, and try-on previews how an outfit handles', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await expect(page.locator('#menu-ability')).toContainText('Bare monkey');

  await page.click('#menu-shop-btn');
  await expect(page.locator('#shop-overlay')).toBeVisible();
  for (const c of COSTUMES) {
    const card = page.locator(`[data-costume="${c.id}"]`);
    await expect(card.locator('.costume-ability')).toHaveText(c.ability.label.toUpperCase());
    await expect(card.locator('.costume-text')).toHaveText(c.ability.text);
  }
  await shot(page, '24-shop-abilities');

  // Try-on is free but it changes the numbers immediately…
  await page.click('[data-costume="bunny"] .try-btn');
  await expect(async () => {
    const a = await abilityState(page);
    expect(a.id).toBe('bunny-hop');
  }).toPass();
  expect((await abilityState(page)).jumpMul).toBe(1.14);

  // …and leaving drops the preview along with the outfit.
  await page.click('#shop-back-btn');
  await expect(page.locator('#menu-overlay')).toBeVisible();
  expect(await abilityState(page)).toEqual(BARE_ABILITY);

  // The HUD chip names the worn outfit during a run.
  await page.click('#start-btn');
  await expect(page.locator('#hud-ability .hud-value')).toHaveText('Bare Monkey');
  await setCostume(page, 'butterfly');
  await expect(page.locator('#hud-ability .hud-value')).toHaveText('Wing Flap');
  await shot(page, '23-ability-hud');
  assertNoErrors();
});
