/*
 * tipping-point — UI
 *
 * Reads the form, converts everything to SI, hands it to TippingPhysics,
 * and renders the answer, the stats, the working and the two diagrams.
 * State round-trips through localStorage and through the URL hash so a
 * particular setup can be shared or bookmarked.
 */
(function () {
  'use strict';

  var P = window.TippingPhysics;
  var STORE_KEY = 'tipping-point:v1';

  function $(id) {
    return document.getElementById(id);
  }

  /* ------------------------------------------------------------------ *
   * Fields
   * ------------------------------------------------------------------ */

  // `key` is the short name used in the shareable URL.
  var FIELDS = [
    { id: 'plateMass', kind: 'mass', key: 'pm', metric: [20, 'kg'], imperial: [45, 'lb'] },
    { id: 'plateLength', kind: 'length', key: 'pl', metric: [600, 'mm'], imperial: [24, 'in'] },
    { id: 'plateWidth', kind: 'length', key: 'pw', metric: [600, 'mm'], imperial: [24, 'in'] },
    { id: 'plateThickness', kind: 'length', key: 'pt', metric: [12, 'mm'], imperial: [0.5, 'in'] },
    { id: 'poleMass', kind: 'mass', key: 'qm', metric: [8, 'kg'], imperial: [18, 'lb'] },
    { id: 'poleLength', kind: 'length', key: 'ql', metric: [2, 'm'], imperial: [6.5, 'ft'] },
    { id: 'topMass', kind: 'mass', key: 'tm', metric: [0, 'kg'], imperial: [0, 'lb'] },
    { id: 'pushHeight', kind: 'length', key: 'ph', metric: [2, 'm'], imperial: [6.5, 'ft'] }
  ];

  var SCALARS = [
    { id: 'pushAngleDeg', key: 'ang', def: 0 },
    { id: 'friction', key: 'mu', def: 0.6 },
    { id: 'gravity', key: 'g', def: P.G_STANDARD }
  ];

  var FORCE_UNIT_DEFAULT = { metric: 'N', imperial: 'lbf' };

  var currentSystem = 'metric';

  /* ------------------------------------------------------------------ *
   * Number formatting
   * ------------------------------------------------------------------ */

  /** Trim float noise so converted values look like numbers a person typed. */
  function tidy(n) {
    if (!isFinite(n)) return '';
    var r = Number(n.toPrecision(10));
    return String(Math.round(r * 1e6) / 1e6);
  }

  /** Format for display: decimals chosen by magnitude. */
  function fmt(n, maxDp) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    var dp =
      maxDp != null ? maxDp
        : a >= 1000 ? 0
        : a >= 100 ? 1
        : a >= 1 ? 2
        : a >= 0.1 ? 3
        : 4;
    return n.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 });
  }

  /**
   * Which unit a length of this size reads most naturally in. The thresholds
   * are set so ordinary baseplates stay in millimetres or inches — a 600 mm
   * plate shouldn't come back as "0.6 m" — while poles read in metres or feet.
   */
  function pickLengthUnit(metres) {
    if (!isFinite(metres)) return currentSystem === 'imperial' ? 'ft' : 'm';
    if (currentSystem === 'imperial') {
      return Math.abs(P.fromBase(metres, 'ft', P.LENGTH_UNITS)) < 3 ? 'in' : 'ft';
    }
    return Math.abs(metres) < 1 ? 'mm' : 'm';
  }

  function fmtLengthIn(metres, unit) {
    if (!isFinite(metres)) return '—';
    var dp = unit === 'mm' ? 1 : unit === 'm' ? 3 : 2;
    return fmt(P.fromBase(metres, unit, P.LENGTH_UNITS), dp) + ' ' + unit;
  }

  /** A length in SI metres, shown in whichever unit reads most naturally. */
  function fmtLength(metres) {
    return fmtLengthIn(metres, pickLengthUnit(metres));
  }

  function fmtMass(kg) {
    if (!isFinite(kg)) return '—';
    if (currentSystem === 'imperial') return fmt(P.fromBase(kg, 'lb', P.MASS_UNITS), 1) + ' lb';
    return fmt(kg, 2) + ' kg';
  }

  function fmtForce(newtons, unit) {
    if (!isFinite(newtons)) return '—';
    return fmt(P.fromBase(newtons, unit, P.FORCE_UNITS)) + ' ' + unit;
  }

  function fmtMoment(nm) {
    if (!isFinite(nm)) return '—';
    if (currentSystem === 'imperial') {
      return fmt(P.fromBase(nm, 'lbf·ft', P.MOMENT_UNITS)) + ' lbf·ft';
    }
    return fmt(nm) + ' N·m';
  }

  function fmtEnergy(joules) {
    if (!isFinite(joules)) return '—';
    if (currentSystem === 'imperial') {
      return fmt(P.fromBase(joules, 'ft·lbf', P.ENERGY_UNITS)) + ' ft·lbf';
    }
    return fmt(joules) + ' J';
  }

  /** A rough human yardstick for a force, so the number means something. */
  function feelsLike(newtons) {
    if (!isFinite(newtons)) return '';
    if (newtons < 5) return 'a fingertip would do it';
    if (newtons < 25) return 'a light nudge';
    if (newtons < 80) return 'an easy one-handed push';
    if (newtons < 200) return 'a firm shove';
    if (newtons < 500) return 'a hard two-handed shove, or a solid kick';
    if (newtons < 1200) return 'about as hard as a person can push at all';
    return 'more than a person can push — vehicle or winch territory';
  }

  /* ------------------------------------------------------------------ *
   * Form plumbing
   * ------------------------------------------------------------------ */

  function unitSelect(field) {
    return $(field.id + '-unit');
  }

  function populateUnitSelects() {
    var selects = document.querySelectorAll('select[data-units]');
    Array.prototype.forEach.call(selects, function (sel) {
      var table = P.UNITS[sel.getAttribute('data-units')];
      sel.innerHTML = Object.keys(table)
        .map(function (u) {
          return '<option value="' + u + '">' + table[u].label + '</option>';
        })
        .join('');
    });
  }

  function checkedValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function setChecked(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  /**
   * Field value converted to SI.
   *
   * Whenever we render a value ourselves we stash the exact SI figure on the
   * element. Re-deriving it from the rounded text instead would let precision
   * bleed away every time the units change: 600 mm shown as 23.622047 in and
   * converted back lands on 599.999994 mm. The stash is only trusted while the
   * visible text is still exactly what we put there, so anything typed by hand
   * takes over immediately.
   */
  function fieldBase(field, unitOverride) {
    var input = $(field.id);
    if (input.getAttribute('data-shown') === input.value && input.hasAttribute('data-base')) {
      var stashed = Number(input.getAttribute('data-base'));
      if (isFinite(stashed)) return stashed;
    }
    var raw = parseFloat(input.value);
    if (!isFinite(raw)) raw = 0;
    return P.toBase(raw, unitOverride || unitSelect(field).value, P.UNITS[field.kind]);
  }

  function setFieldBase(field, baseValue) {
    var input = $(field.id);
    input.value = tidy(P.fromBase(baseValue, unitSelect(field).value, P.UNITS[field.kind]));
    input.setAttribute('data-base', String(baseValue));
    input.setAttribute('data-shown', input.value);
  }

  function applyDefaults(system) {
    currentSystem = system;
    setChecked('unit-system', system);
    FIELDS.forEach(function (field) {
      var spec = field[system];
      $(field.id).value = String(spec[0]);
      var sel = unitSelect(field);
      sel.value = spec[1];
      sel.setAttribute('data-prev', spec[1]);
    });
    SCALARS.forEach(function (s) {
      $(s.id).value = String(s.def);
    });
    setChecked('pushDirection', 'width');
    $('pushAtTop').checked = true;
    $('checkSliding').checked = true;
    $('force-unit').value = FORCE_UNIT_DEFAULT[system];
  }

  /** Switch unit system, converting the values already entered. */
  function switchSystem(system) {
    if (system === currentSystem) return;
    FIELDS.forEach(function (field) {
      var base = fieldBase(field);
      var sel = unitSelect(field);
      sel.value = field[system][1];
      sel.setAttribute('data-prev', sel.value);
      setFieldBase(field, base);
    });
    $('force-unit').value = FORCE_UNIT_DEFAULT[system];
    currentSystem = system;
  }

  /** Changing a unit dropdown converts the number rather than reinterpreting it. */
  function onUnitChanged(field, sel) {
    var prev = sel.getAttribute('data-prev') || sel.value;
    if (prev !== sel.value && $(field.id).value !== '') {
      // the select already holds the new unit, so read against the old one
      setFieldBase(field, fieldBase(field, prev));
    }
    sel.setAttribute('data-prev', sel.value);
  }

  function readState() {
    var state = {};
    FIELDS.forEach(function (field) {
      state[field.id] = fieldBase(field);
    });

    state.pushDirection = checkedValue('pushDirection') || 'width';
    state.pushAngleDeg = parseFloat($('pushAngleDeg').value) || 0;

    var g = parseFloat($('gravity').value);
    state.gravity = isFinite(g) && g > 0 ? g : P.G_STANDARD;

    state.friction = $('checkSliding').checked ? Math.max(0, parseFloat($('friction').value) || 0) : null;

    if ($('pushAtTop').checked) state.pushHeight = null;

    return state;
  }

  /* ------------------------------------------------------------------ *
   * Persistence: localStorage and the URL hash
   * ------------------------------------------------------------------ */

  function serialize() {
    var p = new URLSearchParams();
    p.set('sys', currentSystem);
    FIELDS.forEach(function (field) {
      p.set(field.key, $(field.id).value + unitSelect(field).value);
    });
    SCALARS.forEach(function (s) {
      p.set(s.key, $(s.id).value);
    });
    p.set('dir', checkedValue('pushDirection') || 'width');
    p.set('top', $('pushAtTop').checked ? '1' : '0');
    p.set('slide', $('checkSliding').checked ? '1' : '0');
    p.set('fu', $('force-unit').value);
    return p.toString();
  }

  var VALUE_UNIT = /^(-?[\d.]+)\s*([a-zA-Z·]*)$/;

  function deserialize(query) {
    var p = new URLSearchParams(query);
    if (!p.has('pl') && !p.has('sys')) return false;

    var sys = p.get('sys');
    if (sys === 'metric' || sys === 'imperial') currentSystem = sys;
    setChecked('unit-system', currentSystem);

    FIELDS.forEach(function (field) {
      var raw = p.get(field.key);
      if (!raw) return;
      var m = VALUE_UNIT.exec(raw.trim());
      if (!m) return;
      var table = P.UNITS[field.kind];
      var unit = table[m[2]] ? m[2] : field[currentSystem][1];
      $(field.id).value = m[1];
      var sel = unitSelect(field);
      sel.value = unit;
      sel.setAttribute('data-prev', unit);
    });

    SCALARS.forEach(function (s) {
      var raw = p.get(s.key);
      if (raw != null && isFinite(parseFloat(raw))) $(s.id).value = String(parseFloat(raw));
    });

    if (p.has('dir')) setChecked('pushDirection', p.get('dir'));
    if (p.has('top')) $('pushAtTop').checked = p.get('top') === '1';
    if (p.has('slide')) $('checkSliding').checked = p.get('slide') === '1';
    if (p.has('fu') && P.FORCE_UNITS[p.get('fu')]) $('force-unit').value = p.get('fu');
    return true;
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, serialize());
    } catch (err) {
      /* private browsing, quota, whatever — not worth bothering the user */
    }
  }

  function restore() {
    var fromHash = location.hash.replace(/^#/, '');
    if (fromHash && deserialize(fromHash)) return;
    try {
      var stored = localStorage.getItem(STORE_KEY);
      if (stored) deserialize(stored);
    } catch (err) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ *
   * SVG helpers
   * ------------------------------------------------------------------ */

  function tag(name, attrs, inner) {
    var s = '<' + name;
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] != null) s += ' ' + k + '="' + attrs[k] + '"';
    });
    if (inner == null) return s + '/>';
    return s + '>' + inner + '</' + name + '>';
  }

  function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function r1(n) {
    return Math.round(n * 10) / 10;
  }

  function line(x1, y1, x2, y2, cls) {
    return tag('line', { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), class: cls });
  }

  function text(x, y, str, cls, anchor, transform) {
    return tag(
      'text',
      {
        x: r1(x),
        y: r1(y),
        class: cls,
        'text-anchor': anchor || 'start',
        transform: transform
      },
      esc(str)
    );
  }

  /** Filled arrowhead at (x, y) pointing along (dx, dy). */
  function head(x, y, dx, dy, size, cls) {
    var m = Math.hypot(dx, dy) || 1;
    var ux = dx / m;
    var uy = dy / m;
    var px = -uy;
    var py = ux;
    var bx = x - ux * size;
    var by = y - uy * size;
    var w = size * 0.42;
    var pts = [
      r1(x) + ',' + r1(y),
      r1(bx + px * w) + ',' + r1(by + py * w),
      r1(bx - px * w) + ',' + r1(by - py * w)
    ].join(' ');
    return tag('polygon', { points: pts, class: cls });
  }

  /** Double-headed dimension line with ticks at each end. */
  function dimension(x1, y1, x2, y2, label, labelPos) {
    var out = [line(x1, y1, x2, y2, 'dg-dim')];
    var dx = x2 - x1;
    var dy = y2 - y1;
    var m = Math.hypot(dx, dy) || 1;
    var px = (-dy / m) * 4;
    var py = (dx / m) * 4;
    out.push(line(x1 + px, y1 + py, x1 - px, y1 - py, 'dg-dim'));
    out.push(line(x2 + px, y2 + py, x2 - px, y2 - py, 'dg-dim'));
    if (m > 26) {
      out.push(head(x2, y2, dx, dy, 6, 'dg-dim-fill'));
      out.push(head(x1, y1, -dx, -dy, 6, 'dg-dim-fill'));
    }
    if (label) out.push(labelPos(out));
    return out.join('');
  }

  /* ------------------------------------------------------------------ *
   * Side elevation
   * ------------------------------------------------------------------ */

  function buildSideView(result) {
    var VW = 360;
    var VH_MAX = 400;
    var VH_MIN = 200;
    var padL = 54;
    var padR = 46;
    var padB = 54;
    var availW = VW - padL - padR;

    var theta = (result.pushAngleDeg * Math.PI) / 180;
    var arrowLen = 56;

    /* A downward push has its tail above the point it acts on, so the top
     * padding has to grow with the angle or the arrow and its label get
     * clipped off the top of the drawing. */
    var padT = 30 + Math.max(0, arrowLen * Math.sin(theta));

    var halfW = result.chosen.leverArm;
    if (!isFinite(halfW) || halfW <= 0) {
      halfW = Math.max(result.plate.length, result.plate.width) / 2;
    }
    halfW = Math.max(halfW, 1e-4);

    var worldH = Math.max(result.poleTop, result.pushHeight, 1e-4);
    var scale = Math.min(availW / (2 * halfW), (VH_MAX - padT - padB) / worldH);

    /* Shrink the canvas to whatever the object actually needs. A wide, squat
     * assembly is limited by the width, and would otherwise sit at the bottom
     * of a tall box with a lot of nothing above it. */
    var VH = Math.min(VH_MAX, Math.max(VH_MIN, padT + worldH * scale + padB));

    var groundY = VH - padB;
    var cx = padL + availW / 2;
    var X = function (x) {
      return cx + x * scale;
    };
    var Y = function (y) {
      return groundY - y * scale;
    };

    var parts = [];

    /* ground */
    parts.push(line(padL - 20, groundY, VW - 8, groundY, 'dg-ground'));
    for (var hx = padL - 14; hx < VW - 10; hx += 15) {
      parts.push(line(hx, groundY, hx - 8, groundY + 8, 'dg-hatch'));
    }

    /* baseplate — never thinner than a few pixels or it vanishes */
    var plateThickPx = Math.max(result.plate.thickness * scale, 3.5);
    var plateTopY = groundY - plateThickPx;
    parts.push(
      tag('rect', {
        x: r1(X(-halfW)),
        y: r1(plateTopY),
        width: r1(2 * halfW * scale),
        height: r1(plateThickPx),
        class: 'dg-plate'
      })
    );

    /* pole */
    var poleTopY = Y(result.poleTop);
    var poleW = 9;
    if (result.pole.length > 0 && plateTopY - poleTopY > 0.5) {
      parts.push(
        tag('rect', {
          x: r1(cx - poleW / 2),
          y: r1(poleTopY),
          width: poleW,
          height: r1(plateTopY - poleTopY),
          class: 'dg-pole'
        })
      );
    }

    /* anything bolted to the top */
    if (result.topMass > 0) {
      parts.push(tag('circle', { cx: r1(cx), cy: r1(poleTopY), r: 8, class: 'dg-top-mass' }));
    }

    /* centre of mass, with the weight acting down through it */
    var cgY = Y(result.cgHeight);
    var cgR = 7.5;
    parts.push(tag('circle', { cx: r1(cx), cy: r1(cgY), r: cgR, class: 'dg-cg-ring' }));
    parts.push(
      tag('path', {
        d: 'M' + r1(cx) + ',' + r1(cgY) + ' L' + r1(cx + cgR) + ',' + r1(cgY) +
           ' A' + cgR + ',' + cgR + ' 0 0 0 ' + r1(cx) + ',' + r1(cgY - cgR) + ' Z',
        class: 'dg-cg-quad'
      })
    );
    parts.push(
      tag('path', {
        d: 'M' + r1(cx) + ',' + r1(cgY) + ' L' + r1(cx - cgR) + ',' + r1(cgY) +
           ' A' + cgR + ',' + cgR + ' 0 0 0 ' + r1(cx) + ',' + r1(cgY + cgR) + ' Z',
        class: 'dg-cg-quad'
      })
    );

    var wx = cx - 21;
    var wTop = cgY + 2;
    // stop short of the plate rather than drawing through it — with a low
    // centre of mass there may be no room at all, and then it's left out
    var wBottom = Math.min(cgY + 40, plateTopY - 4);
    if (wBottom - wTop > 16) {
      parts.push(line(wx, wTop, wx, wBottom, 'dg-weight'));
      parts.push(head(wx, wBottom, 0, 1, 8, 'dg-weight-fill'));
      parts.push(text(wx - 5, (wTop + wBottom) / 2 + 3, 'W', 'dg-label dg-label--muted', 'end'));
    }
    parts.push(text(cx + cgR + 5, cgY - cgR - 2, 'centre of mass', 'dg-label dg-label--muted'));

    /* the applied force */
    var tipX = cx;
    var tipY = Y(result.pushHeight);
    var len = Math.min(arrowLen, Math.max(24, cx - 10));
    var tailX = tipX - len * Math.cos(theta);
    var tailY = tipY - len * Math.sin(theta);
    parts.push(line(tailX, tailY, tipX, tipY, 'dg-force'));
    parts.push(head(tipX, tipY, Math.cos(theta), Math.sin(theta), 10, 'dg-force-fill'));
    parts.push(text(tailX - 4, tailY - 5, 'F', 'dg-label dg-label--force', 'end'));

    /* pivot edge */
    var pivotX = X(halfW);
    parts.push(
      tag('polygon', {
        points:
          r1(pivotX) + ',' + r1(groundY) + ' ' +
          r1(pivotX - 6) + ',' + r1(groundY + 9) + ' ' +
          r1(pivotX + 6) + ',' + r1(groundY + 9),
        class: 'dg-pivot'
      })
    );
    // above the ground line, clear of the hatching and the dimension below
    parts.push(text(pivotX + 9, groundY - 7, 'pivot', 'dg-label dg-label--force'));

    /* lever arm, centre to pivot */
    var dimY = groundY + 30;
    parts.push(line(cx, plateTopY, cx, dimY + 5, 'dg-guide'));
    parts.push(line(pivotX, groundY, pivotX, dimY + 5, 'dg-guide'));
    parts.push(
      dimension(cx, dimY, pivotX, dimY, true, function () {
        return text(
          (cx + pivotX) / 2,
          dimY - 8, // clear of the end ticks, which reach 4px either side

          'd = ' + fmtLength(halfW),
          'dg-label dg-label--dim',
          'middle'
        );
      })
    );

    /* push height */
    var hx2 = 26;
    parts.push(line(hx2, tipY, tipX - 4, tipY, 'dg-guide'));
    parts.push(
      dimension(hx2, groundY, hx2, tipY, true, function () {
        var midY = (groundY + tipY) / 2;
        return text(
          0,
          0,
          'h = ' + fmtLength(result.pushHeight),
          'dg-label dg-label--dim',
          'middle',
          'translate(' + r1(hx2 - 6) + ',' + r1(midY) + ') rotate(-90)'
        );
      })
    );

    var title =
      'Side view: a ' + fmtLength(result.plate.thickness) + ' baseplate with a ' +
      fmtLength(result.pole.length) + ' pole, force F applied ' +
      fmtLength(result.pushHeight) + ' above the ground, pivoting about the near edge.';

    return tag(
      'svg',
      {
        viewBox: '0 0 ' + VW + ' ' + VH,
        role: 'img',
        'aria-label': title,
        xmlns: 'http://www.w3.org/2000/svg'
      },
      parts.join('')
    );
  }

  /* ------------------------------------------------------------------ *
   * Plan view
   * ------------------------------------------------------------------ */

  function buildPlanView(result) {
    var S = 150;
    var pad = 30;
    var a = result.plate.length || 1;
    var b = result.plate.width || 1;
    var scale = Math.min((S - 2 * pad) / a, (S - 2 * pad) / b);
    var w = a * scale;
    var h = b * scale;
    var x0 = (S - w) / 2;
    var y0 = (S - h) / 2;
    var cx = S / 2;
    var cy = S / 2;
    var dir = result.chosen.id;

    var parts = [];

    parts.push(
      tag('rect', { x: r1(x0), y: r1(y0), width: r1(w), height: r1(h), class: 'dg-plan-face' })
    );

    /* highlight the edge (or edges) it would pivot about */
    if (dir === 'length' || dir === 'corner') {
      parts.push(line(x0 + w, y0, x0 + w, y0 + h, 'dg-plan-edge'));
    }
    if (dir === 'width' || dir === 'corner') {
      parts.push(line(x0, y0 + h, x0 + w, y0 + h, 'dg-plan-edge'));
    }

    /* push direction, from the centre outwards */
    var tx;
    var ty;
    if (dir === 'length') {
      tx = x0 + w + 12;
      ty = cy;
    } else if (dir === 'width') {
      tx = cx;
      ty = y0 + h + 12;
    } else {
      tx = x0 + w + 9;
      ty = y0 + h + 9;
      parts.push(line(cx, cy, x0 + w, y0 + h, 'dg-guide'));
    }
    parts.push(line(cx, cy, tx, ty, 'dg-force'));
    parts.push(head(tx, ty, tx - cx, ty - cy, 9, 'dg-force-fill'));

    parts.push(tag('circle', { cx: cx, cy: cy, r: 2.5, class: 'dg-cg-quad' }));

    parts.push(text(cx, y0 - 9, fmtLength(a), 'dg-label dg-label--muted', 'middle'));
    parts.push(
      text(0, 0, fmtLength(b), 'dg-label dg-label--muted', 'middle',
        'translate(' + r1(x0 - 9) + ',' + r1(cy) + ') rotate(-90)')
    );

    return tag(
      'svg',
      {
        viewBox: '0 0 ' + S + ' ' + S,
        role: 'img',
        'aria-label':
          'Plan view of the baseplate, ' + fmtLength(a) + ' by ' + fmtLength(b) +
          ', with the push aimed ' + result.chosen.label.toLowerCase() +
          ' and the pivot edge marked.',
        xmlns: 'http://www.w3.org/2000/svg'
      },
      parts.join('')
    );
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  function describeAngle(deg) {
    if (Math.abs(deg) < 0.05) return 'level';
    if (deg > 0) return fmt(deg, 1) + '° downwards';
    return fmt(-deg, 1) + '° upwards';
  }

  function renderAnswer(result, forceUnit) {
    var chosen = result.chosen;

    if (!result.ok) {
      $('out-force').textContent = '—';
      $('out-force-note').textContent = '';
      $('out-force-equiv').textContent = '';
      $('out-badge').innerHTML = '';
      $('out-notes').innerHTML = result.errors
        .map(function (e) {
          return '<li class="is-error">' + esc(e) + '</li>';
        })
        .join('');
      return;
    }

    $('out-force').textContent = isFinite(chosen.tipForce)
      ? fmt(P.fromBase(chosen.tipForce, forceUnit, P.FORCE_UNITS))
      : '—';

    $('out-force-note').textContent = isFinite(chosen.tipForce)
      ? 'Pushed ' + describeAngle(result.pushAngleDeg) + ' at ' +
        fmtLength(result.pushHeight) + ' above the ground, ' + chosen.hint + '.'
      : 'This push cannot tip it over at all.';

    if (isFinite(chosen.tipForce)) {
      $('out-force-equiv').innerHTML =
        'The weight of <strong>' + esc(fmtMass(chosen.tipForce / P.G_STANDARD)) +
        '</strong> hanging on a rope — ' + esc(feelsLike(chosen.tipForce)) + '.';
    } else {
      $('out-force-equiv').textContent = '';
    }

    var badge = '';
    if (isFinite(chosen.tipForce)) {
      badge = result.mode === 'slide'
        ? '<span class="badge badge--slide">Slides first, at ' +
          esc(fmtForce(result.slideForce, forceUnit)) + '</span>'
        : '<span class="badge badge--tip">Tips over — it won\'t slide first</span>';
    }
    $('out-badge').innerHTML = badge;

    $('out-notes').innerHTML = result.warnings
      .map(function (w) {
        return '<li>' + esc(w) + '</li>';
      })
      .join('');
  }

  function stat(label, value, sub) {
    return (
      '<div class="stat"><dt>' + esc(label) + '</dt><dd>' + esc(value) +
      (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</dd></div>'
    );
  }

  function renderStats(result, forceUnit) {
    var chosen = result.chosen;
    var out = [];

    /* In gravitational force units (lbf, kgf) the weight and the mass read as
     * the same number, so the mass sub-label is just noise. */
    var weightShown = P.fromBase(result.weight, forceUnit, P.FORCE_UNITS);
    var massShown = currentSystem === 'imperial'
      ? P.fromBase(result.totalMass, 'lb', P.MASS_UNITS)
      : result.totalMass;
    var massIsRedundant =
      weightShown > 0 && Math.abs(weightShown - massShown) / weightShown < 0.02;

    out.push(
      stat(
        'Total weight',
        fmtForce(result.weight, forceUnit),
        massIsRedundant ? null : fmtMass(result.totalMass)
      )
    );
    out.push(stat('Centre of mass', fmtLength(result.cgHeight), 'above the ground'));
    out.push(stat('Lever arm', fmtLength(chosen.leverArm), 'centre to pivot'));
    out.push(stat('Righting moment', fmtMoment(chosen.restoringMoment), 'weight × lever arm'));
    out.push(stat('Goes over past', fmt(chosen.tiltAngleDeg, 1) + '°', 'of tilt'));
    out.push(stat('Energy to tip', fmtEnergy(chosen.energyToTip), 'lifting the centre of mass'));

    if (isFinite(chosen.bestForce)) {
      out.push(
        stat(
          'Easiest angle',
          fmt(chosen.bestAngleDeg, 1) + '°',
          fmtForce(chosen.bestForce, forceUnit) + ' at that angle'
        )
      );
    }
    if (result.friction != null) {
      out.push(stat('Slides at', fmtForce(result.slideForce, forceUnit), 'µ = ' + fmt(result.friction, 2)));
    }
    out.push(stat('Ground reaction', fmtForce(chosen.normalAtTip, forceUnit), 'as it lifts'));

    $('out-stats').innerHTML = out.join('');
  }

  function renderCompare(result, forceUnit) {
    // one unit for the whole column, chosen from the biggest arm, so the
    // numbers can be compared at a glance
    var arms = result.directions.map(function (d) {
      return isFinite(d.leverArm) ? d.leverArm : 0;
    });
    var armUnit = pickLengthUnit(Math.max.apply(null, arms));

    // ties are real: on a square plate two directions are equally easy
    var minForce = Math.min.apply(
      null,
      result.directions.map(function (d) {
        return d.tipForce;
      })
    );

    var rows = result.directions
      .map(function (d) {
        var isCurrent = d.id === result.chosen.id;
        var isEasiest = isFinite(d.tipForce) && d.tipForce <= minForce * (1 + 1e-9);
        return (
          '<tr class="' + (isCurrent ? 'is-current' : '') + '">' +
          '<td>' + esc(d.label) +
          (isEasiest ? ' <span class="tag">easiest</span>' : '') + '</td>' +
          '<td>' + esc(fmtLengthIn(d.leverArm, armUnit)) + '</td>' +
          '<td>' + esc(fmtForce(d.tipForce, forceUnit)) + '</td>' +
          '</tr>'
        );
      })
      .join('');
    $('out-compare').innerHTML = rows;

    // mirror the lever arms onto the direction picker
    result.directions.forEach(function (d) {
      var el = $('seg-arm-' + d.id);
      if (el) el.textContent = 'lever arm ' + fmtLengthIn(d.leverArm, armUnit);
    });
  }

  function renderWorking(result) {
    var c = result.chosen;
    if (!result.ok) {
      $('out-working').textContent = 'Fill in the weights and sizes to see the working.';
      return;
    }

    var theta = (result.pushAngleDeg * Math.PI) / 180;
    var cosT = Math.cos(theta);
    var sinT = Math.sin(theta);
    var level = Math.abs(result.pushAngleDeg) < 0.05;
    var squareOn = Math.abs(c.c - 1) < 1e-9;

    var formula = level && squareOn
      ? 'F = W · d / h'
      : level
        ? 'F = W · d / (h · c)'
        : 'F = W · d / (h · c · cosθ − d · sinθ)';

    var lines = [];
    lines.push('Moments about the pivot edge, worked in SI units.');
    lines.push('');
    lines.push('  ' + formula);
    lines.push('');
    lines.push('  W  weight       = ' + fmt(result.totalMass, 3) + ' kg × ' +
      fmt(result.gravity, 3) + ' m/s²  = ' + fmt(result.weight) + ' N');
    lines.push('  d  lever arm    = ' + fmt(c.d, 4) + ' m');
    lines.push('  h  push height  = ' + fmt(result.pushHeight, 4) + ' m');
    if (!squareOn) {
      lines.push('  c  direction    = ' + fmt(c.c, 4) + '   (only this much of the push turns it)');
    }
    if (!level) {
      lines.push('  θ  push angle   = ' + fmt(result.pushAngleDeg, 2) + '°');
    }
    lines.push('');

    var denom = result.pushHeight * c.c * cosT - c.d * sinT;
    var numerator = result.weight * c.d;

    if (level && squareOn) {
      lines.push('  F = ' + fmt(result.weight) + ' × ' + fmt(c.d, 4) + ' / ' +
        fmt(result.pushHeight, 4));
    } else if (level) {
      lines.push('  F = ' + fmt(result.weight) + ' × ' + fmt(c.d, 4) + ' / (' +
        fmt(result.pushHeight, 4) + ' × ' + fmt(c.c, 4) + ')');
    } else {
      lines.push('  F = ' + fmt(result.weight) + ' × ' + fmt(c.d, 4) + ' / (' +
        fmt(result.pushHeight, 4) + ' × ' + fmt(c.c, 4) + ' × ' + fmt(cosT, 4) +
        (sinT < 0 ? ' + ' : ' − ') + fmt(c.d, 4) + ' × ' + fmt(Math.abs(sinT), 4) + ')');
    }
    lines.push('    = ' + fmt(numerator) + ' / ' + fmt(denom, 4));
    lines.push('    = ' + (isFinite(c.tipForce) ? fmt(c.tipForce) + ' N' : 'no solution — it cannot be tipped'));

    if (result.friction != null) {
      lines.push('');
      lines.push('Sliding, for comparison:');
      lines.push('  F = µW / (cosθ − µ·sinθ) = ' +
        (isFinite(result.slideForce) ? fmt(result.slideForce) + ' N' : 'never slides'));
    }

    $('out-working').textContent = lines.join('\n');
  }

  function summaryText(result, forceUnit) {
    var c = result.chosen;
    if (!result.ok) return result.errors.join(' ');
    // one unit for all three plate dimensions so the line reads as a size
    var plateUnit = pickLengthUnit(
      Math.max(result.plate.length, result.plate.width, result.plate.thickness)
    );
    var lines = [
      'Tipping force: ' + fmtForce(c.tipForce, forceUnit),
      '',
      'Baseplate: ' + fmtMass(result.plate.mass) + ', ' +
        fmtLengthIn(result.plate.length, plateUnit) + ' × ' +
        fmtLengthIn(result.plate.width, plateUnit) + ' × ' +
        fmtLengthIn(result.plate.thickness, plateUnit),
      'Pole: ' + fmtMass(result.pole.mass) + ', ' + fmtLength(result.pole.length) + ' long'
    ];
    if (result.topMass > 0) lines.push('Extra weight at the top: ' + fmtMass(result.topMass));
    lines.push(
      'Push: ' + describeAngle(result.pushAngleDeg) + ', ' + fmtLength(result.pushHeight) +
        ' above the ground, ' + c.label.toLowerCase()
    );
    lines.push('');
    lines.push('Total weight: ' + fmtForce(result.weight, forceUnit) + ' (' + fmtMass(result.totalMass) + ')');
    lines.push('Centre of mass: ' + fmtLength(result.cgHeight) + ' above the ground');
    lines.push('Lever arm: ' + fmtLength(c.leverArm));
    lines.push('Tips on its own past ' + fmt(c.tiltAngleDeg, 1) + '° of tilt');
    lines.push('Energy to tip: ' + fmtEnergy(c.energyToTip));
    if (result.friction != null) {
      lines.push(
        'Slides at ' + fmtForce(result.slideForce, forceUnit) + ' (µ = ' + fmt(result.friction, 2) + ') — ' +
          (result.mode === 'slide' ? 'so it slides before it tips' : 'so it tips before it slides')
      );
    }
    if (result.warnings.length) {
      lines.push('');
      result.warnings.forEach(function (w) {
        lines.push('Note: ' + w);
      });
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Main update cycle
   * ------------------------------------------------------------------ */

  var lastResult = null;

  function update() {
    var atTop = $('pushAtTop').checked;
    $('pushHeight').disabled = atTop;
    $('pushHeight-unit').disabled = atTop;

    var frictionOn = $('checkSliding').checked;
    $('friction').disabled = !frictionOn;
    $('friction-preset').disabled = !frictionOn;

    var state = readState();
    var result = P.solve(state);
    lastResult = result;

    // when the push is pinned to the top of the pole, show what that height is
    if (atTop) {
      setFieldBase(FIELDS[FIELDS.length - 1], result.poleTop);
    }

    var forceUnit = $('force-unit').value || 'N';

    renderAnswer(result, forceUnit);
    renderStats(result, forceUnit);
    renderCompare(result, forceUnit);
    renderWorking(result);
    $('diagram-side').innerHTML = buildSideView(result);
    $('diagram-plan').innerHTML = buildPlanView(result);
    // a corner push tips about a corner, so the side view is a slice taken
    // along the diagonal — worth saying, or the plate looks too wide
    $('diagram-side-caption').textContent = result.chosen.id === 'corner'
      ? 'Sliced along the diagonal, roughly to scale'
      : 'Side on, roughly to scale';

    save();
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */

  var toastTimer = null;

  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-shown');
    }, 2200);
  }

  function copyText(str, okMessage) {
    var done = function () {
      toast(okMessage);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(done, function () {
        fallbackCopy(str, done);
      });
    } else {
      fallbackCopy(str, done);
    }
  }

  function fallbackCopy(str, done) {
    var ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (err) {
      toast('Could not copy automatically');
    }
    document.body.removeChild(ta);
  }

  function wire() {
    FIELDS.forEach(function (field) {
      $(field.id).addEventListener('input', update);
      var sel = unitSelect(field);
      sel.setAttribute('data-prev', sel.value);
      sel.addEventListener('change', function () {
        onUnitChanged(field, sel);
        update();
      });
    });

    SCALARS.forEach(function (s) {
      $(s.id).addEventListener('input', update);
    });

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="pushDirection"]'),
      function (el) {
        el.addEventListener('change', update);
      }
    );

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="unit-system"]'),
      function (el) {
        el.addEventListener('change', function () {
          switchSystem(el.value);
          update();
        });
      }
    );

    $('pushAtTop').addEventListener('change', update);
    $('checkSliding').addEventListener('change', update);
    $('force-unit').addEventListener('change', update);

    $('friction-preset').addEventListener('change', function () {
      if (this.value) {
        $('friction').value = this.value;
        this.value = '';
        update();
      }
    });

    $('gravity-preset').addEventListener('change', function () {
      if (this.value) {
        $('gravity').value = this.value;
        this.value = '';
        update();
      }
    });

    $('btn-reset').addEventListener('click', function () {
      applyDefaults(currentSystem);
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      update();
      toast('Back to the example');
    });

    $('btn-share').addEventListener('click', function () {
      var query = serialize();
      history.replaceState(null, '', '#' + query);
      copyText(location.href, 'Link copied');
    });

    $('btn-copy').addEventListener('click', function () {
      if (!lastResult) return;
      copyText(summaryText(lastResult, $('force-unit').value || 'N'), 'Summary copied');
    });

    window.addEventListener('hashchange', function () {
      if (deserialize(location.hash.replace(/^#/, ''))) update();
    });
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  populateUnitSelects();
  applyDefaults('metric');
  restore();
  wire();
  update();
})();
