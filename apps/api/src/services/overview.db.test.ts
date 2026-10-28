import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { accounts, budgets, manualAssets, transactions } from '../db/schema';
import { queryTransactions, totalsByMerchant } from './transactions';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import {
  getBudgetStatus,
  getCashflow,
  getCashflowPeriod,
  getCategoryDetail,
  getNetWorthHistory,
  getSpendingByCategory,
  getSpendingByMonth,
  monthRange,
  recentMonths,
  getSnapshotAsOf,
  recordSnapshot,
  shiftYears,
} from './overview';

describe('month helpers', () => {
  it('computes month ranges across year boundaries', () => {
    expect(monthRange('2026-12')).toEqual(['2026-12-01', '2027-01-01']);
    expect(monthRange('2026-02')).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('lists recent months oldest first', () => {
    expect(recentMonths(3, '2026-01-15')).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('shifts dates by whole years, clamping Feb 29', () => {
    expect(shiftYears('2026-10-27', -1)).toBe('2025-10-27');
    expect(shiftYears('2028-02-29', -1)).toBe('2027-02-28');
  });
});

describe.skipIf(!testDatabaseUrl)('overview queries (Postgres)', () => {
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
    const [checking, card, brokerage, hidden] = await db
      .insert(accounts)
      .values([
        { source: 'manual', name: 'Checking', type: 'depository', currentBalance: 5000 },
        { source: 'manual', name: 'Card', type: 'credit', currentBalance: 800 },
        { source: 'manual', name: 'Brokerage', type: 'investment', currentBalance: 20000 },
        { source: 'manual', name: 'Old', type: 'depository', currentBalance: 999, hidden: true },
      ])
      .returning({ id: accounts.id });

    const t = (
      accountId: string,
      date: string,
      amount: number,
      primary: string,
      extra: Partial<typeof transactions.$inferInsert> = {},
    ) => ({ accountId, date, amount, name: primary, plaidCategoryPrimary: primary, ...extra });

    await db.insert(transactions).values([
      t(checking!.id, '2026-10-01', -3000, 'INCOME'),
      t(card!.id, '2026-10-03', 100, 'FOOD_AND_DRINK'),
      t(card!.id, '2026-10-04', -20, 'FOOD_AND_DRINK'), // refund nets out
      t(checking!.id, '2026-10-05', 500, 'TRANSFER_OUT'), // excluded
      t(checking!.id, '2026-10-06', 400, 'LOAN_PAYMENTS', {
        plaidCategoryDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', // excluded
      }),
      t(checking!.id, '2026-10-07', 2000, 'LOAN_PAYMENTS', {
        plaidCategoryDetailed: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT', // real spending
      }),
      t(checking!.id, '2026-10-08', 700, 'TRANSFER_OUT', { category: 'RENT' }), // override brings it in
      t(brokerage!.id, '2026-10-09', 50, 'GENERAL_MERCHANDISE'), // not a cash account
      t(hidden!.id, '2026-10-10', 75, 'GENERAL_MERCHANDISE'), // hidden account
      t(card!.id, '2026-09-15', 60, 'FOOD_AND_DRINK'),
      t(card!.id, '2026-11-01', 999, 'FOOD_AND_DRINK'), // next month
    ]);
  });

  it('computes monthly cash flow excluding transfers, card payments and non-cash accounts', async () => {
    expect(await getCashflow(ctx.db, 3, '2026-10-15')).toEqual([
      { month: '2026-08', income: 0, spending: 0 },
      { month: '2026-09', income: 0, spending: 60 },
      { month: '2026-10', income: 3000, spending: 2780 },
    ]);
  });

  it('breaks down spending by effective category, largest first', async () => {
    expect(await getSpendingByCategory(ctx.db, '2026-10')).toEqual([
      { category: 'LOAN_PAYMENTS', amount: 2000 },
      { category: 'RENT', amount: 700 },
      { category: 'FOOD_AND_DRINK', amount: 80 },
    ]);
  });

  it('splits monthly spending by category', async () => {
    expect(await getSpendingByMonth(ctx.db, 2, '2026-10')).toEqual([
      { month: '2026-09', categories: [{ category: 'FOOD_AND_DRINK', amount: 60 }] },
      {
        month: '2026-10',
        categories: [
          { category: 'LOAN_PAYMENTS', amount: 2000 },
          { category: 'RENT', amount: 700 },
          { category: 'FOOD_AND_DRINK', amount: 80 },
        ],
      },
    ]);
  });

  it('compares a period with the same dates a year earlier, naming the merchant that moved most', async () => {
    const [checking] = await ctx.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, 'Checking'));
    await ctx.db.insert(transactions).values([
      { accountId: checking!.id, date: '2025-10-01', amount: -2500, name: 'Paycheck', plaidCategoryPrimary: 'INCOME' },
      { accountId: checking!.id, date: '2025-10-03', amount: 40, name: 'Cafe', plaidCategoryPrimary: 'FOOD_AND_DRINK' },
      { accountId: checking!.id, date: '2025-10-04', amount: 500, name: 'Airline', plaidCategoryPrimary: 'TRAVEL' },
      { accountId: checking!.id, date: '2025-10-20', amount: 999, name: 'Late', plaidCategoryPrimary: 'TRAVEL' }, // outside
    ]);

    const period = await getCashflowPeriod(ctx.db, '2026-10-01', '2026-10-15');
    expect(period).toMatchObject({
      previousFrom: '2025-10-01',
      previousTo: '2025-10-15',
      income: 3000,
      spending: 2780,
      previousIncome: 2500,
      previousSpending: 540,
    });
    expect(period.categories.map((c) => c.category)).toEqual(['LOAN_PAYMENTS', 'RENT', 'FOOD_AND_DRINK', 'TRAVEL']);
    expect(period.categories.find((c) => c.category === 'FOOD_AND_DRINK')).toEqual({
      category: 'FOOD_AND_DRINK',
      amount: 80,
      previous: 40,
      driver: { merchant: 'FOOD_AND_DRINK', amount: 80, previous: 0 },
    });
    expect(period.categories.find((c) => c.category === 'TRAVEL')).toMatchObject({ amount: 0, previous: 500 });
  });

  it('drills into a category by subcategory and merchant', async () => {
    const [card] = await ctx.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, 'Card'));
    const [checking] = await ctx.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, 'Checking'));
    const food = { plaidCategoryPrimary: 'FOOD_AND_DRINK' };
    await ctx.db.insert(transactions).values([
      { ...food, accountId: card!.id, date: '2026-10-11', amount: 120, name: 'SAFEWAY #12', merchantName: 'Safeway', plaidCategoryDetailed: 'FOOD_AND_DRINK_GROCERIES' },
      { ...food, accountId: card!.id, date: '2025-10-11', amount: 90, name: 'SAFEWAY #12', merchantName: 'Safeway', plaidCategoryDetailed: 'FOOD_AND_DRINK_GROCERIES' },
      { ...food, accountId: card!.id, date: '2026-10-12', amount: 45, name: 'Taqueria', plaidCategoryDetailed: 'FOOD_AND_DRINK_RESTAURANT' },
      // Moved into food by hand with a subcategory of its own.
      { accountId: checking!.id, date: '2026-10-13', amount: 200, name: 'COSTCO', plaidCategoryPrimary: 'GENERAL_MERCHANDISE', plaidCategoryDetailed: 'GENERAL_MERCHANDISE_SUPERSTORES', category: 'FOOD_AND_DRINK', subcategory: 'FOOD_AND_DRINK_GROCERIES' },
    ]);

    const detail = await getCategoryDetail(ctx.db, 'FOOD_AND_DRINK', '2026-10-01', '2026-10-31');
    expect(detail).toMatchObject({ amount: 445, previous: 90, previousFrom: '2025-10-01' });
    expect(detail.subcategories).toEqual([
      { subcategory: 'FOOD_AND_DRINK_GROCERIES', amount: 320, previous: 90 },
      // The base fixtures (100 − 20 refund) have no subcategory.
      { subcategory: null, amount: 80, previous: 0 },
      { subcategory: 'FOOD_AND_DRINK_RESTAURANT', amount: 45, previous: 0 },
    ]);
    expect(detail.merchants).toEqual([
      { merchant: 'COSTCO', count: 1, amount: 200, previous: 0 },
      { merchant: 'Safeway', count: 1, amount: 120, previous: 90 },
      { merchant: 'FOOD_AND_DRINK', count: 2, amount: 80, previous: 0 },
      { merchant: 'Taqueria', count: 1, amount: 45, previous: 0 },
    ]);

    const groceries = await queryTransactions(ctx.db, {
      category: 'FOOD_AND_DRINK',
      subcategory: 'FOOD_AND_DRINK_GROCERIES',
      cashflow: true,
      from: '2026-10-01',
      to: '2026-10-31',
      limit: 100,
      offset: 0,
    });
    expect(groceries.transactions.map((t) => [t.name, t.subcategory])).toEqual([
      ['COSTCO', 'FOOD_AND_DRINK_GROCERIES'],
      ['SAFEWAY #12', 'FOOD_AND_DRINK_GROCERIES'],
    ]);
  });

  it('reports budget progress, including budgets with no spending', async () => {
    await ctx.db.insert(budgets).values([
      { category: 'FOOD_AND_DRINK', monthlyTarget: 300 },
      { category: 'TRAVEL', monthlyTarget: 200 },
    ]);
    expect(await getBudgetStatus(ctx.db, '2026-10')).toEqual([
      { category: 'FOOD_AND_DRINK', monthlyTarget: 300, spent: 80 },
      { category: 'TRAVEL', monthlyTarget: 200, spent: 0 },
    ]);
  });

  it('counts only your share of a joint account in cash flow, spending and net worth', async () => {
    const [joint] = await ctx.db
      .insert(accounts)
      .values({ source: 'manual', name: 'Joint', type: 'depository', currentBalance: 4000, ownershipPercent: 50 })
      .returning({ id: accounts.id });
    await ctx.db.insert(transactions).values([
      { accountId: joint!.id, date: '2026-10-11', amount: -1000, name: 'Paycheck', plaidCategoryPrimary: 'INCOME' },
      { accountId: joint!.id, date: '2026-10-12', amount: 300, name: 'Grocer', plaidCategoryPrimary: 'FOOD_AND_DRINK' },
    ]);

    expect((await getCashflow(ctx.db, 1, '2026-10-15'))[0]).toEqual({ month: '2026-10', income: 3500, spending: 2930 });
    expect(await getSpendingByCategory(ctx.db, '2026-10')).toContainEqual({ category: 'FOOD_AND_DRINK', amount: 230 });
    expect(await totalsByMerchant(ctx.db, { from: '2026-10-12', to: '2026-10-12' })).toEqual([
      { merchant: 'Grocer', total: 150, count: 1 },
    ]);

    await recordSnapshot(ctx.db, '2026-10-15');
    expect((await getNetWorthHistory(ctx.db, '2026-10-15'))[0]?.assets).toBe(27000);

    await ctx.db.update(accounts).set({ ownershipPercent: null }).where(eq(accounts.id, joint!.id));
    expect(await getSpendingByCategory(ctx.db, '2026-10')).toContainEqual({ category: 'FOOD_AND_DRINK', amount: 380 });
  });

  it('records one net-worth snapshot per day, updating in place', async () => {
    await recordSnapshot(ctx.db, '2026-10-14');
    await ctx.db.insert(manualAssets).values({ kind: 'home', name: 'House', value: 400000 });
    await recordSnapshot(ctx.db, '2026-10-15');
    await recordSnapshot(ctx.db, '2026-10-15');

    // Assets: 5000 + 20000 (+ 400000 home); liabilities: 800 card. Hidden account ignored.
    expect(await getNetWorthHistory(ctx.db, '2026-01-01')).toEqual([
      { date: '2026-10-14', assets: 25000, liabilities: 800, netWorth: 24200 },
      { date: '2026-10-15', assets: 425000, liabilities: 800, netWorth: 424200 },
    ]);
  });

  it('compares against the latest snapshot on or before a date, per item', async () => {
    expect(await getSnapshotAsOf(ctx.db, '2026-10-15')).toBeNull();
    const [house] = await ctx.db
      .insert(manualAssets)
      .values({ kind: 'home', name: 'House', value: 400000, ownershipPercent: 50 })
      .returning({ id: manualAssets.id });
    await recordSnapshot(ctx.db, '2026-09-10');
    await ctx.db.update(accounts).set({ currentBalance: 6000 }).where(eq(accounts.name, 'Checking'));
    await recordSnapshot(ctx.db, '2026-10-15');

    const snapshot = await getSnapshotAsOf(ctx.db, '2026-09-27');
    const [checking] = await ctx.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, 'Checking'));
    expect(snapshot?.date).toBe('2026-09-10');
    expect(snapshot?.byType).toContainEqual({ type: 'depository', total: 5000 });
    expect(snapshot?.balances?.[checking!.id]).toBe(5000);
    expect(snapshot?.balances?.[house!.id]).toBe(200000);
    // Hidden accounts aren't tracked.
    expect(Object.keys(snapshot?.balances ?? {})).toHaveLength(4);
  });
});
