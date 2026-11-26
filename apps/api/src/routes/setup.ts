import Anthropic from '@anthropic-ai/sdk';
import {
  ApiKeyTest,
  DEFAULT_OPENROUTER_MODELS,
  OllamaDetectRequest,
  PlaidKeyTest,
  SettingsUpdate,
  SetupRequest,
  type KeyTestResult,
  type OllamaDetectResult,
  type SettingsView,
  type SetupStatus,
} from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { CountryCode } from 'plaid';
import { OllamaProvider } from '../ai/ollama';
import { testOpenRouterKey } from '../ai/openrouter';
import { passphraseMatches } from '../auth';
import { readSettings, writeSettings, type SettingKey, type Settings } from '../config-file';
import { passphraseRequired, passphraseSet, plaidConfigured, type Env } from '../env';
import { HttpError, parse } from '../lib/http';
import { hashPassphrase } from '../lib/passphrase';
import { createPlaidClient, getPlaidError } from '../plaid/client';

export type SettingsDeps = {
  /** Setting keys the environment sets itself; .env wins over the settings file, so the app can't change them. */
  fromEnv: ReadonlySet<SettingKey>;
  /** Called after saving: the API exits and is started again (by Docker or the desktop app) with the new settings. */
  restart: () => void;
};

const SECTIONS = {
  passphrase: ['APP_PASSPHRASE', 'APP_PASSPHRASE_HASH', 'APP_PASSPHRASE_OFF'],
  plaid: ['PLAID_CLIENT_ID', 'PLAID_SANDBOX_SECRET', 'PLAID_PRODUCTION_SECRET', 'PLAID_ENV', 'MELD_DEMO'],
  ai: ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_CHAT_MODELS', 'OLLAMA_URL', 'OLLAMA_CHAT_MODELS'],
} as const;
type Section = keyof typeof SECTIONS;

const OLLAMA_CANDIDATES = ['http://127.0.0.1:11434', 'http://host.docker.internal:11434'];
const OLLAMA_PROBE_TIMEOUT_MS = 2_000;

const mask = (secret: string) => (secret ? `••••${secret.slice(-4)}` : '');

/** Kept only when it differs from the defaults, so a later Meld's better defaults still apply. */
const openrouterModelsSetting = (models: string[]) =>
  models.length && models.join(',') !== DEFAULT_OPENROUTER_MODELS.join(',') ? models.join(',') : undefined;

function sectionsFromEnv(fromEnv: ReadonlySet<string>): Section[] {
  return (Object.keys(SECTIONS) as Section[]).filter((s) => SECTIONS[s].some((k) => fromEnv.has(k)));
}

async function testPlaidKeys(keys: { clientId: string; secret: string; env: 'sandbox' | 'production' }): Promise<KeyTestResult> {
  if (!keys.secret) return { ok: false, error: `Enter your Plaid ${keys.env} secret.` };
  const plaid = createPlaidClient({
    PLAID_ENV: keys.env,
    PLAID_CLIENT_ID: keys.clientId,
    PLAID_SANDBOX_SECRET: keys.secret,
    PLAID_PRODUCTION_SECRET: keys.secret,
  });
  try {
    // The cheapest call that checks the client ID and secret together, and needs no linked bank.
    await plaid.institutionsGet({ count: 1, offset: 0, country_codes: [CountryCode.Us] });
    return { ok: true };
  } catch (err) {
    const plaidError = getPlaidError(err);
    if (plaidError) return { ok: false, error: plaidError.error_message };
    return { ok: false, error: 'Couldn’t reach Plaid. Check your internet connection.' };
  }
}

async function testAnthropicKey(apiKey: string): Promise<KeyTestResult> {
  if (!apiKey) return { ok: false, error: 'Enter your Anthropic API key.' };
  try {
    await new Anthropic({ apiKey, maxRetries: 0 }).models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) return { ok: false, error: 'Anthropic didn’t accept that key.' };
    return { ok: false, error: 'Couldn’t reach Anthropic. Check your internet connection.' };
  }
}

async function detectOllama(url: string, contextLength: number): Promise<OllamaDetectResult> {
  const tried = [...new Set([url, ...OLLAMA_CANDIDATES].filter(Boolean))];
  for (const candidate of tried) {
    const res = await fetch(new URL('/api/tags', candidate), { signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS) }).catch(() => null);
    if (!res?.ok) continue;
    const models = await new OllamaProvider(candidate, [], contextLength).listChatModels();
    return { found: true, url: candidate, models: models.map((m) => m.model) };
  }
  return { found: false, tried };
}

/**
 * First-run setup and Settings. Before setup is done, the API serves only these (and
 * the web app), all without a login; afterwards everything but the status needs one.
 */
export async function registerSetupRoutes(app: FastifyInstance, env: Env, settings: SettingsDeps, configured: boolean) {
  const editable = !!env.MELD_CONFIG_FILE;
  // Before setup there is no passphrase to log in with; the desktop app's window has its own token.
  const config = { public: !configured && !env.DESKTOP_TOKEN };

  function requireEditable() {
    if (!editable) throw new HttpError(409, 'Settings come from .env here. Edit it and restart Meld.');
  }

  async function save(update: (current: Settings) => Promise<Settings> | Settings) {
    const current = readSettings(env.MELD_CONFIG_FILE, env.ENCRYPTION_KEY);
    await writeSettings(env.MELD_CONFIG_FILE, env.ENCRYPTION_KEY, await update(current));
  }

  app.get('/setup/status', { config: { public: true } }, async (): Promise<SetupStatus> => ({
    configured,
    editable,
    phoneAccess: env.TAILSCALE_CONTROL,
    passphrase: !configured || passphraseRequired(env),
    passphraseSet: passphraseSet(env),
    desktop: !!env.DESKTOP_TOKEN,
    demo: env.MELD_DEMO,
  }));

  app.post('/setup', { config }, async (req, reply) => {
    if (configured) throw new HttpError(409, 'Meld is already set up. Change settings from Settings instead.');
    requireEditable();
    const body = parse(SetupRequest, req.body);
    const hash = body.passphrase ? await hashPassphrase(body.passphrase) : undefined;
    const { plaid, ai } = body;
    await save((current) => ({
      ...current,
      APP_PASSPHRASE_HASH: hash,
      // The desktop app's window signs itself in, so no passphrase there means no browser or phone access yet, not an open door.
      APP_PASSPHRASE_OFF: hash || env.DESKTOP_TOKEN ? undefined : '1',
      // No Plaid keys yet: show demo data until banks are connected.
      MELD_DEMO: plaid ? undefined : '1',
      ...(plaid && {
        PLAID_CLIENT_ID: plaid.clientId,
        PLAID_SANDBOX_SECRET: plaid.sandboxSecret,
        PLAID_PRODUCTION_SECRET: plaid.productionSecret,
        PLAID_ENV: plaid.env,
      }),
      ...(ai && {
        ANTHROPIC_API_KEY: ai.anthropicApiKey,
        OPENROUTER_API_KEY: ai.openrouterApiKey,
        OPENROUTER_CHAT_MODELS: openrouterModelsSetting(ai.openrouterModels),
        OLLAMA_URL: ai.ollamaUrl,
        OLLAMA_CHAT_MODELS: ai.ollamaModels.join(','),
      }),
    }));
    await reply.send({ ok: true });
    settings.restart();
  });

  // Testing keys from Settings may leave a secret empty to mean the saved one.
  app.post('/setup/test-plaid', { config }, async (req): Promise<KeyTestResult> => {
    const body = parse(PlaidKeyTest, req.body);
    const saved = body.env === 'production' ? env.PLAID_PRODUCTION_SECRET : env.PLAID_SANDBOX_SECRET;
    return testPlaidKeys({ ...body, secret: body.secret || (configured ? saved : '') });
  });

  app.post('/setup/test-anthropic', { config }, async (req): Promise<KeyTestResult> => {
    const body = parse(ApiKeyTest, req.body);
    return testAnthropicKey(body.apiKey || (configured ? env.ANTHROPIC_API_KEY : ''));
  });

  app.post('/setup/test-openrouter', { config }, async (req): Promise<KeyTestResult> => {
    const body = parse(ApiKeyTest, req.body);
    return testOpenRouterKey(body.apiKey || (configured ? env.OPENROUTER_API_KEY : ''));
  });

  app.post('/setup/detect-ollama', { config }, async (req): Promise<OllamaDetectResult> => {
    const body = parse(OllamaDetectRequest, req.body);
    return detectOllama(body.url || env.OLLAMA_URL, env.OLLAMA_CONTEXT_LENGTH);
  });

  if (!configured) return;

  app.get('/settings', async (): Promise<SettingsView> => ({
    editable,
    passphrase: passphraseRequired(env),
    passphraseSet: passphraseSet(env),
    desktop: !!env.DESKTOP_TOKEN,
    demo: env.MELD_DEMO,
    plaidReady: plaidConfigured(env),
    plaid: {
      clientId: env.PLAID_CLIENT_ID,
      sandboxSecret: mask(env.PLAID_SANDBOX_SECRET),
      productionSecret: mask(env.PLAID_PRODUCTION_SECRET),
      env: env.PLAID_ENV,
    },
    ai: {
      anthropicApiKey: mask(env.ANTHROPIC_API_KEY),
      openrouterApiKey: mask(env.OPENROUTER_API_KEY),
      openrouterModels: env.OPENROUTER_CHAT_MODELS,
      ollamaUrl: env.OLLAMA_URL,
      ollamaModels: env.OLLAMA_CHAT_MODELS,
    },
    fromEnv: sectionsFromEnv(settings.fromEnv),
  }));

  app.put('/settings', async (req, reply) => {
    requireEditable();
    const body = parse(SettingsUpdate, req.body);
    const fixed = sectionsFromEnv(settings.fromEnv).filter((s) => (s === 'plaid' ? body.plaid || body.demo !== undefined : body[s]));
    if (fixed.length) throw new HttpError(409, `These settings come from .env, which wins: ${fixed.join(', ')}. Edit it instead.`);
    // Turning the passphrase off or changing it takes the current one; turning it on doesn't. The
    // desktop app's own window is the computer's owner, so it can reset a forgotten one.
    if (
      body.passphrase &&
      passphraseRequired(env) &&
      passphraseSet(env) &&
      !req.viaDesktop &&
      !(await passphraseMatches(body.passphrase.current, env))
    ) {
      throw new HttpError(400, 'Your current passphrase isn’t right.');
    }
    if (body.passphrase && !body.passphrase.next && env.DESKTOP_TOKEN && env.PHONE_ACCESS) {
      throw new HttpError(409, 'Turn off phone access first: your phone unlocks Meld with this passphrase.');
    }
    const hash = body.passphrase?.next ? await hashPassphrase(body.passphrase.next) : null;
    await save((current) => {
      const next = { ...current };
      if (hash) {
        next.APP_PASSPHRASE_HASH = hash;
        delete next.APP_PASSPHRASE_OFF;
      } else if (body.passphrase) {
        delete next.APP_PASSPHRASE_HASH;
        // On the desktop app, no passphrase leaves only its own window able to open Meld.
        if (env.DESKTOP_TOKEN) delete next.APP_PASSPHRASE_OFF;
        else next.APP_PASSPHRASE_OFF = '1';
      }
      if (body.plaid) {
        next.PLAID_CLIENT_ID = body.plaid.clientId;
        next.PLAID_ENV = body.plaid.env;
        // Secrets are only ever shown masked, so an empty field keeps the saved one.
        if (body.plaid.sandboxSecret) next.PLAID_SANDBOX_SECRET = body.plaid.sandboxSecret;
        if (body.plaid.productionSecret) next.PLAID_PRODUCTION_SECRET = body.plaid.productionSecret;
        const secret = next.PLAID_ENV === 'production' ? next.PLAID_PRODUCTION_SECRET : next.PLAID_SANDBOX_SECRET;
        if (!secret) throw new HttpError(400, `Add your Plaid ${next.PLAID_ENV} secret to use ${next.PLAID_ENV}.`);
        // Keys just saved mean the user wants their own accounts.
        if (body.demo === undefined) delete next.MELD_DEMO;
      }
      if (body.demo === true) next.MELD_DEMO = '1';
      else if (body.demo === false) {
        const secret = next.PLAID_ENV === 'production' ? next.PLAID_PRODUCTION_SECRET : next.PLAID_SANDBOX_SECRET;
        if (!next.PLAID_CLIENT_ID || !secret) throw new HttpError(400, 'Add your Plaid keys first, so Meld can show your own accounts.');
        delete next.MELD_DEMO;
      }
      if (body.ai) {
        if (body.ai.removeAnthropicKey) delete next.ANTHROPIC_API_KEY;
        else if (body.ai.anthropicApiKey) next.ANTHROPIC_API_KEY = body.ai.anthropicApiKey;
        if (body.ai.removeOpenRouterKey) delete next.OPENROUTER_API_KEY;
        else if (body.ai.openrouterApiKey) next.OPENROUTER_API_KEY = body.ai.openrouterApiKey;
        next.OPENROUTER_CHAT_MODELS = openrouterModelsSetting(body.ai.openrouterModels);
        next.OLLAMA_URL = body.ai.ollamaUrl;
        next.OLLAMA_CHAT_MODELS = body.ai.ollamaModels.join(',');
      }
      return next;
    });
    await reply.send({ ok: true });
    settings.restart();
  });
}
