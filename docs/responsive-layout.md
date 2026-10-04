# Design — Responsive layout (iPhone 16 and friends)

The game was authored against a 1280×720 desktop viewport. On an iPhone 16
(393 × 852 pt portrait, 852 × 393 landscape, DPR 3, no hover, coarse pointer,
dynamic island + home indicator) almost every overlay was wrong. Measured before
any fix:

| Symptom | Evidence (393 × 852 unless noted) |
| ------- | --------------------------------- |
| HUD runs off the right edge | `.hud` scrollWidth **542 px** in a 393 px viewport; the DAILY and ABILITY chips sat at x = 444 and x = 554 — permanently invisible |
| Menu card touches both edges, title wraps mid-word | `.card` has `max-width: 560px` but no width cap below that |
| Mute button overlaps the cards | `.sound-toggle` is fixed top-right; cards start at `padding-top: max(24px, 5vh)` and span nearly the full width |
| Keyboard hints on a touch device | the menu explains `← A`, `→ D`, `Space ↑`; nobody has those keys |
| Shop panel unusable | `.card-shop { width: min(600px, 52vw) }` → **204 px** wide; three grid columns of ~71 px each, third column clipped, cards overflowing the viewport bottom (`bottom: 1044 > 852`) with nothing scrollable |
| Landscape phone hides half the menu | at 852 × 393 the card is taller than the viewport and `body { overflow: hidden }` means the 🛍️ COSTUME SHOP button below the fold can never be reached |
| Safari toolbars | `100vh` is the *largest* viewport on iOS, so the canvas was ~100 pt taller than what you could see |

This is a layout-only change: no gameplay constant, engine state or test hook
changes shape (one camera helper gains aspect-awareness — see *Fitting room*).

## Breakpoints

Two media features drive everything; they are the only numbers that decide
"phone or desktop", and the engine mirrors them for the fitting camera.

* **compact** — `@media (max-width: 640px), (max-height: 520px)`. Covers every
  phone in either orientation plus small desktop windows. Shrinks type, padding
  and chips; makes overlays scrollable.
* **sheet** — `@media (orientation: portrait) and (max-width: 700px)`. A phone held
  upright: the costume shop becomes a bottom sheet so the fitting camera can keep
  the monkey in the band above it.

## Safe areas (`index.html`, `src/styles.css`)

* The viewport meta gains `viewport-fit=cover` — without it there are no safe-area
  insets to lay out against, and the HUD sits under the dynamic island.
* Every fixed edge uses `env(safe-area-inset-*)`: `.hud`, `.overlay` padding,
  `.sound-toggle`, `.level-banner`, and the sheet.
* Canvas and full-height boxes use `height: 100vh` followed by `height: 100dvh`
  (the fallback first so browsers without DMV support keep the old value). The engine
  sizes the renderer from `innerWidth/innerHeight`, which is exactly what `dvh`
  reports, so canvas and CSS agree.

## HUD (`src/styles.css`)

The row may now wrap: `.hud { flex-wrap: wrap; padding-right: <mute width + gap> }`.
Chips lose their 96 px floor (`min-width: max-content`) and shrink to
`font-size: 17px` values / `9px` labels on compact screens, so five chips fit in
393 pt. The reserved right padding is what keeps the first row clear of the mute
button instead of sliding under it.

## Cards and overlays

* `.overlay { overflow-y: auto; overscroll-behavior: contain }` — content that does
  not fit is scrollable rather than unreachable (the landscape-phone case).
* `.card { width: min(560px, calc(100% - 2 * pad)) }`, fluid type via `clamp()`.
* Compact screens get a smaller padding and buttons sized for thumbs
  (`min-height: 44 px` tap targets everywhere, including the tiny shop buttons).
* `.overlay` reserves room for the mute button with `padding-top` so nothing draws
  under it; the button itself stays top-right in every layout.

## Touch-first control hints (`src/App.jsx`)

Each of the three `.control` chips carries both variants: a `<span class="keys">`
with the `<kbd>`s and a `<span class="gestures">` with the gesture wording ("swipe ←",
"tap or swipe ↑"). CSS shows exactly one — `(hover: none) and (pointer: coarse)` picks
the gestures. Both stay in the DOM (desktop needs them), so tests assert *visibility*,
never element counts. The chip count stays three, which is part of the existing test
contract.

## Costume shop as a bottom sheet

Portrait phones get `.overlay-shop { align-items: flex-end }` plus
`.card-shop { width: 100%; max-height: 62dvh; overflow-y: auto }`, and the grid stops
scrolling inside itself (`overflow: visible`) so one finger scrolls the whole panel.
Columns become `repeat(auto-fill, minmax(150px, 1fr))` — two readable columns at
393 pt instead of three clipped ones. The footer stacks; buttons get thumb size.

Landscape phones keep the desktop left-panel shape (there is width to spare): a 443 pt
panel at `x = 16`, ~310 pt tall inside a 393 pt screen, grid scrolling inside itself,
`#shop-back-btn` bottom at 360 — reachable — and the monkey framed on the right.

## Measuring geometry in tests

`.card` pops in with `cubic-bezier(.2, 1.6, .4, 1)` — an overshooting scale, so a card
measured mid-animation legitimately sticks out past the viewport by a few pixels. Every
geometry assertion in the mobile suite waits for the animation to settle first.

## Fitting room (`src/game/engine.js`)

`fitShopView()` hard-coded a lateral push of `+1.2 m` so the monkey sits in the free
right half beside the left-hand panel. In portrait that pushed him partly out of
frame. It now reads the viewport:

```js
const sheet = h > w && w <= 700;   // must match the CSS "sheet" breakpoint
side = sheet ? 0 : 1.2;            // centred above the sheet, right-of-centre beside a panel
lift = sheet ? ~1 m : 0;           // aim low so he reads in the band above the sheet
```

`onResize()` re-snaps the fitting camera while `state === 'shop'`, so rotating the
phone reframes immediately instead of lerping across from the old framing.

## Tests (`tests/mobile-layout.spec.js`)

Runs at iPhone 16 metrics — portrait `{ width: 393, height: 852 }`, DPR 3,
`isMobile`, `hasTouch` — plus one landscape case at 852 × 393.

* menu card is inside the viewport and every button in it is visible and enabled;
* nothing in the HUD sticks out of the viewport while playing (the regression this
  doc exists for), and no `.hud-item` intersects `#sound-toggle`;
* the shop sheet: all nine costume cards are inside the viewport horizontally, the
  panel scrolls so every card's buttons become reachable, and a tap on a TRY ON button
  actually previews that outfit;
* game-over card fits and both of its buttons are tappable;
* landscape phone: the menu's 🛍️ COSTUME SHOP button is inside the viewport (it was
  below the fold and unreachable);
* touch devices show gesture hints and hide the keyboard variant (visibility, since
  both live in the DOM).

Screenshots: `30-phone-menu.png`, `31-phone-hud.png`, `32-phone-shop.png`,
`33-phone-over.png`, `34-phone-landscape.png`. Desktop screenshots are untouched —
the desktop layout must not move.

## Review checklist

* [ ] No element of the HUD, a card or the shop sheet crosses the viewport edge at
      393 × 852 (measured with `getBoundingClientRect`, not eyeballed).
* [ ] Every interactive control is ≥ 44 pt tall/wide on phones and reachable by scroll.
* [ ] Desktop rendering is pixel-identical apart from safe-area padding, which is 0
      outside notch devices.
* [ ] Existing suites still pass unchanged (chip counts, `.control` count of 3,
      shop text assertions — the ability text stays in the DOM and visible).
