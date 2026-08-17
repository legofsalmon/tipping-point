/*
 * A static file server for local development.
 *
 *   npm run serve        # then open http://localhost:8080
 *
 * You can open index.html straight off the disk too, but a service worker
 * needs a real http origin, so use this if you want to test offline mode or
 * installing the app.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // normalize first, then confirm the result is still inside the project
    const target = resolve(join(ROOT, normalize(rel)));
    if (target !== ROOT && !target.startsWith(ROOT + '/')) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target);
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    const body = await readFile(file);

    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      // always revalidate, so edits show up on reload
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log('tipping-point serving %s on http://localhost:%d', ROOT, PORT);
});
