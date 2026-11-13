// Serves site/ locally and reloads open pages whenever a file in it changes.
// Usage: npm run site:dev  (PORT=8000 by default)
import { createReadStream, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'site');
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
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
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
}).listen(port, host, () => console.log(`Serving site/ at http://${host}:${port} — reloads on change`));

let timer;
watch(root, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => clients.forEach((c) => c.write('data: reload\n\n')), 100);
});
