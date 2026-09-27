# 🐒 Monkey Dash

A Subway Surfers–style endless runner built with **Three.js + React (Vite)**, managed by **pnpm**, tested with **Playwright**.

You are a monkey sprinting down a trail, chasing bananas and jumping over boulders.

## Run it

```bash
pnpm install
pnpm start      # or pnpm dev — same thing, http://localhost:5173
```

## Controls

| Key            | Action      |
| -------------- | ----------- |
| ← / A          | move left   |
| → / D          | move right  |
| Space / ↑ / W  | jump        |
| Enter          | start / restart |

Touch: swipe left/right to change lanes, tap to jump.

## Gameplay

- **Sonic-2-style curvy track**: the path is generated from random segments — straights,
  left/right curves (with banking that tilts camera and ground), and bank-up / bank-down hills.
  Everything (road, obstacles, bananas, scenery) rides a spline via track-local coordinates
  (`s` along path, `x` lateral, `y` height).
- **Giant cliffs**: monolith platforms rise out of the trail ahead. Jump onto one (a lure banana
  marks the take-off spot), **ride the banana trail along its top**, then run off the end and
  fall back to the road. Cliffs can cover all three lanes (forced jump) or just one/two (dodgeable).
- Boulders block 1–2 lanes — switch lanes or **jump them** (banana arcs hover over boulders as a reward line)
- Speed ramps up with distance; score = meters + 10 per banana; best score saved to `localStorage`

## Architecture

- `src/game/engine.js` — the whole Three.js game: scene, procedural low-poly monkey (capsules/spheres/tube tail) with a hand-rolled run cycle & jump pose, physics, spawning, collision
- `src/App.jsx` — React shell: menu / HUD / game-over overlays, best-score persistence; talks to the engine via callbacks

## Tests

```bash
pnpm exec playwright install chromium   # once
pnpm test                               # runs Playwright against the dev server
```

Screenshots land in `tests/screenshots/`:

| File | Shows |
| ---- | ----- |
| `01-menu.png` | start menu with idle-hopping monkey |
| `03-jump-midair.png` | jump pose at apex, banana collected |
| `04-gameplay-boulders.png` | curving banking track + boulder wave |
| `05-game-over.png` | natural collision → game over card |
| `07-cliff-ride.png` | riding a giant cliff's banana trail (8 bananas) |

The suite verifies: menu renders, score increases while running on the curved track,
banana pickup works (deterministic injection), a real boulder collision ends the run,
a full **cliff ride** (timed jump onto the plateau, collect trail bananas, survive,
fall off the end) succeeds, restart resets state, and no page errors occur.
