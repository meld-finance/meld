import {
  claimingFactor,
  EMPTY_RETIREMENT_PLAN,
  estimateSocialSecurityMonthly,
  fullRetirementAgeMonths,
  isEducationAccount,
  projectRetirement,
  remainingLoanBalance,
  resolvePlan,
  saleProceeds,
  type RetirementInputs,
} from '@meld/shared';
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
  sales: [],
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

describe('property sales', () => {
  it('adds proceeds before retirement to the balance at retirement', () => {
    const withSale = projectRetirement({ ...base, expectedReturn: 0, sales: [{ name: 'Condo', age: 60, proceeds: 300_000, netRentAnnual: 10_000 }] });
    // 100k + 300k sale + 20 years of 10k rent (ages 40–59).
    expect(withSale.atRetirement).toBe(600_000);
    expect(withSale.points.find((p) => p.age === 60)!.balance).toBe(600_000);
  });

  it('counts a sale after retirement against what is needed, and rent until then against spending', () => {
    const plain = projectRetirement({ ...base, expectedReturn: 0 });
    const sale = { name: 'Rental', age: 70, proceeds: 250_000, netRentAnnual: 20_000 };
    const p = projectRetirement({ ...base, expectedReturn: 0, sales: [sale] });
    // 5 years of rent (65–69) and the sale both come off what's needed.
    expect(p.needed).toBe(plain.needed - 5 * 20_000 - 250_000);
    expect(p.sales).toEqual([{ name: 'Rental', age: 70, proceeds: 250_000 }]);
  });

  it('lasts exactly to life expectancy with a later sale when the balance matches what is needed', () => {
    const sales = [{ name: 'Rental', age: 75, proceeds: 400_000, netRentAnnual: 0 }];
    const needed = projectRetirement({ ...base, currentAge: 65, startingBalance: 0, sales }).needed;
    const p = projectRetirement({ ...base, currentAge: 65, startingBalance: needed, sales });
    expect(p.gap).toBe(0);
    expect(p.depletionAge).toBeNull();
    expect(p.points.at(-1)!.balance).toBeLessThan(10);
  });

  it('nets out appreciation, selling costs and the mortgage left', () => {
    // 10 years at 2%: 400k → 487,598; less 5% → 463,218; less 100k owed with no terms.
    expect(saleProceeds({ value: 400_000 }, { balance: 100_000, interestRatePct: null, monthlyPayment: null }, 10, 2, 5)).toBe(363_218);
    expect(saleProceeds({ value: 400_000 }, null, 0, 1, 6)).toBe(376_000);
  });
});

describe('remainingLoanBalance', () => {
  it('amortizes a standard mortgage', () => {
    // 30y at 6% on 200k ($1,199.10/mo): after 10 years, what's left is the remaining 240 payments' value.
    expect(remainingLoanBalance(200_000, 6, 1199.1, 120)).toBeCloseTo(1199.1 * ((1 - 1.005 ** -240) / 0.005), 0);
    expect(remainingLoanBalance(200_000, 6, 1199.1, 400)).toBe(0);
  });

  it('assumes no paydown without terms, or when the payment only covers interest', () => {
    expect(remainingLoanBalance(100_000, null, 1000, 60)).toBe(100_000);
    expect(remainingLoanBalance(100_000, 12, 1000, 60)).toBe(100_000);
    expect(remainingLoanBalance(10_000, 0, 1000, 4)).toBe(6000);
  });
});

describe('resolvePlan', () => {
  const RENTAL = '00000000-0000-4000-8000-000000000001';
  const LOAN = '00000000-0000-4000-8000-000000000002';
  const summary = {
    defaults: { currentAge: 40, birthYear: 1986, married: false, annualSpending: 72_000, annualIncome: 150_000 },
    accounts: [
      { value: 50_000, included: true },
      { value: 9_000, included: false },
    ],
    properties: [{ id: RENTAL, name: 'Rental', address: null, value: 500_000 }],
    mortgages: [{ id: LOAN, name: 'Mortgage', institutionName: null, balance: 200_000, interestRatePct: null, monthlyPayment: null }],
  } as Parameters<typeof resolvePlan>[1];

  it('fills defaults and counts only included accounts plus other savings', () => {
    const r = resolvePlan({ ...EMPTY_RETIREMENT_PLAN, otherSavings: 5_000 }, summary);
    expect(r.inputs).toMatchObject({ retirementAge: 65, lifeExpectancy: 95, expectedReturn: 5, annualSpending: 72_000, startingBalance: 55_000 });
  });

  it('turns counted properties into sales, at no earlier than today', () => {
    const r = resolvePlan(
      {
        ...EMPTY_RETIREMENT_PLAN,
        propertyAppreciation: 0,
        properties: [
          { assetId: RENTAL, sellAge: 70, mortgageAccountId: LOAN, netRentAnnual: 12_000 },
          { assetId: '00000000-0000-4000-8000-000000000099', sellAge: 70, mortgageAccountId: null, netRentAnnual: null }, // deleted
        ],
      },
      summary,
    );
    // 500k less 6% selling costs, less the 200k mortgage (no terms, so no paydown).
    expect(r.inputs!.sales).toEqual([{ name: 'Rental', age: 70, proceeds: 270_000, netRentAnnual: 12_000 }]);
    const now = resolvePlan({ ...EMPTY_RETIREMENT_PLAN, properties: [{ assetId: RENTAL, sellAge: 30, mortgageAccountId: null, netRentAnnual: null }] }, summary);
    expect(now.inputs!.sales[0]!.age).toBe(40);
  });

  it('estimates Social Security from income when blank, and adjusts for the claiming age', () => {
    // 150k a year → AIME 12,500 → PIA 3,938/mo at 67.
    expect(resolvePlan(EMPTY_RETIREMENT_PLAN, summary).inputs!.socialSecurityAnnual).toBe(47_256);
    expect(resolvePlan({ ...EMPTY_RETIREMENT_PLAN, socialSecurityAge: 62 }, summary).inputs!.socialSecurityAnnual).toBe(33_079);
    // A statement figure wins over the estimate; 70 is 24% more.
    const typed = { ...EMPTY_RETIREMENT_PLAN, socialSecurityAnnual: 30_000, socialSecurityAge: 70 };
    expect(resolvePlan(typed, summary).inputs!.socialSecurityAnnual).toBe(37_200);
    // No income and nothing typed counts none.
    const noIncome = { ...summary, defaults: { ...summary.defaults, annualIncome: null } };
    expect(resolvePlan(EMPTY_RETIREMENT_PLAN, noIncome).inputs!.socialSecurityAnnual).toBe(0);
  });

  it('reports what it can’t default', () => {
    const r = resolvePlan(EMPTY_RETIREMENT_PLAN, { ...summary, defaults: { currentAge: null, birthYear: null, married: false, annualSpending: null, annualIncome: null } });
    expect(r).toEqual({ inputs: null, missing: ['birth year', 'retirement spending'] });
  });
});

describe('isEducationAccount', () => {
  it('matches college and custodial accounts only', () => {
    expect(['529', 'UTMA', 'ugma', 'education savings account', 'resp'].every(isEducationAccount)).toBe(true);
    expect(['roth', '401k', 'brokerage', 'hsa', null].some((s) => isEducationAccount(s))).toBe(false);
  });
});

describe('Social Security', () => {
  it('raises full retirement age two months a year from 1955 to 1960', () => {
    expect([1950, 1954, 1955, 1957, 1959, 1960, 1990].map(fullRetirementAgeMonths)).toEqual([792, 792, 794, 798, 802, 804, 804]);
  });

  it('cuts the benefit for claiming early and raises it for waiting', () => {
    expect(claimingFactor(1960, 62)).toBeCloseTo(0.7); // 36 months at 5/9% + 24 at 5/12%
    expect(claimingFactor(1960, 67)).toBe(1);
    expect(claimingFactor(1960, 70)).toBeCloseTo(1.24);
    expect(claimingFactor(1954, 62)).toBeCloseTo(0.75);
  });

  it('estimates from pay, capped at the wage base and scaled by years worked', () => {
    expect(estimateSocialSecurityMonthly(150_000, 65, false)).toBe(3938);
    expect(estimateSocialSecurityMonthly(500_000, 65, false)).toBe(4369); // pay above 184,500 isn't counted
    expect(estimateSocialSecurityMonthly(150_000, 40, false)).toBe(2803); // 18 of 35 years
    expect(estimateSocialSecurityMonthly(0, 65, false)).toBe(0);
  });

  it('takes the lower of one earner with a spousal benefit and two equal earners for a couple', () => {
    // One earner: 1.5 × 3,938.21; two earners at 75k: 2 × 2,745.88.
    expect(estimateSocialSecurityMonthly(150_000, 65, true)).toBe(5492);
    // At high pay the wage base caps one earner, so one earner plus spouse is lower.
    expect(estimateSocialSecurityMonthly(400_000, 65, true)).toBe(Math.round(1.5 * 4369.46));
  });
});
