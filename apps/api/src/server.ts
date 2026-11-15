import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppFeatures } from '@meld/shared';
import type { PlaidApi } from 'plaid';
import type { ChatGPTAuth } from './ai/chatgpt-auth';
import type { AIProvider } from './ai/provider';
import { registerAuth } from './auth';
import type { Db } from './db/client';
import type { Env } from './env';
import { HttpError } from './lib/http';
import { getPlaidError } from './plaid/client';
import type { SyncDeps } from './plaid/sync';
import { registerAccountRoutes } from './routes/accounts';
import { registerAlertRoutes } from './routes/alerts';
import { registerCashRoutes } from './routes/cash';
import { registerChatRoutes } from './routes/chat';
import { registerChatGPTRoutes } from './routes/chatgpt';
import { registerEstateRoutes } from './routes/estate';
import { registerInsuranceRoutes } from './routes/insurance';
import { registerManualAssetRoutes } from './routes/manual-assets';
import { registerOverviewRoutes } from './routes/overview';
import { registerPhoneAccessRoutes } from './routes/phone-access';
import { registerPlaidRoutes } from './routes/plaid';
import { registerProfileRoutes } from './routes/profile';
import { registerRecurringRoutes } from './routes/recurring';
import { registerRetirementRoutes } from './routes/retirement';
import { registerTaxRoutes } from './routes/tax';
import { registerTransactionRoutes } from './routes/transactions';
import { registerSetupRoutes, type SettingsDeps } from './routes/setup';
import type { PhoneAccessService } from './services/tailscale';
import type { DocumentStorage } from './storage';
import { API_PREFIX, registerWebApp } from './web';

export type AppDeps = {
  env: Env;
  db: Db;
  plaid: PlaidApi;
  sync: SyncDeps;
  /** Null when no AI provider is configured. */
  ai: AIProvider | null;
  /** Sign in with ChatGPT, for Ask Meld on the user's plan; tests can leave it out. */
  chatgpt?: ChatGPTAuth | null;
  storage: DocumentStorage;
  /** For changing settings from the app; tests can leave it out. */
  settings?: SettingsDeps;
  /** Phone access over Tailscale; only the desktop app has it. */
  phoneAccess?: PhoneAccessService | null;
};

const NO_SETTINGS: SettingsDeps = { fromEnv: new Set(), restart: () => {} };

/** The full API. */
export async function buildServer(deps: AppDeps) {
  const app = await createApp(deps.env);
  // Serving the web app too (Docker, desktop): the API moves under /api so app paths
  // like /alerts and API paths like /alerts don't collide. Without it (dev), it stays at /.
  await app.register((api) => registerApi(api, deps), { prefix: deps.env.WEB_DIR ? API_PREFIX : '' });
  if (deps.env.WEB_DIR) await registerWebApp(app, deps.env.WEB_DIR);
  return app;
}

/** Before first-run setup: only the setup routes (no login yet) and the web app that shows the wizard. */
export async function buildSetupServer(env: Env, settings: SettingsDeps) {
  const app = await createApp(env);
  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
      await registerSetupRoutes(api, env, settings, false);
    },
    { prefix: env.WEB_DIR ? API_PREFIX : '' },
  );
  if (env.WEB_DIR) await registerWebApp(app, env.WEB_DIR);
  return app;
}

async function createApp(env: Env) {
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
    // HttpError messages are written for the user, whatever the status.
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: err instanceof Error ? err.message : 'Bad request' });
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
  });

  await app.register(cors, { origin: env.CORS_ORIGINS, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(jwt, { secret: env.SESSION_SECRET });
  // Off by default; routes opt in (the login route, against passphrase guessing).
  await app.register(rateLimit, { global: false });
  return app;
}

async function registerApi(app: FastifyInstance, deps: AppDeps) {
  const { env, db } = deps;
  // Inside this scope only, so the web app's files need no login.
  await registerAuth(app, env);

  app.get('/health', { config: { public: true } }, async () => {
    await db.execute('select 1');
    return { ok: true };
  });

  app.get('/me', async () => ({ user: 'owner' }));
  await registerSetupRoutes(app, env, deps.settings ?? NO_SETTINGS, true);
  if (deps.phoneAccess) await registerPhoneAccessRoutes(app, env, deps.phoneAccess);
  if (deps.chatgpt) await registerChatGPTRoutes(app, deps.chatgpt);
  app.get('/features', async (): Promise<AppFeatures> => ({ cloudAI: deps.ai !== null }));

  await registerPlaidRoutes(app, deps);
  await registerAccountRoutes(app, deps);
  await registerTransactionRoutes(app, deps);
  await registerOverviewRoutes(app, deps);
  await registerManualAssetRoutes(app, deps);
  await registerInsuranceRoutes(app, deps);
  await registerProfileRoutes(app, deps);
  await registerRetirementRoutes(app, deps);
  await registerTaxRoutes(app, deps);
  await registerCashRoutes(app, deps);
  await registerRecurringRoutes(app, deps);
  await registerAlertRoutes(app, deps);
  await registerEstateRoutes(app, deps);
  await registerChatRoutes(app, deps);
}
