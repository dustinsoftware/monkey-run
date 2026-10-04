# Design — Costume Shop

**Status:** implemented (design from reviewer run `e62342aa`; deviations recorded at the bottom).
**Scope:** spend bananas banked from runs on permanent monkey outfits, with try-on preview.

**Revision 2 (flat economy + top banana):** every costume cost **50** bananas and prices never
move. Completing the set pops a "you beat the game" modal. The fitting room now rewinds the world
to the start of the trail so you can see the monkey you are dressing.

**Revision 3 (the wardrobe got expensive):** `COSTUME_PRICE` **50 → 100**. At 50 the whole set was
450 bananas — reachable in a handful of good runs, so "beating the game" stopped being a goal.
The price is still flat and history-free; only the constant moves. See *Balance note*.

## Player-facing behaviour

1. Bananas collected during a run are **banked into a persistent wallet** when the run ends.
   The per-run banana count in the HUD is unchanged.
2. Every death offers the shop: the game-over card gains `🛍️ COSTUME SHOP` (`#go-shop-btn`)
   next to `RUN AGAIN`. The menu gets `COSTUME SHOP` (`#menu-shop-btn`) so outfits can be
   browsed without dying. Offered, never forced — restarting must stay one click/keypress away.
3. The shop lists **9 costumes**, every one of them priced at `COSTUME_PRICE`:

   | id | costume | icon |
   | -- | ------- | ---- |
   | `tuxedo` | Tuxedo | 🎩 |
   | `clown` | Clown | 🤡 |
   | `doctor` | Doctor | 🩺 |
   | `tophat` | Top Hat | 🎩 |
   | `dog` | Dog outfit | 🐶 |
   | `bunny` | Bunny outfit | 🐰 |
   | `cat` | Cat outfit | 🐱 |
   | `butterfly` | Butterfly wings | 🦋 |
   | `rainsuit` | Yellow Rainsuit + Umbrella | ☔ |

4. **Economy.** Every costume costs exactly **100** bananas — today, after a purchase, forever.
   There is no inflation of any kind: nine costumes, 100 each, **900 bananas for the whole set**.
   A purchase deducts 100 from the wallet and unlocks the costume **forever**.
5. **Try before buying.** `TRY ON` previews any costume on the monkey in a close-up fitting
   view — free, changes nothing else, reverted when you leave unless you bought it.
6. Owned costumes wear for free (`WEAR`, shown `WORN`). The worn choice persists across reloads
   and is what the monkey wears while running.
7. **The fitting room stands at the trailhead.** Entering the shop rewinds the world to the start
   of the run (`s = 0`) before framing the monkey, so you always see him on clean ground rather
   than wedged in the crash site's boulders and cliff slabs. See *Fitting room* below.
8. **Top banana.** The purchase that unlocks the last remaining costume sets a persistent
   `victory` flag; while it is set, App renders `#victory-overlay`, a centred modal card whose
   message reads exactly:

   > You beat the game! You're the top banana! Thanks for playing our game. -The Masters

   Dismissing it (`#victory-ok-btn`, or Enter/Space/Esc) clears the flag, so it appears once per
   completion — but it keeps appearing on reload until it has actually been dismissed.

## Persistence (unchanged by revision 3)

One key: `localStorage['monkey-dash-shop']`, JSON, version-tagged; corrupt/absent values fall
back to defaults so nothing can crash the app:

```json
{ "v": 1, "wallet": 400, "owned": ["tuxedo"], "purchases": 1, "worn": "tuxedo", "victory": false }
```

| Field | Meaning | Default / validation |
| ----- | ------- | -------------------- |
| `v` | schema version | `1` (unchanged by revision 2 — the new field is additive) |
| `wallet` | spendable banana bucks | `0`; `Number.isFinite`, clamped ≥ 0, floored to integer |
| `owned` | ids unlocked forever | `[]`; unknown ids dropped, duplicates collapsed |
| `purchases` | lifetime purchase count (a stat only — **price no longer depends on it**) | `0`; clamped ≥ 0 integer |
| `worn` | id currently worn (`null` = bare monkey) | `null`; forced to `null` when not in `owned` |
| `victory` | the top-banana modal is **pending** (set on completion, cleared on dismiss) | `false`; survives sanitising only as a literal `true` *and* a complete `owned` set, so no hand-edited celebration |

**Flat price**: `price === COSTUME_PRICE === 100`, always. It is still exposed as `state.price`
(the UI and tests read one place), but it is now a constant rather than a derivation, so old
saves — whose `purchases` used to inflate the price — simply get cheaper costumes, no migration.
Reads are try/catch wrapped; **one atomic `JSON.stringify` write per mutation**. Existing players
only have `monkey-dash-best`, so the new key simply starts at defaults. Revision 3 changes only the
number a *new* purchase is charged for; saved wallets, `owned` sets and `purchases` need no migration.

### Store API (`src/shop/store.js`)
Module-level observable singleton (React subscribes via `useSyncExternalStore`; React 19 ✓):

| Method | Contract |
| ------ | -------- |
| `getState()` | `{ wallet, owned, purchases, worn, victory, price }` — `price === COSTUME_PRICE` |
| `addBananas(n)` | bank n ≥ 0 bananas (called once per run end) |
| `buy(id)` | **no-op returning `false`** unless the id is in the catalogue, not already owned, and `wallet >= COSTUME_PRICE`; otherwise deducts 100, appends to `owned`, increments `purchases`, sets `worn = id`, sets `victory = true` when that purchase completes the set, persists atomically, returns `true` |
| `wear(id)` | free; only if owned (or `null`) |
| `dismissVictory()` | clear the pending top-banana flag and persist (`false` when nothing was pending) |
| `reset()` | wipe storage + state (tests) |
| `subscribe(fn)` | external-store subscription |

Exported constants: `STORAGE_KEY`, `COSTUME_PRICE = 100`, `TOTAL_COSTUMES = COSTUMES.length`. The
old `BASE_PRICE` / `PRICE_STEP` / `priceFor()` are gone — nothing may reintroduce a price that
moves.

**Banking is pinned to the engine's `onGameOver` callback**, which fires exactly once per death
(`crash()` guards on `state === 'playing'`). Banking in a render path or an effect keyed on
`phase === 'over'` / `finalStats` would **re-bank when the player returns from the shop** (the
shop restores phase `'over'` while `finalStats` is still set) — forbidden.

## Files touched

| File | Change |
| ---- | ------ |
| `src/game/banana.js` *(new)* | the collectible banana mesh itself — one lathed/vertex-coloured crescent shared by the pool |
| `src/game/costumes.js` *(new)* | `COSTUMES` catalogue + `buildCostume(id, hosts)` → `{ host, object }[]` |
| `src/shop/store.js` *(new)* | observable store above; exposes `window.__MONKEY_SHOP` |
| `src/shop/CostumeShop.jsx` *(new)* | shop overlay UI |
| `src/shop/VictoryModal.jsx` *(new)* | top-banana modal (`#victory-overlay`, `#victory-message`, `#victory-ok-btn`) |
| `src/game/engine.js` | `'shop'` state, fitting camera + trailhead rewind, costume rig + API, pose/dispose fixes |
| `src/App.jsx` | phase `'shop'`, HUD gating, banking in `onGameOver`, entry buttons, apply worn at boot, victory modal + key handling |
| `src/styles.css` | shop panel/grid/tile styles, victory modal |
| `tests/costume-shop.spec.js` *(new)* | Playwright coverage + per-costume screenshots |
| `docs/architecture.md`, `README.md` | keep in sync with the new state/phase/hook/test surface |

## Engine changes

### Costume rig
The monkey's four materials are shared between parts, so outfits never recolour them: each
costume builds **its own** meshes/materials and is attached to whichever hosts it needs from
`{ body, head, armL, armR, legL, legR }`. Equipping toggles `visible` on those groups only;
costumes are built lazily on first use and cached for the session.

**Authoring conventions (must be followed):**
- Offsets/sizes are authored in **pre-scale monkey-local units** — `group.scale = 0.85` applies
  uniformly to descendants. Landmarks: torso centre `y = 1.05`, head origin `y = 1.72` with skull
  radius `0.34`, shoulder pivots `(±0.36, 1.35)`, hip pivots `(±0.17, 0.72)`.
- Every costume mesh sets `castShadow = true` (`buildMonkey()` only flags base meshes).
- Props must **not** be parented to limb pivots: those rotations are rewritten every frame while
  playing and lerped to `-2.4` in the menu idle pose, so a held umbrella would flail. The rainsuit's
  umbrella is therefore attached to `body`, closed and tilted up behind the right shoulder.
- `dispose()` disposes cached costume geometries/materials (the engine currently only disposes chunks).

| Costume | Meshes added | Hosts |
| ------- | ------------ | ----- |
| `tuxedo` | black jacket shell + white shirt front + bow tie; black arm sleeves + trouser leg sleeves (own meshes over the limbs) | body, armL/R, legL/R |
| `clown` | pink onesie shell with dot spheres, magenta ruffle collar; red nose; baggy shoe boxes | body, head, legL/R |
| `doctor` | white coat shell + sleeves, stethoscope (neck torus, tube, chest disc), red-cross armband, head-mirror cap | body, armL/R, head |
| `tophat` | crown cylinder + brim disc + band | head |
| `dog` | floppy ears, darker snout patch, red collar with gold tag | head, body |
| `bunny` | two long ears + pink inner ears, buck tooth; cotton tail | head, body |
| `cat` | cone ears, whisker cylinders; collar bell | head, body |
| `butterfly` | four translucent wing panels on the back (kept near-vertical: a flat horizontal wing is an invisible sliver at chest-height camera), antennae with ball tips | body, head |
| `rainsuit` | yellow coat shell + sleeves + hood cap and brim, wellies; closed umbrella over the shoulder | body, armL/R, legL/R |

### `'shop'` is a real fifth engine state
`this.state`: `menu | playing | crashed | over | shop`. Both dispatch chains in `loop()` end in
an unguarded `else` that means "over", so **both** gain explicit branches — otherwise the
over-unwind code silently fights the fitting pose:

- speed chain → add `shop` (world does not advance) and make the last branch an explicit
  `this.state === 'over'`; update the state comment in the constructor.
- per-state body chain → explicit `'shop'` branch driving **head, tail and all four limbs** each
  frame (a happy idle pose with a slow turn), because stale run/crash poses otherwise leak:
  `reset()` never restores `head.rotation`/`tail.rotation`, and limbs keep their last values once
  the playing branch stops. Fix `reset()` to zero head/tail rotations as well.

The **follow-camera block runs unconditionally today** (position lerp, `_camUp` lerp, `camera.up`,
`lookAt`) and would overwrite any fitting pose in the same frame — so it is gated behind
`state !== 'shop'`, and `'shop'` computes its own close-up three-quarter view using **dedicated
scratch vectors** (`_P/_T/_U/_Rv/_tmp` are clobbered by the sun/valley code earlier in the loop).
The fitting camera sits ahead along the path tangent (he faces `+tangent`), offset laterally and
aimed low. **Because it looks back along the path, screen-right is negative lateral** — aiming
"left of him" in path terms parks him behind the shop panel; the first cut did exactly that.

### Fitting room: rewind to the trailhead (revision 2)

The crash site is a bad fitting room — boulders, cliff slabs and disposed ground chunks sit right
where the camera wants to be. So `enterShop()` rebuilds the world at the start of the trail before
it poses the monkey:

- `reset()`'s world bookkeeping moves into **`rebuildWorld()`**: a fresh `TrackPath`, `s = 0`,
  `x = 0`, lane 1, every pooled boulder/banana deactivated, cliffs removed+disposed, ground chunks
  dropped and regenerated around the new path, scenery re-seeded, world transforms synced. It
  touches **no** run stats (`distance`, `bananaCount`, timers) so it is safe to call mid-shop.
- Why a *fresh* path rather than just `this.s = 0`: `loop()` prunes samples behind the player
  (`path.prune(this.s - 80)` → `baseIndex` advances) and `ensureChunks()` disposes chunks behind the
  player. Rewinding into a pruned path would sample *behind* the oldest surviving segment, which
  `sampleTo` answers by extrapolating straight back from it — i.e. broken ground, not the original
  trailhead. A new `TrackPath` is exactly "the start of the game".
- `enterShop()` therefore: refuse while `playing` → `rebuildWorld()` → snap the monkey upright,
  `py = groundHeightAt(0, 0)`, `vy = 0`, `grounded = true`, `shopT = 0`, `state = 'shop'`. It does
  this from **every** entry point (menu included — the menu auto-runs, so `s` is not 0 there).
- `reset()` keeps its own behaviour: state/distance/bananaCount/speed/spawn/cliff timers are reset,
  then it calls `rebuildWorld()`, snaps the monkey upright and re-snaps the camera behind the start
  (extracted as `snapCameraToStart()` so both paths use one implementation).
- The fitting camera **snaps** into place on entry (`snapShopCamera()` copies the framing target
  into `camera.position`, `_camUp` and `lookAt`) instead of lerping from wherever it was — after a
  crash that would mean flying ~800 m through the level. `updateShopCamera(dt)` keeps smoothing
  every frame afterwards, which is now a no-op at the target.
- `exitShop({ toMenu })` is unchanged by revision 2 — `toMenu: true` → `reset(true)` (menu
  auto-run); otherwise `state = 'over'`, upright and frozen **at the trailhead**. Entering from
  `'crashed'` simply cancels the tumble timer, and `RUN AGAIN` still calls `start()` →
  `reset(false)` → a brand-new path.
- `setCostume(id)` / `getCostume()` — equip/preview; `null` = bare monkey. The idle turn
  **oscillates** (`sin(t * 0.35) * 0.5`) rather than spinning continuously, so the preview always
  faces roughly toward the camera instead of showing his back half the time.

## React integration

- `phase` gains `'shop'`. The global `Enter`/`Space` start/restart handler **skips** `'shop'`, and
  `Esc` closes the shop (otherwise there is no keyboard exit).
- **The victory modal outranks everything.** App renders `<VictoryModal/>` whenever
  `shop.victory` is set — over whatever phase is underneath (`z-index` above the shop panel). The
  keydown handler checks it *first*: Enter/Space/Esc dismiss the celebration and are never passed
  through to start/restart/close-shop, so a pending modal cannot be skipped by hammering Space.
- HUD gating becomes explicit: render only for `playing` / `over`. Today's `phase !== 'menu'` would
  paint SCORE/BANANAS chips over a shop opened from the menu.
- `#restart-btn` keeps `autoFocus` so existing keyboard muscle memory survives; the shop buttons are
  reachable by click/Tab only.
- On boot, App applies the stored `worn` costume to the engine (and on store changes while not playing).

## Shop UI contract

Left-hand panel (`#shop-overlay`, `.card-shop`) rather than a bottom sheet, so the fitting camera
can frame the monkey in the clear space on the right. It is sized to fit the fixed 1280×720 test
viewport **without scrolling**: `html/body/#root` are `overflow: hidden`, and Playwright's implicit
scroll-into-view silently clips cards below the fold (the grid keeps `overflow-y: auto` as a
fallback for smaller screens). Header shows banana bucks (`#shop-wallet`) and the flat price
(`#shop-price`, labelled *Each costume* — it never changes again).

A 3-column grid holds the nine `.costume-card`s (`[data-costume="<id>"]`, plus `.owned` when
unlocked) — **nine, never more**: the way back to no outfit is `#shop-bare-btn` in the header, not a
tenth card. Per card: icon, name, `.owned-badge` (unlocked), `.worn-badge` (currently worn),
`.costume-price` — **rendered only on locked cards**, so price assertions never meet a stale label —
an ability line (`.costume-ability` + `.costume-text`, see [abilities.md](./abilities.md)), and a
`.card-actions` row with one `.try-btn` ("TRY ON", "TRYING" while previewed) plus exactly one
state button: unowned `.buy-btn` ("BUY & WEAR", `disabled` while the wallet cannot pay), owned
`.wear-btn` ("WEAR", or "WORN" and disabled for the worn id). Footer: `#shop-back-btn` and a hint
that try-on is free.

Since abilities are data on the costume, `setCostume(id)` — which try-on already calls — also swaps
the outfit's gameplay numbers, so previewing an outfit previews how it *handles*. Nothing else in
the shop changes: prices stay flat, unlocks stay forever, and leaving still drops unpaid previews.

## Tests (`tests/costume-shop.spec.js`)

Playwright gives each test a fresh context, so **localStorage does not survive between tests**: every
test seeds its own wallet through `window.__MONKEY_SHOP`, and persistence is asserted inside one test
across `reload()`. Engine hooks are engine-side only — overlays render from React `phase`, so UI
assertions must go through real clicks (`#menu-shop-btn` etc.).

| Test | Asserts |
| ---- | ------- |
| death banks bananas and offers the shop | bananas collected with `testSpawnBananaAtPlayer()` *before* the crash (a boulder spawned 1.5 s into a run would bank 0) appear as `+N` on the card and in the wallet; **entering the shop rewinds the engine to `s = 0`** while the game-over stats survive; leaving the shop does **not** re-bank |
| shop opens from game over | `#go-shop-btn` → `#shop-overlay`, nine cards, header price = `COSTUME_PRICE`, every locked card priced the same |
| trying on is free and reversible | `TRY ON tuxedo` changes `getCostume()` while wallet/owned/purchases/worn stay untouched; leaving drops the preview |
| buying unlocks forever at a flat price | buy → wallet −100, card shows OWNED + WORN, worn card's WEAR is disabled; **every other card still costs the same** and `state.price` stays at
`COSTUME_PRICE` after two purchases; wearing an owned outfit is free; re-buying an owned id returns `false` without charging |
| the last costume triggers the top-banana modal | seed `PRICE × 9`, buy eight ids through the store hook (no modal yet, `victory` false), click the ninth card's `BUY & WEAR` → `#victory-overlay` visible and `#victory-message` reads the exact message; dismiss clears it and it never comes back in-session |
| the celebration survives a reload until dismissed | seed storage with `victory: true`, reload → modal shown over the menu, Space dismisses it without starting a run, reload again → still gone |
| you cannot spend bananas you do not have | nine `.buy-btn`s, disabled on an empty wallet (`toBeDisabled`, never clicked); `buy()` returns `false` and changes nothing; 49 bananas buys nothing |
| persistence across reload | wallet/owned/purchases/worn restored from storage; the saved outfit is worn at boot |
| corrupt storage falls back to defaults | unparsable JSON normalises; negative numbers, unknown ids, an unowned `worn`, a hand-edited `price` and a non-boolean `victory` are all ignored; an owned `worn` is applied at boot |
| he is framed at the start of a run and after leaving the shop | project the monkey into camera NDC space: he must be in front of the lens and inside the frame both right after `START RUNNING` (no path samples behind index 0) and ~2.5 s after backing out of the fitting room |
| shop never restarts a run | Space in the shop changes neither React phase nor engine state; Esc closes it |
| bananas are bananas, not macaroni | `bananaGeo` carries a vertex-colour attribute, is > 0.7 m long, and at least 2.5× longer than its widest cross-section (the old torus arc fails all three) |
| every outfit renders (one test per id) | click that card's `TRY ON`, assert `getCostume()`, let the fitting camera settle, screenshot `tests/screenshots/12-costume-<id>.png`, no page errors |

Existing tests must keep passing; the game-over card keeps `#restart-btn` and its behaviour.

## Balance note (revision 3)

Nine costumes × **100** = **900 bananas for the whole set**, and the price never moves, so the number
of runs to "beat the game" is fixed: a good run banks single digits to low tens, i.e. roughly forty
to ninety runs for every outfit plus the modal — double what revision 2 asked for. Tests never
depend on grinding: they seed the wallet through `__MONKEY_SHOP`, and the suite reads
`COSTUME_PRICE` from `src/shop/store.js` rather than restating it, so a price change cannot leave a
stale expectation behind.

## Implementation notes (what differed from the design)

- **Panel side, not bottom sheet.** The fitting camera frames the monkey beside a left-hand panel.
- **No new engine test hooks.** `enterShop`/`exitShop` are app APIs; tests drive the UI with clicks,
  because overlays render from React `phase` and an engine-only call would move the camera behind a
  closed shop. `getCostume()` is the only accessor tests need.
- **Price label only on locked cards**, so "every costume costs N" assertions don't hit a worn card.
- **Revision 2 keeps `purchases`** even though nothing derives from it any more — dropping it would
  have made old saves and the corrupt-storage tests harder to reason about for no gain.
- **The banana got its own module** (`src/game/banana.js`) rather than a geometry literal in
  `engine.js`, and spins about its long axis so the crescent keeps facing the camera. Shape,
  colours and spin live there; see [architecture.md](./architecture.md).
- The regression test in `tests/game.spec.js` caught a genuine ghosting bug: the landing snap raised
  him onto the top of a cliff *before* the face-crossing crash check read his height, so a late jump
  could pass through the slab. Contact is now decided from `pyStart` (height at frame start) — see
  the contact rules in [architecture.md](./architecture.md).

## Review checklist (before implementing)

- Store survives reload *and* corrupt values; `buy()` cannot double-charge, and nothing can make a
  price depend on history.
- The victory flag is set exactly once (on the completing purchase) and cleared only by dismissal,
  so reloading with it pending re-shows the modal instead of losing the celebration.
- `'shop'` has explicit branches in **both** loop dispatch chains and owns its camera block; the
  trailhead rewind must not leave a pruned path or stale chunks behind (fresh `TrackPath`).
- HUD never renders over the shop; Enter/Space do not restart from the shop; Esc exits; the pending
  victory modal swallows those keys.
- No costume touches a shared monkey material, sets no prop on a limb pivot, and every mesh casts shadows.
