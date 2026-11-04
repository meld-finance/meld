import { createAIProvider } from './ai/provider';
import { settingsFromEnv, withSettingsFile } from './config-file';
import { createDb } from './db/client';
import { migrateAll } from './db/migrations';
import { documents } from './db/schema';
import { configuredDatabaseUrls, loadEnv, setupComplete } from './env';
import { createPlaidClient } from './plaid/client';
import { syncAllItems } from './plaid/sync';
import { pruneOrphanDocuments } from './routes/insurance';
import type { SettingsDeps } from './routes/setup';
import { buildServer, buildSetupServer } from './server';
import { evaluateAlerts } from './services/alerts';
import { recordSnapshot } from './services/overview';
import { createStorage } from './storage';

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Exit status that asks whoever runs the API (Docker, the desktop app) to start it again, e.g. after new settings. */
const RESTART_EXIT_CODE = 75;

// Settings saved from the app fill in whatever the environment leaves unset.
const env = loadEnv(withSettingsFile(process.env));
if (env.MIGRATE_ON_START) {
  await migrateAll([...new Set([...configuredDatabaseUrls(), env.DATABASE_URL])], env.MIGRATIONS_DIR);
}

let app: Awaited<ReturnType<typeof buildSetupServer>>;
const settings: SettingsDeps = {
  fromEnv: settingsFromEnv(process.env),
  restart: () => {
    app.log.info('Settings saved; restarting');
    // Let the response finish, then exit for a fresh start with the new settings.
    setTimeout(() => void app.close().finally(() => process.exit(RESTART_EXIT_CODE)), 100);
  },
};

if (!setupComplete(env)) {
  app = await buildSetupServer(env, settings);
  app.log.warn('Meld isn’t set up yet; serving first-run setup only.');
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} else {
  await startMeld();
}

async function startMeld() {
  const { db } = createDb(env.DATABASE_URL);
  const plaid = createPlaidClient(env);
  const sync = { db, plaid, encryptionKey: env.ENCRYPTION_KEY };
  const ai = createAIProvider(env);
  const storage = createStorage(env);
  app = await buildServer({ env, db, plaid, sync, ai, storage, settings });
  if (!ai) app.log.warn('No AI provider configured (ANTHROPIC_API_KEY is empty); AI features are disabled.');

  // Localhost only unless API_HOST says otherwise (the Docker setup listens inside its private network).
  await app.listen({ port: env.API_PORT, host: env.API_HOST });

  // Local stand-in for Plaid webhooks: refresh all items periodically. The snapshot
  // also runs on its own so net-worth history gets a point each day even with no items.
  async function scheduledRefresh() {
    await syncAllItems(sync, (msg) => app.log.warn(msg));
    await recordSnapshot(db).catch((err) => app.log.error({ err }, 'Net worth snapshot failed'));
    // Due dates come closer without any new data, so check even when nothing synced.
    await evaluateAlerts(db).catch((err) => app.log.error({ err }, 'Alert check failed'));
    await pruneOrphanDocuments(db, storage).catch((err) => app.log.error({ err }, 'Document cleanup failed'));
  }
  void recordSnapshot(db).catch((err) => app.log.error({ err }, 'Net worth snapshot failed'));
  void (async () => {
    // Documents uploaded before encryption was added are encrypted once, on the next start.
    // Done before the orphan cleanup so the two never touch the same file at once.
    try {
      const rows = await db.select({ key: documents.storageKey }).from(documents);
      const n = await storage.encryptExisting(rows.map((r) => r.key));
      if (n) app.log.info(`Encrypted ${n} stored document${n === 1 ? '' : 's'}`);
    } catch (err) {
      app.log.error({ err }, 'Encrypting stored documents failed');
    }
    await pruneOrphanDocuments(db, storage).catch((err) => app.log.error({ err }, 'Document cleanup failed'));
  })();
  setInterval(() => void scheduledRefresh(), SYNC_INTERVAL_MS);
}
