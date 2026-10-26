import { estimatePayoff, taxTreatment } from '@meld/shared';
import { describe, expect, it } from 'vitest';

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
