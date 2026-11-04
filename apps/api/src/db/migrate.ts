import { configuredDatabaseUrls } from '../env';
import { migrateAll } from './migrations';

// Migrates every configured database (sandbox and production), plus DATABASE_URL if set.
const urls = [...new Set([...configuredDatabaseUrls(), process.env.DATABASE_URL].filter((u): u is string => !!u))];
if (!urls.length) throw new Error('Set SANDBOX_DATABASE_URL and/or PRODUCTION_DATABASE_URL');

await migrateAll(urls, process.env.MIGRATIONS_DIR);
