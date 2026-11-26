import { DEFAULT_OPENROUTER_MODELS } from '@meld/shared';
import { z } from 'zod';

/** Comma-separated; empty means `fallback`, since .env templates list every key with no value. */
const list = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s) => (s || fallback).split(',').map((v) => v.trim()).filter(Boolean));
const csv = list('');
const flag = z
  .enum(['', '0', '1', 'true', 'false'])
  .default('')
  .transform((v) => v === '1' || v === 'true');

const PlaidEnv = z.enum(['sandbox', 'production']);

const EnvSchema = z
  .object({
    /** One database per Plaid environment, so sandbox and real data never mix. */
    SANDBOX_DATABASE_URL: z.url().optional(),
    PRODUCTION_DATABASE_URL: z.url().optional(),
    /** Overrides the per-environment URL (tests point this at the test DB). */
    DATABASE_URL: z.url().optional(),
    API_PORT: z.coerce.number().default(4000),
    /** Address to listen on. Localhost only by default; the Docker image sets 0.0.0.0 inside its private network. */
    API_HOST: z.string().default('127.0.0.1'),
    CORS_ORIGINS: csv,

    /** The login passphrase, or its hash (APP_PASSPHRASE_HASH) when set from the app. Unset means setup isn't done. */
    APP_PASSPHRASE: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(8, 'APP_PASSPHRASE must be at least 8 characters').optional(),
    ),
    APP_PASSPHRASE_HASH: z.string().default(''),
    /** No passphrase: anyone who can reach Meld can use it. Ignored when APP_PASSPHRASE is set. */
    APP_PASSPHRASE_OFF: flag,
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    ENCRYPTION_KEY: z
      .string()
      .refine((k) => Buffer.from(k, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded'),

    PLAID_CLIENT_ID: z.string().default(''),
    /** One secret per environment, so switching is just PLAID_ENV. */
    PLAID_SANDBOX_SECRET: z.string().default(''),
    PLAID_PRODUCTION_SECRET: z.string().default(''),
    PLAID_ENV: z.preprocess((v) => (v === '' ? undefined : v), PlaidEnv.default('sandbox')),
    PLAID_PRODUCTS: list('transactions'),
    PLAID_OPTIONAL_PRODUCTS: list('investments,liabilities'),
    /** Asked for at link time but only used (and billed) on demand, e.g. auth for full bank account numbers. */
    PLAID_ADDITIONAL_CONSENTED_PRODUCTS: csv,
    PLAID_COUNTRY_CODES: list('US'),
    /** This database's Plaid items are shared with another Meld (a copy of the Mac app's data): unlinking removes them here only. */
    PLAID_SHARED_ITEMS: flag,

    /**
     * Which key runs PDF reading, value lookups and fund make-up when both are set. Either
     * one is used when it's the only key.
     */
    AI_PROVIDER: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['anthropic', 'openrouter']).default('anthropic')),
    ANTHROPIC_API_KEY: z.string().default(''),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
    /** Chat runs many tool rounds per message over a long history, so it's the largest cost. */
    ANTHROPIC_CHAT_MODEL: z.string().default('claude-sonnet-5-5'),
    /** Other Claude models offered in the Ask model picker. */
    ANTHROPIC_CHAT_MODELS: list('claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5'),
    /** Effort for Ask Meld Claude chat turns; empty picks 'medium' for Opus and 'low' otherwise. */
    ANTHROPIC_CHAT_EFFORT: z.enum(['', 'low', 'medium', 'high']).default(''),
    /** Property value lookups are a chain of web searches; a fast model finishes them several times sooner. */
    ANTHROPIC_LOOKUP_MODEL: z.string().default('claude-haiku-5-5'),

    /** OpenRouter API key, for Ask Meld on Gemini, GPT, Claude and other models with one key; empty turns it off. */
    OPENROUTER_API_KEY: z.string().default(''),
    /** OpenRouter model IDs offered in the Ask model picker (see openrouter.ai/models). */
    OPENROUTER_CHAT_MODELS: list(DEFAULT_OPENROUTER_MODELS.join(',')),
    /** Reads insurance PDFs; must take file input. */
    OPENROUTER_MODEL: z.string().default('google/gemini-4-carbon'),
    /** Home and car value lookups (with the model's own web search) and fund make-up. */
    OPENROUTER_LOOKUP_MODEL: z.string().default('google/gemini-4-hydrogen'),

    /** Ollama server for local chat models, e.g. http://127.0.0.1:11434; empty turns it off. */
    OLLAMA_URL: z.union([z.url(), z.literal('')]).default(''),
    /** Models offered in the picker; empty lists every installed model that supports tool calling. */
    OLLAMA_CHAT_MODELS: csv,
    /** Context window to request from Ollama. */
    OLLAMA_CONTEXT_LENGTH: z.coerce.number().int().positive().default(16384),
    /** Let thinking-capable Ollama models emit hidden thinking tokens; off by default for faster chat. */
    OLLAMA_THINK: flag,

    /** Sign in with ChatGPT's tokens, encrypted; defaults to next to MELD_CONFIG_FILE, else <repo>/data/chatgpt.json. */
    CHATGPT_AUTH_FILE: z.string().default(''),

    /** Opt-in read-only MCP server for external agents (off by default). */
    MCP_ENABLED: flag,
    /** Static bearer token for /mcp when configured in .env; overrides Settings → External agents. */
    MCP_TOKEN: z.string().default(''),
    /** Encrypted MCP settings; defaults to next to MELD_CONFIG_FILE, else <repo>/data/mcp.json. */
    MCP_CONFIG_FILE: z.string().default(''),
    /** Allow non-loopback requests to /mcp (for example over Tailscale) when authenticated. */
    MCP_ALLOW_REMOTE: flag,

    /** Uploaded documents; defaults to <repo>/data/documents. */
    DOCUMENTS_DIR: z.string().default(''),

    /** The Expo web export to serve alongside the API (which then moves under /api); empty serves none. */
    WEB_DIR: z.string().default(''),
    /** Apply pending migrations before starting (Docker and the desktop app). */
    MIGRATE_ON_START: flag,
    /** Migrations folder; defaults to apps/api/drizzle. The bundled desktop API sets it. */
    MIGRATIONS_DIR: z.string().default(''),
    /** Settings file the app writes from first-run setup and Settings; empty means .env only. */
    MELD_CONFIG_FILE: z.string().default(''),
    /** The desktop app: the API may run the Tailscale CLI to turn phone access on and off. */
    TAILSCALE_CONTROL: flag,
    /** Phone access over Tailscale was turned on (re-applied at start). */
    PHONE_ACCESS: flag,
    /** The version running, shown in the app; the Mac app sets it. Empty reads apps/desktop/package.json. */
    MELD_VERSION: z.string().default(''),
  })
  .transform((env, ctx) => {
    const DATABASE_URL = env.DATABASE_URL ?? databaseUrlFor(env, env.PLAID_ENV);
    if (!DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: [databaseUrlKey(env.PLAID_ENV)], message: `required when PLAID_ENV=${env.PLAID_ENV}` });
      return z.NEVER;
    }
    return { ...env, DATABASE_URL };
  });

type PlaidEnv = z.infer<typeof PlaidEnv>;
type DatabaseUrls = { SANDBOX_DATABASE_URL?: string; PRODUCTION_DATABASE_URL?: string };

const databaseUrlKey = (plaidEnv: PlaidEnv) =>
  plaidEnv === 'production' ? 'PRODUCTION_DATABASE_URL' : 'SANDBOX_DATABASE_URL';

function databaseUrlFor(urls: DatabaseUrls, plaidEnv: PlaidEnv): string | undefined {
  return urls[databaseUrlKey(plaidEnv)];
}

/** Every per-environment database configured in `source`, for migrations and test guards. */
export function configuredDatabaseUrls(source: NodeJS.ProcessEnv = process.env): string[] {
  return PlaidEnv.options.map((e) => databaseUrlFor(source, e)).filter((u): u is string => !!u);
}

export type Env = z.infer<typeof EnvSchema>;

/** The secret for the Plaid environment in use. */
export function plaidSecret(env: Pick<Env, 'PLAID_ENV' | 'PLAID_SANDBOX_SECRET' | 'PLAID_PRODUCTION_SECRET'>) {
  return env.PLAID_ENV === 'production' ? env.PLAID_PRODUCTION_SECRET : env.PLAID_SANDBOX_SECRET;
}

/** Whether logging in takes a passphrase; turned off from setup or Settings, unless .env sets one. */
export function passphraseRequired(env: Pick<Env, 'APP_PASSPHRASE' | 'APP_PASSPHRASE_OFF'>): boolean {
  return !!env.APP_PASSPHRASE || !env.APP_PASSPHRASE_OFF;
}

/** Enough is set to run Meld: a passphrase (or none, by choice) and Plaid keys. Until then the API serves only first-run setup. */
export function setupComplete(env: Env): boolean {
  const passphraseChosen = !!(env.APP_PASSPHRASE || env.APP_PASSPHRASE_HASH) || env.APP_PASSPHRASE_OFF;
  return passphraseChosen && !!env.PLAID_CLIENT_ID && !!plaidSecret(env);
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment (see .env.example):\n${issues}`);
  }
  return parsed.data;
}
