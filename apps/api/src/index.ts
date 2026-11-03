import { createAIProvider } from './ai/provider';
import { createDb } from './db/client';
import { documents } from './db/schema';
import { loadEnv } from './env';
import { createPlaidClient } from './plaid/client';
import { syncAllItems } from './plaid/sync';
import { pruneOrphanDocuments } from './routes/insurance';
import { buildServer } from './server';
import { evaluateAlerts } from './services/alerts';
import { recordSnapshot } from './services/overview';
import { createStorage } from './storage';

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const env = loadEnv();
const { db } = createDb(env.DATABASE_URL);
const plaid = createPlaidClient(env);
const sync = { db, plaid, encryptionKey: env.ENCRYPTION_KEY };
const ai = createAIProvider(env);
const storage = createStorage(env);
const app = await buildServer({ env, db, plaid, sync, ai, storage });
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
