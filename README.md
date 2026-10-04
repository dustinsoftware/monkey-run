# 🐒 Monkey Dash

A Subway Surfers–style endless runner built with **Three.js + React (Vite)**, managed by **pnpm**, tested with **Playwright**.

You are a monkey sprinting down a trail, chasing bananas and jumping over boulders.

## Run it

```bash
pnpm install
pnpm start      # or pnpm dev — same thing, http://localhost:5173
```

## Controls

| Key            | Action          |
| -------------- | --------------- |
| ← / A          | move left       |
| → / D          | move right      |
| Space / ↑ / W  | jump (again in mid-air if your costume grants a second one) |
| Enter          | start / restart |
| M              | mute / unmute   |
| Esc            | leave the costume shop |

Touch: swipe left/right to change lanes, **swipe up or tap** to jump (a swipe down does nothing —
there is nothing to duck under). One finger per gesture, and gestures only register during a run.
Keys do nothing while the costume shop is
open, so browsing never starts a run. While the **top banana** modal is up, Enter/Space/Esc dismiss
it instead.

## Gameplay

- **Sonic-2-style curvy track**: the path is generated from random segments — straights,
  left/right curves (with banking that tilts camera and ground), and bank-up / bank-down hills.
  Everything (road, obstacles, bananas, scenery) rides a spline via track-local coordinates
  (`s` along path, `x` lateral, `y` height).
- **Giant cliffs**: monolith platforms rise out of the trail ahead. Jump onto one (a lure banana
  marks the take-off spot), **ride the banana trail along its top**, then run off the end and
  fall back to the road. Cliffs can cover all three lanes (forced jump) or just one/two (dodgeable).
- **Walls**: taller slabs you *cannot* jump — more than twice your jump height, never blocking all
  three lanes, no bananas on top. Read them early and step sideways.
- Boulders block 1–2 lanes — switch lanes or **jump them** (banana arcs hover over boulders as a reward line)
- **Themed levels**: every world is its own palette and scenery set — forest, plains, neighborhood,
  city, shopping mall, desert, pyramid, crystal cave, beach, coral depths, lava tubes, the moon,
  rainbow sky and neo-circuit sci-fi. Survive **60 seconds** to beat a level and step into the next;
  every run starts on a **random** theme. See [docs/levels.md](docs/levels.md)
- **Costume abilities**: every outfit changes how the monkey plays — faster (harder), double jump,
  higher hop, floaty umbrella drag, banana-sniffing magnet, fatter banana value with a bigger
  hitbox, narrower cat-shaped collisions, or one forgiven crash. The shop tile tells you which side
  it cuts on. See [docs/abilities.md](docs/abilities.md)
- **Bananas chomp**: each pickup plays a rising WebAudio blip (press `M` to shut it up)
- **Nothing floats out of reach**: every banana is placed through one helper that refuses spots
  inside rock and clamps everything above a max-height jump; trails belong to their cliff, so when
  a slab goes away its bananas go with it
- Speed ramps up with distance; score = meters + 10 per banana; best score saved to `localStorage`
- **Daily challenge**: one shared goal every day — *travel N metres in a single run* (the target is
  derived from the date, so everyone runs for the same number). Progress shows on the menu, in the
  HUD and on the game-over card; hitting it pays once per day into the shop wallet, and completing
  back-to-back days builds a 🔥 streak. See [docs/daily-challenge.md](docs/daily-challenge.md)
- **Costume shop**: bananas you collect are banked into a persistent wallet, and every death offers
  the shop. Nine outfits (tuxedo, clown, doctor, top hat, dog, bunny, cat, butterfly wings, yellow
  rainsuit + umbrella) cost **100 bananas each — flat, forever, no inflation**. Unlocks are forever,
  and `TRY ON` previews an outfit on the monkey in a fitting camera before you spend anything. The
  shop always sets him back down at the start of the trail so you can actually see him. Own all
  nine and the game tells you: *"You beat the game! You're the top banana! … -The Masters"* — see
  [docs/costume-shop.md](docs/costume-shop.md)

## Architecture

- `src/game/engine.js` — the whole Three.js game: scene, procedural low-poly monkey (capsules/spheres/tube tail) with a hand-rolled run cycle & jump pose, physics, spawning, collision
- `src/game/costumes.js` — the nine outfits **and their abilities**, also built from primitives and pinned to rig hosts (`body`, `head`, limb pivots)
- `src/game/levels.js` — the 14 themed worlds as pure palette/scenery data plus the 60 s level rule
- `src/game/audio.js` — WebAudio pickup / level-clear / revive chimes and the mute switch
- `src/game/banana.js` — the collectible banana mesh itself: one lathed, bent, tapered, vertex-coloured banana shared by the whole pool
- `src/shop/store.js` — observable banana-bucks store (wallet, unlocks, flat 100-banana price, worn outfit, pending victory), persisted to `localStorage`
- `src/shop/CostumeShop.jsx` — the shop panel: try-on / buy / wear
- `src/shop/VictoryModal.jsx` — the top-banana modal shown when the wardrobe is complete
- `src/daily/store.js` — observable daily-challenge store (local day key, date-derived target, today's best run, one payout per day, streak), persisted to `localStorage`
- `src/daily/DailyChallenge.jsx` — the daily goal line on the menu card and the game-over result
- `src/App.jsx` — React shell: menu / HUD / game-over / shop overlays, best-score persistence and banana banking; talks to the engine via callbacks

## Tests

```bash
pnpm exec playwright install chromium   # once
pnpm test                               # runs Playwright against the dev server
```

Screenshots land in `tests/screenshots/`:

| File | Shows |
| ---- | ----- |
| `01-menu.png`, `02-menu-ready.png` | start menu with idle-hopping monkey |
| `03-jump-midair.png` | jump pose at apex |
| `04-gameplay-boulders.png` | curving banking track + boulder wave |
| `05-game-over.png` | natural collision → game over card |
| `07-cliff-ride.png` | riding a giant cliff's banana trail |
| `08-keyboard-start.png` | Enter starts the game |
| `09-cliff-clip-crash.png` | too-late jump crashes into the cliff face (no ghosting) |
| `10-gameover-banked.png` | game over after banking bananas and visiting the shop |
| `11-shop-two-unlocked.png` | shop with two costumes unlocked (price still 100) |
| `13-top-banana.png` | the whole wardrobe owned → top banana modal |
| `12-costume-<id>.png` | one fitting-room preview per outfit (nine files) |
| `19-wall-crash.png` | an unjumpable wall in your lane |
| `20-hud-level.png` | the LEVEL chip counting down mid-run |
| `21-level-banner.png` | the banner between two levels |
| `22-level-<id>.png` | one screenshot per themed world (fourteen files) |
| `23-ability-hud.png`, `24-shop-abilities.png` | the ability chip and the shop's ability lines |
| `25-sound-muted.png` | the mute switch, which survives a reload |
| `26-banana-audit.png` | mid-audit: waves, cliffs and walls all on screen at once |
| `14-banana-row.png` | a row of actual bananas (not macaroni) down the trail |
| `15-framed-at-trailhead.png` | back from the shop: he stands, framed, at the start of the trail |
| `16-menu-daily.png` | menu card showing today's distance challenge |
| `17-hud-daily.png` | the DAILY chip counting up next to score and bananas mid-run |
| `18-daily-complete.png` | game over on the run that completed the daily goal |

The suite verifies: menu renders, score increases while running on the curved track,
banana pickup works (deterministic injection), a real boulder collision ends the run,
a full **cliff ride** (timed jump onto the plateau, collect trail bananas, survive,
fall off the end) succeeds and a too-late jump crashes instead of clipping through,
restart resets state, and no page errors occur.

The costume-shop suite covers: bananas banked exactly once per death, the shop rewinding the monkey
to the start of the trail, try-on free and reversible, flat 100-banana buys that never inflate, the
top-banana modal firing on the last unlock (and surviving a reload until dismissed), you cannot
overspend, everything survives a reload, corrupt storage falls back to defaults, bananas are shaped
like bananas, the shop never restarts a run (Space/Esc), and each of the nine outfits renders.

The daily-challenge suite covers: the target is a pure function of the date (and covers the whole
ladder over a year), progress on menu/HUD/game over, exactly one payout per day, streak growth and
reset, rollover into a new day, and corrupt storage falling back to defaults.

The levels suite proves the ladder works: forest on the menu, a random theme when you actually
start, the countdown chip, level clears (banner, score bonus, wrap into lap 2) and that all
fourteen worlds render. The abilities suite proves every outfit's stats match the catalogue and
that double jump, magnet and the doctor revive work in the engine. Two more regression checks live
in the gameplay suite: walls (unavoidable in your lane, survivable one lane over, never jumpable,
never all three lanes), a **banana audit** (nothing may spawn buried in rock, inside a boulder or
above the reachable envelope — and nothing may outlive the slab it was placed on) and the
**pickup sound** counter.
