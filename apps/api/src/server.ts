import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import type { PlaidApi } from 'plaid';
import { registerAuth } from './auth';
import type { Db } from './db/client';
import type { Env } from './env';
import { HttpError } from './lib/http';
import { getPlaidError } from './plaid/client';
import type { SyncDeps } from './plaid/sync';
import { registerAccountRoutes } from './routes/accounts';
import { registerManualAssetRoutes } from './routes/manual-assets';
import { registerOverviewRoutes } from './routes/overview';
import { registerPlaidRoutes } from './routes/plaid';
import { registerTransactionRoutes } from './routes/transactions';

export type AppDeps = { env: Env; db: Db; plaid: PlaidApi; sync: SyncDeps };

export async function buildServer(deps: AppDeps) {
  const { env, db } = deps;
  const app = Fastify({
    logger: {
      level: 'info',
      // Keep auth headers and secrets out of logs.
      redact: ['req.headers.authorization', 'req.body.passphrase'],
    },
  });

  app.setErrorHandler((err, req, reply) => {
    const plaidError = getPlaidError(err);
    if (plaidError) {
      // Never log the raw error: axios errors carry request headers, including PLAID-SECRET.
      req.log.warn(
        { plaidError: { type: plaidError.error_type, code: plaidError.error_code, requestId: plaidError.request_id } },
        'Plaid request failed',
      );
      return reply.code(502).send({
        error: plaidError.display_message ?? plaidError.error_message,
        plaidErrorCode: plaidError.error_code,
      });
    }
    const status = err instanceof HttpError ? err.statusCode : (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: err instanceof Error ? err.message : 'Bad request' });
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'Internal server error' });
  });

  await app.register(cors, { origin: env.CORS_ORIGINS, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(jwt, { secret: env.SESSION_SECRET });
  await registerAuth(app, env);

  app.get('/health', { config: { public: true } }, async () => {
    await db.execute('select 1');
    return { ok: true };
  });

  app.get('/me', async () => ({ user: 'owner' }));

  await registerPlaidRoutes(app, deps);
  await registerAccountRoutes(app, deps);
  await registerTransactionRoutes(app, deps);
  await registerOverviewRoutes(app, deps);
  await registerManualAssetRoutes(app, deps);

  return app;
}
