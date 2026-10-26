import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginRequest } from '@meld/shared';
import type { Env } from './env';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function passphraseMatches(candidate: string, expected: string): boolean {
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Single-user auth: log in with APP_PASSPHRASE, receive a bearer JWT.
 * Bearer tokens (not cookies) so web and native clients behave the same.
 * Replace with a real identity provider before hosting for multiple users.
 */
export async function registerAuth(app: FastifyInstance, env: Env) {
  app.post('/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = LoginRequest.safeParse(req.body);
    if (!body.success || !passphraseMatches(body.data.passphrase, env.APP_PASSPHRASE)) {
      return reply.code(401).send({ error: 'Invalid passphrase' });
    }
    const token = app.jwt.sign({ sub: 'owner' }, { expiresIn: SESSION_TTL_SECONDS });
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    return { token, expiresAt };
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.routeOptions.config?.public) return;
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
}
