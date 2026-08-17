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
   * Build a body from a list of masses and shapes.
   *
   * Coordinates come in with x measured forward from the upright's centreline
   * and y up from the ground — the same frame the LED wall calculations use.
   * Everything is shifted to be relative to the pivot on the way in, because
   * the equations of motion are all written about that point.
   *
   * @param {object} spec
   *   pivotX     where the tipping edge is, in the incoming frame
   *   parts      [{mass, x, y, icm}] — icm about the part's own centre
   *   shapes     [{x0, y0, x1, y1, role}] for drawing
   *   push       {x, y} where the load is applied
   *   endPoint   {x, y} whatever hits the ground and stops the fall
   *   g, mu, pushAngleDeg
   */
  function makeBodyFromParts(spec) {
    var pivotX = spec.pivotX || 0;
    var parts = (spec.parts || []).filter(function (p) {
      return p.mass > 0;
    });

    var mass = 0;
    var sumX = 0;
    var sumY = 0;
    parts.forEach(function (p) {
      mass += p.mass;
      sumX += p.mass * p.x;
      sumY += p.mass * p.y;
    });
    mass = Math.max(mass, 1e-9);

    var cgX = sumX / mass;
    var cgY = sumY / mass;

    // horizontal distance from the pivot back to the centre of mass
    var d = Math.max(pivotX - cgX, 1e-6);
    var hCg = Math.max(cgY, 0);

    var inertia = 0;
    parts.forEach(function (p) {
      var dx = p.x - pivotX;
      inertia += (p.icm || 0) + p.mass * (dx * dx + p.y * p.y);
    });
    if (!(inertia > 0)) inertia = mass * Math.max(d * d, 1e-6);

    var push = spec.push || { x: cgX, y: hCg };
    var dPush = Math.max(pivotX - push.x, 1e-6);
    var hPush = Math.max(push.y, 1e-6);

    /* Whatever touches down first ends the fall. Given shapes but no explicit
     * point, that's the corner with the steepest line back to the pivot. */
    var end = spec.endPoint;
    if (!end && spec.shapes && spec.shapes.length) {
      var steepest = -Infinity;
      spec.shapes.forEach(function (s) {
        [[s.x0, s.y0], [s.x1, s.y0], [s.x0, s.y1], [s.x1, s.y1]].forEach(function (c) {
          if (c[1] <= 1e-6) return; // already on the ground
          var slope = Math.atan2(c[1], pivotX - c[0]);
          if (slope > steepest) {
            steepest = slope;
            end = { x: c[0], y: c[1] };
          }
        });
      });
    }
    end = end || push;
    var endReach = pivotX - end.x;
    var g = spec.g > 0 ? spec.g : 9.80665;

    return {
      mass: mass,
      weight: mass * g,
      g: g,
      mu: spec.mu == null ? 0.6 : Math.max(0, spec.mu),
      d: d,
      hCg: hCg,
      hPush: hPush,
      pushAngleRad: ((spec.pushAngleDeg || 0) * Math.PI) / 180,
      inertia: inertia,

      r: Math.hypot(d, hCg),
      psi: Math.atan2(hCg, d),

      R: Math.hypot(dPush, hPush),
      gamma: Math.atan2(hPush, dPush),

      thetaBalance: Math.PI / 2 - Math.atan2(hCg, d),
      /* A corner already in front of the pivot grounds out early, which is
       * why endReach is allowed to go negative here. */
      thetaEnd: Math.max(0.02, Math.PI - Math.atan2(Math.max(end.y, 1e-6), endReach)),

      // pivot-relative geometry for drawing
      shapes: (spec.shapes || []).map(function (s) {
        return {
          x0: s.x0 - pivotX,
          y0: s.y0,
          x1: s.x1 - pivotX,
          y1: s.y1,
          role: s.role
        };
      }),
      markers: (spec.markers || []).map(function (m) {
        return { x: m.x - pivotX, y: m.y, role: m.role };
      }),
      pushPoint: { x: push.x - pivotX, y: push.y },
      cgPoint: { x: cgX - pivotX, y: cgY },
      extent: {
        back: pivotX - Math.min.apply(null, (spec.shapes || [{ x0: cgX }]).map(function (s) {
          return Math.min(s.x0, s.x1);
        })),
        top: Math.max.apply(null, (spec.shapes || [{ y1: hCg }]).map(function (s) {
          return Math.max(s.y0, s.y1);
        }))
      }
    };
  }

  /**
   * Rigid-body parameters for the single pole on a baseplate.
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
    var poleTop = Math.max(result.poleTop, 1e-6);
    var hPush = Math.max(result.pushHeight, 1e-6);
    // a visual thickness for the pole — it has no diameter of its own
    var halfPole = Math.max(0.012, Math.min(0.05, d * 0.14));

    var body = makeBodyFromParts({
      g: result.gravity,
      mu: result.friction == null ? 0.6 : result.friction,
      pushAngleDeg: result.pushAngleDeg,
      // pole on the centreline at x = 0, tipping edge a lever arm away
      pivotX: d,
      parts: [
        {
          name: 'baseplate',
          mass: result.plate.mass,
          x: 0,
          y: t / 2,
          icm: (result.plate.mass * (4 * d * d + t * t)) / 12
        },
        {
          name: 'pole',
          mass: result.pole.mass,
          x: 0,
          y: t + L / 2,
          icm: (result.pole.mass * L * L) / 12
        },
        { name: 'top weight', mass: result.topMass, x: 0, y: poleTop, icm: 0 }
      ],
      shapes: [
        { x0: -d, y0: 0, x1: d, y1: t, role: 'plate' },
        { x0: -halfPole, y0: t, x1: halfPole, y1: poleTop, role: 'pole' }
      ],
      markers: result.topMass > 0 ? [{ x: 0, y: poleTop, role: 'load' }] : [],
      push: { x: 0, y: hPush },
      endPoint: { x: 0, y: poleTop }
    });

    body.thickness = t;
    body.poleLength = L;
    body.poleTop = poleTop;
    return body;
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
   * Where the centre of mass has got to.
   *
   * The centre of mass is a fixed point *in the body* — it never leaves the
   * object however far it rotates. What moves relative to the base is the
   * plumb line hanging from it, and that is the whole test: while the plumb
   * line lands inside the pivot the weight is holding the thing down, and the
   * moment it lands outside, the same weight is pulling it over.
   *
   * It also rises as the object tips, peaking exactly at the balance point —
   * which is why getting there costs energy and everything after it is free.
   */
  function cog(body, state) {
    var p = rotate(state, body.cgPoint.x, body.cgPoint.y);
    return {
      x: p.x, // positive once it is past the pivot
      y: p.y,
      insideBy: -p.x, // positive while the plumb line is still inside the base
      rise: p.y - body.hCg, // how far it has been lifted so far
      riseToBalance: body.r - body.hCg // and how far it has to go
    };
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
    makeBodyFromParts: makeBodyFromParts,
    makeState: makeState,
    moments: moments,
    netMoment: netMoment,
    advance: advance,
    isIdle: isIdle,
    onsetForce: onsetForce,
    describe: describe,
    cog: cog,
    rotate: rotate,
    slideAccel: slideAccel
  };
});
