import type { HarvestCandidate, TaxPlan } from '@meld/shared';
import { EMPTY_TAX_SETTINGS } from '@meld/shared';
import { describe, expect, it } from 'vitest';
import {
  buildSuggestions,
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

  it('uses California tables, with the HSA added back and exemption credits', () => {
    // FTB's worked example: $125,000 taxable on Schedule Y is $4,768.10, less the $307 joint credit.
    const e = estimateTax(inputs({ filingStatus: 'married_joint', state: 'CA', grossIncome: 136_412, hsa: 5_000 }));
    expect(e.state).toMatchObject({ state: 'CA', method: 'tables', tablesYear: 2025, taxableIncome: 125_000, total: 4_461.1, bracketRate: 0.08 });
    expect(e.total).toBeCloseTo(e.federal.total + 4_461.1, 2);
  });

  it('adds California’s 1% surcharge over $1M', () => {
    const lower = estimateTax(inputs({ state: 'CA', grossIncome: 1_005_706 }));
    expect(lower.state!.taxableIncome).toBe(1_000_000);
    const higher = estimateTax(inputs({ state: 'CA', grossIncome: 1_105_706 }));
    expect(higher.state!.total - lower.state!.total).toBeCloseTo(100_000 * (0.123 + 0.01), 2);
    expect(higher.state!.bracketRate).toBeCloseTo(0.133);
  });

  it('caps state and local taxes when itemizing', () => {
    const e = estimateTax(inputs({ filingStatus: 'married_joint', state: 'CA', grossIncome: 400_000, propertyTax: 20_000, otherItemized: 10_000 }));
    expect(e.federal.itemized).toBe(true);
    expect(e.federal.deduction).toBe(40_400 + 10_000);
  });

  it('uses a flat rate for other states, and nothing where there is no income tax', () => {
    expect(estimateTax(inputs({ state: 'NY', stateFlatRate: 5, grossIncome: 100_000 })).state).toMatchObject({ method: 'flat', total: 5_000 });
    expect(estimateTax(inputs({ state: 'TX', grossIncome: 100_000 })).state).toMatchObject({ method: 'none', total: 0 });
    expect(estimateTax(inputs({ state: 'NY', grossIncome: 100_000 })).state).toBeNull();
  });

  it('finds the combined marginal rate', () => {
    const i = inputs({ filingStatus: 'married_joint', grossIncome: 200_000, state: 'NY', stateFlatRate: 5 });
    expect(marginalRate(i)).toBeCloseTo(0.27, 3);
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
  hsaContributions: 0,
  hsaAccount: false,
  iraContributions: 0,
  rothContributions: 0,
  traditionalIraBalance: 0,
  has529: false,
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

  it('prices the 401(k) room left', () => {
    const i = inputs({ grossIncome: 150_000, pretax401k: 10_000 });
    const k = suggest(i, { detected: { ...DETECTED, k401Accounts: 1 } }).find((x) => x.id === '401k');
    expect(k?.title).toMatch(/\$14,500/);
    expect(k?.impact).toBe(Math.round(estimateTax(i).total - estimateTax({ ...i, pretax401k: 24_500 }).total));
    expect(suggest(i).some((x) => x.id === '401k')).toBe(false);
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
});
