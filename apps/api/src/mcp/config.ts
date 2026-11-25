import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpConfigUpdate, McpStatus, McpTokenResponse, McpUpdateResponse } from '@meld/shared';
import type { Env } from '../env';
import { decrypt, encrypt } from '../lib/crypto';
import { HttpError } from '../lib/http';

type StoredMcpConfig = {
  enabled: boolean;
  tokenHash: string | null;
  tokenMask: string | null;
  tokenCreatedAt: string | null;
  allowRemote: boolean;
};

const EMPTY_STORED: StoredMcpConfig = {
  enabled: false,
  tokenHash: null,
  tokenMask: null,
  tokenCreatedAt: null,
  allowRemote: false,
};

const DEFAULT_FILE = fileURLToPath(new URL('../../../../data/mcp.json', import.meta.url));
const TOKEN_PREFIX = 'meld_mcp_';

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

function maskToken(token: string): string {
  const tail = token.slice(-4);
  return token.startsWith(TOKEN_PREFIX) ? `${TOKEN_PREFIX}••••${tail}` : `••••${tail}`;
}

function generateRawToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export type McpConfigOptions = {
  file: string;
  encryptionKey: string;
  port: number;
  endpointPath: string;
  envEnabled: boolean;
  envToken: string;
  envAllowRemote: boolean;
};

/** Kept beside Meld's settings file, else in <repo>/data/mcp.json. */
export function createMcpConfig(
  env: Pick<Env, 'MCP_CONFIG_FILE' | 'MELD_CONFIG_FILE' | 'ENCRYPTION_KEY' | 'API_PORT' | 'WEB_DIR' | 'MCP_ENABLED' | 'MCP_TOKEN' | 'MCP_ALLOW_REMOTE'>,
): McpConfig {
  const file = env.MCP_CONFIG_FILE || (env.MELD_CONFIG_FILE ? path.join(path.dirname(env.MELD_CONFIG_FILE), 'mcp.json') : DEFAULT_FILE);
  return new McpConfig({
    file,
    encryptionKey: env.ENCRYPTION_KEY,
    port: env.API_PORT,
    endpointPath: env.WEB_DIR ? '/api/mcp' : '/mcp',
    envEnabled: env.MCP_ENABLED,
    envToken: env.MCP_TOKEN,
    envAllowRemote: env.MCP_ALLOW_REMOTE,
  });
}

/** Encrypted store and validator for Meld's opt-in read-only MCP endpoint. */
export class McpConfig {
  private stored: StoredMcpConfig;
  readonly fromEnv: boolean;

  constructor(private opts: McpConfigOptions) {
    this.fromEnv = Boolean(opts.envEnabled || opts.envToken);
    this.stored = this.load();
  }

  private load(): StoredMcpConfig {
    if (existsSync(this.opts.file)) {
      try {
        const parsed = JSON.parse(decrypt(readFileSync(this.opts.file, 'utf8').trim(), this.opts.encryptionKey)) as Partial<StoredMcpConfig>;
        return {
          enabled: Boolean(parsed.enabled),
          tokenHash: typeof parsed.tokenHash === 'string' ? parsed.tokenHash : null,
          tokenMask: typeof parsed.tokenMask === 'string' ? parsed.tokenMask : null,
          tokenCreatedAt: typeof parsed.tokenCreatedAt === 'string' ? parsed.tokenCreatedAt : null,
          allowRemote: Boolean(parsed.allowRemote),
        };
      } catch {
        // Unreadable (e.g. another ENCRYPTION_KEY): fall back to disabled.
      }
    }
    return { ...EMPTY_STORED };
  }

  private async save() {
    await mkdir(path.dirname(this.opts.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.opts.file}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${encrypt(JSON.stringify(this.stored), this.opts.encryptionKey)}\n`, { mode: 0o600 });
    await rename(tmp, this.opts.file);
  }

  private assertEditable() {
    if (this.fromEnv) {
      throw new HttpError(409, 'MCP settings come from .env here. Edit it and restart Meld.');
    }
  }

  status(): McpStatus {
    const enabled = this.fromEnv ? this.opts.envEnabled : this.stored.enabled;
    const hasToken = this.fromEnv ? Boolean(this.opts.envToken) : Boolean(this.stored.tokenHash);
    const tokenMask = this.fromEnv ? (this.opts.envToken ? maskToken(this.opts.envToken) : null) : this.stored.tokenMask;
    const tokenCreatedAt = this.fromEnv ? null : this.stored.tokenCreatedAt;
    const allowRemote = this.fromEnv ? this.opts.envAllowRemote : this.opts.envAllowRemote || this.stored.allowRemote;
    return {
      enabled,
      hasToken,
      tokenMask,
      tokenCreatedAt,
      fromEnv: this.fromEnv,
      allowRemote,
      endpointPath: this.opts.endpointPath,
      port: this.opts.port,
    };
  }

  /** True only when enabled AND a token is configured. */
  isEnabled(): boolean {
    const s = this.status();
    return s.enabled && s.hasToken;
  }

  allowRemote(): boolean {
    return this.status().allowRemote;
  }

  verifyToken(candidate: string): boolean {
    if (!this.isEnabled() || !candidate) return false;
    const expectedHex = this.fromEnv ? sha256Hex(this.opts.envToken) : this.stored.tokenHash;
    if (!expectedHex) return false;
    const actual = Buffer.from(sha256Hex(candidate), 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async update(patch: McpConfigUpdate): Promise<McpUpdateResponse> {
    this.assertEditable();
    if (patch.allowRemote !== undefined) this.stored.allowRemote = patch.allowRemote;
    if (patch.enabled !== undefined) this.stored.enabled = patch.enabled;

    let token: string | undefined;
    if (this.stored.enabled && !this.stored.tokenHash) {
      token = generateRawToken();
      this.stored.tokenHash = sha256Hex(token);
      this.stored.tokenMask = maskToken(token);
      this.stored.tokenCreatedAt = new Date().toISOString();
    }
    await this.save();
    return { status: this.status(), ...(token ? { token } : {}) };
  }

  async rotateToken(): Promise<McpTokenResponse> {
    this.assertEditable();
    const token = generateRawToken();
    this.stored.enabled = true;
    this.stored.tokenHash = sha256Hex(token);
    this.stored.tokenMask = maskToken(token);
    this.stored.tokenCreatedAt = new Date().toISOString();
    await this.save();
    return { status: this.status(), token };
  }

  async revokeToken(): Promise<McpStatus> {
    this.assertEditable();
    this.stored.enabled = false;
    this.stored.tokenHash = null;
    this.stored.tokenMask = null;
    this.stored.tokenCreatedAt = null;
    await this.save();
    return this.status();
  }
}
