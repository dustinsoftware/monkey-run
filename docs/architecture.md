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
| `src/App.jsx` | Phases (`menu`/`playing`/`over`/`shop`), HUD, overlays, best-score + banana banking |
| `src/shop/store.js` | Observable costume-shop store (wallet, owned ids, purchases→price, worn); `window.__MONKEY_SHOP` |
| `src/shop/CostumeShop.jsx` | Costume shop bottom-sheet overlay: wallet header, 9 tiles, try-on / buy / wear |
| `src/styles.css` | All styling: HUD chips, overlay cards, buttons, shop grid |
| `src/game/costumes.js` | Costume catalogue + primitive-built outfit builders for the monkey rig |
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
entered from the menu or the game-over card (`enterShop()` is ignored while `playing`).
Both dispatch chains in `loop()` need explicit branches for every state — their final branch
is an unguarded `else` that means "over", and the follow-camera block at the end of `loop()`
is skipped for `shop`, which owns its own close-up framing. See [costume-shop.md](./costume-shop.md).

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
| `BASE_SPEED` → `MAX_SPEED` | 14 → 36 m/s | ramped by `SPEED_RAMP = 0.04` per metre travelled |
| `LOOKAHEAD_S` | 130 | spawn distance ahead of the player (fog hides pop-in) |
| `GEN_AHEAD` / `DESPAWN_BEHIND` | 200 / 26 | path+geometry generated ahead / recycle distance behind |
| `CHUNK_LEN` | 20 m | road-ribbon chunk length |
| `CLIFF_H` | 1.9 m | cliff platform height (jump apex ≈ 2.4) |

**Score**: `score = floor(distance) + bananas * 10` (`stats()` also reports `distance`).

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
Offsets are authored in pre-scale monkey-local units (`group.scale = 0.85` applies to
descendants) and nothing is parented to a limb pivot, whose rotation is rewritten each frame.

### World content
- **Ground**: ribbon chunks (`CHUNK_LEN = 20 m`) swept along the path from a lateral
  `PROFILE` cross-section (road | curb | grass | embankment), vertex-coloured and speckled.
  A large `basePlane` at `−60 m` fills the sky below the ribbon.
- **Scenery**: 34 pooled trees/rocks re-placed ahead of (and behind) the player at lateral
  `±7.5…28 m`, sunk onto the embankment slope via `dropAtX()` and scaled per item.
- **Boulder waves** (`spawnWave`): 1–2 lanes blocked, spaced by
  `spawnGap = clamp(speed * 1.35, 20, 36)`. Waves are skipped when the spawn point falls
  inside a cliff zone (`sStart − 10 … sEnd + 6`) and suppressed entirely while
  `s <= noWavesUntil`.
- **Bananas** come from three sources: an arc of 7 over a boulder (p = 0.6), a 6-banana row
  down a *free* lane (p = 0.7), and cliff trails. Picked up when within ±0.95 in `s`/`x` and
  1.2 in `y` of the monkey's chest (`py + 0.8`).
- **Giant cliffs** (`CLIFF_H = 1.9 m`): monolith boxes covering 1–3 lanes, scheduled every
  180–320 m after the first at ~300 m. A lure banana marks the take-off spot and a trail runs
  along the top. Three separate rules govern contact:
  - **Airborne landing**: while `!grounded`, land (snap to height, `vy = 0`) whenever
    `py <= groundHeightAt(s, x)` — there is no tolerance band, which is what stops ghosting
    through the slab on the way up.
  - **Grounded step/crash**: if the surface is more than `0.45 m` above `py`, crash (walked
    into a cliff face or lane-changed into its side); within `0.45 m`, stick to it; lower,
    become airborne and fall off the end.
  - **Front-face hit**: crossing `sStart` between frames inside the slab's lateral extent at
    `py < c.H − 0.35` crashes.
- **Boulder collision**: `|dx| < r + 0.42 && |ds| < r + 0.35 && py < height − 0.4`.

### Camera & lighting
The camera rides the path frame 9 m behind the player at 3.5 m above it, following laterally
at `x * 0.4`, smoothed with `lerp(dt * 6)`; `camera.up` is lerped toward the surface normal so
banking tilts the view, and look-at is 8 m ahead at height +1.4 (`x * 0.15`). Crashes add a
decaying shake. The sun (`DirectionalLight` + shadow map) and the valley floor are
repositioned to the player each frame.

### Input
| Control | Key / gesture | Handled by |
| ------- | ------------- | ---------- |
| left lane | `←` / `A` | `MonkeyGame.onKeyDown` |
| right lane | `→` / `D` | `MonkeyGame.onKeyDown` |
| jump | `Space` / `↑` / `W` | `MonkeyGame.onKeyDown` |
| start / restart | `Enter` / `Space` (when not playing) | `App.jsx` keydown listener |
| lane change | swipe horizontally > 40 px | `bindTouch` (pointer events on the canvas) |
| jump | tap (< 300 ms, < 12 px) | `bindTouch` |

Keyboard input is ignored unless `state === 'playing'`; arrow keys/space are
`preventDefault`-ed.

### Test/debug hooks
`window.__MONKEY_GAME` exposes the live engine (`s`, `speed`, `py`, …) plus:

| Hook | Purpose |
| ---- | ------- |
| `getCostume()` / `setCostume(id)` | read/equip an outfit (`null` = bare monkey); also used by tests to assert try-on |
| `testSpawnBananaAtPlayer()` | deterministic banana pickup (spawns at the monkey's chest) |
| `testSpawnBoulderAhead(d)` | unavoidable boulder in the player's current lane → natural crash |
| `testClearCliffs()` | remove cliffs **and** active boulders, set `nextCliffS = Infinity` until the next `reset()`. Does *not* stop wave spawning — see `noWavesUntil` below |
| `testSpawnCliffAhead()` | spawn a full-road cliff beyond generated samples; sets `noWavesUntil = sEnd + 60`; returns `{ sStart, sEnd }` (the tests poll those values) |

## React shell (`App.jsx`)

- One `<canvas>`; the engine is created once in an effect and stored in a ref
  (`window.__MONKEY_GAME` for tests, removed on unmount).
- `phase` state selects what renders: `#menu-overlay`, HUD (only for `playing`/`over`),
  `#gameover-overlay`, `#shop-overlay`.
- `startGame()` resets HUD/stats, sets `playing`, calls `game.start()`.
- `Enter`/`Space` start or restart **except** in the shop; `Esc` closes the shop.
- Persistence: best score under `localStorage['monkey-dash-best']`; costume shop under
  `localStorage['monkey-dash-shop']`. Run bananas are banked into the shop wallet exactly once,
  inside the engine's `onGameOver` callback (never in a render path or effect — returning from
  the shop restores phase `over` and would re-bank).

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
| costume shop (`costume-shop.spec.js`) | banking on death, try-on is free/reversible, buy + price inflation, no overspending, persistence across reload, menu entry/back, every outfit renders |
