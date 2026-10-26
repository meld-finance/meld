import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { registerAuth } from './auth';
import type { Db } from './db/client';
import type { Env } from './env';

export async function buildServer(env: Env, db: Db) {
  const app = Fastify({
    logger: {
      level: 'info',
      // Keep auth headers and secrets out of logs.
      redact: ['req.headers.authorization', 'req.body.passphrase'],
    },
  });

  await app.register(cors, { origin: env.CORS_ORIGINS });
  await app.register(jwt, { secret: env.SESSION_SECRET });
  await registerAuth(app, env);

  app.get('/health', { config: { public: true } }, async () => {
    await db.execute('select 1');
    return { ok: true };
  });

  app.get('/me', async () => ({ user: 'owner' }));

  return app;
}
