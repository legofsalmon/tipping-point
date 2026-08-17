/*
 * Tests for the LED wall ground support calculations.
 *
 * The reference case throughout is a 10 m × 5 m outdoor wall on 6 m uprights,
 * with the moments worked by hand in the comments so a change in the code
 * shows up here rather than in someone's ballast order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const W = require('../src/ledwall.js');

const G = 9.80665;

const baseline = {
  wallWidth: 10,
  wallHeight: 5,
  wallBottom: 0.5,
  wallDepth: 0.12,
  wallArealMass: 40,

  trussHeight: 6,
  trussDepth: 0.3,
  trussLinearMass: 6.5,

  plateFront: 0.5,
  plateBack: 1.0,
  plateWidth: 0.6,
  plateMass: 60,
  ballastMass: 300,

  windSpeed: 11,
  forceCoefficient: 1.3,
  safetyFactor: 1.5,
  maxSpacing: 3,
  maxLoadPerUpright: 500,
  gravity: G
};

const near = (actual, expected, tol = 1e-6, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ? msg + ': ' : ''}expected ${expected}, got ${actual} (tolerance ${tol})`
  );

/* ------------------------------- layout -------------------------------- */

test('wall mass and geometry come out of the dimensions', () => {
  const L = W.layout(baseline);
  near(L.area, 50);
  near(L.wallMass, 2000); // 50 m² × 40 kg/m²
  near(L.wallCentreHeight, 3); // 0.5 m up, 5 m tall
  near(L.wallTop, 5.5);
  // hangs off the front face: half the truss depth plus half the cabinet depth
  near(L.wallX, 0.3 / 2 + 0.12 / 2);
  near(L.wallX, 0.21);
  near(L.trussMass, 39); // 6 m × 6.5 kg/m
  near(L.plateDepth, 1.5);
  near(L.plateCentroidX, -0.25); // reaches further back than forward
  near(L.ballastX, -0.25); // ballast defaults to over the plate's middle
});

test('ballast can be placed away from the middle of the plate', () => {
  const L = W.layout({ ...baseline, ballastX: -0.8 });
  near(L.ballastX, -0.8);
});

/* -------------------------------- wind --------------------------------- */

test('wind pressure is half rho v squared', () => {
  near(W.windPressure(11, 1.225), 0.5 * 1.225 * 121);
  near(W.windPressure(11, 1.225), 74.1125);
  near(W.windPressure(0, 1.225), 0);
});

test('wind force scales with area and coefficient', () => {
  const r = W.solve(baseline);
  near(r.windPressure, 74.1125, 1e-9);
  // 74.1125 × 1.3 × 50
  near(r.windForce, 74.1125 * 1.3 * 50, 1e-9);
  near(r.windForce, 4817.3125, 1e-9);
});

test('Beaufort numbers line up with the scale', () => {
  assert.equal(W.beaufort(0), 0);
  assert.equal(W.beaufort(5), 3);
  assert.equal(W.beaufort(11), 6); // strong breeze, 10.8-13.8 m/s
  assert.equal(W.beaufort(18), 8); // gale
  assert.equal(W.beaufort(40), 12);
  assert.equal(W.BEAUFORT_NAMES[W.beaufort(10)], 'fresh breeze');
  assert.equal(W.BEAUFORT_NAMES[W.beaufort(11)], 'strong breeze');
});

test('wind speed units convert both ways', () => {
  near(W.toBase(1, 'mph', W.SPEED_UNITS), 0.44704);
  near(W.toBase(36, 'km/h', W.SPEED_UNITS), 10);
  near(W.toBase(1, 'kn', W.SPEED_UNITS), 0.514444);
  for (const unit of Object.keys(W.SPEED_UNITS)) {
    near(W.fromBase(W.toBase(7.3, unit, W.SPEED_UNITS), unit, W.SPEED_UNITS), 7.3, 1e-12);
  }
  near(W.toBase(1, 'lb/ft²', W.AREAL_UNITS), 4.882427636);
  near(W.toBase(1, 'lb/ft', W.LINEAR_UNITS), 1.488163944);
});

/* ------------------------------- moments ------------------------------- */

test('moments about the front edge, worked by hand', () => {
  const L = W.layout(baseline);
  const m = W.moments(L, 6, 0, 1);

  // pivot at +0.5; wall at +0.21 so its arm is 0.29 behind the pivot
  near(m.pivotX, 0.5);
  near(2000 * G * 0.29, 5687.857, 1e-3);
  // truss at 0 -> arm 0.5, six of them
  near(6 * 39 * G * 0.5, 1147.378, 1e-3);
  // plate and ballast at -0.25 -> arm 0.75
  near(6 * 60 * G * 0.75, 2647.795, 1e-3);
  near(6 * 300 * G * 0.75, 13238.977, 1e-3);

  near(m.restoring, 5687.857 + 1147.378 + 2647.795 + 13238.977, 0.02);
  near(m.overturning, 0, 1e-9);
  assert.equal(m.ratio, Infinity);
});

test('the wall helps when tipping backward and hinders when tipping forward', () => {
  const L = W.layout(baseline);
  const wallItem = (dir) =>
    W.moments(L, 6, 0, dir).items.find((i) => i.name === 'LED wall');

  // forward: only 0.29 m of arm, since the wall is nearly over the front edge
  near(wallItem(1).arm, 0.29);
  // backward: 0.21 + 1.0 of arm, a big help
  near(wallItem(-1).arm, 1.21);
  assert.ok(wallItem(-1).moment > wallItem(1).moment * 4);
});

test('a wall hanging past the front edge becomes an overturning load', () => {
  // shallow reach in front, deep truss: the wall's mass ends up outside
  const L = W.layout({ ...baseline, plateFront: 0.1, trussDepth: 0.5 });
  near(L.wallX, 0.31);
  const m = W.moments(L, 6, 0, 1);
  const wall = m.items.find((i) => i.name === 'LED wall');
  assert.ok(wall.arm < 0, 'arm should be negative');
  assert.ok(m.overturning > 0, 'and it should show up as overturning');
  near(m.overturning, 2000 * G * 0.21, 1e-3);
});

test('wind adds an overturning moment at the height of the wall centre', () => {
  const L = W.layout(baseline);
  const m = W.moments(L, 6, 4817.3125, 1);
  near(m.windArm, 3);
  near(m.windMoment, 4817.3125 * 3, 1e-9);
  near(m.overturning, 14451.9375, 1e-9);
});

/* --------------------------- how many uprights ------------------------- */

test('the reference wall needs six uprights, and stability is what decides it', () => {
  const r = W.solve(baseline);
  assert.equal(r.ok, true);

  /* Forward case, by hand:
   *   overturning = 4817.313 × 3                      = 14451.94
   *   needed      = 1.5 × 14451.94                    = 21677.91
   *   wall gives                                      =  5687.86
   *   each upright gives 39×g×0.5 + 60×g×0.75 + 300×g×0.75
   *                      = 191.23 + 441.30 + 2206.50  =  2839.03
   *   n >= (21677.91 - 5687.86) / 2839.03 = 5.63      -> 6
   */
  assert.equal(r.byCase.forward.uprightsNeeded, 6);
  assert.equal(r.uprights, 6);
  assert.equal(r.governingConstraint.id, 'stability');

  // and the other two constraints are satisfied well before that
  assert.equal(r.constraints.find((c) => c.id === 'spacing').n, 5); // ceil(10/3)+1
  assert.equal(r.constraints.find((c) => c.id === 'load').n, 5); // ceil(2000/500)+1
});

test('six uprights make five bays at two metres', () => {
  const r = W.solve(baseline);
  near(r.spacing, 2); // 10 m over 5 bays
  near(r.wallMassPerUpright, 400); // 2000 kg over 5 bays
  near(r.loadPerUpright, 400 + 39);
  near(r.totalMass, 2000 + 6 * (39 + 60 + 300));
  near(r.ballastTotal, 1800);
});

test('the forward case is the one that governs', () => {
  const r = W.solve(baseline);
  assert.equal(r.governingCase.id, 'forward');
  assert.ok(r.byCase.forward.moments.ratio < r.byCase.backward.moments.ratio);
  assert.ok(r.passes, 'six uprights should clear the safety factor');
  assert.ok(r.worstRatio >= r.safetyFactor);
});

test('wider spacing limits force more uprights', () => {
  const tight = W.solve({ ...baseline, maxSpacing: 1.2 });
  // ceil(10/1.2)+1 = 10
  assert.equal(tight.constraints.find((c) => c.id === 'spacing').n, 10);
  assert.equal(tight.uprights, 10);
  assert.equal(tight.governingConstraint.id, 'spacing');
});

test('a per-upright weight limit can be what decides it', () => {
  const r = W.solve({ ...baseline, maxLoadPerUpright: 150, ballastMass: 600 });
  // ceil(2000/150)+1 = 15
  assert.equal(r.constraints.find((c) => c.id === 'load').n, 15);
  assert.equal(r.uprights, 15);
  assert.equal(r.governingConstraint.id, 'load');
  assert.ok(r.wallMassPerUpright <= 150 + 1e-9);
});

test('more ballast per base means fewer uprights', () => {
  const light = W.solve({ ...baseline, ballastMass: 100 });
  const heavy = W.solve({ ...baseline, ballastMass: 900 });
  assert.ok(heavy.uprights < light.uprights);
  // with enough ballast the spacing limit takes over instead
  assert.equal(heavy.governingConstraint.id, 'spacing');
});

test('reaching further forward with the baseplate is worth more than ballast', () => {
  const asIs = W.solve(baseline);
  const deeper = W.solve({ ...baseline, plateFront: 0.9 });
  assert.ok(deeper.uprights < asIs.uprights);
  assert.ok(deeper.byCase.forward.moments.ratio > asIs.byCase.forward.moments.ratio);
});

test('stacking the ballast at the back helps the forward case', () => {
  const middle = W.solve(baseline);
  const atBack = W.solve({ ...baseline, ballastX: -0.85 });
  assert.ok(atBack.byCase.forward.moments.ratio > middle.byCase.forward.moments.ratio);
  assert.ok(atBack.uprights <= middle.uprights);
});

test('a hopeless geometry is reported as hopeless, not as "add more legs"', () => {
  /* Baseplate barely reaches in front and the ballast sits forward of the
   * pivot, so every upright added makes it worse. */
  const r = W.solve({
    ...baseline,
    plateFront: 0.05,
    plateBack: 0.05,
    trussDepth: 0.6,
    ballastX: 0.4
  });
  assert.equal(W.uprightsForStability(r.layout, r.windForce, 1, 1.5), Infinity);
  assert.match(r.warnings.join(' '), /Adding uprights will not fix this/);
  // and it should blame the baseplate geometry, not the wind
  assert.match(r.warnings.join(' '), /mm in front of the truss/);
});

test('an upright count can be forced, and is flagged when it is too few', () => {
  const r = W.solve({ ...baseline, uprights: 3 });
  assert.equal(r.uprights, 3);
  assert.equal(r.usingOverride, true);
  assert.equal(r.minimumUprights, 6);
  assert.match(r.warnings.join(' '), /want at least 6/);
  assert.equal(r.passes, false);
});

/* -------------------------------- ballast ------------------------------ */

test('ballast needed per baseplate is reported, and matches by hand', () => {
  const r = W.solve({ ...baseline, ballastMass: 0, uprights: 6 });
  /* Without ballast, forward case. The exposed truss adds a little wind of its
   * own: 1 m of it showing, 0.09 m² of metal, 12.0 N each at 3 m up.
   *   restoring   = 5687.86 + 1147.38 + 2647.80      = 9483.03
   *   overturning = 14451.94 + 6 × 36.02             = 14668.04
   *   needed      = 1.5 × 14668.04                   = 22002.06
   *   shortfall   = 12519.03
   *   per base    = 12519.03 / (6 × g × 0.75)        = 283.7 kg
   */
  near(r.byCase.forward.ballast, 283.7, 0.5);
  near(r.ballastNeededPerUpright, 283.7, 0.5);
  assert.match(r.warnings.join(' '), /Ballast is short/);
});

test('plenty of ballast means the figure asked for is comfortably below it', () => {
  // the ballast figure is what the case NEEDS, not what is still missing
  const r = W.solve({ ...baseline, ballastMass: 1200 });
  assert.ok(r.byCase.forward.ballast < 1200, `asked for ${r.byCase.forward.ballast}`);
  assert.ok(r.byCase.backward.ballast < 1200);
  assert.ok(!/Ballast is short/.test(r.warnings.join(' ')));
  assert.equal(r.passes, true);
});

test('a case that already stands up unballasted asks for none', () => {
  // wind on the face is held by the wall's own weight here, with room to spare
  const r = W.solve({ ...baseline, windSpeed: 2, ballastMass: 0 });
  near(r.byCase.backward.ballast, 0, 1e-9);
});

test('at the ballast it asks for, the governing case lands exactly on the factor', () => {
  for (const uprights of [4, 6, 9]) {
    const asked = W.solve({ ...baseline, ballastMass: 0, uprights });
    const needed = asked.ballastNeededPerUpright;
    const retried = W.solve({ ...baseline, ballastMass: needed, uprights });
    near(
      retried.byCase[asked.governingCase.id].moments.ratio,
      retried.safetyFactor,
      1e-6,
      `at ${uprights} uprights`
    );
    assert.equal(retried.passes, true);
  }
});

test('with no ballast at all it wants a great many uprights', () => {
  /* need = 1.5 × 14451.94 − 5687.86            = 15990.05
   * each upright: +632.53 restoring, and brings 36.02 of its own truss wind
   *   per = 632.53 − 1.5 × 36.02               =   578.50
   *   n >= 15990.05 / 578.50 = 27.6            -> 28
   */
  const r = W.solve({ ...baseline, ballastMass: 0 });
  assert.equal(r.byCase.forward.uprightsNeeded, 28);
  assert.equal(r.governingConstraint.id, 'stability');
});

/* ---------------------------- limiting wind ---------------------------- */

test('the limiting wind speed is where the safety factor runs out', () => {
  const r = W.solve(baseline);
  const limit = r.byCase.forward.limitingWind;
  assert.ok(limit > 11, 'should be above the design wind, since it passes');

  // re-solve at exactly that speed and the ratio should sit on the factor
  const atLimit = W.solve({ ...baseline, windSpeed: limit, uprights: r.uprights });
  near(atLimit.byCase.forward.moments.ratio, r.safetyFactor, 1e-6);
});

test('the reported limit is the lower of the two wind directions', () => {
  const r = W.solve(baseline);
  near(
    r.limitingWindSpeed,
    Math.min(r.byCase.forward.limitingWind, r.byCase.backward.limitingWind),
    1e-12
  );
  // wind from behind is the weaker direction here
  assert.ok(r.byCase.forward.limitingWind < r.byCase.backward.limitingWind);
});

test('a structure that cannot stand up in still air has a limit of zero', () => {
  const r = W.solve({
    ...baseline,
    plateFront: 0.15,
    trussDepth: 0.6,
    ballastMass: 0,
    plateMass: 5,
    uprights: 2
  });
  near(r.byCase.forward.limitingWind, 0, 1e-12);
  assert.match(r.warnings.join(' '), /pulling the structure over|standing still/);
});

test('halving the wind speed quarters the force', () => {
  const full = W.solve({ ...baseline, windSpeed: 20 });
  const half = W.solve({ ...baseline, windSpeed: 10 });
  near(full.windForce / half.windForce, 4, 1e-9);
});

test('a taller wall is much worse than a wider one of the same area', () => {
  // same upright count both times, so height is the only thing changing
  const tall = W.solve({ ...baseline, wallWidth: 5, wallHeight: 10, trussHeight: 11, uprights: 8 });
  const wide = W.solve({ ...baseline, wallWidth: 10, wallHeight: 5, trussHeight: 6, uprights: 8 });
  near(tall.layout.area, wide.layout.area);
  near(tall.windForce, wide.windForce, 1e-9);
  // same force, but applied nearly twice as high up
  assert.ok(tall.byCase.forward.moments.windMoment > wide.byCase.forward.moments.windMoment * 1.7);
  assert.ok(tall.byCase.forward.limitingWind < wide.byCase.forward.limitingWind);
});

test('raising the wall off the ground makes it worse, not better', () => {
  const low = W.solve({ ...baseline, wallBottom: 0, uprights: 6 });
  const high = W.solve({ ...baseline, wallBottom: 2, trussHeight: 7.5, uprights: 6 });
  assert.ok(high.byCase.forward.moments.windMoment > low.byCase.forward.moments.windMoment);
  assert.ok(high.byCase.forward.limitingWind < low.byCase.forward.limitingWind);
  // and left to size itself, it wants more uprights
  assert.ok(
    W.solve({ ...baseline, wallBottom: 2, trussHeight: 7.5 }).uprights >=
      W.solve({ ...baseline, wallBottom: 0 }).uprights
  );
});

/* ------------------------------ validation ----------------------------- */

test('missing inputs are reported', () => {
  const empty = W.solve({});
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.length >= 3);

  const noPanel = W.solve({ ...baseline, wallArealMass: 0 });
  assert.equal(noPanel.ok, false);
  assert.match(noPanel.errors.join(' '), /panel weight/);
});

test('a wall taller than its uprights is fine — it cantilevers', () => {
  /* The wall is a rigid structure bolted to the truss, so its own frame can
   * carry the rows above the top of the upright. */
  const r = W.solve({ ...baseline, trussHeight: 4 });
  assert.equal(r.ok, true);
  near(r.layout.wallCantilever, 5.5 - 4); // wall tops out at 5.5
  near(r.layout.wallOverlap, 4 - 0.5); // and 3.5 m of it is backed by truss
  near(r.layout.cantileverFraction, 1.5 / 5);
  assert.ok(r.uprights >= 2);
  assert.match(r.warnings.join(' '), /1500 mm above the top of the uprights/);
});

test('the wall must at least reach the truss to be bolted to it', () => {
  // uprights stop below where the wall starts: nothing to fix it to
  const r = W.solve({ ...baseline, trussHeight: 0.4, wallBottom: 1.5, plateFront: 0.15 });
  assert.equal(r.ok, false);
  near(r.layout.wallOverlap, 0);
  assert.match(r.errors.join(' '), /nothing for it to be bolted to/);
});

test('a cantilever does not change the overturning, only what carries it', () => {
  /* The wall's weight and the wind on it act in the same places whatever holds
   * them up, so the moments about the baseplate edge are unmoved. Shortening
   * the truss changes only its own mass and its exposed length. */
  const full = W.solve({ ...baseline, trussHeight: 5.5, uprights: 6 });
  const short = W.solve({ ...baseline, trussHeight: 4, uprights: 6 });

  const wallOf = (r) => r.byCase.forward.moments.items.find((i) => i.name === 'LED wall');
  near(wallOf(short).arm, wallOf(full).arm, 1e-12);
  near(wallOf(short).moment, wallOf(full).moment, 1e-12);
  near(short.byCase.forward.moments.wallWindMoment,
    full.byCase.forward.moments.wallWindMoment, 1e-12);

  // neither has truss showing above the wall, so the difference is just mass
  near(short.layout.trussExposedAbove, 0);
  near(full.layout.trussExposedAbove, 0);
  assert.ok(short.layout.trussMass < full.layout.trussMass);
});

test('the cantilever bending is reported, and grows with the square of it', () => {
  const at1 = W.solve({ ...baseline, trussHeight: 4.5, uprights: 6 }); // 1 m over
  const at2 = W.solve({ ...baseline, trussHeight: 3.5, uprights: 6 }); // 2 m over
  near(at1.layout.wallCantilever, 1);
  near(at2.layout.wallCantilever, 2);

  // force goes with the area, and the arm with half the height, so 4x
  near(at2.cantileverMoment / at1.cantileverMoment, 4, 1e-9);

  // and by hand: q x Cf x (cantilever x spacing) x cantilever/2
  const q = W.windPressure(11, 1.225);
  near(at1.cantileverMoment, q * 1.3 * (1 * 2) * 0.5, 1e-6);
});

test('a thin sliver of overlap is called out', () => {
  const r = W.solve({ ...baseline, trussHeight: 1.5 });
  near(r.layout.wallOverlap, 1);
  assert.ok(r.layout.wallOverlap < r.layout.wallHeight * 0.3);
  assert.match(r.warnings.join(' '), /Only 1000 mm of the wall is actually backed by truss/);
});

test('no cantilever means no cantilever moment or warning', () => {
  const r = W.solve({ ...baseline, trussHeight: 6 });
  near(r.layout.wallCantilever, 0);
  near(r.cantileverMoment, 0);
  assert.ok(!/above the top of the uprights/.test(r.warnings.join(' ')));
});

test('overlapping baseplates are flagged', () => {
  const r = W.solve({ ...baseline, plateWidth: 3, maxSpacing: 1 });
  assert.match(r.warnings.join(' '), /baseplates would overlap/);
});

test('junk inputs do not produce NaN', () => {
  const r = W.solve({
    ...baseline,
    wallArealMass: 'heavy',
    ballastMass: -50,
    trussLinearMass: NaN,
    windSpeed: -3
  });
  assert.ok(Number.isFinite(r.windForce));
  assert.ok(Number.isFinite(r.totalMass));
  assert.ok(Number.isFinite(r.uprights));
  near(r.windSpeed, 0);
});

test('gravity is applied throughout', () => {
  const earth = W.solve(baseline);
  const moon = W.solve({ ...baseline, gravity: 1.62 });
  // wind does not care about gravity, but everything holding it down does
  near(earth.windForce, moon.windForce, 1e-9);
  assert.ok(moon.uprights > earth.uprights);
});

/* --------------------------- a whole-job check ------------------------- */

test('worked example: 16 m × 8 m outdoor wall', () => {
  const r = W.solve({
    ...baseline,
    wallWidth: 16,
    wallHeight: 8,
    wallBottom: 1,
    trussHeight: 9.5,
    trussDepth: 0.4,
    trussLinearMass: 9.2,
    plateFront: 0.6,
    plateBack: 1.2,
    plateMass: 90,
    ballastMass: 500,
    windSpeed: 11
  });

  assert.equal(r.ok, true);
  near(r.layout.area, 128);
  near(r.layout.wallMass, 5120); // 128 × 40
  near(r.layout.wallCentreHeight, 5); // 1 + 8/2
  near(r.windForce, W.windPressure(11, 1.225) * 1.3 * 128, 1e-6);

  // sanity: a big outdoor wall wants a lot of legs and a lot of steel
  assert.ok(r.uprights >= 7, `got ${r.uprights} uprights`);
  assert.ok(r.spacing <= 3 + 1e-9);
  assert.ok(r.limitingWindSpeed > 0);
  assert.equal(r.passes, true);
  assert.ok(r.totalMass > r.layout.wallMass);
});

/* ------------------- the two wind speeds, and buildability ------------- */

test('the safe limit and the actual tipping speed are different numbers', () => {
  const r = W.solve(baseline);
  assert.ok(r.tippingWindSpeed > r.limitingWindSpeed, 'it goes over above the safe limit');

  // at the tipping speed the ratio should be exactly 1 — no margin at all
  const atTip = W.solve({ ...baseline, windSpeed: r.tippingWindSpeed, uprights: r.uprights });
  near(atTip.byCase[r.governingCase.id].moments.ratio, 1, 1e-6);

  // and at the safe limit it should sit exactly on the factor
  const atLimit = W.solve({ ...baseline, windSpeed: r.limitingWindSpeed, uprights: r.uprights });
  near(atLimit.byCase[r.governingCase.id].moments.ratio, r.safetyFactor, 1e-6);
});

test('the safe limit scales as the square root of the safety factor', () => {
  // both speeds come from the same moment, and moment goes as v squared
  const r = W.solve(baseline);
  near(r.tippingWindSpeed / r.limitingWindSpeed, Math.sqrt(r.safetyFactor), 1e-6);
});

test('a layout whose baseplates would overlap is not called buildable', () => {
  const fine = W.solve(baseline);
  assert.equal(fine.buildable, true);

  const crammed = W.solve({ ...baseline, ballastMass: 0, plateFront: 0.15 });
  assert.ok(crammed.uprights > 20, `got ${crammed.uprights}`);
  assert.equal(crammed.buildable, false);
  assert.match(crammed.warnings.join(' '), /overlap/);
});

test('a geometry no number of uprights can fix is not buildable either', () => {
  const r = W.solve({
    ...baseline,
    plateFront: 0.05,
    plateBack: 0.05,
    trussDepth: 0.6,
    ballastX: 0.4
  });
  assert.equal(r.buildable, false);
});

/* ---------------------------- a centred truss -------------------------- */

test('a truss centred on its baseplate puts the plate centroid on the axis', () => {
  const L = W.layout({ ...baseline, plateFront: 0.5, plateBack: 0.5 });
  near(L.plateDepth, 1);
  near(L.plateCentroidX, 0); // symmetric, so the centroid is on the truss axis
  near(L.ballastX, 0); // and so is the ballast, by default

  // every part then has the same lever arm about the front edge: the reach
  const m = W.moments(L, 6, 0, 1);
  const arm = (name) => m.items.find((i) => i.name === name).arm;
  near(arm('truss'), 0.5);
  near(arm('baseplate'), 0.5);
  near(arm('ballast'), 0.5);
});

test('centring costs uprights, because the rear ballast loses its lever arm', () => {
  /* Same reach in front, but the plate no longer runs back past the truss, so
   * the plate and ballast arms drop from 0.75 m to 0.5 m:
   *   per upright = (39 + 60 + 300) x g x 0.5           = 1956.43
   *   n >= (21677.91 - 5687.86) / 1956.43 = 8.17        -> 9
   */
  const centred = W.solve({ ...baseline, plateFront: 0.5, plateBack: 0.5 });
  const offCentre = W.solve(baseline);

  assert.equal(centred.byCase.forward.uprightsNeeded, 9);
  assert.equal(centred.uprights, 9);
  assert.ok(centred.uprights > offCentre.uprights);

  // the same total depth set back instead does better for the same footprint
  const setBack = W.solve({ ...baseline, plateFront: 0.4, plateBack: 0.6 });
  near(setBack.layout.plateDepth, centred.layout.plateDepth);
  assert.ok(
    setBack.byCase.forward.moments.ratio < centred.byCase.forward.moments.ratio,
    'reaching forward matters more than reaching back, for the same depth'
  );
});

/* ------------------- the wall bearing on the ground -------------------- */

test('the wall cannot sit lower than the top of the baseplate under it', () => {
  // asked for ground level, but the plate reaches 500 mm forward under the wall
  const L = W.layout({ ...baseline, wallBottom: 0, plateThickness: 0.025 });
  assert.equal(L.wallOverPlate, true);
  near(L.minWallBottom, 0.025);
  near(L.wallBottom, 0.025);
  near(L.wallBottomAsked, 0);
  assert.equal(L.wallBottomRaised, true);
  assert.equal(L.restsOnPlate, true);

  // and the wind arm moves up with it
  near(L.wallCentreHeight, 0.025 + 2.5);
  near(L.wallTop, 0.025 + 5);

  const r = W.solve({ ...baseline, wallBottom: 0, plateThickness: 0.025 });
  assert.match(r.warnings.join(' '), /raised to 25 mm/);
});

test('a thicker baseplate pushes the wall — and the wind load — higher', () => {
  const thin = W.solve({ ...baseline, wallBottom: 0, plateThickness: 0.012 });
  const thick = W.solve({ ...baseline, wallBottom: 0, plateThickness: 0.08, uprights: 6 });
  const thinAt6 = W.solve({ ...baseline, wallBottom: 0, plateThickness: 0.012, uprights: 6 });

  near(thin.layout.wallBottom, 0.012);
  near(thick.layout.wallBottom, 0.08);
  assert.ok(thick.byCase.forward.moments.windMoment > thinAt6.byCase.forward.moments.windMoment);
  assert.ok(thick.limitingWindSpeed < thinAt6.limitingWindSpeed);
});

test('the wall is left alone when the baseplate does not reach under it', () => {
  // plate stops at the truss face, so nothing is in the way
  const L = W.layout({ ...baseline, wallBottom: 0, plateFront: 0.15 });
  assert.equal(L.wallOverPlate, false);
  near(L.minWallBottom, 0);
  near(L.wallBottom, 0);
  assert.equal(L.wallBottomRaised, false);
  assert.equal(L.restsOnPlate, false);
});

test('bearing on the baseplate is internal, so it changes nothing', () => {
  /* The wall resting on the plate transfers load inside the tipping body — the
   * weight still acts at the same place, so the moments are untouched. */
  const hung = W.solve({ ...baseline, wallBottom: 0 });
  const borne = W.solve({ ...baseline, wallBottom: 0, wallOnGround: true });

  assert.equal(borne.layout.restsOnPlate, true);
  assert.equal(borne.layout.bearsOnPlate, true);
  assert.equal(borne.layout.bearsOnGround, false, 'it is on the plate, not the ground');
  near(borne.layout.frontPivotX, 0.5);

  assert.equal(borne.uprights, hung.uprights);
  near(borne.byCase.forward.moments.ratio, hung.byCase.forward.moments.ratio, 1e-12);
  near(borne.byCase.backward.moments.ratio, hung.byCase.backward.moments.ratio, 1e-12);
  near(borne.limitingWindSpeed, hung.limitingWindSpeed, 1e-12);
  near(borne.ballastNeededPerUpright, hung.ballastNeededPerUpright, 1e-12);
});

test('if the wall can reach the ground at all, its footing is always outside the plate', () => {
  /* Reaching the ground requires the plate to stop at or before the truss face,
   * and the wall's footing is a cabinet depth forward of that face — so it is
   * necessarily further out. There is no "bears on the ground but makes no
   * difference" case to worry about. */
  for (const plateFront of [0, 0.05, 0.1, 0.15]) {
    const L = W.layout({ ...baseline, wallBottom: 0, plateFront, wallOnGround: true });
    if (!L.bearsOnGround) continue;
    assert.ok(
      L.wallFootX > L.plateFront,
      `plateFront ${plateFront}: footing ${L.wallFootX} should be outside ${L.plateFront}`
    );
    assert.equal(L.pivotIsWallFoot, true);
  }
});

test('a wall bearing outside the footprint moves the tipping edge out to it', () => {
  /* Baseplate stops at the truss face (150 mm), so nothing is under the wall
   * and it can sit on the ground; its foot reaches 270 mm. */
  const shallow = { ...baseline, plateFront: 0.15, wallBottom: 0 };
  const hung = W.solve(shallow);
  const borne = W.solve({ ...shallow, wallOnGround: true });

  near(hung.layout.frontPivotX, 0.15);
  near(borne.layout.frontPivotX, 0.27);
  assert.equal(borne.layout.pivotIsWallFoot, true);

  // hung, the wall's own weight is outside the edge and pulling it over
  const wallArm = (r) => r.byCase.forward.moments.items.find((i) => i.name === 'LED wall').arm;
  near(wallArm(hung), 0.15 - 0.21); // negative: overturning
  near(wallArm(borne), 0.27 - 0.21); // positive: now holding it down
  assert.ok(wallArm(hung) < 0 && wallArm(borne) > 0);

  // left to size themselves, bearing on the ground saves three uprights
  assert.ok(borne.uprights < hung.uprights, `${borne.uprights} vs ${hung.uprights}`);
  assert.equal(hung.uprights, 10);
  assert.equal(borne.uprights, 7);

  /* Compare the margins at a fixed count, or the auto-sizing hides the effect:
   * with fewer uprights the ratio settles back onto the safety factor either
   * way, so the two look the same. */
  const at8 = (extra) => W.solve({ ...shallow, uprights: 8, ...extra });
  assert.ok(
    at8({ wallOnGround: true }).byCase.forward.moments.ratio >
      at8({}).byCase.forward.moments.ratio
  );
  assert.ok(at8({ wallOnGround: true }).limitingWindSpeed > at8({}).limitingWindSpeed);
});

test('every lever arm grows by the same amount when the edge moves out', () => {
  const shallow = { ...baseline, plateFront: 0.15, wallBottom: 0, uprights: 8 };
  const hung = W.solve(shallow);
  const borne = W.solve({ ...shallow, wallOnGround: true });
  const shift = borne.layout.frontPivotX - hung.layout.frontPivotX;
  near(shift, 0.12); // the cabinet depth

  const arms = (r) =>
    r.byCase.forward.moments.items.reduce((acc, i) => {
      acc[i.name] = i.arm;
      return acc;
    }, {});
  const a = arms(hung);
  const b = arms(borne);
  for (const name of Object.keys(a)) {
    near(b[name] - a[name], shift, 1e-12, name);
  }
});

test('bearing does nothing when the wall is held up off the ground', () => {
  // set to bear, but it starts 500 mm up, so it is touching nothing
  const r = W.solve({ ...baseline, plateFront: 0.15, wallOnGround: true });
  assert.equal(r.layout.bearsOnGround, false);
  near(r.layout.frontPivotX, 0.15);
  assert.match(r.warnings.join(' '), /starts 500 mm above it/);

  const same = W.solve({ ...baseline, plateFront: 0.15 });
  assert.equal(r.uprights, same.uprights);
});

test('the rear tipping edge is unaffected by the wall bearing forward', () => {
  // tipping backward lifts everything in front, so that contact releases too
  const shallow = { ...baseline, plateFront: 0.15, wallBottom: 0, uprights: 8 };
  const hung = W.solve(shallow);
  const borne = W.solve({ ...shallow, wallOnGround: true });
  near(borne.byCase.backward.moments.pivotX, -baseline.plateBack);
  near(borne.byCase.backward.moments.ratio, hung.byCase.backward.moments.ratio, 1e-12);
});

/* ------------------- wind on the exposed truss ------------------------- */

test('only the truss the wall does not cover is in the wind', () => {
  const L = W.layout(baseline);
  // 6 m upright, wall from 0.5 to 5.5 -> 0.5 m showing above, 0.5 m below
  near(L.trussExposedAbove, 0.5);
  near(L.trussExposedBelow, 0.5);
  near(L.trussExposedLength, 1);
  // lattice, so only the metal counts: length × width × solidity
  near(L.trussWindAreaPerUpright, 1 * 0.3 * 0.3);
  // area-weighted centre of the two showing bits
  near(L.trussWindHeight, (0.5 * 5.75 + 0.5 * 0.25) / 1);
  near(L.trussWindHeight, 3);
});

test('a wall that fills its uprights leaves nothing in the wind', () => {
  const L = W.layout({ ...baseline, wallBottom: 0, plateFront: 0.15, trussHeight: 5 });
  near(L.trussExposedAbove, 0);
  near(L.trussExposedBelow, 0);
  near(L.trussWindAreaPerUpright, 0);
  near(L.trussWindHeight, 0);

  const r = W.solve({ ...baseline, wallBottom: 0, plateFront: 0.15, trussHeight: 5 });
  near(r.trussWindForce, 0);
  near(r.byCase.forward.moments.trussWindMoment, 0);
});

test('the truss wind force is pressure times coefficient times metal area', () => {
  const r = W.solve(baseline);
  near(r.trussWindPerUpright, 74.1125 * 1.8 * 0.09, 1e-9);
  near(r.trussWindPerUpright, 12.006225, 1e-6);
  near(r.trussWindForce, 6 * 12.006225, 1e-6);
  near(r.byCase.forward.moments.trussWindMoment, 6 * 12.006225 * 3, 1e-6);
  // and it is a small share when the wall covers most of the upright
  assert.ok(r.trussWindShare < 0.02, `share was ${r.trussWindShare}`);
});

test('a tall upright behind a short wall is mostly sail', () => {
  const tall = W.solve({ ...baseline, trussHeight: 20, uprights: 6 });
  near(tall.layout.trussExposedLength, 15); // 20 − 5.5 above, 0.5 below
  assert.ok(tall.trussWindShare > 0.4, `share was ${tall.trussWindShare}`);
  assert.match(tall.warnings.join(' '), /Most of the wind load is on the bare truss/);

  // and it costs real capacity
  const short = W.solve({ ...baseline, trussHeight: 6, uprights: 6 });
  assert.ok(tall.limitingWindSpeed < short.limitingWindSpeed * 0.8);
});

test('truss height now makes things worse, not better', () => {
  // its own weight helps a little; its wind load hurts a lot more
  const at6 = W.solve({ ...baseline, trussHeight: 6, uprights: 8 });
  const at12 = W.solve({ ...baseline, trussHeight: 12, uprights: 8 });
  assert.ok(at12.layout.trussMass > at6.layout.trussMass, 'heavier');
  assert.ok(
    at12.byCase.forward.moments.ratio < at6.byCase.forward.moments.ratio,
    'but worse off overall'
  );
  assert.ok(at12.limitingWindSpeed < at6.limitingWindSpeed);
});

test('with no truss wind, height only ever helps', () => {
  // solidity zero takes the sail away, leaving just the extra weight
  const at6 = W.solve({ ...baseline, trussHeight: 6, trussSolidity: 0.0001, uprights: 8 });
  const at12 = W.solve({ ...baseline, trussHeight: 12, trussSolidity: 0.0001, uprights: 8 });
  assert.ok(at12.byCase.forward.moments.ratio > at6.byCase.forward.moments.ratio);
});

test('enough exposed truss and adding uprights makes it worse', () => {
  /* Each upright brings its own sail. Once that costs more than the upright
   * resists, no number of them works — which is a different answer from
   * "you need a lot". */
  const r = W.solve({ ...baseline, trussHeight: 20 });
  assert.equal(W.uprightsForStability(r.layout, {
    wallForce: r.windForce,
    trussForcePerUpright: r.trussWindPerUpright
  }, 1, r.safetyFactor), Infinity);
  assert.equal(r.stabilityAchievable, false);
  assert.equal(r.buildable, false);
  assert.match(r.warnings.join(' '), /Adding uprights will not fix this/);
  // here the blame belongs to the truss's own wind load
  assert.match(r.warnings.join(' '), /wind load on its own exposed truss/);
});

test('cutting the uprights down to the wall fixes it', () => {
  const tall = W.solve({ ...baseline, trussHeight: 20 });
  const trimmed = W.solve({ ...baseline, trussHeight: 5.6 });
  assert.equal(tall.stabilityAchievable, false);
  assert.equal(trimmed.stabilityAchievable, true);
  assert.ok(trimmed.uprights <= 7, `got ${trimmed.uprights}`);
});

test('a bare number still means the wall load alone', () => {
  // keeps the simpler call readable, and the older tests honest
  const L = W.layout(baseline);
  near(W.moments(L, 6, 1000, 1).trussWindMoment, 0);
  near(W.moments(L, 6, { wallForce: 1000 }, 1).trussWindMoment, 0);
  near(
    W.moments(L, 6, { wallForce: 1000, trussForcePerUpright: 10 }, 1).trussWindMoment,
    6 * 10 * 3
  );
});
