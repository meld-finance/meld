import { insuranceTotals, maskPolicyNumber, netCashValue, type InsurancePolicyInput } from '@meld/shared';
import { describe, expect, it } from 'vitest';
import { normalizeExtraction, type RawExtraction } from './insurance-extraction';

const raw: RawExtraction = {
  type: 'disability_long',
  carrier: ' Guardian ',
  policyNumberLast4: 'G-123-456-789',
  insuredName: 'Alex Doe',
  coverageAmount: 8000,
  benefitPercentOfIncome: 60,
  premiumAmount: 112.5,
  premiumFrequency: 'monthly',
  effectiveDate: '2024-01-01',
  termEndDate: null,
  eliminationPeriodDays: 90.4,
  benefitPeriod: 'to age 65',
  ownOccupation: true,
  employerProvided: false,
  cashValue: null,
  cashSurrenderValue: null,
  loanBalance: null,
  valuesAsOf: null,
  beneficiaries: [],
  notes: null,
  warnings: ['Monthly benefit converted from annual.'],
};

describe('normalizeExtraction', () => {
  it('keeps valid fields and enforces masking', () => {
    const { draft, warnings } = normalizeExtraction(raw);
    expect(draft.carrier).toBe('Guardian');
    expect(draft.policyNumberMask).toBe('6789');
    expect(draft.eliminationPeriodDays).toBe(90);
    expect(draft.coverageAmount).toBe(8000);
    expect(warnings).toEqual(['Monthly benefit converted from annual.']);
  });

  it('turns unusable values into null with a warning instead of failing', () => {
    const { draft, warnings } = normalizeExtraction({
      ...raw,
      carrier: null,
      effectiveDate: 'January 2024',
      benefitPercentOfIncome: 160,
      coverageAmount: -5,
      beneficiaries: [{ name: 'Sam', relationship: null, percentage: 150, primary: true }],
    });
    expect(draft).toMatchObject({ carrier: '', effectiveDate: null, benefitPercentOfIncome: null, coverageAmount: null });
    expect(draft.beneficiaries).toEqual([]);
    expect(warnings).toHaveLength(6);
  });
});

describe('maskPolicyNumber', () => {
  it('keeps the last 4 alphanumerics', () => {
    expect(maskPolicyNumber('AB-12 34-5678')).toBe('5678');
    expect(maskPolicyNumber('12')).toBe('12');
    expect(maskPolicyNumber('  ')).toBeNull();
    expect(maskPolicyNumber(null)).toBeNull();
  });
});

describe('insuranceTotals', () => {
  const base: InsurancePolicyInput = {
    ...normalizeExtraction(raw).draft,
    beneficiaries: [],
    documentId: null,
  };

  it('sums coverage by kind, annualizes premiums and skips lapsed term life', () => {
    const totals = insuranceTotals(
      [
        { ...base, type: 'life_term', coverageAmount: 1_000_000, premiumAmount: 600, premiumFrequency: 'annual', termEndDate: '2050-01-01' },
        { ...base, type: 'life_term', coverageAmount: 250_000, premiumAmount: 50, premiumFrequency: 'monthly', termEndDate: '2020-01-01' },
        { ...base, type: 'life_whole', coverageAmount: 100_000, premiumAmount: 300, premiumFrequency: 'quarterly' },
        { ...base, type: 'disability_long', coverageAmount: 8000, premiumAmount: 112.5, premiumFrequency: 'monthly' },
        { ...base, type: 'disability_short', coverageAmount: 4000, premiumAmount: null, premiumFrequency: null },
      ],
      '2026-10-26',
    );
    expect(totals).toEqual({
      lifeCoverage: 1_100_000,
      shortTermDisabilityMonthly: 4000,
      longTermDisabilityMonthly: 8000,
      annualPremiums: 600 + 1200 + 1350,
      cashValue: 0,
    });
  });

  it('totals the surrender value of permanent life policies', () => {
    const totals = insuranceTotals(
      [
        { ...base, type: 'life_whole', cashValue: 40_000, cashSurrenderValue: 32_000 },
        { ...base, type: 'life_universal', cashValue: 10_000, loanBalance: 2_500 },
      ],
      '2026-10-26',
    );
    expect(totals.cashValue).toBe(32_000 + 7_500);
  });
});

describe('netCashValue', () => {
  const none = { cashValue: null, cashSurrenderValue: null, loanBalance: null };

  it('prefers the stated surrender value, which already nets out loans', () => {
    expect(netCashValue({ ...none, type: 'life_whole', cashValue: 50_000, cashSurrenderValue: 42_000, loanBalance: 5_000 })).toBe(42_000);
  });

  it('falls back to cash value minus loans, never below zero', () => {
    expect(netCashValue({ ...none, type: 'life_universal', cashValue: 20_000, loanBalance: 5_000 })).toBe(15_000);
    expect(netCashValue({ ...none, type: 'life_whole', cashValue: 3_000, loanBalance: 5_000 })).toBe(0);
  });

  it('is null for term and disability policies and when no values are entered', () => {
    expect(netCashValue({ ...none, type: 'life_term', cashSurrenderValue: 1_000 })).toBeNull();
    expect(netCashValue({ ...none, type: 'disability_long' })).toBeNull();
    expect(netCashValue({ ...none, type: 'life_whole' })).toBeNull();
  });
});
