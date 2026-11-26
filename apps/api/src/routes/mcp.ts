import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpConfigUpdate, type McpStatus, type McpTokenResponse, type McpUpdateResponse } from '@meld/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import { parse } from '../lib/http';
import { createMcpConfig } from '../mcp/config';
import { createMeldMcpServer } from '../mcp/server';
import type { AppDeps } from '../server';
import { appVersion } from '../services/releases';

function parseHostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string | null): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isPrivateIp(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) !== 4) return false;
  const parts = v4.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isAllowedOrigin(origin: string, corsOrigins: string[]): boolean {
  if (corsOrigins.includes(origin)) return true;
  try {
    return isLoopbackHost(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function registerMcpRoutes(app: FastifyInstance, { env, db: initialDb, mcp, runtime }: AppDeps) {
  const getDb = () => runtime?.getDb() ?? initialDb;
  const mcpConfig = mcp ?? createMcpConfig(env);
  const version = appVersion(env);

  // Management routes use Meld's normal app login auth (not public).
  app.get('/mcp/config', async (): Promise<McpStatus> => mcpConfig.status());

  app.put('/mcp/config', async (req): Promise<McpUpdateResponse> => mcpConfig.update(parse(McpConfigUpdate, req.body ?? {})));

  app.post('/mcp/token', async (): Promise<McpTokenResponse> => mcpConfig.rotateToken());

  app.delete('/mcp/token', async (): Promise<McpStatus> => mcpConfig.revokeToken());

  // MCP Streamable HTTP endpoint bypasses passphrase-off open access and verifies its own strict guards + dedicated bearer token.
  function verifyMcpRequest(req: FastifyRequest, reply: FastifyReply): boolean {
    if (!mcpConfig.isEnabled()) {
      void reply.code(404).send({ error: 'Not found' });
      return false;
    }

    if (!mcpConfig.allowRemote()) {
      if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['tailscale-user-login']) {
        void reply.code(403).send({ error: 'MCP is restricted to localhost' });
        return false;
      }
      if (!isLoopbackHost(parseHostname(req.headers.host))) {
        void reply.code(403).send({ error: 'MCP is restricted to localhost' });
        return false;
      }
      const remoteOk = isLoopbackHost(env.API_HOST)
        ? isLoopbackIp(req.ip)
        : isLoopbackIp(req.ip) || (env.API_HOST === '0.0.0.0' && isPrivateIp(req.ip));
      if (!remoteOk) {
        void reply.code(403).send({ error: 'MCP is restricted to localhost' });
        return false;
      }
    }

    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin, env.CORS_ORIGINS)) {
      void reply.code(403).send({ error: 'Origin not allowed' });
      return false;
    }

    const auth = req.headers.authorization;
    const match = typeof auth === 'string' ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
    if (!match || !mcpConfig.verifyToken(match[1]!)) {
      void reply.header('WWW-Authenticate', 'Bearer realm="Meld MCP"').code(401).send({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  const methodNotAllowed = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyMcpRequest(req, reply)) return;
    return reply
      .header('Allow', 'POST')
      .code(405)
      .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  };

  app.get('/mcp', { config: { public: true } }, methodNotAllowed);
  app.delete('/mcp', { config: { public: true } }, methodNotAllowed);

  app.post('/mcp', { config: { public: true } }, async (req, reply) => {
    if (!verifyMcpRequest(req, reply)) return;
    reply.hijack();
    reply.raw.setHeader('X-Content-Type-Options', 'nosniff');

    const server = createMeldMcpServer(getDb(), version ?? undefined);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    };
    reply.raw.on('close', cleanup);

    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      req.log.error({ err }, 'MCP request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }),
        );
      }
    } finally {
      cleanup();
    }
  });
}
