import { EMPTY_RETIREMENT_PLAN } from '@meld/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, liabilities, manualAssets, transactions } from '../db/schema';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { saveProfile } from './profile';
import { getRetirement, saveRetirementPlan } from './retirement';

const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('retirement (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let ids: Record<'k401' | 'joint' | 'college' | 'house', string>;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => {
    await ctx?.sql.end();
  });

  beforeEach(async () => {
    await ctx.reset();
    const [k401, joint, college, house, checking] = await ctx.db
      .insert(accounts)
      .values([
        { source: 'manual', name: '401k', type: 'investment', subtype: '401k', currentBalance: 200000 },
        { source: 'manual', name: 'Joint', type: 'investment', subtype: 'brokerage', currentBalance: 40000, ownershipPercent: 50 },
        { source: 'manual', name: 'College', type: 'investment', subtype: '529', currentBalance: 30000 },
        { source: 'manual', name: 'House fund', type: 'investment', subtype: 'brokerage', currentBalance: 50000 },
        { source: 'manual', name: 'Checking', type: 'depository', currentBalance: 9000 },
        { source: 'manual', name: 'Old IRA', type: 'investment', subtype: 'ira', currentBalance: 999, hidden: true },
      ])
      .returning({ id: accounts.id });
    ids = { k401: k401!.id, joint: joint!.id, college: college!.id, house: house!.id };
    const spend = (date: string, amount: number) => ({
      accountId: checking!.id,
      date,
      amount,
      name: 'Groceries',
      plaidCategoryPrimary: 'FOOD_AND_DRINK',
    });
    await ctx.db.insert(transactions).values([
      spend('2025-10-01', 1000), // first of the last 12 full months
      spend('2026-09-20', 2000),
      spend('2026-10-05', 5000), // month in progress: not counted
      spend('2025-09-30', 7000), // too old
    ]);
  });

  it('lists visible investment accounts at your share, leaving out education accounts', async () => {
    const r = await getRetirement(ctx.db, TODAY);
    expect(r.accounts.map((a) => [a.name, a.value, a.included, a.excludedReason])).toEqual([
      ['401k', 200000, true, null],
      ['House fund', 50000, true, null],
      ['College', 30000, false, 'education'],
      ['Joint', 20000, true, null],
    ]);
    expect(r.plan).toEqual(EMPTY_RETIREMENT_PLAN);
  });

  it('defaults age from the profile and spending from the last 12 full months', async () => {
    expect((await getRetirement(ctx.db, TODAY)).defaults).toEqual({ currentAge: null, birthYear: null, married: false, annualSpending: 3000, annualIncome: null, children: [] });
    await saveProfile(ctx.db, {
      displayName: null,
      birthYear: 1986,
      filingStatus: 'married_joint',
      state: null,
      dependents: 2,
      children: [{ id: 'k1', name: 'Mia', birthYear: 2016 }],
      annualGrossIncome: 180000,
      occupation: null,
      employerBenefits: null,
      goals: null,
    });
    expect((await getRetirement(ctx.db, TODAY)).defaults).toEqual({
      currentAge: 40,
      birthYear: 1986,
      married: true,
      annualSpending: 3000,
      annualIncome: 180000,
      children: [{ id: 'k1', name: 'Mia', birthYear: 2016 }],
    });
  });

  it('lists homes at your share and mortgages with your share of balance and payment', async () => {
    const [mortgage] = await ctx.db
      .insert(accounts)
      .values({ source: 'manual', name: 'Rental mortgage', type: 'mortgage', currentBalance: 300000, ownershipPercent: 50 })
      .returning({ id: accounts.id });
    await ctx.db.insert(liabilities).values({ accountId: mortgage!.id, kind: 'mortgage', interestRatePct: 6.5, minimumPayment: 2400 });
    await ctx.db.insert(manualAssets).values([
      { kind: 'home', name: 'Rental', value: 800000, ownershipPercent: 50 },
      { kind: 'home', name: 'Home', value: 1200000 },
      { kind: 'vehicle', name: 'Car', value: 30000 },
    ]);
    const r = await getRetirement(ctx.db, TODAY);
    expect(r.properties.map((p) => [p.name, p.value])).toEqual([
      ['Home', 1200000],
      ['Rental', 400000],
    ]);
    expect(r.mortgages).toEqual([
      expect.objectContaining({ id: mortgage!.id, balance: 150000, interestRatePct: 6.5, monthlyPayment: 1200 }),
    ]);
  });

  it('saves assumptions and accounts you leave out', async () => {
    const properties = [{ assetId: ids.house, sellAge: 70, mortgageAccountId: null, netRentAnnual: 18000 }];
    const spendingChanges = [
      { label: 'Kids leave home', childId: null, startAge: 58, endAge: null, annualChange: -20000, monthly: false },
      { label: 'Mia leaves home', childId: 'k1', startAge: 18, endAge: null, annualChange: -24000, monthly: true },
    ];
    await saveRetirementPlan(ctx.db, {
      ...EMPTY_RETIREMENT_PLAN,
      retirementAge: 60,
      expectedReturn: 4.5,
      sellingCostPercent: 7,
      excludedAccountIds: [ids.house],
      properties,
      spendingDeclinePercent: 1.5,
      spendingChanges,
    });
    const r = await getRetirement(ctx.db, TODAY);
    expect(r.plan).toMatchObject({ retirementAge: 60, expectedReturn: 4.5, sellingCostPercent: 7, excludedAccountIds: [ids.house], properties, spendingDeclinePercent: 1.5, spendingChanges });
    expect(r.accounts.find((a) => a.id === ids.house)).toMatchObject({ included: false, excludedReason: 'user' });
    // Saving again replaces the row.
    await saveRetirementPlan(ctx.db, EMPTY_RETIREMENT_PLAN);
    expect((await getRetirement(ctx.db, TODAY)).plan).toEqual(EMPTY_RETIREMENT_PLAN);
  });
});
