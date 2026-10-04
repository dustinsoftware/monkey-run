# Design — Themed Levels

Every run walks a ladder of themed worlds. Survive **60 seconds** on one theme and
you beat that level; the world changes around you and the next theme starts. A fresh
run always begins on a **random** theme, so no two runs open the same way.

This is a cosmetic + pacing layer only: **no level changes physics.** Gravity, jump
velocity, cliff height and lane geometry are global constants (see
[architecture.md](./architecture.md)) because the deterministic test suite drives jumps
by distance/speed maths. Any future physics-per-level idea must be gated behind that rule.

## Player-facing behaviour

* The menu always sits in **Forest Trail** (`forest`) — screenshots and the fitting room
  need one stable world.
* Pressing start rolls a random level index over `LEVELS` and applies it before the first
  frame of the run.
* The HUD shows a `#hud-level` chip: upper-cased theme label plus whole seconds left on this
  level (`SUNNY BEACH · 52`). It counts down while playing, freezes otherwise.
* When the minute is up:
  * the next theme in the ladder becomes current (wrapping past the last entry starts a
    new **lap**),
  * `#level-banner` appears over the game for ~2.6 s with the icon + label of the level you
    just cleared and the one you are entering,
  * the level-clear chime plays once ([abilities/audio note in architecture.md](./architecture.md)),
  * score gains `LEVEL_BONUS = 250` per cleared level (see Score below).
* Dying ends the run; levels cleared this run are reported on the game-over card
  (`#final-levels`) and reset to 0 on the next run.
* After a full circuit of the ladder, `lap` increments and obstacle spacing tightens by
  ~12% per lap (see *Pacing*).

## The ladder (`src/game/levels.js`)

Order is the progression order; index 0 is not "easier", they are just neighbours.

| # | id | Label | Icon | Look |
| - | -- | ----- | ---- | ---- |
| 1 | `forest` | Forest Trail | 🌲 | current game: green valley, pines + rocks |
| 2 | `plains` | Green Plains | 🌾 | wide bright grass, few trees |
| 3 | `neighborhood` | Neighborhood | 🏡 | hedges, streetlamps, picket-colour road |
| 4 | `city` | Downtown City | 🏙️ | grey asphalt, towers + lamps |
| 5 | `mall` | Shopping Mall | 🛍️ | polished tile road, pale walls |
| 6 | `desert` | Hot Desert | 🌵 | sand ribbon, cacti + rocks |
| 7 | `pyramid` | Lost Pyramid | 🔺 | stone road, cacti/rocks, ochre haze |
| 8 | `cave` | Crystal Cave | 💎 | dark, very short fog, crystals |
| 9 | `beach` | Sunny Beach | 🏖️ | pale sand, palms |
| 10 | `underwater` | Coral Depths | 🐠 | dense teal fog, kelp + coral rocks |
| 11 | `lava` | Lava Tubes | 🌋 | black rock, glowing lava shoulders |
| 12 | `moon` | The Moon | 🌕 | black sky, grey dust, crystals |
| 13 | `rainbow` | Rainbow Sky | 🌈 | rainbow-striped road, clouds, no valley floor colour |
| 14 | `sci-fi` | Neo Circuit | 🛸 | neon bands on a dark deck, glowing towers |

Each entry is data only:

```js
{
  id: 'beach', label: 'Sunny Beach', icon: '🏖️',
  sky: 0x9fd8ff, fog: [40, 150],          // THREE.Fog near/far in metres
  sun: { color: 0xfff6dd, intensity: 2.6 },
  hemi: { sky: 0xdff2ff, ground: 0xbfa87a, intensity: 1.2 },
  floor: 0xe6cf9a,                        // basePlane (valley floor) colour
  bands: { road: 0xead8ac, curb: 0xd8c493, grass: 0xf0e0b6, deep: 0xd7c191 },
  slab: 0xbfa87a,                         // cliff/wall body colour for this theme
  scenery: [['palm', 5], ['rock', 2]],    // weighted kinds
}
```

Three optional keys specialise a theme:

* `rainbow: true` (`rainbow` only) — the road band is vertex-coloured by arc length, so the
  ribbon cycles hue along the trail instead of being one flat colour.
* `sink: false` (`moon`, `underwater`) — those worlds have no embankment to bury a palm in, so
  their props are dealt into the *flat shoulder* (lateral `6.4…9.4 m`, where the profile drop is
  still under a metre) instead of the wide slope at `7.5…28 m`. They read as planted rather than
  as trees hovering over a cliff edge.
* `props: { leaf, trunk, glow }` — prop colours for that world. Every scenery kind reads its
  palette from here (`glow` drives emissive windows, lamps and crystals; absent means unlit), so
  one builder serves city block, mall unit and sci-fi spire without a single per-kind hex.

### Scenery kinds (engine)

`buildScenery(kind, theme)` builds one pooled prop from primitives and returns it with
`userData.sceneryScale`. Kinds: `pine`, `palm`, `cactus`, `rock`, `tower`, `lamp`,
`crystal`, `kelp`, `cloud`. Materials are allocated per prop (scenery has always done this —
only the monkey shares materials), and every kind reads its colours from the theme so one
builder serves several worlds (`tower` is a city block, a mall unit and a sci-fi spire).

The pool stays at **34 props**; changing levels re-seeds it rather than growing it.

## Files touched

| File | Change |
| ---- | ------ |
| `src/game/levels.js` | new: the `LEVELS` table, `LEVEL_SECONDS`, `MENU_LEVEL_ID`, palette helpers (`themeFor`, `levelAt`) |
| `src/game/engine.js` | level state + `applyLevel()`, chunk/scenery re-colouring, HUD/stats fields, test hooks |
| `src/App.jsx` | `#hud-level` chip, `#level-banner`, game-over levels stat, random start (engine-side) |
| `src/styles.css` | `.hud-level`, `#level-banner` (+`.entering`), banner animation |
| `tests/levels.spec.js` | new suite + one screenshot per theme |

## Engine state

```js
this.levelIndex      // index into LEVELS, current theme
this.levelsCleared   // levels beaten this run (0 at reset)
this.levelTimer      // seconds survived on the current level
this.lap             // full circuits of the ladder completed this run
```

* `reset(true)` (menu / leaving the shop to the menu): `levelIndex = MENU_LEVEL_ID`,
  `levelsCleared = 0`, `levelTimer = 0`, `lap = 0`.
* `reset(false)` (`start()`, i.e. a real run): same resets, then
  `this.pickRandomLevel()` sets a uniformly random index over `LEVELS`.
* `reset()` only calls `setThemeColors()` — not the full `applyLevel()` — because the very next
  thing it does is `rebuildWorld()`, which builds chunks and props from scratch for the palette
  that is now set. Calling both would allocate every chunk in the world twice and throw it away.
* `enterShop()` also pins the menu theme before its own `rebuildWorld()`: a fitting room must not
  depend on which world killed you.
* In `loop()` while playing: `this.levelTimer += dt`; at `>= LEVEL_SECONDS` the remainder is
  kept and `completeLevel()` runs. The timer never advances in `menu`, `shop`, `crashed` or
  `over` — you cannot clear a level by parking on the menu.

### `applyLevel(index)`

Applies theme data to the live scene without moving the player:

1. `setThemeColors(index)`: `scene.background` / `scene.fog.color` ← `sky`; fog near/far ← `fog`;
   sun colour+intensity; hemisphere sky/ground/intensity; `basePlane` material ← `floor`; and
   `this.palette` ← theme bands + slab + rainbow flag. The grass *edge* band is derived
   (`grass × 0.84`) rather than authored, so themes stay four values wide.
2. **Every cached ground chunk is disposed and rebuilt** (`rebuildChunks()`), because band colours
   are baked into vertex colours at build time — a cached chunk keeps the old world's colours.
3. Scenery props are disposed (geometry *and* their own materials) and re-seeded from the theme's
   weighted kinds (`reseedScenery()`), with positions re-rolled across the whole visible window
   (`s − 40 … s + GEN_AHEAD`) so a level change reads as a cut to a new place instead of trees
   being repainted in front of your face.
4. Cliff/wall bodies take `theme.slab` (their materials are per-slab, so existing slabs keep
   their colour; only new ones adopt the new theme — documented here because it is visible).

Chunk band colours go through `new THREE.Color(hex).convertSRGBToLinear()`, i.e. the same doubled
conversion the original forest palette was tuned against; scene/light colours take the single
conversion three does for them. New themes were picked against screenshots, not against theory.

`applyLevel` is called from `reset`, `completeLevel`, and the test hook. It must be safe to
call while playing (it is: nothing in it reads run stats) and while in `shop`.

## Score

```
score = floor(distance) + bananas * (BASE_BANANA_VALUE + ability.valueBonus)
        + levelsCleared * LEVEL_BONUS
```

`BASE_BANANA_VALUE = 10`, `LEVEL_BONUS = 250`, both module constants in `engine.js`. The
banana value term is the only reason score depends on a costume — see
[abilities.md](./abilities.md).

## Pacing (laps)

Slab scheduling lives in one place (`scheduleSlabs`) and spaces things by distance:

* cliffs every `rand(180, 320)` m, walls every `rand(260, 470)` m, both divided by
  `pace(lap) = min(1 + 0.12 * lap, 1.6)`, so a second circuit is busier without changing speed.
* A slab's start is pushed past any already-scheduled slab it would overlap (`slabStartAfter`),
  so a wall never grows inside a cliff and vice versa.

## Test hooks (`window.__MONKEY_GAME`)

| Hook | Purpose |
| ---- | ------- |
| `testGetLevel()` | `{ index, id, label, icon, cleared, lap, timeLeft }` for the current level |
| `testSetLevelIndex(i)` | apply theme `i` right now (clamps into range) and return `testGetLevel()` |
| `testClearLevelNow()` | run `completeLevel()` immediately — banner, chime, bonus, next index |

## UI contract

* `#hud-level` → `<span class="hud-label">LEVEL</span><span class="hud-value">BEACH · 37</span>`
  (label upper-cased, seconds whole). Present only while the HUD is shown.
* `#level-banner` → rendered while a banner is pending; contains `#level-banner-title`
  (`LEVEL CLEAR!`) and `#level-banner-sub` (`Sunny Beach → Downtown City`). Auto-dismissed
  after 2600 ms by a timer in `App.jsx`; starting a new run clears it immediately.
* Game-over card gains `<span id="final-levels">` showing levels cleared this run, and the
  subtitle names the level you died on.

## Screenshots (`tests/screenshots/`)

`20-hud-level.png`, `21-level-banner.png`, plus one per theme:
`22-level-<id>.png` (each theme applied mid-run, camera settled).

## Review checklist

* [ ] 14 themes, unique ids, every kind referenced by a theme exists in the engine builder.
* [ ] Physics constants untouched — no level touches gravity/jump/speed multipliers.
* [ ] `LEVEL_SECONDS` counted only while playing; timer survives a level change with its remainder.
* [ ] Menu/shop always render the forest theme (stable screenshots).
* [ ] Chunk rebuild on palette change: cached chunks must not keep old colours.
* [ ] Score formula matches the docs and `stats()` reports levels.
* [ ] Existing tests still pass: `.hud-bananas .hud-value` text format unchanged, no new
      element may match `.control`, `.costume-card` or `.buy-btn`.
