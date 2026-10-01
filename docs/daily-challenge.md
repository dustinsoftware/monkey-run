# Design — Daily Distance Challenge

**Status:** implemented.
**Scope:** one shared goal per calendar day — *travel N metres in a single run* — with a banana-buck
reward, a streak counter, and progress visible in the menu, the HUD and the game-over card.

## Player-facing behaviour

1. Every day the game picks **one distance target for everyone**: `2026-01-14` always asks for the
   same number of metres, no matter who plays or when. Targets come from a fixed ladder
   (`DAILY_TARGETS = [180, 240, 300, 360, 450, 600]`) selected by hashing the day key, so difficulty
   wanders across the calendar instead of repeating on a loop.
2. The goal is **one run**, not a daily total: today's best single-run distance (`best`) is compared
   to `target`. Distance is the engine's `stats().distance` (metres travelled), the same number the
   score is built from — *not* score, so bananas do not count toward it.
3. Hitting the target **pays once per day**: `rewardFor(target) = max(1, round(target / 10))` banana
   bucks (18 … 60), banked into the shop wallet through the same path as run bananas. Collecting a
   reward never repeats — not on a second run the same day, not after a reload, not across the shop.
4. **Streak.** Completing a day whose previous completion was *yesterday* grows `streak`; any gap
   resets it to 1. The streak is a bragging stat only — it never changes a reward.
5. The day is the player's **local** calendar day (`YYYY-MM-DD` from `Date.now()` in local time). A
   new day rolls the challenge over on first read/mutation: fresh target, `best = 0`, unpaid again.
   Streak and last-completion day survive rollovers.

## Files touched

| File | Change |
| ---- | ------ |
| `src/daily/store.js` *(new)* | observable store: day keys, derived target/reward, run recording, rollover, streak; `window.__MONKEY_DAILY` |
| `src/daily/DailyChallenge.jsx` *(new)* | `useDaily()` store hook + `DailyMenuLine` (`#menu-daily`) and `DailyResult` (`#over-daily`, `#daily-reward`) |
| `src/App.jsx` | subscribes via `useDaily()`, renders the menu line / game-over result and the HUD chip `#daily-chip`; `onHud` now carries `distance` so the chip counts up live; calls `recordRun()` in `onGameOver` and adds its reward to the bananas banked |
| `src/styles.css` | `.hud-daily` chip (incl. `.done`), `.daily-line`, `.daily-result`, `.daily-goal`, `.daily-reward` |
| `tests/daily-challenge.spec.js` *(new)* | Playwright coverage + screenshots `16-…`–`18-…` |
| `docs/architecture.md`, `README.md` | keep in sync (files table, persistence keys, test surface) |

## Storage — one key, version-tagged, self-healing

`localStorage['monkey-dash-daily']`:

```json
{ "v": 1, "day": "2026-01-14", "best": 320, "paidOn": null, "streak": 0, "lastCompletedDay": null }
```

| Field | Meaning | Default / validation |
| ----- | ------- | -------------------- |
| `v` | schema version | `1` |
| `day` | day the rest of the blob belongs to | today's key; anything else means *roll over* |
| `best` | best single-run distance today, metres | `0`; `Number.isFinite`, clamped ≥ 0, floored |
| `paidOn` | day the reward was paid | `null`; kept only when it equals `day` **and** `best >= targetFor(day)` |
| `streak` | consecutive completed days | `0`; clamped ≥ 0 integer |
| `lastCompletedDay` | most recent completed day key (`YYYY-MM-DD`) or `null` | must match `/^\d{4}-\d{2}-\d{2}$/` |

**Nothing stores whether the challenge is done.** `completed = best >= targetFor(day)` and
`paid = paidOn === day` are *derived* on every read, so a hand-edited or half-written blob can only
ever move `best`/`streak` within their ranges — it cannot mint rewards. Reads are try/catch wrapped;
one atomic `JSON.stringify` write per mutation. Corrupt or absent values fall back to defaults.

## Store API (`src/daily/store.js`)

Module-level observable singleton, same shape as the shop store (`subscribe` / `getSnapshot`), so
React reads it with `useSyncExternalStore`. Snapshots are frozen stable references and carry derived
fields: `{ day, target, reward, best, completed, paid, streak }`.

| Export | Contract |
| ------ | -------- |
| `STORAGE_KEY = 'monkey-dash-daily'` | the only key this feature owns |
| `DAILY_TARGETS = [180, 240, 300, 360, 450, 600]` | difficulty ladder (metres) |
| `dayKey(date?)` | local `YYYY-MM-DD`; `date` defaults to now |
| `addDays(key, delta)` | calendar-safe shift (`Date.UTC` on the parsed parts → never drifts across DST) |
| `targetFor(dayKeyString)` | FNV-1a hash of the key → one entry of `DAILY_TARGETS`; **pure**, same answer in Node and browser |
| `rewardFor(target)` | `max(1, round(target / 10))` |
| `dailyStore.getState()` | current snapshot (rolls over first) |
| `dailyStore.recordRun(distance)` | returns `{ best, reward, completedNow }`; pays only on the transition to *completed-and-unpaid* |
| `dailyStore.reset()` | wipe storage + state (tests) |

**`recordRun` is the only mutation.** It rolls the day first, raises `best`, and — exactly when
`best >= target && paidOn !== day` — sets `paidOn = day`, updates the streak from
`lastCompletedDay` (`addDays(day, -1)` → `streak + 1`, otherwise `1`) and returns the reward. Every
other call returns `reward: 0`. It is called **once per death**, from the engine's `onGameOver`
callback (which `crash()` guards to fire exactly once), never from a render path or an effect keyed
on phase — returning from the shop restores phase `over` and would re-record. The returned reward is
handed to `shopStore.addBananas(reward)`, so the wallet write stays in one place.

### Test hooks (`window.__MONKEY_DAILY`)

| Hook | Purpose |
| ---- | ------- |
| `getState()` | snapshot without clicking through UI |
| `recordRun(distance)` | drive completion/reward logic directly (no grinding) |
| `setDay(key)` | pretend today is `key` — rolls state, makes "today" deterministic in tests. Returns the new snapshot and notifies subscribers. |
| `setTarget(metres)` | override **today's** target (test-only; never persisted, never reachable from gameplay) so completion can be reached in a few seconds of play. Belongs to that one day: rolling to another day drops it. Returns the new snapshot and notifies subscribers. |
| `reset()` | wipe storage + state |

`targetFor`/`addDays` are also imported directly by the spec: they are pure and must stay answerable
without a browser.

## UI contract

- **HUD chip** (`#daily-chip`, inside `.hud`, so it inherits HUD gating `playing | over`): label
  `DAILY`, value `${min(liveBest, target)} / ${target} m`, where `liveBest = max(best, distance of the
  run in progress)` — the store only learns a distance when the run ends, but the chip counts up while
  you play. Once completed the chip gains `.done` and reads `✅ ${target} m`. It is a sibling of the
  score/banana chips in the same flex row.
- **Menu line** (`#menu-daily`, rendered by `<DailyMenuLine/>` under the wallet line): pending →
  `📅 Daily: travel {target} m today · best {best} m`; completed → `📅 Daily done: {target} m
  · +{reward} 🍌`. Streak appended as ` · 🔥 {streak}-day streak` when `streak > 1`.
- **Game-over result** (`#over-daily`, a `.daily-result` block above the buttons): the same two
  wordings but *without* the reward in the done line, plus `#daily-reward`
  (`+{reward} 🍌 banked!`) shown only on the run that actually paid — App keeps that in local state
  from `recordRun`'s return so it disappears when you start a new run. The payout is therefore never
  stated twice on one card.
- No new overlay, no new phase: the daily feature never blocks play and needs no keyboard handling.

## Tests (`tests/daily-challenge.spec.js`)

Fresh context per test → localStorage does not survive between tests; every test seeds its own day
through `__MONKEY_DAILY.setDay(...)` so targets are deterministic. Screenshots go to
`tests/screenshots/`.

| Test | Asserts |
| ---- | ------- |
| the daily target is a pure function of the date *(node-side, no browser)* | every key maps into `DAILY_TARGETS`; the same key always answers the same; a full year of keys covers the whole ladder; `rewardFor` matches `target/10` |
| menu shows today's challenge | after `setDay`, `#menu-daily` names the derived target and "best 0 m" |
| a run records its distance as today's best | start, play a couple of seconds, die on a boulder: HUD chip counted up during play (`#daily-chip` visible), over card shows a non-zero best below the target |
| completing the goal pays once | `setDay` + `setTarget(60)`, run until `engine.distance ≥ 72` (restarting if a random boulder ends it short) then crash → `#over-daily` says done, `#daily-reward` reads `+6 🍌 banked!`, wallet rose by exactly reward + the run's bananas, store reports `completed && paid && streak: 1`; a second death the same day pays nothing and shows no reward line |
| the streak grows on consecutive days and dies on a gap | complete day *D* through the hook, roll to *D+1* and complete → `streak: 2`; roll two days ahead and complete → `streak: 1` |
| rollover resets today but keeps the streak | seed storage for another day with a best/streak, reload → fresh target/`best: 0`/unpaid, streak preserved |
| corrupt storage falls back to defaults | unparsable JSON, negative `best`, unknown `day`, an illegal `lastCompletedDay` and a smuggled `completed: true` all normalise away |

## Review checklist (before implementing)

- `recordRun` pays exactly once per day even across reload/shop visits; nothing else can mint bananas.
- Target/reward are derived, never stored — hand-edited storage cannot change today's goal.
- Rollover compares **local** day keys and must not drift over DST (`addDays` uses UTC parts).
- `completed`/`paid` are computed on read; only `best`, `paidOn`, `streak`, `lastCompletedDay` persist.
- HUD chip lives inside `.hud` so the existing `playing | over` gating covers it (never painted over
  the shop, per costume-shop.md).
- The reward write goes through `shopStore.addBananas`, keeping "banking is pinned to `onGameOver`" true.
