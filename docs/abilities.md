# Design — Costume Abilities

Every costume does something. A bare monkey is the baseline: normal jump, normal hitbox,
normal speed, ten points a banana. Put an outfit on and the game changes around you — some
outfits help, two of them make life harder, and the trade-offs are printed on the shop tile
so nobody equips a downside by accident.

Abilities live in the costume catalogue (`src/game/costumes.js`) as **data**. The engine reads
that data; nothing else may decide what an outfit does. That keeps one source of truth and lets
the tests import the same table instead of restating numbers (same trick as `COSTUME_PRICE`).

## Stat model

One shared shape, defaults first:

```js
export const ABILITY_DEFAULTS = {
  speedMul: 1,      // multiplies the distance-ramped target speed
  jumpMul: 1,       // multiplies JUMP_VELOCITY on a ground jump
  extraJumps: 0,    // air jumps available after leaving the ground (1 = double jump)
  fallMul: 1,       // scales |gravity| while falling (vy < 0) — floatiness
  magnet: 0,        // metres ahead within which bananas drift to your lane
  valueBonus: 0,    // extra score per banana collected
  hitboxScale: 1,   // scales the boulder collision padding
  sizeScale: 1,     // visual scale of the monkey + how high his chest reaches
  revives: 0,       // crashes forgiven per run
};
```

| Stat | Where it bites | Exact rule |
| ---- | -------------- | ---------- |
| `speedMul` | `loop()` while playing | `target = min(MAX_SPEED, BASE_SPEED + distance*SPEED_RAMP)`, then `this.speed = target * speedMul`. Faster means both more score per metre **and** less reaction time. |
| `jumpMul` | `jump()` from the ground | `vy = JUMP_VELOCITY * jumpMul`. Apex scales as the square, so 1.14 is a noticeable hop, not a 14% one. |
| `extraJumps` | `jump()` while airborne | First air jump uses `SECOND_JUMP_VELOCITY = 11.6 m/s` (a boost, not a re-launch). Counter resets on landing; it does **not** reset on reviving. |
| `fallMul` | gravity integration | Applied only when `vy < 0`: `vy += GRAVITY * fallMul * dt`. Rising is untouched, so the jump still feels snappy but hangs. |
| `magnet` | banana loop before collection | A banana at most `magnet` metres **ahead** and within one lane laterally (`|dx| ≤ MAG_LATERAL`, i.e. the 2.6 m lane gap plus a hair) lerps toward the player's lateral position at `dt * 5`. Never pulls backwards, never across more than one lane. The tolerance is not cosmetic: an adjacent-lane banana sits *exactly* 2.6 m away, so comparing with `≤ 2.6` failed on every frame the magnet should have fired. |
| `valueBonus` | `score()` | banana term is `(BASE_BANANA_VALUE + valueBonus)`. |
| `hitboxScale` | boulder collision | padding becomes `0.42 * hitboxScale` laterally and the longitudinal padding `0.35 * hitboxScale`. Cliff/wall geometry is **not** scaled — slab edges are exact, so the cliff-clip regression stays meaningful. |
| `sizeScale` | monkey scale + pickups | `monkey.group.scale = MONKEY_SCALE * sizeScale`; chest height becomes `CHEST_Y * sizeScale`, and the pickup box grows by `0.45 * (sizeScale − 1)` on each lateral axis. Bigger monkey, bigger hat, bigger hitbox in spirit — paired with `hitboxScale` where it matters. |
| `revives` | `crash()` | See *Reviving*. |

## The nine outfits

| Costume | Ability id | Label | Stats (non-default) | Feel |
| ------- | ---------- | ----- | ------------------- | ---- |
| 🎩 Tuxedo | `dapper-sprint` | Dapper Sprint | `speedMul 1.15` | **Harder.** You look great going faster: more score per metre, less time to read the trail. No other help at all. |
| 🤡 Clown | `bouncy-nose` | Bouncy Nose | `extraJumps 1` | The red nose is a trampoline — one extra jump in mid-air. |
| 🩺 Doctor | `second-opinion` | Second Opinion | `revives 1` | One crash per run is called off and treated on the spot. |
| 🎩 Top Hat | `old-top-banana` | Old Top Banana | `valueBonus 5`, `hitboxScale 1.25`, `sizeScale 1.1` | **Trade-off.** Bananas are worth 15, but you are a bigger target and a bigger monkey. |
| 🐶 Dog Outfit | `good-nose` | Good Nose | `magnet 6.5` | Bananas one lane over get sniffed out of the scenery and steered to you. |
| 🐰 Bunny Outfit | `bunny-hop` | Bunny Hop | `jumpMul 1.14` | Hind legs: a higher single jump, no second one. |
| 🐱 Cat Outfit | `lands-on-feet` | Lands on Feet | `hitboxScale 0.78` | Threads boulders that would clip the bare monkey. Pure help — cats do not compromise. |
| 🦋 Butterfly Wings | `wing-flap` | Wing Flap | `extraJumps 1`, `fallMul 0.82` | A flap at the top of the arc, then a slow float down. |
| ☔ Yellow Rainsuit | `umbrella-drag` | Umbrella Drag | `fallMul 0.62`, `jumpMul 1.05` | The umbrella catches the air: long hang time. No double jump — it is an umbrella, not wings. |

Plus the baseline row the shop shows as "Bare monkey": every stat at its default, and the
shop's `#shop-bare-btn` returns to it. Its label is `Bare Monkey` (title case — the HUD chip prints
labels verbatim, so no CSS casing tricks are involved).

`abilityFor(id)` always resolves a **complete** block: defaults first, then the costume's overrides,
and only numeric overrides survive (`Number.isFinite`). A costume entry that forgets a stat, or
types one wrong, inherits the default instead of handing the engine `undefined` — which once turned
`this.speed` into NaN and froze the run mid-frame with every object stuck in place.

## Reviving (`revives`)

`crash()` becomes three-way:

1. `this.invulnerableT > 0` → ignore entirely (a revive never dies twice in one frame).
2. `this.revivesLeft > 0` → spend it and keep running:
   * `revivesLeft--`, `invulnerableT = REVIVE_GRACE = 1.4 s`,
   * deactivate every boulder within ±12 m of the player,
   * remove any slab whose `sStart` is inside `[s − 2, s + 12]` (the wall that got you is gone) —
     through `removeSlab()`, never by hand. Dropping the slab from `this.cliffs` without retiring
     its bananas would leave a cliff trail hanging in mid-air over bare road for as long as it takes
     to fall behind the player, which is the floating-bait bug this whole area exists to kill.
   * snap to the surface (`py = groundHeightAt(s, x)`, `vy = 0`, `grounded = true`),
   * play the revive chime and report it through `cb.onRevive?.({ left })`.
3. otherwise crash for real, exactly as before.

Grace decays only while playing. It makes a revive readable instead of a coin flip against the
next obstacle, and it is what lets the test suite prove "one free death, then you die".

## UI contract

* **Shop tiles** (`.costume-card`) gain `<span class="costume-ability">` with the ability label
  in caps plus `<p class="costume-text">` with one sentence.
* Going back to a bare monkey is `#shop-bare-btn` in the shop header, labelled *BARE MONKEY*
  (`disabled` while nothing is worn). It is deliberately **not** a `.costume-card`: the existing
  suite asserts exactly `COSTUMES.length` cards, and a tenth tile would read as a bug.
* **HUD** gains `#hud-ability`: label of the outfit the engine is actually running, or
  `Bare Monkey`. It reads the engine's HUD payload rather than the shop store.
* **Menu card** gains `#menu-ability` describing the currently worn outfit (or the bare baseline).

## Engine API

```js
game.setCostume(id)   // existing: builds/toggles meshes AND calls applyAbility(id)
game.getCostume()     // existing: id or null
game.ability          // { id, label, text, ...resolved stats } — always defined after init
game.stats().ability  // { id, label } for the HUD/game-over card
```

`applyAbility(id)` also resets `airJumpsLeft = extraJumps` and `revivesLeft = revives`, so
trying on an outfit in the fitting room previews its numbers immediately (and taking it off
takes them back). Try-on is still free — abilities are not a purchase, only the cloth is.

## Test hooks (`window.__MONKEY_GAME`)

| Hook | Purpose |
| ---- | ------- |
| `testJump()` | public jump entry point (`jump()` already is; kept as an alias so tests never poke internals) |
| `testAirJumpsLeft` (field) | read the air-jump counter |
| `testSetRevives(n)` | set `revivesLeft` directly — lets any costume be tested for a revive without buying it |

## Tests (`tests/abilities.spec.js`)

* The catalogue is well-formed: every costume has an ability id, label and text; ids unique;
  every stat key exists in `ABILITY_DEFAULTS`; the bare baseline resolves to all defaults.
* Equipping each costume makes `game.ability` match the table (imported, not restated).
* Behavioural spot checks on the two stats that could silently do nothing:
  * **double jump** — clown: one ground jump then a second `jump()` in mid-air raises the apex
    above what a single jump reaches at the same speed;
  * **magnet** — dog: a banana spawned one lane over, ahead of the player, is collected without
    a lane change; bare monkey misses it.
* **revive** — `testSetRevives(1)` then an unavoidable boulder: no game-over overlay, run keeps
    going, and a second boulder does end it.
* **a revived cliff takes its bananas with it** — run head-long into a full-road cliff while
  holding one revive (`testSetRevives(1)`): the slab is gone, every banana it owned (lure + trail)
  is retired with it, and `testBananaAudit().orphan` stays 0. Before this rule was written down the
  trail stayed behind as floating bait over bare road.
* Screenshots: `23-ability-hud.png` (HUD chip), `24-shop-abilities.png`.

## Review checklist

* [ ] Every costume has exactly one ability entry; no two share an id.
* [ ] Two outfits are explicitly worse (`dapper-sprint`, `old-top-banana`) and the shop says so.
* [ ] Nothing in the engine hard-codes a per-costume number — data only.
* [ ] `setCostume(null)` restores every default (scale, chest height, padding, jumps).
* [ ] Try-on previews stats; leaving the shop reverts to the worn outfit (existing rule).
* [ ] Slab geometry stays unscaled by `hitboxScale` so cliff tests keep their meaning.
* [ ] A revive removes slabs through `removeSlab()`, so owned bananas never outlive them.
