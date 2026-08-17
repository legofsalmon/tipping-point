/*
 * Bundles the app into one self-contained HTML file.
 *
 *   node tools/build-single-file.mjs
 *
 * Produces dist/tipping-point.html — no separate CSS or JS, nothing fetched
 * from anywhere. Save it, mail it, drop it on a USB stick, open it straight
 * off the disk on any machine.
 *
 * Pass --fragment to also write dist/fragment.html, the same page without the
 * document wrapper, for hosts that supply their own <head> and <body>.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const css = read('src/styles.css');
const physics = read('src/physics.js');
const app = read('src/app.js');

/* A closing </script> anywhere inside inline JS would end the block early.
 * None of our source has one, but bundling shouldn't be able to break the
 * page silently if that ever changes. */
function guardInline(source, label) {
  if (/<\/script/i.test(source)) {
    throw new Error(`${label} contains a closing script tag and cannot be inlined as-is`);
  }
  return source;
}

let html = read('index.html');

// swap the stylesheet link for the stylesheet
html = html.replace(
  /[ \t]*<link rel="stylesheet" href="src\/styles\.css"[^>]*>\n?/,
  `    <style>\n${css}\n    </style>\n`
);

// swap the two script tags for their contents
html = html.replace(
  /[ \t]*<script src="src\/physics\.js"><\/script>\n?/,
  `    <script>\n${guardInline(physics, 'physics.js')}\n    </script>\n`
);
html = html.replace(
  /[ \t]*<script src="src\/app\.js"><\/script>\n?/,
  `    <script>\n${guardInline(app, 'app.js')}\n    </script>\n`
);

/* Everything below points at files that don't exist beside a single-file
 * build, and a service worker can't be registered from file:// anyway. */
html = html.replace(/[ \t]*<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/[ \t]*<link rel="icon"[^>]*>\n?/, '');
html = html.replace(/[ \t]*<link rel="apple-touch-icon"[^>]*>\n?/, '');
html = html.replace(
  /[ \t]*<script>\s*\/\/ Service worker[\s\S]*?<\/script>\n?/,
  ''
);
html = html.replace(
  /[ \t]*<p class="colophon">[\s\S]*?<\/p>\n?/,
  '      <p class="colophon">One self-contained file — it works with no connection at all.</p>\n'
);

for (const leftover of ['src/styles.css', 'src/physics.js', 'src/app.js', 'manifest.webmanifest']) {
  if (html.includes(leftover)) {
    throw new Error(`bundle still references ${leftover} — a replacement pattern missed`);
  }
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/tipping-point.html'), html);
console.log('wrote dist/tipping-point.html (%d KB)', Math.round(html.length / 1024));

if (process.argv.includes('--fragment')) {
  // strip the document wrapper, keep <title> so a host can pick the name up
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'Tipping Point';
  const style = (html.match(/<style>[\s\S]*?<\/style>/) || [])[0] || '';
  const body = (html.match(/<body>([\s\S]*)<\/body>/) || [])[1] || '';
  const fragment = `<title>${title}</title>\n${style}\n${body.trim()}\n`;
  writeFileSync(join(ROOT, 'dist/fragment.html'), fragment);
  console.log('wrote dist/fragment.html (%d KB)', Math.round(fragment.length / 1024));
}
