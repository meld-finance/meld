import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PlaidApi } from 'plaid';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client';
import { loadEnv } from '../env';
import { buildServer } from '../server';
import type { DocumentStorage } from '../storage';
import { createMcpConfig } from './config';

const key = Buffer.alloc(32, 7).toString('base64');
const dir = mkdtempSync(path.join(tmpdir(), 'meld-mcp-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function makeEnv(extra: NodeJS.ProcessEnv = {}) {
  return loadEnv({
    DATABASE_URL: 'postgres://unused@127.0.0.1:5432/unused',
    SESSION_SECRET: 'y'.repeat(32),
    ENCRYPTION_KEY: key,
    PLAID_CLIENT_ID: 'client',
    PLAID_SANDBOX_SECRET: 'secret',
    APP_PASSPHRASE: 'correct horse battery',
    MCP_CONFIG_FILE: path.join(dir, `mcp-${n}.json`),
    OLLAMA_URL: '',
    ...extra,
  });
}

function fakeDb(): Db {
  return {
    query: {
      userProfile: {
        findFirst: async () => ({
          id: 1,
          displayName: 'Alex',
          birthYear: 1988,
          filingStatus: 'single',
          state: 'CA',
          dependents: 0,
          children: [],
          annualGrossIncome: 150000,
          partner: null,
          occupation: 'Engineer',
          employerBenefits: '401k plan 123456789012',
          goals: null,
        }),
      },
    },
  } as unknown as Db;
}

describe('McpConfig', () => {
  beforeEach(() => {
    n++;
  });

  it('starts disabled, encrypts stored config, generates/rotates/revokes tokens, and checks them in constant time', async () => {
    const env = makeEnv();
    const cfg = createMcpConfig(env);
    expect(cfg.status()).toMatchObject({ enabled: false, hasToken: false, fromEnv: false, endpointPath: '/mcp' });
    expect(cfg.isEnabled()).toBe(false);

    const enabled = await cfg.update({ enabled: true });
    expect(enabled.token).toMatch(/^meld_mcp_/);
    expect(enabled.status.enabled).toBe(true);
    expect(enabled.status.hasToken).toBe(true);
    expect(cfg.verifyToken(enabled.token!)).toBe(true);
    expect(cfg.verifyToken('wrong')).toBe(false);

    // Token is stored hashed and encrypted, never in plaintext on disk.
    const rawOnDisk = readFileSync(env.MCP_CONFIG_FILE, 'utf8');
    expect(rawOnDisk).not.toContain(enabled.token!);

    const rotated = await cfg.rotateToken();
    expect(rotated.token).not.toBe(enabled.token);
    expect(cfg.verifyToken(enabled.token!)).toBe(false);
    expect(cfg.verifyToken(rotated.token)).toBe(true);

    const revoked = await cfg.revokeToken();
    expect(revoked).toMatchObject({ enabled: false, hasToken: false, tokenMask: null });
    expect(cfg.verifyToken(rotated.token)).toBe(false);
  });

  it('respects .env overrides and refuses UI edits with 409', async () => {
    const env = makeEnv({ MCP_ENABLED: '1', MCP_TOKEN: 'meld_mcp_env_secret_token' });
    const cfg = createMcpConfig(env);
    expect(cfg.status()).toMatchObject({ enabled: true, hasToken: true, fromEnv: true });
    expect(cfg.verifyToken('meld_mcp_env_secret_token')).toBe(true);
    await expect(cfg.update({ enabled: false })).rejects.toThrow(/\.env/i);
    await expect(cfg.rotateToken()).rejects.toThrow(/\.env/i);
    await expect(cfg.revokeToken()).rejects.toThrow(/\.env/i);
  });
});

describe('MCP HTTP routes & Streamable HTTP protocol', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let appToken: string;

  async function startApp(extraEnv: NodeJS.ProcessEnv = {}) {
    const env = makeEnv(extraEnv);
    const mcp = createMcpConfig(env);
    const db = fakeDb();
    const plaid = {} as PlaidApi;
    app = await buildServer({ env, db, plaid, sync: { db, plaid, encryptionKey: key }, ai: null, mcp, storage: {} as DocumentStorage });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase: env.APP_PASSPHRASE } });
    appToken = login.json().token;
    return { env, mcp };
  }

  beforeEach(() => {
    n++;
  });
  afterEach(async () => {
    await app?.close();
  });

  it('requires app auth for /mcp/config management and enforces 404/401/403/405 guards on /mcp', async () => {
    await startApp();

    // Management endpoints need normal Meld auth.
    expect((await app.inject({ method: 'GET', url: '/mcp/config' })).statusCode).toBe(401);
    const cfg = await app.inject({ method: 'GET', url: '/mcp/config', headers: { authorization: `Bearer ${appToken}` } });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json().enabled).toBe(false);

    // Disabled -> 404.
    expect((await app.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode).toBe(404);

    // Enable MCP and capture the generated token.
    const enabled = (
      await app.inject({
        method: 'PUT',
        url: '/mcp/config',
        headers: { authorization: `Bearer ${appToken}` },
        payload: { enabled: true },
      })
    ).json();
    const mcpToken = enabled.token as string;
    expect(mcpToken).toMatch(/^meld_mcp_/);

    // Missing or wrong token -> 401 (including rejecting regular Meld login JWT!).
    expect((await app.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${appToken}` }, payload: {} })).statusCode).toBe(401);

    // Non-loopback Host, forwarded/tailscale headers, or foreign Origin -> 403.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/mcp',
          headers: { host: 'evil.example:4000', authorization: `Bearer ${mcpToken}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/mcp',
          headers: { 'x-forwarded-for': '203.0.113.10', authorization: `Bearer ${mcpToken}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/mcp',
          headers: { 'tailscale-user-login': 'someone@example.com', authorization: `Bearer ${mcpToken}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/mcp',
          headers: { origin: 'https://evil.example', authorization: `Bearer ${mcpToken}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);

    // Authenticated GET / DELETE -> 405 Method Not Allowed (stateless Streamable HTTP).
    const getRes = await app.inject({ method: 'GET', url: '/mcp', headers: { authorization: `Bearer ${mcpToken}` } });
    expect(getRes.statusCode).toBe(405);
    expect(getRes.headers.allow).toBe('POST');
    const delRes = await app.inject({ method: 'DELETE', url: '/mcp', headers: { authorization: `Bearer ${mcpToken}` } });
    expect(delRes.statusCode).toBe(405);
  });

  it('still requires the MCP bearer token even when APP_PASSPHRASE_OFF=1', async () => {
    await startApp({ APP_PASSPHRASE: '', APP_PASSPHRASE_OFF: '1', MCP_ENABLED: '1', MCP_TOKEN: 'meld_mcp_only_this' });
    // App routes are open, /mcp is NOT.
    expect((await app.inject({ method: 'GET', url: '/mcp/config' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode).toBe(401);
  });

  it('serves tools (readOnlyHint), resources, prompts, and masked tool results over Streamable HTTP', async () => {
    const { mcp } = await startApp();
    const { token } = await mcp.rotateToken();

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = new Client({ name: 'meld-test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });

    await client.connect(transport);
    try {
      const toolsRes = await client.listTools();
      expect(toolsRes.tools.length).toBeGreaterThanOrEqual(20);
      for (const tool of toolsRes.tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.destructiveHint).toBe(false);
        expect((tool.inputSchema as Record<string, unknown>).$schema).toBeUndefined();
      }

      const resourcesRes = await client.listResources();
      expect(resourcesRes.resources.map((r) => r.uri)).toContain('meld://conventions');
      expect(resourcesRes.resources.map((r) => r.uri)).toContain('meld://docs/retirement');

      const conventions = await client.readResource({ uri: 'meld://conventions' });
      expect((conventions.contents[0] as { text: string }).text).toContain('Read-only access');

      const promptsRes = await client.listPrompts();
      expect(promptsRes.prompts.map((p) => p.name)).toContain('tax-plan-review');
      const taxPrompt = await client.getPrompt({ name: 'tax-plan-review', arguments: { year: '2026' } });
      expect(taxPrompt.messages[0]!.content).toMatchObject({ type: 'text', text: expect.stringContaining('2026') });

      const profileCall = await client.callTool({ name: 'get_profile', arguments: {} });
      expect(profileCall.isError).toBe(false);
      const text = ((profileCall.content as { type: 'text'; text: string }[])[0]!).text;
      expect(text).toContain('••••9012');
      expect(text).not.toContain('123456789012');
    } finally {
      await transport.close();
      await client.close();
    }
  });
});
