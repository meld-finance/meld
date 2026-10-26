import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Vitest doesn't load .env into process.env; DB tests need TEST_DATABASE_URL.
const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
