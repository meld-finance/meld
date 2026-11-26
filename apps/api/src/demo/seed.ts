import { like, max, sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import { localDate } from '../lib/networth';
import type { FetchCloses } from '../lib/prices';
import { addDays } from '../lib/recurring';
import { evaluateAlerts } from '../services/alerts';
import { recordSnapshot } from '../services/overview';
import { buildDemoData, DEFAULT_PRICES, DEMO_ID_PREFIX } from './data';

/** Demo data this many days old is rebuilt, so bills, budgets and alerts stay current. */
const STALE_DAYS = 2;
/** Today's prices are nice to have, not worth a slow start. */
const PRICE_TIMEOUT_MS = 4_000;

/** Creates the demo database if it isn't there yet (Docker installs from before demo data existed). */
export async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unexpected database name: ${name}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const sqlClient = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await sqlClient`select 1 from pg_database where datname = ${name}`;
    if (!rows.length) await sqlClient.unsafe(`create database "${name}"`);
  } finally {
    await sqlClient.end();
  }
}

/** Whether the database holds anything other than demo data, which seeding would wipe. */
async function hasRealData(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.plaidItems)
    .where(sql`${schema.plaidItems.plaidItemId} not like ${`${DEMO_ID_PREFIX}%`}`);
  return (row?.n ?? 0) > 0;
}

/** Today's close for each demo ticker, falling back to the built-in prices. */
async function todaysPrices(fetchCloses: FetchCloses | undefined, today: string): Promise<Record<string, number>> {
  if (!fetchCloses) return DEFAULT_PRICES;
  const from = addDays(today, -10);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PRICE_TIMEOUT_MS));
  const entries = await Promise.all(
    Object.keys(DEFAULT_PRICES).map(async (ticker) => {
      const closes = await Promise.race([fetchCloses(ticker, from, today).catch(() => null), timeout]);
      const latest = closes && Object.entries(closes).sort(([a], [b]) => a.localeCompare(b)).at(-1)?.[1];
      return [ticker, latest || DEFAULT_PRICES[ticker]!] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** Inserts in batches, since a single insert of thousands of rows can pass Postgres's parameter limit. */
async function insertAll<T extends Record<string, unknown>>(db: Db, table: Parameters<Db['insert']>[0], rows: T[], size = 500) {
  for (let i = 0; i < rows.length; i += size) await db.insert(table).values(rows.slice(i, i + size) as never);
}

/**
 * Fills the demo database with a made-up household, replacing what's there. Refuses if the
 * database has real linked banks, so pointing demo mode at the wrong database can't lose data.
 */
export async function seedDemo(db: Db, options: { today?: string; fetchCloses?: FetchCloses } = {}) {
  const today = options.today ?? localDate();
  if (await hasRealData(db)) throw new Error('The demo database has real linked banks in it; refusing to replace them with demo data.');
  const data = buildDemoData(today, await todaysPrices(options.fetchCloses, today));

  await db.transaction(async (tx) => {
    const rows = await tx.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
    const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
    if (tables) await tx.execute(sql.raw(`truncate ${tables} restart identity cascade`));
    const t = tx as unknown as Db;
    await insertAll(t, schema.institutions, data.institutions);
    await insertAll(t, schema.plaidItems, data.plaidItems);
    await insertAll(t, schema.accounts, data.accounts);
    await insertAll(t, schema.transactions, data.transactions);
    await insertAll(t, schema.securities, data.securities);
    await insertAll(t, schema.holdings, data.holdings);
    await insertAll(t, schema.investmentTransactions, data.investmentTransactions);
    await insertAll(t, schema.liabilities, data.liabilities);
    await insertAll(t, schema.manualAssets, data.manualAssets);
    await insertAll(t, schema.insurancePolicies, data.insurancePolicies);
    await insertAll(t, schema.budgets, data.budgets);
    await tx.insert(schema.userProfile).values(data.profile);
    await insertAll(t, schema.estateDocuments, data.estateDocuments);
    await insertAll(t, schema.estateDesignations, data.estateDesignations);
    await insertAll(t, schema.autopayLinks, data.autopayLinks);
    await insertAll(t, schema.balanceSnapshots, data.balanceSnapshots);
  });

  await recordSnapshot(db, today);
  // Demo alerts stay in the app: nothing is pushed.
  await evaluateAlerts(db, async () => {}, today);
}

/** Seeds the demo database when it's empty or its data has gone stale; returns whether it did. */
export async function ensureDemoData(db: Db, options: { today?: string; fetchCloses?: FetchCloses } = {}): Promise<boolean> {
  const today = options.today ?? localDate();
  const [latest] = await db
    .select({ date: max(schema.transactions.date) })
    .from(schema.transactions)
    .innerJoin(schema.accounts, sql`${schema.accounts.id} = ${schema.transactions.accountId}`)
    .where(like(schema.accounts.plaidAccountId, `${DEMO_ID_PREFIX}%`));
  if (latest?.date && latest.date >= addDays(today, -STALE_DAYS)) return false;
  await seedDemo(db, { ...options, today });
  return true;
}
