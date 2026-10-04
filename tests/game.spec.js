import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { JUMP_APEX, SLAB_CLEAR } from '../src/game/engine.js';

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

// ---------------------------------------------------------------------------
// Walls: slabs you cannot jump. They exist to force a lane change, so they must
// never block all three lanes and must never be clearable by a max-height jump.
// See docs/architecture.md → "Slabs".
// ---------------------------------------------------------------------------
test('a wall in your lane is unavoidable — jumping does not save you', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await page.waitForTimeout(1000);

  // deterministic: no random slabs, no waves on the approach
  const wall = await page.evaluate(async () => {
    const g = window.__MONKEY_GAME;
    g.testClearCliffs();
    return g.testSpawnWallAhead(); // defaults to the player's own lane
  });
  expect(wall.H).toBeGreaterThan(JUMP_APEX * 2); // more than double a max jump

  // Jump at the wall anyway: it is taller than any jump, so he eats it.
  await page.waitForFunction(
    ({ sStart }) => window.__MONKEY_GAME.s >= sStart - window.__MONKEY_GAME.speed * 0.28,
    wall, { timeout: 30_000 }
  );
  await page.keyboard.press('Space');
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1600);
  await shot(page, '19-wall-crash');
  assertNoErrors();
});

test('stepping one lane across survives a wall, and never all three lanes are blocked', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    g.testClearCliffs();
    const wall = g.testSpawnWallAhead([g.laneIndex]); // his lane only
    return { ...wall, lane: g.laneIndex };
  });

  // Get out of the way well before it arrives.
  await page.waitForFunction(
    ({ sStart }) => window.__MONKEY_GAME.s >= sStart - window.__MONKEY_GAME.speed * 1.2,
    info, { timeout: 30_000 }
  );
  const dodged = await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    const target = g.laneIndex === 0 ? 1 : 0;
    while (g.laneIndex !== target) { g.moveLeft(); }
    return g.laneIndex;
  });
  expect(dodged).not.toBe(info.lane);

  // He is past the wall and still running.
  await page.waitForFunction(({ sEnd }) => window.__MONKEY_GAME.s >= sEnd + 4, info, { timeout: 30_000 });
  await expect(page.locator('#gameover-overlay')).toHaveCount(0);

  // A wall that covered every lane would be a death sentence, not an obstacle.
  const audit = await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    g.testClearCliffs();
    const w = g.testSpawnWallAhead([0, 1]);
    const free = g.groundHeightAt(w.sStart + 2, 2.6); // lane 2 must be open
    return { walls: g.testBananaAudit().walls, free };
  });
  expect(audit.walls).toBe(1);
  expect(audit.free).toBe(0);
  assertNoErrors();
});

// ---------------------------------------------------------------------------
// Banana reachability audit — the regression test for "bananas float in places
// you can't get to". Every banana goes through placeBanana, which refuses spots
// inside rock and clamps everything above a max-height jump's chest.
// ---------------------------------------------------------------------------
test('no banana is ever buried, floating too high, or hiding inside a boulder', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await page.waitForTimeout(1200);

  let seen = 0;
  for (let round = 0; round < 4; round++) {
    const audit = await page.evaluate(() => {
      const g = window.__MONKEY_GAME;
      g.testSpawnWaveNow();
      g.testSpawnCliffAhead();
      g.testSpawnWallAhead([Math.random() < 0.5 ? 0 : 2]);
      return g.testBananaAudit();
    });
    seen = Math.max(seen, audit.checked);
    expect(audit.buried, `buried bananas: ${JSON.stringify(audit)}`).toBe(0);
    expect(audit.unreachable, `floating bananas: ${JSON.stringify(audit)}`).toBe(0);
    expect(audit.inObstacle, `bananas inside rock: ${JSON.stringify(audit)}`).toBe(0);
    expect(audit.orphan, `bananas owned by a removed slab: ${JSON.stringify(audit)}`).toBe(0);
    await page.waitForTimeout(900); // travel into what was just spawned
  }
  expect(seen).toBeGreaterThan(20); // the audit looked at a trail, not an empty pool
  await shot(page, '26-banana-audit');
  assertNoErrors();
});

// ---------------------------------------------------------------------------
// Wall dodgeability — the regression test for "a wall appeared over all three lanes".
// A wall never covers three lanes; but it is only fair if the one lane it leaves open is
// actually runnable: no boulder parked in it, and no second monolith asking for a
// different lane half a second later.
// ---------------------------------------------------------------------------
test('obstacles always leave one lane you can run through', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');
  await page.click('#start-btn');
  await page.waitForTimeout(1000);

  // Long run of natural scheduling plus forced waves. The revive cheat is only there to
  // keep the monkey alive long enough to reach dense, fast obstacle spacing.
  let pairsSeen = 0;
  for (let round = 0; round < 45; round++) {
    const a = await page.evaluate(() => {
      const g = window.__MONKEY_GAME;
      if (g.state !== 'playing') g.start();
      g.testSetRevives(1e9);
      if (Math.random() < 0.6) g.testSpawnWaveNow();
      return { ...g.testObstacleAudit(), dist: Math.round(g.distance), slabsNear: g.cliffs.length };
    });
    expect(a.wallCoversAllLanes, `three-lane wall: ${JSON.stringify(a)}`).toBe(0);
    expect(a.rocksInSlabZone, `rock parked in a slab runway: ${JSON.stringify(a)}`).toBe(0);
    if (a.minSlabGap >= 0) {
      pairsSeen++;
      expect(a.minSlabGap, `slabs only ${a.minSlabGap} m apart: ${JSON.stringify(a)}`)
        .toBeGreaterThanOrEqual(SLAB_CLEAR - 0.2);
    }
    await page.waitForTimeout(650);
  }
  expect(pairsSeen, 'never had two slabs in the world at once').toBeGreaterThan(3);

  // The builder itself refuses a three-lane wall — even when somebody asks for one.
  const clamped = await page.evaluate(() => {
    const g = window.__MONKEY_GAME;
    g.testClearCliffs();
    const w = g.testSpawnWallAhead([0, 1, 2]);
    const covered = [-2.6, 0, 2.6].filter((x) => Math.abs(x - w.x) <= w.halfW + 0.35).length;
    return { covered, audit: g.testObstacleAudit() };
  });
  expect(clamped.covered, 'a wall covered all three lanes').toBeLessThan(3);
  expect(clamped.audit.wallCoversAllLanes).toBe(0);
  assertNoErrors();
});

// ---------------------------------------------------------------------------
// Pickup sound: synthesised WebAudio, unlocked by the first real gesture, and a
// mute flag that survives a reload. See docs/architecture.md → "Sound".
// ---------------------------------------------------------------------------
test('collecting a banana plays a chomp, and muting shuts it up for good', async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await page.goto('/');

  // A real click is the gesture that opens the AudioContext.
  await page.click('#start-btn');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => window.__MONKEY_SOUND.available)).toBe(true);

  const before = await page.evaluate(() => window.__MONKEY_SOUND.played);
  await page.evaluate(() => window.__MONKEY_GAME.testSpawnBananaAtPlayer());
  await expect(async () => {
    expect(await bananaCount(page)).toBe(1);
  }).toPass({ timeout: 5000 });
  const after = await page.evaluate(() => window.__MONKEY_SOUND.played);
  expect(after).toBeGreaterThan(before); // the chomp was scheduled

  // Mute (button), then nothing more is ever scheduled.
  await page.click('#sound-toggle');
  expect(await page.evaluate(() => window.__MONKEY_SOUND.muted)).toBe(true);
  const mutedAt = await page.evaluate(() => window.__MONKEY_SOUND.played);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__MONKEY_GAME.testSpawnBananaAtPlayer();
  });
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__MONKEY_SOUND.played)).toBe(mutedAt);

  // Muting is a preference, not a mood: it survives a reload.
  await page.reload();
  await expect(page.locator('#menu-overlay')).toBeVisible();
  expect(await page.evaluate(() => window.__MONKEY_SOUND.muted)).toBe(true);
  await shot(page, '25-sound-muted');
  assertNoErrors();
});
