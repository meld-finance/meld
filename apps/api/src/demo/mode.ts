import { createDb, type Db } from '../db/client';
import { migrateAll } from '../db/migrations';
import { databaseUrlFor, demoDatabaseUrl, plaidConfigured, type Env } from '../env';
import { HttpError } from '../lib/http';
import { fetchYahooCloses } from '../lib/prices';
import { ensureDatabase, ensureDemoData, seedDemo } from './seed';

export type DbConnection = {
  db: Db;
  sql: { end: () => Promise<unknown> };
};

export type RuntimeMode = {
  /** Active Drizzle DB for the current mode. Capture once per request, never hold across mode switches. */
  getDb: () => Db;
  isDemo: () => boolean;
  demoAvailable: boolean;
  setDemo?: (enabled: boolean, options?: { reset?: boolean }) => Promise<void>;
  close?: () => Promise<void>;
};

const NOOP_SQL = { end: async () => {} };

export function staticRuntimeMode(db: Db, env: Pick<Env, 'MELD_DEMO'>): RuntimeMode {
  return {
    getDb: () => db,
    isDemo: () => env.MELD_DEMO,
    demoAvailable: false,
  };
}

export type DemoModeControllerOptions = {
  env: Env;
  initialDb: Db;
  initialSql?: { end: () => Promise<unknown> };
  createDb?: (url: string) => DbConnection;
  ensureDatabase?: (url: string) => Promise<void>;
  migrate?: (url: string) => Promise<void>;
  ensureDemoData?: (db: Db) => Promise<boolean>;
  seedDemo?: (db: Db) => Promise<void>;
  persistDemo?: (enabled: boolean) => Promise<void>;
  onRealDbReady?: (db: Db) => void | Promise<void>;
};

/**
 * Manages runtime switching between the user's real database and the isolated `meld_demo`
 * database without restarting the API process.
 */
export function createDemoModeController(options: DemoModeControllerOptions): RuntimeMode {
  const {
    env,
    initialDb,
    initialSql = NOOP_SQL,
    createDb: makeDb = createDb,
    ensureDatabase: makeDatabase = ensureDatabase,
    migrate: runMigrate = (url) => migrateAll([url], env.MIGRATIONS_DIR),
    ensureDemoData: ensureDemo = (db) => ensureDemoData(db, { fetchCloses: fetchYahooCloses }),
    seedDemo: rebuildDemo = (db) => seedDemo(db, { fetchCloses: fetchYahooCloses }),
    persistDemo,
    onRealDbReady,
  } = options;

  const realUrl = databaseUrlFor(env, env.PLAID_ENV) ?? (!env.MELD_DEMO ? env.DATABASE_URL : undefined);
  const demoUrl = demoDatabaseUrl(env);
  // Strictly refuse demo mode if it would share the real database URL.
  const demoAvailable = !!demoUrl && demoUrl !== realUrl;

  let demo = env.MELD_DEMO;
  let realConn: DbConnection | null = env.MELD_DEMO ? null : { db: initialDb, sql: initialSql };
  let demoConn: DbConnection | null = env.MELD_DEMO ? { db: initialDb, sql: initialSql } : null;
  let realMigrated = !env.MELD_DEMO || env.MIGRATE_ON_START;

  // Serialize mode switches and resets so concurrent requests cannot interleave DB creation or seeding.
  let pending: Promise<void> = Promise.resolve();

  const runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = pending.then(fn, fn);
    pending = next.then(
      () => {},
      () => {},
    );
    return next;
  };

  async function setDemo(enabled: boolean, { reset = false }: { reset?: boolean } = {}) {
    await runExclusive(async () => {
      if (enabled) {
        if (!demoAvailable || !demoUrl) {
          throw new HttpError(409, 'Demo mode isn’t available because no separate demo database is configured.');
        }
        if (!demoConn) {
          await makeDatabase(demoUrl);
          await runMigrate(demoUrl);
          demoConn = makeDb(demoUrl);
        }
        if (reset) await rebuildDemo(demoConn.db);
        else await ensureDemo(demoConn.db);
        demo = true;
        await persistDemo?.(true);
        return;
      }

      if (!plaidConfigured(env)) {
        throw new HttpError(400, 'Add your Plaid keys first, so Meld can show your own accounts.');
      }
      if (!realUrl) {
        throw new HttpError(409, 'No real database is configured for the current Plaid environment.');
      }
      if (!realConn) {
        if (!realMigrated) {
          await runMigrate(realUrl);
          realMigrated = true;
        }
        realConn = makeDb(realUrl);
        await onRealDbReady?.(realConn.db);
      }
      demo = false;
      await persistDemo?.(false);
    });
  }

  async function close() {
    await pending.catch(() => {});
    const clients = new Set([realConn?.sql, demoConn?.sql].filter((s): s is NonNullable<typeof s> => !!s));
    await Promise.all([...clients].map((s) => s.end()));
  }

  return {
    getDb: () => (demo ? demoConn!.db : realConn!.db),
    isDemo: () => demo,
    demoAvailable,
    setDemo,
    close,
  };
}
