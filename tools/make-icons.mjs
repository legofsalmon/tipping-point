/*
 * Generates the app icons.
 *
 *   node tools/make-icons.mjs
 *
 * There's no image library in play here, so this rasterises the artwork by
 * supersampling a tiny scene description and writes the PNGs by hand.
 * Re-run it if you change the artwork; the output is committed.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlacing

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 for every scanline
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------------------------------------------- artwork */

const BG_COLOUR = [0x14, 0x18, 0x20, 255];
const PLATE_COLOUR = [0xe7, 0xea, 0xee, 255];
const POLE_COLOUR = [0xff, 0x8a, 0x3d, 255];

// Geometry in a 0..1 box, y downwards.
const PLATE_BOX = { x0: 0.185, y0: 0.695, x1: 0.815, y1: 0.775, r: 0.03 };
const POLE = { base: [0.5, 0.715], lengthUnit: 0.47, halfWidth: 0.043, tiltDeg: 21 };

const tilt = (POLE.tiltDeg * Math.PI) / 180;
const POLE_DIR = [Math.sin(tilt), -Math.cos(tilt)];
const POLE_PERP = [-POLE_DIR[1], POLE_DIR[0]];

/* A rounded rect is every point within `r` of the rect shrunk by `r`, so
 * clamping into that inner rect and measuring the distance is the whole
 * test — corners included. */
function insideRoundedRect(x, y, box) {
  const { x0, y0, x1, y1, r } = box;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insidePole(x, y) {
  const px = x - POLE.base[0];
  const py = y - POLE.base[1];
  const along = px * POLE_DIR[0] + py * POLE_DIR[1];
  const across = px * POLE_PERP[0] + py * POLE_PERP[1];
  return along >= 0 && along <= POLE.lengthUnit && Math.abs(across) <= POLE.halfWidth;
}

/**
 * @param {number} x 0..1
 * @param {number} y 0..1
 * @param {object} opts contentScale — shrink the artwork for maskable safe
 *   zones; bleed — fill the whole square rather than a rounded tile.
 */
function shade(x, y, opts) {
  const inBackground = opts.bleed
    ? true
    : insideRoundedRect(x, y, { x0: 0, y0: 0, x1: 1, y1: 1, r: 0.225 });
  if (!inBackground) return [0, 0, 0, 0];

  // map the pixel back through the content scaling
  const s = opts.contentScale;
  const cx = 0.5 + (x - 0.5) / s;
  const cy = 0.5 + (y - 0.5) / s;

  if (insidePole(cx, cy)) return POLE_COLOUR;
  if (insideRoundedRect(cx, cy, PLATE_BOX)) return PLATE_COLOUR;
  return BG_COLOUR;
}

function render(size, opts) {
  const samples = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          const c = shade(x, y, opts);
          const alpha = c[3] / 255;
          r += c[0] * alpha; // premultiplied, so edges blend cleanly
          g += c[1] * alpha;
          b += c[2] * alpha;
          a += alpha;
        }
      }
      const n = samples * samples;
      const i = (py * size + px) * 4;
      const outA = a / n;
      // back out of premultiplication
      rgba[i] = outA > 0 ? Math.round(r / n / outA) : 0;
      rgba[i + 1] = outA > 0 ? Math.round(g / n / outA) : 0;
      rgba[i + 2] = outA > 0 ? Math.round(b / n / outA) : 0;
      rgba[i + 3] = Math.round(outA * 255);
    }
  }
  return encodePng(size, size, rgba);
}

/* ------------------------------------------------------------------ SVG */

function svg() {
  const tipX = POLE.base[0] + POLE_DIR[0] * POLE.lengthUnit;
  const tipY = POLE.base[1] + POLE_DIR[1] * POLE.lengthUnit;
  const hx = POLE_PERP[0] * POLE.halfWidth;
  const hy = POLE_PERP[1] * POLE.halfWidth;
  const pts = [
    [POLE.base[0] + hx, POLE.base[1] + hy],
    [tipX + hx, tipY + hy],
    [tipX - hx, tipY - hy],
    [POLE.base[0] - hx, POLE.base[1] - hy]
  ]
    .map(([x, y]) => `${(x * 512).toFixed(1)},${(y * 512).toFixed(1)}`)
    .join(' ');

  const p = PLATE_BOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Tipping Point">
  <rect width="512" height="512" rx="115" fill="#14181f"/>
  <polygon points="${pts}" fill="#ff8a3d"/>
  <rect x="${(p.x0 * 512).toFixed(1)}" y="${(p.y0 * 512).toFixed(1)}" width="${((p.x1 - p.x0) * 512).toFixed(1)}" height="${((p.y1 - p.y0) * 512).toFixed(1)}" rx="${(p.r * 512).toFixed(1)}" fill="#e7eaee"/>
</svg>
`;
}

/* ----------------------------------------------------------------- write */

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, { contentScale: 1, bleed: false }],
  ['icon-512.png', 512, { contentScale: 1, bleed: false }],
  // maskable icons get cropped to a circle on some launchers, so the artwork
  // has to sit inside the middle 80%
  ['icon-maskable-512.png', 512, { contentScale: 0.78, bleed: true }],
  // iOS applies its own mask and dislikes transparency
  ['apple-touch-icon.png', 180, { contentScale: 0.92, bleed: true }]
];

for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT, name), render(size, opts));
  console.log('wrote icons/%s (%dx%d)', name, size, size);
}

writeFileSync(join(OUT, 'icon.svg'), svg());
console.log('wrote icons/icon.svg');
