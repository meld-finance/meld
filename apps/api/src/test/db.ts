import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../db/client';
import { configuredDatabaseUrls } from '../env';
import { alertChecksSettled } from '../services/alerts';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** Connects to the test DB, applies migrations, and returns a truncate helper. */
export async function setupTestDb() {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is not set');
  // Tests truncate every table; never let them touch a real database.
  if ([...configuredDatabaseUrls(), process.env.DATABASE_URL].includes(testDatabaseUrl)) {
    throw new Error('TEST_DATABASE_URL must differ from the sandbox and production databases');
  }
  const conn = createDb(testDatabaseUrl);
  await migrate(conn.db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });

  async function reset() {
    // A route may have left an alert check running. Truncating under it can deadlock, or the
    // check can write alerts into the next test's data.
    await alertChecksSettled();
    const rows = await conn.db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
    if (tables) await conn.db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
  }

  return { ...conn, reset };
}
