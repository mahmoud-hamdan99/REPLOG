#!/usr/bin/env node
/**
 * Serves the production build the way GitHub Pages does.
 *
 * The offline tests cannot run against `ng serve`: the service worker is
 * disabled in development builds, so a dev server would let the suite pass
 * while proving nothing. This serves `dist/` instead, and reproduces the two
 * things about Pages that actually affect the app — an unknown path falls
 * back to `index.html` with a 404 status, and files are served from a
 * configurable subpath.
 *
 *   node scripts/serve-dist.mjs [--port 4301] [--base /REPLOG/]
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const PORT = Number(option('port', '4301'));
const BASE = option('base', '/');
const ROOT = resolve('dist', 'REPLOG', 'browser');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error(`serve-dist: no build at ${ROOT}. Run \`npm run build -- --configuration production\` first.`);
  process.exit(1);
}

function send(response, status, file) {
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };

  // The worker script must not be served from cache, or a deployment can be
  // invisible to the browser for as long as the HTTP cache holds the old one.
  // Pages sets this itself; reproducing it here keeps the test honest.
  if (file.endsWith('ngsw-worker.js') || file.endsWith('ngsw.json')) {
    headers['Cache-Control'] = 'no-cache';
  }

  response.writeHead(status, headers);
  createReadStream(file).pipe(response);
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let path = decodeURIComponent(url.pathname);

  if (BASE !== '/' && path.startsWith(BASE)) path = `/${path.slice(BASE.length)}`;
  else if (BASE !== '/' && `${path}/` === BASE) path = '/';

  // Contain the path inside the build directory: `..` in a request must not
  // be able to read the repository.
  const candidate = join(ROOT, normalize(path));
  const contained = candidate === ROOT || candidate.startsWith(ROOT + sep);

  if (contained && existsSync(candidate)) {
    const stats = statSync(candidate);
    if (stats.isFile()) {
      send(response, 200, candidate);
      return;
    }
    // A directory means the index, served as a real 200. Falling through to
    // the 404 branch would have served the right bytes with the wrong status
    // for the app's own home page.
    const index = join(candidate, 'index.html');
    if (existsSync(index)) {
      send(response, 200, index);
      return;
    }
  }

  // GitHub Pages serves 404.html for an unknown path, with a 404 status; the
  // router then resolves the URL client-side. Same shape here, so a deep link
  // is tested the way it will actually behave.
  send(response, 404, join(ROOT, 'index.html'));
}).listen(PORT, () => {
  console.log(`serve-dist: ${ROOT} on http://localhost:${PORT}${BASE === '/' ? '' : BASE}`);
});
