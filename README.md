# Tipping Point

A small web app that works out how hard you have to push something to tip it
over. It does two jobs, chosen with a toggle:

**Single pole** — a **baseplate lying flat on the ground with a pole standing up
from its centre**: a sign post, a lamp standard, a camera stand, a patio
umbrella base.

**LED wall** — an **LED wall built onto the front of ballasted truss uprights**,
standing in for a ground support structure. Enter the wall and it tells you how
many uprights you need, how much ballast goes on each baseplate, and what wind
it will take.

Either way it works from the weights and sizes, tells you which direction is
worst, how far the thing can lean before it goes over on its own, and whether it
will slide across the floor instead of tipping.

Then you can push it over. Drag the object, or dial in a force — a wind speed, in
LED mode — and hold it, and watch the thing lift onto its edge, teeter, drop
back, or go over, with the two moments shown fighting each other in real time.
Everything updates live: nudge a weight while it is mid-lean and the balance
shifts under it.

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

## LED wall on ground support

Multiple baseplate-and-upright bays spaced across the width of a wall, with the
panels hung on the front face of the truss. Two things change the problem
completely compared with a bare pole.

**The wall's weight is already trying to tip it.** Hung on the front face, the
panels' mass sits `truss depth ÷ 2 + cabinet depth ÷ 2` forward of the upright's
centreline. If the baseplate doesn't reach at least that far forward, the
structure is being pulled over before any wind arrives. The reach in front of
the truss is the single most valuable number in the whole calculation, and it is
usually the one you have least room for — the wall is in the way.

**Wind is what decides it**, and the two directions are not symmetric:

| | Tips about | The wall's own weight |
| --- | --- | --- |
| Wind on the face | rear edge of the baseplates | sits well forward — **helps** |
| Wind from behind | front edge | barely inside it — **hurts** |

So the case that governs is almost always wind from *behind* the screen, over
the front edge. On the worked example below the two come out at 2.90× and 1.57×
— the "easy" direction has nearly twice the margin.

Wind force is `½ρv²` × a force coefficient × the wall area, with the resultant
at mid-height. Both wind speeds get reported, because they answer different
questions: the speed at which the **safety factor runs out**, and the speed at
which it **actually goes over** (which is `√(safety factor)` times higher, since
moment goes with v²).

### How many uprights

Three separate limits, and the app tells you which one is binding:

1. **Spacing** — how far apart the wall's own framing lets them sit.
2. **Weight per upright** — the wall mass each one has to carry.
3. **Stability** — and this is the interesting one.

Adding uprights helps stability in a way that isn't obvious. The wind load is
fixed by the wall's area, so it does *not* grow when you add a bay — but every
upright you add brings another baseplate, another set of ballast, and another
lever arm resisting the same overturning moment. With `n` uprights:

```
n ≥ ( safety × overturning − what the wall itself resists ) / ( what one upright adds )
```

which is a closed form, so the answer is exact rather than iterated. The same
algebra run backwards gives the ballast each baseplate needs, rounded up to
something you can actually order.

**Worked example**, and the defaults the app opens with: a 10 m × 5 m outdoor
wall at 40 kg/m² — 2 tonnes of panel — on 6 m of 300 mm box truss, baseplates
reaching 500 mm forward and 1 m back, in an 11 m/s (25 mph) wind.

- **6 uprights** at 2 m centres — decided by stability, not spacing or load
- **280 kg of ballast** per baseplate, 1680 kg in total
- Good for **11.3 m/s** with 1.5× in hand; over it goes at **13.8 m/s**
- Each upright carries 439 kg of wall and truss

Take the ballast away and it wants 26 uprights. Reach 900 mm forward instead of
500 mm and it drops to 4. That is the whole point of having it interactive.

### What it does not do

It checks **overturning only**, and it is a first pass rather than a design.
Ground support carrying a wall over people is life-safety kit: a real one is
signed off by a structural engineer against the manufacturer's load data and a
wind standard — ANSI E1.21 for outdoor temporary structures, EN 13782, with the
wind itself from ASCE 7 or EN 1991-1-4, which add gust, exposure and height
factors this does not.

It says nothing about whether the truss can carry the load, whether the
baseplate or the wall's framing can take the bending, or what the connections
see. Worth noting that the eccentric wall load puts a permanent bending moment
into every upright, which wants checking separately. Guy lines, rear rakers,
outriggers and tying into a building all change the answer — usually for the
better — and none of them are modelled.

### Pushing it for real

The static formula says whether it goes; the simulation says what happens next.
It integrates the assembly rotating about its pivot edge:

```
I·θ̈ = F·R·sin(γ + θ − θp)   the push
     − W·r·cos(ψ + θ)        its own weight holding it down
     − m·a·h_cm(θ)           relief from the base sliding away
```

with `θ` the lean from upright, `r, ψ` locating the centre of mass from the pivot
and `R, γ` locating the point being pushed. `I` is the real moment of inertia of
the assembly about that edge — plate as a slab, pole as a rod offset from it,
anything on top as a point mass.

At `θ = 0` with the base held, this collapses back to `F = W·d/h`. That is worth
stating plainly: the simulation and the calculator are separate pieces of code
that have to agree, and [the tests](test/sim.test.mjs) check they do — analytically
and by bisecting the simulation to find the force at which it actually falls.

Three things the simulation shows that a single number cannot:

- **Momentum counts.** Release the push before the balance point and it can still
  go over, carried by what it has already gained. That is why a knock tips things
  a steady push of the same size will not, and it is what the energy figure is
  for — feed the assembly exactly that much rotational energy and it *just* makes
  it over. There is a test for that too.
- **Sliding relieves tipping.** A base free to skate away accelerates, and that
  acceleration acts through the centre of mass as a moment *against* tipping. On a
  slippery enough floor it slides instead of going over. Untick **Base held** to
  watch it happen. With the base held there is no acceleration and the term
  vanishes, which is the case the headline number describes.
- **Weight high up costs stability, not force.** Move weight from the plate to the
  top of the pole, keeping the total the same, and the steady force needed does not
  change at all — `W·d/h` knows nothing about how high the weight sits. But the lean
  it can survive shrinks, and the knock needed to topple it drops sharply.

Once it has lifted, the pivot edge is taken as fixed, and a corner push is
simulated as the equivalent flat-on problem — exact for the tipping point and the
lean, approximate only for how fast it falls.

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
src/physics.js             pole statics — no DOM, no dependencies
src/ledwall.js             LED wall on ground support: wind, ballast, upright count
src/sim.js                 the dynamics — also pure, also testable
src/app.js                 form handling, rendering, SVG diagrams, canvas sim
src/styles.css             styling, light and dark
sw.js                      service worker, for offline use
manifest.webmanifest       PWA manifest, for installing
icons/                     generated app icons
test/physics.test.mjs      tests for the pole statics
test/ledwall.test.mjs      tests for the LED wall calculations
test/sim.test.mjs          tests for the dynamics, incl. agreement with the statics
tools/make-icons.mjs       draws and encodes the icons from scratch
tools/build-single-file.mjs bundles everything into dist/
tools/serve.mjs            static file server for local use
```

`src/physics.js` and `src/sim.js` are deliberately free of anything
browser-specific, so the test suite loads the exact files the app runs. Expected
values are worked by hand from the moment balance rather than copied out of the
implementation; the claimed best-push angle is checked against a brute-force
sweep, and the simulation is checked against the statics both analytically and by
bisection.

State is kept in `localStorage`, and **Copy link** puts the whole setup in the
URL so a particular scenario can be bookmarked or sent to someone.

The simulation only asks for animation frames while something is moving — a
still object costs nothing, and it stops entirely when the tab is hidden.

## Licence

MIT.
