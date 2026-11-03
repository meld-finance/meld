import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SecurityProfile } from '@meld/shared';
import type { AIProvider } from '../ai/provider';
import { accounts, balanceSnapshots, holdings, investmentTransactions, securities } from '../db/schema';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { getInvestmentIncome, getInvestmentsSummary, profileSecurities } from './investments';

const TODAY = '2026-10-27';
const FUND: SecurityProfile = { category: 'US total market', assetClasses: { us_stocks: 1 }, sectors: { technology: 1 }, regions: {}, bondTypes: {} };

describe.skipIf(!testDatabaseUrl)('investments (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let ids: { brokerage: string; joint: string; hidden: string; fund: string; cash: string };

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => {
    await ctx?.sql.end();
  });

  beforeEach(async () => {
    await ctx.reset();
    const db = ctx.db;
    const [brokerage, joint, hidden] = await db
      .insert(accounts)
      .values([
        { source: 'manual', name: 'Brokerage', type: 'investment', subtype: 'brokerage', currentBalance: 12000 },
        { source: 'manual', name: 'Joint', type: 'investment', subtype: 'brokerage', currentBalance: 4000, ownershipPercent: 50 },
        { source: 'manual', name: 'Old IRA', type: 'investment', subtype: 'ira', currentBalance: 999, hidden: true },
      ])
      .returning({ id: accounts.id });
    const [fund, cash] = await db
      .insert(securities)
      .values([
        { tickerSymbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf' },
        { tickerSymbol: 'CUR:USD', name: 'Cash', type: 'cash' },
      ])
      .returning({ id: securities.id });
    ids = { brokerage: brokerage!.id, joint: joint!.id, hidden: hidden!.id, fund: fund!.id, cash: cash!.id };
    await db.insert(holdings).values([
      { accountId: ids.brokerage, securityId: ids.fund, quantity: 40, institutionValue: 10000, costBasis: 8000 },
      { accountId: ids.brokerage, securityId: ids.cash, quantity: 2000, institutionValue: 2000 },
      { accountId: ids.joint, securityId: ids.fund, quantity: 16, institutionValue: 4000, costBasis: 3000 },
      { accountId: ids.hidden, securityId: ids.fund, quantity: 4, institutionValue: 999 },
    ]);
  });

  it('summarizes holdings at your share, with the six-month change', async () => {
    await ctx.db.insert(balanceSnapshots).values([
      { date: '2026-04-01', totalAssets: 1, totalLiabilities: 0, netWorth: 1, breakdown: [{ type: 'investment', total: 11000 }] },
      { date: '2026-05-01', totalAssets: 1, totalLiabilities: 0, netWorth: 1, breakdown: [{ type: 'investment', total: 12500 }] },
    ]);
    const s = await getInvestmentsSummary(ctx.db, null, TODAY);
    expect(s.totalValue).toBe(14000);
    expect(s.accounts.map((a) => [a.name, a.value])).toEqual([
      ['Brokerage', 12000],
      ['Joint', 2000],
    ]);
    const joint = s.holdings.find((h) => h.accountId === ids.joint)!;
    expect(joint).toMatchObject({ value: 2000, costBasis: 1500, quantity: 8 });
    // Cash needs no lookup; the fund (held in a visible account) does.
    expect(s.holdings.find((h) => h.securityId === ids.cash)!.profile?.category).toBe('Cash');
    expect(s.unprofiled).toBe(1);
    expect(s.canProfile).toBe(false);
    // The snapshot on or before Apr 27, compared with balances now (12000 + half of 4000).
    expect(s.change).toEqual({ since: '2026-04-01', previous: 11000, current: 14000 });
  });

  it('stores AI profiles and marks unrecognized securities so they are not asked about again', async () => {
    const calls: string[][] = [];
    const ai = {
      profileSecurities: async (list: { ticker: string | null }[]) => {
        calls.push(list.map((s) => s.ticker!));
        return [FUND];
      },
    } as unknown as AIProvider;
    expect(await profileSecurities(ctx.db, ai)).toEqual({ profiled: 1, unrecognized: 0 });
    expect(calls).toEqual([['VTI']]);
    const s = await getInvestmentsSummary(ctx.db, ai, TODAY);
    expect(s.unprofiled).toBe(0);
    expect(s.holdings.find((h) => h.securityId === ids.fund)!.profile).toEqual(FUND);
    expect(await profileSecurities(ctx.db, ai)).toEqual({ profiled: 0, unrecognized: 0 });
  });

  it('totals dividends, interest and reinvestment by period and account', async () => {
    const t = (accountId: string, date: string, subtype: string, amount: number) => ({
      accountId,
      date,
      name: subtype,
      type: subtype.includes('reinvestment') ? 'buy' : 'cash',
      subtype,
      amount,
    });
    await ctx.db.insert(investmentTransactions).values([
      t(ids.brokerage, '2026-03-15', 'qualified dividend', -300),
      t(ids.brokerage, '2026-03-15', 'dividend reinvestment', 300),
      t(ids.brokerage, '2026-09-30', 'interest', -20),
      t(ids.joint, '2026-06-30', 'dividend', -100), // half is yours
      t(ids.brokerage, '2025-06-30', 'dividend', -200), // last year, within YTD-to-date
      t(ids.brokerage, '2025-11-30', 'dividend', -80), // last year, after today's date
      t(ids.hidden, '2026-06-30', 'dividend', -999),
      t(ids.brokerage, '2026-07-01', 'buy', 500),
    ]);
    const income = await getInvestmentIncome(ctx.db, TODAY);
    expect(income.ytd).toEqual({ dividends: 350, interest: 20, reinvested: 300 });
    expect(income.previousYtd).toEqual({ dividends: 200, interest: 0, reinvested: 0 });
    expect(income.trailing12).toEqual({ dividends: 430, interest: 20, reinvested: 300 });
    expect(income.months).toHaveLength(24);
    expect(income.months.at(-1)).toEqual({ month: '2026-10', dividends: 0, interest: 0, reinvested: 0 });
    expect(income.months.find((m) => m.month === '2026-03')).toEqual({ month: '2026-03', dividends: 300, interest: 0, reinvested: 300 });
    expect(income.byAccount.map((a) => [a.accountName, a.dividends, a.interest])).toEqual([
      ['Brokerage', 300, 20],
      ['Joint', 50, 0],
    ]);
  });

  it('annualizes each holding’s payouts from the account’s own history', async () => {
    const t = (accountId: string, date: string, subtype: string, amount: number) => ({
      accountId,
      securityId: ids.fund,
      date,
      name: subtype,
      type: 'cash',
      subtype,
      amount,
    });
    await ctx.db.insert(investmentTransactions).values([
      // A full year of history: no scaling.
      t(ids.brokerage, '2025-06-30', 'buy', 1000),
      t(ids.brokerage, '2026-03-15', 'dividend', -300),
      t(ids.brokerage, '2026-09-15', 'dividend', -300),
      // Linked 73 days ago: two payouts scale to a year, at your half.
      t(ids.joint, '2026-08-15', 'buy', 1000),
      t(ids.joint, '2026-08-31', 'dividend', -100),
      t(ids.joint, '2026-09-30', 'dividend', -100),
    ]);
    const income = await getInvestmentIncome(ctx.db, TODAY);
    expect(income.byHolding).toEqual(
      expect.arrayContaining([
        { accountId: ids.brokerage, securityId: ids.fund, annualIncome: 600, days: 365 },
        { accountId: ids.joint, securityId: ids.fund, annualIncome: 500, days: 73 },
      ]),
    );
    expect(income.byHolding).toHaveLength(2);
  });
});
