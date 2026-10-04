# AGENTS.md — Working Agreement

## The rule: docs → review → implement

**Never change behaviour without writing it down first.** For any feature, fix or
behavioural refactor:

1. **Update the docs first.** Edit `docs/architecture.md` (and add a focused design doc in
   `docs/` when the change is more than a tweak) so the documents describe what the code
   _will_ do — states, files touched, data shapes, storage keys, UI ids, test hooks.
2. **Review the change before writing it.** Always use subagents to review the docs or code change.
   Re-read the diff of the docs against reality:
   does every file/constant/key named exist or will it? Are edge cases (persistence,
   backwards compatibility, existing tests) covered? Read the surrounding code you are about
   to touch and check the assumptions in the doc. Only then proceed.
3. **Implement the code** to match the docs. If reality forces a deviation, go back to step 1
   and fix the doc — do not silently ship a different design.
4. Use playwright to write the tests. Playwright can take screenshots, use those screenshots
   to debug game state.

If documentation and implementation disagree, the docs are wrong _and_ incomplete: fix both
in the same change. Screenshots for new visible states go in `tests/screenshots/`.

## Other conventions

- `pnpm dev` (Vite :5173) is the only server; `pnpm test` runs Playwright against it.
- Everything in-game lives in track-local coordinates (`s`, `x`, `y`) — see architecture doc.
- The monkey is built from primitives with **shared materials**; never recolour a shared
  material to costume the monkey, add extra meshes instead.
- Deterministic tests: drive the game through the engine's debug hooks on `window.__MONKEY_GAME`
  (`testSpawnBananaAtPlayer`, `testSpawnBoulderAhead`, `testClearCliffs`, `testSpawnCliffAhead`)
  rather than hoping random spawns line up. Any new persistent subsystem gets its own
  `window.__*` hook so tests can seed it without clicking.
