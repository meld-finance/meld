import type { PlaidApi } from 'plaid';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { migrateAll } from '../db/migrations';
import { accounts, institutions, manualAssets, plaidItems } from '../db/schema';
import { configuredDatabaseUrls, loadEnv } from '../env';
import { buildServer } from '../server';
import type { DocumentStorage } from '../storage';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { createDemoModeController } from './mode';
import { ensureDatabase, ensureDemoData, seedDemo } from './seed';

const key = Buffer.alloc(32, 9).toString('base64');

function deriveDemoTestUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = `/${name}_demo`;
  return url.toString();
}

async function dropDatabase(url: string) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unexpected database name: ${name}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const sqlClient = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    await sqlClient.unsafe(`drop database if exists "${name}" with (force)`);
  } finally {
    await sqlClient.end();
  }
}

describe.skipIf(!testDatabaseUrl)('runtime demo mode isolation (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let demoTestUrl: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    demoTestUrl = deriveDemoTestUrl(testDatabaseUrl!);
    if (configuredDatabaseUrls().includes(demoTestUrl)) {
      throw new Error('Derived demo test database collides with a configured database');
    }
    await dropDatabase(demoTestUrl);
  });

  afterAll(async () => {
    await ctx?.reset();
    await ctx?.sql.end();
    if (demoTestUrl) await dropDatabase(demoTestUrl);
  });

  it('isolates real accounts and demo data across runtime switches', async () => {
    await ctx.reset();

    const [inst] = await ctx.db
      .insert(institutions)
      .values({ plaidInstitutionId: 'inst-real', name: 'Real Bank' })
      .returning({ id: institutions.id });
    const [item] = await ctx.db
      .insert(plaidItems)
      .values({ plaidItemId: 'item-real', institutionId: inst!.id, accessTokenEnc: 'enc' })
      .returning({ id: plaidItems.id });
    await ctx.db.insert(accounts).values({
      source: 'plaid',
      plaidItemId: item!.id,
      plaidAccountId: 'acct-real',
      institutionId: inst!.id,
      name: 'Real Checking',
      type: 'depository',
      subtype: 'checking',
      currentBalance: 12345.67,
    });

    const env = loadEnv({
      SANDBOX_DATABASE_URL: testDatabaseUrl,
      DEMO_DATABASE_URL: demoTestUrl,
      PLAID_ENV: 'sandbox',
      PLAID_CLIENT_ID: 'client-id',
      PLAID_SANDBOX_SECRET: 'sandbox-secret',
      APP_PASSPHRASE_OFF: '1',
      SESSION_SECRET: 'x'.repeat(32),
      ENCRYPTION_KEY: key,
    });

    const runtime = createDemoModeController({
      env,
      initialDb: ctx.db,
      createDb,
      ensureDatabase,
      migrate: (url) => migrateAll([url], env.MIGRATIONS_DIR),
      ensureDemoData: (d) => ensureDemoData(d),
      seedDemo: (d) => seedDemo(d),
    });

    const plaid = {} as PlaidApi;
    const app = await buildServer({
      env,
      db: ctx.db,
      plaid,
      sync: { db: ctx.db, plaid, encryptionKey: key },
      ai: null,
      storage: {} as DocumentStorage,
      runtime,
    });

    try {
      // 1. Starts on real database.
      const realAccounts = (await app.inject({ method: 'GET', url: '/accounts' })).json() as { name: string }[];
      expect(realAccounts.map((a) => a.name)).toEqual(['Real Checking']);

      // 2. Switch to demo mode at runtime.
      const enter = await app.inject({ method: 'PUT', url: '/demo', payload: { enabled: true } });
      expect(enter.statusCode).toBe(200);
      expect(enter.json()).toEqual({ demo: true, plaidReady: true, demoAvailable: true });

      const demoAccounts = (await app.inject({ method: 'GET', url: '/accounts' })).json() as { name: string }[];
      expect(demoAccounts.map((a) => a.name)).not.toContain('Real Checking');
      expect(demoAccounts.length).toBeGreaterThan(1);

      // Plaid Link is blocked while in demo mode.
      expect((await app.inject({ method: 'POST', url: '/plaid/link-token', payload: {} })).statusCode).toBe(409);

      // Creating a manual asset in demo mode only writes to the demo database.
      expect(
        (await app.inject({ method: 'POST', url: '/manual-assets', payload: { kind: 'other', name: 'Demo Art', value: 500 } }))
          .statusCode,
      ).toBe(200);
      expect(await ctx.db.select().from(manualAssets)).toHaveLength(0);

      // 3. Switch back to real accounts: demo asset is gone and real account is untouched.
      const exit = await app.inject({ method: 'PUT', url: '/demo', payload: { enabled: false } });
      expect(exit.statusCode).toBe(200);
      expect(exit.json()).toEqual({ demo: false, plaidReady: true, demoAvailable: true });

      const backAccounts = (await app.inject({ method: 'GET', url: '/accounts' })).json() as { name: string }[];
      expect(backAccounts.map((a) => a.name)).toEqual(['Real Checking']);

      // 4. Reset demo data wipes the temporary demo asset while leaving real data intact.
      expect((await app.inject({ method: 'PUT', url: '/demo', payload: { enabled: true, reset: true } })).statusCode).toBe(200);
      const assetsInDemo = (await app.inject({ method: 'GET', url: '/manual-assets' })).json() as { name: string }[];
      expect(assetsInDemo.map((a) => a.name)).not.toContain('Demo Art');

      const realRows = await ctx.db.select().from(accounts);
      expect(realRows.map((a) => a.name)).toEqual(['Real Checking']);
    } finally {
      await app.close();
      await runtime.close?.();
    }
  });
});
