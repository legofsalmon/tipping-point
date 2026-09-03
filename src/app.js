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
  var LW = window.LedWall;
  var STORE_KEY = 'tipping-point:v2';

  /* Every unit kind a field can use, keyed by its data-units attribute. */
  var UNIT_TABLES = {
    length: P.LENGTH_UNITS,
    mass: P.MASS_UNITS,
    force: P.FORCE_UNITS,
    energy: P.ENERGY_UNITS,
    moment: P.MOMENT_UNITS,
    areal: LW.AREAL_UNITS,
    linear: LW.LINEAR_UNITS,
    speed: LW.SPEED_UNITS
  };

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

  /* LED wall mode. Defaults describe a 10 m x 5 m outdoor wall on 6 m
   * uprights — a plausible small festival screen. */
  var LED_FIELDS = [
    { id: 'wallWidth', kind: 'length', key: 'ww', metric: [10, 'm'], imperial: [33, 'ft'] },
    { id: 'wallHeight', kind: 'length', key: 'wh', metric: [5, 'm'], imperial: [16, 'ft'] },
    { id: 'wallArealMass', kind: 'areal', key: 'wa', metric: [40, 'kg/m\u00b2'], imperial: [8.2, 'lb/ft\u00b2'] },
    { id: 'wallBottom', kind: 'length', key: 'wb', metric: [500, 'mm'], imperial: [20, 'in'] },
    { id: 'wallDepth', kind: 'length', key: 'wd', metric: [120, 'mm'], imperial: [5, 'in'] },

    { id: 'trussHeight', kind: 'length', key: 'th', metric: [6, 'm'], imperial: [20, 'ft'] },
    { id: 'trussLinearMass', kind: 'linear', key: 'tl', metric: [6.5, 'kg/m'], imperial: [4.4, 'lb/ft'] },
    { id: 'trussDepth', kind: 'length', key: 'td', metric: [300, 'mm'], imperial: [12, 'in'] },
    { id: 'trussWidth', kind: 'length', key: 'tw', metric: [300, 'mm'], imperial: [12, 'in'] },

    { id: 'plateFront', kind: 'length', key: 'bf', metric: [500, 'mm'], imperial: [20, 'in'] },
    { id: 'plateBack', kind: 'length', key: 'bb', metric: [1000, 'mm'], imperial: [39, 'in'] },
    { id: 'ledPlateWidth', kind: 'length', key: 'bw', metric: [600, 'mm'], imperial: [24, 'in'] },
    { id: 'ledPlateThickness', kind: 'length', key: 'bt', metric: [20, 'mm'], imperial: [0.75, 'in'] },
    { id: 'ledPlateMass', kind: 'mass', key: 'bm', metric: [60, 'kg'], imperial: [132, 'lb'] },
    { id: 'ballastMass', kind: 'mass', key: 'bl', metric: [300, 'kg'], imperial: [660, 'lb'] },

    { id: 'windSpeed', kind: 'speed', key: 'ws', metric: [11, 'm/s'], imperial: [25, 'mph'] },
    { id: 'maxSpacing', kind: 'length', key: 'ms', metric: [3, 'm'], imperial: [10, 'ft'] },
    { id: 'maxLoadPerUpright', kind: 'mass', key: 'ml', metric: [500, 'kg'], imperial: [1100, 'lb'] }
  ];

  var LED_SCALARS = [
    { id: 'forceCoefficient', key: 'cf', def: 1.3 },
    { id: 'trussForceCoefficient', key: 'tc', def: 1.8 },
    { id: 'trussSolidity', key: 'ts', def: 0.3 },
    { id: 'safetyFactor', key: 'sf', def: 1.5 },
    { id: 'ledGravity', key: 'lg', def: P.G_STANDARD }
  ];

  /* The form plumbing — defaults, unit switching, saving, restoring — does not
   * care which mode a field belongs to, so it works off the combined lists. */
  var ALL_FIELDS = FIELDS.concat(LED_FIELDS);
  var ALL_SCALARS = SCALARS.concat(LED_SCALARS);
  var PUSH_HEIGHT_FIELD = FIELDS.filter(function (f) {
    return f.id === 'pushHeight';
  })[0];

  var currentMode = 'pole';

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

  /**
   * Significant figures, for numbers the app has no business stating precisely.
   *
   * The headline is a first pass against a force coefficient somebody picked to
   * one decimal place, so a fourth figure is a promise the maths cannot keep —
   * and unearned precision reads as false confidence to exactly the people who
   * most need to trust the answer.
   */
  function fmtSig(n, sig) {
    if (n == null || !isFinite(n)) return '—';
    if (n === 0) return '0';
    var s = sig || 3;
    var mag = Math.floor(Math.log10(Math.abs(n)));
    var dp = Math.max(0, s - 1 - mag);
    var factor = Math.pow(10, dp);
    return fmt(Math.round(n * factor) / factor, dp);
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
    /* Past here nobody is pushing anything, and the old single band covered a
     * factor of two hundred — which is most of where the LED wall lives. */
    if (newtons < 2000) return 'two or three people, braced and shoving together';
    if (newtons < 20000) return 'hoist and winch loads, past anything a person can push';
    if (newtons < 60000) return 'more than a two-tonne hoist is rated for';
    return 'tens of tonnes of pull, ground-anchor work rather than ballast';
  }

  /* The sizes of electric chain hoist that turn up on every job. Named only
   * when the force really is one of them, because a comparison that stretches
   * to cover a whole band is padding rather than a comparison. */
  var HOIST_KG = [125, 250, 500, 1000, 2000];

  function asHoist(newtons, g) {
    var kg = newtons / (g || P.G_STANDARD);
    for (var i = 0; i < HOIST_KG.length; i += 1) {
      if (Math.abs(kg - HOIST_KG[i]) <= HOIST_KG[i] * 0.1) {
        return 'about what a ' + HOIST_KG[i] + ' kg hoist holds at capacity';
      }
    }
    return '';
  }

  /**
   * A force, said in the way a rigger would say it.
   *
   * The kilogram figure is not an analogy — it is the same force in kilograms
   * force, exact by definition — but the wording has to keep it a *pull on a
   * line*, never a weight sitting on the thing. Those are not interchangeable
   * here: 4,817 N of wind on the reference wall makes 14,452 N·m trying to tip
   * it, while 4,817 N hung on its face makes 1,397 N·m holding it down. Ten
   * times smaller, and the opposite sign.
   */
  function forceLikeness(newtons, g) {
    if (!isFinite(newtons) || newtons <= 0) return '';
    var kg = newtons / (g || P.G_STANDARD);
    /* Whole kilograms once there are enough of them for a fraction to be noise. */
    return 'the same pull as ' + fmtMass(kg >= 20 ? Math.round(kg) : kg) + ' on a line — ' +
      (asHoist(newtons, g) || feelsLike(newtons));
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
      var table = UNIT_TABLES[sel.getAttribute('data-units')];
      sel.innerHTML = Object.keys(table)
        .map(function (u) {
          return '<option value="' + u + '">' + table[u].label + '</option>';
        })
        .join('');
    });
  }

  /** Fill the LED-mode preset pickers from the reference tables. */
  function populateLedPresets() {
    var fill = function (id, items, format) {
      var sel = $(id);
      var first = sel.options[0] ? sel.options[0].outerHTML : '';
      sel.innerHTML = first + items.map(format).join('');
    };

    fill('panel-preset', LW.PANEL_PRESETS, function (o) {
      return '<option value="' + o.value + '">' + esc(o.label) + ' — ' + o.value +
        ' kg/m\u00b2</option>';
    });
    fill('truss-preset', LW.TRUSS_PRESETS, function (o) {
      return '<option value="' + o.value + '|' + o.depth + '">' + esc(o.label) + ' — ' +
        o.value + ' kg/m</option>';
    });
    fill('cf-preset', LW.CF_PRESETS, function (o) {
      return '<option value="' + o.value + '">' + esc(o.label) + '</option>';
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
    return P.toBase(raw, unitOverride || unitSelect(field).value, UNIT_TABLES[field.kind]);
  }

  /**
   * Fields left empty, as distinct from fields deliberately set to zero.
   *
   * `parseFloat("")` is NaN and `parseFloat("0")` is 0, and the two only become
   * the same number once a blank has been quietly turned into one — which is
   * the thing worth avoiding. A wall with no panel weight entered is not a
   * weightless wall; it is a question nobody has answered yet, and answering it
   * anyway with a confident figure is the one way this app can be untruthful.
   *
   * Hidden and disabled inputs are none of our business: the other mode's
   * fields, and the ones the app fills in itself.
   */
  function blankFields(fields) {
    return fields.filter(function (field) {
      var input = $(field.id);
      if (!input || input.disabled || input.offsetParent === null) return false;
      return !isFinite(parseFloat(input.value));
    });
  }

  /* Labels that mean nothing on their own — there are four "Weight" fields on
   * the LED screen — take their fieldset's legend with them. */
  var GENERIC_LABELS = /^(weight|length|width|height|thickness|depth)$/i;

  function fieldLabel(field) {
    var el = document.querySelector('label[for="' + field.id + '"]');
    var text = el ? el.textContent.trim() : field.id;
    if (GENERIC_LABELS.test(text)) {
      var set = el && el.closest ? el.closest('fieldset') : null;
      var legend = set ? set.querySelector('legend') : null;
      if (legend) text = legend.textContent.trim() + ' ' + text.toLowerCase();
    }
    return text.charAt(0).toLowerCase() + text.slice(1);
  }

  /** Turns any blanks into the same kind of message the solvers produce. */
  function blankError(fields) {
    var missing = blankFields(fields).map(fieldLabel);
    if (!missing.length) return null;
    if (missing.length === 1) return 'Enter the ' + missing[0] + '.';
    return 'Enter the ' + missing.slice(0, -1).join(', the ') + ' and the ' +
      missing[missing.length - 1] + '.';
  }

  /**
   * Adds them to a result so they travel the same path as a real error.
   *
   * The solvers already refuse to answer when a field they cannot do without
   * is zero, and a blank reads as zero on the way in, so for those fields the
   * two messages would arrive together saying the same thing. Duplicates are
   * dropped rather than special-cased: this check earns its keep on the fields
   * where zero is a legitimate answer and blank is not.
   */
  function holdForBlanks(result, fields) {
    var message = blankError(fields);
    if (message) {
      result.ok = false;
      result.errors = [message].concat(result.errors || []).filter(
        function (text, i, all) {
          return all.indexOf(text) === i;
        }
      );
    }
    return result;
  }

  function setFieldBase(field, baseValue) {
    var input = $(field.id);
    input.value = tidy(P.fromBase(baseValue, unitSelect(field).value, UNIT_TABLES[field.kind]));
    input.setAttribute('data-base', String(baseValue));
    input.setAttribute('data-shown', input.value);
  }

  function applyDefaults(system) {
    currentSystem = system;
    setChecked('unit-system', system);
    ALL_FIELDS.forEach(function (field) {
      var spec = field[system];
      $(field.id).value = String(spec[0]);
      var sel = unitSelect(field);
      sel.value = spec[1];
      sel.setAttribute('data-prev', spec[1]);
    });
    ALL_SCALARS.forEach(function (s) {
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
    ALL_FIELDS.forEach(function (field) {
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

  /**
   * Only what the recipient needs: the mode in play, and the fields that differ
   * from the defaults they will open on.
   *
   * Sharing an LED wall used to send all ten pole parameters with it, plus
   * every untouched default — 43 parameters and 391 characters, almost none of
   * it about the thing being shared. Anything omitted simply stays at its
   * default at the other end, which is what it was here.
   */
  function serialize() {
    var p = new URLSearchParams();
    var led = currentMode === 'led';
    p.set('mode', currentMode);
    p.set('sys', currentSystem);

    (led ? LED_FIELDS : FIELDS).forEach(function (field) {
      var shown = $(field.id).value + unitSelect(field).value;
      var def = field[currentSystem];
      if (shown === String(def[0]) + def[1]) return;
      p.set(field.key, shown);
    });

    (led ? LED_SCALARS : SCALARS).forEach(function (s) {
      if (parseFloat($(s.id).value) === s.def) return;
      p.set(s.key, $(s.id).value);
    });

    /* defaultChecked is whatever the markup shipped with, so this stays right
     * without a second list of defaults to keep in step. */
    var flag = function (key, id) {
      var el = $(id);
      if (el.checked !== el.defaultChecked) p.set(key, el.checked ? '1' : '0');
    };

    if (led) {
      flag('back', 'ballastAtBack');
      flag('ctr', 'trussCentred');
      flag('wog', 'wallOnGround');
      if ($('uprightsOverride').value) p.set('nup', $('uprightsOverride').value);
    } else {
      var dir = checkedValue('pushDirection') || 'width';
      if (dir !== 'width') p.set('dir', dir);
      flag('top', 'pushAtTop');
      flag('slide', 'checkSliding');
    }

    if ($('force-unit').value !== 'N') p.set('fu', $('force-unit').value);
    return p.toString();
  }

  var VALUE_UNIT = /^(-?[\d.]+)\s*([a-zA-Z·]*)$/;

  function deserialize(query) {
    var p = new URLSearchParams(query);
    if (!p.has('pl') && !p.has('sys')) return false;

    var mode = p.get('mode');
    if (mode === 'pole' || mode === 'led') currentMode = mode;

    var sys = p.get('sys');
    if (sys === 'metric' || sys === 'imperial') currentSystem = sys;
    setChecked('unit-system', currentSystem);

    ALL_FIELDS.forEach(function (field) {
      var raw = p.get(field.key);
      if (!raw) return;
      var m = VALUE_UNIT.exec(raw.trim());
      if (!m) return;
      var table = UNIT_TABLES[field.kind];
      var unit = table[m[2]] ? m[2] : field[currentSystem][1];
      $(field.id).value = m[1];
      var sel = unitSelect(field);
      sel.value = unit;
      sel.setAttribute('data-prev', unit);
    });

    /* Links and saved state from before the truss had a width across the wall
     * carry the depth alone. Box truss is square, which is what those numbers
     * described, so the width follows the depth rather than being left at a
     * default that quietly contradicts it. */
    if (p.has('td') && !p.has('tw')) {
      var depthField = fieldById('trussDepth');
      var widthField = fieldById('trussWidth');
      $(widthField.id).value = $(depthField.id).value;
      var from = unitSelect(depthField);
      var to = unitSelect(widthField);
      to.value = from.value;
      to.setAttribute('data-prev', from.value);
    }

    ALL_SCALARS.forEach(function (s) {
      var raw = p.get(s.key);
      if (raw != null && isFinite(parseFloat(raw))) $(s.id).value = String(parseFloat(raw));
    });

    if (p.has('back')) $('ballastAtBack').checked = p.get('back') === '1';
    if (p.has('ctr')) $('trussCentred').checked = p.get('ctr') === '1';
    if (p.has('wog')) $('wallOnGround').checked = p.get('wog') === '1';
    if (p.has('nup')) $('uprightsOverride').value = p.get('nup');
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
   * Live simulation
   * ------------------------------------------------------------------ */

  var S = window.TippingSim;

  var sim = {
    body: null,
    state: S.makeState(),
    raf: null,
    lastFrame: 0,
    applying: false,
    dragForce: null, // set while a pointer is dragging
    dragPoint: null, // { x, y } in canvas pixels, for the rubber band
    maxForce: 1,
    load: null, // LED mode: where the load acts and at what angle
    lastStatus: '',
    palette: null,
    hintShown: true
  };

  /* Canvas colours come from the stylesheet so the drawing follows the theme.
   * Cached, and dropped whenever the theme or the size changes. */
  function palette() {
    if (sim.palette) return sim.palette;
    var cs = getComputedStyle($('sim-canvas'));
    var pick = function (name, fallback) {
      var v = cs.getPropertyValue(name).trim();
      return v || fallback;
    };
    sim.palette = {
      text: pick('--text', '#111'),
      muted: pick('--muted', '#666'),
      ground: pick('--ground', '#888'),
      border: pick('--border-strong', '#ccc'),
      surface: pick('--surface', '#fff'),
      body: pick('--border-strong', '#c6ccd6'),
      accent: pick('--accent', '#2563eb'),
      force: pick('--force', '#d94f0a'),
      screen: pick('--screen', '#2f3947'),
      screenLine: pick('--screen-line', '#151a22'),
      ballast: pick('--ballast', '#7b8494')
    };
    return sim.palette;
  }

  function dropPalette() {
    sim.palette = null;
  }

  function simBaseHeld() {
    return $('sim-base-held').checked;
  }

  /** Force currently being applied, in newtons. */
  function appliedForce() {
    if (sim.dragForce != null) return sim.dragForce;
    if (!sim.applying) return 0;
    return sliderForce();
  }

  function sliderForce() {
    var pct = Number($('sim-force-input').value) / 100;
    return sim.maxForce * pct;
  }

  /* The slider runs to 160% of the force needed to tip it, so the threshold
   * sits at a memorable place on the track. With no finite threshold (pushing
   * too steeply down to ever tip it) fall back to something weight-related. */
  function simForceScale(result) {
    var tip = result.chosen.tipForce;
    if (isFinite(tip) && tip > 0) return tip;
    return Math.max(result.weight, 1);
  }

  function setSimBody(result) {
    var hadBody = !!sim.body;
    sim.body = S.makeBody(result);
    sim.maxForce = simForceScale(result);

    // keep whatever pose it is in, but respect the new geometry
    if (hadBody) {
      sim.state.theta = Math.min(sim.state.theta, sim.body.thetaEnd);
      if (sim.state.theta < sim.body.thetaEnd) sim.state.fallen = false;
    }
    updateSimForceLabel();
  }

  /** Turn a horizontal force on the wall back into the wind that would cause it. */
  function forceAsWind(force) {
    if (!lastLed || !lastLed.ok) return NaN;
    var area = Math.max(lastLed.layout.area, 1e-9);
    var q = force / (lastLed.forceCoefficient * area);
    return Math.sqrt(Math.max(0, (2 * q) / lastLed.airDensity));
  }

  /**
   * The wording around the slider, which depends on the mode *and*, in LED
   * mode, on where the load is being put — a point push at the top of the truss
   * is not wind and must not be labelled as if it were.
   */
  function updateSimChrome() {
    var asWind = currentMode === 'led' && (!sim.load || sim.load.isWind);
    $('sim-force-label').textContent = asWind
      ? 'Wind of'
      : currentMode === 'led'
        ? 'Pushing with'
        : 'Push with';
    $('sim-tip').firstElementChild.innerHTML = asWind
      ? 'Drag to lean on the wall — or set a wind speed below and press <em>Apply</em>.'
      : currentMode === 'led'
        ? 'Drag to lean on it — or set a force below and press <em>Apply</em>.'
        : 'Drag anywhere to push — or set a force below and press <em>Apply</em>.';
  }

  /** One readout cell: the figure, and what it is. */
  function qty(value, of) {
    return '<span class="q"><b>' + esc(value) + '</b>' +
      (of ? ' <span>' + esc(of) + '</span>' : '') + '</span>';
  }

  function updateSimForceLabel() {
    var pct = Number($('sim-force-input').value);
    var force = sliderForce();
    var unit = $('force-unit').value || 'N';
    var out = $('sim-force-out');

    if (currentMode === 'led') {
      var g = lastLed && lastLed.ok ? lastLed.layout.g : P.G_STANDARD;
      var cells = [];

      /* Wind only where the load actually is wind. A point load at the top of
       * the truss has a wind speed you could work out and no business quoting,
       * because no wind puts its whole force up there. */
      if (sim.load && sim.load.isWind) {
        var wind = forceAsWind(force);
        if (isFinite(wind)) {
          cells.push(qty(fmtSpeed(wind), LW.BEAUFORT_NAMES[LW.beaufort(wind)] || 'wind'));
        }
      }
      cells.push(
        qty(fmtForce(force, unit), sim.load && sim.load.isWind ? 'on the wall' : 'at the top')
      );
      if (sim.load) {
        cells.push(
          qty(
            fmtLength(sim.load.point.y) + ' up',
            Math.abs(sim.load.angleDeg) > 0.05
              ? fmt(Math.abs(sim.load.angleDeg), 1) + '° above level'
              : 'level'
          )
        );
      }
      cells.push(qty(pct + '%', 'of what it takes'));
      var like = forceLikeness(force, g);
      out.innerHTML = cells.join('') + (like ? '<span class="q-like">' + esc(like) + '</span>' : '');
      return;
    }

    out.innerHTML =
      qty(fmtForce(force, unit), '') +
      qty(pct + '%', 'of what it takes') +
      (function () {
        var like = forceLikeness(force, lastResult ? lastResult.gravity : P.G_STANDARD);
        return like ? '<span class="q-like">' + esc(like) + '</span>' : '';
      })();
  }

  function resetSim() {
    sim.state = S.makeState();
    sim.dragForce = null;
    sim.dragPoint = null;
    setApplying(false);
    drawSim();
    renderSimReadouts();
  }

  function setApplying(on) {
    sim.applying = on;
    var btn = $('sim-apply');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Stop' : 'Apply';
    if (on) startSimLoop();
  }

  /* ---------------------------- the view box ---------------------------- */

  /**
   * The view the camera is easing toward: whatever frames the object's
   * current pose. A box big enough for the whole fall would leave the upright
   * assembly tiny in one corner, and a box that fits only the upright pose
   * would lose it on the way over — so the camera follows instead.
   */
  function viewTarget(w, availH) {
    var b = sim.body;
    var st = sim.state;

    var corners = [[0, 0], [b.pushPoint.x, b.pushPoint.y]];
    b.shapes.forEach(function (s) {
      corners.push([s.x0, s.y0], [s.x1, s.y0], [s.x0, s.y1], [s.x1, s.y1]);
    });

    var minX = 0;
    var maxX = 0;
    var maxY = 0;
    corners.forEach(function (c) {
      var p = S.rotate(st, c[0], c[1]);
      var x = p.x + st.slide;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (p.y > maxY) maxY = p.y;
    });

    var span = Math.max(maxX - minX, 1e-4);
    var height = Math.max(maxY, 1e-4);
    // extra room on the left for the force arrow, which is drawn in pixels
    var padLeft = Math.max(span * 0.3, height * 0.2);
    var padRight = Math.max(span * 0.12, height * 0.08);
    var padTop = Math.max(height * 0.16, span * 0.06);

    var worldW = span + padLeft + padRight;
    var worldH = height + padTop;

    /* Centre the pose in the frame rather than pinning the ground to the
     * bottom. Upright, that puts the ground near the bottom anyway; once it's
     * down, a short wide pose would otherwise leave the top half empty. */
    return {
      scale: Math.min(w / worldW, availH / worldH),
      centreX: (minX - padLeft + maxX + padRight) / 2,
      centreY: worldH / 2
    };
  }

  function currentViewTarget() {
    var canvas = $('sim-canvas');
    var h = canvas.clientHeight || 200;
    return viewTarget(canvas.clientWidth || 320, Math.max(40, h - 26));
  }

  /** Move the camera toward its target. Snaps when no dt is given. */
  function easeView(dt) {
    var target = currentViewTarget();
    if (!sim.view || !dt) {
      sim.view = target;
      return;
    }
    /* Pull back quickly but settle in slowly: during a fall the object gains
     * reach fast, and a symmetric ease lets it clip off the edge of the frame
     * before the camera catches up. */
    var tau = target.scale < sim.view.scale ? 0.05 : 0.18;
    var k = 1 - Math.exp(-dt / tau);
    sim.view.scale += (target.scale - sim.view.scale) * k;
    sim.view.centreX += (target.centreX - sim.view.centreX) * k;
    sim.view.centreY += (target.centreY - sim.view.centreY) * k;
  }

  /** Has the camera caught up? The loop keeps running until it has. */
  function viewSettled() {
    if (!sim.view) return true;
    var target = currentViewTarget();
    var scaleOff = Math.abs(target.scale - sim.view.scale) / Math.max(target.scale, 1e-9);
    var panX = Math.abs(target.centreX - sim.view.centreX) * sim.view.scale;
    var panY = Math.abs(target.centreY - sim.view.centreY) * sim.view.scale;
    return scaleOff < 0.002 && panX < 0.4 && panY < 0.4;
  }

  /** World-to-canvas mapping from the camera's current position. */
  function simView() {
    var canvas = $('sim-canvas');
    var w = canvas.clientWidth || 320;
    var h = canvas.clientHeight || 200;
    if (!sim.view) easeView();

    var scale = sim.view.scale;
    var centreX = sim.view.centreX;
    var centreY = sim.view.centreY;

    return {
      w: w,
      h: h,
      scale: scale,
      groundY: h / 2 + centreY * scale,
      // world x (already including any slide) -> canvas x
      sx: function (x) {
        return w / 2 + (x - centreX) * scale;
      },
      sy: function (y) {
        return h / 2 - (y - centreY) * scale;
      },
      worldLeft: centreX - w / 2 / scale
    };
  }

  /** A round number near `rough`, so ground marks don't shuffle about. */
  function niceStep(rough) {
    if (!(rough > 0)) return 1;
    var power = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / power;
    var step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    return step * power;
  }

  /** Body-frame point -> canvas point, through the current rotation. */
  function bodyPoint(view, x, y) {
    var p = S.rotate(sim.state, x, y);
    return { x: view.sx(p.x + sim.state.slide), y: view.sy(p.y) };
  }

  function polygon(ctx, pts, fill, stroke) {
    ctx.beginPath();
    pts.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  function arrow(ctx, fromX, fromY, toX, toY, colour, width) {
    var dx = toX - fromX;
    var dy = toY - fromY;
    var len = Math.hypot(dx, dy);
    if (len < 1) return;
    var ux = dx / len;
    var uy = dy / len;
    var headLen = Math.min(11, len * 0.42);

    ctx.strokeStyle = colour;
    ctx.lineWidth = width || 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX - ux * headLen * 0.6, toY - uy * headLen * 0.6);
    ctx.stroke();

    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - ux * headLen + -uy * headLen * 0.42, toY - uy * headLen + ux * headLen * 0.42);
    ctx.lineTo(toX - ux * headLen - -uy * headLen * 0.42, toY - uy * headLen - ux * headLen * 0.42);
    ctx.closePath();
    ctx.fill();
  }

  function drawSim(dt) {
    var canvas = $('sim-canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx || !sim.body) return;

    easeView(dt);

    var dpr = window.devicePixelRatio || 1;
    var wantW = Math.round(canvas.clientWidth * dpr);
    var wantH = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    var b = sim.body;
    var st = sim.state;
    var c = palette();
    var view = simView();
    var force = appliedForce();

    /* ground, with marks at fixed world positions so they slide past when the
     * base does */
    ctx.strokeStyle = c.ground;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, view.groundY);
    ctx.lineTo(view.w, view.groundY);
    ctx.stroke();

    /* Marks sit at fixed world positions, so they stream past when the base
     * slides. Rounding the spacing keeps them from shuffling as the camera
     * zooms. */
    var spacing = niceStep(view.w / view.scale / 14);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    var firstMark = Math.floor(view.worldLeft / spacing) * spacing;
    for (var k = 0; k < 400; k += 1) {
      var mx = view.sx(firstMark + k * spacing);
      if (mx > view.w + 12) break;
      if (mx < -12) continue;
      ctx.beginPath();
      ctx.moveTo(mx, view.groundY);
      ctx.lineTo(mx - 8, view.groundY + 8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    var pivot = bodyPoint(view, 0, 0);

    /* Every solid part, rotated about the pivot. Anything thinner than a
     * couple of pixels is drawn at that minimum so it doesn't vanish. */
    var minSize = 2.5 / view.scale;
    b.shapes.forEach(function (s) {
      var x0 = Math.min(s.x0, s.x1);
      var x1 = Math.max(s.x0, s.x1);
      var y0 = Math.min(s.y0, s.y1);
      var y1 = Math.max(s.y0, s.y1);
      if (x1 - x0 < minSize) x1 = x0 + minSize;
      if (y1 - y0 < minSize) y1 = y0 + minSize;

      polygon(
        ctx,
        [
          bodyPoint(view, x0, y0),
          bodyPoint(view, x1, y0),
          bodyPoint(view, x1, y1),
          bodyPoint(view, x0, y1)
        ],
        s.role === 'wall' ? c.screen : s.role === 'ballast' ? c.ballast : c.body,
        s.role === 'wall' ? c.screenLine : c.text
      );
    });

    /* anything carried as a lump rather than a box */
    b.markers.forEach(function (m) {
      var p = bodyPoint(view, m.x, m.y);
      ctx.fillStyle = c.accent;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    /* The centre of mass is welded to the body, so it swings round with it on a
     * fixed radius from the pivot — that faint line. What actually decides
     * things is the plumb line hanging from it: while that lands inside the
     * pivot the weight holds the object down, and the instant it lands outside,
     * the same weight is pulling it over. */
    /* Measurement chrome belongs on something still standing. Once it is down,
     * the centre-of-gravity marker, its radius line, the plumb line and the
     * gap dimension are all answering a question that has been settled — and
     * drawn over a wreck they read as debris rather than instrumentation. */
    if (!st.fallen) {
      var cg = bodyPoint(view, b.cgPoint.x, b.cgPoint.y);
      ctx.strokeStyle = c.accent;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(pivot.x, pivot.y);
      ctx.lineTo(cg.x, cg.y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      var cogNow = S.cog(b, st);
      var inside = cogNow.insideBy >= 0;
      var plumbColour = inside ? c.accent : c.force;
      var landX = view.sx(cogNow.x + st.slide);

      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = plumbColour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cg.x, cg.y);
      ctx.lineTo(landX, view.groundY);
      ctx.stroke();
      ctx.restore();

      // where the weight lands, and how that compares with the pivot
      ctx.fillStyle = plumbColour;
      ctx.beginPath();
      ctx.moveTo(landX, view.groundY);
      ctx.lineTo(landX - 5, view.groundY - 8);
      ctx.lineTo(landX + 5, view.groundY - 8);
      ctx.closePath();
      ctx.fill();

      var gapY = view.groundY + 15;
      if (Math.abs(landX - pivot.x) > 3) {
        ctx.strokeStyle = plumbColour;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(landX, gapY);
        ctx.lineTo(pivot.x, gapY);
        ctx.stroke();
        [landX, pivot.x].forEach(function (x) {
          ctx.beginPath();
          ctx.moveTo(x, gapY - 3.5);
          ctx.lineTo(x, gapY + 3.5);
          ctx.stroke();
        });
      }

      // centre of mass marker
      var rad = 7;
      ctx.beginPath();
      ctx.arc(cg.x, cg.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = c.surface;
      ctx.fill();
      ctx.strokeStyle = c.text;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = c.text;
      ctx.beginPath();
      ctx.moveTo(cg.x, cg.y);
      ctx.arc(cg.x, cg.y, rad, -Math.PI / 2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cg.x, cg.y);
      ctx.arc(cg.x, cg.y, rad, Math.PI / 2, Math.PI);
      ctx.closePath();
      ctx.fill();
    }

    // pivot
    ctx.fillStyle = c.force;
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(pivot.x - 6, pivot.y + 9);
    ctx.lineTo(pivot.x + 6, pivot.y + 9);
    ctx.closePath();
    ctx.fill();

    /* the push itself */
    var push = bodyPoint(view, b.pushPoint.x, b.pushPoint.y);
    if (force > 0 && !st.fallen) {
      var thetaP = b.pushAngleRad;
      var lead = 22 + 52 * Math.min(1, force / (sim.maxForce * 1.6));
      arrow(
        ctx,
        push.x - Math.cos(thetaP) * lead,
        push.y - Math.sin(thetaP) * lead,
        push.x,
        push.y,
        c.force,
        2.6
      );
    }

    // rubber band to the pointer while dragging
    if (sim.dragPoint) {
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = c.force;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(push.x, push.y);
      ctx.lineTo(sim.dragPoint.x, sim.dragPoint.y);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = c.force;
      ctx.beginPath();
      ctx.arc(sim.dragPoint.x, sim.dragPoint.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // grab handle at the push point, when nothing is happening
    if (force === 0 && !st.fallen) {
      ctx.strokeStyle = c.force;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(push.x, push.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  var STATUS_TEXT = {
    'at-rest': 'Standing still.',
    holding: 'Holding — the push is not enough to lift it.',
    lifting: 'Lifting onto its edge.',
    'falling-back': 'Dropping back down.',
    'going-over': 'Past the balance point — gravity has it now.',
    sliding: 'Sliding across the floor instead of tipping.',
    fallen: 'Over it goes.'
  };

  var STATUS_TEXT_LED = {
    'at-rest': 'Standing still.',
    holding: 'Holding — the wind is not enough to lift it.',
    lifting: 'Lifting off the front edge of the baseplates.',
    'falling-back': 'Settling back down.',
    'going-over': 'Past the balance point — it is going over.',
    sliding: 'Sliding across the ground rather than tipping.',
    fallen: 'Down it goes.'
  };

  var STATUS_CLASS = {
    holding: 'sim-status--hold',
    'at-rest': '',
    lifting: '',
    'falling-back': '',
    'going-over': 'sim-status--over',
    fallen: 'sim-status--over',
    sliding: 'sim-status--slide'
  };

  function renderSimReadouts() {
    if (!sim.body) return;
    var b = sim.body;
    var st = sim.state;
    var force = appliedForce();
    var held = simBaseHeld();
    var unit = $('force-unit').value || 'N';
    var m = S.moments(b, st, force, held);
    var status = S.describe(b, st, force, held);

    var tilt = (st.theta * 180) / Math.PI;
    var led = currentMode === 'led';
    var asWindLoad = led && sim.load && sim.load.isWind;
    var bits = [(led ? STATUS_TEXT_LED[status] : STATUS_TEXT[status]) || ''];
    /* "the wind is not enough" is the wrong noun for a load put on by hand. */
    if (led && !asWindLoad && status === 'holding') {
      bits[0] = 'Holding — that is not enough to lift it.';
    }
    if (force > 0) {
      /* Only call it wind where it is wind. With the load put on at the top it
       * is a point push, and quoting a wind speed for it would be a fiction —
       * no wind concentrates its whole force up there. */
      var asWind = asWindLoad ? forceAsWind(force) : NaN;
      if (isFinite(asWind)) {
        bits.push(
          'Wind of <span class="qty">' + esc(fmtSpeed(asWind)) + '</span>, ' +
            esc(fmtForce(force, unit)) + ' on the wall.'
        );
      } else if (led && sim.load) {
        bits.push(
          'Pushing <span class="qty">' + esc(fmtForce(force, unit)) + '</span> at ' +
            esc(sim.load.point.what) + ', ' + esc(fmtLength(sim.load.point.y)) + ' up.'
        );
      } else {
        bits.push('Pushing <span class="qty">' + esc(fmtForce(force, unit)) + '</span>.');
      }
    }
    if (st.theta > 1e-4 && !st.fallen) {
      bits.push(
        'Leaning <span class="qty">' + fmt(tilt, 1) + '°</span> of the ' +
          fmt((b.thetaBalance * 180) / Math.PI, 1) + '° it can take.'
      );
    }
    if (!held && st.slide > 1e-3) {
      bits.push('Slid <span class="qty">' + esc(fmtLength(st.slide)) + '</span>.');
    }

    var el = $('sim-status');
    el.className = 'sim-status ' + (STATUS_CLASS[status] || '');
    el.innerHTML = bits.join(' ');

    /* The centre of gravity itself is bolted to the object; it is the plumb
     * line under it that walks out over the pivot, so that is what gets
     * reported. */
    var cogEl = $('sim-cog');
    if (st.fallen) {
      cogEl.className = 'sim-cog is-over';
      cogEl.innerHTML = 'Centre of gravity ended up outside the base — that is why it went.';
    } else {
      var cogNow = S.cog(b, st);
      cogEl.className = 'sim-cog' + (cogNow.insideBy >= 0 ? '' : ' is-over');
      cogEl.innerHTML = cogNow.insideBy >= 0
        ? 'Centre of gravity <span class="qty">' + esc(fmtLength(cogNow.insideBy)) +
          '</span> inside the pivot, lifted <span class="qty">' +
          esc(fmtLength(cogNow.rise)) + '</span> of the ' +
          esc(fmtLength(cogNow.riseToBalance)) + ' it has to climb.'
        : 'Centre of gravity <span class="qty">' + esc(fmtLength(-cogNow.insideBy)) +
          '</span> <em>past</em> the pivot — its own weight is pulling it over now.';
    }

    /* Announce only when the situation actually changes, not every frame — and
     * say it the way the visible line says it, which in LED mode is not the
     * pole wording and depends on where the load is being put on. */
    if (status !== sim.lastStatus) {
      sim.lastStatus = status;
      var said = bits[0] || '';
      var loadSaid = led && sim.load
        ? ' Load at ' + sim.load.point.what + ', ' + fmtLength(sim.load.point.y) + ' up.'
        : '';
      $('sim-announce').textContent = said + loadSaid;
      $('sim-canvas').setAttribute(
        'aria-label',
        'Simulation: ' + said + loadSaid + ' Leaning ' + fmt(tilt, 1) + ' degrees.'
      );
    }

    /* Bars share a scale, set by the righting moment when upright — so at the
     * tipping force the two are exactly level. Once it's on the floor the
     * moments stop meaning anything, so the comparison is dimmed out. */
    var balance = $('sim-balance');
    if (st.fallen) {
      balance.classList.add('is-done');
      $('bar-righting').style.width = '0%';
      $('bar-over').style.width = '0%';
      $('val-righting').textContent = '—';
      $('val-over').textContent = '—';
      return;
    }
    balance.classList.remove('is-done');

    var scale = Math.max(b.weight * b.d, m.overturning, m.righting, 1e-9) * 1.04;
    var righting = Math.max(0, m.righting + Math.max(0, m.slidingRelief));
    var pct = function (value) {
      return Math.round(Math.min(100, Math.max(0, (value / scale) * 100)) * 10) / 10 + '%';
    };
    $('bar-righting').style.width = pct(righting);
    $('bar-over').style.width = pct(m.overturning);
    $('val-righting').textContent = fmtMoment(righting);
    $('val-over').textContent = fmtMoment(m.overturning);
  }

  function simFrame(now) {
    var dt = sim.lastFrame ? (now - sim.lastFrame) / 1000 : 1 / 60;
    sim.lastFrame = now;

    var force = appliedForce();
    var held = simBaseHeld();
    S.advance(sim.body, sim.state, dt, force, held);
    drawSim(dt);
    renderSimReadouts();

    if (sim.dragForce == null && S.isIdle(sim.body, sim.state, force, held) && viewSettled()) {
      stopSimLoop();
      return;
    }
    sim.raf = requestAnimationFrame(simFrame);
  }

  function startSimLoop() {
    if (sim.raf != null) return;
    sim.lastFrame = 0;
    sim.raf = requestAnimationFrame(simFrame);
  }

  function stopSimLoop() {
    if (sim.raf != null) cancelAnimationFrame(sim.raf);
    sim.raf = null;
    sim.lastFrame = 0;
  }

  /* ------------------------------ dragging ----------------------------- */

  var DRAG_SPAN = 130; // pixels of drag for the full force range

  function canvasPoint(event) {
    var rect = $('sim-canvas').getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function dragTo(event) {
    var p = canvasPoint(event);
    sim.dragPoint = p;
    var view = simView();
    var push = bodyPoint(view, sim.body.pushPoint.x, sim.body.pushPoint.y);
    // pushing means dragging away from the pole, in the tipping direction
    var reach = Math.max(0, p.x - push.x);
    sim.dragForce = sim.maxForce * 1.6 * Math.min(1, reach / DRAG_SPAN);
  }

  function wireSim() {
    var canvas = $('sim-canvas');

    canvas.addEventListener('pointerdown', function (event) {
      if (event.button != null && event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-pushing');
      hideSimTip();
      dragTo(event);
      startSimLoop();
      event.preventDefault();
    });

    canvas.addEventListener('pointermove', function (event) {
      if (sim.dragForce == null) return;
      dragTo(event);
      event.preventDefault();
    });

    var endDrag = function (event) {
      if (sim.dragForce == null) return;
      sim.dragForce = null;
      sim.dragPoint = null;
      canvas.classList.remove('is-pushing');
      if (canvas.hasPointerCapture && event.pointerId != null &&
          canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      startSimLoop(); // let it settle
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    $('sim-apply').addEventListener('click', function () {
      hideSimTip();
      setApplying(!sim.applying);
      if (!sim.applying) startSimLoop();
    });

    $('sim-reset').addEventListener('click', function () {
      resetSim();
    });

    $('sim-force-input').addEventListener('input', function () {
      updateSimForceLabel();
      if (sim.applying) startSimLoop();
      else {
        drawSim();
        renderSimReadouts();
      }
    });

    $('sim-base-held').addEventListener('change', function () {
      startSimLoop();
    });

    /* Moving the load rebuilds the body and rescales the slider with it, so the
     * whole thing has to go back through update() rather than just redraw. */
    ['sim-push-where', 'sim-best-angle'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        resetSim();
        update();
      });
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        dropPalette();
        drawSim();
      }).observe(canvas);
    } else {
      window.addEventListener('resize', function () {
        dropPalette();
        drawSim();
      });
    }

    if (window.matchMedia) {
      var dark = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () {
        dropPalette();
        drawSim();
      };
      if (dark.addEventListener) dark.addEventListener('change', onScheme);
      else if (dark.addListener) dark.addListener(onScheme);
    }

    // no point animating an off-screen canvas
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopSimLoop();
      else if (sim.applying) startSimLoop();
    });
  }

  function hideSimTip() {
    if (!sim.hintShown) return;
    sim.hintShown = false;
    $('sim-tip').classList.add('is-hidden');
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
      ? fmtSig(P.fromBase(chosen.tipForce, forceUnit, P.FORCE_UNITS))
      : '—';

    $('out-force-note').textContent = isFinite(chosen.tipForce)
      ? 'Pushed ' + describeAngle(result.pushAngleDeg) + ' at ' +
        fmtLength(result.pushHeight) + ' above the ground, ' + chosen.hint + '.'
      : 'This push cannot tip it over at all.';

    if (isFinite(chosen.tipForce)) {
      $('out-force-equiv').innerHTML =
        'The same pull as <strong>' + esc(fmtMass(chosen.tipForce / P.G_STANDARD)) +
        '</strong> on a line — ' + esc(asHoist(chosen.tipForce, result.gravity) ||
          feelsLike(chosen.tipForce)) + '.';
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
   * LED wall mode
   * ------------------------------------------------------------------ */

  var lastLed = null;

  function speedUnit() {
    return unitSelect(fieldById('windSpeed')).value || 'm/s';
  }

  function fieldById(id) {
    for (var i = 0; i < ALL_FIELDS.length; i += 1) {
      if (ALL_FIELDS[i].id === id) return ALL_FIELDS[i];
    }
    return null;
  }

  function fmtSpeed(metresPerSecond, unit) {
    if (!isFinite(metresPerSecond)) return '—';
    var u = unit || speedUnit();
    return fmt(LW.fromBase(metresPerSecond, u, LW.SPEED_UNITS), 1) + ' ' + u;
  }

  /* Ballast arrives as discrete weights, so round up to something orderable
   * rather than quoting a figure to the gram. */
  function fmtPercentLabel(fraction) {
    if (!isFinite(fraction)) return '—';
    return fraction < 0.005 ? 'under 1%' : Math.round(fraction * 100) + '%';
  }

  function roundBallast(kg) {
    if (!isFinite(kg) || kg <= 0) return 0;
    var step = currentSystem === 'imperial' ? 4.5359237 : 5; // 10 lb or 5 kg
    return Math.ceil(kg / step) * step;
  }

  function readLedState() {
    var v = function (id) {
      return fieldBase(fieldById(id));
    };
    var scalar = function (id, fallback) {
      var n = parseFloat($(id).value);
      return isFinite(n) && n > 0 ? n : fallback;
    };

    var plateFront = v('plateFront');
    // centred means the plate reaches as far behind the truss as in front
    var plateBack = $('trussCentred').checked ? plateFront : v('plateBack');
    var state = {
      wallWidth: v('wallWidth'),
      wallHeight: v('wallHeight'),
      wallBottom: v('wallBottom'),
      wallDepth: v('wallDepth'),
      wallArealMass: v('wallArealMass'),

      wallOnGround: $('wallOnGround').checked,

      trussHeight: v('trussHeight'),
      trussDepth: v('trussDepth'),
      trussWidth: v('trussWidth'),
      trussLinearMass: v('trussLinearMass'),

      plateFront: plateFront,
      plateBack: plateBack,
      plateWidth: v('ledPlateWidth'),
      plateThickness: v('ledPlateThickness'),
      plateMass: v('ledPlateMass'),
      ballastMass: v('ballastMass'),

      windSpeed: v('windSpeed'),
      maxSpacing: v('maxSpacing'),
      maxLoadPerUpright: v('maxLoadPerUpright'),

      forceCoefficient: scalar('forceCoefficient', 1.3),
      trussForceCoefficient: scalar('trussForceCoefficient', 1.8),
      trussSolidity: scalar('trussSolidity', 0.3),
      safetyFactor: scalar('safetyFactor', 1.5),
      gravity: scalar('ledGravity', P.G_STANDARD)
    };

    /* Ballast stacked at the back rather than spread over the plate. Keep it
     * inside the plate, roughly a stack's width in from the rear edge. */
    if ($('ballastAtBack').checked && plateBack > 0) {
      state.ballastX = -Math.max(0, plateBack - 0.25);
    }

    var forced = parseFloat($('uprightsOverride').value);
    if (isFinite(forced) && forced >= 2) state.uprights = Math.round(forced);

    return state;
  }

  /* ----------------------------- the answer ---------------------------- */

  function renderLed(result) {
    if (!result.ok) {
      $('led-count').textContent = '—';
      $('led-note').textContent = '';
      $('led-governing').textContent = '';
      $('led-headline').innerHTML = '';
      $('out-badge').innerHTML = '';
      $('led-stats').innerHTML = '';
      $('led-cases').innerHTML = '';
      $('led-breakdown').innerHTML = '';
      $('led-working').textContent = 'Fill in the wall and the uprights to see the working.';
      $('out-notes').innerHTML = result.errors
        .map(function (e) {
          return '<li class="is-error">' + esc(e) + '</li>';
        })
        .join('');
      return;
    }

    var L = result.layout;

    /* When no count can satisfy a criterion there is no answer to quote, and
     * quoting the fallback count would be a lie. Which criterion it is decides
     * what to do about it, so say that rather than always blaming stability. */
    if (!result.countAchievable) {
      $('led-count').textContent = '—';
      $('led-count-unit').textContent = 'no number works';
      /* Two different ways to be impossible: the demand runs away as uprights
       * are added, or it is simply more than fit behind the wall. */
      var short = isFinite(result.blockedBy.wanted)
        ? 'It would take ' + result.blockedBy.wanted + ' and only ' +
          result.uprightsThatFit + ' fit behind the wall. '
        : '';
      $('led-note').innerHTML =
        result.blockedBy.id === 'stability'
          ? short +
            (short
              ? 'Reach further forward with the baseplates, or more ballast on each.'
              : 'Every upright added brings more exposed truss than it resists, so more of ' +
                'them makes it worse. Cut the uprights down closer to the wall, reach ' +
                'further forward, or move the ballast back.')
          : result.blockedBy.id === 'load'
            ? short + 'Raise the limit, use lighter panels, or narrower truss so more of ' +
              'them fit.'
            : short + 'Raise the spacing limit or use narrower truss.';
    } else {
      $('led-count').textContent = String(result.uprights);
      $('led-count-unit').textContent = result.uprights === 1 ? 'upright' : 'uprights';
      $('led-note').innerHTML =
        'across ' + esc(fmtLength(L.wallWidth)) + ' of wall — ' +
        (result.uprights > 1
          ? esc(fmtLength(result.spacing)) + ' between centres'
          : 'a single upright') +
        '. ' + (result.uprights > 2
          ? 'The worst-off one carries ' + esc(fmtMass(result.loadPerUpright))
          : 'Each carries ' + esc(fmtMass(result.loadPerUpright))) + '.';
    }

    $('led-governing').innerHTML = result.usingOverride
      ? 'You have set this by hand. The checks want <strong>' +
        result.minimumUprights + '</strong>.'
      : 'What decides it: <strong>' + esc(result.governingConstraint.label) + '</strong>.';

    var head = [];
    head.push(
      stat(
        'Good for',
        fmtSpeed(result.limitingWindSpeed),
        'with ' + fmt(result.safetyFactor, 2) + '× in hand'
      )
    );
    head.push(
      stat('Goes over at', fmtSpeed(result.tippingWindSpeed), 'no margin left')
    );
    var perBase = roundBallast(result.ballastNeededPerUpright);
    head.push(
      stat('Ballast each', fmtMass(perBase), 'you have entered ' + fmtMass(L.ballastMass))
    );
    head.push(stat('Ballast in total', fmtMass(perBase * result.uprights), 'across the run'));
    $('led-headline').innerHTML = head.join('');

    var ratio = result.worstRatio;
    if (!result.buildable) {
      $('out-badge').innerHTML =
        '<span class="badge badge--fail">Not buildable as drawn — see below</span>';
    } else {
      $('out-badge').innerHTML = result.passes
        ? '<span class="badge badge--pass">Stands up at ' +
          esc(fmtSpeed(result.windSpeed)) + ' — ' + fmt(ratio, 2) +
          '× against overturning</span>'
        : '<span class="badge badge--fail">Goes over at ' +
          esc(fmtSpeed(result.windSpeed)) + ' — only ' + fmt(ratio, 2) +
          '× against overturning, wanted ' + fmt(result.safetyFactor, 2) + '×</span>';
    }

    $('out-notes').innerHTML = result.warnings
      .map(function (w) {
        return '<li>' + esc(w) + '</li>';
      })
      .join('');

    renderLedStats(result);
    renderLedCases(result);
    renderLedBreakdown(result);
    renderLedWorking(result);
  }

  function renderLedStats(result) {
    var L = result.layout;
    var forceUnit = $('force-unit').value || 'N';
    var out = [];

    out.push(stat('Wall', fmt(L.area, 1) + ' m²', fmtLength(L.wallWidth) + ' × ' + fmtLength(L.wallHeight)));
    out.push(stat('Wall weight', fmtMass(L.wallMass), fmt(L.arealMass, 1) + ' kg/m²'));
    out.push(stat('Whole structure', fmtMass(result.totalMass), 'wall, truss, plates, ballast'));
    out.push(
      stat(
        'Wind at ' + fmtSpeed(result.windSpeed),
        fmtForce(result.windForce, forceUnit),
        'Beaufort ' + result.beaufort + ', ' + result.beaufortName
      )
    );
    out.push(stat('Wind pressure', fmt(result.windPressure, 1) + ' N/m²', 'half rho v squared'));
    out.push(
      stat(
        'Worst upright',
        fmtForce(result.windForcePerUpright, forceUnit),
        'its share of that wall load'
      )
    );
    if (L.wallCantilever > 1e-6) {
      out.push(
        stat(
          'Cantilever',
          fmtLength(L.wallCantilever),
          fmtMoment(result.cantileverMoment) + ' of bending at each upright top'
        )
      );
    } else {
      out.push(
        stat(
          'Wind on bare truss',
          fmtForce(result.trussWindForce, forceUnit),
          fmtPercentLabel(result.trussWindShare) + ' of the overturning'
        )
      );
    }
    out.push(
      stat('Wall hangs', fmtLength(L.wallX), 'in front of the truss centre')
    );
    out.push(
      stat(
        'Front lever arm',
        fmtLength(L.frontPivotX),
        L.pivotIsWallFoot ? 'centre to the wall’s footing' : 'centre to front edge'
      )
    );
    out.push(
      stat(
        'Spacing',
        fmtLength(result.spacing),
        'centres, over the ' + fmtLength(L.centreSpan) + ' between the end ones'
      )
    );
    $('led-stats').innerHTML = out.join('');
  }

  function renderLedCases(result) {
    var rows = result.cases
      .map(function (c) {
        var isWorst = c.id === result.governingCase.id;
        var ratio = c.moments.ratio;
        return (
          '<tr class="' + (isWorst ? 'is-current' : '') + '">' +
          '<td>' + esc(c.label) +
          (isWorst ? ' <span class="tag">governs</span>' : '') + '</td>' +
          '<td>' + esc(fmtMoment(c.moments.restoring)) + '</td>' +
          '<td>' + esc(fmtMoment(c.moments.overturning)) + '</td>' +
          '<td>' + (isFinite(ratio) ? fmt(ratio, 2) + '×' : '—') + '</td>' +
          '</tr>'
        );
      })
      .join('');
    $('led-cases').innerHTML = rows;
    $('led-case-note').textContent = result.governingCase.note
      ? result.governingCase.label + ': ' + result.governingCase.note + '.'
      : '';
  }

  function renderLedBreakdown(result) {
    var m = result.governingCase.moments;
    var rows = m.items
      .map(function (item) {
        var helping = item.moment >= 0;
        return (
          '<tr>' +
          '<td>' + esc(item.name) +
          (item.count > 1 ? ' <small>× ' + item.count + '</small>' : '') + '</td>' +
          '<td>' + esc(fmtMass(item.mass)) + '</td>' +
          '<td>' + esc(fmtLength(Math.abs(item.arm))) + (helping ? '' : ' out') + '</td>' +
          '<td>' + (helping ? '' : '−') + esc(fmtMoment(Math.abs(item.moment))) + '</td>' +
          '</tr>'
        );
      })
      .join('');
    var windRow =
      '<tr><td>wind on the wall</td><td>—</td><td>' +
      esc(fmtLength(m.windArm)) + ' up</td><td>−' +
      esc(fmtMoment(m.windMoment)) + '</td></tr>';
    $('led-breakdown').innerHTML = rows + (m.windMoment > 0 ? windRow : '');
  }

  function renderLedWorking(result) {
    var L = result.layout;
    var c = result.governingCase;
    var m = c.moments;
    var split = LW.momentSplit(L, m.dir);
    var lines = [];

    lines.push('Overturning check, worked in SI units, about the ' +
      (m.dir > 0 ? 'front' : 'rear') + ' edge of the baseplates.');
    lines.push('');
    lines.push('  wind pressure  q = 0.5 x ' + fmt(result.airDensity, 3) + ' x ' +
      fmt(result.windSpeed, 2) + '²  = ' + fmt(result.windPressure, 1) + ' N/m²');
    lines.push('  on the wall    F = q x ' + fmt(result.forceCoefficient, 2) + ' x ' +
      fmt(L.area, 2) + ' m²  = ' + fmt(result.windForce, 0) + ' N');
    lines.push('                     at ' + fmt(L.wallCentreHeight, 2) + ' m up  = ' +
      fmt(m.wallWindMoment, 0) + ' N·m');
    if (L.trussExposedLength > 1e-6) {
      lines.push('  on bare truss  F = q x ' + fmt(result.trussForceCoefficient, 2) + ' x ' +
        fmt(L.trussWindAreaPerUpright, 3) + ' m²  = ' +
        fmt(result.trussWindPerUpright, 0) + ' N each');
      lines.push('                     at ' + fmt(L.trussWindHeight, 2) + ' m up, x ' +
        result.uprights + '  = ' + fmt(m.trussWindMoment, 0) + ' N·m');
    }
    lines.push('  total wind moment  ' + fmt(m.windMoment, 0) + ' N·m');
    lines.push('');
    lines.push('  holding down   ' + fmt(m.restoring, 0) + ' N·m');
    lines.push('  pushing over   ' + fmt(m.overturning, 0) + ' N·m');
    lines.push('  ratio          ' +
      (isFinite(m.ratio) ? fmt(m.ratio, 2) : 'no overturning at all') +
      '  (wanted ' + fmt(result.safetyFactor, 2) + ')');
    lines.push('');
    lines.push('How many uprights:');
    lines.push('  each upright adds ' + fmt(split.perUpright.restoring - split.perUpright.overturning, 0) +
      ' N·m of holding down');
    lines.push('  the wall itself   ' + fmt(split.fixed.restoring - split.fixed.overturning, 0) +
      ' N·m (it does not change with the count)');
    lines.push('  n >= (' + fmt(result.safetyFactor, 2) + ' x ' +
      fmt(m.windMoment + split.fixed.overturning, 0) + ' − ' +
      fmt(split.fixed.restoring, 0) + ') / ' +
      fmt(split.perUpright.restoring - result.safetyFactor * split.perUpright.overturning, 0));
    lines.push('    = ' + result.byCase[c.id].uprightsNeeded + ' for this case');
    lines.push('');
    lines.push('  also at least ' + wants(result, 'spacing') + ' for the spacing limit, and ' +
      wants(result, 'load') + ' for the weight per upright.');
    lines.push('  at most ' + result.uprightsThatFit + ' fit behind the wall (' +
      fmt(L.wallWidth, 2) + ' / ' + fmt(L.trussWidth, 2) + ' m)');
    lines.push('  so ' + result.minimumUprights + ' uprights.');
    lines.push('');
    /* The one step someone is most likely to try to reproduce by hand, and the
     * reason the spacing is not simply the width over the bays. */
    lines.push('Setting out:');
    lines.push('  centres span  ' + fmt(L.wallWidth, 2) + ' − ' + fmt(L.trussWidth, 2) +
      ' = ' + fmt(L.centreSpan, 3) + ' m   (an upright width off, so none of it shows)');
    if (result.uprights > 1) {
      lines.push('  spacing       ' + fmt(L.centreSpan, 3) + ' / ' + (result.uprights - 1) +
        ' = ' + fmt(result.spacing, 3) + ' m');
    }
    lines.push('  first centre  ' + fmt(L.endInset, 3) + ' m in from the end of the wall');

    $('led-working').textContent = lines.join('\n');
  }

  /**
   * What one criterion asked for, in words when it asked for more than can ever
   * stand behind the wall — printing "Infinity uprights" is not an answer.
   */
  function wants(result, id) {
    var c = result.constraints.filter(function (k) {
      return k.id === id;
    })[0];
    if (!c) return '—';
    if (isFinite(c.n)) return String(c.n);
    return isFinite(c.wanted)
      ? c.wanted + ', more than the ' + result.uprightsThatFit + ' that fit'
      : 'more than any number of them can do';
  }

  /**
   * The dimensions a crew actually marks the deck out from, measured from the
   * left-hand end of the wall. Long runs get the ends and an ellipsis rather
   * than thirty numbers.
   */
  function settingOut(result) {
    var c = result.run.centres;
    var one = function (x) {
      return fmtLength(x);
    };
    if (c.length <= 10) return c.map(one).join(', ');
    return c.slice(0, 4).map(one).join(', ') + ', … , ' + one(c[c.length - 1]);
  }

  function ledSummaryText(result) {
    if (!result.ok) return result.errors.join(' ');
    var L = result.layout;
    var lines = [
      'LED wall on ground support — ' + result.uprights + ' uprights',
      '',
      'Wall: ' + fmtLength(L.wallWidth) + ' × ' + fmtLength(L.wallHeight) + ' (' +
        fmt(L.area, 1) + ' m²), ' + fmt(L.arealMass, 1) + ' kg/m² = ' + fmtMass(L.wallMass),
      'Bottom of wall ' + fmtLength(L.wallBottom) + ' above the ground, cabinets ' +
        fmtLength(L.wallDepth) + ' deep',
      'Uprights: ' + fmtLength(L.trussHeight) + ' of ' + fmt(L.trussLinearMass, 1) +
        ' kg/m truss, ' + fmtLength(L.trussDepth) + ' deep by ' +
        fmtLength(L.trussWidth) + ' across',
      'Baseplates: ' + fmtLength(L.plateFront) + ' in front, ' + fmtLength(L.plateBack) +
        ' behind, ' + fmtMass(L.plateMass) + ' each',
      '',
      'UPRIGHTS: ' + result.uprights + ' at ' + fmtLength(result.spacing) + ' centres',
      '  end ones set ' + fmtLength(L.endInset) + ' in so no truss shows past the wall',
      '  each carries ' + fmtLength(result.tributary) + ' of wall width',
      '  centres from the left end: ' + settingOut(result),
      '  decided by: ' + result.governingConstraint.label,
      '  spacing limit wants ' + wants(result, 'spacing') + ', weight per upright wants ' +
        wants(result, 'load') + ', stability wants ' + wants(result, 'stability'),
      '',
      'BALLAST: ' + fmtMass(result.ballastNeededPerUpright) + ' per baseplate (' +
        fmtMass(result.uprights * result.ballastNeededPerUpright) + ' in total)',
      '  entered: ' + fmtMass(L.ballastMass) + ' per baseplate',
      '',
      'Design wind ' + fmtSpeed(result.windSpeed) + ' (Beaufort ' + result.beaufort + ', ' +
        result.beaufortName + ')',
      'Wind force on the wall: ' + fmtForce(result.windForce, 'N'),
      'Good for: ' + fmtSpeed(result.limitingWindSpeed) + ' with the safety factor in hand',
      'Actually goes over at: ' + fmtSpeed(result.tippingWindSpeed),
      'Worst case: ' + result.governingCase.label + ', ' + fmt(result.worstRatio, 2) +
        '× against overturning (wanted ' + fmt(result.safetyFactor, 2) + '×)',
      'Load per upright: ' + fmtMass(result.loadPerUpright),
      'Whole structure: ' + fmtMass(result.totalMass)
    ];
    if (result.warnings.length) {
      lines.push('');
      result.warnings.forEach(function (w) {
        lines.push('Note: ' + w);
      });
    }
    lines.push('');
    lines.push('First-pass overturning check only — not a structural design.');
    return lines.join('\n');
  }

  /* ---------------------------- the drawings --------------------------- */

  /** One bay, side on: baseplate, ballast, truss, wall, wind. */
  function buildLedSideView(result) {
    var L = result.layout;
    // A bay is far taller than it is deep, so this view is portrait
    var VW = 250;
    var VH = 320;
    var padL = 54;
    var padR = 56;
    var padT = 22;
    var padB = 52;
    var dir = result.governingCase.moments.dir;

    var minX = -L.plateBack;
    var maxX = Math.max(L.frontPivotX, L.wallX + L.wallDepth / 2);
    var maxY = Math.max(L.trussHeight, L.wallTop);
    var scale = Math.min(
      (VW - padL - padR) / Math.max(maxX - minX, 1e-3),
      (VH - padT - padB) / Math.max(maxY, 1e-3)
    );

    var groundY = VH - padB;
    var originX = padL + (VW - padL - padR - (maxX - minX) * scale) / 2 - minX * scale;
    var X = function (x) {
      return originX + x * scale;
    };
    var Y = function (y) {
      return groundY - y * scale;
    };

    var parts = [];

    // ground
    parts.push(line(padL - 22, groundY, VW - 8, groundY, 'dg-ground'));
    for (var hx = padL - 16; hx < VW - 10; hx += 15) {
      parts.push(line(hx, groundY, hx - 7, groundY + 7, 'dg-hatch'));
    }

    var rect = function (x0, y0, x1, y1, cls) {
      var px = X(Math.min(x0, x1));
      var py = Y(Math.max(y0, y1));
      var w = Math.max(1.5, Math.abs(X(x1) - X(x0)));
      var h = Math.max(1.5, Math.abs(Y(y0) - Y(y1)));
      return tag('rect', { x: r1(px), y: r1(py), width: r1(w), height: r1(h), class: cls });
    };

    // baseplate, ballast, truss, wall
    parts.push(rect(-L.plateBack, 0, L.plateFront, L.plateThickness, 'dg-plate'));
    if (L.ballastMass > 0) {
      var half = Math.min(0.3, Math.max(0.1, L.plateDepth * 0.22));
      parts.push(
        rect(
          L.ballastX - half,
          L.plateThickness,
          L.ballastX + half,
          L.plateThickness + L.ballastHeight,
          'dg-ballast'
        )
      );
    }
    parts.push(
      rect(-L.trussDepth / 2, L.plateThickness, L.trussDepth / 2, L.trussHeight, 'dg-truss-fill')
    );
    parts.push(
      rect(L.trussDepth / 2, L.wallBottom, L.trussDepth / 2 + L.wallDepth, L.wallTop, 'dg-wall')
    );

    /* The wind is drawn blowing the way the governing case says, since that is
     * the direction the numbers are about. Forward means it arrives from
     * behind the structure and pushes it out over the front edge. */
    var windY = Y(L.wallCentreHeight);
    if (dir > 0) {
      var tailX = X(-L.plateBack) - 34;
      var tipX = X(-L.trussDepth / 2) - 4;
      parts.push(line(tailX, windY, tipX, windY, 'dg-wind'));
      parts.push(head(tipX, windY, 1, 0, 9, 'dg-force-fill'));
      parts.push(text(tailX - 3, windY - 6, 'wind', 'dg-label dg-label--force', 'end'));
    } else {
      var face = X(L.trussDepth / 2 + L.wallDepth);
      parts.push(line(face + 38, windY, face + 6, windY, 'dg-wind'));
      parts.push(head(face + 6, windY, -1, 0, 9, 'dg-force-fill'));
      parts.push(text(face + 42, windY - 6, 'wind', 'dg-label dg-label--force'));
    }

    /* Both baseplate edges can be the pivot; the one the governing case turns
     * about is filled in, the other is left hollow. */
    [
      { x: -L.plateBack, active: dir < 0, anchor: 'end', dx: -7 },
      { x: L.frontPivotX, active: dir > 0, anchor: 'start', dx: 7 }
    ].forEach(function (pivot) {
      var px = X(pivot.x);
      parts.push(
        tag('polygon', {
          points:
            r1(px) + ',' + r1(groundY) + ' ' + r1(px - 5) + ',' + r1(groundY + 8) + ' ' +
            r1(px + 5) + ',' + r1(groundY + 8),
          class: pivot.active ? 'dg-pivot' : 'dg-pivot-idle'
        })
      );
      if (pivot.active) {
        parts.push(
          text(px + pivot.dx, groundY - 6, 'pivot', 'dg-label dg-label--force', pivot.anchor)
        );
      }
    });

    /* How much lever arm the wall's own weight has about the working pivot —
     * on the forward case this is the whole ball game. */
    var wallCx = X(L.wallX);
    var pivotEdge = dir > 0 ? L.frontPivotX : -L.plateBack;
    var arm = Math.abs(pivotEdge - L.wallX);
    parts.push(line(wallCx, Y(L.wallBottom), wallCx, groundY + 18, 'dg-guide'));
    parts.push(line(X(pivotEdge), groundY, X(pivotEdge), groundY + 18, 'dg-guide'));
    var armY = groundY + 24;
    parts.push(
      dimension(wallCx, armY, X(pivotEdge), armY, true, function () {
        return text(
          (wallCx + X(pivotEdge)) / 2,
          armY + 13,
          'wall arm ' + fmtLength(arm),
          'dg-label dg-label--dim',
          'middle'
        );
      })
    );

    /* Where the wall carries on above the truss, show where the truss actually
     * stops — otherwise the two rectangles just look like one tall thing. */
    if (L.wallCantilever > 1e-6) {
      var topY = Y(L.trussHeight);
      parts.push(
        line(X(-L.trussDepth / 2) - 6, topY, X(L.trussDepth / 2 + L.wallDepth) + 6, topY, 'dg-guide')
      );
      parts.push(
        text(
          X(L.wallX),
          Y(L.wallTop) - 7,
          fmtLength(L.wallCantilever) + ' over the truss',
          'dg-label dg-label--force',
          'middle'
        )
      );
    }

    /* Label the two heights the drawing is built from. Without them there is
     * nothing on the picture that visibly answers to the height inputs. */
    parts.push(
      text(
        X(L.trussDepth / 2 + L.wallDepth) + 4,
        Y(L.wallTop) + 11,
        'LED ' + fmtLength(L.wallHeight),
        'dg-label dg-label--muted'
      )
    );
    parts.push(
      text(
        X(-L.trussDepth / 2) - 4,
        Y(L.trussHeight) - 4,
        'truss ' + fmtLength(L.trussHeight),
        'dg-label dg-label--muted',
        'end'
      )
    );
    // only when it is clear of the pivot label down at ground level
    if (L.wallBottom > 1e-6 && groundY - Y(L.wallBottom) > 16) {
      parts.push(
        text(
          X(L.trussDepth / 2 + L.wallDepth) + 4,
          Y(L.wallBottom) - 2,
          fmtLength(L.wallBottom) + ' up',
          'dg-label dg-label--muted'
        )
      );
    }

    return tag(
      'svg',
      {
        viewBox: '0 0 ' + VW + ' ' + VH,
        role: 'img',
        'aria-label':
          'One bay side on: a ' + fmtLength(L.wallHeight) + ' tall wall on the front of a ' +
          fmtLength(L.trussHeight) + ' upright, on a baseplate reaching ' +
          fmtLength(L.plateFront) + ' forward and ' + fmtLength(L.plateBack) + ' back.',
        xmlns: 'http://www.w3.org/2000/svg'
      },
      parts.join('')
    );
  }

  /** The wall from the front, with the uprights spaced behind it. */
  function buildLedFrontView(result) {
    var L = result.layout;
    var n = result.uprights;
    var VW = 360;
    var VH = 170;
    var pad = 26;
    var padB = 34;

    var worldW = Math.max(L.wallWidth, 1e-3);
    var worldH = Math.max(L.wallTop, L.trussHeight, 1e-3);
    var scale = Math.min((VW - 2 * pad) / worldW, (VH - pad - padB) / worldH);
    var groundY = VH - padB;
    var originX = (VW - worldW * scale) / 2;
    var X = function (x) {
      return originX + x * scale;
    };
    var Y = function (y) {
      return groundY - y * scale;
    };

    var parts = [];
    parts.push(line(10, groundY, VW - 10, groundY, 'dg-ground'));

    /* Uprights behind the wall, tucked in at the ends so their outer faces
     * line up with the ends of the wall rather than straddling them. */
    var trussW = Math.max(2, L.trussWidth * scale);
    var centres = result.run.centres;

    /* Both ends worked from the same rounded edges the wall is drawn to. A thin
     * upright gets drawn at a 2 px minimum, which centred on its true position
     * would poke out past the end of the wall — in the one drawing meant to show
     * that it does not — and rounding each rect on its own would leave a tenth
     * of a pixel showing even when the geometry is exact. */
    var wallL = r1(X(0));
    var wallR = r1(X(L.wallWidth));

    for (var i = 0; i < n; i += 1) {
      var x = centres[i] == null ? L.wallWidth / 2 : centres[i];
      var left = i === 0
        ? wallL
        : i === n - 1
          ? wallR - r1(trussW)
          : r1(X(x) - trussW / 2);
      parts.push(
        tag('rect', {
          x: left,
          y: r1(Y(L.trussHeight)),
          width: r1(trussW),
          height: r1(groundY - Y(L.trussHeight)),
          class: 'dg-truss-fill'
        })
      );
      // baseplate footprint
      var bw = Math.max(3, L.plateWidth * scale);
      parts.push(
        tag('rect', {
          x: r1(X(x) - bw / 2),
          y: r1(groundY - 3),
          width: r1(bw),
          height: 5,
          class: 'dg-ballast'
        })
      );
    }

    // the wall itself, over the top
    parts.push(
      tag('rect', {
        x: wallL,
        y: r1(Y(L.wallTop)),
        width: r1(wallR - wallL),
        height: r1(Math.max(2, (L.wallTop - L.wallBottom) * scale)),
        class: 'dg-wall',
        opacity: 0.9
      })
    );

    // spacing dimension between the first two upright centres
    if (n > 1 && result.ok && result.countAchievable) {
      var x0 = X(centres[0]);
      var x1 = X(centres[1]);
      var dimY = groundY + 16;
      parts.push(
        dimension(x0, dimY, x1, dimY, true, function () {
          return text(
            (x0 + x1) / 2,
            dimY + 12,
            fmtLength(result.spacing),
            'dg-label dg-label--dim',
            'middle'
          );
        })
      );
    }

    /* Only state a count when there is one to state — asserting "6 uprights"
     * next to an answer panel showing a dash is worse than saying nothing. */
    var caption = !result.ok
      ? 'geometry not valid — see the notes above'
      : !result.countAchievable
        ? 'no upright count works — see the notes above'
        : n + (n === 1 ? ' upright' : ' uprights') + ' across ' + fmtLength(L.wallWidth);
    parts.push(text(VW / 2, 16, caption, 'dg-label', 'middle'));

    return tag(
      'svg',
      {
        viewBox: '0 0 ' + VW + ' ' + VH,
        role: 'img',
        'aria-label': caption + ', behind a ' + fmtLength(L.wallWidth) + ' by ' +
          fmtLength(L.wallHeight) + ' wall' +
          (result.ok && result.countAchievable && n > 1
            ? ', spaced ' + fmtLength(result.spacing) + ' apart.'
            : '.'),
        xmlns: 'http://www.w3.org/2000/svg'
      },
      parts.join('')
    );
  }

  /* -------------------------- the simulation --------------------------- */

  /**
   * The whole run as one rigid body tipping forward over the line of the
   * baseplate front edges — which is the global check the numbers describe.
   */
  /**
   * Where a load can be put on the structure, and what each place is worth.
   *
   * Wind is spread over the whole face, so its resultant acts at the middle of
   * the wall and there is nothing to choose about it. A point load can go
   * anywhere, and since the overturning moment is the force times the height it
   * acts at, the higher it goes the less of it is needed — so the easiest place
   * to tip the thing from is the highest point of the whole assembly. That is
   * the top of the truss when the uprights stand above the wall, and the top of
   * the wall when the wall stands above them.
   */
  function ledLoadPoints(L) {
    var overTop = L.trussHeight >= L.wallTop;
    return {
      wind: {
        id: 'wind',
        x: L.wallX,
        y: L.wallCentreHeight,
        what: 'the middle of the wall'
      },
      top: {
        id: 'top',
        x: overTop ? 0 : L.wallX,
        y: overTop ? L.trussHeight : L.wallTop,
        what: overTop ? 'the top of the truss' : 'the top of the wall'
      }
    };
  }

  /**
   * The angle that gets the most out of a given force, measured the way the
   * rest of the app measures push angles: negative is tilted upwards.
   *
   * The lever the force works through is `R·sin(γ − θ)`, which is largest when
   * the force is square to the line from the pivot to the hand — so aim across
   * that line rather than along it. It is worth almost nothing when pushing
   * high, where that line is nearly vertical already, and a great deal when
   * pushing low.
   */
  function bestPushAngleDeg(L, point) {
    var reach = Math.max(L.frontPivotX - point.x, 1e-6);
    return (-Math.atan2(reach, Math.max(point.y, 1e-6)) * 180) / Math.PI;
  }

  function ledLoadChoice(result) {
    var points = ledLoadPoints(result.layout);
    var where = $('sim-push-where').value === 'top' ? points.top : points.wind;
    var isWind = where.id === 'wind';
    var best = bestPushAngleDeg(result.layout, where);
    return {
      points: points,
      point: where,
      isWind: isWind,
      bestAngleDeg: best,
      angleDeg: !isWind && $('sim-best-angle').checked ? best : 0
    };
  }

  /**
   * What the choice of where to push is actually buying, in force.
   *
   * Both figures are the force that just starts it moving, from the two places
   * a load can go — so the ratio between them is the leverage, and it is the
   * whole reason the answer to "where is best" is "as high as you can reach".
   */
  function loadComparison(result, load) {
    var square = function (point) {
      return S.onsetForce(ledSimBody(result, { point: point, angleDeg: 0 }));
    };
    var best = S.onsetForce(
      ledSimBody(result, { point: load.point, angleDeg: load.bestAngleDeg })
    );
    var here = square(load.point);
    return {
      wind: square(load.points.wind),
      top: square(load.points.top),
      here: here,
      atBestAngle: best,
      angleSaving: here > 0 ? 1 - best / here : 0
    };
  }

  function updateLoadHint(result) {
    var L = result.layout;
    var load = sim.load;
    var c = loadComparison(result, load);
    var unit = $('force-unit').value || 'N';

    /* Wind arrives at whatever angle it arrives at, so offering to aim it is
     * meaningless — the choice only exists for a load someone is applying. */
    $('sim-best-angle').parentNode.hidden = load.isWind;
    $('sim-best-angle-label').textContent =
      'At the best angle (' + fmt(Math.abs(load.bestAngleDeg), 1) + '° above level)';

    /* The angle is worth almost nothing when pushing high and a great deal when
     * pushing low, which is the part of it worth knowing. */
    var lowPoint = { x: L.wallX, y: Math.max(L.wallBottom, 0.05) };
    var lowSquare = S.onsetForce(ledSimBody(result, { point: lowPoint, angleDeg: 0 }));
    var lowBest = S.onsetForce(
      ledSimBody(result, { point: lowPoint, angleDeg: bestPushAngleDeg(L, lowPoint) })
    );

    var bits = [];
    if (load.isWind) {
      bits.push(
        'Spread over the face, so it comes to one push at ' + load.points.wind.what + ', ' +
          fmtLength(load.points.wind.y) + ' up: ' + fmtForce(c.wind, unit) +
          ' starts it moving.'
      );
      bits.push(
        'At ' + load.points.top.what + ', ' + fmtLength(load.points.top.y) +
          ' up, the same job takes ' + fmtForce(c.top, unit) + ' — ' +
          fmtPercentLabel(c.top / c.wind) + ' of it. For a level push the arm is simply the ' +
          'height it acts at, so that is the ratio of the two heights and nothing more. Wind ' +
          'gets no say in either, which is rather the point of it.'
      );
    } else {
      bits.push(
        load.points.top.what.charAt(0).toUpperCase() + load.points.top.what.slice(1) + ', ' +
          fmtLength(load.points.top.y) + ' up — the most leverage on the structure: ' +
          fmtForce(c.top, unit) + ' does what ' + fmtForce(c.wind, unit) + ' of wind has to.'
      );
      bits.push(
        'Nothing standing on the ground reaches up there, mind: it takes a line to a ' +
          'pull-lift, a suspended load swinging in, or the boom of a telehandler.'
      );
      bits.push(
        'Best angle is ' + fmt(Math.abs(load.bestAngleDeg), 1) + '° above level, worth ' +
          fmtPercentLabel(c.angleSaving) + ' — aim hardly matters this high up. Down at the ' +
          'bottom of the wall the same trick saves ' +
          fmtPercentLabel(lowSquare > 0 ? 1 - lowBest / lowSquare : 0) + '.'
      );
      bits.push(
        'The force halves but the work does not: the centre of gravity still has to climb ' +
          'the same ' + fmtLength(sim.body ? S.cog(sim.body, S.makeState()).riseToBalance : 0) +
          ', so it takes twice the travel.'
      );
    }

    $('sim-where-hint').textContent = bits.join(' ');
  }

  function ledSimBody(result, load) {
    var L = result.layout;
    var n = result.uprights;
    var t = L.plateThickness;

    var shapes = [
      { x0: -L.plateBack, y0: 0, x1: L.plateFront, y1: t, role: 'plate' },
      { x0: -L.trussDepth / 2, y0: t, x1: L.trussDepth / 2, y1: L.trussHeight, role: 'pole' },
      {
        x0: L.trussDepth / 2,
        y0: L.wallBottom,
        x1: L.trussDepth / 2 + L.wallDepth,
        y1: L.wallTop,
        role: 'wall'
      }
    ];
    if (L.ballastMass > 0) {
      var half = Math.min(0.3, Math.max(0.1, L.plateDepth * 0.22));
      shapes.push({
        x0: L.ballastX - half,
        y0: t,
        x1: L.ballastX + half,
        y1: t + L.ballastHeight,
        role: 'ballast'
      });
    }

    return S.makeBodyFromParts({
      g: L.g,
      // a ballasted steel plate on a hard floor; sliding is not the interesting
      // failure here, so it is held unless the user says otherwise
      mu: 0.6,
      pushAngleDeg: load.angleDeg,
      pivotX: L.frontPivotX,
      parts: [
        {
          mass: L.wallMass,
          x: L.wallX,
          y: L.wallCentreHeight,
          icm: (L.wallMass * (L.wallHeight * L.wallHeight + L.wallDepth * L.wallDepth)) / 12
        },
        {
          mass: n * L.trussMass,
          x: 0,
          y: t + L.trussHeight / 2,
          icm: (n * L.trussMass * L.trussHeight * L.trussHeight) / 12
        },
        {
          mass: n * L.plateMass,
          x: L.plateCentroidX,
          y: t / 2,
          icm: (n * L.plateMass * (L.plateDepth * L.plateDepth + t * t)) / 12
        },
        {
          mass: n * L.ballastMass,
          x: L.ballastX,
          y: t + L.ballastHeight / 2,
          icm: 0
        }
      ],
      shapes: shapes,
      push: { x: load.point.x, y: load.point.y }
    });
  }

  /* ------------------------------------------------------------------ *
   * Main update cycle
   * ------------------------------------------------------------------ */

  var lastResult = null;

  function update() {
    if (currentMode === 'led') {
      updateLed();
      return;
    }
    updatePole();
  }

  function updatePole() {
    var atTop = $('pushAtTop').checked;
    $('pushHeight').disabled = atTop;
    $('pushHeight-unit').disabled = atTop;

    var frictionOn = $('checkSliding').checked;
    $('friction').disabled = !frictionOn;
    $('friction-preset').disabled = !frictionOn;

    var state = readState();
    var result = holdForBlanks(P.solve(state), FIELDS);
    lastResult = result;

    // when the push is pinned to the top of the pole, show what that height is
    if (atTop) {
      setFieldBase(PUSH_HEIGHT_FIELD, result.poleTop);
    }

    var forceUnit = $('force-unit').value || 'N';

    renderAnswer(result, forceUnit);
    renderStats(result, forceUnit);
    renderCompare(result, forceUnit);
    renderWorking(result);

    /* Hand the new geometry to the simulation and redraw it. It keeps its
     * pose, so you can nudge an input mid-lean and watch the balance shift. */
    setSimBody(result);
    renderSimReadouts();
    if (sim.raf == null) drawSim();
    $('diagram-side').innerHTML = buildSideView(result);
    $('diagram-plan').innerHTML = buildPlanView(result);
    // a corner push tips about a corner, so the side view is a slice taken
    // along the diagonal — worth saying, or the plate looks too wide
    $('diagram-side-caption').textContent = result.chosen.id === 'corner'
      ? 'Sliced along the diagonal, roughly to scale'
      : 'Side on, roughly to scale';

    save();
  }

  function updateLed() {
    var centred = $('trussCentred').checked;
    $('plateBack').disabled = centred;
    $('plateBack-unit').disabled = centred;

    var state = readLedState();
    var result = holdForBlanks(LW.solve(state), LED_FIELDS);
    lastLed = result;

    renderLed(result);

    /* With the truss centred, show what the mirrored figure works out to
     * rather than leaving a stale number in the disabled field. */
    if (centred) setFieldBase(fieldById('plateBack'), state.plateFront);

    var L0 = result.layout;

    /* The exposed truss is why upright height matters at all — its own weight
     * helps a little, its wind load hurts a lot more. */
    var exposed = L0.trussExposedLength;
    var trussHint;
    if (L0.wallCantilever > 1e-6) {
      trussHint = 'Shorter than the wall: ' + fmtLength(L0.wallCantilever) +
        ' of it stands above the uprights, carried by the wall\u2019s own frame. ' +
        'No truss is catching wind, but the connection at the top takes ' +
        fmtMoment(result.cantileverMoment) + ' of bending.';
    } else if (exposed > 1e-6) {
      trussHint = fmtLength(exposed) + ' of upright is out in the wind, past the wall — ' +
        fmt(L0.trussWindAreaPerUpright, 2) + ' m² of metal each, ' +
        fmtPercentLabel(result.trussWindShare) + ' of the overturning.';
    } else {
      trussHint = 'The wall covers the whole upright, so none of it is catching wind.';
    }
    $('truss-wind-hint').textContent = trussHint;

    /* Whether the run is actually out of sight, which is the point of setting
     * the ends in. Sideways is handled; up and down are down to the heights. */
    var show = result.showing;
    var widthHint;
    if (L0.tooNarrowToHide) {
      widthHint = 'Wider than the wall itself, so it cannot be hidden behind it.';
    } else {
      var still = [];
      if (show.above > 1e-6) still.push(fmtLength(show.above) + ' of upright above the wall');
      if (show.below > 1e-6) still.push(fmtLength(show.below) + ' below it');
      /* Floor level, and normally dressed out — worth saying, not worth a
       * warning, which is why it lives here rather than in the notes. */
      if (show.plateEnds > 1e-6) {
        still.push('the baseplates by ' + fmtLength(show.plateEnds) + ' at each end');
      }
      if (show.plateToe > 1e-6) {
        still.push(fmtLength(show.plateToe) + ' of plate out in front of the wall');
      }
      widthHint = 'End uprights set ' + fmtLength(L0.endInset) +
        ' in from the ends of the wall, so their outer faces line up with it and no ' +
        'truss shows past the sides — flush dead ahead, though its back face is ' +
        fmtLength(L0.trussDepth + L0.wallDepth) + ' behind the wall, so it edges back into ' +
        'view as you walk round. ' +
        (still.length
          ? 'Still in sight: ' + still.join(', ') + '. '
          : 'Nothing of it shows from the front. ') +
        'The run wants ' + fmtLength(show.footprint) + ' of floor.';
    }
    $('truss-width-hint').textContent = widthHint;

    /* What the entered height actually resolved to, and why. */
    var bottomHint = '';
    if (L0.wallBottomRaised) {
      bottomHint = 'Raised to ' + fmtLength(L0.wallBottom) +
        ' — the baseplate runs under the wall, so it cannot start any lower than the top ' +
        'of the plate. That leaves the same amount of upright showing under the wall, and ' +
        'the only way to close it is to pull the plate back behind the truss face — which ' +
        'is the very reach that stops the thing tipping forward. It is a trade, not an ' +
        'oversight.';
    } else if (L0.restsOnPlate) {
      bottomHint = 'Sitting right on the baseplate.';
    } else if (L0.wallBottom > 1e-9) {
      bottomHint = fmtLength(L0.wallBottom) + ' of clear air under the wall.';
    } else {
      bottomHint = 'Down on the ground — nothing of the baseplate reaches under it.';
    }
    $('wall-bottom-hint').textContent = bottomHint;

    /* What bearing is buying, which is often nothing. Note there is no
     * "on the ground but no difference" case: reaching the ground at all means
     * the plate stops short of the wall, so the wall's footing is always the
     * outermost contact. */
    var bearingHint = '';
    if (!L0.wallOnGround) {
      bearingHint = 'The truss carries the whole wall.';
    } else if (L0.bearsOnGround) {
      bearingHint = 'It reaches the ground ' + fmtLength(L0.wallFootX) +
        ' forward, past the baseplate, so that footing is now the edge it tips about — ' +
        'every lever arm gains ' + fmtLength(L0.wallFootX - L0.plateFront) + '.';
    } else if (L0.bearsOnPlate) {
      bearingHint = 'It bears on the baseplate, which is part of the same structure — ' +
        'so no change to overturning, though it does take load and bending out of the truss.';
    } else {
      bearingHint = 'Nothing under it to bear on: bring the bottom of the wall down first.';
    }
    $('wall-bearing-hint').textContent = bearingHint;

    var offset = Math.abs(L0.plateCentroidX);
    $('plate-depth-hint').textContent = L0.plateDepth > 0
      ? fmtLength(L0.plateDepth) + ' deep overall' +
        (offset > 1e-6
          ? ', with the truss ' + fmtLength(offset) + ' forward of the plate\u2019s centre'
          : ', truss on the centre')
      : '';

    // running totals that belong next to the inputs
    $('wall-total-hint').textContent = result.layout.wallMass > 0
      ? fmt(result.layout.area, 1) + ' m² of wall, so ' + fmtMass(result.layout.wallMass) +
        ' in panels alone.'
      : '';
    /* The land description is how anyone without an anemometer actually reads
     * the wind, and the gust note matters more than any of it: a forecast
     * quotes a mean, the structure feels the gust, and force goes as the
     * square — so a 1.5x gust is 2.25x the load. */
    $('wind-hint').textContent = result.windSpeed > 0
      ? 'Beaufort ' + result.beaufort + ', ' + result.beaufortName + ' — ' +
        (LW.BEAUFORT_SIGNS[result.beaufort] || '') + '. ' +
        fmt(LW.fromBase(result.windSpeed, 'mph', LW.SPEED_UNITS), 0) + ' mph, ' +
        fmt(LW.fromBase(result.windSpeed, 'km/h', LW.SPEED_UNITS), 0) + ' km/h. ' +
        'Put the gust in here, not the forecast average — gusts run about 1.4 to 1.6 times ' +
        'the mean, and that is twice the load.'
      : 'Still air.';

    /* Drawn even when an input is out of range — a frozen picture beside a
     * changed number reads as the app being broken, and seeing the wall poke
     * out above a too-short upright is the clearest way to show the problem.
     * The builders all clamp degenerate geometry themselves. */
    $('diagram-led-side').innerHTML = buildLedSideView(result);
    $('diagram-led-front').innerHTML = buildLedFrontView(result);

    /* 100% on the slider is the force that just starts this body moving, so the
     * "just under holds, just over goes" trick works the same way in both modes
     * and wherever the load is put on. It is a shade above the answer panel's
     * tipping wind, because that figure also counts the wind on the bare truss
     * and this is a single push on the wall. */
    var load = ledLoadChoice(result);
    sim.body = ledSimBody(result, load);
    sim.load = load;
    sim.maxForce = Math.max(S.onsetForce(sim.body), 1);
    sim.state.theta = Math.min(sim.state.theta, sim.body.thetaEnd);
    if (sim.state.theta < sim.body.thetaEnd) sim.state.fallen = false;
    updateLoadHint(result);
    updateSimChrome();
    updateSimForceLabel();
    renderSimReadouts();
    if (sim.raf == null) drawSim();

    save();
  }

  /* --------------------------- switching modes ------------------------- */

  function applyModeChrome() {
    document.body.setAttribute('data-mode', currentMode);
    setChecked('calc-mode', currentMode);

    // the simulation panel means something different in each mode
    $('sim-heading').textContent = currentMode === 'led' ? 'Blow it over' : 'Give it a push';
    updateSimChrome();
    var heldLabel = $('sim-base-held').parentNode.querySelector('span');
    if (heldLabel) {
      heldLabel.textContent = currentMode === 'led'
        ? "Baseplates held, so they can't slide away"
        : "Base held, so it can't slide away";
    }

  }

  function setMode(mode) {
    currentMode = mode === 'led' ? 'led' : 'pole';
    applyModeChrome();
    resetSim();
    update();
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */

  var toastTimer = null;

  /**
   * A message, optionally with something to do about it.
   *
   * An action gets a longer dwell — an undo you cannot reach in time is not an
   * undo — and is the reason Reset needs no confirmation dialogue: it is
   * cheaper to build and much better to use than being asked twice.
   */
  function toast(message, action) {
    var el = $('toast');
    el.textContent = message;
    if (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', function () {
        clearTimeout(toastTimer);
        el.classList.remove('is-shown');
        action.run();
      });
      el.appendChild(btn);
    }
    el.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-shown');
    }, action ? 9000 : 2200);
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
    ALL_FIELDS.forEach(function (field) {
      $(field.id).addEventListener('input', update);
      var sel = unitSelect(field);
      sel.setAttribute('data-prev', sel.value);
      sel.addEventListener('change', function () {
        onUnitChanged(field, sel);
        update();
      });
    });

    ALL_SCALARS.forEach(function (s) {
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

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="calc-mode"]'),
      function (el) {
        el.addEventListener('change', function () {
          setMode(el.value);
        });
      }
    );

    $('wallOnGround').addEventListener('change', update);
    $('trussCentred').addEventListener('change', update);
    $('ballastAtBack').addEventListener('change', update);
    $('uprightsOverride').addEventListener('input', update);

    /* The presets write into the real fields, in whatever unit those are
     * showing, then reset themselves so they read as an action not a state. */
    $('panel-preset').addEventListener('change', function () {
      if (!this.value) return;
      setFieldBase(fieldById('wallArealMass'), Number(this.value));
      this.value = '';
      update();
    });

    $('truss-preset').addEventListener('change', function () {
      if (!this.value) return;
      var parts = this.value.split('|');
      setFieldBase(fieldById('trussLinearMass'), Number(parts[0]));
      /* The presets are all box truss, which is square: a 300 mm box is
       * 300 mm both ways. Anything else has to be typed in. */
      setFieldBase(fieldById('trussDepth'), Number(parts[1]));
      setFieldBase(fieldById('trussWidth'), Number(parts[1]));
      this.value = '';
      update();
    });

    $('cf-preset').addEventListener('change', function () {
      if (!this.value) return;
      $('forceCoefficient').value = this.value;
      this.value = '';
      update();
    });

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
      /* Captured before anything is cleared: a short query that puts every
       * field back exactly where it was, since defaults are what it is
       * measured against and defaults are what a reset lands on. */
      var before = serialize();
      applyDefaults(currentSystem);
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      update();
      resetSim();
      toast('Back to the example', {
        label: 'Undo',
        run: function () {
          deserialize(before);
          applyModeChrome();
          update();
          resetSim();
          toast('Put back');
        }
      });
    });

    $('btn-share').addEventListener('click', function () {
      var query = serialize();
      history.replaceState(null, '', '#' + query);
      copyText(location.href, 'Link copied');
    });

    $('btn-copy').addEventListener('click', function () {
      if (currentMode === 'led') {
        if (!lastLed) return;
        copyText(ledSummaryText(lastLed), 'Summary copied');
        return;
      }
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
  populateLedPresets();
  applyDefaults('metric');
  restore();
  applyModeChrome();
  wire();
  wireSim();
  update();

  /* The canvas has no size until layout has run, so draw once more after it
   * settles rather than into a zero-width box. */
  requestAnimationFrame(function () {
    dropPalette();
    drawSim();
  });
})();
