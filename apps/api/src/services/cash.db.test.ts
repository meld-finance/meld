import { EMPTY_CASH_SETTINGS } from '@meld/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, holdings, investmentTransactions, securities, transactions } from '../db/schema';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { getCashPlan, getCashSettings, saveCashSettings, type MarketRates } from './cash';

const TODAY = '2026-11-02';
const rates: MarketRates = {
  fundYield: async (t) => (t === 'SGOV' ? 0.042 : null),
  benchmark: async () => 0.04,
};

describe.skipIf(!testDatabaseUrl)('cash plan (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let ids: Record<'checking' | 'savings' | 'brokerage' | 'ira' | 'card' | 'cd', string>;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => {
    await ctx?.sql.end();
  });

  beforeEach(async () => {
    await ctx.reset();
    const db = ctx.db;
    const [checking, savings, brokerage, ira, card, cd] = await db
      .insert(accounts)
      .values([
        { source: 'manual', name: 'Checking', type: 'depository', subtype: 'checking', currentBalance: 9_000 },
        { source: 'manual', name: 'Joint savings', type: 'depository', subtype: 'savings', currentBalance: 24_000, ownershipPercent: 50 },
        { source: 'manual', name: 'Brokerage', type: 'investment', subtype: 'brokerage' },
        { source: 'manual', name: 'Rollover IRA', type: 'investment', subtype: 'ira' },
        { source: 'manual', name: 'Card', type: 'credit', currentBalance: 800 },
        { source: 'manual', name: 'CD', type: 'depository', subtype: 'cd', currentBalance: 10_000 },
      ])
      .returning({ id: accounts.id });
    ids = { checking: checking!.id, savings: savings!.id, brokerage: brokerage!.id, ira: ira!.id, card: card!.id, cd: cd!.id };

    const [mmf, sgov, usd, vti] = await db
      .insert(securities)
      .values([
        { tickerSymbol: 'VMFXX', name: 'Vanguard Federal Money Market', type: 'cash' },
        { tickerSymbol: 'SGOV', name: 'iShares 0-3 Month Treasury', type: 'etf' },
        { tickerSymbol: 'CUR:USD', name: 'US Dollar', type: 'cash' },
        { tickerSymbol: 'VTI', name: 'Total Stock Market', type: 'etf' },
      ])
      .returning({ id: securities.id });
    await db.insert(holdings).values([
      { accountId: brokerage!.id, securityId: mmf!.id, quantity: 6_000, institutionValue: 6_000 },
      { accountId: brokerage!.id, securityId: sgov!.id, quantity: 50, institutionValue: 5_000 },
      { accountId: brokerage!.id, securityId: vti!.id, quantity: 10, institutionValue: 3_000 },
      { accountId: ira!.id, securityId: usd!.id, quantity: 2_500, institutionValue: 2_500 },
    ]);
    // Three months of savings interest at about 4% on $24,000; none on checking.
    await db.insert(transactions).values([
      { accountId: checking!.id, date: '2026-03-01', name: 'Opening deposit', amount: -100, plaidCategoryPrimary: 'TRANSFER_IN' },
      { accountId: savings!.id, date: '2026-03-01', name: 'Opening deposit', amount: -100, plaidCategoryPrimary: 'TRANSFER_IN' },
      ...['2026-08-31', '2026-09-30', '2026-10-31'].map((date) => ({
        accountId: savings!.id,
        date,
        name: 'Interest paid',
        amount: -80,
        plaidCategoryPrimary: 'INCOME',
        plaidCategoryDetailed: 'INCOME_INTEREST_EARNED',
      })),
      // Spending: $3,000 in each of Aug–Oct, and the current month doesn't count.
      ...['2026-08-10', '2026-09-10', '2026-10-10', '2026-11-01'].map((date) => ({
        accountId: card!.id,
        date,
        name: 'Groceries',
        amount: 3_000,
        plaidCategoryPrimary: 'FOOD_AND_DRINK',
      })),
    ]);
    await db.insert(investmentTransactions).values([
      { accountId: brokerage!.id, securityId: mmf!.id, date: '2026-09-30', name: 'Dividend', type: 'cash', subtype: 'dividend', amount: -20 },
    ]);
  });

  it('finds liquid cash and its rates', async () => {
    const plan = await getCashPlan(ctx.db, rates, TODAY);
    const byName = Object.fromEntries(plan.positions.map((p) => [p.ticker ?? p.accountName, p]));

    expect(Object.keys(byName).sort()).toEqual(['Checking', 'Joint savings', 'Rollover IRA', 'SGOV', 'VMFXX']);
    expect(byName.Checking).toMatchObject({ value: 9_000, apy: 0, apySource: 'interest' });
    expect(byName['Joint savings']!.value).toBe(12_000);
    // August's posting has none before it; September's and October's were earned on $23,840 and $23,920.
    const apy = (interest: number, balance: number, days: number) => (1 + ((interest / balance / days) * 365) / 12) ** 12 - 1;
    expect(byName['Joint savings']!.apy).toBeCloseTo((apy(80, 23_840, 30) + apy(80, 23_920, 31)) / 2, 8);
    expect(byName.SGOV).toMatchObject({ kind: 'fund', apy: 0.042, apySource: 'distributions' });
    expect(byName.VMFXX).toMatchObject({ apy: 0.04, apySource: 'assumed' });
    expect(byName['Rollover IRA']).toMatchObject({ kind: 'sweep', taxAdvantaged: true, apy: null });

    expect(plan.totals.emergency).toBe(32_000);
    expect(plan.totals.taxAdvantaged).toBe(2_500);
    expect(plan.spending).toMatchObject({ monthly: 3_000, source: 'history', months: 3 });
    expect(plan.emergency).toMatchObject({ target: 18_000, gap: 14_000 });

    const ids_ = plan.suggestions.map((s) => s.id);
    expect(ids_).toContain('emergency-extra');
    expect(ids_).toContain(`low-yield:${ids.checking}`);
    expect(ids_).toContain(`idle:${ids.ira}`);
    expect(plan.suggestions.find((s) => s.id === 'emergency-extra')!.detail).toMatch(/\$800 on your credit cards is carried/);
  });

  it('rates each interest posting by the balance that earned it', async () => {
    // Like Ally: interest on the 10th, $20k moved out mid-period, then $30k in after the last posting.
    const [ally] = await ctx.db
      .insert(accounts)
      .values({ source: 'manual', name: 'Online Savings', type: 'depository', subtype: 'savings', currentBalance: 40_000 })
      .returning({ id: accounts.id });
    const tx = (date: string, amount: number, extra: Partial<typeof transactions.$inferInsert> = {}) => ({
      accountId: ally!.id,
      date,
      name: 'Transfer',
      amount,
      ...extra,
    });
    const interest = { name: 'Interest Paid', plaidCategoryDetailed: 'INCOME_INTEREST_EARNED' };
    await ctx.db.insert(transactions).values([
      tx('2026-09-10', -75, interest),
      tx('2026-09-21', 20_000),
      tx('2026-10-10', -43.7, interest),
      tx('2026-10-14', -30_000),
      // Not in today's balance yet.
      tx('2026-11-01', -5_000, { pending: true }),
    ]);
    const plan = await getCashPlan(ctx.db, rates, TODAY);
    // Sep 11–20 at $29,956.30, then $9,956.30 from the transfer through October's posting.
    const balanceDays = 10 * 29_956.3 + 20 * 9_956.3;
    const apy = plan.positions.find((p) => p.key === ally!.id)!.apy;
    expect(apy).toBeCloseTo((1 + ((43.7 / balanceDays) * 365) / 12) ** 12 - 1, 8);
    expect(apy).toBeCloseTo(0.032, 3);
  });

  it('saves settings and applies them', async () => {
    expect(await getCashSettings(ctx.db)).toEqual(EMPTY_CASH_SETTINGS);
    await saveCashSettings(ctx.db, { ...EMPTY_CASH_SETTINGS, emergencyMonths: 12, earmarked: [ids.savings], apyPercent: { [ids.checking]: 1 } });
    const plan = await getCashPlan(ctx.db, rates, TODAY);
    expect(plan.totals.emergency).toBe(20_000);
    expect(plan.emergency).toMatchObject({ targetMonths: 12, target: 36_000, gap: -16_000 });
    expect(plan.positions.find((p) => p.key === ids.checking)).toMatchObject({ apy: 0.01, apySource: 'entered' });
  });
});
