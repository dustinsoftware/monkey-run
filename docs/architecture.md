# Monkey Dash — Architecture

A Subway Surfers–style endless runner: **Three.js** scene + **React 19** shell, built by
**Vite**, tested with **Playwright**. No backend; all persistence is `localStorage`.

```
index.html ── src/main.jsx ── src/App.jsx ─────────────── React overlays (menu/HUD/game over)
                    │              │ callbacks + refs
                    │              ▼
                    │         src/game/engine.js  MonkeyGame — scene, physics, spawning, loop
                    │              │
                    └── src/styles.css       src/game/track.js TrackPath — the spline
```

| File | Responsibility |
| ---- | -------------- |
| `index.html` | Vite entry; single `#root` div, canvas mounted by React |
| `src/main.jsx` | `createRoot(...).render(<App />)` — deliberately **no** `StrictMode` (double-mount would create two WebGL renderers on one canvas) |
| `src/App.jsx` | Phases (`menu`/`playing`/`over`/`shop`), HUD (score/bananas/level/daily/ability), level banner, sound toggle, overlays, best-score + banana banking |
| `src/shop/store.js` | Observable costume-shop store (wallet, owned ids, flat price, worn, pending victory); `window.__MONKEY_SHOP` |
| `src/shop/CostumeShop.jsx` | Costume shop panel: wallet header, 9 tiles, try-on / buy / wear |
| `src/shop/VictoryModal.jsx` | "Top banana" modal shown once the whole wardrobe is owned |
| `src/daily/store.js` | Observable daily-challenge store (day key, derived target/best/streak, one payout per day); `window.__MONKEY_DAILY` |
| `src/daily/DailyChallenge.jsx` | Daily goal copy on the menu card and the game-over card |
| `src/styles.css` | All styling: HUD chips, overlay cards, buttons, shop grid |
| `src/game/costumes.js` | Costume catalogue (incl. each outfit's **ability** data) + primitive-built outfit builders for the monkey rig |
| `src/game/levels.js` | Themed-level table: 14 worlds of pure palette/scenery data, `LEVEL_SECONDS`, menu level; see [levels.md](./levels.md) |
| `src/game/audio.js` | `SoundKit` — WebAudio banana pickup, level-clear and revive chimes, mute persistence; `window.__MONKEY_SOUND` |
| `src/game/banana.js` | `makeBananaGeometry()` — one shared vertex-coloured banana mesh (lathed, bent tapered tube) |
| `src/game/engine.js` | `MonkeyGame`: renderer/scene/camera/lights, procedural monkey, physics, spawning, collisions, animation loop |
| `src/game/track.js` | `TrackPath`: procedurally generated spline (straights, banking curves, hills) sampled every `STEP = 1 m` |
| `tests/game.spec.js`, `tests/costume-shop.spec.js` | Playwright suites + screenshots into `tests/screenshots/` (tracked in git) |
| `playwright.config.js` | testDir/timeouts, `baseURL :5173`, viewport 1280×720, headless, `webServer.reuseExistingServer` |
| `vite.config.js` | React plugin, `server.port 5173` + `strictPort`, `base` from `PAGES_BASE` |
| `.github/workflows/deploy.yml` | Builds with `PAGES_BASE=/<repo>/` and publishes `dist/` to GitHub Pages |
| `package.json` | Scripts: `dev` = `start` = `vite`, `build`, `preview`, `test` = `playwright test` |

## Coordinate system: track-local space

The path is a piecewise curve integrated forward in 1 m steps and stored in parallel
arrays (`posArr`, `tanArr`, `upArr`) with a moving `baseIndex`; samples behind the player
are pruned (`path.prune(this.s - 80)`). Every dynamic object in the game is stored in
**track-local coordinates**:

- `s` — arc length along the path (the "forward" axis)
- `x` — lateral offset from the path centre (lanes: `LANES = [-2.6, 0, 2.6]`)
- `y` / `py` — height above the surface

`syncWorldTransforms()` converts **scenery, boulders, bananas and cliffs** from local →
world each frame by sampling the path and building a basis `(right, up, -tangent)`. The
monkey and camera are *not* handled there; they are placed in the per-state branches of
`loop()`. Curves, hills and banking therefore come for free: everything rides the same frame.

`TrackPath.addForcedStraight(startS, endS)` reserves a flat straight so rectangular cliff
monoliths sit flush on the surface; random segment generation truncates before a reserved zone.

## Engine (`MonkeyGame`)

### States — and how React sees them
`this.state`: `menu` (gentle auto-run past scenery) → `playing` → `crashed` (1.4 s skid +
tumble, then `over`) → `over` (frozen at the crash site), plus `shop`, a fitting-room state
entered from the menu or the game-over card (`enterShop()` is ignored while `playing`). Entering
the shop **rewinds the world to the start of the trail** — `rebuildWorld()` builds a fresh
`TrackPath` at `s = 0`, recycles chunks/scenery and deactivates every pooled boulder/banana, so the
fitting camera never frames the monkey inside a cliff. `reset()` shares that same `rebuildWorld()`
(it owns the run stats on top of it) and snaps the camera behind the start via
`snapCameraToStart()`. See [costume-shop.md](./costume-shop.md).
Both dispatch chains in `loop()` need explicit branches for every state — their final branch
is an unguarded `else` that means "over", and the follow-camera block at the end of `loop()`
is skipped for `shop`, which owns its own close-up framing. See [costume-shop.md](./costume-shop.md).

Two run-long subsystems hang off `playing` only: **themed levels** (a 60 s timer per level,
[levels.md](./levels.md)) and the **level/obstacle scheduler** (`scheduleSlabs`, below). Neither
runs in `menu`, `shop`, `crashed` or `over`.

React has **no** `crashed` phase: `App.jsx` keeps `phase ∈ {menu, playing, over, shop}`, and
because `crash()` invokes `cb.onGameOver(stats)` synchronously, `phase` becomes `'over'`
the instant the crash happens — so the game-over overlay is displayed *while* the monkey is
still tumbling for the next 1.4 s (and the HUD stays visible, since `phase !== 'menu'`).

The engine also calls an optional `cb.onState('playing')` from `start()`; `App.jsx` does not
supply it today, so it is currently unused.

### Tuning constants (`engine.js`)
| Constant | Value | Meaning |
| -------- | ----- | ------- |
| `LANE_LERP` | 12 | lane-switch responsiveness |
| `GRAVITY` / `JUMP_VELOCITY` | −38 / 13.5 | apex ≈ 2.4 m — clears boulders, lands on cliffs |
| `SECOND_JUMP_VELOCITY` | 11.6 m/s | the mid-air boost spent by an ability's extra jump |
| `BASE_SPEED` → `MAX_SPEED` | 14 → 36 m/s | ramped by `SPEED_RAMP = 0.04` per metre travelled, then scaled by the outfit's `speedMul` |
| `LOOKAHEAD_S` | 130 | spawn distance ahead of the player (fog hides pop-in) |
| `GEN_AHEAD` / `DESPAWN_BEHIND` | 200 / 26 | path+geometry generated ahead / recycle distance behind |
| `CHUNK_LEN` | 20 m | road-ribbon chunk length |
| `CLIFF_H` | **1.9** m | cliff platform height (jump apex ≈ 2.4) — rideable |
| `WALL_H` | **5.5** m | wall height — more than double the jump apex, so it is never jumpable |
| `SLAB_CLEAR` | **90** m | minimum end-to-start distance between any two slabs (~2.5 s at `MAX_SPEED`) |
| `SLAB_APPROACH` | **45** m | clear runway in front of a slab where no boulder may be placed |
| `CHEST_Y` | 0.8 m | banana collection height above the surface (`× sizeScale`) |
| `COLLECT_DX` / `_DS` / `_DY` | 0.95 / 0.95 / 1.2 | pickup box around the chest (lateral / along path / vertical) |
| `JUMP_APEX` | derived ≈ 2.4 m | `JUMP_VELOCITY² / (2·|GRAVITY|)` — never typed out by hand |
| `BANANA_MAX_Y` | derived ≈ 4.4 m | highest a banana may sit above the surface it belongs to (`JUMP_APEX + CHEST_Y + COLLECT_DY`) |
| `BANANA_MIN_CLEAR` | 0.55 m | how far clear of the thing under it a banana must be to count as grabbable |
| `MONKEY_SCALE` | 0.85 | base monkey scale, multiplied by an outfit's `sizeScale` |
| `BASE_BANANA_VALUE` / `LEVEL_BONUS` | 10 / 250 | score terms (see below) |
| `REVIVE_GRACE` | 1.4 s | invulnerability after a doctor revive |

**Score**: `score = floor(distance) + bananas * (BASE_BANANA_VALUE + ability.valueBonus) +
levelsCleared * LEVEL_BONUS` (`stats()` also reports `distance`, `level`, `levelsCleared`, `lap`
and `ability`). See [levels.md](./levels.md) and [abilities.md](./abilities.md).

### The monkey
`buildMonkey()` assembles the character from primitives — no meshes are loaded:

```
group (scale 0.85)
└── body                      ← tumbled here on crash
    ├── torso (capsule, brown) + belly (sphere, tan)
    ├── head (Group @ y=1.72) → skull, face, muzzle, ears×2, eyes×2, pupils×2
    ├── armL / armR           ← pivot Groups at the shoulders; limb mesh hangs below
    ├── legL / legR           ← pivot Groups at the hips
    └── tail (TubeGeometry along a CatmullRomCurve3)
```

Animation is procedural: `runPhase` drives sine-swung limbs, a bob, head nod and tail wiggle;
jumping blends toward a fixed jump pose via `jumpBlend`. The monkey uses exactly **four**
materials (`brown`, `tan`, `dark`, `white`) that are each reused across many meshes — they
are shared *between* parts, so recolouring one part would recolour them all. (Scenery is the
opposite: `buildTree()` allocates fresh trunk/leaf materials per tree.)

Costumes exploit this: every outfit is its own set of meshes/materials attached to the rig
hosts (`body`, `head`, `armL/R`, `legL/R`) and toggled by visibility, never by recolouring.
Offsets are authored in pre-scale monkey-local units (`group.scale = MONKEY_SCALE` applies to
descendants) and nothing is parented to a limb pivot, whose rotation is rewritten each frame.

Because the scale is now an ability stat, `buildMonkey()` sets it from `MONKEY_SCALE` and
`applyAbility()` writes `MONKEY_SCALE * sizeScale`. No other code may touch `group.scale`.

### World content
- **Ground**: ribbon chunks (`CHUNK_LEN = 20 m`) swept along the path from a lateral
  `PROFILE` cross-section (road | curb | grass | embankment), vertex-coloured and speckled.
  Band colours come from `this.palette` (the current level theme) at build time, so changing
  levels means disposing every cached chunk (`rebuildChunks()`). A large `basePlane` at
  `−60 m` fills the sky below the ribbon; its colour is per-theme too.
- **Scenery**: 34 pooled props re-placed ahead of (and behind) the player at lateral
  `±7.5…28 m`, sunk onto the embankment slope via `dropAtX()` (unless the theme says
  `sink: false`) and scaled per item. Kinds come from the theme's weighted list — see
  [levels.md](./levels.md).
- **Boulder waves** (`spawnWave`): 1–2 lanes blocked, spaced by
  `spawnGap = clamp(speed * 1.35, 20, 36)`. A boulder is dropped (that lane simply is not blocked
  this wave) when its own spot falls inside a slab zone — `sStart − SLAB_APPROACH … sEnd + 6`, with
  `SLAB_APPROACH = 45 m` of clear runway in front of every monolith. Waves are suppressed entirely
  while `s <= noWavesUntil`. This is what keeps a wall dodgeable: the lane it leaves open must never
  have a rock parked in it, because a wall over two lanes plus a boulder in the third *is* an
  all-three-lane wall from the player's seat.
- **Bananas** come from three sources: an arc of 7 over a boulder (p = 0.6), a 6-banana row
  down a *free* lane (p = 0.7), and cliff trails. Picked up when within `COLLECT_DX`/`_DS`
  laterally and along the path (grown by the outfit's `sizeScale`) and `COLLECT_DY` in `y` of
  the monkey's chest (`py + CHEST_Y * sizeScale`).
- **Banana reachability** — every banana in the game is placed through one helper, so no
  spawn site can put a collectible somewhere the monkey cannot get to:

  ```js
  placeBanana(b, s, x, y)   // returns true when it activated the banana
  ```

  It resolves `g = groundHeightAt(s, x)` (the top of whatever solid, if anything, occupies
  that spot) and then:
  1. **rejects** the placement when `y < g + BANANA_MIN_CLEAR` — a banana inside or just
     under the surface of a cliff top/wall body is invisible and uncollectable;
  2. **rejects** it when an active boulder's volume covers the spot *and* `y` is below that
     boulder's top (`o.height + 0.45`) — you would die on the rock before reaching it;
  3. **clamps** `y` down to `g + BANANA_MAX_Y`, the highest point a max-height jump can put
     his chest, so nothing floats above the reachable envelope;
  4. activates the banana at the clamped height (or leaves the pool slot free).

  Boulder arcs are authored *from* the boulder's own height (`low = max(0.9, o.height + 0.5)`,
  `high = low + 1.15`) instead of a fixed pair of numbers, so a big boulder can no longer
  swallow its own reward line. Cliff trails sit `1.05 m` above the slab top and their lure banana
  at `H + 0.55`, both inside the envelope; **walls get no trail and no lure at all** (they are not
  rideable, so a trail on top would be exactly the floating bait this rule exists to kill).
- **Banana ownership** — every banana remembers who placed it (`b.owner`). Cliff trails and their
  lures are owned by their slab, so `removeSlab()` retires them together. A trail left behind by a
  pruned or revived-away slab would otherwise hang in mid-air over bare road for the rest of the
  run: reachable only by a perfect jump, which is exactly what "bananas float where you can't get
  them" looks like from the player's seat. `retireBanana()` clears `active`, visibility *and*
  `owner` in one place; nothing else may deactivate a banana.
  `testBananaAudit()` re-runs these rules over every active banana and additionally reports
  `orphan` — an active banana still pointing at a slab that is no longer in `this.cliffs`, i.e. the
  exact shape of a code path that removes a slab by hand instead of through `removeSlab()`.
- **Banana mesh** (`src/game/banana.js`) is one shared geometry for the whole pool: a
  `LatheGeometry` swept from a tapered radius profile (fat middle, pinched tips), sheared along its
  length into a crescent, laid down with `rotateZ(-π/2)` so the long axis runs track-right and the
  curve sits in the camera-facing plane, then vertex-coloured yellow with brown tips. The loop rolls
  it about that long axis (`mesh.rotation.x`), which keeps the crescent facing the camera instead of
  spinning a sliver.
- **Slabs** (`this.cliffs` — one list, two kinds) are monolith boxes built by `makeSlab`:
  * **Cliffs** (`CLIFF_H = 1.9 m`, `rideable: true`): covering 1–3 lanes, scheduled every
    180–320 m after the first at ~300 m. A lure banana marks the take-off spot and a trail runs
    along the top.
  * **Walls** (`WALL_H = 5.5 m`, `rideable: false`): scheduled every 260–470 m (both spacings
    divided by `pace(lap)`), covering **1–2 lanes only** — a wall that blocked all three would
    be unavoidable, since it is more than twice the jump apex and cannot be cleared. Walls are
    painted from the theme's slab colour and carry no bananas; they exist to force a lane change.
  * `makeSlab` **clamps non-rideable coverage to two lanes** even when asked for three (the scheduler
    never asks, but a wall that cannot be dodged is never fair, so the invariant lives in the builder
    rather than only at the call sites).
  * **Clearance**: any two slabs are kept at least `SLAB_CLEAR = 90 m` apart end-to-start by
    `slabStartAfter`. The old rule pushed a new slab only 12 m past an existing one, which let a
    cliff covering lanes 0–1 sit half a second (at top speed) in front of a wall covering lane 2 —
    two disjoint lane changes with no time to make them. 90 m is ~2.5 s at `MAX_SPEED`, enough for
    one lane change per obstacle, always.

  Contact is decided from the height he had **at the start of the frame**
  (`pyStart`), because physics and collision checks run in one pass:
  - **Airborne landing**: while `!grounded`, land (snap to height, `vy = 0`) when
    `py <= groundHeightAt(s, x)` *and* `pyStart >= that height`. The second condition is what
    stops a late jump ghosting through a cliff face: without it the snap lifts him from below
    the lip onto the top of the slab in one frame.
  - **Airborne wall hit**: if instead `pyStart < gh − 0.35` he entered a taller surface from
    below or sideways → crash.
  - **Grounded step/crash**: if the surface is more than `0.45 m` above `py`, crash (walked
    into a cliff face or lane-changed into its side); within `0.45 m`, stick to it; lower,
    become airborne and fall off the end.
  - **Front-face hit**: crossing `sStart` between frames inside the slab's lateral extent at
    `py < c.H − 0.35` crashes (kept for crossings that happen while grounded).
- **Boulder collision**: `|dx| < r + 0.42 * hitboxScale && |ds| < r + 0.35 * hitboxScale &&
  py < height − 0.4`. The padding is the only ability-scaled part of obstacle geometry; slab
  edges stay exact.

### Camera & lighting
The camera (`CAM_BEHIND = 9 m`, `CAM_HEIGHT = 3.5 m`) rides the path frame behind the player at
`s − CAM_BEHIND`, following laterally at `x * 0.4`, smoothed with `lerp(dt * 6)`; `camera.up` is
lerped toward the surface normal so banking tilts the view, and look-at is 8 m ahead at height +1.4
(`x * 0.15`). `sampleTo` extrapolates linearly back along its oldest segment for negative indices,
so "behind the start" is real ground and a real camera perch — without that, at `s < CAM_BEHIND`
the camera lands *on* the monkey (he drops out of frame) and chunk −1 collapses into a degenerate
sliver of sky. That matters twice over: the first seconds of every run, and after every shop visit,
which rewinds to `s = 0`. `snapCameraToStart()` parks the camera at exactly that spot so `reset()`
does not lerp it across.
Crashes add a decaying shake. The sun (`DirectionalLight` + shadow map) and the valley floor are
repositioned to the player each frame.

### Input
| Control | Key / gesture | Handled by |
| ------- | ------------- | ---------- |
| left lane | `←` / `A` | `MonkeyGame.onKeyDown` |
| right lane | `→` / `D` | `MonkeyGame.onKeyDown` |
| jump | `Space` / `↑` / `W` | `MonkeyGame.onKeyDown` |
| start / restart | `Enter` / `Space` (when not playing) | `App.jsx` keydown listener |
| mute / unmute | `M` (anywhere, any phase) | `App.jsx` keydown listener → `soundKit.setMuted(!muted)` |
| lane change | swipe horizontally > 40 px (horizontal axis dominant) | `bindTouch` (pointer events on the canvas) |
| jump | **swipe up** > 40 px (vertical axis dominant, moving upward) **or** a tap / drag shorter than 24 px | `bindTouch` |

Keyboard input is ignored unless `state === 'playing'`; arrow keys/space are
`preventDefault`-ed. Touch gestures follow the same rule: `bindTouch` decides nothing outside
`playing`, so swiping on the menu or over a corpse never starts a run or wastes a jump.

**Gesture rules (`bindTouch`).** A swipe is decided by its **dominant axis**: more than
`SWIPE_PX = 40 px` of travel along it wins, so a diagonal flick left still changes lanes and an
upward flick always jumps. A downward swipe deliberately does nothing — there is no duck/roll to
trigger, and a fall-through-the-floor jump would be worse than an ignored gesture. Anything that
did not cross the swipe threshold and stayed inside `TAP_PX = 24 px` of its start point is a tap and
jumps; **there is no duration cap any more** — the old `< 300 ms` rule meant a slow, deliberate
thumb tap expired and did nothing at all.

One gesture per finger: `bindTouch` remembers the `pointerId` of the first `pointerdown` and ignores
every other pointer until that one ends (`pointerup`) or is cancelled (`pointercancel`). The old code
kept a single shared start point, so a second finger landing mid-swipe **overwrote it**, and the
first finger's `pointerup` then measured a delta between two unrelated touches — on a phone that read
as phantom lane changes. `pointercancel` (browser stole the gesture: scroll, system edge swipe,
incoming call) clears the tracked pointer instead of leaving it stuck, so the next tap always works.

### Sound (`src/game/audio.js`)

No audio files: everything is synthesised with **WebAudio**, so there is nothing to download and
nothing to fail to load. One module-level singleton `soundKit` (also `window.__MONKEY_SOUND`)
is shared by the engine and the React shell.

| Member | Behaviour |
| ------ | --------- |
| `unlock()` | Creates the `AudioContext` on first call and `resume()`s it afterwards. Browsers only allow this from a user gesture, so `App.jsx` calls it once from `pointerdown`/`keydown` listeners registered with `{ once: true }`, and again whenever the mute button is pressed. Safe to call repeatedly; never throws when WebAudio is missing (`available === false`). |
| `pickup(index)` | The banana chomp: a triangle osc through a short exponential decay plus a sine "pop" that glides down onto it, pitched up an eight-step ladder built from minor-pentatonic degrees by `index % 8` — so a streak of bananas plays a rising run. Called by the engine with the run's banana count, which resets per run for free. |
| `levelClear()` | Four-note arpeggio when a themed level is beaten. |
| `revive()` | Two-note low-high "second opinion" chime on a doctor revive. |
| `setMuted(bool)` / `muted` | Muting stops every note and survives a reload under `localStorage['monkey-dash-sound']` (`'1'` = muted). Corrupt/absent storage means unmuted. |
| `played` | Count of notes actually scheduled — the deterministic thing tests assert on. It counts *attempts* that passed the mute/availability gate, because a suspended context still schedules them. |

The engine never constructs an `AudioContext`: it only calls the kit. That keeps audio out of
the WebGL boot path and makes "no sound until you touch something" a property of one file.

### Test/debug hooks
`window.__MONKEY_GAME` exposes the live engine (`s`, `speed`, `py`, …) plus:

| Hook | Purpose |
| ---- | ------- |
| `getCostume()` / `setCostume(id)` | read/equip an outfit (`null` = bare monkey); also applies its ability |
| `testSpawnBananaAtPlayer()` | deterministic banana pickup (spawns at the monkey's chest, through `placeBanana`) |
| `testSpawnBananaAhead({ d, lane })` | one banana at a chosen spot ahead (`d` metres, absolute lane index), also through `placeBanana`; returns the placed spot or `null` when the rules refused it |
| `testSpawnBoulderAhead(d)` | unavoidable boulder in the player's current lane → natural crash |
| `testClearCliffs()` | remove **all slabs** (cliffs *and* walls) **and** active boulders, set `nextCliffS`/`nextWallS = Infinity` until the next `reset()`. Does *not* stop wave spawning — see `noWavesUntil` below |
| `testSpawnCliffAhead()` | spawn a full-road cliff beyond generated samples; sets `noWavesUntil = sEnd + 60`; returns `{ sStart, sEnd, H, rideable }` (the tests poll those values) |
| `testSpawnWallAhead(lanes?)` | spawn an unjumpable wall (`rideable: false`, `H = WALL_H`) ahead covering the given lane indices — default: **only** the player's current lane, so it is a forced lane change rather than a death sentence. Returns `{ sStart, sEnd, x, halfW, H }` |
| `testSpawnWaveNow()` | force one boulder wave right now (used by the banana audit) |
| `testObstacleAudit()` | scheduling invariants over the live world: `{ slabs, walls, wallCoversAllLanes, minSlabGap, rocksInSlabZone }` — every wall must leave a lane open, no two slabs closer than `SLAB_CLEAR`, no boulder inside a slab's zone |
| `testBananaAudit()` | re-check every active banana against the reachability rules; returns `{ checked, buried, unreachable, inObstacle, orphan, slabs, walls }`. All five counters must stay 0 / consistent |
| `testGetLevel()` / `testSetLevelIndex(i)` / `testClearLevelNow()` | themed-level control — see [levels.md](./levels.md) |
| `testJump()` / `testAirJumpsLeft` (getter) / `testSetRevives(n)` | ability probes — see [abilities.md](./abilities.md) |

`window.__MONKEY_SOUND` exposes the kit itself (`played`, `muted`, `available`, `ctxState()`).

## React shell (`App.jsx`)

- One `<canvas>`; the engine is created once in an effect and stored in a ref
  (`window.__MONKEY_GAME` for tests, removed on unmount).
- `phase` state selects what renders: `#menu-overlay`, HUD (only for `playing`/`over`),
  `#level-banner`, `#gameover-overlay`, `#shop-overlay`.
- The HUD row is five chips in a fixed order — `.hud-score`, `.hud-bananas`, `#hud-level`,
  `#daily-chip`, `#hud-ability` — plus the `#sound-toggle` button. Chip text formats are part of
  the test contract: bananas stay `🍌 N`, the level chip stays `<LABEL> · SS` (theme label
  upper-cased, whole seconds left, e.g. `SUNNY BEACH · 52`), and the ability chip is the worn
  outfit's ability label or `Bare Monkey`. The HUD reads `level`/`ability` from the engine's own
  `onHud` payload rather than from the shop store, so a hook-driven costume change shows up too.
- Extra callbacks from the engine: `onLevel(info)` (a themed level was cleared → show the banner)
  and `onRevive(info)` (a doctor revive happened → chime already played, HUD can react).
  Both are optional; the engine works without them.
- `startGame()` resets HUD/stats, sets `playing`, calls `game.start()`.
- `Enter`/`Space` start or restart **except** in the shop; `Esc` closes the shop. A pending
  top-banana modal is checked before any of that: those same keys dismiss it and stop.
- Persistence: best score under `localStorage['monkey-dash-best']`; costume shop under
  `localStorage['monkey-dash-shop']`; daily challenge under `localStorage['monkey-dash-daily']`;
  sound mute flag under `localStorage['monkey-dash-sound']`. Levels and abilities add **no**
  persisted state — a run's level progress is not saved, so every start rolls a fresh random
  theme.
  Run bananas are banked into the shop wallet exactly once,
  inside the engine's `onGameOver` callback (never in a render path or effect — returning from
  the shop restores phase `over` and would re-bank). That same callback records the run's distance
  with `dailyStore.recordRun(distance)`, which returns the daily reward (0 unless it just paid) so
  the payout can go through `addBananas` on the same single-fire path. See
  [daily-challenge.md](./daily-challenge.md).

## Build & deploy

`pnpm dev` → Vite on :5173 (`strictPort`). `pnpm build` honours `PAGES_BASE` so the GitHub
Pages workflow can publish a project site at `/<repo>/`. `pnpm test` runs Playwright, which
boots the dev server via `webServer.reuseExistingServer`.

## Tests

| Test | Verifies |
| ---- | -------- |
| menu renders | title, 3 control chips, start button, no page errors |
| gameplay | score increases on curved/banking track, lane changes + jumps |
| banana pickup | injected banana reaches count 1 |
| boulder crash | game over overlay, final score > 0, restart resets state |
| cliff ride | timed jump onto plateau, trail bananas collected, survive; late jump crashes (clip regression) |
| keyboard-only flow | `Enter` starts the game |
| walls (in `game.spec.js`) | an unavoidable wall in your lane ends the run; stepping one lane across survives it; a wall is never jumpable (`H > JUMP_APEX`) |
| wall dodgeability audit (in `game.spec.js`) | after forcing many waves, cliffs and walls: no wall covers all three lanes, every pair of slabs respects `SLAB_CLEAR`, and no boulder sits in the runway in front of a slab |
| banana reachability audit (in `game.spec.js`) | after forcing waves, cliffs and walls, every active banana passes the same clearance/envelope/boulder rules `placeBanana` used to create it, and none is orphaned by a slab that has gone away |
| pickup sound (in `game.spec.js`) | collecting a banana schedules notes (`__MONKEY_SOUND.played` grows); muting stops them; mute survives a reload |
| themed levels (`levels.spec.js`) | menu is forest, a run starts on a random theme (≥3 distinct across restarts), the HUD chip counts down, clearing a level advances the index/banner/score and wraps into lap 2, every theme renders and is screenshot-tested |
| costume abilities (`abilities.spec.js`) | catalogue well-formed, equipping matches the imported stat table, double jump raises the apex, magnet collects an adjacent-lane banana (bare monkey misses it), one revive then death, try-on previews stats and reverts |
| daily challenge (`daily-challenge.spec.js`) | target is a pure function of the local date, menu/HUD/game-over progress, one payout per day (and none twice), streak growth and reset, rollover keeps the streak but resets today's best, corrupt storage normalises |
| costume shop (`costume-shop.spec.js`) | banking on death (plus the trailhead rewind), try-on is free/reversible, flat 100-banana buys that never inflate, the top-banana modal on completion and its persistence, no overspending, persistence across reload, menu entry/back, banana geometry, every outfit renders |
