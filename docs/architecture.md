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
| `index.html` | Vite entry; single `#root` div + canvas mounted by React |
| `src/main.jsx` | `createRoot(...).render(<App />)` — deliberately **no** `StrictMode` (double-mount would create two WebGL renderers on one canvas) |
| `src/App.jsx` | Phases (`menu`/`playing`/`over`), HUD, overlays, best-score persistence |
| `src/styles.css` | All styling: HUD chips, overlay cards, buttons |
| `src/game/engine.js` | `MonkeyGame`: renderer/scene/camera/lights, procedural monkey, physics, spawning, collisions, animation loop |
| `src/game/track.js` | `TrackPath`: procedurally generated spline (straights, banking curves, hills) sampled every `STEP = 1 m` |
| `tests/game.spec.js` | Playwright suite + screenshots into `tests/screenshots/` |

## Coordinate system: track-local space

The path is a piecewise curve integrated forward in 1 m steps and stored in parallel
arrays (`posArr`, `tanArr`, `upArr`) with a moving `baseIndex`; samples behind the player
are pruned. Every dynamic object in the game is stored in **track-local coordinates**:

- `s` — arc length along the path (the "forward" axis)
- `x` — lateral offset from the path centre (lanes: `LANES = [-2.6, 0, 2.6]`)
- `y` — height above the surface

Each frame, `syncWorldTransforms()` converts local → world by sampling the path and
building a basis `(right, up, -tangent)`. Curves, hills and banking therefore come for
free: obstacles, bananas, cliffs, scenery, the monkey and the camera all ride the same frame.

`TrackPath.addForcedStraight(startS, endS)` reserves a flat straight so rectangular cliff
monoliths sit flush on the surface; random segment generation truncates before a reserved zone.

## Engine (`MonkeyGame`)

### Lifecycle states
`this.state`: `menu` (gentle auto-run past scenery) → `playing` → `crashed` (1.4 s skid +
tumble) → `over` (frozen at the crash site). React mirrors this in `phase`, driven by the
`onHud` / `onGameOver` callbacks passed into the constructor.

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
jumping blends toward a fixed jump pose via `jumpBlend`. Materials are shared per-part
(`brown`, `tan`, `dark`, `white`) — **they are shared across parts, so recolouring one part
would recolour all of them.**

### World content
- **Ground**: ribbon chunks (`CHUNK_LEN = 20 m`) swept along the path from a lateral
  `PROFILE` cross-section (road | curb | grass | embankment), vertex-coloured and speckled.
  A large `basePlane` at `-60 m` fills the sky below the ribbon.
- **Boulders**: pooled dodecahedra, 1–2 lanes blocked per wave (`spawnWave`), spaced by
  `spawnGap = clamp(speed * 1.35, 20, 36)`. Banana arcs hover over them as a reward line.
- **Bananas**: pooled torus segments; collected when within ±0.95 in `s`/`x` and 1.2 in `y`
  of the monkey's chest (`py + 0.8`).
- **Giant cliffs** (`CLIFF_H = 1.9 m`, jump apex ≈ 2.4 m): monolith boxes covering 1–3 lanes,
  scheduled every 180–320 m after the first at ~300 m. A lure banana marks the take-off spot
  and a trail runs along the top. Landing sticks when within 0.45 m of the surface; walking
  into a face or running off the end resolves to crash/fall in the `playing` branch.

### Camera & lighting
The camera rides the path frame 9 m behind the player, at 3.5 m above it, with `camera.up`
lerped toward the surface normal so banking tilts the view; look-at is 8 m ahead. The sun
(`DirectionalLight` + shadow map) and the valley floor are repositioned to the player each frame.

### Test/debug hooks
`window.__MONKEY_GAME` exposes the live engine (`s`, `speed`, `py`, …) plus:

| Hook | Purpose |
| ---- | ------- |
| `testSpawnBananaAtPlayer()` | deterministic banana pickup |
| `testSpawnBoulderAhead(d)` | unavoidable boulder → natural crash |
| `testClearCliffs()` | remove cliffs/waves, stop scheduling |
| `testSpawnCliffAhead()` | full-road cliff beyond generated samples |

## React shell (`App.jsx`)

- One `<canvas>`; the engine is created once in an effect and stored in a ref.
- `phase` state selects which overlay renders: `#menu-overlay`, HUD (`phase !== 'menu'`),
  `#gameover-overlay`.
- `startGame()` resets HUD/stats, sets `playing`, calls `game.start()`.
- Keyboard: `Enter`/`Space` starts or restarts whenever `phase !== 'playing'`.
- Persistence: best score under `localStorage['monkey-dash-best']`.

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
