import { z } from 'zod';

const list = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean));
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

    APP_PASSPHRASE: z.string().min(8, 'APP_PASSPHRASE must be at least 8 characters'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    ENCRYPTION_KEY: z
      .string()
      .refine((k) => Buffer.from(k, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded'),

    PLAID_CLIENT_ID: z.string().default(''),
    /** One secret per environment, so switching is just PLAID_ENV. */
    PLAID_SANDBOX_SECRET: z.string().default(''),
    PLAID_PRODUCTION_SECRET: z.string().default(''),
    PLAID_ENV: PlaidEnv.default('sandbox'),
    PLAID_PRODUCTS: csv,
    PLAID_OPTIONAL_PRODUCTS: csv,
    /** Asked for at link time but only used (and billed) on demand, e.g. auth for full bank account numbers. */
    PLAID_ADDITIONAL_CONSENTED_PRODUCTS: csv,
    PLAID_COUNTRY_CODES: csv,

    AI_PROVIDER: z.enum(['anthropic']).default('anthropic'),
    ANTHROPIC_API_KEY: z.string().default(''),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
    /** Chat runs many tool rounds per message over a long history, so it's the largest cost. */
    ANTHROPIC_CHAT_MODEL: z.string().default('claude-sonnet-5-5'),
    /** Other Claude models offered in the Ask model picker. */
    ANTHROPIC_CHAT_MODELS: list('claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5'),
    /** Property value lookups are a chain of web searches; a fast model finishes them several times sooner. */
    ANTHROPIC_LOOKUP_MODEL: z.string().default('claude-haiku-5-5'),

    /** Ollama server for local chat models, e.g. http://127.0.0.1:11434; empty turns it off. */
    OLLAMA_URL: z.union([z.url(), z.literal('')]).default(''),
    /** Models offered in the picker; empty lists every installed model that supports tool calling. */
    OLLAMA_CHAT_MODELS: csv,
    /** Context window to request. Ollama's default is too small for the system prompt, snapshot and tools. */
    OLLAMA_CONTEXT_LENGTH: z.coerce.number().int().positive().default(32768),

    /** Uploaded documents; defaults to <repo>/data/documents. */
    DOCUMENTS_DIR: z.string().default(''),

    /** The Expo web export to serve alongside the API (which then moves under /api); empty serves none. */
    WEB_DIR: z.string().default(''),
    /** Apply pending migrations before starting (Docker and the desktop app). */
    MIGRATE_ON_START: flag,
    /** Migrations folder; defaults to apps/api/drizzle. The bundled desktop API sets it. */
    MIGRATIONS_DIR: z.string().default(''),
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

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment (see .env.example):\n${issues}`);
  }
  return parsed.data;
}
