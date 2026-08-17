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
const SCRIPTS = ['src/physics.js', 'src/ledwall.js', 'src/sim.js', 'src/app.js'];

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

// swap each script tag for its contents, in the order the page loads them
for (const path of SCRIPTS) {
  const tag = new RegExp(`[ \\t]*<script src="${path.replace(/[/.]/g, '\\$&')}"></script>\\n?`);
  if (!tag.test(html)) throw new Error(`no script tag found for ${path}`);
  html = html.replace(tag, `    <script>\n${guardInline(read(path), path)}\n    </script>\n`);
}

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

for (const leftover of ['src/styles.css', ...SCRIPTS, 'manifest.webmanifest']) {
  if (html.includes(leftover)) {
    throw new Error(`bundle still references ${leftover} — a replacement pattern missed`);
  }
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/tipping-point.html'), html);
console.log('wrote dist/tipping-point.html (%d KB)', Math.round(html.length / 1024));

if (process.argv.includes('--fragment')) {
  /* Strip the document wrapper. The host supplies the head and body, and takes
   * the page's name from the title — so that's the short name only, with the
   * "what it does" part left to whatever blurb the host asks for. */
  const style = (html.match(/<style>[\s\S]*?<\/style>/) || [])[0] || '';

  /* Anchor on the LAST opening body tag. Inlining the stylesheet can put the
   * text of a body tag into the page (in a comment, say), and matching the
   * first one swallows half the stylesheet into the fragment as visible text. */
  const bodyOpen = html.match(/<body[^>]*>/g);
  if (!bodyOpen) throw new Error('no body tag found to extract the fragment from');
  const start = html.lastIndexOf(bodyOpen[bodyOpen.length - 1]) +
    bodyOpen[bodyOpen.length - 1].length;
  const end = html.lastIndexOf('</body>');
  if (end <= start) throw new Error('could not find the end of the body');
  const body = html.slice(start, end);

  const fragment = `<title>Tipping Point</title>\n${style}\n${body.trim()}\n`;

  /* The fragment is published as-is into someone else's document, so a
   * malformed one is worth failing the build over rather than shipping. */
  const count = (needle) => fragment.split(needle).length - 1;
  if (count('<style>') !== 1 || count('</style>') !== 1) {
    throw new Error('fragment should carry exactly one style block');
  }
  if (/<\/?(html|head|body)[\s>]/.test(fragment)) {
    throw new Error('fragment still contains document-wrapper tags');
  }
  for (const marker of ['panel--inputs', 'sim-canvas', 'led-count', 'out-force']) {
    if (!fragment.includes(marker)) {
      throw new Error(`fragment is missing ${marker} — the body extraction went wrong`);
    }
  }
  writeFileSync(join(ROOT, 'dist/fragment.html'), fragment);
  console.log('wrote dist/fragment.html (%d KB)', Math.round(fragment.length / 1024));
}
