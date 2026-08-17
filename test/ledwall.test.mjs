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
  assert.match(r.warnings.join(' '), /No number of uprights fixes this/);
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
  /* Without ballast, forward case:
   *   restoring   = 5686.86 + 1147.38 + 2647.79 = 9482.03
   *   needed      = 1.5 × 14452.67              = 21679.00
   *   shortfall   = 12196.97
   *   per base    = 12196.97 / (6 × g × 0.75)   = 276.4 kg
   */
  near(r.byCase.forward.ballast, 276.4, 0.5);
  near(r.ballastNeededPerUpright, 276.4, 0.5);
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
  // (21677.91 - 5687.86) / (191.23 + 441.30) = 25.3 -> 26
  const r = W.solve({ ...baseline, ballastMass: 0 });
  assert.equal(r.byCase.forward.uprightsNeeded, 26);
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

test('a wall taller than its uprights is an error', () => {
  const r = W.solve({ ...baseline, trussHeight: 4 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /at least as tall as the wall/);
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
