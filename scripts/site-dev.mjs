// Serves site/ locally, rebuilds site/docs/ on Markdown changes, and reloads open pages.
// Usage: npm run site:dev  (PORT=8000 by default)
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

import { buildDocs } from './build-docs.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const root = join(repoRoot, 'site');
const port = Number(process.env.PORT ?? 8000);
const host = process.env.HOST ?? '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
const reloadScript = `<script>new EventSource('/__reload').onmessage = () => location.reload();</script>`;
const clients = new Set();

try {
  buildDocs();
} catch (err) {
  console.error('Initial docs build failed:', err.message);
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  let file = join(root, normalize(path));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  try {
    if (statSync(file).isDirectory()) {
      if (!path.endsWith('/')) {
        res.writeHead(301, { Location: `${path}/` });
        return void res.end();
      }
      file = join(file, 'index.html');
    }
    statSync(file);
  } catch {
    return void res.writeHead(404).end('Not found');
  }
  const type = types[extname(file)] ?? 'application/octet-stream';
  res.setHeader('Cache-Control', 'no-store');
  if (type.startsWith('text/html')) {
    import('node:fs/promises').then(({ readFile }) =>
      readFile(file, 'utf8').then((html) => {
        res.writeHead(200, { 'Content-Type': type });
        res.end(html.includes('</body>') ? html.replace('</body>', `${reloadScript}</body>`) : html + reloadScript);
      }),
    );
  } else {
    res.writeHead(200, { 'Content-Type': type });
    createReadStream(file).pipe(res);
  }
}).listen(port, host, () => console.log(`Serving site/ at http://${host}:${port} (docs at http://${host}:${port}/docs/) — reloads on change`));

let siteTimer;
watch(root, { recursive: true }, () => {
  clearTimeout(siteTimer);
  siteTimer = setTimeout(() => clients.forEach((c) => c.write('data: reload\n\n')), 100);
});

let docsTimer;
function scheduleDocsRebuild() {
  clearTimeout(docsTimer);
  docsTimer = setTimeout(() => {
    try {
      buildDocs();
    } catch (err) {
      console.error('Docs rebuild failed:', err.message);
    }
  }, 120);
}

for (const rel of ['docs', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md', 'scripts/build-docs.mjs']) {
  const target = join(repoRoot, rel);
  if (!existsSync(target)) continue;
  watch(target, { recursive: statSync(target).isDirectory() }, scheduleDocsRebuild);
}
