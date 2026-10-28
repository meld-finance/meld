import { EMPTY_RETIREMENT_PLAN, isEducationAccount, projectRetirement, resolvePlan, type RetirementInputs } from '@meld/shared';
import { describe, expect, it } from 'vitest';

const base: RetirementInputs = {
  currentAge: 40,
  retirementAge: 65,
  lifeExpectancy: 95,
  startingBalance: 100_000,
  annualContribution: 0,
  expectedReturn: 5,
  annualSpending: 60_000,
  socialSecurityAnnual: 0,
  socialSecurityAge: 67,
  pensionAnnual: 0,
};

describe('projectRetirement', () => {
  it('compounds the balance and contributions until retirement', () => {
    const p = projectRetirement({ ...base, annualContribution: 10_000 });
    // FV = 100k·1.05²⁵ + 10k·(1.05²⁵ − 1)/0.05
    const expected = 100_000 * 1.05 ** 25 + (10_000 * (1.05 ** 25 - 1)) / 0.05;
    expect(p.atRetirement).toBe(Math.round(expected));
    expect(p.points[0]).toEqual({ age: 40, balance: 100_000 });
    expect(p.points.at(-1)!.age).toBe(95);
  });

  it('adds contributions without growth at a 0% return', () => {
    const p = projectRetirement({ ...base, expectedReturn: 0, annualContribution: 20_000, annualSpending: 50_000 });
    expect(p.atRetirement).toBe(600_000);
    expect(p.needed).toBe(1_500_000); // 30 years × 50k
    expect(p.gap).toBe(900_000);
    expect(p.extraMonthly).toBe(3000); // 900k over 25 years
  });

  it('lasts exactly to life expectancy when the balance at retirement equals what is needed', () => {
    const needed = projectRetirement(base).needed;
    const p = projectRetirement({ ...base, currentAge: 65, startingBalance: needed });
    expect(p.gap).toBe(0);
    expect(p.depletionAge).toBeNull();
    expect(p.points.at(-1)!.balance).toBeLessThan(10); // under a dollar of rounding, compounded
    // 50k short at 65 is ~206k short by 94 (50k·1.05²⁹), about 3½ years of withdrawals.
    expect(projectRetirement({ ...base, currentAge: 65, startingBalance: needed - 50_000 }).depletionAge).toBe(91);
  });

  it('counts Social Security only from its start age', () => {
    const r = projectRetirement({ ...base, expectedReturn: 0, socialSecurityAnnual: 24_000, pensionAnnual: 6_000 });
    // Ages 65–66: 54k a year; 67–94: 30k a year.
    expect(r.needed).toBe(2 * 54_000 + 28 * 30_000);
    // Income beyond spending doesn't make the need negative.
    expect(projectRetirement({ ...base, socialSecurityAnnual: 80_000, socialSecurityAge: 65 }).needed).toBe(0);
  });

  it('closes the gap with the suggested extra contribution', () => {
    const p = projectRetirement(base);
    expect(p.gap).toBeGreaterThan(0);
    const after = projectRetirement({ ...base, annualContribution: p.extraMonthly! * 12 });
    expect(Math.abs(after.gap)).toBeLessThan(500); // rounding to whole dollars a month
    expect(after.depletionAge === null || after.depletionAge >= 94).toBe(true);
  });

  it('has no extra contribution once retired', () => {
    const p = projectRetirement({ ...base, currentAge: 70, startingBalance: 10_000 });
    expect(p.atRetirement).toBe(10_000);
    expect(p.extraMonthly).toBeNull();
    expect(p.depletionAge).toBe(70);
  });
});

describe('resolvePlan', () => {
  const summary = {
    defaults: { currentAge: 40, annualSpending: 72_000, annualIncome: 150_000 },
    accounts: [
      { value: 50_000, included: true },
      { value: 9_000, included: false },
    ],
  } as Parameters<typeof resolvePlan>[1];

  it('fills defaults and counts only included accounts plus other savings', () => {
    const r = resolvePlan({ ...EMPTY_RETIREMENT_PLAN, otherSavings: 5_000 }, summary);
    expect(r.inputs).toMatchObject({ retirementAge: 65, lifeExpectancy: 95, expectedReturn: 5, annualSpending: 72_000, startingBalance: 55_000 });
  });

  it('reports what it can’t default', () => {
    const r = resolvePlan(EMPTY_RETIREMENT_PLAN, { ...summary, defaults: { currentAge: null, annualSpending: null, annualIncome: null } });
    expect(r).toEqual({ inputs: null, missing: ['birth year', 'retirement spending'] });
  });
});

describe('isEducationAccount', () => {
  it('matches college and custodial accounts only', () => {
    expect(['529', 'UTMA', 'ugma', 'education savings account', 'resp'].every(isEducationAccount)).toBe(true);
    expect(['roth', '401k', 'brokerage', 'hsa', null].some((s) => isEducationAccount(s))).toBe(false);
  });
});
