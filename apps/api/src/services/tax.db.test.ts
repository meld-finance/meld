import { EMPTY_TAX_SETTINGS } from '@meld/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, holdings, investmentTransactions, securities, transactions, userProfile } from '../db/schema';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { getChecklistDone, getTaxPlan, getTaxSettings, saveTaxSettings, setChecklistDone } from './tax';

const TODAY = '2026-06-30';

describe.skipIf(!testDatabaseUrl)('tax plan (Postgres)', () => {
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
    await db.insert(userProfile).values({ id: 1, filingStatus: 'married_joint', state: 'CA', annualGrossIncome: 200_000, birthYear: 1987 });
    const [brokerage, ira, k401, checking] = await db
      .insert(accounts)
      .values([
        { source: 'manual', name: 'Joint brokerage', type: 'investment', subtype: 'brokerage', ownershipPercent: 50 },
        { source: 'manual', name: 'Rollover IRA', type: 'investment', subtype: 'ira', currentBalance: 50_000 },
        { source: 'manual', name: '401(k)', type: 'investment', subtype: '401k' },
        { source: 'manual', name: 'Checking', type: 'depository', subtype: 'checking' },
      ])
      .returning({ id: accounts.id });
    const [stocks, bonds] = await db
      .insert(securities)
      .values([
        {
          tickerSymbol: 'VTI',
          name: 'Total Stock Market',
          type: 'etf',
          profile: { category: 'US total market', assetClasses: { us_stocks: 1 }, sectors: {}, regions: {}, bondTypes: {} },
        },
        { tickerSymbol: 'BND', name: 'Total Bond Market', type: 'fixed income' },
      ])
      .returning({ id: securities.id });
    await db.insert(holdings).values([
      { accountId: brokerage!.id, securityId: stocks!.id, quantity: 10, institutionValue: 1_500, costBasis: 2_000 },
      { accountId: ira!.id, securityId: stocks!.id, quantity: 5, institutionValue: 750, costBasis: 500 },
    ]);
    await db.insert(investmentTransactions).values([
      { accountId: brokerage!.id, securityId: stocks!.id, date: '2026-03-15', name: 'Dividend', type: 'cash', subtype: 'dividend', amount: -200 },
      { accountId: ira!.id, securityId: stocks!.id, date: '2026-03-15', name: 'Dividend', type: 'cash', subtype: 'dividend', amount: -999 },
      { accountId: brokerage!.id, securityId: bonds!.id, date: '2026-02-01', name: 'Buy', type: 'buy', subtype: 'buy', quantity: 100, price: 100, amount: 10_000 },
      { accountId: brokerage!.id, securityId: bonds!.id, date: '2026-05-01', name: 'Sell', type: 'sell', subtype: 'sell', quantity: -100, price: 90, amount: -9_000 },
      { accountId: k401!.id, date: '2026-04-01', name: 'Contribution', type: 'cash', subtype: 'contribution', amount: -5_000 },
    ]);
    await db.insert(transactions).values([
      { accountId: checking!.id, date: '2026-02-01', name: 'Interest', amount: -100, plaidCategoryPrimary: 'INCOME', plaidCategoryDetailed: 'INCOME_INTEREST_EARNED' },
      { accountId: checking!.id, date: '2026-06-15', name: 'Payroll', amount: -8_000, plaidCategoryPrimary: 'INCOME', plaidCategoryDetailed: 'INCOME_SALARY' },
      // Moved out of income by the user.
      { accountId: checking!.id, date: '2026-06-16', name: 'Refund', amount: -500, plaidCategoryPrimary: 'INCOME', plaidCategoryDetailed: 'INCOME_SALARY', category: 'TRANSFER_IN' },
    ]);
  });

  it('counts only taxable accounts, at your ownership share', async () => {
    const plan = await getTaxPlan(ctx.db, 2026, TODAY);
    expect(plan.missing).toEqual([]);
    expect(plan.detected).toMatchObject({
      paychecks: 8_000,
      interest: 100,
      qualifiedDividends: 100,
      ordinaryDividends: 0,
      realizedShortTerm: -500,
      realizedLongTerm: 0,
      sales: 1,
      k401Contributions: 5_000,
      k401Accounts: 1,
      traditionalIraBalance: 50_000,
    });
    expect(plan.harvest).toEqual([
      expect.objectContaining({ ticker: 'VTI', accountName: 'Joint brokerage', value: 750, costBasis: 1_000, gain: -250 }),
    ]);
    expect(plan.federal?.agi).toBeGreaterThan(0);
    expect(plan.state?.state).toBe('CA');
    expect(plan.balanceDue).toBeNull();
    expect(plan.suggestions.map((s) => s.id)).toContain('harvest-losses');
  });

  it('saves inputs per year and uses them', async () => {
    await saveTaxSettings(ctx.db, 2026, { ...EMPTY_TAX_SETTINGS, federalWithheld: 10_000, pretax401k: 20_000 });
    expect((await getTaxSettings(ctx.db, 2026)).federalWithheld).toBe(10_000);
    expect(await getTaxSettings(ctx.db, 2025)).toEqual(EMPTY_TAX_SETTINGS);

    const plan = await getTaxPlan(ctx.db, 2026, TODAY);
    expect(plan.income?.pretax401k).toBe(20_000);
    expect(plan.balanceDue).not.toBeNull();
  });

  it('keeps checklist ticks per year, through settings saves', async () => {
    await setChecklistDone(ctx.db, 2026, 'harvest-losses', true);
    await setChecklistDone(ctx.db, 2026, 'fsa', true);
    await setChecklistDone(ctx.db, 2026, 'fsa', false);
    await saveTaxSettings(ctx.db, 2026, { ...EMPTY_TAX_SETTINGS, federalWithheld: 10_000 });
    expect(await getChecklistDone(ctx.db, 2026)).toEqual(['harvest-losses']);
    expect(await getChecklistDone(ctx.db, 2025)).toEqual([]);
    expect((await getTaxSettings(ctx.db, 2026)).federalWithheld).toBe(10_000);

    const plan = await getTaxPlan(ctx.db, 2026, '2026-11-02');
    expect(plan.checklist.find((c) => c.id === 'harvest-losses')).toMatchObject({ due: '2026-12-31', done: true });
    expect(plan.checklist.find((c) => c.id === 'fsa')?.done).toBe(false);
  });

  it('asks for a filing status and income before estimating', async () => {
    await ctx.db.update(userProfile).set({ filingStatus: null, annualGrossIncome: null });
    const plan = await getTaxPlan(ctx.db, 2026, TODAY);
    expect(plan.missing).toEqual(['filingStatus', 'income']);
    expect(plan.federal).toBeNull();
  });

  it('still lists the deadlines that need no estimate', async () => {
    await ctx.db.update(userProfile).set({ filingStatus: null, birthYear: 1950 });
    await setChecklistDone(ctx.db, 2026, 'fsa', true);
    const plan = await getTaxPlan(ctx.db, 2026, '2026-11-02');
    expect(plan.missing).toEqual(['filingStatus']);
    expect(plan.checklist.map((c) => [c.id, c.done])).toEqual([
      ['rmd', false],
      ['fsa', true],
    ]);
    expect((await getTaxPlan(ctx.db, 2026, '2027-01-02')).checklist).toEqual([]);
  });

  it('adds partner income when filing jointly and keeps your own when filing separately', async () => {
    await saveTaxSettings(ctx.db, 2026, { ...EMPTY_TAX_SETTINGS, pretax401k: 0 });
    await ctx.db
      .update(userProfile)
      .set({ filingStatus: 'married_joint', annualGrossIncome: 200_000, partner: { name: 'Jordan', birthYear: 1989, annualGrossIncome: 100_000 } });
    const joint = await getTaxPlan(ctx.db, 2026, TODAY);
    expect(joint.income?.wages).toBe(300_000);

    await ctx.db.update(userProfile).set({ filingStatus: 'married_separate' });
    const separate = await getTaxPlan(ctx.db, 2026, TODAY);
    expect(separate.income?.wages).toBe(200_000);
  });
});
