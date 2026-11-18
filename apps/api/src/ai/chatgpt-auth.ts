import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatGPTStatus } from '@meld/shared';
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { decrypt, encrypt } from '../lib/crypto';

/**
 * Sign in with ChatGPT, so Ask Meld can run on the user's ChatGPT plan instead of an API key.
 * OpenAI offers this to open-source, locally hosted apps:
 * https://developers.openai.com/siwc/token-sharing-open-source
 */
const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
export const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
/** Lets the access token be spent on the user's plan; a sign-in without it is identity only. */
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
/** First sign-in registers the app and the callback returns its own client ID. */
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const APP_NAME = 'Meld';
/** OpenAI's loopback callback. Only the port may change between sign-ins, so 0 picks a free one when this is taken. */
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = '/auth/callback';
/** How long a started sign-in waits for the browser to come back. */
const SIGN_IN_TTL_MS = 10 * 60_000;
/** Refresh this long before the access token (1 hour) runs out. */
const REFRESH_MARGIN_MS = 2 * 60_000;
/** Refresh errors that mean the session is gone and only signing in again helps. */
const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

type Session = {
  sub: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
};

/** What's kept on disk. The host and client IDs outlive sign-outs, so signing in again reuses the registration. */
type Stored = { hostId: string; clientId: string | null; session: Session | null };

type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  authorizeUrl: string;
  server: Server | null;
  timer: NodeJS.Timeout;
};

type TokenResponse = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

const DEFAULT_FILE = fileURLToPath(new URL('../../../../data/chatgpt.json', import.meta.url));

/** Kept beside the settings file (the desktop app's and Docker's data folders), else in <repo>/data. */
export function createChatGPTAuth(env: Pick<Env, 'CHATGPT_AUTH_FILE' | 'MELD_CONFIG_FILE' | 'ENCRYPTION_KEY'>) {
  const file = env.CHATGPT_AUTH_FILE || (env.MELD_CONFIG_FILE ? path.join(path.dirname(env.MELD_CONFIG_FILE), 'chatgpt.json') : DEFAULT_FILE);
  return new ChatGPTAuth(file, env.ENCRYPTION_KEY);
}

const base64url = (b: Buffer) => b.toString('base64url');

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new HttpError(502, 'ChatGPT sign-in returned an unreadable token.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const NOT_ELIGIBLE =
  'ChatGPT didn’t let Meld use this plan. It needs Go, Plus, Pro or Business (with Meld allowed by an admin); Free can’t share usage. Pick another workspace, or use an API key.';

const CALLBACK_PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Meld</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
  `<h1 style="font-size:1.25rem">${message}</h1><p>You can close this tab and go back to Meld.</p></body>`;

/** The signed-in ChatGPT account, kept encrypted in `file`. */
export class ChatGPTAuth {
  private stored: Stored;
  private pending: Pending | null = null;
  /** Why the last sign-in or refresh failed, shown until the next attempt. */
  private lastError: string | null = null;
  /** Refresh tokens rotate, so only one refresh runs at a time. */
  private refreshing: Promise<Session> | null = null;

  constructor(
    private file: string,
    private encryptionKey: string,
  ) {
    this.stored = this.load();
  }

  private load(): Stored {
    if (existsSync(this.file)) {
      try {
        return JSON.parse(decrypt(readFileSync(this.file, 'utf8').trim(), this.encryptionKey)) as Stored;
      } catch {
        // Unreadable (e.g. another ENCRYPTION_KEY): start over with a fresh sign-in.
      }
    }
    return { hostId: `urn:uuid:${randomUUID()}`, clientId: null, session: null };
  }

  private async save() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    // Write then rename, so a crash never leaves half a token file.
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${encrypt(JSON.stringify(this.stored), this.encryptionKey)}\n`, { mode: 0o600 });
    await rename(tmp, this.file);
  }

  get signedIn() {
    return this.stored.session !== null;
  }

  /** Identifies the account, e.g. to drop cached models when it changes. */
  get accountId() {
    return this.stored.session?.sub ?? null;
  }

  status(): ChatGPTStatus {
    const session = this.stored.session;
    if (session) return { state: 'signed-in', email: session.email };
    if (this.pending) return { state: 'pending', authorizeUrl: this.pending.authorizeUrl };
    return { state: 'signed-out', error: this.lastError };
  }

  /** Starts a sign-in: listens for the browser's callback and returns the page to open. */
  async startSignIn(): Promise<string> {
    this.cancelPending();
    this.lastError = null;
    const server = await this.listen().catch(() => null);
    const port = server ? (server.address() as { port: number }).port : CALLBACK_PORT;
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const clientId = this.stored.clientId ?? DYNAMIC_CLIENT_ID;
    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(16));
    const nonce = base64url(randomBytes(16));
    const params = new URLSearchParams({
      client_id: clientId,
      ext_agent_host_id: this.stored.hostId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge: base64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    });
    if (!this.stored.clientId) params.set('agent_name_hint', APP_NAME);
    const authorizeUrl = `${AUTHORIZE_URL}?${params}`;
    const timer = setTimeout(() => this.cancelPending(), SIGN_IN_TTL_MS);
    timer.unref();
    this.pending = { state, nonce, verifier, redirectUri, clientId, authorizeUrl, server, timer };
    return authorizeUrl;
  }

  /** The loopback listener the browser returns to, on the same machine as Meld. */
  private listen(): Promise<Server> {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      this.finishSignIn(url.searchParams).then(
        () => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(CALLBACK_PAGE('Signed in with ChatGPT')),
        (err: unknown) =>
          res
            .writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(CALLBACK_PAGE(err instanceof HttpError ? err.message : 'ChatGPT sign-in didn’t finish.')),
      );
    });
    const bind = (port: number) =>
      new Promise<Server>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
      });
    return bind(CALLBACK_PORT).catch(() => bind(0));
  }

  /**
   * Finishes from the address the browser was sent back to. Used directly when the browser
   * isn't on Meld's computer (Docker, a phone), so it couldn't reach the loopback listener.
   */
  async finishFromUrl(callbackUrl: string) {
    let url: URL;
    try {
      url = new URL(callbackUrl.trim());
    } catch {
      throw new HttpError(400, 'Paste the whole address from the browser’s address bar, starting with http://127.0.0.1.');
    }
    await this.finishSignIn(url.searchParams);
  }

  private async finishSignIn(params: URLSearchParams) {
    const pending = this.pending;
    if (!pending) throw new HttpError(409, 'That sign-in expired. Choose Continue with ChatGPT to start again.');
    if (params.get('state') !== pending.state) throw new HttpError(400, 'That address is from a different sign-in. Copy the one from the latest ChatGPT sign-in, or start again.');
    this.cancelPending();
    try {
      await this.completeSignIn(pending, params);
    } catch (err) {
      if (!(err instanceof HttpError)) console.warn('[chatgpt] sign-in failed:', err);
      this.lastError = err instanceof HttpError ? err.message : 'ChatGPT sign-in failed. Try again.';
      throw err;
    }
  }

  private async completeSignIn(pending: Pending, params: URLSearchParams) {
    if (params.get('error')) throw new HttpError(400, 'ChatGPT sign-in was cancelled.');
    const code = params.get('code');
    if (!code) throw new HttpError(400, 'ChatGPT didn’t send back a sign-in code. Start again.');
    // A first sign-in registers Meld and returns its client ID; later ones must keep the one we sent.
    const returned = params.get('client_id');
    if (returned && pending.clientId !== DYNAMIC_CLIENT_ID && returned !== pending.clientId) {
      throw new HttpError(400, 'ChatGPT returned a different app registration. Start again.');
    }
    const clientId = returned ?? pending.clientId;
    if (clientId === DYNAMIC_CLIENT_ID) throw new HttpError(502, 'ChatGPT didn’t register Meld. Try again.');
    // Keep the registration before exchanging the code, so a retry after a failed exchange
    // reauthorizes it instead of registering again, and ChatGPT can say why it refused.
    if (this.stored.clientId !== clientId) {
      this.stored.clientId = clientId;
      await this.save();
    }

    let tokens: TokenResponse;
    try {
      tokens = await this.tokenRequest({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
        resource: RESOURCE,
      });
    } catch (err) {
      if (!(err instanceof TokenError)) throw err;
      console.warn(`[chatgpt] code exchange refused: ${err.code}`);
      // ChatGPT approves the consent page but then won't issue a token when the workspace or plan can't share usage.
      if (err.code === 'invalid_grant') throw new HttpError(403, NOT_ELIGIBLE);
      throw new HttpError(502, `ChatGPT sign-in failed (${err.code}). Try again.`);
    }
    if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token) {
      throw new HttpError(502, 'ChatGPT sign-in didn’t return the expected tokens. Try again.');
    }
    // The ID token came straight from OpenAI's token endpoint over TLS, so its claims are checked without fetching keys.
    const claims = decodeJwt(tokens.id_token);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== ISSUER || !audience.includes(clientId) || claims.nonce !== pending.nonce) {
      throw new HttpError(502, 'ChatGPT’s sign-in response didn’t check out. Try again.');
    }
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) throw new HttpError(502, 'ChatGPT’s sign-in had expired. Try again.');
    if (!this.scopesOf(tokens).includes(PLAN_SCOPE)) {
      throw new HttpError(403, 'Signed in, but ChatGPT didn’t allow Meld to use your plan. Try again and allow plan usage.');
    }
    this.stored.session = {
      sub: String(claims.sub),
      email: typeof claims.email === 'string' ? claims.email : null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
    this.lastError = null;
    await this.save();
  }

  private scopesOf(tokens: TokenResponse): string[] {
    const scope = tokens.scope ?? (tokens.access_token ? decodeJwt(tokens.access_token).scope : '');
    return typeof scope === 'string' ? scope.split(' ') : [];
  }

  private cancelPending() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.server?.close();
    this.pending = null;
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
      });
    } catch {
      throw new HttpError(503, 'Couldn’t reach ChatGPT. Check your internet connection.');
    }
    const body = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || body.error) {
      throw new TokenError(body.error ?? `http_${res.status}`);
    }
    return body;
  }

  /** A current access token, refreshed when it's about to run out. */
  async accessToken(): Promise<string> {
    const session = this.stored.session;
    if (!session) throw new HttpError(503, 'Sign in with ChatGPT again in Settings → AI.');
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session.accessToken;
    this.refreshing ??= this.refresh(session).finally(() => (this.refreshing = null));
    return (await this.refreshing).accessToken;
  }

  private async refresh(session: Session): Promise<Session> {
    let tokens: TokenResponse;
    try {
      tokens = await this.tokenRequest({
        grant_type: 'refresh_token',
        client_id: this.stored.clientId!,
        refresh_token: session.refreshToken,
        resource: RESOURCE,
      });
    } catch (err) {
      if (err instanceof TokenError && (TERMINAL_REFRESH_ERRORS.has(err.code) || err.code === 'invalid_client')) {
        await this.signedOutRemotely();
      }
      if (err instanceof TokenError) throw new HttpError(502, 'ChatGPT didn’t renew Meld’s sign-in. Try again shortly.');
      throw err;
    }
    if (!tokens.access_token || !tokens.refresh_token) throw new HttpError(502, 'ChatGPT didn’t renew Meld’s sign-in. Try again shortly.');
    const next: Session = {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
    this.stored.session = next;
    await this.save();
    return next;
  }

  /** The user disconnected Meld in ChatGPT, or the session ran out: forget the tokens and ask for a new sign-in. */
  async signedOutRemotely(): Promise<never> {
    this.stored.session = null;
    this.lastError = 'Your ChatGPT sign-in ended. Sign in again to keep using your plan.';
    await this.save();
    throw new HttpError(401, 'Your ChatGPT sign-in ended. Sign in again in Settings → AI.');
  }

  /** Signs out here and asks OpenAI to revoke the session; returns false when revoking couldn’t be confirmed. */
  async signOut(): Promise<boolean> {
    this.cancelPending();
    const session = this.stored.session;
    this.stored.session = null;
    this.lastError = null;
    await this.save();
    if (!session || !this.stored.clientId) return true;
    try {
      const config = (await (await fetch(`${ISSUER}/.well-known/openid-configuration`)).json()) as { revocation_endpoint?: string };
      if (!config.revocation_endpoint) return false;
      const res = await fetch(config.revocation_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: session.refreshToken, token_type_hint: 'refresh_token', client_id: this.stored.clientId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Stops the sign-in listener, e.g. when the server shuts down. */
  close() {
    this.cancelPending();
  }
}

class TokenError extends Error {
  constructor(public code: string) {
    super(`ChatGPT token request failed: ${code}`);
  }
}
