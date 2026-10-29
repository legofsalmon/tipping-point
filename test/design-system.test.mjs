/*
 * The shared design system, as this app takes it.
 *
 * src/ds/ holds only what the design system's scripts/sync.mjs vendored,
 * untouched since. Each copy opens with a stamp: the version, the file, and a
 * hash of everything after the stamp line. A hand edit there is a fix the
 * design-system repo should get, and the next `npm run ds:sync` would
 * silently drop it. The design system's checker (tools/ds-check.mjs,
 * vendored too) catches that from the stamp alone; `npm run ds:check`, in
 * CI, also says when a copy is behind the published system. These tests hold
 * the rest of what the app has to keep true for the system to work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const SHEETS = ['tokens.css', 'base.css', 'components.css'];

test('src/ds holds the three stylesheets, as vendored', async () => {
  assert.deepEqual(readdirSync(join(ROOT, 'src/ds')).sort(), [...SHEETS].sort());
  // the design system's own checker, vendored in tools/: a copy edited by
  // hand, or a stamp taken off, fails (whether it is behind is `npm run ds:check`)
  const { main } = await import('../tools/ds-check.mjs');
  const said = [];
  const code = await main(['src/ds', 'tools', '--offline'], { cwd: ROOT, env: {}, log: () => {}, warn: (l) => said.push(l) });
  assert.equal(code, 0, `${said.join('\n')}\nmake the change in the design-system repo, then \`npm run ds:sync\``);
});

test('every --ds- role the app reads is one tokens.css defines', () => {
  const defined = new Set(
    [...read('src/ds/tokens.css').matchAll(/^\s*(--ds-[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
  );
  const css = read('src/styles.css');
  const js = read('src/app.js');
  const used = [
    ...[...css.matchAll(/var\((--ds-[a-z0-9-]+)/g)].map((m) => m[1]),
    // the script reads the behaviour timers by name: timing('timing-notice', …)
    ...[...js.matchAll(/timing\('([a-z0-9-]+)'/g)].map((m) => `--ds-${m[1]}`)
  ];
  assert.ok(used.length > 50, 'expected the stylesheet to read the roles');
  const unknown = [...new Set(used)].filter((name) => !defined.has(name));
  assert.deepEqual(unknown, [], 'a misspelt role falls back to nothing without anyone noticing');
});

test('the stylesheets load in order, the system before the app, everywhere', () => {
  const html = read('index.html');
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, [...SHEETS.map((f) => `src/ds/${f}`), 'src/styles.css']);
  const build = read('tools/build-single-file.mjs');
  assert.ok(
    build.includes(`[${links.map((l) => `'${l}'`).join(', ')}]`),
    'the single-file build inlines the same sheets in the same order'
  );
  const sw = read('sw.js');
  for (const link of links) assert.ok(sw.includes(`'${link}'`), `sw.js caches ${link} for offline use`);
});

test("the app's stylesheet keeps its colours in the system", () => {
  /* The force colour is this app's own (adoption.md: it is content, the
   * arrows on the drawings), in two values, one per theme. Nothing else in
   * styles.css is a literal colour. */
  const css = read('src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(literals)].sort(), ['#a83f08', '#ff9147']);
});

test('state is drawn from ARIA, not from a class', () => {
  const js = read('src/app.js');
  assert.ok(!/is-current/.test(js), 'the chosen row is aria-current, which the table draws');
  assert.ok(!/is-error/.test(js), 'errors are ds-notice--bad');
});
