/*
 * Tests for the dynamic simulation.
 *
 * The interesting ones cross-check the simulation against the static solver:
 * two independent pieces of code that have to agree about the force at which
 * the thing starts to go over.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../src/physics.js');
const S = require('../src/sim.js');

const baseline = {
  plateMass: 20,
  plateLength: 0.6,
  plateWidth: 0.6,
  plateThickness: 0.012,
  poleMass: 8,
  poleLength: 2,
  topMass: 0,
  pushDirection: 'width',
  pushAngleDeg: 0,
  friction: 0.6,
  gravity: 9.80665
};

const near = (actual, expected, tol = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${expected}, got ${actual} (tolerance ${tol})`
  );

const bodyFor = (over = {}) => S.makeBody(P.solve({ ...baseline, ...over }));

/** Run the simulation for a while and report where it ended up. */
function run(body, { force = 0, baseHeld = true, seconds = 6, dt = 1 / 120 } = {}) {
  const state = S.makeState();
  const steps = Math.round(seconds / dt);
  let maxTheta = 0;
  for (let i = 0; i < steps; i += 1) {
    S.advance(body, state, dt, force, baseHeld);
    maxTheta = Math.max(maxTheta, state.theta);
  }
  return { state, maxTheta };
}

/* ------------------------- agreeing with the statics ------------------- */

test('the simulation and the static solver agree on the tipping force', () => {
  const cases = [
    {},
    { pushAngleDeg: 25 },
    { pushAngleDeg: -20 },
    { plateLength: 0.9, plateWidth: 0.4 },
    { plateLength: 0.9, plateWidth: 0.4, pushDirection: 'length' },
    { plateLength: 0.9, plateWidth: 0.4, pushDirection: 'corner' },
    { topMass: 12 },
    { poleLength: 0.4, plateWidth: 1.2 },
    { gravity: 1.62 },
    { pushHeight: 1.1 }
  ];

  for (const over of cases) {
    const result = P.solve({ ...baseline, ...over });
    const body = S.makeBody(result);
    near(
      S.onsetForce(body),
      result.chosen.tipForce,
      Math.abs(result.chosen.tipForce) * 1e-9,
      JSON.stringify(over)
    );
  }
});

test('the balance angle matches the static tilt angle', () => {
  for (const over of [{}, { topMass: 20 }, { plateWidth: 0.25 }, { poleLength: 4 }]) {
    const result = P.solve({ ...baseline, ...over });
    const body = S.makeBody(result);
    near((body.thetaBalance * 180) / Math.PI, result.chosen.tiltAngleDeg, 1e-9);
  }
});

test('net moment is zero at exactly the static tipping force', () => {
  const result = P.solve(baseline);
  const body = S.makeBody(result);
  const state = S.makeState();
  near(S.netMoment(body, state, result.chosen.tipForce, true), 0, 1e-9);
});

/* ------------------------------ does it tip? --------------------------- */

test('just under the tipping force it holds, just over it goes', () => {
  const result = P.solve(baseline);
  const body = S.makeBody(result);
  const F = result.chosen.tipForce;

  const under = run(body, { force: F * 0.99 });
  assert.equal(under.state.fallen, false);
  assert.ok(
    under.maxTheta < 0.02,
    `should barely lift below the threshold, reached ${under.maxTheta} rad`
  );

  const over = run(body, { force: F * 1.01 });
  assert.equal(over.state.fallen, true, 'should go all the way over');
  near(over.state.theta, body.thetaEnd, 1e-9);
});

test('bisecting the simulation recovers the static tipping force', () => {
  const result = P.solve(baseline);
  const body = S.makeBody(result);

  let lo = 0;
  let hi = result.chosen.tipForce * 3;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (run(body, { force: mid, seconds: 8 }).state.fallen) hi = mid;
    else lo = mid;
  }
  // the threshold found by simulating should be the one worked out on paper
  near(hi, result.chosen.tipForce, result.chosen.tipForce * 1e-3);
});

test('a gentle shove that is released early lets it fall back', () => {
  const body = bodyFor();
  const F = P.solve(baseline).chosen.tipForce;
  const state = S.makeState();

  // just over the threshold, and only briefly — barely any momentum
  for (let i = 0; i < 18; i += 1) S.advance(body, state, 1 / 120, F * 1.05, true);
  assert.ok(state.theta > 0, 'should have started to lift');
  assert.ok(state.theta < body.thetaBalance, 'nowhere near the balance point');

  for (let i = 0; i < 1200; i += 1) S.advance(body, state, 1 / 120, 0, true);
  assert.equal(state.fallen, false);
  near(state.theta, 0, 1e-9);
  near(state.omega, 0, 1e-9);
});

test('a hard shove tips it even after the push stops well short of balance', () => {
  // momentum, not position, decides it — this is why a knock can tip
  // something that the same force applied gently would not
  const body = bodyFor();
  const F = P.solve(baseline).chosen.tipForce;
  const state = S.makeState();

  for (let i = 0; i < 60; i += 1) S.advance(body, state, 1 / 120, F * 1.4, true);
  assert.ok(state.theta < body.thetaBalance, 'push released before the balance point');
  assert.ok(state.omega > 0, 'but it is moving');

  for (let i = 0; i < 1200; i += 1) S.advance(body, state, 1 / 120, 0, true);
  assert.equal(state.fallen, true, 'and it should carry itself over');
});

test('the energy needed to carry it over matches the static figure', () => {
  const result = P.solve(baseline);
  const body = S.makeBody(result);

  /* Give it exactly the reported energy-to-tip as rotational kinetic energy
   * and it should just make it; a little less and it should not. */
  const omegaFor = (energy) => Math.sqrt((2 * energy) / body.inertia);
  const coast = (omega) => {
    const state = S.makeState();
    state.omega = omega;
    for (let i = 0; i < 6000; i += 1) S.advance(body, state, 1 / 480, 0, true);
    return state.fallen;
  };

  assert.equal(coast(omegaFor(result.chosen.energyToTip * 1.02)), true);
  assert.equal(coast(omegaFor(result.chosen.energyToTip * 0.98)), false);
});

test('past the balance point it goes over on its own with no push at all', () => {
  const body = bodyFor();
  const state = S.makeState();
  state.theta = body.thetaBalance + 0.02;

  for (let i = 0; i < 2000; i += 1) S.advance(body, state, 1 / 240, 0, true);
  assert.equal(state.fallen, true);
});

test('just short of the balance point it comes back down on its own', () => {
  const body = bodyFor();
  const state = S.makeState();
  state.theta = body.thetaBalance - 0.02;

  for (let i = 0; i < 2000; i += 1) S.advance(body, state, 1 / 240, 0, true);
  assert.equal(state.fallen, false);
  near(state.theta, 0, 1e-9);
});

test('it never rotates below its base', () => {
  const body = bodyFor();
  const state = S.makeState();
  for (let i = 0; i < 600; i += 1) {
    S.advance(body, state, 1 / 120, 0, true);
    assert.ok(state.theta >= 0, `theta went negative: ${state.theta}`);
  }
});

test('moving weight to the top costs stability but not tipping force', () => {
  /* Same total weight, distributed differently: 28 kg either way. The steady
   * force needed is W·d/h, which knows nothing about how high the weight sits,
   * so it comes out identical — but the top-heavy one goes over from a much
   * smaller lean, and takes far less of a knock to do it. */
  const low = P.solve({ ...baseline, plateMass: 20, poleMass: 8, topMass: 0 });
  const high = P.solve({ ...baseline, plateMass: 8, poleMass: 8, topMass: 12 });

  near(low.totalMass, high.totalMass, 1e-12);
  near(low.chosen.tipForce, high.chosen.tipForce, 1e-9);

  const lowBody = S.makeBody(low);
  const highBody = S.makeBody(high);
  assert.ok(highBody.hCg > lowBody.hCg, 'centre of mass should be higher');
  assert.ok(highBody.thetaBalance < lowBody.thetaBalance, 'and it should tip from less lean');
  assert.ok(high.chosen.energyToTip > 0);
  assert.ok(
    high.chosen.energyToTip < low.chosen.energyToTip,
    'a knock should tip the top-heavy one more easily'
  );

  // both let go from just past their own balance point, both go over
  for (const body of [lowBody, highBody]) {
    const state = S.makeState();
    state.theta = body.thetaBalance + 0.01;
    for (let i = 0; i < 4000; i += 1) S.advance(body, state, 1 / 240, 0, true);
    assert.equal(state.fallen, true);
  }
});

/* -------------------------------- sliding ------------------------------ */

test('on a slippery floor it slides instead of tipping', () => {
  const result = P.solve({ ...baseline, friction: 0.1 });
  const body = S.makeBody(result);
  const F = result.chosen.tipForce;

  const held = run(body, { force: F * 1.05, baseHeld: true });
  assert.equal(held.state.fallen, true, 'held base: should tip');

  const free = run(body, { force: F * 1.05, baseHeld: false });
  assert.equal(free.state.fallen, false, 'free base: should slide instead');
  assert.ok(free.state.slide > 0.1, `should have slid, moved ${free.state.slide} m`);
});

test('friction has to be beaten before anything slides', () => {
  const body = bodyFor({ friction: 0.5 });
  const state = S.makeState();
  const belowGrip = 0.5 * body.weight * 0.9;

  for (let i = 0; i < 240; i += 1) S.advance(body, state, 1 / 120, belowGrip, false);
  near(state.slide, 0, 1e-12);
  near(state.slideVel, 0, 1e-12);
});

test('sliding relieves the tipping moment', () => {
  const body = bodyFor({ friction: 0.05 });
  const state = S.makeState();
  const F = 300;

  const held = S.netMoment(body, state, F, true);
  const free = S.netMoment(body, state, F, false);
  assert.ok(free < held, 'a base free to slide should be closer to holding');

  // and the difference is exactly the pseudo-force term
  const m = S.moments(body, state, F, false);
  near(held - free, m.slidingRelief, 1e-9);
  assert.ok(m.slidingRelief > 0);
});

test('a grippy floor gives no sliding relief', () => {
  const body = bodyFor({ friction: 0.9 });
  const state = S.makeState();
  const m = S.moments(body, state, 50, false);
  near(m.slidingRelief, 0, 1e-12);
  near(S.netMoment(body, state, 50, false), S.netMoment(body, state, 50, true), 1e-12);
});

test('a sliding base coasts to a stop once the push is released', () => {
  /* Squat and wide, so it slides without any risk of tipping — on the tall
   * baseline any force big enough to break friction also tips it. */
  const squat = { plateWidth: 1.2, plateLength: 1.2, poleLength: 0.4, friction: 0.2 };
  const result = P.solve({ ...baseline, ...squat });
  const body = S.makeBody(result);
  const state = S.makeState();

  const pushing = 200;
  assert.ok(pushing < result.chosen.tipForce, 'well below the tipping force');
  assert.ok(pushing > result.slideForce, 'but enough to break friction');

  for (let i = 0; i < 120; i += 1) S.advance(body, state, 1 / 120, pushing, false);
  assert.equal(state.fallen, false);
  assert.ok(state.slideVel > 0, 'should be moving');

  const movedTo = state.slide;
  for (let i = 0; i < 1200; i += 1) S.advance(body, state, 1 / 120, 0, false);
  near(state.slideVel, 0, 1e-9);
  assert.ok(state.slide > movedTo, 'should coast on a little before stopping');
});

test('a base that fell mid-slide still comes to rest', () => {
  // regression: the fall used to freeze the slide velocity in place
  const result = P.solve({ ...baseline, friction: 0.15 });
  const body = S.makeBody(result);
  const state = S.makeState();

  for (let i = 0; i < 60; i += 1) S.advance(body, state, 1 / 120, 300, false);
  assert.equal(state.fallen, true, 'that much force should put it over');
  assert.ok(state.slideVel > 0, 'and it should still be travelling');

  const landedAt = state.slide;
  for (let i = 0; i < 1200; i += 1) S.advance(body, state, 1 / 120, 0, false);
  assert.ok(state.slide > landedAt, 'it should carry on past where it landed');
  near(state.slideVel, 0, 1e-9);
});

/* ------------------------------ integration ---------------------------- */

test('the fall ends with the top of the pole on the ground', () => {
  const body = bodyFor();
  // pole tip at radius hypot(d, poleTop) from the pivot, brought down to y = 0
  near(body.thetaEnd, Math.PI - Math.atan2(body.poleTop, body.d), 1e-12);

  const { state } = run(body, { force: 500 });
  assert.equal(state.fallen, true);
  const tip = S.rotate(state, -body.d, body.poleTop);
  near(tip.y, 0, 1e-6);
  assert.ok(tip.x > 0, 'and it should have landed past the pivot');
});

test('the drawing transform is a rotation about the pivot', () => {
  const body = bodyFor();
  const state = S.makeState();

  // at rest, body coordinates pass straight through
  const flat = S.rotate(state, -body.d, body.hCg);
  near(flat.x, -body.d, 1e-12);
  near(flat.y, body.hCg, 1e-12);

  // the pivot itself never moves
  state.theta = 0.5;
  const pivot = S.rotate(state, 0, 0);
  near(pivot.x, 0, 1e-12);
  near(pivot.y, 0, 1e-12);

  // rotation preserves distance from the pivot
  const moved = S.rotate(state, -body.d, body.poleTop);
  near(Math.hypot(moved.x, moved.y), Math.hypot(body.d, body.poleTop), 1e-12);

  // and the far bottom corner lifts off the ground
  const corner = S.rotate(state, -2 * body.d, 0);
  assert.ok(corner.y > 0, 'the trailing corner should rise');
});

test('the centre of mass passes over the pivot exactly at the balance angle', () => {
  const body = bodyFor();
  const state = S.makeState();
  state.theta = body.thetaBalance;
  const cg = S.rotate(state, -body.d, body.hCg);
  near(cg.x, 0, 1e-9); // directly above the pivot
  near(cg.y, body.r, 1e-9); // and at its highest
});

test('status reporting tracks what is actually happening', () => {
  const body = bodyFor();
  const state = S.makeState();
  assert.equal(S.describe(body, state, 0, true), 'at-rest');
  assert.equal(S.describe(body, state, 10, true), 'holding');

  state.theta = 0.05;
  assert.equal(S.describe(body, state, 100, true), 'lifting');
  assert.equal(S.describe(body, state, 0, true), 'falling-back');

  state.theta = body.thetaBalance + 0.01;
  assert.equal(S.describe(body, state, 0, true), 'going-over');

  state.fallen = true;
  assert.equal(S.describe(body, state, 0, true), 'fallen');

  const sliding = S.makeState();
  sliding.slideVel = 0.4;
  assert.equal(S.describe(body, sliding, 100, false), 'sliding');
});

test('a long frame is clamped rather than teleporting the body', () => {
  const body = bodyFor();
  const state = S.makeState();
  // as if the tab were backgrounded for ten seconds
  S.advance(body, state, 10, 500, true);
  assert.ok(state.theta < body.thetaEnd, 'should not have jumped straight to fallen');
  assert.ok(Number.isFinite(state.theta) && Number.isFinite(state.omega));
});

test('degenerate geometry does not produce NaN', () => {
  for (const over of [
    { plateMass: 0, poleMass: 0.001 },
    { plateWidth: 0.0001 },
    { poleLength: 0 },
    { plateThickness: 0 }
  ]) {
    const body = S.makeBody(P.solve({ ...baseline, ...over }));
    const { state } = run(body, { force: 50, seconds: 2 });
    assert.ok(Number.isFinite(state.theta), `theta went bad for ${JSON.stringify(over)}`);
    assert.ok(Number.isFinite(state.omega), `omega went bad for ${JSON.stringify(over)}`);
    assert.ok(body.inertia > 0, `inertia went bad for ${JSON.stringify(over)}`);
  }
});

test('energy is conserved while it rocks, to within the integrator', () => {
  const body = bodyFor();
  const state = S.makeState();
  state.theta = body.thetaBalance * 0.6;

  const energy = (s) => {
    const height = body.r * Math.sin(body.psi + s.theta);
    return 0.5 * body.inertia * s.omega * s.omega + body.mass * body.g * height;
  };

  const start = energy(state);
  let worst = 0;
  // stop before it lands, since the landing is deliberately inelastic
  for (let i = 0; i < 400; i += 1) {
    S.advance(body, state, 1 / 480, 0, true);
    if (state.theta <= 0) break;
    worst = Math.max(worst, Math.abs(energy(state) - start) / start);
  }
  assert.ok(worst < 0.01, `energy drifted by ${(worst * 100).toFixed(2)}%`);
});

/* ------------------- the centre of mass as it goes over ---------------- */

test('the centre of mass never leaves the body, but its plumb line does', () => {
  const body = bodyFor();
  const state = S.makeState();

  // upright: sitting a full lever arm inside the pivot, not yet lifted
  let c = S.cog(body, state);
  near(c.insideBy, body.d, 1e-12);
  near(c.rise, 0, 1e-12);
  near(c.y, body.hCg, 1e-12);

  // at the balance point the plumb line is exactly over the pivot, and the
  // centre of mass is at the top of its arc
  state.theta = body.thetaBalance;
  c = S.cog(body, state);
  near(c.insideBy, 0, 1e-9);
  near(c.y, body.r, 1e-9);
  near(c.rise, c.riseToBalance, 1e-9);

  // past it, the plumb line is outside the base and the weight is now pulling
  state.theta = body.thetaBalance + 0.3;
  c = S.cog(body, state);
  assert.ok(c.insideBy < 0, 'plumb line should be outside the pivot');
  assert.ok(c.rise < c.riseToBalance, 'and it should be dropping again');

  // throughout, its distance from the pivot is fixed — it is part of the body
  for (const deg of [0, 15, 30, 45, 70, 95]) {
    state.theta = (deg * Math.PI) / 180;
    const p = S.cog(body, state);
    near(Math.hypot(p.x, p.y), body.r, 1e-12, `${deg} deg`);
  }
});

test('the plumb line crosses the pivot exactly when the moments balance', () => {
  const body = bodyFor();
  const state = S.makeState();
  for (const deg of [10, 30, 44, 46, 60]) {
    state.theta = (deg * Math.PI) / 180;
    const inside = S.cog(body, state).insideBy;
    const righting = S.moments(body, state, 0, true).righting;
    // the righting moment is just the weight times that horizontal offset
    near(righting, body.weight * inside, 1e-9, `${deg} deg`);
    assert.equal(inside > 0, righting > 0, `${deg} deg: signs should agree`);
  }
});

test('the lift to the balance point is the energy-to-tip figure', () => {
  const result = P.solve(baseline);
  const body = S.makeBody(result);
  const c = S.cog(body, S.makeState());
  near(body.weight * c.riseToBalance, result.chosen.energyToTip, 1e-9);
});
