import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, holdings, investmentTransactions, priceHistory, securities } from '../db/schema';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { getInvestmentPerformance } from './performance';

const TODAY = '2026-03-31';

describe.skipIf(!testDatabaseUrl)('investment performance (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => {
    await ctx?.sql.end();
  });

  beforeEach(async () => {
    await ctx.reset();
    const db = ctx.db;
    const [brokerage] = await db
      .insert(accounts)
      .values([
        { source: 'manual', name: 'Brokerage', type: 'investment', subtype: 'brokerage', currentBalance: 1100 },
        { source: 'manual', name: 'Old IRA', type: 'investment', subtype: 'ira', currentBalance: 999, hidden: true },
      ])
      .returning({ id: accounts.id });
    const [fund] = await db
      .insert(securities)
      .values([
        { tickerSymbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf' },
        { tickerSymbol: 'CUR:USD', name: 'Cash', type: 'cash' },
      ])
      .returning({ id: securities.id });
    await db.insert(holdings).values({ accountId: brokerage!.id, securityId: fund!.id, quantity: 10, institutionValue: 1000 });
    await db.insert(investmentTransactions).values([
      { accountId: brokerage!.id, date: '2026-01-05', name: 'Deposit', type: 'cash', subtype: 'deposit', amount: -1000 },
      { accountId: brokerage!.id, securityId: fund!.id, date: '2026-01-06', name: 'Buy', type: 'buy', subtype: 'buy', quantity: 10, price: 90, amount: 900 },
    ]);
  });

  it('fetches closes once for non-cash tickers and splits gains from deposits', async () => {
    const asked: string[] = [];
    const fetchCloses = async (ticker: string) => {
      asked.push(ticker);
      return { '2025-12-01': 90, '2026-03-02': 100 };
    };
    const p = await getInvestmentPerformance(ctx.db, fetchCloses, TODAY);
    expect(asked).toEqual(['VTI']);
    expect(p.periods.find((x) => x.key === 'all')).toMatchObject({ endValue: 1100, contributions: 1000, gain: 100 });

    // Fresh closes are reused.
    await getInvestmentPerformance(ctx.db, fetchCloses, TODAY);
    expect(asked).toEqual(['VTI']);
    const [cached] = await ctx.db.select().from(priceHistory);
    expect(cached).toMatchObject({ ticker: 'VTI', closes: { '2026-03-02': 100 } });
  });

  it('keeps going without prices when the lookup fails', async () => {
    const p = await getInvestmentPerformance(
      ctx.db,
      async () => {
        throw new Error('offline');
      },
      TODAY,
    );
    // Priced from the buy and today's holding instead.
    expect(p.approximated).toEqual(['Vanguard Total Stock Market ETF']);
    expect(p.periods.find((x) => x.key === 'all')).toMatchObject({ endValue: 1100, contributions: 1000, gain: 100 });
  });
});
