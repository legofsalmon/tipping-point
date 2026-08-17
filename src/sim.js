/*
 * tipping-point — dynamics
 *
 * The static solver in physics.js answers "how hard do I have to push". This
 * one answers "and then what happens": it integrates the assembly rotating up
 * onto its pivot edge, falling back, going over, or sliding away.
 *
 * The body is reduced to a 2-D problem in the plane of the push. Rotation is
 * about the pivot edge, which sits at the origin with the object extending in
 * −x, so a positive tip angle rotates it clockwise up over that edge:
 *
 *     x_world =  x·cosθ + y·sinθ
 *     y_world = −x·sinθ + y·cosθ
 *
 * Equation of motion about the pivot, with θ measured from upright:
 *
 *     I·θ̈ = F·R·sin(γ + θ − θp)      the push
 *          − W·r·cos(ψ + θ)          its own weight holding it down
 *          − m·a·h_cg(θ)             relief from the base sliding away
 *
 * where r, ψ locate the centre of mass from the pivot and R, γ locate the
 * point being pushed. At θ = 0 with the base held this reduces exactly to the
 * static result, which is what the tests check.
 *
 * Loaded as a classic script in the browser and via require() under Node.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TippingSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EPS = 1e-12;
  var MAX_FRAME = 0.05; // ignore anything longer — a backgrounded tab, say
  var SUB_STEP = 1 / 480;

  /**
   * Rigid-body parameters, derived from a solved static result.
   *
   * The effective lever arm is used as the half-width, so a corner push is
   * modelled as the equivalent square-on problem. That reproduces the tipping
   * threshold and the balance angle exactly; only the moment of inertia, and
   * so the speed of the fall, is approximate for that one case.
   */
  function makeBody(result) {
    var d = result.chosen.leverArm;
    if (!isFinite(d) || d <= 0) d = 1e-4;

    var t = result.plate.thickness;
    var L = result.pole.length;
    var mPlate = result.plate.mass;
    var mPole = result.pole.mass;
    var mTop = result.topMass;
    var mass = Math.max(result.totalMass, 1e-9);
    var hCg = result.cgHeight;
    var hPush = Math.max(result.pushHeight, 1e-6);
    var poleTop = Math.max(result.poleTop, 1e-6);

    /* Moment of inertia about the pivot edge. The plate is a slab pivoting
     * about one of its bottom edges, the pole a rod offset from it, anything
     * on top a point mass. */
    var a = 2 * d;
    var inertia =
      (mPlate * (a * a + t * t)) / 3 +
      mPole * ((L * L) / 12 + d * d + Math.pow(t + L / 2, 2)) +
      mTop * (d * d + Math.pow(t + L, 2));
    if (!(inertia > 0)) inertia = mass * Math.max(d * d, 1e-6);

    var gammaTop = Math.atan2(poleTop, d);

    return {
      mass: mass,
      weight: result.weight,
      g: result.gravity,
      mu: result.friction == null ? 0.6 : result.friction,
      d: d,
      thickness: t,
      poleLength: L,
      poleTop: poleTop,
      hCg: hCg,
      hPush: hPush,
      pushAngleRad: (result.pushAngleDeg * Math.PI) / 180,
      inertia: inertia,

      // centre of mass, as seen from the pivot
      r: Math.hypot(d, hCg),
      psi: Math.atan2(hCg, d),

      // the point being pushed, as seen from the pivot
      R: Math.hypot(d, hPush),
      gamma: Math.atan2(hPush, d),

      // balance point: past this its own weight carries it over
      thetaBalance: Math.PI / 2 - Math.atan2(hCg, d),

      // and it comes to rest when the top of the pole reaches the ground
      thetaEnd: Math.PI - gammaTop
    };
  }

  function makeState() {
    return {
      theta: 0, // tip angle, radians
      omega: 0, // and its rate
      slide: 0, // how far the base has slid, metres
      slideVel: 0,
      fallen: false,
      landed: false // set on the frame it thumps back down, for the UI
    };
  }

  /** Horizontal acceleration of the base for the current force. */
  function slideAccel(body, state, force, baseHeld) {
    if (baseHeld) return 0;

    var cosP = Math.cos(body.pushAngleRad);
    var sinP = Math.sin(body.pushAngleRad);
    var drive = force * cosP;

    // Pressing down adds grip; pulling up takes it away.
    var normal = Math.max(0, body.weight + force * sinP);
    var grip = body.mu * normal;

    if (state.slideVel > EPS) return (drive - grip) / body.mass;
    return drive > grip ? (drive - grip) / body.mass : 0;
  }

  /**
   * The two moments about the pivot, plus the relief from any sliding.
   * Exposed separately so the UI can show them fighting each other.
   */
  function moments(body, state, force, baseHeld) {
    var accel = slideAccel(body, state, force, baseHeld);
    var cgHeightNow = body.r * Math.sin(body.psi + state.theta);

    return {
      overturning: force * body.R * Math.sin(body.gamma + state.theta - body.pushAngleRad),
      righting: body.weight * body.r * Math.cos(body.psi + state.theta),
      slidingRelief: body.mass * accel * cgHeightNow,
      accel: accel
    };
  }

  function netMoment(body, state, force, baseHeld) {
    var m = moments(body, state, force, baseHeld);
    return m.overturning - m.righting - m.slidingRelief;
  }

  /** One fixed sub-step of semi-implicit Euler. */
  function integrate(body, state, dt, force, baseHeld) {
    var accel = slideAccel(body, state, force, baseHeld);

    // translation
    if (accel !== 0 || state.slideVel > EPS) {
      state.slideVel = Math.max(0, state.slideVel + accel * dt);
      state.slide += state.slideVel * dt;
    }

    // Down but still moving: it keeps sliding to a stop where it landed.
    if (state.fallen) return;

    // rotation
    var net = netMoment(body, state, force, baseHeld);

    if (state.theta <= EPS && net <= 0 && state.omega <= 0) {
      // sitting flat on its base with nothing lifting it
      state.theta = 0;
      state.omega = 0;
      return;
    }

    state.omega += (net / body.inertia) * dt;
    state.theta += state.omega * dt;

    if (state.theta <= 0) {
      /* Back down on its base. The edge landing is treated as perfectly
       * inelastic — it thumps rather than bouncing, which is both what
       * happens and what stops it oscillating forever. */
      if (state.theta < -EPS || state.omega < 0) state.landed = true;
      state.theta = 0;
      state.omega = 0;
    } else if (state.theta >= body.thetaEnd) {
      state.theta = body.thetaEnd;
      state.omega = 0;
      state.fallen = true;
    }
  }

  /**
   * Advance the simulation by up to one frame, sub-stepping for stability.
   * @returns {object} the same state object, mutated
   */
  function advance(body, state, dt, force, baseHeld) {
    state.landed = false;

    var remaining = Math.min(Math.max(dt, 0), MAX_FRAME);
    while (remaining > EPS) {
      var h = Math.min(SUB_STEP, remaining);
      integrate(body, state, h, Math.max(0, force || 0), !!baseHeld);
      remaining -= h;
    }
    return state;
  }

  /** Nothing left to animate — the caller can stop asking for frames. */
  function isIdle(body, state, force, baseHeld) {
    if (state.slideVel > 1e-6) return false;
    if (state.fallen) return true;
    if (state.theta > 1e-9 || Math.abs(state.omega) > 1e-9) return false;
    return netMoment(body, state, force, baseHeld) <= 0;
  }

  /**
   * The force at which it starts to lift, with the base held so it cannot
   * slide away. Same quantity the static solver reports; kept here so the two
   * can be checked against each other.
   */
  function onsetForce(body) {
    var lever = body.R * Math.sin(body.gamma - body.pushAngleRad);
    if (lever <= EPS) return Infinity;
    return (body.weight * body.r * Math.cos(body.psi)) / lever;
  }

  /** Where things stand, for the status line. */
  function describe(body, state, force, baseHeld) {
    if (state.fallen) return 'fallen';
    if (state.theta >= body.thetaBalance - 1e-9) return 'going-over';
    if (state.theta > 1e-6) return force > 0 ? 'lifting' : 'falling-back';
    if (!baseHeld && state.slideVel > 1e-6) return 'sliding';
    return force > 0 ? 'holding' : 'at-rest';
  }

  /**
   * Body-frame point (x from the pivot, negative into the object; y up) after
   * rotating by the current tip angle. Used for drawing.
   */
  function rotate(state, x, y) {
    var c = Math.cos(state.theta);
    var s = Math.sin(state.theta);
    return { x: x * c + y * s, y: -x * s + y * c };
  }

  return {
    makeBody: makeBody,
    makeState: makeState,
    moments: moments,
    netMoment: netMoment,
    advance: advance,
    isIdle: isIdle,
    onsetForce: onsetForce,
    describe: describe,
    rotate: rotate,
    slideAccel: slideAccel
  };
});
