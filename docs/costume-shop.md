# Design — Costume Shop

**Status:** reviewed design (reviewer run `e62342aa`), ready for implementation.
**Scope:** spend bananas banked from runs on permanent monkey outfits, with try-on preview.
Base price 1000, +200 inflation after every purchase.

## Player-facing behaviour

1. Bananas collected during a run are **banked into a persistent wallet** when the run ends.
   The per-run banana count in the HUD is unchanged.
2. Every death offers the shop: the game-over card gains `🛍️ COSTUME SHOP` (`#go-shop-btn`)
   next to `RUN AGAIN`. The menu gets `COSTUME SHOP` (`#menu-shop-btn`) so outfits can be
   browsed without dying. Offered, never forced — restarting must stay one click/keypress away.
3. The shop lists **9 costumes**, all priced identically at the current universal price:

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

4. **Economy.** First costume costs **1000** bananas; every successful purchase raises the
   price of *every* costume by **+200** (second = 1200, third = 1400, …). A purchase deducts
   the current price from the wallet and unlocks the costume **forever**.
5. **Try before buying.** `TRY ON` previews any costume on the monkey in a close-up fitting
   view — free, changes nothing else, reverted when you leave unless you bought it.
6. Owned costumes wear for free (`WEAR`, shown `WORN`). The worn choice persists across reloads
   and is what the monkey wears while running.

## Persistence

One key: `localStorage['monkey-dash-shop']`, JSON, version-tagged; corrupt/absent values fall
back to defaults so nothing can crash the app:

```json
{ "v": 1, "wallet": 4000, "owned": ["tuxedo"], "purchases": 1, "worn": "tuxedo" }
```

| Field | Meaning | Default / validation |
| ----- | ------- | -------------------- |
| `v` | schema version | `1` |
| `wallet` | spendable banana bucks | `0`; `Number.isFinite`, clamped ≥ 0, floored to integer |
| `owned` | ids unlocked forever | `[]`; unknown ids dropped, duplicates collapsed |
| `purchases` | number of purchases ever made — **price is derived**, never stored | `0`; clamped ≥ 0 integer |
| `worn` | id currently worn (`null` = bare monkey) | `null`; forced to `null` when not in `owned` |

**Derived price**: `price(purchases) = 1000 + 200 * purchases`. Storing a raw price would let
it disagree with history after any partial write, so it is computed from `purchases` only.
Reads are try/catch wrapped; **one atomic `JSON.stringify` write per mutation**. Existing players
only have `monkey-dash-best`, so the new key simply starts at defaults.

### Store API (`src/shop/store.js`)
Module-level observable singleton (React subscribes via `useSyncExternalStore`; React 19 ✓):

| Method | Contract |
| ------ | -------- |
| `getState()` | `{ wallet, owned, purchases, worn, price }` — `price` derived |
| `addBananas(n)` | bank n ≥ 0 bananas (called once per run end) |
| `buy(id)` | **no-op returning `false`** unless the id is in the catalogue, not already owned, and `wallet >= price`; otherwise deducts price, appends to `owned`, increments `purchases`, sets `worn = id`, persists atomically, returns `true` |
| `wear(id)` | free; only if owned (or `null`) |
| `reset()` | wipe storage + state (tests) |
| `subscribe(fn)` | external-store subscription |

**Banking is pinned to the engine's `onGameOver` callback**, which fires exactly once per death
(`crash()` guards on `state === 'playing'`). Banking in a render path or an effect keyed on
`phase === 'over'` / `finalStats` would **re-bank when the player returns from the shop** (the
shop restores phase `'over'` while `finalStats` is still set) — forbidden.

## Files touched

| File | Change |
| ---- | ------ |
| `src/game/costumes.js` *(new)* | `COSTUMES` catalogue + `buildCostume(id, hosts)` → `{ host, object }[]` |
| `src/shop/store.js` *(new)* | observable store above; exposes `window.__MONKEY_SHOP` |
| `src/shop/CostumeShop.jsx` *(new)* | shop overlay UI |
| `src/game/engine.js` | `'shop'` state, fitting camera, costume rig + API, test hooks, pose/dispose fixes |
| `src/App.jsx` | phase `'shop'`, HUD gating, banking in `onGameOver`, entry buttons, apply worn at boot |
| `src/styles.css` | shop panel/grid/tile styles |
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
| `doctor` | white coat shell + sleeves, stethoscope (neck torus, tubes, chest disc), red-cross armband, head-mirror cap | body, armL, head |
| `tophat` | crown cylinder + brim disc + band | head |
| `dog` | floppy ears, darker snout patch, red collar with gold tag | head, body |
| `bunny` | two long ears + pink inner ears, buck tooth; cotton tail | head, body |
| `cat` | cone ears, whisker cylinders; collar bell | head, body |
| `butterfly` | four translucent wing panels (back) | body |
| `rainsuit` | yellow coat shell + sleeves + hood cap and brim, yellow boots; closed umbrella over the shoulder | body, legL/R |

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
The fitting camera sits ahead along the path tangent, offset laterally, aimed at chest height with
a downward bias so the monkey lands in the upper half of the frame (the shop panel is a bottom sheet).

- `enterShop()` — **ignored while `state === 'playing'`** (otherwise a hook call would freeze a run
  with no overlay to escape from); snaps the monkey upright (`body.rotation`, `body.position.y`,
  head/tail/limb rotations zeroed, `py` to surface height), sets `state = 'shop'`.
- `exitShop({ toMenu })` — `toMenu: true` → `reset(true)` (menu auto-run); otherwise `state = 'over'`
  upright and frozen. Entering from `'crashed'` simply cancels the tumble timer.
- `setCostume(id)` / `getCostume()` — equip/preview; `null` = bare monkey.

## React integration

- `phase` gains `'shop'`. The global `Enter`/`Space` start/restart handler **skips** `'shop'`, and
  `Esc` closes the shop (otherwise there is no keyboard exit).
- HUD gating becomes explicit: render only for `playing` / `over`. Today's `phase !== 'menu'` would
  paint SCORE/BANANAS chips over a shop opened from the menu.
- `#restart-btn` keeps `autoFocus` so existing keyboard muscle memory survives; the shop buttons are
  reachable by click/Tab only.
- On boot, App applies the stored `worn` costume to the engine (and on store changes while not playing).

## Shop UI contract

Bottom-sheet panel (`#shop-overlay`, `.card-shop`) sized to fit the fixed 1280×720 test viewport —
`html/body/#root` are `overflow: hidden`, so anything past the fold is unclickable. Header shows
`BANANA BUCKS` (`#shop-wallet`) and the current price (`#shop-price`); a compact 3-column grid of
9 `.costume-card`s (each `[data-costume="<id>"]`) inside a region capped by `max-height` with its own
scroll; footer has `#shop-back-btn` plus a hint that try-on is free.

Per card, exactly: name, `.costume-price`, optional `.owned-badge`, one `.try-btn` ("TRY ON"), and
one state button — unowned: `.buy-btn` ("BUY & WEAR", `disabled` while the wallet cannot pay);
owned: `.wear-btn` ("WEAR", or "WORN" and disabled for the currently worn id).

## Tests (`tests/costume-shop.spec.js`)

Playwright gives each test a fresh context, so **localStorage does not survive between tests**: every
test seeds its own wallet through `window.__MONKEY_SHOP`, and persistence is asserted inside one test
across `reload()`. Engine hooks are engine-side only — overlays render from React `phase`, so UI
assertions must go through real clicks (`#menu-shop-btn` etc.).

1. **death offers the shop** — collect a banana deterministically with
   `testSpawnBananaAtPlayer()` *before* the crash (a boulder spawned 1.5 s into a run would bank 0),
   then crash; assert the card reports the banked count and `__MONKEY_SHOP.getState().wallet` grew by it.
2. **shop opens from game over** — click `#go-shop-btn`; `#shop-overlay` shows, `.costume-card` count is 9, every `.costume-price` reads 1000.
3. **try-on is free and reversible** — empty wallet; click `TRY ON` on `tuxedo`; assert
   `__MONKEY_GAME.getCostume() === 'tuxedo'` while store `owned`/`wallet` are untouched; leave the shop and assert it reverted.
4. **buy + inflation** — seed 5000 bananas; buy `tuxedo` (wallet 4000, owned forever), every card then reads 1200; a second purchase costs 1200 and pushes prices to 1400.
5. **cannot overspend** — with an empty wallet `.buy-btn` is `toBeDisabled()` (never click it).
6. **persistence** — after `reload()`, wallet/owned/purchases/worn are restored and the engine boots already wearing the saved costume.
7. **menu entry / back** — shop opens from the menu, `#shop-back-btn` returns to `#menu-overlay`.
8. **every outfit renders** — one test per id (`test.step` or separate tests; a 90 s timeout will not
   host nine WebGL previews plus screenshots): enter via `#menu-shop-btn`, click that card's `TRY ON`,
   let frames render, assert no page errors, screenshot `tests/screenshots/10-costume-<id>.png`.

Existing tests must keep passing; the game-over card keeps `#restart-btn` and its behaviour.

## Balance note (accepted for now)

Nine costumes at 1000 → 2600 sum to **16,200 bananas**, while a run typically banks single digits to
low tens — the first outfit is worth of tens of runs. That matches the requested economy; if playtest
says it is too grindy, the knobs are the base price, the +200 step, or bonus income (e.g. cliff-trail
multipliers). Tests never depend on grinding: they seed the wallet through `__MONKEY_SHOP`.

## Review checklist (before implementing)

- Store survives reload *and* corrupt values; `buy()` cannot double-charge or double-inflate.
- `'shop'` has explicit branches in **both** loop dispatch chains and owns its camera block.
- HUD never renders over the shop; Enter/Space do not restart from the shop; Esc exits.
- No costume touches a shared monkey material, sets no prop on a limb pivot, and every mesh casts shadows.
