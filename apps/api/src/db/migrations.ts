import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const DEFAULT_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies pending migrations to each database in turn. */
export async function migrateAll(urls: string[], migrationsFolder = DEFAULT_DIR, log: (msg: string) => void = console.log) {
  for (const url of urls) {
    const { db, sql } = createDb(url);
    try {
      await migrate(db, { migrationsFolder: migrationsFolder || DEFAULT_DIR });
    } finally {
      await sql.end();
    }
    log(`Migrations applied: ${new URL(url).pathname.slice(1)}`);
  }
}
