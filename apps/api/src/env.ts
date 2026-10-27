import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean));

const PlaidEnv = z.enum(['sandbox', 'production']);

const EnvSchema = z
  .object({
    /** One database per Plaid environment, so sandbox and real data never mix. */
    SANDBOX_DATABASE_URL: z.url().optional(),
    PRODUCTION_DATABASE_URL: z.url().optional(),
    /** Overrides the per-environment URL (tests point this at the test DB). */
    DATABASE_URL: z.url().optional(),
    API_PORT: z.coerce.number().default(4000),
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
    PLAID_COUNTRY_CODES: csv,

    AI_PROVIDER: z.enum(['anthropic']).default('anthropic'),
    ANTHROPIC_API_KEY: z.string().default(''),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
    /** Property value lookups are a chain of web searches; a fast model finishes them several times sooner. */
    ANTHROPIC_LOOKUP_MODEL: z.string().default('claude-haiku-5-5'),

    /** Uploaded documents; defaults to <repo>/data/documents. */
    DOCUMENTS_DIR: z.string().default(''),
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
