import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean));

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: csv,

  APP_PASSPHRASE: z.string().min(8, 'APP_PASSPHRASE must be at least 8 characters'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z
    .string()
    .refine((k) => Buffer.from(k, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded'),

  PLAID_CLIENT_ID: z.string().default(''),
  PLAID_SECRET: z.string().default(''),
  PLAID_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PLAID_PRODUCTS: csv,
  PLAID_OPTIONAL_PRODUCTS: csv,
  PLAID_COUNTRY_CODES: csv,

  AI_PROVIDER: z.enum(['anthropic']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),

  /** Uploaded documents; defaults to <repo>/data/documents. */
  DOCUMENTS_DIR: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment (see .env.example):\n${issues}`);
  }
  return parsed.data;
}
