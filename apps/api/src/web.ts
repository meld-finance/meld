import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Where the API lives when the same server also serves the web app. */
export const API_PREFIX = '/api';

/**
 * Serves the Expo web export from `root`: hashed bundles are cached
 * forever, everything else (index.html above all) is revalidated so a rebuild shows up
 * on the next load, and unknown paths load index.html so the router takes over.
 */
export async function registerWebApp(app: FastifyInstance, root: string) {
  // Chat streams with reply.hijack(), which bypasses compression, so answers still arrive as written.
  await app.register(compress);
  await app.register(fastifyStatic, {
    root,
    wildcard: true,
    setHeaders(res, filePath) {
      const hashed = filePath.includes('/_expo/static/');
      res.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`) || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });
}
