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

  function fmtPercent(fraction) {
    return Math.round(fraction * 100) + '%';
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
    var wallDepth = nonNeg(input.wallDepth);
    var arealMass = nonNeg(input.wallArealMass);
    var wallBottomAsked = nonNeg(input.wallBottom);

    var trussHeight = nonNeg(input.trussHeight);
    var trussDepth = nonNeg(input.trussDepth);
    var trussLinearMass = nonNeg(input.trussLinearMass);

    var plateFront = nonNeg(input.plateFront);
    var plateBack = nonNeg(input.plateBack);
    var plateWidth = nonNeg(input.plateWidth);
    var plateMass = nonNeg(input.plateMass);
    var ballastMass = nonNeg(input.ballastMass);

    /* The plate's thickness sets how high the wall has to start when the plate
     * runs under it. The ballast stack height only matters to the drawing and
     * the simulation — about an edge on the ground, only horizontal offsets
     * change the moments. */
    var plateThickness = positive(input.plateThickness, 0.02);
    var ballastHeight = positive(input.ballastHeight, 0.18);

    var area = wallWidth * wallHeight;
    var wallMass = area * arealMass;

    /* The wall hangs off the front face of the truss, so its footprint runs
     * from the truss face out to the front of the cabinets. */
    var wallBackX = trussDepth / 2;
    var wallFootX = wallBackX + wallDepth;
    var wallX = wallBackX + wallDepth / 2;

    /* Where the baseplate reaches out under the wall, the wall cannot sit any
     * lower than the top of the plate — the plate is in the way. So the lowest
     * the bottom of the wall can go is the plate's own thickness. */
    var wallOverPlate = wallBackX < plateFront - EPS;
    var minWallBottom = wallOverPlate ? plateThickness : 0;
    var wallBottom = Math.max(wallBottomAsked, minWallBottom);
    var wallBottomRaised = wallBottom > wallBottomAsked + EPS;
    var restsOnPlate = wallOverPlate && wallBottom <= plateThickness + EPS && wallMass > 0;

    /* Resting on the ground is a different matter from resting on the plate.
     * Bearing on the plate is internal to the tipping body and changes nothing.
     * Bearing on the *ground* forward of the plate's front edge moves the edge
     * the whole thing tips about out to the wall's own footing.
     *
     * And where a ground bearing point falls inside the baseplate footprint it
     * changes nothing either: at the point of overturning the body is rotating
     * about the plate edge, so every contact behind it is already lifting off
     * and carrying nothing. */
    var wallOnGround = !!input.wallOnGround;
    var bearsOnGround = wallOnGround && wallBottom <= EPS && wallMass > 0;
    var bearsOnPlate = wallOnGround && restsOnPlate;
    var frontPivotX = bearsOnGround ? Math.max(plateFront, wallFootX) : plateFront;

    var wallCentreHeight = wallBottom + wallHeight / 2;

    var trussMass = trussHeight * trussLinearMass;

    /* The wall is a rigid structure bolted to the truss, so it does not have to
     * stop where the truss does — its own frame can carry the rows above the
     * top of the upright as a cantilever. What it does need is something to be
     * bolted to, which means the two have to overlap. */
    var wallTopY = wallBottom + wallHeight;
    var wallOverlap = Math.max(0, Math.min(wallTopY, trussHeight) - wallBottom);
    var wallCantilever = Math.max(0, wallTopY - trussHeight);
    var cantileverFraction = wallHeight > EPS ? wallCantilever / wallHeight : 0;

    /* The truss the wall covers is shielded by it, but anything sticking up
     * above the wall — or showing below it — is out in the wind. On a tall
     * upright behind a short wall that is most of its length, and it is what
     * makes truss height matter at all: its own weight is small and helps,
     * while its wind load is large and does not.
     *
     * A lattice is not a solid plate, so only the fraction of its projected
     * face that is actually metal counts. */
    var trussSolidity = Math.min(1, positive(input.trussSolidity, 0.3));
    var aboveWall = Math.max(0, trussHeight - (wallBottom + wallHeight));
    var belowWall = Math.min(wallBottom, trussHeight);
    var trussExposedLength = aboveWall + belowWall;
    var trussWindAreaPerUpright = trussExposedLength * trussDepth * trussSolidity;

    /* Area-weighted centre of the exposed parts, for the moment arm. */
    var trussWindHeight = 0;
    if (trussExposedLength > EPS) {
      trussWindHeight =
        (aboveWall * (wallBottom + wallHeight + aboveWall / 2) +
          belowWall * (belowWall / 2)) / trussExposedLength;
    }
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
      trussSolidity: trussSolidity,
      wallOverlap: wallOverlap,
      wallCantilever: wallCantilever,
      cantileverFraction: cantileverFraction,
      trussExposedAbove: aboveWall,
      trussExposedBelow: belowWall,
      trussExposedLength: trussExposedLength,
      trussWindAreaPerUpright: trussWindAreaPerUpright,
      trussWindHeight: trussWindHeight,

      wallOnGround: wallOnGround,
      wallBackX: wallBackX,
      wallFootX: wallFootX,
      wallOverPlate: wallOverPlate,
      minWallBottom: minWallBottom,
      wallBottomAsked: wallBottomAsked,
      wallBottomRaised: wallBottomRaised,
      restsOnPlate: restsOnPlate,
      bearsOnPlate: bearsOnPlate,
      bearsOnGround: bearsOnGround,
      /* The edge forward tipping happens about — the plate's front edge, or the
       * wall's own footing when that reaches further out. */
      frontPivotX: frontPivotX,
      pivotIsWallFoot: bearsOnGround && wallFootX > plateFront + 1e-9,

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
   * Wind loads, which now come in two parts: the wall, and the exposed truss
   * on each upright. A bare number is taken as the wall alone, so the simpler
   * call still reads well.
   */
  function asLoads(wind) {
    if (wind == null) return { wallForce: 0, trussForcePerUpright: 0 };
    if (typeof wind === 'number') return { wallForce: wind, trussForcePerUpright: 0 };
    return {
      wallForce: wind.wallForce || 0,
      trussForcePerUpright: wind.trussForcePerUpright || 0
    };
  }

  /**
   * Moments about one baseplate edge, for the whole structure.
   *
   * @param {object} L layout
   * @param {number} n how many uprights
   * @param {number} windForce total horizontal force on the wall, N
   * @param {1|-1} dir +1 tips forward over the front edge, -1 tips backward
   *   over the rear edge
   */
  function moments(L, n, wind, dir) {
    var loads = asLoads(wind);
    var pivotX = dir > 0 ? L.frontPivotX : -L.plateBack;

    /* Lever arm of a mass about the pivot, measured positive when it sits
     * behind the pivot and so resists the tipping. */
    var lever = function (x) {
      return dir > 0 ? pivotX - x : x - pivotX;
    };

    var wallMoment = loads.wallForce * L.wallCentreHeight;
    var trussMoment = n * loads.trussForcePerUpright * L.trussWindHeight;

    var restoring = 0;
    var overturning = wallMoment + trussMoment;
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
      windForce: loads.wallForce,
      trussWindForce: n * loads.trussForcePerUpright,
      windMoment: wallMoment + trussMoment,
      wallWindMoment: wallMoment,
      trussWindMoment: trussMoment,
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
    var pivotX = dir > 0 ? L.frontPivotX : -L.plateBack;
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
  function uprightsForStability(L, wind, dir, safety) {
    var loads = asLoads(wind);
    var s = momentSplit(L, dir);

    var need =
      safety * (loads.wallForce * L.wallCentreHeight + s.fixed.overturning) - s.fixed.restoring;
    if (need <= 0) return 1;

    /* Each upright brings its own exposed truss with it, so its wind load is a
     * per-upright *overturning* term. Enough of it and adding uprights makes
     * things worse rather than better — which is what the guard below catches. */
    var perTrussWind = loads.trussForcePerUpright * L.trussWindHeight;
    var per = s.perUpright.restoring - safety * (s.perUpright.overturning + perTrussWind);
    if (per <= EPS) return Infinity;
    return Math.ceil(need / per);
  }

  /**
   * Wind speed at which the safety factor runs out, for a given number of
   * uprights. This is the number worth putting on the production's wind
   * action plan.
   */
  function limitingWindSpeed(L, n, dir, safety, coefficient, density, trussCoefficient) {
    var s = moments(L, n, 0, dir); // moments with no wind at all
    var allowed = s.restoring / safety - s.overturning;
    if (allowed <= 0) return 0; // already over its limit standing still

    /* Both the wall and the exposed truss grow with the same pressure, so add
     * their moments per unit pressure and invert once. */
    var perPressure =
      coefficient * L.area * L.wallCentreHeight +
      n * (trussCoefficient || 0) * L.trussWindAreaPerUpright * L.trussWindHeight;
    if (perPressure <= EPS) return Infinity;

    return Math.sqrt((2 * (allowed / perPressure)) / (density || AIR_DENSITY));
  }

  /** Ballast per baseplate needed to hold the given case. */
  function ballastForCase(L, n, wind, dir, safety) {
    var pivotX = dir > 0 ? L.frontPivotX : -L.plateBack;
    var arm = dir > 0 ? pivotX - L.ballastX : L.ballastX - pivotX;
    if (arm <= EPS) return Infinity; // ballast there would not help

    /* Take the moments as they stand and subtract whatever the ballast
     * currently contributes, rather than rebuilding a bare layout — one less
     * field list to keep in step. */
    var m = moments(L, n, wind, dir);
    var bareRestoring = m.restoring - n * L.ballastMass * L.g * arm;

    var shortfall = safety * m.overturning - bareRestoring;
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

    var trussCoefficient = positive(input.trussForceCoefficient, 1.8);

    var pressure = windPressure(windSpeed, density);
    var windForce = pressure * coefficient * L.area;
    var trussWindPerUpright = pressure * trussCoefficient * L.trussWindAreaPerUpright;
    var loads = { wallForce: windForce, trussForcePerUpright: trussWindPerUpright };

    /* --------------------------- how many uprights ------------------- */

    /* Uprights at both ends, so n uprights make n-1 bays. */
    var bySpacing = L.wallWidth > EPS ? Math.ceil(L.wallWidth / maxSpacing) + 1 : 2;

    /* An interior upright carries one bay's width of wall. */
    var byLoad = L.wallMass > EPS && maxLoadPerUpright > EPS
      ? Math.ceil(L.wallMass / maxLoadPerUpright) + 1
      : 2;

    var forwardNeed = uprightsForStability(L, loads, 1, safety);
    var backwardNeed = uprightsForStability(L, loads, -1, safety);
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
        moments: moments(L, uprights, loads, 1),
        ballast: ballastForCase(L, uprights, loads, 1, safety),
        limitingWind: limitingWindSpeed(L, uprights, 1, safety, coefficient, density, trussCoefficient),
        tippingWind: limitingWindSpeed(L, uprights, 1, 1, coefficient, density, trussCoefficient),
        uprightsNeeded: forwardNeed
      },
      {
        id: 'backward',
        label: 'Wind on the face, tipping backward',
        note: 'over the rear edge — the wall hangs forward of it, so its weight helps hold things down',
        moments: moments(L, uprights, loads, -1),
        ballast: ballastForCase(L, uprights, loads, -1, safety),
        limitingWind: limitingWindSpeed(L, uprights, -1, safety, coefficient, density, trussCoefficient),
        tippingWind: limitingWindSpeed(L, uprights, -1, 1, coefficient, density, trussCoefficient),
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

    /* Wind on the cantilevered strip has to be carried back down through the
     * connection at the top of the upright, as bending. This is not part of
     * overturning — it is the thing that decides whether the arrangement is
     * buildable at all — so it is reported rather than added in. */
    var cantileverArea = L.wallCantilever * tributary;
    var cantileverWind = pressure * coefficient * cantileverArea;
    var cantileverMoment = cantileverWind * (L.wallCantilever / 2);
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
      if (L.wallOverlap <= EPS) {
        errors.push(
          'The uprights stop at ' + L.trussHeight.toFixed(2) + ' m but the wall does not ' +
            'start until ' + L.wallBottom.toFixed(2) + ' m — there is nothing for it to be ' +
            'bolted to.'
        );
      }
      if (!isFinite(byStability)) {
        /* Adding uprights makes it worse, but say *why*: either each one is
         * bringing its own sail, or the ballast on it sits the wrong side of
         * the pivot. They call for different fixes. */
        var failDir = isFinite(forwardNeed) ? -1 : 1;
        var split = momentSplit(L, failDir);
        var perTrussWind = trussWindPerUpright * L.trussWindHeight;
        var cause = perTrussWind > split.perUpright.overturning
          ? 'each one brings ' + Math.round(perTrussWind) + ' N·m of wind load on its own ' +
            'exposed truss, against the ' + Math.round(split.perUpright.restoring) +
            ' N·m it holds down'
          : 'with the baseplate reaching only ' + (L.plateFront * 1000).toFixed(0) +
            ' mm in front of the truss, each one adds more overturning than it resists';

        warnings.push(
          'Adding uprights will not fix this: ' + cause + '. What will: cutting the ' +
            'uprights down closer to the wall, reaching further forward with the ' +
            'baseplates, or more ballast on each of them.'
        );
      }
      if (cases[2].moments.ratio < safety) {
        warnings.push(
          'It does not even make the safety factor standing still in still air — the wall ' +
            'hanging off the front face is enough on its own. Reach further forward with the ' +
            'baseplate or add ballast before thinking about wind.'
        );
      }
      if (L.wallX > L.frontPivotX + 1e-9) {
        warnings.push(
          'The wall\'s weight sits ' + ((L.wallX - L.frontPivotX) * 1000).toFixed(0) +
            ' mm outside the edge it tips about, so it is pulling the structure over ' +
            'before any wind arrives.'
        );
      }
      if (L.wallBottomRaised) {
        warnings.push(
          'The bottom of the wall has been raised to ' +
            (L.wallBottom * 1000).toFixed(0) + ' mm: the baseplate runs out under the ' +
            'wall, so it cannot sit any lower than the top of the plate.'
        );
      }
      if (L.wallOnGround && !L.bearsOnGround && !L.bearsOnPlate && L.wallBottom > EPS) {
        warnings.push(
          'The wall is set to bear on the ground but starts ' +
            (L.wallBottom * 1000).toFixed(0) + ' mm above it, so it is not bearing on ' +
            'anything and the truss is carrying all of it.'
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
      if (L.wallCantilever > EPS) {
        warnings.push(
          'The wall stands ' + (L.wallCantilever * 1000).toFixed(0) + ' mm above the top of ' +
            'the uprights — ' + fmtPercent(L.cantileverFraction) + ' of its height, carried by ' +
            'its own frame as a cantilever. That is ' + Math.round(cantileverMoment) +
            ' N·m of bending into each upright at the top, on top of anything the wall ' +
            'frame itself has to carry. Nothing here checks either of them.'
        );
      }
      if (L.wallOverlap > EPS && L.wallOverlap < L.wallHeight * 0.3) {
        warnings.push(
          'Only ' + (L.wallOverlap * 1000).toFixed(0) + ' mm of the wall is actually backed ' +
            'by truss. Everything above that is hanging off the connection.'
        );
      }
      if (
        governingCase.moments.trussWindMoment >
        governingCase.moments.wallWindMoment * 0.5 + EPS
      ) {
        warnings.push(
          'Most of the wind load is on the bare truss, not the wall: ' +
            fmtPercent(governingCase.moments.trussWindMoment / governingCase.moments.windMoment) +
            ' of it. Uprights that stand well above the wall cost you more than they ' +
            'contribute — cut them down to the wall, or expect a lot of ballast.'
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
      trussForceCoefficient: trussCoefficient,
      cantileverArea: cantileverArea,
      cantileverWind: cantileverWind,
      cantileverMoment: cantileverMoment,
      trussWindPerUpright: trussWindPerUpright,
      trussWindForce: uprights * trussWindPerUpright,
      /* What share of the overturning the exposed truss is responsible for —
       * small for a wall that fills its uprights, large for a tall upright
       * behind a short wall. */
      trussWindShare: (function () {
        var total = governingCase.moments.windMoment;
        return total > EPS ? governingCase.moments.trussWindMoment / total : 0;
      })(),
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
      /* Whether any number of uprights can hold it — distinct from needing a
       * lot of them. False when each upright brings more wind than it resists. */
      stabilityAchievable: isFinite(byStability),
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
    asLoads: asLoads,
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
