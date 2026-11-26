import { approxYieldToMaturity, bondParValue, bondPositions, type Holding } from '@meld/shared';
import { describe, expect, it } from 'vitest';

const TODAY = '2026-11-03';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const ACCOUNT = uuid();
const OTHER_ACCOUNT = uuid();
const FUND = uuid();

const holding = (overrides: Partial<Holding>): Holding => ({
  id: uuid(),
  accountId: ACCOUNT,
  securityId: FUND,
  accountName: 'Brokerage',
  accountSubtype: 'brokerage',
  taxTreatment: 'taxable',
  ticker: 'VLGSX',
  name: 'Vanguard Long-Term Treasury Index',
  securityType: 'mutual fund',
  quantity: 10_000,
  price: 17.7,
  value: 177_000,
  costBasis: 284_000,
  vestedQuantity: null,
  vestedValue: null,
  profile: {
    category: 'Long-term Treasury',
    assetClasses: { bonds: 0.99, cash: 0.01 },
    sectors: {},
    regions: {},
    bondTypes: { treasury: 1 },
    bondStats: { secYield: 0.049, duration: 14.5 },
  },
  fixedIncome: null,
  ...overrides,
});

const terms = (overrides: Partial<NonNullable<Holding['fixedIncome']>>): Holding['fixedIncome'] => ({
  yieldPercent: 2,
  yieldType: 'coupon',
  maturityDate: '2031-11-03',
  issueDate: '2021-11-03',
  faceValue: null,
  ...overrides,
});

describe('bondPositions', () => {
  it('puts a bond fund’s price drop next to what it pays, on today’s value and on cost', () => {
    const [p] = bondPositions([holding({})], [{ accountId: ACCOUNT, securityId: FUND, annualIncome: 8_500, days: 95 }], TODAY);
    expect(p!.kind).toBe('fund');
    expect(p!.priceChange).toBeCloseTo(177 / 284 - 1);
    expect(p!.paidYield).toBeCloseTo(8_500 / 177_000);
    expect(p!.paidDays).toBe(95);
    expect(p!.yieldOnCost).toBeCloseTo(8_500 / 284_000);
    expect(p!.marketYield).toBe(0.049);
    expect(p!.duration).toBe(14.5);
    // ln(284/177) / ln(1.048) ≈ 10 years.
    expect(p!.yearsToCost).toBeCloseTo(10.1, 0);
  });

  it('falls back to the SEC yield without payouts, and skips stock funds, cash and money market', () => {
    const positions = bondPositions(
      [
        holding({}),
        holding({ securityId: uuid(), ticker: 'VTI', profile: { category: '', assetClasses: { us_stocks: 1 }, sectors: {}, regions: {}, bondTypes: {} } }),
        holding({ securityId: uuid(), ticker: 'CASH', securityType: 'cash', profile: null }),
      ],
      [],
      TODAY,
    );
    expect(positions).toHaveLength(1);
    expect(positions[0]!.paidYield).toBeNull();
    expect(positions[0]!.yearsToCost).toBeCloseTo(Math.log(284 / 177) / Math.log(1.049));
  });

  it('combines accounts, taking yield only from accounts with payout history', () => {
    const [p] = bondPositions(
      [holding({}), holding({ accountId: OTHER_ACCOUNT, value: 23_000, costBasis: 20_000 })],
      [{ accountId: ACCOUNT, securityId: FUND, annualIncome: 8_500, days: 365 }],
      TODAY,
    );
    expect(p!.value).toBe(200_000);
    expect(p!.costBasis).toBe(304_000);
    expect(p!.paidYield).toBeCloseTo(8_500 / 177_000);
  });

  it('ignores a cost basis too far from the value to be complete', () => {
    const [p] = bondPositions([holding({ costBasis: 430 })], [{ accountId: ACCOUNT, securityId: FUND, annualIncome: 8_500, days: 365 }], TODAY);
    expect(p!.costBasis).toBeNull();
    expect(p!.priceChange).toBeNull();
    expect(p!.yieldOnCost).toBeNull();
    expect(p!.paidYield).toBeCloseTo(8_500 / 177_000);
  });

  it('shows an individual bond’s payback at maturity and its yield to maturity', () => {
    const bond = uuid();
    const [p] = bondPositions(
      // $10,000 of par priced at 92 per 100.
      [holding({ securityId: bond, ticker: null, name: 'US Treasury 2% 11/2031', securityType: 'fixed income', quantity: 10_000, price: 92, value: 9_200, costBasis: 10_000, profile: null, fixedIncome: terms({}) })],
      [],
      TODAY,
    );
    expect(p!.kind).toBe('bond');
    expect(p!.parValue).toBe(10_000);
    expect(p!.maturityDate).toBe('2031-11-03');
    // (200 + 800/5) / 9,600 ≈ 3.75%.
    expect(p!.marketYield).toBeCloseTo(0.0375, 3);
    expect(p!.yearsToCost).toBeNull();
  });
});

describe('bondParValue', () => {
  const bond = { quantity: 10, price: 950, value: 9_500, fixedIncome: terms({ faceValue: 1_000 }) };
  it('uses face value per unit when it agrees with the value, else par dollars priced per 100', () => {
    expect(bondParValue(bond)).toBe(10_000);
    expect(bondParValue({ ...bond, quantity: 10_000, price: 95, fixedIncome: terms({ faceValue: 1_000 }) })).toBe(10_000);
    expect(bondParValue({ ...bond, fixedIncome: terms({}) })).toBeNull();
  });
});

describe('approxYieldToMaturity', () => {
  it('is the coupon at par and the compound rate for a zero-coupon', () => {
    expect(approxYieldToMaturity(1_000, 1_000, 10, 0.04)).toBeCloseTo(0.04);
    expect(approxYieldToMaturity(950, 1_000, 1, 0)).toBeCloseTo(1_000 / 950 - 1);
  });
});
