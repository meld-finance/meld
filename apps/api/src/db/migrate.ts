import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { configuredDatabaseUrls } from '../env';
import { createDb } from './client';

// Migrates every configured database (sandbox and production), plus DATABASE_URL if set.
const urls = [...new Set([...configuredDatabaseUrls(), process.env.DATABASE_URL].filter((u): u is string => !!u))];
if (!urls.length) throw new Error('Set SANDBOX_DATABASE_URL and/or PRODUCTION_DATABASE_URL');

for (const url of urls) {
  const { db, sql } = createDb(url);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  await sql.end();
  console.log(`Migrations applied: ${new URL(url).pathname.slice(1)}`);
}
