import {
  PARTNER_AGE_ID,
  claimedAnnualBenefit,
  claimingFactor,
  EMPTY_RETIREMENT_PLAN,
  estimateAfterTaxIncome,
  estimateIndividualSocialSecurityMonthly,
  estimateSocialSecurityMonthly,
  firstRetireAge,
  fullRetireAge,
  fullRetirementAgeMonths,
  inYourAges,
  isEducationAccount,
  mortgagePayoffAge,
  projectRetirement,
  remainingLoanBalance,
  resolveCoupleSocialSecurity,
  resolvePlan,
  retirementCashFlow,
  retirementLevers,
  saleBreakdown,
  saleProceeds,
  simulateRetirement,
  socialSecurityResolver,
  spendingAt,
  spousalClaimingFactor,
  withPlan,
  yearPhase,
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
      phase: 'working',
      partnerAge: null,
      retired: false,
      spending: 0,
      workingIncome: 0,
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
      phase: 'retired',
      partnerAge: null,
      retired: true,
      spending: 80_000,
      workingIncome: 0,
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

describe('partner Social Security & after-tax bridge estimate', () => {
  it('caps spousal claiming factor at FRA with no delayed credits', () => {
    expect(spousalClaimingFactor(1960, 62)).toBeCloseTo(0.65);
    expect(spousalClaimingFactor(1960, 67)).toBe(1);
    expect(spousalClaimingFactor(1960, 70)).toBe(1);
    expect(claimedAnnualBenefit(0, 20_000, 1960, 70)).toBe(20_000);
    expect(claimedAnnualBenefit(20_000, 0, 1960, 70)).toBe(24_800);
  });

  it('computes individual benefits and spousal top-ups accurately', () => {
    // Dual high earners ($250k each) each earn full wage-base credits.
    const dual = resolveCoupleSocialSecurity({
      married: true,
      yourBirthYear: 1986,
      yourIncome: 250_000,
      yourRetireAge: 65,
      yourOverrideAnnual: null,
      yourClaimAge: 67,
      partnerBirthYear: 1988,
      partnerIncome: 250_000,
      partnerRetireAge: 65,
      partnerOverrideAnnual: null,
      partnerClaimAge: 67,
    });
    expect(dual.yours.ownFullAnnual).toBe(12 * estimateIndividualSocialSecurityMonthly(250_000, 65));
    expect(dual.partner.ownFullAnnual).toBe(dual.yours.ownFullAnnual);
    expect(dual.yours.spousalExcessAnnual).toBe(0);
    expect(dual.partner.spousalExcessAnnual).toBe(0);

    // Stay-at-home spouse receives 50% spousal benefit when married, and none when unmarried.
    const singleEarner = resolveCoupleSocialSecurity({
      married: true,
      yourBirthYear: 1986,
      yourIncome: 150_000,
      yourRetireAge: 65,
      yourOverrideAnnual: null,
      yourClaimAge: 70,
      partnerBirthYear: 1988,
      partnerIncome: 0,
      partnerRetireAge: 65,
      partnerOverrideAnnual: null,
      partnerClaimAge: 70,
    });
    expect(singleEarner.partner.ownFullAnnual).toBe(0);
    expect(singleEarner.partner.spousalExcessAnnual).toBe(Math.round(0.5 * singleEarner.yours.ownFullAnnual));
    expect(singleEarner.partner.estimated).toBe(true);
    expect(singleEarner.partner.claimedAnnual).toBe(singleEarner.partner.spousalExcessAnnual); // capped at FRA even at 70
    expect(singleEarner.yours.claimedAnnual).toBe(Math.round(singleEarner.yours.ownFullAnnual * 1.24));

    const unmarried = resolveCoupleSocialSecurity({
      married: false,
      yourBirthYear: 1986,
      yourIncome: 150_000,
      yourRetireAge: 65,
      yourOverrideAnnual: null,
      yourClaimAge: 67,
      partnerBirthYear: 1988,
      partnerIncome: 0,
      partnerRetireAge: 65,
      partnerOverrideAnnual: null,
      partnerClaimAge: 67,
    });
    expect(unmarried.partner.spousalExcessAnnual).toBe(0);
    expect(unmarried.partner.claimedAnnual).toBe(0);

    // Explicit $0 override is respected and suppresses spousal top-up.
    const zeroOverride = resolveCoupleSocialSecurity({
      married: true,
      yourBirthYear: 1986,
      yourIncome: 150_000,
      yourRetireAge: 65,
      yourOverrideAnnual: null,
      yourClaimAge: 67,
      partnerBirthYear: 1988,
      partnerIncome: 0,
      partnerRetireAge: 65,
      partnerOverrideAnnual: 0,
      partnerClaimAge: 67,
    });
    expect(zeroOverride.partner.fullAnnual).toBe(0);
    expect(zeroOverride.partner.estimated).toBe(false);
  });

  it('estimates after-tax bridge income by filing status and state', () => {
    expect(estimateAfterTaxIncome(0, 'married_joint', 'CA')).toBe(0);
    const tx = estimateAfterTaxIncome(120_000, 'married_joint', 'TX');
    const ny = estimateAfterTaxIncome(120_000, 'married_joint', 'NY');
    const ca = estimateAfterTaxIncome(120_000, 'married_joint', 'CA');
    expect(tx).toBeGreaterThan(ca);
    expect(tx).toBeGreaterThan(ny);
    expect(ca).toBeGreaterThan(70_000);
    expect(ca).toBeLessThan(110_000);
  });
});

describe('staggered partner retirement', () => {
  const coupleSummary = {
    defaults: {
      currentAge: 40,
      birthYear: 1986,
      married: true,
      annualSpending: 100_000,
      annualIncome: 250_000,
      yourIncome: 150_000,
      filingStatus: 'married_joint',
      state: 'TX',
      partner: { name: 'Jordan', currentAge: 38, birthYear: 1988, annualIncome: 100_000 },
      children: [] as Child[],
    },
    accounts: [
      {
        id: '00000000-0000-4000-8000-000000000010',
        name: '401k',
        institutionName: null,
        subtype: '401k',
        taxTreatment: 'tax_deferred',
        value: 200_000,
        included: true,
        excludedReason: null,
      },
    ],
    properties: [],
    mortgages: [],
  } satisfies Parameters<typeof resolvePlan>[1];

  it('maps partner ages to your timeline and drops partner events when partner is removed', () => {
    const events: SpendingChange[] = [
      { label: 'Jordan Medicare', kind: 'spending', childId: PARTNER_AGE_ID, startAge: 65, endAge: 68, annualChange: -6_000, monthly: false },
    ];
    // Partner born 1988 vs your 1986 -> partner 65 is your 67.
    expect(inYourAges(events, [], 1986, { birthYear: 1988 })).toEqual([
      { label: 'Jordan Medicare', kind: 'spending', childId: null, startAge: 67, endAge: 70, annualChange: -6_000, monthly: false },
    ]);
    expect(inYourAges(events, [], 1986, null)).toEqual([]);
    expect(inYourAges(events, [], 1986, { birthYear: null })).toEqual([]);
  });

  it('extends life expectancy when a younger partner plans further out', () => {
    const r = resolvePlan(
      { ...EMPTY_RETIREMENT_PLAN, retirementAge: 60, lifeExpectancy: 95, partnerRetirementAge: 65, partnerLifeExpectancy: 98 },
      coupleSummary,
    );
    expect(r.inputs!.yourLifeExpectancy).toBe(95);
    // Partner born 2 years later -> partner 98 is your 100.
    expect(r.inputs!.lifeExpectancy).toBe(100);
    expect(r.inputs!.partner!.retirementAgeInYours).toBe(67);
    expect(r.inputs!.partner!.socialSecurityAgeInYours).toBe(69);
  });

  it('handles shortfall bridge years accurately and preserves exact depletion math', () => {
    // You retire at 58, Jordan retires at 65 (your 67), spending $150k, Jordan's net bridge pay < $150k.
    const r = resolvePlan(
      {
        ...EMPTY_RETIREMENT_PLAN,
        expectedReturn: 5,
        retirementAge: 58,
        lifeExpectancy: 90,
        partnerRetirementAge: 65,
        partnerLifeExpectancy: 90,
        annualContribution: 5_000,
        partnerAnnualContribution: 5_000,
        annualSpending: 150_000,
        socialSecurityAnnual: 24_000,
        socialSecurityAge: 67,
        partnerSocialSecurityAnnual: 18_000,
        partnerSocialSecurityAge: 67,
      },
      coupleSummary,
    );
    const inputs = r.inputs!;
    expect(firstRetireAge(inputs)).toBe(58);
    expect(fullRetireAge(inputs)).toBe(67);
    expect(yearPhase(inputs, 57)).toBe('working');
    expect(yearPhase(inputs, 58)).toBe('bridge');
    expect(yearPhase(inputs, 66)).toBe('bridge');
    expect(yearPhase(inputs, 67)).toBe('retired');

    const p = projectRetirement(inputs);
    expect(p.gap).toBeGreaterThan(0);

    // Exact depletion invariant: starting at `needed` at firstRetireAge lasts exactly to lifeExpectancy.
    const atBridge = projectRetirement({ ...inputs, currentAge: 58, startingBalance: p.needed });
    expect(atBridge.gap).toBe(0);
    expect(atBridge.depletionAge).toBeNull();
    expect(atBridge.points.at(-1)!.balance).toBeLessThan(10);

    // Suggested extra monthly closes the gap.
    const closed = projectRetirement({ ...inputs, annualContribution: inputs.annualContribution + p.extraMonthly! * 12 });
    expect(Math.abs(closed.gap)).toBeLessThan(500);

    // Monte Carlo with zero volatility matches deterministic projection.
    const sim = simulateRetirement(inputs, { trials: 100, volatility: 0, seed: 1 });
    expect(sim.atRetirement.p50).toBe(p.atRetirement);
    expect(sim.bands.map((b) => ({ age: b.age, balance: b.p50 }))).toEqual(p.points);
    expect(sim.successRate).toBe(p.depletionAge === null ? 1 : 0);
  });

  it('handles surplus bridge years (capped at working partner contribution) and exact depletion math', () => {
    // You retire at 55, partner earns $200k in TX (net > $80k spending), saves up to planned contribution.
    const highPartnerSummary: Parameters<typeof resolvePlan>[1] = {
      ...coupleSummary,
      defaults: {
        ...coupleSummary.defaults,
        annualSpending: 80_000,
        annualIncome: 250_000,
        yourIncome: 50_000,
        partner: { name: 'Jordan', currentAge: 38, birthYear: 1988, annualIncome: 200_000 },
      },
    };

    const r = resolvePlan(
      {
        ...EMPTY_RETIREMENT_PLAN,
        expectedReturn: 5,
        retirementAge: 55,
        lifeExpectancy: 90,
        partnerRetirementAge: 62,
        partnerLifeExpectancy: 90,
        annualContribution: 5_000,
        partnerAnnualContribution: 20_000,
        socialSecurityAnnual: 12_000,
        socialSecurityAge: 67,
        partnerSocialSecurityAnnual: 30_000,
        partnerSocialSecurityAge: 67,
      },
      highPartnerSummary,
    );
    const inputs = r.inputs!;
    const cf = retirementCashFlow(inputs);
    const bridgeRow = cf.find((row) => row.age === 58)!;
    expect(bridgeRow).toMatchObject({
      phase: 'bridge',
      partnerAge: 56,
      retired: true,
      spending: 80_000,
      saving: 20_000,
      withdrawal: 0,
    });
    expect(bridgeRow.workingIncome).toBeGreaterThan(100_000);

    // Verify exact depletion invariant across surplus bridge + later retirement.
    const p = projectRetirement(inputs);
    const atFirst = projectRetirement({ ...inputs, currentAge: 55, startingBalance: p.needed });
    expect(atFirst.gap).toBe(0);
    expect(atFirst.depletionAge).toBeNull();
    expect(atFirst.points.at(-1)!.balance).toBeLessThan(10);

    // When surplus is smaller than planned contribution, saving is capped at surplus.
    const tight = resolvePlan(
      {
        ...EMPTY_RETIREMENT_PLAN,
        expectedReturn: 0,
        retirementAge: 55,
        partnerRetirementAge: 60,
        annualSpending: inputs.partner!.bridgeIncomeAnnual - 5_000,
        partnerAnnualContribution: 25_000,
      },
      highPartnerSummary,
    );
    const tightBridge = retirementCashFlow(tight.inputs!).find((row) => row.age === 55)!;
    expect(tightBridge.saving).toBe(5_000);
    expect(tightBridge.withdrawal).toBe(0);
  });

  it('starts each partner pension at their own retirement age and draws full spending if stay-at-home partner retires later', () => {
    const stayAtHomeSummary: Parameters<typeof resolvePlan>[1] = {
      ...coupleSummary,
      defaults: {
        ...coupleSummary.defaults,
        annualIncome: 150_000,
        yourIncome: 150_000,
        partner: { name: 'Jordan', currentAge: 38, birthYear: 1988, annualIncome: 0 },
      },
    };

    const r = resolvePlan(
      {
        ...EMPTY_RETIREMENT_PLAN,
        retirementAge: 60,
        partnerRetirementAge: 65, // your 67
        annualSpending: 90_000,
        pensionAnnual: 10_000,
        partnerPensionAnnual: 6_000,
        socialSecurityAnnual: 0,
        partnerSocialSecurityAnnual: 0,
      },
      stayAtHomeSummary,
    );
    const cf = retirementCashFlow(r.inputs!);
    // Age 60: your pension starts, Jordan earns $0 so full 80k draws from savings.
    expect(cf.find((row) => row.age === 60)).toMatchObject({
      phase: 'bridge',
      workingIncome: 0,
      pension: 10_000,
      withdrawal: 80_000,
    });
    // Age 67: Jordan retires and partner pension joins.
    expect(cf.find((row) => row.age === 67)).toMatchObject({
      phase: 'retired',
      pension: 16_000,
      withdrawal: 74_000,
    });
  });
});

describe('retirementLevers', () => {
  const sim = { trials: 300, volatility: 12, seed: 1 };
  const defaults = { birthYear: 1986, annualIncome: 150_000, married: false };
  const ssFor = socialSecurityResolver({ socialSecurityAnnual: null }, defaults);
  const ssNum = (retireAge: number, claimAge: number) => {
    const res = ssFor(retireAge, claimAge);
    return typeof res === 'number' ? res : res.yours;
  };

  it('solves base shortfall levers consistent with projectRetirement', () => {
    const p = projectRetirement(base);
    const l = retirementLevers(base, { target: { kind: 'base' } });
    expect(l.status).toBe('short');
    expect(l.currentSuccessRate).toBeNull();
    expect(l.longevity).toBeNull();

    expect(l.saving!.monthlyDelta).toBe(p.extraMonthly);
    const afterSave = projectRetirement({ ...base, annualContribution: l.saving!.targetAnnual });
    expect(afterSave.gap).toBeLessThanOrEqual(0);
    expect(afterSave.depletionAge).toBeNull();

    expect(l.retirementAge!.yearsDelta).toBeGreaterThan(0);
    const afterAge = projectRetirement({ ...base, retirementAge: l.retirementAge!.targetAge });
    expect(afterAge.gap).toBeLessThanOrEqual(0);
    expect(afterAge.depletionAge).toBeNull();

    expect(l.spending!.monthlyDelta).toBeLessThan(0);
    const afterSpend = projectRetirement({ ...base, annualSpending: l.spending!.targetAnnual });
    expect(afterSpend.gap).toBeLessThanOrEqual(0);
    expect(afterSpend.depletionAge).toBeNull();
  });

  it('solves delaying Social Security when sufficient and returns null when not enough', () => {
    const at62: RetirementInputs = {
      ...base,
      currentAge: 60,
      retirementAge: 62,
      socialSecurityAge: 62,
      socialSecurityAnnual: ssNum(62, 62),
      annualSpending: 65_000,
    };
    const needAt62 = projectRetirement(at62).needed;
    const modestShortfall = { ...at62, startingBalance: Math.round(needAt62 / 1.05 ** 2) - 20_000 };
    const solvable = retirementLevers(modestShortfall, { target: { kind: 'base' }, context: { socialSecurityFor: ssFor } });
    expect(solvable.socialSecurity).not.toBeNull();
    expect(solvable.socialSecurity!.targetClaimAge).toBeGreaterThan(62);
    expect(solvable.socialSecurity!.targetClaimAge).toBeLessThanOrEqual(70);
    expect(solvable.socialSecurity!.annualBenefitDelta).toBeGreaterThan(0);
    const afterSs = projectRetirement({
      ...modestShortfall,
      socialSecurityAge: solvable.socialSecurity!.targetClaimAge,
      socialSecurityAnnual: ssNum(62, solvable.socialSecurity!.targetClaimAge),
    });
    expect(afterSs.gap).toBeLessThanOrEqual(0);
    expect(afterSs.depletionAge).toBeNull();

    const deepShortfall = { ...at62, startingBalance: 0, annualSpending: 200_000 };
    const unsolvable = retirementLevers(deepShortfall, { target: { kind: 'base' }, context: { socialSecurityFor: ssFor } });
    expect(unsolvable.socialSecurity).toBeNull();
  });

  it('solves Monte Carlo confidence shortfalls and matches simulateRetirement', () => {
    const inputs: RetirementInputs = { ...base, startingBalance: 350_000, annualContribution: 12_000 };
    const expectedRate = simulateRetirement(inputs, sim).successRate;
    const l80 = retirementLevers(inputs, { target: { kind: 'confidence', rate: 0.8 }, context: { simulation: sim, socialSecurityFor: ssFor } });
    const l90 = retirementLevers(inputs, { target: { kind: 'confidence', rate: 0.9 }, context: { simulation: sim, socialSecurityFor: ssFor } });

    expect(l80.currentSuccessRate).toBe(expectedRate);
    if (l80.status === 'short' && l90.status === 'short') {
      expect(l90.saving!.monthlyDelta).toBeGreaterThanOrEqual(l80.saving!.monthlyDelta);
      expect(l90.retirementAge!.targetAge).toBeGreaterThanOrEqual(l80.retirementAge!.targetAge);
      expect(Math.abs(l90.spending!.monthlyDelta)).toBeGreaterThanOrEqual(Math.abs(l80.spending!.monthlyDelta));
    }

    for (const [rate, lever] of [
      [0.8, l80],
      [0.9, l90],
    ] as const) {
      if (lever.status !== 'short') continue;
      if (lever.saving) {
        expect(simulateRetirement({ ...inputs, annualContribution: lever.saving.targetAnnual }, sim).successRate).toBeGreaterThanOrEqual(rate);
      }
      if (lever.retirementAge) {
        const age = lever.retirementAge.targetAge;
        expect(
          simulateRetirement({ ...inputs, retirementAge: age, socialSecurityAnnual: ssNum(age, inputs.socialSecurityAge) }, sim).successRate,
        ).toBeGreaterThanOrEqual(rate);
      }
      if (lever.spending) {
        expect(simulateRetirement({ ...inputs, annualSpending: lever.spending.targetAnnual }, sim).successRate).toBeGreaterThanOrEqual(rate);
      }
      if (lever.socialSecurity) {
        const claim = lever.socialSecurity.targetClaimAge;
        expect(
          simulateRetirement({ ...inputs, socialSecurityAge: claim, socialSecurityAnnual: ssNum(inputs.retirementAge, claim) }, sim).successRate,
        ).toBeGreaterThanOrEqual(rate);
      }
    }
  });

  it('reveals cushion levers when over-prepared in base and confidence modes', () => {
    const rich: RetirementInputs = {
      ...base,
      startingBalance: 900_000,
      annualContribution: 24_000,
      annualSpending: 50_000,
      socialSecurityAnnual: ssNum(65, 67),
    };

    const baseAhead = retirementLevers(rich, { target: { kind: 'base' }, context: { socialSecurityFor: ssFor } });
    expect(baseAhead.status).toBe('ahead');
    expect(baseAhead.socialSecurity).toBeNull();
    // Spend more: tight upper bound.
    expect(baseAhead.spending!.monthlyDelta).toBeGreaterThan(0);
    const maxSpend = projectRetirement({ ...rich, annualSpending: baseAhead.spending!.targetAnnual });
    expect(maxSpend.gap).toBeLessThanOrEqual(0);
    expect(maxSpend.depletionAge).toBeNull();
    const overSpend = projectRetirement({ ...rich, annualSpending: baseAhead.spending!.targetAnnual + 24 });
    expect(overSpend.gap > 0 || overSpend.depletionAge !== null).toBe(true);

    // Retire earlier (< 57, testing < 35 SS working years via resolver).
    expect(baseAhead.retirementAge!.yearsDelta).toBeLessThan(0);
    expect(baseAhead.retirementAge!.targetAge).toBeLessThan(57);
    const early = projectRetirement({
      ...rich,
      retirementAge: baseAhead.retirementAge!.targetAge,
      socialSecurityAnnual: ssNum(baseAhead.retirementAge!.targetAge, rich.socialSecurityAge),
    });
    expect(early.gap).toBeLessThanOrEqual(0);
    expect(early.depletionAge).toBeNull();

    // Coast FIRE down to $0/yr.
    expect(baseAhead.saving!.targetAnnual).toBe(0);
    expect(baseAhead.saving!.monthlyDelta).toBe(-2_000);

    // Confidence cushion checks.
    const mcAhead = retirementLevers(rich, {
      target: { kind: 'confidence', rate: 0.8 },
      context: { simulation: sim, socialSecurityFor: ssFor },
    });
    expect(mcAhead.status).toBe('ahead');
    expect(mcAhead.spending!.monthlyDelta).toBeGreaterThan(0);
    expect(simulateRetirement({ ...rich, annualSpending: mcAhead.spending!.targetAnnual }, sim).successRate).toBeGreaterThanOrEqual(0.8);
    expect(simulateRetirement({ ...rich, annualSpending: mcAhead.spending!.targetAnnual + 24 }, sim).successRate).toBeLessThan(0.8);
    expect(mcAhead.retirementAge!.yearsDelta).toBeLessThan(0);
    expect(
      simulateRetirement(
        {
          ...rich,
          retirementAge: mcAhead.retirementAge!.targetAge,
          socialSecurityAnnual: ssNum(mcAhead.retirementAge!.targetAge, rich.socialSecurityAge),
        },
        sim,
      ).successRate,
    ).toBeGreaterThanOrEqual(0.8);
    expect(mcAhead.longevity).not.toBeNull();
    expect(mcAhead.longevity!.maxAge).toBeGreaterThan(95);
    expect(simulateRetirement({ ...rich, lifeExpectancy: mcAhead.longevity!.maxAge }, sim).successRate).toBeGreaterThanOrEqual(0.8);

    // Partial saving cut when starting balance alone is not Coast FIRE.
    const partial: RetirementInputs = { ...base, startingBalance: 200_000, annualContribution: 30_000, annualSpending: 55_000 };
    const partialAhead = retirementLevers(partial, { target: { kind: 'base' } });
    expect(partialAhead.status).toBe('ahead');
    expect(partialAhead.saving!.targetAnnual).toBeGreaterThan(0);
    expect(partialAhead.saving!.targetAnnual).toBeLessThan(30_000);
    expect(partialAhead.saving!.monthlyDelta).toBeLessThan(0);
    expect(projectRetirement({ ...partial, annualContribution: partialAhead.saving!.targetAnnual }).gap).toBeLessThanOrEqual(0);

    // Longevity capped at 120 when very wealthy.
    const veryRich: RetirementInputs = { ...base, startingBalance: 5_000_000, annualSpending: 60_000 };
    expect(retirementLevers(veryRich, { target: { kind: 'base' } }).longevity).toEqual({
      maxAge: 120,
      yearsExtra: 25,
      capped: true,
    });
    expect(retirementLevers(veryRich, { target: { kind: 'confidence', rate: 0.8 }, context: { simulation: sim } }).longevity).toEqual({
      maxAge: 120,
      yearsExtra: 25,
      capped: true,
    });
  });

  it('reports on_target when right at the goal, and handles already-retired plans', () => {
    const needed = projectRetirement(base).needed;
    const exact = retirementLevers({ ...base, currentAge: 65, startingBalance: needed }, { target: { kind: 'base' } });
    expect(exact.status).toBe('on_target');
    expect(exact.spending).toBeNull();
    expect(exact.saving).toBeNull();
    expect(exact.retirementAge).toBeNull();

    const retiredShort = retirementLevers({ ...base, currentAge: 70, retirementAge: 65, startingBalance: 200_000 }, { target: { kind: 'base' } });
    expect(retiredShort.status).toBe('short');
    expect(retiredShort.saving).toBeNull();
    expect(retiredShort.retirementAge).toBeNull();
    expect(retiredShort.spending!.monthlyDelta).toBeLessThan(0);

    const retiredRich = retirementLevers({ ...base, currentAge: 70, retirementAge: 65, startingBalance: 2_500_000 }, { target: { kind: 'base' } });
    expect(retiredRich.status).toBe('ahead');
    expect(retiredRich.saving).toBeNull();
    expect(retiredRich.retirementAge).toBeNull();
    expect(retiredRich.spending!.monthlyDelta).toBeGreaterThan(0);
    expect(retiredRich.longevity!.maxAge).toBeGreaterThan(95);
  });

  it('supports custom targetAge and handles edge cases cleanly', () => {
    const inputs: RetirementInputs = { ...base, startingBalance: 150_000, annualContribution: 6_000 };
    const at95 = retirementLevers(inputs, { target: { kind: 'base' }, targetAge: 95 });
    const at100 = retirementLevers(inputs, { target: { kind: 'base' }, targetAge: 100 });
    expect(at95.status).toBe('short');
    expect(at100.targetAge).toBe(100);
    expect(at100.saving!.monthlyDelta).toBeGreaterThan(at95.saving!.monthlyDelta);

    // Unsolvable one-time shock at currentAge returns null levers without throwing.
    const impossible = retirementLevers(
      {
        ...base,
        spendingChanges: [{ label: 'Shock', kind: 'once', childId: null, startAge: 40, endAge: null, annualChange: -5_000_000, monthly: false }],
      },
      { target: { kind: 'base' } },
    );
    expect(impossible.status).toBe('short');
    expect(impossible.saving).toBeNull();
    expect(impossible.retirementAge).toBeNull();
    expect(impossible.spending).toBeNull();
    expect(impossible.socialSecurity).toBeNull();

    // Interim depletion before a late property sale: gap at retirement is <= 0, yet it depletes at 65 before the 80 sale.
    const lateSale: RetirementInputs = {
      ...base,
      currentAge: 60,
      retirementAge: 65,
      lifeExpectancy: 95,
      startingBalance: 50_000,
      expectedReturn: 0,
      sales: [{ name: 'Home', age: 80, proceeds: 2_000_000, netRentAnnual: 0 }],
    };
    const saleProj = projectRetirement(lateSale);
    expect(saleProj.gap).toBeLessThanOrEqual(0);
    expect(saleProj.depletionAge).toBe(65);
    const saleLever = retirementLevers(lateSale, { target: { kind: 'base' } });
    expect(saleLever.status).toBe('short');
    expect(saleLever.saving).not.toBeNull();
    const fixed = projectRetirement({ ...lateSale, annualContribution: saleLever.saving!.targetAnnual });
    expect(fixed.depletionAge).toBeNull();
  });

  it('handles staggered-retirement couples with partner-aware Social Security', () => {
    const coupleSummary = {
      defaults: {
        currentAge: 40,
        birthYear: 1986,
        married: true,
        annualSpending: 100_000,
        annualIncome: 250_000,
        yourIncome: 150_000,
        filingStatus: 'married_joint' as const,
        state: 'TX',
        partner: { name: 'Jordan', currentAge: 38, birthYear: 1988, annualIncome: 100_000 },
        children: [] as Child[],
      },
      accounts: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          name: '401k',
          institutionName: null,
          subtype: '401k',
          taxTreatment: 'tax_deferred' as const,
          value: 200_000,
          included: true,
          excludedReason: null,
        },
      ],
      properties: [],
      mortgages: [],
    };
    const couplePlan = {
      ...EMPTY_RETIREMENT_PLAN,
      retirementAge: 58,
      lifeExpectancy: 92,
      partnerRetirementAge: 65,
      partnerLifeExpectancy: 92,
      annualContribution: 5_000,
      partnerAnnualContribution: 5_000,
      annualSpending: 150_000,
      socialSecurityAge: 67,
      partnerSocialSecurityAge: 67,
    };
    const inputs = resolvePlan(couplePlan, coupleSummary).inputs!;
    const coupleSsFor = socialSecurityResolver(couplePlan, coupleSummary.defaults);
    const shortCouple = retirementLevers(inputs, {
      target: { kind: 'base' },
      context: { socialSecurityFor: coupleSsFor },
    });
    expect(shortCouple.status).toBe('short');
    expect(shortCouple.targetAge).toBe(94); // partner 92 is your 94
    expect(shortCouple.saving!.monthlyDelta).toBeGreaterThan(0);
    const fixedCouple = projectRetirement({ ...inputs, annualContribution: shortCouple.saving!.targetAnnual });
    expect(fixedCouple.gap).toBeLessThanOrEqual(0);
    expect(fixedCouple.depletionAge).toBeNull();

    const richPlan = { ...couplePlan, retirementAge: 65, annualSpending: 80_000, otherSavings: 800_000 };
    const richInputs = resolvePlan(richPlan, coupleSummary).inputs!;
    const aheadCouple = retirementLevers(richInputs, {
      target: { kind: 'confidence', rate: 0.8 },
      context: { simulation: sim, socialSecurityFor: socialSecurityResolver(richPlan, coupleSummary.defaults) },
    });
    expect(aheadCouple.status).toBe('ahead');
    expect(aheadCouple.spending!.monthlyDelta).toBeGreaterThan(0);
    expect(aheadCouple.retirementAge!.yearsDelta).toBeLessThan(0);
  });
});
