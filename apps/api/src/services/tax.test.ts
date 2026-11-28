import type { HarvestCandidate, TaxPlan } from '@meld/shared';
import { EMPTY_TAX_SETTINGS, NO_INCOME_TAX_STATES, US_STATES, UserProfile } from '@meld/shared';
import { describe, expect, it } from 'vitest';
import {
  buildChecklist,
  buildSuggestions,
  businessDay,
  paychecksLeft,
  estimateTax,
  marginalRate,
  projectYear,
  qualifiedShare,
  replayPositions,
  type LotTransaction,
  type SuggestionContext,
  type TaxInputs,
} from './tax';

function inputs(over: Partial<TaxInputs>): TaxInputs {
  return {
    year: 2026,
    filingStatus: 'single',
    state: null,
    childrenUnder17: 0,
    dependents: 0,
    grossIncome: 0,
    selfEmployment: 0,
    otherIncome: 0,
    pretax401k: 0,
    hsa: 0,
    iraDeduction: 0,
    selfEmployedRetirement: 0,
    interest: 0,
    ordinaryDividends: 0,
    qualifiedDividends: 0,
    shortTermGains: 0,
    longTermGains: 0,
    propertyTax: 0,
    otherItemized: 0,
    stateFlatRate: null,
    ...over,
  };
}

describe('estimateTax', () => {
  it('runs wages through the 2026 joint brackets', () => {
    const e = estimateTax(inputs({ filingStatus: 'married_joint', grossIncome: 200_000 }));
    // 10% of 24,800 + 12% of 76,000 + 22% of 67,000 on 167,800 taxable.
    expect(e.federal).toMatchObject({ agi: 200_000, deduction: 32_200, taxableIncome: 167_800, ordinaryTax: 26_340, total: 26_340 });
    expect(e.federal.bracketRate).toBe(0.22);
    expect(e.federal.bracketRoom).toBe(43_600);
    expect(e.state).toBeNull();
  });

  it('takes pre-tax 401(k) and HSA money off wages', () => {
    const e = estimateTax(inputs({ filingStatus: 'married_joint', grossIncome: 200_000, pretax401k: 20_000, hsa: 5_000 }));
    expect(e.income.wages).toBe(180_000);
    expect(e.federal.agi).toBe(175_000);
  });

  it('stacks long-term gains on ordinary income at 0% then 15%', () => {
    const e = estimateTax(inputs({ grossIncome: 60_000, longTermGains: 30_000 }));
    // 73,900 taxable: 43,900 ordinary; 5,550 of gains at 0% and 24,450 at 15%.
    expect(e.federal).toMatchObject({ taxableIncome: 73_900, ordinaryIncome: 43_900, ordinaryTax: 5_020, capitalGainsTax: 3_667.5 });
    expect(e.federal.zeroRateGainRoom).toBe(0);
  });

  it('shows the room left for 0% gains', () => {
    const e = estimateTax(inputs({ filingStatus: 'married_joint', grossIncome: 80_000 }));
    expect(e.federal.zeroRateGainRoom).toBe(98_900 - 47_800);
  });

  it('adds net investment income tax and additional Medicare tax over the thresholds', () => {
    const e = estimateTax(inputs({ grossIncome: 250_000, qualifiedDividends: 20_000 }));
    expect(e.federal.netInvestmentIncomeTax).toBe(760);
    expect(e.federal.additionalMedicareTax).toBe(450);
  });

  it('nets losses against gains and caps the rest at $3,000', () => {
    const e = estimateTax(inputs({ grossIncome: 60_000, shortTermGains: -10_000, longTermGains: 2_000 }));
    expect(e.income).toMatchObject({ shortTermGains: -8_000, longTermGains: 0 });
    expect(e.federal.agi).toBe(57_000);
  });

  it('charges self-employment tax and deducts half of it', () => {
    const e = estimateTax(inputs({ grossIncome: 100_000, selfEmployment: 100_000 }));
    const se = 100_000 * 0.9235 * 0.153;
    expect(e.federal.selfEmploymentTax).toBeCloseTo(se, 1);
    expect(e.federal.agi).toBeCloseTo(100_000 - se / 2, 1);
  });

  it('phases out the child tax credit', () => {
    expect(estimateTax(inputs({ filingStatus: 'married_joint', grossIncome: 300_000, childrenUnder17: 2 })).federal.childTaxCredit).toBe(4_400);
    // $10,000 over: $500 less.
    expect(estimateTax(inputs({ filingStatus: 'married_joint', grossIncome: 410_000, childrenUnder17: 2 })).federal.childTaxCredit).toBe(3_900);
  });

  it('uses California 2025 and 2026 tables, with HSA added back and exemption credits', () => {
    // FTB's 2025 worked example: $125,000 taxable on Schedule Y is $4,768.10, less the $307 joint credit.
    const e25 = estimateTax(inputs({ year: 2025, filingStatus: 'married_joint', state: 'CA', grossIncome: 136_412, hsa: 5_000 }));
    expect(e25.state).toMatchObject({ state: 'CA', method: 'tables', tablesYear: null, taxableIncome: 125_000, total: 4_461.1, bracketRate: 0.08 });
    expect(e25.total).toBeCloseTo(e25.federal.total + 4_461.1, 2);

    // 2026 indexed MFJ standard deduction ($11,800) and personal credit ($316).
    const e26 = estimateTax(inputs({ year: 2026, filingStatus: 'married_joint', state: 'CA', grossIncome: 136_800, hsa: 5_000 }));
    expect(e26.state).toMatchObject({ state: 'CA', method: 'tables', tablesYear: null, taxableIncome: 125_000, total: 4_274.24, bracketRate: 0.08 });
  });

  it('adds California’s 1% surcharge over $1M', () => {
    const lower = estimateTax(inputs({ year: 2025, state: 'CA', grossIncome: 1_005_706 }));
    expect(lower.state!.taxableIncome).toBe(1_000_000);
    const higher = estimateTax(inputs({ year: 2025, state: 'CA', grossIncome: 1_105_706 }));
    expect(higher.state!.total - lower.state!.total).toBeCloseTo(100_000 * (0.123 + 0.01), 2);
    expect(higher.state!.bracketRate).toBeCloseTo(0.133);
  });

  it('caps state and local taxes when itemizing', () => {
    const e = estimateTax(inputs({ filingStatus: 'married_joint', state: 'CA', grossIncome: 400_000, propertyTax: 20_000, otherItemized: 10_000 }));
    expect(e.federal.itemized).toBe(true);
    expect(e.federal.deduction).toBe(40_400 + 10_000);
  });

  it('covers all 50 US states and DC for 2025 and 2026', () => {
    expect(US_STATES).toHaveLength(51);
    for (const year of [2025, 2026]) {
      for (const { code } of US_STATES) {
        const res = estimateTax(inputs({ year, state: code, filingStatus: 'married_joint', grossIncome: 150_000, dependents: 1 }));
        expect(res.state).not.toBeNull();
        expect(res.state!.state).toBe(code);
        expect(res.state!.tablesYear).toBeNull();
        if (NO_INCOME_TAX_STATES.has(code)) {
          expect(res.state!.method).toBe('none');
          expect(res.state!.total).toBe(0);
        } else {
          expect(res.state!.method).toBe('tables');
          expect(res.state!.total).toBeGreaterThan(0);
          expect(res.state!.bracketRate).toBeGreaterThan(0);
        }
      }
    }
  });

  it('models progressive, flat, HSA-nonconforming, and surcharge states accurately', () => {
    // NY 2025 -> 2026 middle-class rate reduction.
    const ny25 = estimateTax(inputs({ year: 2025, state: 'NY', grossIncome: 100_000 })).state!;
    const ny26 = estimateTax(inputs({ year: 2026, state: 'NY', grossIncome: 100_000 })).state!;
    expect(ny25.method).toBe('tables');
    expect(ny26.total).toBeLessThan(ny25.total);

    // NJ adds HSA back to state AGI and uses personal exemptions.
    const njNoHsa = estimateTax(inputs({ state: 'NJ', grossIncome: 100_000, hsa: 0 })).state!;
    const njWithHsa = estimateTax(inputs({ state: 'NJ', grossIncome: 100_000, hsa: 4_000 })).state!;
    expect(njWithHsa.taxableIncome).toBe(njNoHsa.taxableIncome);
    expect(njWithHsa.total).toBe(njNoHsa.total);

    // MA 5% base + 4% surtax above $1,107,750 in 2026.
    const maHigh = estimateTax(inputs({ year: 2026, state: 'MA', grossIncome: 1_212_150 })).state!;
    expect(maHigh.taxableIncome).toBe(1_207_750);
    expect(maHigh.bracketRate).toBeCloseTo(0.09);
    expect(maHigh.total).toBeCloseTo(1_207_750 * 0.05 + 100_000 * 0.04, 2);

    // Flat states: IL, PA, CO, UT, NC (2025 -> 2026 cut), OH (2025 -> 2026 2.75% flat above $26,050).
    expect(estimateTax(inputs({ state: 'PA', grossIncome: 100_000 })).state).toMatchObject({ method: 'tables', taxableIncome: 100_000, total: 3_070 });
    expect(estimateTax(inputs({ state: 'IL', grossIncome: 100_000 })).state).toMatchObject({ method: 'tables', taxableIncome: 97_075 });
    expect(estimateTax(inputs({ state: 'CO', grossIncome: 100_000 })).state).toMatchObject({ method: 'tables', taxableIncome: 83_900 });
    expect(estimateTax(inputs({ state: 'UT', grossIncome: 50_000 })).state!.total).toBeLessThan(2_250);
    expect(estimateTax(inputs({ state: 'UT', grossIncome: 100_000 })).state!.total).toBe(4_500);
    expect(estimateTax(inputs({ year: 2026, state: 'NC', grossIncome: 100_000 })).state!.total).toBeLessThan(
      estimateTax(inputs({ year: 2025, state: 'NC', grossIncome: 100_000 })).state!.total,
    );
    expect(estimateTax(inputs({ year: 2026, state: 'OH', grossIncome: 200_000 })).state!.bracketRate).toBeCloseTo(0.0275);
    expect(estimateTax(inputs({ year: 2025, state: 'OH', grossIncome: 200_000 })).state!.bracketRate).toBeCloseTo(0.03125);

    // Representative progressive states: OR, MN, VA, DC.
    for (const st of ['OR', 'MN', 'VA', 'DC']) {
      expect(estimateTax(inputs({ state: st, grossIncome: 120_000 })).state).toMatchObject({ state: st, method: 'tables' });
    }

    // No-income-tax states and custom rate overrides (e.g. NYC local rate).
    expect(estimateTax(inputs({ state: 'TX', grossIncome: 100_000 })).state).toMatchObject({ method: 'none', total: 0 });
    expect(estimateTax(inputs({ state: 'WA', grossIncome: 100_000 })).state).toMatchObject({ method: 'none', total: 0 });
    expect(estimateTax(inputs({ state: 'FL', grossIncome: 100_000 })).state).toMatchObject({ method: 'none', total: 0 });
    expect(estimateTax(inputs({ state: 'NY', stateFlatRate: 9.5, grossIncome: 100_000 })).state).toMatchObject({ method: 'flat', total: 9_500 });
    expect(estimateTax(inputs({ state: 'CA', stateFlatRate: 8, grossIncome: 100_000 })).state).toMatchObject({ method: 'flat', total: 8_000 });
    expect(estimateTax(inputs({ state: null, grossIncome: 100_000 })).state).toBeNull();
  });

  it('validates US state codes on UserProfile', () => {
    const baseProfile = {
      displayName: null,
      birthYear: null,
      filingStatus: null,
      dependents: null,
      children: [],
      annualGrossIncome: null,
      partner: null,
      occupation: null,
      employerBenefits: null,
      goals: null,
    };
    expect(UserProfile.parse({ ...baseProfile, state: 'dc' }).state).toBe('DC');
    expect(UserProfile.safeParse({ ...baseProfile, state: 'ZZ' }).success).toBe(false);
    expect(UserProfile.safeParse({ ...baseProfile, state: 'California' }).success).toBe(false);
  });

  it('finds the combined marginal rate', () => {
    const i = inputs({ filingStatus: 'married_joint', grossIncome: 200_000, state: 'NY', stateFlatRate: 5 });
    expect(marginalRate(i)).toBeCloseTo(0.27, 3);
  });

  it('adds RSU vesting on top of cash pay, or carves it out when profileIncludesRsus is true', () => {
    const added = estimateTax(inputs({ grossIncome: 150_000, rsuVesting: 50_000, profileIncludesRsus: false }));
    expect(added.income.wages).toBe(150_000);
    expect(added.income.rsuVesting).toBe(50_000);
    expect(added.federal.agi).toBe(200_000);

    const included = estimateTax(inputs({ grossIncome: 200_000, rsuVesting: 50_000, profileIncludesRsus: true }));
    expect(included.income.wages).toBe(150_000);
    expect(included.income.rsuVesting).toBe(50_000);
    expect(included.federal.agi).toBe(200_000);
    expect(included.total).toBe(added.total);
  });
});

const A = 'acct';
const lot = (t: Partial<LotTransaction> & Pick<LotTransaction, 'date' | 'quantity' | 'amount'>): LotTransaction => ({
  accountId: A,
  securityId: 'fund',
  type: t.quantity > 0 ? 'buy' : 'sell',
  price: Math.abs(t.amount / t.quantity),
  ...t,
});

describe('replayPositions', () => {
  it('solves for the cost of shares held before the history starts', () => {
    const [r] = replayPositions(
      [lot({ date: '2026-02-01', quantity: 10, amount: 1_000 }), lot({ date: '2026-06-01', quantity: -10, amount: -1_500 })],
      [{ accountId: A, securityId: 'fund', quantity: 10, costBasis: 1_000, price: 150 }],
    );
    expect(r!.sales).toHaveLength(1);
    expect(r!.sales[0]).toMatchObject({ proceeds: 1_500, cost: 1_000, shortTerm: 0, longTerm: 500 });
    expect(r!.lots).toEqual([{ date: '2026-02-01', qty: 10 }]);
    expect(r!.rough).toBe(false);
  });

  it('averages cost across buys and calls recent shares short-term', () => {
    const [r] = replayPositions(
      [
        lot({ date: '2026-01-10', quantity: 10, amount: 1_000 }),
        lot({ date: '2026-03-01', quantity: 10, amount: 1_200 }),
        lot({ date: '2026-06-01', quantity: -15, amount: -1_800 }),
      ],
      [{ accountId: A, securityId: 'fund', quantity: 5, costBasis: 550, price: 120 }],
    );
    expect(r!.sales[0]!.cost).toBeCloseTo(1_650);
    expect(r!.sales[0]!.shortTerm).toBeCloseTo(150);
    expect(r!.sales[0]!.longTerm).toBeCloseTo(0);
  });

  it('splits a sale across long- and short-term shares in the order bought', () => {
    const [r] = replayPositions(
      [
        lot({ date: '2025-01-02', quantity: 10, amount: 1_000 }),
        lot({ date: '2026-03-01', quantity: 10, amount: 2_000 }),
        lot({ date: '2026-06-01', quantity: -15, amount: -3_000 }),
      ],
      [{ accountId: A, securityId: 'fund', quantity: 5, costBasis: 750, price: 200 }],
    );
    // Average cost $150: 15 shares cost $2,250 and sold for $3,000. 10 of the 15 were held over a year.
    expect(r!.sales[0]!.longTerm).toBeCloseTo(500);
    expect(r!.sales[0]!.shortTerm).toBeCloseTo(250);
  });

  it('prices shares that arrive without a cost at a nearby trade', () => {
    const [r] = replayPositions(
      [
        { accountId: A, securityId: 'fund', date: '2026-02-01', type: 'transfer', quantity: 10, price: 0, amount: 0 },
        lot({ date: '2026-02-03', quantity: -10, amount: -1_050 }),
      ],
      [],
    );
    expect(r!.sales[0]!.cost).toBeCloseTo(1_050);
  });

  it('flags a position whose transactions don’t add up', () => {
    const [r] = replayPositions([lot({ date: '2026-05-01', quantity: -10, amount: -500 })], []);
    // Ten shares from before the history, all sold, with no cost basis left to solve from.
    expect(r!.rough).toBe(true);
    expect(r!.sales[0]).toMatchObject({ proceeds: 500, cost: 500 });
  });
});

describe('investment income helpers', () => {
  it('counts the stock part of a fund as qualified, apart from REITs', () => {
    const profile = { category: 'Balanced', assetClasses: { us_stocks: 0.6, bonds: 0.4 }, sectors: { real_estate: 0.1 }, regions: {}, bondTypes: {} };
    expect(qualifiedShare('etf', profile)).toBeCloseTo(0.54);
    expect(qualifiedShare('fixed income', null)).toBe(0);
    expect(qualifiedShare('equity', null)).toBe(1);
  });

  it('projects the year from last year’s pattern, or straight-line without one', () => {
    expect(projectYear(1_000, 900, 3_000, 0.5, true)).toBe(3_100);
    expect(projectYear(1_000, 0, 0, 0.5, false)).toBe(2_000);
    expect(projectYear(1_000, 900, 3_000, 1, true)).toBe(1_000);
  });
});

const DETECTED: TaxPlan['detected'] = {
  paychecks: 0,
  contractorDeposits: 0,
  interest: 0,
  ordinaryDividends: 0,
  qualifiedDividends: 0,
  capitalGainDistributions: 0,
  realizedShortTerm: 0,
  realizedLongTerm: 0,
  realizedRough: false,
  sales: 0,
  k401Contributions: 0,
  k401Accounts: 0,
  roth401kContributions: 0,
  k457bContributions: 0,
  k457bAccounts: 0,
  hsaContributions: 0,
  hsaAccount: false,
  iraContributions: 0,
  rothContributions: 0,
  traditionalIraBalance: 0,
  pretaxRetirementBalance: 0,
  has529: false,
  rsuVestedYtd: 0,
  rsuScheduledRemaining: 0,
  rsuWithheldYtd: 0,
  rsuProjectedWithholdingRemaining: 0,
  rsuWithholdingGap: 0,
  rsuZeroBasisTickers: [],
};

function suggest(i: TaxInputs, over: Partial<SuggestionContext> = {}) {
  const base = estimateTax(i);
  return buildSuggestions({
    inputs: i,
    base,
    marginal: marginalRate(i, base),
    settings: EMPTY_TAX_SETTINGS,
    detected: DETECTED,
    harvest: [],
    age: 40,
    balanceDue: null,
    ...over,
  });
}

const candidate = (over: Partial<HarvestCandidate>): HarvestCandidate => ({
  accountName: 'Brokerage',
  ticker: 'VXUS',
  name: null,
  value: 5_000,
  costBasis: 10_000,
  gain: -5_000,
  shortTermShare: 0,
  recentPurchase: null,
  recentVest: null,
  upcomingVest: null,
  ...over,
});

describe('buildSuggestions', () => {
  it('prices a loss harvest against this year’s gains', () => {
    const s = suggest(inputs({ grossIncome: 100_000, longTermGains: 10_000 }), { harvest: [candidate({})] });
    const harvest = s.find((x) => x.id === 'harvest-losses');
    expect(harvest?.impact).toBe(750);
  });

  it('warns about wash sales for recent purchases', () => {
    const s = suggest(inputs({ grossIncome: 100_000 }), { harvest: [candidate({ recentPurchase: '2026-10-20' })] });
    expect(s.find((x) => x.id === 'harvest-losses')?.detail).toMatch(/wash sale/);
  });

  it('points high earners to a backdoor Roth and warns about pro-rata', () => {
    const i = inputs({ filingStatus: 'married_joint', grossIncome: 400_000 });
    expect(suggest(i).find((x) => x.id === 'backdoor-roth')?.kind).toBe('save');
    const warned = suggest(i, { detected: { ...DETECTED, traditionalIraBalance: 50_000 } }).find((x) => x.id === 'backdoor-roth');
    expect(warned?.kind).toBe('warning');
    expect(warned?.detail).toMatch(/\$50,000/);
  });

  it('suggests a direct Roth IRA under the income limit', () => {
    const s = suggest(inputs({ grossIncome: 80_000 }));
    expect(s.find((x) => x.id === 'roth-ira')?.title).toMatch(/\$7,500/);
    expect(s.some((x) => x.id === 'backdoor-roth')).toBe(false);
  });

  it('prices the 401(k) room left and counts Roth 401(k) deferrals against the shared cap', () => {
    const i = inputs({ grossIncome: 150_000, pretax401k: 10_000 });
    const k = suggest(i, { detected: { ...DETECTED, k401Accounts: 1 } }).find((x) => x.id === '401k');
    expect(k?.title).toMatch(/\$14,500/);
    expect(k?.impact).toBe(Math.round(estimateTax(i).total - estimateTax({ ...i, pretax401k: 24_500 }).total));
    expect(suggest(i).some((x) => x.id === '401k')).toBe(false);

    // Pre-tax $10k + Roth 401(k) $14.5k = $24.5k (full 2026 cap -> no room left).
    const maxed = suggest(i, { detected: { ...DETECTED, k401Accounts: 1, roth401kContributions: 14_500 } });
    expect(maxed.some((x) => x.id === '401k')).toBe(false);
  });

  it('tracks governmental 457(b) headroom separately from 401(k)/403(b)', () => {
    const i = inputs({ grossIncome: 200_000, pretax401k: 24_500 });
    const s = suggest(i, { detected: { ...DETECTED, k401Accounts: 1, k457bAccounts: 1, k457bContributions: 5_000 } });
    expect(s.some((x) => x.id === '401k')).toBe(false);
    const k457 = s.find((x) => x.id === '457b');
    expect(k457?.title).toMatch(/\$19,500/);
    expect(k457?.detail).toContain('stacks on top');
    expect(k457?.impact).toBeGreaterThan(0);
  });

  it('puts an underpayment warning first and finds room for 0% gains', () => {
    const s = suggest(inputs({ filingStatus: 'married_joint', grossIncome: 80_000 }), { balanceDue: 5_000 });
    expect(s[0]?.id).toBe('underpayment');
    expect(s.some((x) => x.id === 'harvest-gains')).toBe(true);
  });

  it('offers a SEP IRA or solo 401(k) for self-employment income', () => {
    const s = suggest(inputs({ grossIncome: 200_000, selfEmployment: 100_000 }));
    expect(s.find((x) => x.id === 'self-employed-retirement')?.impact).toBeGreaterThan(0);
  });

  it('warns on RSU withholding shortfall, zero cost basis, and ±30d RSU wash sales', () => {
    const s = suggest(inputs({ grossIncome: 200_000, rsuVesting: 100_000 }), {
      detected: {
        ...DETECTED,
        rsuVestedYtd: 50_000,
        rsuScheduledRemaining: 50_000,
        rsuWithheldYtd: 11_000,
        rsuProjectedWithholdingRemaining: 11_000,
        rsuWithholdingGap: 12_000,
        rsuZeroBasisTickers: ['ACME'],
      },
      harvest: [candidate({ ticker: 'ACME', recentVest: '2026-10-15' }), candidate({ ticker: 'MSFT', upcomingVest: '2026-11-20' })],
    });
    expect(s.find((x) => x.id === 'rsu-withholding-gap')?.kind).toBe('warning');
    expect(s.find((x) => x.id === 'rsu-cost-basis')?.detail).toContain('ACME');
    expect(s.find((x) => x.id === 'harvest-losses')?.detail).toContain('including an RSU vest');
  });

  it('notes HSA state taxation only for nonconforming states (CA and NJ)', () => {
    const withHsa = { settings: { ...EMPTY_TAX_SETTINGS, hsaCoverage: 'self' as const } };
    const caHsa = suggest(inputs({ state: 'CA', grossIncome: 120_000 }), withHsa).find((x) => x.id === 'hsa');
    const njHsa = suggest(inputs({ state: 'NJ', grossIncome: 120_000 }), withHsa).find((x) => x.id === 'hsa');
    const nyHsa = suggest(inputs({ state: 'NY', grossIncome: 120_000 }), withHsa).find((x) => x.id === 'hsa');
    expect(caHsa?.detail).toContain('California taxes them');
    expect(njHsa?.detail).toContain('New Jersey taxes them');
    expect(nyHsa?.detail).not.toContain('taxes them');
  });
});

function checklist(i: TaxInputs, over: Partial<Parameters<typeof buildChecklist>[0]> = {}) {
  const base = estimateTax(i);
  const ctx = {
    inputs: i,
    base,
    marginal: marginalRate(i, base),
    settings: EMPTY_TAX_SETTINGS,
    detected: DETECTED,
    harvest: [],
    age: 40,
    balanceDue: null,
    today: '2026-11-02',
    done: new Set<string>(),
    employerBenefits: null,
    ...over,
  };
  return buildChecklist({ ...ctx, suggestions: over.suggestions ?? buildSuggestions(ctx) });
}

describe('buildChecklist', () => {
  it('moves weekend deadlines to a business day', () => {
    expect(businessDay('2027-01-15', 'forward')).toBe('2027-01-15');
    expect(businessDay('2028-04-15', 'forward')).toBe('2028-04-17');
    expect(businessDay('2027-12-31', 'back')).toBe('2027-12-31');
    expect(businessDay('2028-12-31', 'back')).toBe('2028-12-29');
  });

  it('counts semi-monthly paychecks payroll can still change', () => {
    // From Nov 2, a change lands from Nov 16: Nov 30, Dec 15, Dec 31.
    expect(paychecksLeft(2026, '2026-11-02')).toBe(3);
    expect(paychecksLeft(2026, '2026-12-20')).toBe(0);
  });

  it('dates the suggestions and sorts soonest first', () => {
    const i = inputs({ grossIncome: 150_000, pretax401k: 10_000, longTermGains: 10_000 });
    const c = checklist(i, { detected: { ...DETECTED, k401Accounts: 1 }, harvest: [candidate({})] });
    const harvest = c.find((x) => x.id === 'harvest-losses');
    expect(harvest?.due).toBe('2026-12-31');
    expect(harvest?.impact).toBe(750);
    const k = c.find((x) => x.id === '401k');
    expect(k?.detail).toMatch(/3 semi-monthly paychecks/);
    expect(k?.detail).toMatch(/\$4,833 each/);
    expect(c.find((x) => x.id === 'roth-ira')?.due).toBe('2027-04-15');
    expect(c.map((x) => x.due)).toEqual([...c.map((x) => x.due)].sort());
    expect(c.some((x) => x.id === 'fsa' && x.general)).toBe(true);
  });

  it('puts a Q4 estimate on Jan 15 when tax is owed', () => {
    const c = checklist(inputs({ grossIncome: 150_000 }), { balanceDue: 4_000 });
    const q4 = c.find((x) => x.id === 'q4-estimate');
    expect(q4?.due).toBe('2027-01-15');
    expect(q4?.title).toMatch(/\$4,000/);
    expect(c.some((x) => x.id === 'withholding-check')).toBe(false);
    expect(checklist(inputs({ grossIncome: 150_000 })).some((x) => x.id === 'withholding-check')).toBe(true);
  });

  it('suggests bunching gifts when itemized deductions fall a little short', () => {
    const i = inputs({ filingStatus: 'married_joint', grossIncome: 250_000, propertyTax: 12_000, otherItemized: 8_000 });
    const charity = checklist(i).find((x) => x.id === 'charity');
    expect(charity?.title).toMatch(/Bunch gifts/);
    const itemizing = checklist({ ...i, otherItemized: 30_000 }).find((x) => x.id === 'charity');
    expect(itemizing?.title).toMatch(/each \$1,000 saves/);
  });

  it('keeps ticks and drops what has passed', () => {
    const i = inputs({ grossIncome: 150_000 });
    expect(checklist(i, { done: new Set(['fsa']) }).find((x) => x.id === 'fsa')?.done).toBe(true);
    const january = checklist(i, { today: '2027-01-10', balanceDue: 4_000 });
    expect(january.some((x) => x.due < '2027-01-10')).toBe(false);
    expect(january.some((x) => x.id === 'q4-estimate')).toBe(true);
  });

  it('reminds people at their SECURE 2.0 RMD age (73 vs 75) and includes workplace pre-tax balances', () => {
    const c = checklist(inputs({ grossIncome: 80_000 }), {
      age: 75,
      birthYear: 1951,
      detected: { ...DETECTED, traditionalIraBalance: 300_000, pretaxRetirementBalance: 300_000 },
    });
    const rmd = c.find((x) => x.id === 'rmd');
    expect(rmd?.due).toBe('2026-12-31');
    expect(rmd?.title).toMatch(/\$12,195/); // 300k / 24.6
    expect(c.find((x) => x.id === 'charity')?.detail).toMatch(/qualified charitable distribution/);

    // Born 1960 -> RMD starts at 75, not 73.
    const born1960At73 = checklist(inputs({ year: 2033, grossIncome: 80_000 }), {
      today: '2033-06-01',
      age: 73,
      birthYear: 1960,
      detected: { ...DETECTED, pretaxRetirementBalance: 500_000 },
    });
    expect(born1960At73.some((x) => x.id === 'rmd')).toBe(false);

    // Workplace 401(k) balance triggers RMD even when traditionalIraBalance is 0.
    const workplaceOnly = checklist(inputs({ grossIncome: 80_000 }), {
      age: 73,
      birthYear: 1953,
      detected: { ...DETECTED, pretaxRetirementBalance: 530_000 },
    });
    expect(workplaceOnly.find((x) => x.id === 'rmd')?.title).toMatch(/\$20,000/); // 530k / 26.5
  });
});
