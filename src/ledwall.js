/*
 * tipping-point — LED wall on ground support
 *
 * An LED wall built onto the front face of vertical truss uprights, each
 * standing on its own ballasted baseplate, spaced across the width of the
 * wall. Works out how many uprights it takes, how much ballast each one
 * needs, and what wind it will stand up to.
 *
 *              wind ->|                    coordinates: x forward, from the
 *      ___             |####|  <- LED wall  truss centreline, positive toward
 *     |    |           |####|               the face the wall looks at; y up
 *     |    | <- truss  |####|               from the ground.
 *     |    |           |####|
 *   __|____|___________|####|
 *   |  ballast    baseplate |
 *   +-----------------------+---> x
 *  -back                  +front
 *                            ^ pivot for forward tipping
 *
 * Two load cases, and they are not symmetric:
 *
 *   Wind on the face pushes the structure backwards, over the rear edge of
 *   the baseplates. The wall's own weight sits well forward of that edge, so
 *   it helps hold the structure down.
 *
 *   Wind from behind pushes it forwards, over the front edge. Now the wall's
 *   weight is barely inside that edge — or outside it — and works against
 *   you. This is usually the case that decides the job, because the front of
 *   the baseplate is exactly where you have least room.
 *
 * NOT a substitute for a structural engineer. Ground support is life safety
 * kit: real designs are signed off against the manufacturer's load data and
 * a wind standard (ANSI E1.21 for outdoor temporary structures, EN 13782,
 * ASCE 7 / EN 1991-1-4 for the wind itself). This gives you a first pass, a
 * sanity check on someone else's numbers, and a feel for what the levers do.
 *
 * Loaded as a classic script in the browser and via require() under Node.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LedWall = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EPS = 1e-9;
  var AIR_DENSITY = 1.225; // kg/m^3, dry air at 15 °C and sea level

  /* Multiply by these to reach the SI base unit. */
  var SPEED_UNITS = {
    'm/s': { toBase: 1, label: 'm/s' },
    'km/h': { toBase: 1 / 3.6, label: 'km/h' },
    mph: { toBase: 0.44704, label: 'mph' },
    kn: { toBase: 0.514444, label: 'kn' }
  };

  var AREAL_UNITS = {
    'kg/m²': { toBase: 1, label: 'kg/m²' },
    'lb/ft²': { toBase: 4.882427636, label: 'lb/ft²' }
  };

  var LINEAR_UNITS = {
    'kg/m': { toBase: 1, label: 'kg/m' },
    'lb/ft': { toBase: 1.488163944, label: 'lb/ft' }
  };

  /* Rough areal masses, cabinet plus frame. Real figures come off the
   * product data sheet and vary a lot. */
  var PANEL_PRESETS = [
    { label: 'Indoor, fine pitch', value: 22 },
    { label: 'Indoor, typical', value: 30 },
    { label: 'Outdoor, typical', value: 40 },
    { label: 'Outdoor, heavy', value: 55 }
  ];

  /* Aluminium truss, mass per metre. */
  var TRUSS_PRESETS = [
    { label: '300 mm box', value: 6.5, depth: 0.3 },
    { label: '400 mm box', value: 9.2, depth: 0.4 },
    { label: '500 mm box', value: 12.5, depth: 0.5 },
    { label: '600 mm box', value: 16, depth: 0.6 }
  ];

  /* Net force coefficients for a solid wall standing on the ground. The codes
   * put this between about 1.2 and 1.8 depending on aspect ratio, ground
   * clearance and how the wind gusts are treated. */
  var CF_PRESETS = [
    { label: '1.2 — slender, low', value: 1.2 },
    { label: '1.3 — typical wall', value: 1.3 },
    { label: '1.5 — cautious', value: 1.5 },
    { label: '1.8 — code upper end', value: 1.8 }
  ];

  function toBase(value, unit, table) {
    var u = table[unit];
    if (!u) throw new Error('unknown unit: ' + unit);
    return value * u.toBase;
  }

  function fromBase(value, unit, table) {
    var u = table[unit];
    if (!u) throw new Error('unknown unit: ' + unit);
    return value / u.toBase;
  }

  function nonNeg(value) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function positive(value, fallback) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  /** Dynamic wind pressure, N/m². */
  function windPressure(speed, density) {
    return 0.5 * (density || AIR_DENSITY) * speed * speed;
  }

  /** Beaufort number for a speed in m/s — handy for reading a forecast. */
  function beaufort(speed) {
    var limits = [0.5, 1.5, 3.3, 5.5, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6];
    for (var i = 0; i < limits.length; i += 1) {
      if (speed < limits[i]) return i;
    }
    return 12;
  }

  var BEAUFORT_NAMES = [
    'calm', 'light air', 'light breeze', 'gentle breeze', 'moderate breeze',
    'fresh breeze', 'strong breeze', 'near gale', 'gale', 'strong gale',
    'storm', 'violent storm', 'hurricane force'
  ];

  /* ------------------------------------------------------------------ *
   * Geometry and mass layout
   * ------------------------------------------------------------------ */

  /**
   * Everything about the structure that doesn't depend on how many uprights
   * there are, or on the wind.
   */
  function layout(input) {
    var g = positive(input.gravity, 9.80665);

    var wallWidth = nonNeg(input.wallWidth);
    var wallHeight = nonNeg(input.wallHeight);
    var wallBottom = nonNeg(input.wallBottom);
    var wallDepth = nonNeg(input.wallDepth);
    var arealMass = nonNeg(input.wallArealMass);

    var trussHeight = nonNeg(input.trussHeight);
    var trussDepth = nonNeg(input.trussDepth);
    var trussLinearMass = nonNeg(input.trussLinearMass);

    var plateFront = nonNeg(input.plateFront);
    var plateBack = nonNeg(input.plateBack);
    var plateWidth = nonNeg(input.plateWidth);
    var plateMass = nonNeg(input.plateMass);
    var ballastMass = nonNeg(input.ballastMass);

    /* Heights of the plate and the ballast stack. These make no difference to
     * overturning — about an edge on the ground only the horizontal offsets
     * matter — but the simulation and the drawing both need them. */
    var plateThickness = positive(input.plateThickness, 0.02);
    var ballastHeight = positive(input.ballastHeight, 0.18);

    var area = wallWidth * wallHeight;
    var wallMass = area * arealMass;

    /* The wall hangs off the front face of the truss, so its mass sits this
     * far forward of the truss centreline. */
    var wallX = trussDepth / 2 + wallDepth / 2;
    var wallCentreHeight = wallBottom + wallHeight / 2;

    var trussMass = trussHeight * trussLinearMass;
    var plateDepth = plateFront + plateBack;
    var plateCentroidX = (plateFront - plateBack) / 2;

    /* Ballast defaults to sitting over the middle of the plate. Stacking it
     * at the back is better, and that's what the override is for. */
    var ballastX = input.ballastX == null || !isFinite(Number(input.ballastX))
      ? plateCentroidX
      : Number(input.ballastX);

    return {
      g: g,
      area: area,
      wallWidth: wallWidth,
      wallHeight: wallHeight,
      wallBottom: wallBottom,
      wallTop: wallBottom + wallHeight,
      wallDepth: wallDepth,
      wallMass: wallMass,
      wallX: wallX,
      wallCentreHeight: wallCentreHeight,
      arealMass: arealMass,

      trussHeight: trussHeight,
      trussDepth: trussDepth,
      trussMass: trussMass,
      trussLinearMass: trussLinearMass,

      plateFront: plateFront,
      plateBack: plateBack,
      plateWidth: plateWidth,
      plateDepth: plateDepth,
      plateMass: plateMass,
      plateCentroidX: plateCentroidX,
      plateThickness: plateThickness,
      ballastMass: ballastMass,
      ballastX: ballastX,
      ballastHeight: ballastHeight,

      /** Masses that repeat once per upright, with their forward offsets. */
      perUprightParts: [
        { name: 'truss', mass: trussMass, x: 0, y: plateThickness + trussHeight / 2 },
        { name: 'baseplate', mass: plateMass, x: plateCentroidX, y: plateThickness / 2 },
        {
          name: 'ballast',
          mass: ballastMass,
          x: ballastX,
          y: plateThickness + ballastHeight / 2
        }
      ],
      /** And the one that doesn't. */
      wallPart: { name: 'LED wall', mass: wallMass, x: wallX, y: wallCentreHeight }
    };
  }

  /* ------------------------------------------------------------------ *
   * Overturning
   * ------------------------------------------------------------------ */

  /**
   * Moments about one baseplate edge, for the whole structure.
   *
   * @param {object} L layout
   * @param {number} n how many uprights
   * @param {number} windForce total horizontal force on the wall, N
   * @param {1|-1} dir +1 tips forward over the front edge, -1 tips backward
   *   over the rear edge
   */
  function moments(L, n, windForce, dir) {
    var pivotX = dir > 0 ? L.plateFront : -L.plateBack;

    /* Lever arm of a mass about the pivot, measured positive when it sits
     * behind the pivot and so resists the tipping. */
    var lever = function (x) {
      return dir > 0 ? pivotX - x : x - pivotX;
    };

    var restoring = 0;
    var overturning = windForce * L.wallCentreHeight;
    var items = [];

    var add = function (part, count) {
      if (part.mass <= 0) return;
      var arm = lever(part.x);
      var moment = count * part.mass * L.g * arm;
      items.push({
        name: part.name,
        count: count,
        mass: count * part.mass,
        arm: arm,
        moment: moment
      });
      if (moment >= 0) restoring += moment;
      else overturning += -moment;
    };

    add(L.wallPart, 1);
    L.perUprightParts.forEach(function (part) {
      add(part, n);
    });

    return {
      dir: dir,
      pivotX: pivotX,
      windForce: windForce,
      windMoment: windForce * L.wallCentreHeight,
      windArm: L.wallCentreHeight,
      restoring: restoring,
      overturning: overturning,
      items: items,
      // >= the safety factor and it stands up
      ratio: overturning > EPS ? restoring / overturning : Infinity
    };
  }

  /** Signed moment contributions, split into the parts that scale with n. */
  function momentSplit(L, dir) {
    var pivotX = dir > 0 ? L.plateFront : -L.plateBack;
    var lever = function (x) {
      return dir > 0 ? pivotX - x : x - pivotX;
    };
    var split = function (parts) {
      var rest = 0;
      var over = 0;
      parts.forEach(function (p) {
        var m = p.mass * L.g * lever(p.x);
        if (m >= 0) rest += m;
        else over += -m;
      });
      return { restoring: rest, overturning: over };
    };
    return {
      perUpright: split(L.perUprightParts),
      fixed: split([L.wallPart])
    };
  }

  /**
   * Fewest uprights that keep `restoring >= safety × overturning`.
   * Returns Infinity when no number of uprights can do it — which means the
   * geometry itself is wrong, not that you need more legs.
   */
  function uprightsForStability(L, windForce, dir, safety) {
    var s = momentSplit(L, dir);
    var need = safety * (windForce * L.wallCentreHeight + s.fixed.overturning) - s.fixed.restoring;
    if (need <= 0) return 1;

    var per = s.perUpright.restoring - safety * s.perUpright.overturning;
    if (per <= EPS) return Infinity;
    return Math.ceil(need / per);
  }

  /**
   * Wind speed at which the safety factor runs out, for a given number of
   * uprights. This is the number worth putting on the production's wind
   * action plan.
   */
  function limitingWindSpeed(L, n, dir, safety, coefficient, density) {
    var s = moments(L, n, 0, dir); // moments with no wind at all
    var allowed = s.restoring / safety - s.overturning;
    if (allowed <= 0) return 0; // already over its limit standing still
    if (L.wallCentreHeight <= EPS || L.area <= EPS || coefficient <= EPS) return Infinity;

    var force = allowed / L.wallCentreHeight;
    var pressure = force / (coefficient * L.area);
    return Math.sqrt((2 * pressure) / (density || AIR_DENSITY));
  }

  /** Ballast per baseplate needed to hold the given case. */
  function ballastForCase(L, n, windForce, dir, safety) {
    var pivotX = dir > 0 ? L.plateFront : -L.plateBack;
    var arm = dir > 0 ? pivotX - L.ballastX : L.ballastX - pivotX;
    if (arm <= EPS) return Infinity; // ballast there would not help

    // moments without any ballast at all
    var bare = layout({
      gravity: L.g,
      wallWidth: L.wallWidth,
      wallHeight: L.wallHeight,
      wallBottom: L.wallBottom,
      wallDepth: L.wallDepth,
      wallArealMass: L.arealMass,
      trussHeight: L.trussHeight,
      trussDepth: L.trussDepth,
      trussLinearMass: L.trussLinearMass,
      plateFront: L.plateFront,
      plateBack: L.plateBack,
      plateWidth: L.plateWidth,
      plateMass: L.plateMass,
      ballastMass: 0,
      ballastX: L.ballastX
    });
    var m = moments(bare, n, windForce, dir);
    var shortfall = safety * m.overturning - m.restoring;
    if (shortfall <= 0) return 0;
    return shortfall / (n * L.g * arm);
  }

  /* ------------------------------------------------------------------ *
   * The whole job
   * ------------------------------------------------------------------ */

  /**
   * @param {object} input SI throughout: metres, kilograms, m/s.
   *   wallWidth, wallHeight, wallBottom, wallDepth, wallArealMass
   *   trussHeight, trussDepth, trussLinearMass
   *   plateFront, plateBack, plateWidth, plateMass, ballastMass, ballastX
   *   windSpeed, forceCoefficient, airDensity, safetyFactor
   *   maxSpacing, maxLoadPerUpright, uprights (override), gravity
   */
  function solve(input) {
    input = input || {};
    var L = layout(input);

    var safety = positive(input.safetyFactor, 1.5);
    var coefficient = positive(input.forceCoefficient, 1.3);
    var density = positive(input.airDensity, AIR_DENSITY);
    var windSpeed = nonNeg(input.windSpeed);
    var maxSpacing = positive(input.maxSpacing, 3);
    var maxLoadPerUpright = positive(input.maxLoadPerUpright, 500);

    var pressure = windPressure(windSpeed, density);
    var windForce = pressure * coefficient * L.area;

    /* --------------------------- how many uprights ------------------- */

    /* Uprights at both ends, so n uprights make n-1 bays. */
    var bySpacing = L.wallWidth > EPS ? Math.ceil(L.wallWidth / maxSpacing) + 1 : 2;

    /* An interior upright carries one bay's width of wall. */
    var byLoad = L.wallMass > EPS && maxLoadPerUpright > EPS
      ? Math.ceil(L.wallMass / maxLoadPerUpright) + 1
      : 2;

    var forwardNeed = uprightsForStability(L, windForce, 1, safety);
    var backwardNeed = uprightsForStability(L, windForce, -1, safety);
    var byStability = Math.max(forwardNeed, backwardNeed);

    var candidates = [
      { id: 'spacing', label: 'how far apart the uprights can be', n: bySpacing },
      { id: 'load', label: 'weight of wall each upright carries', n: byLoad },
      { id: 'stability', label: 'staying upright in the wind', n: byStability }
    ];
    var minimum = Math.max(2, bySpacing, byLoad, isFinite(byStability) ? byStability : 2);

    var governing = candidates.reduce(function (worst, c) {
      return c.n > worst.n ? c : worst;
    }, candidates[0]);
    if (!isFinite(byStability)) governing = candidates[2];

    var override = Number(input.uprights);
    var usingOverride = isFinite(override) && override >= 2;
    var uprights = usingOverride ? Math.round(override) : minimum;

    /* ------------------------------ the checks ----------------------- */

    var cases = [
      {
        id: 'forward',
        label: 'Wind from behind, tipping forward',
        note: 'over the front edge of the baseplates — the wall\'s own weight works against you here',
        moments: moments(L, uprights, windForce, 1),
        ballast: ballastForCase(L, uprights, windForce, 1, safety),
        limitingWind: limitingWindSpeed(L, uprights, 1, safety, coefficient, density),
        tippingWind: limitingWindSpeed(L, uprights, 1, 1, coefficient, density),
        uprightsNeeded: forwardNeed
      },
      {
        id: 'backward',
        label: 'Wind on the face, tipping backward',
        note: 'over the rear edge — the wall hangs forward of it, so its weight helps hold things down',
        moments: moments(L, uprights, windForce, -1),
        ballast: ballastForCase(L, uprights, windForce, -1, safety),
        limitingWind: limitingWindSpeed(L, uprights, -1, safety, coefficient, density),
        tippingWind: limitingWindSpeed(L, uprights, -1, 1, coefficient, density),
        uprightsNeeded: backwardNeed
      },
      {
        id: 'dead',
        label: 'No wind at all, tipping forward',
        note: 'the wall hanging off the front face still wants to pull it over',
        moments: moments(L, uprights, 0, 1),
        ballast: ballastForCase(L, uprights, 0, 1, safety),
        limitingWind: null,
        tippingWind: null,
        uprightsNeeded: uprightsForStability(L, 0, 1, safety)
      }
    ];

    var governingCase = cases.reduce(function (worst, c) {
      return c.moments.ratio < worst.moments.ratio ? c : worst;
    }, cases[0]);

    var spacing = uprights > 1 ? L.wallWidth / (uprights - 1) : L.wallWidth;
    var tributary = spacing; // an interior upright's share
    var wallPerUpright = uprights > 1 ? L.wallMass / (uprights - 1) : L.wallMass;

    var totalMass =
      L.wallMass + uprights * (L.trussMass + L.plateMass + L.ballastMass);
    var ballastNeeded = Math.max.apply(
      null,
      cases.map(function (c) {
        return isFinite(c.ballast) ? c.ballast : 0;
      })
    );

    /* ------------------------------- caveats ------------------------- */

    var errors = [];
    var warnings = [];

    if (L.wallWidth <= EPS || L.wallHeight <= EPS) errors.push('Enter the wall size.');
    if (L.arealMass <= EPS) errors.push('Enter the panel weight.');
    if (L.trussHeight <= EPS) errors.push('Enter the height of the truss uprights.');
    if (L.plateDepth <= EPS) errors.push('Enter how far the baseplate reaches front and back.');

    if (!errors.length) {
      if (L.wallTop > L.trussHeight + 1e-6) {
        errors.push(
          'The wall reaches ' + L.wallTop.toFixed(2) + ' m but the uprights are only ' +
            L.trussHeight.toFixed(2) + ' m — the truss has to be at least as tall as the wall.'
        );
      }
      if (!isFinite(byStability)) {
        warnings.push(
          'No number of uprights fixes this: with the baseplate reaching only ' +
            (L.plateFront * 1000).toFixed(0) + ' mm in front of the truss, each one you add ' +
            'brings more overturning than it resists. Reach further forward, or move the ' +
            'ballast back.'
        );
      }
      if (cases[2].moments.ratio < safety) {
        warnings.push(
          'It does not even make the safety factor standing still in still air — the wall ' +
            'hanging off the front face is enough on its own. Reach further forward with the ' +
            'baseplate or add ballast before thinking about wind.'
        );
      }
      if (L.wallX > L.plateFront + 1e-9) {
        warnings.push(
          'The wall\'s weight sits ' + ((L.wallX - L.plateFront) * 1000).toFixed(0) +
            ' mm outside the front edge of the baseplate, so it is pulling the structure over ' +
            'before any wind arrives.'
        );
      }
      if (usingOverride && uprights < minimum) {
        warnings.push(
          'You have set ' + uprights + ' uprights, but the checks want at least ' + minimum + '.'
        );
      }
      if (ballastNeeded > L.ballastMass + 1e-6) {
        warnings.push(
          'Ballast is short: ' + Math.ceil(ballastNeeded) + ' kg per baseplate is needed at ' +
            uprights + ' uprights, against the ' + Math.round(L.ballastMass) + ' kg entered.'
        );
      }
      if (spacing > maxSpacing + 1e-9) {
        warnings.push(
          'Uprights would sit ' + spacing.toFixed(2) + ' m apart, wider than the ' +
            maxSpacing.toFixed(2) + ' m limit set.'
        );
      }
      if (wallPerUpright > maxLoadPerUpright + 1e-6) {
        warnings.push(
          'Each interior upright would carry ' + Math.round(wallPerUpright) + ' kg of wall, ' +
            'over the ' + Math.round(maxLoadPerUpright) + ' kg limit set.'
        );
      }
      if (L.plateWidth > EPS && spacing < L.plateWidth) {
        warnings.push(
          'At ' + spacing.toFixed(2) + ' m apart the baseplates would overlap — they are ' +
            (L.plateWidth * 1000).toFixed(0) + ' mm wide.'
        );
      }
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,

      layout: L,
      safetyFactor: safety,
      forceCoefficient: coefficient,
      airDensity: density,
      windSpeed: windSpeed,
      windPressure: pressure,
      windForce: windForce,
      windForcePerUpright: uprights > 0 ? windForce / uprights : windForce,
      beaufort: beaufort(windSpeed),
      beaufortName: BEAUFORT_NAMES[beaufort(windSpeed)],

      uprights: uprights,
      minimumUprights: minimum,
      usingOverride: usingOverride,
      governingConstraint: governing,
      constraints: candidates,
      spacing: spacing,
      tributary: tributary,
      maxSpacing: maxSpacing,
      maxLoadPerUpright: maxLoadPerUpright,

      /* Passing the overturning check is not the same as being buildable: at
       * some point the baseplates would have to overlap, or no number of
       * uprights would help. */
      buildable:
        isFinite(byStability) &&
        !(L.plateWidth > EPS && spacing + EPS < L.plateWidth),

      cases: cases,
      byCase: cases.reduce(function (acc, c) {
        acc[c.id] = c;
        return acc;
      }, {}),
      governingCase: governingCase,
      worstRatio: governingCase.moments.ratio,
      passes: governingCase.moments.ratio >= safety,

      ballastPerUpright: L.ballastMass,
      ballastNeededPerUpright: ballastNeeded,
      ballastTotal: uprights * L.ballastMass,
      wallMassPerUpright: wallPerUpright,
      loadPerUpright: wallPerUpright + L.trussMass,
      totalMass: totalMass,
      /* Two numbers worth keeping apart: the speed at which the margin runs
       * out, and the speed at which it actually goes over. */
      limitingWindSpeed: Math.min(cases[0].limitingWind, cases[1].limitingWind),
      tippingWindSpeed: Math.min(cases[0].tippingWind, cases[1].tippingWind)
    };
  }

  return {
    AIR_DENSITY: AIR_DENSITY,
    SPEED_UNITS: SPEED_UNITS,
    AREAL_UNITS: AREAL_UNITS,
    LINEAR_UNITS: LINEAR_UNITS,
    PANEL_PRESETS: PANEL_PRESETS,
    TRUSS_PRESETS: TRUSS_PRESETS,
    CF_PRESETS: CF_PRESETS,
    BEAUFORT_NAMES: BEAUFORT_NAMES,
    toBase: toBase,
    fromBase: fromBase,
    windPressure: windPressure,
    beaufort: beaufort,
    layout: layout,
    moments: moments,
    momentSplit: momentSplit,
    uprightsForStability: uprightsForStability,
    limitingWindSpeed: limitingWindSpeed,
    ballastForCase: ballastForCase,
    solve: solve
  };
});
