import {
  claimingFactor,
  EMPTY_RETIREMENT_PLAN,
  estimateSocialSecurityMonthly,
  fullRetirementAgeMonths,
  isEducationAccount,
  mortgagePayoffAge,
  projectRetirement,
  remainingLoanBalance,
  resolvePlan,
  retirementCashFlow,
  saleBreakdown,
  saleProceeds,
  simulateRetirement,
  spendingAt,
  withPlan,
  type Child,
  type RetirementAccount,
  type RetirementInputs,
  type SpendingChange,
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
  spendingChanges: [],
  spendingDeclinePercent: 0,
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

  it('breaks down future value, selling costs, mortgage left, and net proceeds consistently', () => {
    const mortgage = { balance: 200_000, interestRatePct: 6, monthlyPayment: 1199.1 };
    const b = saleBreakdown({ value: 500_000 }, mortgage, 10, 1, 6);
    expect(b.futurePrice).toBe(Math.round(500_000 * 1.01 ** 10));
    expect(b.sellingCosts).toBe(Math.round(500_000 * 1.01 ** 10 * 0.06));
    expect(b.mortgageLeft).toBeGreaterThan(150_000);
    expect(b.mortgageLeft).toBeLessThan(180_000);
    expect(b.proceeds).toBe(saleProceeds({ value: 500_000 }, mortgage, 10, 1, 6));
  });
});

describe('spending over time', () => {
  const flat = { ...base, expectedReturn: 0 };

  it('applies a change from its start age, so one before retirement lowers every withdrawal', () => {
    const kids = { label: 'Kids leave home', kind: 'spending' as const, childId: null, startAge: 55, endAge: null, annualChange: -20_000, monthly: false };
    const p = projectRetirement({ ...flat, spendingChanges: [kids] });
    expect(p.needed).toBe(30 * 40_000);
    expect(p.spendingAtRetirement).toBe(40_000);
  });

  it('applies a change with an end age only inside its window', () => {
    const travel = { label: 'Travel', kind: 'spending' as const, childId: null, startAge: 65, endAge: 70, annualChange: 15_000, monthly: false };
    expect(projectRetirement({ ...flat, spendingChanges: [travel] }).needed).toBe(30 * 60_000 + 5 * 15_000);
    expect(spendingAt({ ...flat, spendingChanges: [travel] }, 70)).toBe(60_000);
  });

  it('never spends less than nothing', () => {
    expect(spendingAt({ ...flat, spendingChanges: [{ label: 'Cut', kind: 'spending' as const, childId: null, startAge: 40, endAge: null, annualChange: -90_000, monthly: false }] }, 70)).toBe(0);
  });

  it('slows spending each year after 75', () => {
    const slow = { ...flat, annualSpending: 100_000, spendingDeclinePercent: 1 };
    expect(spendingAt(slow, 75)).toBe(100_000);
    expect(Math.round(spendingAt(slow, 85))).toBe(90_438); // 100k · 0.99¹⁰
    expect(projectRetirement(slow).needed).toBeLessThan(projectRetirement({ ...slow, spendingDeclinePercent: 0 }).needed);
  });

  it('lasts exactly to life expectancy with changes and the slowdown', () => {
    const i = {
      ...base,
      spendingDeclinePercent: 1,
      spendingChanges: [{ label: 'Mortgage paid off', kind: 'spending' as const, childId: null, startAge: 70, endAge: null, annualChange: -18_000, monthly: false }],
    };
    const needed = projectRetirement(i).needed;
    const p = projectRetirement({ ...i, currentAge: 65, startingBalance: needed });
    expect(p.gap).toBe(0);
    expect(p.depletionAge).toBeNull();
    expect(p.points.at(-1)!.balance).toBeLessThan(10);
  });

  it('finds the age a mortgage is paid off', () => {
    // 30y at 6% on 200k is $1,199.10/mo: paid off in the 30th year.
    expect(mortgagePayoffAge({ balance: 200_000, interestRatePct: 6, monthlyPayment: 1199.11 }, 40)).toBe(70);
    expect(mortgagePayoffAge({ balance: 200_000, interestRatePct: null, monthlyPayment: 1200 }, 40)).toBeNull();
    expect(mortgagePayoffAge({ balance: 200_000, interestRatePct: 6, monthlyPayment: 1000 }, 40)).toBeNull();
  });
});

describe('life events', () => {
  const flat = { ...base, expectedReturn: 0 };
  const event = (e: Partial<SpendingChange>): SpendingChange => ({
    label: 'Event',
    kind: 'spending',
    childId: null,
    startAge: 65,
    endAge: null,
    annualChange: 0,
    monthly: false,
    ...e,
  });

  it('leaves the years before retirement alone for a spending change', () => {
    const college = event({ startAge: 50, endAge: 54, annualChange: 30_000 });
    expect(projectRetirement({ ...flat, spendingChanges: [college] })).toEqual(projectRetirement(flat));
  });

  it('counts income in retirement against spending, and saves what is left over', () => {
    const work = event({ kind: 'income', startAge: 65, endAge: 70, annualChange: 20_000 });
    expect(projectRetirement({ ...flat, spendingChanges: [work] }).needed).toBe(30 * 60_000 - 5 * 20_000);
    const windfall = event({ kind: 'income', startAge: 65, endAge: 66, annualChange: 100_000 });
    // 40k more than the year's spending goes back in.
    expect(projectRetirement({ ...flat, spendingChanges: [windfall] }).needed).toBe(29 * 60_000 - 40_000);
  });

  it('saves income before retirement', () => {
    const job = event({ kind: 'income', startAge: 60, endAge: 62, annualChange: 10_000 });
    expect(projectRetirement({ ...flat, spendingChanges: [job] }).atRetirement).toBe(120_000);
  });

  it('changes contributions only before retirement for a saving change', () => {
    const catchUp = event({ kind: 'saving', startAge: 50, endAge: null, annualChange: 7_500 });
    const p = projectRetirement({ ...flat, annualContribution: 10_000, spendingChanges: [catchUp] });
    expect(p.atRetirement).toBe(100_000 + 25 * 10_000 + 15 * 7_500);
    expect(p.needed).toBe(30 * 60_000);
  });

  it('adds a one-time sum at its age, before or after retirement, ignoring the end age', () => {
    const inheritance = event({ kind: 'once', startAge: 60, endAge: 90, annualChange: 200_000 });
    const roof = event({ kind: 'once', startAge: 75, annualChange: -40_000 });
    const p = projectRetirement({ ...flat, spendingChanges: [inheritance, roof] });
    expect(p.atRetirement).toBe(300_000);
    expect(p.points.find((x) => x.age === 61)!.balance).toBe(300_000);
    expect(p.needed).toBe(30 * 60_000 + 40_000);
  });

  it('runs short when a sum out is more than there is', () => {
    const p = projectRetirement({ ...flat, spendingChanges: [event({ kind: 'once', startAge: 45, annualChange: -150_000 })] });
    expect(p.depletionAge).toBe(45);
    expect(p.points.find((x) => x.age === 45)!.balance).toBe(0);
  });

  it('lasts exactly to life expectancy with every kind of event', () => {
    const i = {
      ...base,
      spendingChanges: [
        event({ kind: 'income', startAge: 65, endAge: 68, annualChange: 15_000 }),
        event({ kind: 'once', startAge: 80, annualChange: -50_000 }),
        event({ kind: 'once', startAge: 85, annualChange: 30_000 }),
      ],
    };
    const needed = projectRetirement(i).needed;
    const p = projectRetirement({ ...i, currentAge: 65, startingBalance: needed });
    expect(p.depletionAge).toBeNull();
    expect(p.points.at(-1)!.balance).toBeLessThan(10);
  });

  it('matches the projection in a simulation with no volatility', () => {
    const i = { ...base, spendingChanges: [event({ kind: 'once', startAge: 70, annualChange: -20_000 }), event({ kind: 'saving', startAge: 45, endAge: 55, annualChange: 5_000 })] };
    const sim = simulateRetirement(i, { trials: 100, volatility: 0, seed: 1 });
    expect(sim.atRetirement.p50).toBe(projectRetirement(i).atRetirement);
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
    defaults: { currentAge: 40, birthYear: 1986, married: false, annualSpending: 72_000, annualIncome: 150_000, children: [] as Child[] },
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

  it('moves changes that follow a child to your ages, dropping those for a child no longer listed', () => {
    const kids = [
      { id: 'mia', name: 'Mia', birthYear: 2016 },
      { id: 'leo', name: null, birthYear: 2020 },
    ];
    const plan = {
      ...EMPTY_RETIREMENT_PLAN,
      spendingChanges: [
        { label: 'Mia leaves home', kind: 'spending' as const, childId: 'mia', startAge: 18, endAge: null, annualChange: -12_000, monthly: false },
        { label: 'Leo’s college', kind: 'spending' as const, childId: 'leo', startAge: 18, endAge: 22, annualChange: 30_000, monthly: false },
        { label: 'Gone', kind: 'spending' as const, childId: 'old', startAge: 18, endAge: null, annualChange: -5_000, monthly: false },
        { label: 'Travel', kind: 'spending' as const, childId: null, startAge: 65, endAge: 70, annualChange: 10_000, monthly: true },
      ],
    };
    const r = resolvePlan(plan, { ...summary, defaults: { ...summary.defaults, children: kids } });
    // Born 1986: Mia turns 18 when you're 48; Leo is at college from your 52 to 56.
    expect(r.inputs!.spendingChanges.map((c) => [c.label, c.childId, c.startAge, c.endAge])).toEqual([
      ['Mia leaves home', null, 48, null],
      ['Leo’s college', null, 52, 56],
      ['Travel', null, 65, 70],
    ]);
  });

  it('reports what it can’t default', () => {
    const r = resolvePlan(EMPTY_RETIREMENT_PLAN, { ...summary, defaults: { currentAge: null, birthYear: null, married: false, annualSpending: null, annualIncome: null, children: [] } });
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

describe('simulateRetirement', () => {
  const settings = { trials: 500, volatility: 12, seed: 7 };

  it('matches the projection when returns never vary', () => {
    for (const inputs of [base, { ...base, annualSpending: 30_000 }]) {
      const p = projectRetirement(inputs);
      const sim = simulateRetirement(inputs, { ...settings, trials: 100, volatility: 0 });
      expect(sim.successRate).toBe(p.depletionAge === null ? 1 : 0);
      expect(sim.medianDepletionAge).toBe(p.depletionAge);
      expect(sim.bands.map((b) => ({ age: b.age, balance: b.p10 }))).toEqual(p.points);
      expect(sim.bands.map((b) => b.p90)).toEqual(p.points.map((x) => x.balance));
      expect(sim.atRetirement.p50).toBe(p.atRetirement);
    }
  });

  it('gives the same result for the same seed, and a different one for another', () => {
    expect(simulateRetirement(base, settings)).toEqual(simulateRetirement(base, settings));
    expect(simulateRetirement(base, { ...settings, seed: 8 }).bands).not.toEqual(simulateRetirement(base, settings).bands);
  });

  it('succeeds less often as spending rises', () => {
    const rate = (annualSpending: number) => simulateRetirement({ ...base, startingBalance: 500_000, annualSpending }, settings).successRate;
    expect(rate(20_000)).toBeGreaterThan(rate(40_000));
    expect(rate(40_000)).toBeGreaterThan(rate(60_000));
    expect(rate(20_000)).toBeLessThanOrEqual(1);
    expect(rate(1_000_000)).toBe(0);
  });

  it('averages the expected return', () => {
    // A year of growth only: the mean balance after it is 100k × (1 + expected return).
    const sim = simulateRetirement({ ...base, currentAge: 64, retirementAge: 65, lifeExpectancy: 65 }, { ...settings, trials: 10_000 });
    const after = sim.bands[1]!;
    expect(after.p50).toBeLessThan(105_000); // lognormal: the median sits below the mean
    expect(after.p50).toBeGreaterThan(102_000);
    expect(after.p90 - after.p10).toBeGreaterThan(25_000); // about ±1.28 × 12% × 100k
    expect(after.p90 - after.p10).toBeLessThan(35_000);
  });

  it('orders the percentiles and widens with time', () => {
    const sim = simulateRetirement(base, settings);
    for (const b of sim.bands) {
      expect(b.p10).toBeLessThanOrEqual(b.p25);
      expect(b.p25).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p75);
      expect(b.p75).toBeLessThanOrEqual(b.p90);
    }
    const spread = (age: number) => {
      const b = sim.bands.find((x) => x.age === age)!;
      return b.p90 - b.p10;
    };
    expect(spread(60)).toBeGreaterThan(spread(45));
    expect(sim.endingBalance).toEqual(expect.objectContaining({ p50: sim.bands.at(-1)!.p50 }));
  });
});

describe('withPlan', () => {
  const account = (id: string, excludedReason: RetirementAccount['excludedReason']): RetirementAccount => ({
    id,
    name: id,
    institutionName: null,
    subtype: excludedReason === 'education' ? '529' : '401k',
    taxTreatment: 'unknown',
    value: 1000,
    included: excludedReason === null,
    excludedReason,
  });

  it('counts accounts as another plan does, leaving education accounts out', () => {
    const summary = { accounts: [account('a', 'user'), account('b', null), account('c', 'education')] };
    const counted = withPlan(summary, { excludedAccountIds: ['b', 'c'] }).accounts;
    expect(counted.map((a) => [a.id, a.included, a.excludedReason])).toEqual([
      ['a', true, null],
      ['b', false, 'user'],
      ['c', false, 'education'],
    ]);
  });
});

describe('retirementCashFlow', () => {
  it('breaks down pre-retirement saving and retirement spending, income, withdrawals, and lumps', () => {
    const rows = retirementCashFlow({
      ...base,
      currentAge: 60,
      retirementAge: 62,
      lifeExpectancy: 70,
      annualContribution: 20_000,
      annualSpending: 80_000,
      socialSecurityAnnual: 30_000,
      socialSecurityAge: 67,
      pensionAnnual: 10_000,
      sales: [{ name: 'Rental', age: 65, proceeds: 250_000, netRentAnnual: 12_000 }],
      spendingChanges: [
        { label: 'Catch-up', kind: 'saving', childId: null, startAge: 61, endAge: 62, annualChange: 7_500, monthly: false },
        { label: 'Part-time', kind: 'income', childId: null, startAge: 62, endAge: 64, annualChange: 15_000, monthly: false },
        { label: 'Roof', kind: 'once', childId: null, startAge: 63, endAge: null, annualChange: -25_000, monthly: false },
      ],
    });
    expect(rows).toHaveLength(11);
    // Working years: saving + rent (+ catch-up at 61), spending/pension/withdrawal are 0.
    expect(rows.find((r) => r.age === 60)).toEqual({
      age: 60,
      retired: false,
      spending: 0,
      socialSecurity: 0,
      pension: 0,
      rent: 12_000,
      eventIncome: 0,
      saving: 32_000,
      withdrawal: 0,
      lump: 0,
    });
    expect(rows.find((r) => r.age === 61)?.saving).toBe(39_500);
    // First year retired (62): spending 80k, pension 10k, rent 12k, eventIncome 15k -> withdrawal 43k.
    expect(rows.find((r) => r.age === 62)).toEqual({
      age: 62,
      retired: true,
      spending: 80_000,
      socialSecurity: 0,
      pension: 10_000,
      rent: 12_000,
      eventIncome: 15_000,
      saving: 0,
      withdrawal: 43_000,
      lump: 0,
    });
    // One-time roof at 63.
    expect(rows.find((r) => r.age === 63)?.lump).toBe(-25_000);
    // Sale at 65 stops rent from 65 onward and records lump proceeds.
    expect(rows.find((r) => r.age === 65)).toMatchObject({ rent: 0, lump: 250_000, withdrawal: 70_000 });
    // Social Security starts at 67.
    expect(rows.find((r) => r.age === 67)).toMatchObject({ socialSecurity: 30_000, pension: 10_000, withdrawal: 40_000 });
  });
});
