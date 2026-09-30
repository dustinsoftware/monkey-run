# Design — Costume Shop

**Status:** approved design, not implemented yet.
**Scope:** spend banked bananas on permanent monkey outfits; try outfits on before buying.

## Player-facing behaviour

1. Bananas collected during a run are **banked into a persistent wallet** when the run ends
   (the per-run count in the HUD stays as it is today).
2. Every death offers the shop: the game-over card gains a primary
   `🛍️ COSTUME SHOP` button next to `RUN AGAIN`. The menu also gets a `COSTUME SHOP`
   button so outfits can be browsed without dying. (Offered, never forced — a player who
   wants to restart instantly must not have to click through a shop.)
3. The shop lists **9 costumes**, all priced identically at the current universal price:

   | id | costume | icon |
   | -- | ------- | ---- |
   | `tuxedo` | Tuxedo | 🎩 |
   | `clown` | Clown | 🤡 |
   | `doctor` | Doctor | 🩺 |
   | `tophat` | Top Hat | 🎩 |
   | `dog` | Dog | 🐶 |
   | `bunny` | Bunny | 🐰 |
   | `cat` | Cat | 🐱 |
   | `butterfly` | Butterfly | 🦋 |
   | `rainsuit` | Yellow Rainsuit + Umbrella | ☔ |

4. **Economy.** First costume costs **1000** bananas. Every successful purchase raises the
   price of *every* costume by **+200** (so the second purchase is 1200, third 1400, …).
   A purchase deducts the current price from the wallet and unlocks the costume **forever**.
5. **Try before buying.** `TRY ON` previews any costume on the monkey in a close-up fitting
   view — free, no state change, reverted when you leave the shop unless you buy it.
6. Owned costumes can be worn for free (`WEAR`, shown as `WORN`); the worn choice persists
   across reloads and is what the monkey wears while running.

## Persistence

Single key: `localStorage['monkey-dash-shop']`, JSON, version-tagged so a bad/old value can
never crash the app:

```json
{ "v": 1, "wallet": 4000, "owned": ["tuxedo"], "price": 1200, "worn": "tuxedo" }
```

| Field | Meaning | Default when absent/invalid |
| ----- | ------- | --------------------------- |
| `v` | schema version | `1` |
| `wallet` | banked bananas (banana bucks) available to spend | `0` |
| `owned` | ids unlocked forever | `[]` |
| `price` | current universal price; starts at 1000, +200 per purchase | `1000` |
| `worn` | id currently worn, or `null` for the bare monkey | `null` |

Backwards compatibility: existing players only have `monkey-dash-best`; the new key simply
starts from defaults. Reads are wrapped in try/catch and validated (unknown ids dropped,
numbers coerced with `Number.isFinite`, clamped to ≥ 0). Writes happen on every mutation.

## Files touched

| File | Change |
| ---- | ------ |
| `src/game/costumes.js` *(new)* | `COSTUMES` catalogue (id/label/icon) and `buildCostume(id, parts)` returning `{ host, object }[]` part groups for the monkey rig |
| `src/shop/store.js` *(new)* | observable shop store: load/save, `addBananas`, `buy`, `wear`, `reset`, `subscribe`; exposes `window.__MONKEY_SHOP` |
| `src/shop/CostumeShop.jsx` *(new)* | shop overlay (`#shop-overlay`): wallet header, 9 `.costume-card`s, back button |
| `src/game/engine.js` | new `'shop'` state + fitting-room camera, `setCostume/getCostume/enterShop/exitShop`, costume part groups, test hooks |
| `src/App.jsx` | phase `'shop'`, bank bananas on game over, shop entry buttons, apply worn costume at boot |
| `src/styles.css` | shop card/grid/button styles |
| `tests/costume-shop.spec.js` *(new)* | Playwright coverage + per-costume screenshots |

## Engine changes

### Costume rig
The monkey's four materials are shared between parts (see architecture doc), so outfits never
recolour them — each costume builds **its own** meshes and materials and is attached to the
rig hosts it needs: `body`, `head`, `armL`, `armR`, `legL`, `legR`. A costume is therefore a
list of `{ host, object }` groups; equipping toggles `visible` on those groups only. Costumes
are built lazily on first use and cached for the session.

| Costume | Meshes added (all primitives) |
| ------- | ----------------------------- |
| `tuxedo` | black jacket shell + white shirt front + bow tie (body); black arm/leg sleeves |
| `clown` | pink onesie shell with dot spheres, magenta ruffle collar (body); red nose (head); shoe boxes (legs) |
| `doctor` | white coat shell + sleeves, stethoscope (neck torus, tubes, chest disc), red-cross armband; head mirror cap (head) |
| `tophat` | crown cylinder + brim disc + band (head) |
| `dog` | floppy ears + darker snout patch + red collar with gold tag (head/body) |
| `bunny` | two long ears + pink inner ears, white cotton tail (body), buck tooth (head) |
| `cat` | cone ears + whisker cylinders + collar bell (head/body) |
| `butterfly` | four translucent wing panels (body back); two antennae with ball tips (head) |
| `rainsuit` | yellow coat shell + sleeves + hood cap and brim, yellow boots (legs); umbrella = shaft cylinder + canopy cone held from the right arm pivot |

### `'shop'` state
`this.state` gains a fifth value: `menu | playing | crashed | over | shop`.

- `enterShop()` — snaps the monkey upright (`body.rotation` zeroed, `py` to surface height),
  sets `state = 'shop'`, resets the fitting-view timer.
- `loop()` `'shop'` branch — world does not advance; the monkey holds a happy idle pose and
  turns slowly so the outfit is seen from all sides; the camera lerps to a close-up three-quarter
  view in front of the monkey (ahead along the path tangent, offset laterally, aimed at chest height).
- `exitShop({ toMenu })` — `toMenu: true` → `reset(true)` (menu auto-run); otherwise the engine
  returns to `'over'` upright and frozen. React drives this from where the shop was opened.

React's `phase` gains `'shop'`. The global `Enter`/`Space` start/restart handler must **skip**
the shop phase, otherwise pressing Space while browsing would restart the run.

### Shop test hooks (`window.__MONKEY_SHOP`)
The store is a module-level observable singleton so tests can seed it without clicking and the
UI re-renders automatically: `getState()`, `addBananas(n)`, `buy(id)`, `wear(id)`, `reset()`,
`subscribe(fn)`.

### Engine test hooks (new)
| Hook | Purpose |
| ---- | ------- |
| `testSetCostume(id)` | equip a costume immediately (used for screenshots/preview assertions) |
| `testEnterShop()` / `testExitShop(toMenu)` | drive the fitting view without UI clicks |

## Shop UI contract

- Overlay id `#shop-overlay`, card `.card-shop`; header shows `BANANA BUCKS` (`#shop-wallet`)
  and the current price (`#shop-price`).
- One `.costume-card` per catalogue entry, in catalogue order, each with `[data-costume="<id>"]`,
  a name, an owned/locked badge, and exactly one action button:
  `TRY ON` (`.try-btn`), plus `BUY & WEAR` (`.buy-btn`, `disabled` while the wallet cannot pay)
  and `WEAR` / `WORN` for owned costumes.
- Footer buttons: `#shop-back-btn` (leave), and a hint line explaining try-on is free.
- Leaving the shop reverts any unpaid preview to the worn costume.

## Tests to add (`tests/costume-shop.spec.js`)

1. **death offers the shop** — boulder crash → game-over card shows `+N 🍌 banked`; clicking
   `#go-shop-btn` opens `#shop-overlay` with 9 cards, each priced 1000.
2. **try-on is free and reversible** — with an empty wallet, `TRY ON tuxedo` changes
   `__MONKEY_GAME.getCostume()` but leaves `owned`/`wallet` untouched; leaving the shop reverts it.
3. **buy + inflation** — seed 5000 bananas via `__MONKEY_SHOP.addBananas`; buying `tuxedo`
   costs 1000 (wallet 4000, owned forever) and every card then reads 1200; a second purchase
   costs 1200 and pushes the price to 1400.
4. **cannot overspend** — `BUY & WEAR` is disabled while the wallet is short.
5. **persistence** — after `reload()`, wallet/owned/price/worn are restored and the engine boots
   already wearing the saved costume.
6. **menu entry / back** — shop opens from the menu and `#shop-back-btn` returns to the menu overlay.
7. **every outfit renders** — for each of the 9 ids: enter shop, try on, let frames render, assert
   no page errors, screenshot `tests/screenshots/10-costume-<id>.png`.

Existing tests must keep passing; the game-over card keeps `#restart-btn` and its behaviour.

## Review checklist (before implementing)

- Does the store survive a reload *and* a corrupt value?
- Are all four engine states still reachable after adding `'shop'` (`menu → playing → crashed → over`, plus shop in/out)?
- Do the existing Playwright tests still find their buttons, and does Space-in-shop avoid restarting?
- Does any costume touch a shared monkey material? (It must not.)
