# UX and UI review — findings and change list

A working list to implement from. The argument behind it is in two published
reviews; this file is the actionable residue, with the measurements kept so
nobody has to take them again.

- **Toy and Instrument** (second pass, the one to work from) —
  <https://claude.ai/code/artifact/47618535-640d-4e51-ae54-31c6fcf37e83>
- **Let the Toy Out** (first pass, different framing, same app) —
  <https://claude.ai/code/artifact/d8fd2eb5-9a7b-4eb8-9e05-e943cb6652d7>

Nothing in the app was changed while reviewing it. Everything below is still to do.

---

## The argument in one paragraph

This is two products in one shell. Single pole is a light curiosity — 11 number
fields, 278 characters of help. LED wall is a professional instrument — 24 fields,
27 selects, 2,281 characters of help. They share one layout, one neutral system
font and one answer-first panel order, so the instrument's seriousness sets the
tone for both and neither half is allowed to be what it is. That is why it does
not feel fun. Fun means something different in each half: for the toy it is play
(choose a thing, push it, watch it go, send it on); for the instrument it is
consequence (you designed this, now watch the storm find out).

## Measurements, so they need not be retaken

Taken in Chromium at 1280×900 and 390×844, both colour schemes, September 2025.

| Measure | Single pole | LED wall |
| --- | --- | --- |
| Number fields | 11 | 24 |
| Selects | 12 | 27 |
| Page height, 390 px phone | 5.3 screens | 8.5 screens |
| Help hints | 5 | 17 |
| Characters of help text | 278 | 2,281 |

Phone geography, LED mode, in screenfuls of 844 px:

| Panel | Starts | Ends |
| --- | --- | --- |
| Answer | 0.2 | 0.7 |
| Simulator | 0.7 | 1.9 |
| Inputs | 1.9 | 5.1 |
| Diagrams | 5.2 | 5.9 |
| The numbers | 5.9 | 8.4 |

The wind field sits about five screens from the answer it changes.

Contrast, computed from rendered values:

| Element | Light | Dark | Needs |
| --- | --- | --- | --- |
| Field hints, 12.6 px | 5.98:1 | 6.78:1 | 4.5 |
| Answer note, 14.1 px | 5.98:1 | 6.78:1 | 4.5 |
| Simulator status, 14.4 px | 18.15:1 | 14.46:1 | 4.5 |
| Diagram labels, 10.5 px | 17.34:1 | 13.54:1 | 4.5 |
| **Pass/fail badge, 13.1 px** | 4.15:1 — was failing, now 4.93:1 | 6.39:1 | 4.5 |

A note on that table: the probe that produced it could not parse the
`color(srgb ...)` values Chromium computes for `color-mix()`, and silently
returned nonsense for those rows. The badge figures above are the corrected
ones. The dark badge was recorded as 9.95:1 and is really 6.39:1 — passing
either way, but the number was wrong.

Other measured facts:

- Checkbox label rows are 22 px tall; the force/wind slider is 26 px. Guideline is 44.
- The canvas is `tabindex="-1"` `role="img"` — draggable by mouse only. Slider and
  Apply are keyboard reachable, so nothing is locked out.
- Eight tab presses to reach the first real input.
- All five checkboxes carry correct accessible names — checked against the
  accessibility tree, not the markup. An earlier claim that 14 inputs were
  unlabelled was wrong; the naive probe missed wrapping labels.
- Focus ring is visible: 2 px solid.
- Two `prefers-reduced-motion` blocks already present.

---

## An afternoon — credibility

- [x] **Blank field is read as zero.** `src/app.js:296` turns anything
      unparseable into `0`, so "not told yet" and "deliberately nothing" are the
      same input. Clearing the baseplate weight moves the headline from 40.94 to
      11.7 with no warning shown. Treat blank as absent: hold the answer, name the
      field. Pole mode only errors when *both* masses are empty
      (`src/physics.js:293`).
- [x] **Four significant figures on a first-pass estimate.** `40.94 N`, `2.012 m`.
      Three at most in the headline; round setting-out dimensions to something a
      tape can find.
- [x] **The headline has lost its unit.** A 68 px figure with the unit beside it in
      a bordered `<select>` (`index.html:49-51`). Set the unit as type right after
      the number and make it a quiet control — the LED side already does this
      ("6 uprights") and reads better.
- [x] **Reset is destructive, unconfirmed, unrecoverable.** Took a pole length of 9
      back to 2 with no dialogue. Offer "Undo reset" for a while rather than a
      confirmation.
- [x] **Share link carries both modes.** 391 characters, 43 parameters; sharing an
      LED wall sends all ten pole parameters too. Serialise the active mode only,
      and only fields differing from defaults (`serialize()` in `src/app.js`).
- [x] **Pass badge fails contrast in light mode** (4.16:1). Darken until it clears
      4.5:1. It is the one element that says whether the thing stands up.
- [x] **Touch targets.** Pad checkbox rows and the slider to 44 px. Primary user is
      outdoors, on a phone, possibly in gloves.
- [x] **The fall ends badly.** Drop the centre-of-gravity marker, plumb line,
      dimension arrows and force arrow the moment it lands — one condition in
      `drawSim()`, and the end of the fall stops looking like a bug.

## A weekend — feel

- [x] **Give it a typeface.** Archivo, vendored as a 35 KB variable woff2 rather than linked — a webfont from someone else's server would be the one part of an offline-first app that needs the internet. Cached by the service worker and inlined as a data URI in the single-file build. `--font` is the system UI stack, so everyone sees
      their OS's form font. The palette is already considered; typography is the
      missing half of the identity.
- [x] **Reorder the panels:** object and simulator first, answer docked to them.
      Currently answer → simulator → inputs.
- [x] **A slim answer bar on phones** — figure, unit, badge, one line, docked where
      it cannot fight the canvas. `src/styles.css` carries a comment explaining the
      answer panel was un-stuck because it swallowed canvas pointer events; this is
      what that attempt was reaching for.
- [x] **The threshold moment.** Mark the instant the plumb line crosses the pivot.
      It is the whole drama and it currently passes as a line of text changing.
- [~] **The landing and the aftermath.** The chrome now clears on landing, so
      it stops looking like a bug. Still to do: letting it lie down. The body
      pivots about the plate's front edge and stops at 90°, hanging one
      plate-reach above the ground, and going further is a second phase of
      motion about a different contact — real physics rather than an easing
      curve. Faking it would be exactly the looseness the app cannot afford, so
      it is left for a proper go. *Again* not built.
- [x] **Objects, not dimensions** (pole mode). A row of real things that fill the
      fields: wheelie bin, fridge, vending machine, A-board, patio heater, road
      sign, Christmas tree. The preset pattern already exists — it is applied to
      parameters rather than to things. This is the "expression" half of the brief.
- [ ] **Hints on focus.** Not done. 2,281 characters of grey help shown at once becomes a
      texture. Keep the ones that teach something non-obvious.

## A fortnight — product

- [ ] **Solve backwards.** "It needs to survive 25 m/s — what do I need?" is the
      question people actually have; the app only answers the other direction. A
      bisection over `LedWall.solve()`. Highest value in the app, mostly plumbing.
- [ ] **A spec sheet.** One page: arrangement, setting-out dimensions, ballast per
      plate, wind it stands to, governing case, assumptions. The output the
      instrument has never had, and the thing that goes to a client.
- [ ] **The wall front-on as the thing that falls.** "Blow it over" currently
      renders a 300 mm section edge-on in a large empty box; the front view that
      looks like a 10 × 5 m wall is a static diagram two panels below. Keep the
      section as the explanation.
- [ ] **Make the canvas keyboard-operable.** Focusable, arrow keys to push, space
      to hold.
- [ ] **Guy lines, rakers, outriggers.** The assumptions say they change the answer
      completely — which means the app cannot yet model the most common way this
      problem is really solved.

---

## What must not be broken

- **The voice.** "The wall hanging off the front face is enough on its own."
- **Showing the working.** The working panel and assumptions blocks are what make
  the numbers trustworthy. Fun goes around them, never instead of them.
- **The warnings.** They name a cause and a fix, and refuse to give a count when no
  count works.
- **The LED answer panel.** Count, stat tiles, badge, what decides it. The pole side
  should copy this, not the reverse.
- **Live recalculation**, work surviving a reload, both modes' inputs surviving a
  switch.
- **The foundations:** reduced motion, metric and imperial throughout, a real dark
  theme, a visible focus ring, correct accessible names.

## The trap

A "make it fun" brief invites chrome — confetti, sounds, scores. This app's
credibility is its whole value, and the assumptions blocks are what earn it the
right to be playful anywhere else. A rigger who catches it being loose with the
physics will not come back.
