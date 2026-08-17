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

The two reaches are entered separately, with a checkbox to centre the truss and
mirror them. Worth knowing which way to spend a given footprint: on the
reference wall, a 1 m plate centred on the truss wants **9 uprights**, while the
same 1 m split 400 mm forward / 600 mm back does better — because reaching
forward lengthens the arm that resists the governing case, whereas reaching back
only helps the case that already has margin to spare. The default, 500 forward
and 1 m back, wants 6.

### How low the wall can sit, and whether resting on something helps

**The baseplate is in the way.** Where the plate reaches out under the wall, the
bottom of the wall cannot start any lower than the top of the plate — so the
baseplate's thickness is a floor on the trim height, and it is an input for that
reason. Ask for less and the app raises it, says so, and carries the raised
figure through: the wall goes up, and with it the height the wind acts at.

Whether the wall bearing down helps depends on **what it is bearing on**, and the
geometry decides which case you are in:

**On the baseplate** — the normal case, since the plate almost always runs under
the cabinets. **No change to overturning at all.** The plate is part of the
tipping body, so the wall resting on it just moves load around inside that body;
the weight still acts in the same place and the moments are untouched. The tests
check this holds exactly — same uprights, same ballast, same limiting wind, to
the last decimal.

**On the ground** — only possible when the plate stops short of the wall, and
then it always helps. The ground stops the wall's footing descending, so that
footing becomes the edge you tip about, and every lever arm grows by the
difference. There is no in-between case to worry about: reaching the ground
requires the plate to end at or before the truss face, and the wall's footing is
a cabinet depth forward of that face, so it is *necessarily* the outermost
contact. On the reference wall with the plate cut back to the truss face, the
footing at 270 mm takes it from **10 uprights to 7**, and flips the wall's own
weight from pulling it over to holding it down.

Two caveats on ever relying on that: the cabinets have to take being stood on,
which is a load path most are not designed for, and on uneven ground the sharing
is anyone's guess. Bearing does relieve vertical load and bending in the truss
either way — a real benefit, but a different question from overturning.

### The uprights can be shorter than the wall

The wall is a rigid structure bolted to the truss, so it does not have to stop
where the truss does — its own frame can carry the rows above the top of the
upright as a cantilever. Only two things are actually required: the two have to
overlap somewhere, so there is something to bolt to, and something has to be able
to carry the overhang.

**Overturning does not change at all.** The wall's weight and the wind on it act
in the same places whatever holds them up, so the moments about the baseplate edge
are untouched. Shortening the truss only changes its own mass and how much of it
is left out in the wind — and a truss hidden behind the wall catches nothing, so
the short version usually comes out slightly ahead.

**What it costs is bending**, and that is reported rather than added in, because
it is a different check: the wind on the overhanging strip has to be carried back
down through the connection at the top of each upright.

```
moment at the upright top = q · Cf · (cantilever × spacing) · cantilever/2
```

It grows with the *square* of the overhang — double the cantilever and the force
doubles with the area while the arm doubles too. On the reference wall at 2 m
spacing:

| Uprights | Cantilever | Bending at each upright top |
| --- | --- | --- |
| 5.5 m — full height | none | — |
| 4.5 m | 1 m | 193 N·m |
| 3.5 m | 2 m | 385 N·m |
| 1.5 m | 4 m | 1542 N·m |

Nothing here checks that against anything, and neither the connection nor the
wall's own frame is modelled — which is exactly where this arrangement fails
first. A big overhang wants a header, or the manufacturer's word on what their
frame will span. The app flags the overhang, says what fraction of the wall is
hanging past the truss, and calls out separately when only a sliver of the wall
is actually backed by steel.

### Why upright height matters, and it is not the weight

Truss weighs very little next to the ballast holding it down — a 6 m upright is
39 kg against 300 kg of ballast — so if all you counted was its mass, making it
taller would look like an *improvement*. It isn't, because **the truss the wall
doesn't cover is out in the wind**.

Only the exposed part counts: whatever stands above the wall, plus anything
showing below it. A lattice is not a solid plate either, so only the fraction of
its projected face that is actually metal is loaded — the solidity, around 0.3
for box truss — and a lattice takes a higher force coefficient per unit of solid
area than a flat wall does, about 1.8. Both are inputs.

The face the wind sees is the one *across* the wall, the same way the wall's own
area is its width by its height. The depth runs along the wind and contributes
nothing to the projection, with the sheltered leeward face of the lattice folded
into that 1.8 instead. On box truss the two dimensions are equal so it makes no
difference; on a ladder truss, deep front-to-back and thin across, it is the
difference between the right answer and one several times too large.

On the reference wall, holding everything else still:

| Upright | Exposed | Truss's share of the overturning | Good for |
| --- | --- | --- | --- |
| 5.6 m — trimmed to the wall | 600 mm | under 1% | 11.2 m/s |
| 6 m | 1.0 m | 1% | 11.2 m/s |
| 12 m | 7.0 m | 27% | 11.0 m/s |
| 20 m | 15.0 m | 43% | **8.4 m/s** |

And there is a sting in the tail. The wall's wind load is fixed by its area, so
adding uprights divides it — but **each upright brings its own sail with it**, so
the truss load does not divide, it multiplies. Past a certain amount of exposed
truss, every upright you add costs more than it contributes, and the answer stops
being "you need more" and becomes "no number of them works". At 20 m the app says
exactly that, and names the reason: each upright brings 2220 N·m of its own wind
against the 3285 N·m it holds down. The fixes are cutting the uprights down to
the wall, reaching further forward, or more ballast — not more legs.

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

All three of those are *lower* bounds. There is also an upper one, which is how
many uprights fit behind the wall without interpenetrating — `width ÷ upright
width`, 33 for a 10 m wall on 300 mm truss. A criterion asking for more than that
is not asking for a bigger number: it cannot be met by adding legs at all, and
the app says so and states how far off it is ("it would take 66 and only 33 fit")
rather than quoting a count nobody could build. That ceiling also earns its keep
in the algebra: an end upright carries more than an interior one only once the
bays are narrower than an upright is wide, which needs more uprights than fit —
so on any buildable run the interior upright governs, and the load limit only
ever has to be solved for its share.

**Worked example**, and the defaults the app opens with: a 10 m × 5 m outdoor
wall at 40 kg/m² — 2 tonnes of panel — on 6 m of 300 mm box truss, baseplates
reaching 500 mm forward and 1 m back, in an 11 m/s (25 mph) wind.

- **6 uprights** at 1.94 m centres — decided by stability, not spacing or load
- **285 kg of ballast** per baseplate, 1710 kg in total
- Good for **11.2 m/s** with 1.5× in hand; over it goes at **13.7 m/s**
- Each upright carries 427 kg of wall and truss

Take the ballast away and stability alone wants 28 uprights — at which point the
600 mm baseplates would be overlapping, so the app calls it unbuildable rather
than pretending. Reach 900 mm forward instead of 500 mm and it drops to 5, and
the spacing limit takes over as what decides it. That is the whole point of
having it interactive.

### Keeping the truss out of sight behind the wall

The uprights stand behind the wall, so from the front they should not be visible
at all. Sideways that is a question of where they are set out: putting the end
upright's *centre* on the end of the wall leaves half its width sticking out past
it, which is exactly what you see on a badly set-out screen. So the outer face
goes flush with the end of the wall instead, and the centre sits half an upright
width in.

That changes the arithmetic of the whole run. With an upright width `tw`, the `n`
centres span `W − tw` rather than the full width, so every bay is a little
shorter than the naive figure:

```
spacing = (W − tw) / (n − 1)
```

On the default wall that is 1.94 m rather than 2.00 m, and it means the inset can
never cost you an upright — the bays shrink, so the spacing and load limits are
if anything easier to meet.

Each upright then carries the wall out to the middle of the bay either side of
it, and the two end ones also carry the strip that overhangs them:

```
interior share = spacing
end share      = spacing / 2 + tw / 2
```

Those add back up to the full width. An interior upright carries the most in any
sane arrangement, so it is the one the weight limit is checked against — with one
exception, which is a run of only two uprights. There is no interior one then,
and each takes half the wall rather than the whole of it. The old formula had
that case twice as heavy as it really is.

That split treats each bay as simply supported, which is the conventional first
pass and reasonable for LED cabinets hanging as discrete columns. A wall frame
stiff enough to act continuously over the supports throws rather more onto the
interior uprights — 10% to 25% more, depending on the number of bays — and
nothing here accounts for that. It is one more reason the load figure is a
sizing guide rather than a reaction to design a baseplate from.

None of this touches overturning. The inset moves mass sideways *along* the edge
the structure tips about, and the moment balance only cares about how far forward
or back things sit — so the required count for stability, the limiting wind speed
and the ballast are all identical either way. What it changes is the spacing you
set out to, the load each upright carries, and whether anyone can see the truss.

One practical consequence: the pitch no longer divides the wall width evenly, so
the uprights do not land on cabinet joints. 1.94 m on a 500 mm cabinet grid is
not a joint. If you would rather pin them to the grid, the bays come out uneven
and the number to check is the *widest* one, not the average — the app works even
bays over the inset run, so it will read a little optimistic in that case. The
setting-out dimensions it lists are from the left-hand end of the wall.

Three things it cannot hide, and the app says so rather than leaving you to
notice on site:

- **Above and below.** Uprights taller than the top of the wall show over it, and
  a wall held up off the ground leaves the legs showing under it. On the defaults
  that is 500 mm at each end of a 6 m upright behind a wall running 0.5 m to
  5.5 m up. The bottom one is a genuine trade rather than an oversight: the wall
  cannot start lower than the top of the baseplate running under it, and the only
  way to close that gap is to pull the plate back behind the truss face — which
  is the very forward reach that stops the thing tipping over.
- **The baseplates.** They are wider than the truss they carry — 600 mm against
  300 mm on the defaults — so the end ones stick out 150 mm each side, and the
  run wants 10.3 m of floor for a 10 m wall. They also reach 230 mm out in front
  of the wall face, which is the part people trip over. At floor level and
  normally dressed out, which is why these are reported as notes rather than
  warnings.
- **Anything off-axis.** Flush faces hide the truss from dead ahead only. The
  truss body sits the best part of half a metre behind the wall's front face, so
  it edges back into view as you walk round: roughly 150 mm at 20° off, 240 mm at
  30°. Insetting further is the wrong answer — it costs bay width and buys very
  little. A soft-goods return, or a wall wider than the run, is the answer.

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

### The centre of gravity, and the thing that actually moves

Worth being precise about, because it is easy to expect the wrong thing. The
centre of gravity is a **material point fixed in the object** — it never leaves
it, however far the thing rotates. What it does is swing round the pivot on a
fixed radius, rising as the object tips and reaching its highest point exactly at
the balance angle. That peak is why tipping costs energy, and why everything
after it is free.

The thing that moves *relative to the base* is the **plumb line** hanging from
it, and that is the whole test:

| | Plumb line lands | The weight is |
| --- | --- | --- |
| Upright | a full lever arm inside the pivot | holding it down |
| At the balance angle | exactly on the pivot | doing nothing |
| Past it | outside the pivot | pulling it over |

The simulation draws that plumb line, marks where it lands, and dimensions the
gap to the pivot — blue while it is inside, orange the moment it crosses. The
horizontal offset it reports *is* the righting lever arm: `righting moment =
weight × that offset`, which the tests check directly against the moment
calculation.

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
