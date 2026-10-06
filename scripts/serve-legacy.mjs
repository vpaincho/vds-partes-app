#!/usr/bin/env node
/**
 * Serves legacy/baseline/ — Juan's frozen prototype — so a reviewer can walk the original
 * beside the new app when checking that no capability was lost.
 *
 * It is a static server and nothing more. The prototype is never imported, bundled or
 * built: it is a pinned source (see legacy/baseline/FROZEN.md). Serving it read-only is
 * the only interaction this repo has with it.
 *
 *   npm run legacy            # http://127.0.0.1:4178
 *   npm run legacy -- --port 5000
 *
 * Binds to loopback by default: this is a review aid, not something to expose.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repoRoot, 'legacy', 'baseline');

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const port = portArg >= 0 ? Number(argv[portArg + 1]) : 4178;
const host = '127.0.0.1';

const TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
  }),
);

function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  // Never serve outside legacy/baseline, whatever the request says.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }

  const file = resolveSafe(req.url ?? '/');
  if (!file) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(file);
    const target = info.isDirectory() ? path.join(file, 'index.html') : file;
    const size = info.isDirectory() ? (await stat(target)).size : info.size;

    res.writeHead(200, {
      'content-type': TYPES.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream',
      'content-length': size,
      // The prototype persists to localStorage under its own key. Keep it out of caches so
      // a reviewer always compares against the pinned bytes.
      'cache-control': 'no-store',
      // ASCII only: header values are latin-1 on the wire, so no typographic characters.
      'x-vds-baseline': 'frozen; commit 0c117aa; see legacy/baseline/FROZEN.md',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(
      `Not found in legacy/baseline: ${req.url}\n`,
    );
  }
});

server.listen(port, host, () => {
  console.log(`Product Baseline (S1, frozen) → http://${host}:${port}`);
  console.log(`  serving ${path.relative(repoRoot, root).replaceAll('\\', '/')} read-only`);
  console.log('  this is the comparison reference, not live code — see FROZEN.md');
});
