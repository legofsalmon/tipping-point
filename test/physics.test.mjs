/*
 * Tests for the tipping-force physics core.
 *
 *   node --test test/
 *
 * Expected values here are hand-worked from the moment balance, not copied
 * out of the implementation, so they'd catch the code drifting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../src/physics.js');

/** A clean baseline: 30 kg total, 0.5 m square plate, 2 m pole, g = 10. */
const baseline = {
  plateMass: 20,
  plateLength: 0.5,
  plateWidth: 0.5,
  plateThickness: 0,
  poleMass: 10,
  poleLength: 2,
  topMass: 0,
  pushDirection: 'width',
  pushAngleDeg: 0,
  friction: null,
  gravity: 10
};

const near = (actual, expected, tol = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${expected}, got ${actual} (tolerance ${tol})`
  );

test('baseline: F = W*d/h', () => {
  const r = P.solve(baseline);
  assert.equal(r.ok, true);
  near(r.totalMass, 30);
  near(r.weight, 300);
  // pole centre of mass at 1 m, plate at 0 -> (10*1)/30
  near(r.cgHeight, 1 / 3);
  // 300 N * 0.25 m / 2 m
  near(r.chosen.tipForce, 37.5);
  near(r.chosen.leverArm, 0.25);
  near(r.chosen.restoringMoment, 75);
  near(r.chosen.overturningMoment, 75);
  // ground reaction is just the weight for a horizontal push
  near(r.chosen.normalAtTip, 300);
  assert.equal(r.mode, 'tip');
});

test('baseline: tilt angle and energy to tip', () => {
  const r = P.solve(baseline);
  // atan(0.25 / 0.33333) — a 3-4-5 triangle scaled
  near(r.chosen.tiltAngleDeg, (Math.atan2(0.25, 1 / 3) * 180) / Math.PI);
  near(r.chosen.tiltAngleDeg, 36.8698976, 1e-6);
  // W * (hypot(0.25, 1/3) - 1/3) = 300 * (5/12 - 4/12)
  near(r.chosen.energyToTip, 25);
});

test('doubling the pole length halves the force', () => {
  const short = P.solve({ ...baseline, poleLength: 1 });
  const long = P.solve({ ...baseline, poleLength: 2 });
  // same masses, so same weight; arm unchanged, height doubled
  near(short.chosen.tipForce, 75);
  near(long.chosen.tipForce, 37.5);
});

test('a wider baseplate needs proportionally more force', () => {
  const r = P.solve({ ...baseline, plateWidth: 1.0 });
  // d = 0.5 now
  near(r.chosen.tipForce, 75);
});

test('rectangular plate: each direction has its own lever arm', () => {
  const r = P.solve({ ...baseline, plateLength: 0.8, plateWidth: 0.4 });
  near(r.byDirection.length.leverArm, 0.4);
  near(r.byDirection.width.leverArm, 0.2);
  near(r.byDirection.corner.leverArm, Math.hypot(0.4, 0.2));

  near(r.byDirection.length.tipForce, 60); // 300 * 0.4 / 2
  near(r.byDirection.width.tipForce, 30); // 300 * 0.2 / 2
  near(r.byDirection.corner.tipForce, (300 * Math.hypot(0.4, 0.2)) / 2);

  // pushing across the short dimension is always the easiest way over
  assert.equal(r.easiest.id, 'width');
});

test('a corner push is the hardest direction on a square base', () => {
  const r = P.solve(baseline);
  near(r.byDirection.corner.leverArm, Math.hypot(0.25, 0.25));
  // sqrt(2) times the square-on force
  near(r.byDirection.corner.tipForce, 37.5 * Math.SQRT2, 1e-9);
  assert.ok(r.byDirection.corner.tipForce > r.byDirection.width.tipForce);
});

test('pushing downwards at an angle makes it harder', () => {
  const r = P.solve({ ...baseline, pushAngleDeg: 30 });
  // denom = h*cos30 - d*sin30 = 1.7320508 - 0.125
  const denom = 2 * Math.cos(Math.PI / 6) - 0.25 * Math.sin(Math.PI / 6);
  near(r.chosen.tipForce, 75 / denom);
  assert.ok(r.chosen.tipForce > 37.5);
  // ground reaction rises by the downward component
  near(r.chosen.normalAtTip, 300 + (75 / denom) * Math.sin(Math.PI / 6));
});

test('angling the push a long way upwards is also harder', () => {
  // the upward pull helps, but the lost horizontal component costs more
  const r = P.solve({ ...baseline, pushAngleDeg: -30 });
  const denom = 2 * Math.cos(Math.PI / 6) + 0.25 * Math.sin(Math.PI / 6);
  near(r.chosen.tipForce, 75 / denom);
  assert.ok(r.chosen.tipForce > 37.5);
});

test('the easiest angle is slightly upwards, at atan(d / h·c)', () => {
  const r = P.solve(baseline);
  const best = r.chosen;
  // -atan(0.25 / 2) = -7.125 degrees
  near(best.bestAngleDeg, -(Math.atan2(0.25, 2) * 180) / Math.PI);
  near(best.bestAngleDeg, -7.1250163, 1e-6);
  // W*d / hypot(h, d)
  near(best.bestForce, 75 / Math.hypot(2, 0.25));
  assert.ok(best.bestForce < best.tipForce);

  // no angle anywhere beats it — sweep and check
  for (let a = -89; a <= 89; a += 0.25) {
    const swept = P.solve({ ...baseline, pushAngleDeg: a }).chosen.tipForce;
    assert.ok(
      swept >= best.bestForce - 1e-9,
      `angle ${a} deg needed ${swept} N, below the claimed minimum ${best.bestForce} N`
    );
  }
});

test('the best angle for a corner push accounts for the direction factor', () => {
  const r = P.solve({ ...baseline, plateLength: 0.8, plateWidth: 0.4, pushDirection: 'corner' });
  const corner = r.byDirection.corner;
  const effectiveHeight = r.pushHeight * corner.c;
  near(corner.bestAngleDeg, -(Math.atan2(corner.d, effectiveHeight) * 180) / Math.PI);
  near(corner.bestForce, (r.weight * corner.d) / Math.hypot(effectiveHeight, corner.d));

  for (let a = -89; a <= 89; a += 0.5) {
    const swept = P.solve({
      ...baseline,
      plateLength: 0.8,
      plateWidth: 0.4,
      pushDirection: 'corner',
      pushAngleDeg: a
    }).chosen.tipForce;
    assert.ok(swept >= corner.bestForce - 1e-9, `angle ${a} beat the minimum`);
  }
});

test('too steep a downward push can never tip it', () => {
  // impossible once tan(angle) >= h/d = 8, i.e. beyond 82.87 degrees
  const r = P.solve({ ...baseline, pushAngleDeg: 85 });
  assert.equal(r.chosen.tipForce, Infinity);
  assert.match(r.warnings.join(' '), /too steeply downwards/);

  const justUnder = P.solve({ ...baseline, pushAngleDeg: 82 });
  assert.ok(Number.isFinite(justUnder.chosen.tipForce));
});

test('the ground reaction never goes negative, so it cannot be lifted clear', () => {
  for (const pushAngleDeg of [-89, -80, -45, -10, 0, 10, 45, 80, 89]) {
    for (const poleLength of [0.05, 0.5, 3]) {
      const r = P.solve({ ...baseline, pushAngleDeg, poleLength });
      if (Number.isFinite(r.chosen.tipForce)) {
        assert.ok(
          r.chosen.normalAtTip > 0,
          `normal went non-positive at ${pushAngleDeg} deg, pole ${poleLength} m`
        );
      }
    }
  }
});

test('low friction means it slides before it tips', () => {
  const slippy = P.solve({ ...baseline, friction: 0.1 });
  near(slippy.slideForce, 30); // 0.1 * 300
  assert.equal(slippy.mode, 'slide');
  assert.equal(slippy.chosen.slidesFirst, true);
  near(slippy.chosen.tipForce, 37.5); // the tipping force itself is unchanged
  assert.match(slippy.warnings.join(' '), /slides before it tips/);

  const grippy = P.solve({ ...baseline, friction: 0.5 });
  near(grippy.slideForce, 150);
  assert.equal(grippy.mode, 'tip');
});

test('friction null skips the slide check entirely', () => {
  const r = P.solve(baseline);
  assert.equal(r.slideForce, Infinity);
  assert.equal(r.chosen.slidesFirst, false);
});

test('a downward push angle makes sliding harder', () => {
  const flat = P.solve({ ...baseline, friction: 0.3 });
  const angled = P.solve({ ...baseline, friction: 0.3, pushAngleDeg: 20 });
  assert.ok(angled.slideForce > flat.slideForce);
  // mu*W / (cos20 - mu*sin20)
  const denom = Math.cos(Math.PI / 9) - 0.3 * Math.sin(Math.PI / 9);
  near(angled.slideForce, (0.3 * 300) / denom);
});

test('mass at the top of the pole raises the centre of mass and the force', () => {
  const r = P.solve({ ...baseline, topMass: 5 });
  near(r.totalMass, 35);
  near(r.weight, 350);
  // (10*1 + 5*2) / 35
  near(r.cgHeight, 20 / 35);
  near(r.chosen.tipForce, 43.75); // 350 * 0.25 / 2
  // top-heavier, so it goes over from a smaller tilt
  assert.ok(r.chosen.tiltAngleDeg < P.solve(baseline).chosen.tiltAngleDeg);
});

test('plate thickness lifts the pole and shifts the centre of mass', () => {
  const r = P.solve({ ...baseline, plateThickness: 0.02 });
  near(r.poleTop, 2.02);
  near(r.pushHeight, 2.02);
  // (20*0.01 + 10*1.02) / 30
  near(r.cgHeight, 10.4 / 30);
  near(r.chosen.tipForce, (300 * 0.25) / 2.02);
});

test('an explicit push height overrides the top of the pole', () => {
  const r = P.solve({ ...baseline, pushHeight: 1 });
  assert.equal(r.pushHeightIsPoleTop, false);
  near(r.chosen.tipForce, 75); // 300 * 0.25 / 1
});

test('pushing above the pole top is flagged', () => {
  const r = P.solve({ ...baseline, pushHeight: 3 });
  assert.match(r.warnings.join(' '), /above the top of the pole/);
});

test('very top-heavy assemblies are flagged', () => {
  const r = P.solve({ ...baseline, plateWidth: 0.05, plateLength: 0.05 });
  assert.match(r.warnings.join(' '), /top-heavy/);
});

test('gravity defaults to standard and is overridable', () => {
  const earth = P.solve({ ...baseline, gravity: undefined });
  near(earth.gravity, P.G_STANDARD);
  near(earth.chosen.tipForce, (30 * P.G_STANDARD * 0.25) / 2);

  const moon = P.solve({ ...baseline, gravity: 1.62 });
  near(moon.chosen.tipForce, (30 * 1.62 * 0.25) / 2);
});

test('missing inputs are reported rather than producing a number', () => {
  const empty = P.solve({});
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.length >= 3);

  const noMass = P.solve({ ...baseline, plateMass: 0, poleMass: 0 });
  assert.equal(noMass.ok, false);
  assert.match(noMass.errors.join(' '), /Enter a weight/);

  const noPlate = P.solve({ ...baseline, plateWidth: 0 });
  assert.equal(noPlate.ok, false);
  assert.match(noPlate.errors.join(' '), /baseplate dimensions/);
});

test('negative and junk inputs are clamped, not propagated as NaN', () => {
  const r = P.solve({ ...baseline, plateMass: -5, poleMass: 'banana', topMass: NaN });
  assert.equal(Number.isFinite(r.weight), true);
  near(r.totalMass, 0);
  assert.equal(r.ok, false);
});

test('push angle is clamped to +/-89 degrees', () => {
  const r = P.solve({ ...baseline, pushAngleDeg: 200 });
  near(r.pushAngleDeg, 89);
  const q = P.solve({ ...baseline, pushAngleDeg: -200 });
  near(q.pushAngleDeg, -89);
});

test('an unknown push direction falls back to across the width', () => {
  const r = P.solve({ ...baseline, pushDirection: 'sideways-ish' });
  assert.equal(r.chosen.id, 'width');
});

/* ---------------------------- unit handling ---------------------------- */

test('unit conversions round-trip', () => {
  for (const [kind, table] of Object.entries(P.UNITS)) {
    for (const unit of Object.keys(table)) {
      const there = P.toBase(3.7, unit, table);
      const back = P.fromBase(there, unit, table);
      near(back, 3.7, 1e-12, `${kind}/${unit}`);
    }
  }
});

test('unit factors are the standard ones', () => {
  near(P.toBase(1, 'in', P.LENGTH_UNITS), 0.0254);
  near(P.toBase(1, 'ft', P.LENGTH_UNITS), 0.3048);
  near(P.toBase(1, 'lb', P.MASS_UNITS), 0.45359237);
  near(P.toBase(1, 'lbf', P.FORCE_UNITS), 4.4482216152605);
  near(P.toBase(1, 'kgf', P.FORCE_UNITS), 9.80665);
  // 1 kgf is 1 kg under standard gravity, whatever gravity the sim uses
  near(P.fromBase(P.G_STANDARD, 'kgf', P.FORCE_UNITS), 1);
});

test('unknown units throw rather than silently returning NaN', () => {
  assert.throws(() => P.toBase(1, 'furlong', P.LENGTH_UNITS), /unknown unit/);
});

/* ------------------------- a real-world sanity check ------------------- */

test('worked example: a 2 m sign post on a 600 mm square 40 kg base', () => {
  const r = P.solve({
    plateMass: 40,
    plateLength: 0.6,
    plateWidth: 0.6,
    plateThickness: 0.012,
    poleMass: 8,
    poleLength: 2,
    topMass: 3,
    pushDirection: 'width',
    pushAngleDeg: 0,
    friction: 0.6,
    gravity: 9.80665
  });

  assert.equal(r.ok, true);
  near(r.totalMass, 51);
  near(r.weight, 51 * 9.80665);
  near(r.poleTop, 2.012);
  // (40*0.006 + 8*1.012 + 3*2.012) / 51
  near(r.cgHeight, (40 * 0.006 + 8 * 1.012 + 3 * 2.012) / 51);
  near(r.chosen.tipForce, (51 * 9.80665 * 0.3) / 2.012);
  // roughly 75 N — a firm one-handed shove
  assert.ok(r.chosen.tipForce > 70 && r.chosen.tipForce < 80);
  // grippy floor, so it tips rather than slides
  assert.equal(r.mode, 'tip');
});
