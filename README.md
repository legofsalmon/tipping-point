# Tipping Point

A small web app that works out how hard you have to push something to tip it
over. The shape it models is a **baseplate lying flat on the ground with a pole
standing up from its centre** — a sign post, a lamp standard, a camera stand, a
patio umbrella base.

Enter the weights and sizes, and it tells you the force needed at the top of the
pole, which way is easiest to push, how far it can lean before it goes over on
its own, and whether it will just slide across the floor instead.

Runs in any modern browser — macOS, Windows, Android, iOS — with no build step,
no server and no network once it has loaded.

---

## Using it

Open `index.html`. That's it.

For offline use and a proper app icon, install it:

| Platform | How |
| --- | --- |
| iPhone / iPad | Safari → Share → **Add to Home Screen** |
| Android | Chrome → ⋮ → **Install app** / **Add to Home screen** |
| macOS | Safari → File → **Add to Dock**, or Chrome → ⋮ → Cast, Save & Share → **Install** |
| Windows | Chrome or Edge → the **install** icon in the address bar |

Installing needs the app served over `http(s)` rather than opened off the disk,
because that's what service workers require. Any static host will do — see
[Publishing it](#publishing-it).

### Local development

```sh
npm run serve     # http://localhost:8080, with the service worker working
npm test          # the physics test suite
npm run build     # bundle everything into dist/tipping-point.html
npm run icons     # regenerate the app icons from tools/make-icons.mjs
```

There are no dependencies to install. Node 20 or newer is needed for the tests
and the tools; the app itself is plain browser JavaScript.

`npm run build` produces **one self-contained HTML file** with the CSS and JS
inlined. Mail it to yourself, drop it in a shared folder, keep it on a USB
stick — it opens straight off the disk with no connection at all.

---

## The physics

Tipping is a moments problem. The assembly pivots about the edge of the
baseplate nearest the push, and it starts to go over at the moment the pushing
moment matches the moment holding it down:

```
F · h · c · cosθ  =  W · d  +  F · d · sinθ
```

which rearranges to what the app calculates:

```
        W · d
F = ─────────────────────
    h·c·cosθ − d·sinθ
```

| | |
| --- | --- |
| `W` | total weight, `(plate + pole + anything on top) × g` |
| `d` | lever arm: distance from the centre out to the pivot edge |
| `h` | height above the ground at which you push |
| `θ` | push angle; 0 is level, positive is angled down into the ground |
| `c` | how much of the push acts across the pivot edge (see below) |

With a level push square-on to an edge, `c = 1` and `cosθ = 1`, and the whole
thing collapses to the version worth remembering:

```
F = W · d / h
```

Wide base, heavy base, low push → hard to tip. Narrow base, tall pole → easy.

### Which way you push matters

Rotation can only happen about an edge of the baseplate, and only the part of
your push that acts across that edge does anything. That gives each direction
its own effective lever arm:

| Direction | Effective lever arm |
| --- | --- |
| Square-on to an edge | half that plate dimension |
| Straight at a corner | half the **diagonal** |

So a corner is the *hardest* direction, not the easiest — pushing diagonally at
a square base needs about 1.41× the force of pushing square-on. The easiest
direction is always square-on, across the plate's shortest dimension.

### The best angle is slightly upwards

Angling the push downwards helps hold the object down, so it needs more force.
Angling it upwards reduces the downforce but also throws away some of the
horizontal component. The two effects balance at

```
θ = −arctan( d / (h·c) )
```

which is exactly the angle where the force is perpendicular to the line from the
pivot to your hand, so all of it becomes leverage. For a typical sign post
that's only 7–9° above level, and it saves about 1% of the force — a nice bit of
physics rather than a useful trick. The app reports it either way.

### Sliding instead of tipping

Something on a slippery floor slides away before it ever tips. That happens
below

```
F = µW / (cosθ − µ·sinθ)
```

so the app compares the two and tells you which comes first. If it slides, the
tipping force is still shown — it's what you'd need with the base chocked or up
against a kerb.

### Other things it reports

- **Centre of mass height**, treating the plate as a uniform slab, the pole as a
  uniform rod standing on it, and anything extra as a point mass at the top.
- **Tilt angle before it goes** — `arctan(d / h_cm)`. Past this, its own weight
  carries it over and you can let go.
- **Energy to tip** — the work to lift the centre of mass onto the balance point,
  `W · (√(d² + h_cm²) − h_cm)`. This is the figure that matters for a knock or a
  gust rather than a steady push, because a sharp impact can tip something that
  a steady push of the same size cannot.
- **Ground reaction** as it lifts. This one is always positive, whatever the
  angle: substituting `F` back in gives `N = W·h·c·cosθ / (h·c·cosθ − d·sinθ)`,
  so a push can pivot the object or slide it, but never lift it clear.

### What it assumes

- Everything is rigid, and the pole is fixed solidly to the plate.
- The ground is flat, level and hard.
- The push is steady, not a sudden impact.
- The plate and pole are uniform, and the pole is centred on the plate.
- The answer is the force at which it *starts* to lift, which is also the
  hardest point — past the balance point it needs less and less.
- It answers "will it tip", not "will it break". A tall pole may bend or shear
  at its base long before the plate lifts.

---

## Publishing it

Any static host works. For GitHub Pages:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Merge to `main`.

`.github/workflows/pages.yml` then publishes the repository root on every push
to `main`. Until Pages is enabled in the settings that workflow will fail — the
step that fails is `configure-pages`, and nothing else is affected.

---

## Layout

```
index.html                 markup, and the only page
src/physics.js             the maths — no DOM, no dependencies
src/app.js                 form handling, rendering, the SVG diagrams
src/styles.css             styling, light and dark
sw.js                      service worker, for offline use
manifest.webmanifest       PWA manifest, for installing
icons/                     generated app icons
test/physics.test.mjs      tests for the physics
tools/make-icons.mjs       draws and encodes the icons from scratch
tools/build-single-file.mjs bundles everything into dist/
tools/serve.mjs            static file server for local use
```

`src/physics.js` is deliberately free of anything browser-specific, so the test
suite loads the exact file the app runs. Expected values in the tests are worked
by hand from the moment balance, and the claimed best-push angle is checked
against a brute-force sweep.

State is kept in `localStorage`, and **Copy link** puts the whole setup in the
URL so a particular scenario can be bookmarked or sent to someone.

## Licence

MIT.
