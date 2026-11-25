import { accountDisplayName, CASH_PROFILE, estimatePayoff, lookThrough, normalizeWeights, taxTreatment, type SecurityProfile } from '@meld/shared';
import { describe, expect, it } from 'vitest';

describe('accountDisplayName', () => {
  it('shows institution, official name, and mask without duplicating the institution', () => {
    expect(
      accountDisplayName({
        name: 'CREDIT CARD',
        officialName: 'Customized Cash Rewards',
        institutionName: 'Bank of America',
        mask: '4686',
      }),
    ).toBe('Bank of America · Customized Cash Rewards ••4686');

    expect(
      accountDisplayName({
        name: 'CREDIT CARD',
        officialName: 'Chase Sapphire Reserve',
        institutionName: 'Chase',
        mask: '2646',
      }),
    ).toBe('Chase Sapphire Reserve ••2646');

    expect(
      accountDisplayName({
        name: 'CREDIT CARD',
        officialName: null,
        institutionName: 'Chase',
        mask: '4686',
      }),
    ).toBe('Chase · CREDIT CARD ••4686');

    expect(
      accountDisplayName({
        name: 'Adv Plus Banking',
        officialName: 'Adv Plus Banking',
        institutionName: 'Bank of America',
        mask: '9012',
      }),
    ).toBe('Bank of America · Adv Plus Banking ••9012');

    expect(
      accountDisplayName({
        name: 'Sapphire',
        officialName: null,
        institutionName: null,
        mask: null,
      }),
    ).toBe('Sapphire');
  });
});

describe('estimatePayoff', () => {
  it('matches a standard amortization (30y, 6%, $200k → $1,199.11/mo)', () => {
    // Exact payment is $1,199.101…; lenders round up. Rounding down leaves cents for a 361st payment.
    const result = estimatePayoff(200_000, 6, 1199.11);
    expect(result?.months).toBe(360);
    expect(estimatePayoff(200_000, 6, 1199.1)?.months).toBe(361);
    // Textbook total interest ≈ $231,676.
    expect(result!.totalInterest).toBeGreaterThan(231_600);
    expect(result!.totalInterest).toBeLessThan(231_700);
  });

  it('handles zero-interest loans', () => {
    expect(estimatePayoff(1000, 0, 300)).toEqual({ months: 4, totalInterest: 0 });
  });

  it('returns null when the payment never covers interest', () => {
    expect(estimatePayoff(10_000, 24, 200)).toBeNull(); // interest is $200/mo
  });

  it('returns null when inputs are missing', () => {
    expect(estimatePayoff(null, 5, 100)).toBeNull();
    expect(estimatePayoff(1000, null, 100)).toBeNull();
    expect(estimatePayoff(1000, 5, null)).toBeNull();
  });
});

describe('taxTreatment', () => {
  it.each([
    ['401k', 'tax_deferred'],
    ['IRA', 'tax_deferred'],
    ['roth', 'tax_free'],
    ['hsa', 'tax_free'],
    ['brokerage', 'taxable'],
    [null, 'unknown'],
    ['something new', 'unknown'],
  ] as const)('%s → %s', (subtype, expected) => {
    expect(taxTreatment(subtype)).toBe(expected);
  });
});

describe('normalizeWeights', () => {
  it('scales weights to sum to 1 and drops unusable ones', () => {
    expect(normalizeWeights({ a: 30, b: 10, c: -5, d: Number.NaN })).toEqual({ a: 0.75, b: 0.25 });
    expect(normalizeWeights({ a: 0 })).toEqual({});
  });
});

describe('lookThrough', () => {
  const balanced: SecurityProfile = {
    category: 'Balanced',
    assetClasses: { us_stocks: 0.4, intl_stocks: 0.2, bonds: 0.4 },
    sectors: { technology: 0.5, financials: 0.5 },
    regions: { united_states: 2, europe: 1 },
    bondTypes: {},
  };

  it('splits each holding into what it holds', () => {
    const e = lookThrough([
      { value: 1000, profile: balanced },
      { value: 500, profile: CASH_PROFILE },
      { value: 250, profile: null },
    ]);
    expect(e.total).toBe(1750);
    expect(e.unclassified).toBe(250);
    expect(e.assetClasses).toEqual({ us_stocks: 400, intl_stocks: 200, bonds: 400, cash: 500 });
    expect(e.stocks).toBeCloseTo(600);
    expect(e.sectors.technology).toBeCloseTo(300);
    expect(e.sectors.financials).toBeCloseTo(300);
    expect(e.regions.united_states).toBeCloseTo(400);
    expect(e.regions.europe).toBeCloseTo(200);
    expect(e.regionsKnown).toBeCloseTo(600);
    // The fund's bond split is unknown.
    expect(e.bonds).toBe(400);
    expect(e.bondTypesKnown).toBe(0);
  });
});
