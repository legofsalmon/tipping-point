/*
 * tipping-point — physics core
 *
 * A baseplate lying flat on the ground with a pole standing up from its
 * centre. Work out the horizontal (or angled) force, applied at the top of
 * the pole, that will tip the assembly over.
 *
 * Everything in here is pure SI: metres, kilograms, seconds, newtons.
 * Unit conversion happens at the edges (see UNITS below).
 *
 * Loaded as a classic script in the browser (so it works from file:// too)
 * and via require() under Node for the tests.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TippingPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants and units
   * ------------------------------------------------------------------ */

  var G_STANDARD = 9.80665;          // standard gravity, m/s^2
  var LBF_IN_N = 4.4482216152605;    // exact by definition of lb and g0
  var EPS = 1e-12;

  // `toBase` multiplies the value to get the SI base unit.
  var LENGTH_UNITS = {
    mm: { toBase: 0.001, label: 'mm' },
    cm: { toBase: 0.01, label: 'cm' },
    m: { toBase: 1, label: 'm' },
    in: { toBase: 0.0254, label: 'in' },
    ft: { toBase: 0.3048, label: 'ft' }
  };

  var MASS_UNITS = {
    g: { toBase: 0.001, label: 'g' },
    kg: { toBase: 1, label: 'kg' },
    t: { toBase: 1000, label: 't' },
    oz: { toBase: 0.028349523125, label: 'oz' },
    lb: { toBase: 0.45359237, label: 'lb' }
  };

  var FORCE_UNITS = {
    N: { toBase: 1, label: 'N' },
    kN: { toBase: 1000, label: 'kN' },
    kgf: { toBase: G_STANDARD, label: 'kgf' },
    lbf: { toBase: LBF_IN_N, label: 'lbf' }
  };

  var ENERGY_UNITS = {
    J: { toBase: 1, label: 'J' },
    'ft·lbf': { toBase: LBF_IN_N * 0.3048, label: 'ft·lbf' }
  };

  var MOMENT_UNITS = {
    'N·m': { toBase: 1, label: 'N·m' },
    'lbf·ft': { toBase: LBF_IN_N * 0.3048, label: 'lbf·ft' }
  };

  var UNITS = {
    length: LENGTH_UNITS,
    mass: MASS_UNITS,
    force: FORCE_UNITS,
    energy: ENERGY_UNITS,
    moment: MOMENT_UNITS
  };

  /** Value in unit `unit` -> SI base value. */
  function toBase(value, unit, table) {
    var u = table[unit];
    if (!u) throw new Error('unknown unit: ' + unit);
    return value * u.toBase;
  }

  /** SI base value -> value in unit `unit`. */
  function fromBase(value, unit, table) {
    var u = table[unit];
    if (!u) throw new Error('unknown unit: ' + unit);
    return value / u.toBase;
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  function nonNeg(value, fallback) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return fallback === undefined ? 0 : fallback;
    return n;
  }

  function positive(value, fallback) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return fallback;
    return n;
  }

  function degToRad(d) { return (d * Math.PI) / 180; }
  function radToDeg(r) { return (r * 180) / Math.PI; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /* ------------------------------------------------------------------ *
   * Push directions across a rectangular baseplate
   * ------------------------------------------------------------------ *
   *
   * Tipping can only happen by rotating about a line through at least two
   * contact points, i.e. about one of the four edges of the baseplate. For
   * a push in some horizontal direction u, the moment about a given edge
   * uses only the force component normal to that edge, so each edge is
   * described by two numbers:
   *
   *   d — perpendicular distance from the centre (where the centre of mass
   *       sits, vertically) to that edge line.
   *   c — cos of the angle between the push direction and the edge's
   *       outward normal; only F*c drives rotation about that edge.
   *
   * Pushing square-on to an edge gives c = 1 and d = half that plate
   * dimension. Pushing exactly at a corner splits the load between the two
   * adjacent edges: d/c works out to the half-diagonal for both of them,
   * which is why a corner push is the hardest direction.
   */
  var DIRECTION_META = {
    length: { label: 'Along the length', hint: 'square-on to an end edge' },
    width: { label: 'Along the width', hint: 'square-on to a side edge' },
    corner: { label: 'Toward a corner', hint: 'diagonally, straight at a corner' }
  };

  function directionsFor(halfLength, halfWidth) {
    var halfDiagonal = Math.hypot(halfLength, halfWidth);
    return [
      { id: 'length', d: halfLength, c: 1 },
      { id: 'width', d: halfWidth, c: 1 },
      {
        id: 'corner',
        d: halfLength,
        c: halfDiagonal > EPS ? halfLength / halfDiagonal : 1
      }
    ].map(function (dir) {
      dir.label = DIRECTION_META[dir.id].label;
      dir.hint = DIRECTION_META[dir.id].hint;
      return dir;
    });
  }

  /* ------------------------------------------------------------------ *
   * Solver
   * ------------------------------------------------------------------ */

  /**
   * @param {object} input All lengths in m, masses in kg, angles in degrees.
   *   plateMass, plateLength, plateWidth, plateThickness
   *   poleMass, poleLength
   *   topMass            extra mass carried at the top of the pole (0 if none)
   *   pushDirection      'length' | 'width' | 'corner'
   *   pushHeight         height of the applied force above the ground;
   *                      null/undefined means "top of the pole"
   *   pushAngleDeg       0 = horizontal, positive = angled downwards
   *   friction           coefficient of static friction, or null to skip the
   *                      slide check
   *   gravity            m/s^2
   */
  function solve(input) {
    input = input || {};

    var g = positive(input.gravity, G_STANDARD);
    var plateMass = nonNeg(input.plateMass);
    var plateLength = nonNeg(input.plateLength);
    var plateWidth = nonNeg(input.plateWidth);
    var plateThickness = nonNeg(input.plateThickness);
    var poleMass = nonNeg(input.poleMass);
    var poleLength = nonNeg(input.poleLength);
    var topMass = nonNeg(input.topMass);
    var friction = input.friction == null ? null : nonNeg(input.friction);
    var angleDeg = clamp(Number(input.pushAngleDeg) || 0, -89, 89);
    var theta = degToRad(angleDeg);
    var cosT = Math.cos(theta);
    var sinT = Math.sin(theta);

    var poleTop = plateThickness + poleLength;
    var pushHeightGiven = input.pushHeight != null && isFinite(Number(input.pushHeight));
    var pushHeight = pushHeightGiven ? nonNeg(input.pushHeight) : poleTop;

    var totalMass = plateMass + poleMass + topMass;
    var weight = totalMass * g;

    // Centre of mass height. The plate is a uniform slab, the pole a uniform
    // rod standing on top of it, any extra mass is a point at the pole top.
    var cgHeight = totalMass > EPS
      ? (plateMass * (plateThickness / 2) +
         poleMass * (plateThickness + poleLength / 2) +
         topMass * poleTop) / totalMass
      : 0;

    var directions = directionsFor(plateLength / 2, plateWidth / 2);

    /* Force needed to slide instead of tip.
     *   horizontal push  F*cos0 must beat  mu * N,  N = W + F*sin0
     *   => F = mu*W / (cos0 - mu*sin0)
     * A steep enough downward push presses it into the ground hard enough
     * that it can never be slid — the denominator goes non-positive. */
    var slideForce;
    if (friction == null) {
      slideForce = Infinity;               // slide check switched off
    } else {
      var slideDenom = cosT - friction * sinT;
      slideForce = slideDenom > EPS ? (friction * weight) / slideDenom : Infinity;
    }

    function evaluate(dir) {
      /* Moments about the pivot edge, at the instant of lift-off:
       *   overturning   F*cos0 * c * h
       *   restoring     W * d   +   F*sin0 * d
       * (the downward component of an angled push acts a distance d from the
       * pivot line, so it helps hold the thing down)
       *
       *   F = W*d / (h*c*cos0 - d*sin0)
       */
      var denom = pushHeight * dir.c * cosT - dir.d * sinT;
      var tipForce = denom > EPS ? (weight * dir.d) / denom : Infinity;

      // Equivalent square-on lever arm: the arm a horizontal push would need
      // to see to require the same force. For a corner push this is the
      // half-diagonal.
      var leverArm = dir.c > EPS ? dir.d / dir.c : Infinity;

      // How far it can be tilted before its own weight carries it over.
      var tiltAngleDeg = radToDeg(Math.atan2(leverArm, cgHeight));

      // Work to lift the centre of mass onto the balance point — what an
      // impact (a kick, a gust, a knock) has to deliver.
      var energyToTip = isFinite(leverArm)
        ? weight * (Math.hypot(leverArm, cgHeight) - cgHeight)
        : Infinity;

      /* Ground reaction at the instant of lift-off. Substituting F back in,
       * this is W*h*c*cos0 / denom, which stays positive for any angle
       * within +/-90 degrees — so a push can never lift the assembly clear
       * of the ground, it can only ever pivot it or slide it. */
      /* Ground reaction at the instant of lift-off. Substituting F back in,
       * this is W*h*c*cos0 / denom, which stays positive for any angle
       * within +/-90 degrees — so a push can never lift the assembly clear
       * of the ground, it can only ever pivot it or slide it. */
      var normalAtTip = isFinite(tipForce) ? weight + tipForce * sinT : weight;

      /* The denominator h*c*cos0 - d*sin0 is largest at tan0 = -d/(h*c),
       * i.e. aimed slightly *upwards*. That is the angle at which the force
       * is perpendicular to the line from the pivot to the push point, so
       * all of it becomes moment arm. Angle it up any further and the
       * horizontal component falls away faster than the arm improves. */
      var effectiveHeight = pushHeight * dir.c;
      var bestAngleDeg = -radToDeg(Math.atan2(dir.d, effectiveHeight));
      var bestDenom = Math.hypot(effectiveHeight, dir.d);
      var bestForce = bestDenom > EPS ? (weight * dir.d) / bestDenom : Infinity;

      return {
        id: dir.id,
        label: dir.label,
        hint: dir.hint,
        d: dir.d,
        c: dir.c,
        leverArm: leverArm,
        tipForce: tipForce,
        restoringMoment: weight * dir.d,
        overturningMoment: isFinite(tipForce) ? tipForce * pushHeight * dir.c * cosT : Infinity,
        tiltAngleDeg: tiltAngleDeg,
        energyToTip: energyToTip,
        normalAtTip: normalAtTip,
        slidesFirst: slideForce < tipForce,
        bestAngleDeg: bestAngleDeg,
        bestForce: bestForce
      };
    }

    var results = directions.map(evaluate);
    var byId = {};
    results.forEach(function (r) { byId[r.id] = r; });

    var chosenId = byId[input.pushDirection] ? input.pushDirection : 'width';
    var chosen = byId[chosenId];

    var easiest = results.reduce(function (best, r) {
      return r.tipForce < best.tipForce ? r : best;
    }, results[0]);

    /* ---------------- validation and caveats ---------------- */
    var errors = [];
    var warnings = [];

    if (totalMass <= EPS) errors.push('Enter a weight for the baseplate or the pole.');
    if (plateLength <= EPS || plateWidth <= EPS) errors.push('Enter both baseplate dimensions.');
    if (poleLength <= EPS && !pushHeightGiven) errors.push('Enter a pole length.');
    if (pushHeight <= EPS) errors.push('The push has to be applied above ground level.');

    if (!errors.length) {
      if (!isFinite(chosen.tipForce)) {
        warnings.push(
          'At ' + angleDeg.toFixed(0) + '° the push is aimed too steeply downwards to ' +
          'tip this over — it just presses it into the ground. No force will do it.'
        );
      }
      if (chosen.slidesFirst) {
        warnings.push(
          'With a friction coefficient of ' + friction + ' it slides before it tips: ' +
          'sliding starts at about ' + Math.round(slideForce) + ' N. ' +
          'It will only tip if the base is stopped from sliding.'
        );
      }
      if (pushHeightGiven && pushHeight > poleTop + EPS) {
        warnings.push('The push height is above the top of the pole.');
      }
      if (cgHeight > EPS && chosen.tiltAngleDeg < 10) {
        warnings.push(
          'This is very top-heavy — a tilt of only ' + chosen.tiltAngleDeg.toFixed(1) +
          '° is enough to send it over on its own.'
        );
      }
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,

      // geometry / mass properties
      gravity: g,
      totalMass: totalMass,
      weight: weight,
      cgHeight: cgHeight,
      poleTop: poleTop,
      pushHeight: pushHeight,
      pushHeightIsPoleTop: !pushHeightGiven || Math.abs(pushHeight - poleTop) < 1e-9,
      pushAngleDeg: angleDeg,
      friction: friction,
      plate: {
        mass: plateMass,
        length: plateLength,
        width: plateWidth,
        thickness: plateThickness
      },
      pole: { mass: poleMass, length: poleLength },
      topMass: topMass,

      // answers
      directions: results,
      byDirection: byId,
      chosen: chosen,
      easiest: easiest,
      slideForce: slideForce,
      mode: chosen.slidesFirst ? 'slide' : 'tip'
    };
  }

  return {
    G_STANDARD: G_STANDARD,
    LBF_IN_N: LBF_IN_N,
    UNITS: UNITS,
    LENGTH_UNITS: LENGTH_UNITS,
    MASS_UNITS: MASS_UNITS,
    FORCE_UNITS: FORCE_UNITS,
    ENERGY_UNITS: ENERGY_UNITS,
    MOMENT_UNITS: MOMENT_UNITS,
    toBase: toBase,
    fromBase: fromBase,
    directionsFor: directionsFor,
    solve: solve
  };
});
