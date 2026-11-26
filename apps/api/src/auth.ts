import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginRequest } from '@meld/shared';
import { passphraseRequired, passphraseSet, type Env } from './env';
import { verifyPassphrase } from './lib/passphrase';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
/** Login attempts allowed per client address in each window. */
export const LOGIN_RATE_LIMIT = { max: 10, timeWindow: '15 minutes' };

/** Checks against APP_PASSPHRASE from .env, else the hash saved by first-run setup. */
export async function passphraseMatches(candidate: string, env: Pick<Env, 'APP_PASSPHRASE' | 'APP_PASSPHRASE_HASH'>) {
  if (env.APP_PASSPHRASE) {
    // Hash both sides so the comparison is constant-time regardless of length.
    const a = createHash('sha256').update(candidate).digest();
    const b = createHash('sha256').update(env.APP_PASSPHRASE).digest();
    return timingSafeEqual(a, b);
  }
  return !!env.APP_PASSPHRASE_HASH && verifyPassphrase(candidate, env.APP_PASSPHRASE_HASH);
}

/** Constant-time check of a bearer token against the desktop app's token. */
export function isDesktopToken(header: string | undefined, env: Pick<Env, 'DESKTOP_TOKEN'>): boolean {
  if (!env.DESKTOP_TOKEN || !header?.startsWith('Bearer ')) return false;
  const a = createHash('sha256').update(header.slice('Bearer '.length)).digest();
  const b = createHash('sha256').update(env.DESKTOP_TOKEN).digest();
  return timingSafeEqual(a, b);
}

/**
 * Single-user auth: log in with the passphrase, receive a bearer JWT. The desktop app's own
 * window sends DESKTOP_TOKEN instead, so it never asks for the passphrase.
 * Bearer tokens (not cookies) so web and native clients behave the same.
 * Replace with a real identity provider before hosting for multiple users.
 * With the passphrase turned off, every route is open to anyone who can reach the API.
 */
export async function registerAuth(app: FastifyInstance, env: Env) {
  app.post('/auth/login', { config: { public: true, rateLimit: LOGIN_RATE_LIMIT } }, async (req, reply) => {
    if (!passphraseSet(env)) {
      return reply.code(401).send({ error: 'No passphrase is set yet. Open Meld on its computer and choose one in Settings.' });
    }
    const body = LoginRequest.safeParse(req.body);
    if (!body.success || !(await passphraseMatches(body.data.passphrase, env))) {
      return reply.code(401).send({ error: 'Invalid passphrase' });
    }
    const token = app.jwt.sign({ sub: 'owner' }, { expiresIn: SESSION_TTL_SECONDS });
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    return { token, expiresAt };
  });

  const required = passphraseRequired(env);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!required || req.routeOptions.config?.public) return;
    if (isDesktopToken(req.headers.authorization, env)) {
      req.viaDesktop = true;
      return;
    }
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}

declare module 'fastify' {
  interface FastifyContextConfig {
    public?: boolean;
  }
  interface FastifyRequest {
    /** Signed in as the desktop app's own window, on the computer Meld runs on. */
    viaDesktop?: boolean;
  }
}
