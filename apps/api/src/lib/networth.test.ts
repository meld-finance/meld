import { currentValue, ownedValue } from '@meld/shared';
import { describe, expect, it } from 'vitest';
import { computeNetWorth } from './networth';

describe('computeNetWorth', () => {
  it('subtracts liabilities and adds manual assets', () => {
    const result = computeNetWorth(
      [
        { type: 'depository', currentBalance: 1000.1 },
        { type: 'investment', currentBalance: 5000 },
        { type: 'credit', currentBalance: 250.05 },
        { type: 'mortgage', currentBalance: 300000 },
      ],
      [{ value: 450000 }],
    );
    expect(result.assets).toBe(456000.1);
    expect(result.liabilities).toBe(300250.05);
    expect(result.netWorth).toBe(155750.05);
    expect(result.byType).toContainEqual({ type: 'manual', total: 450000 });
    expect(result.byType).toContainEqual({ type: 'mortgage', total: 300000 });
  });

  it('counts only the owned share of manual assets', () => {
    const result = computeNetWorth([], [{ value: 800000, ownershipPercent: 50 }, { value: 20000, ownershipPercent: null }]);
    expect(result.assets).toBe(420000);
  });

  it('counts only the owned share of joint accounts, including debts', () => {
    const result = computeNetWorth(
      [
        { type: 'depository', currentBalance: 10000, ownershipPercent: 50 },
        { type: 'mortgage', currentBalance: 300000, ownershipPercent: 50 },
        { type: 'depository', currentBalance: 1000, ownershipPercent: null },
      ],
      [],
    );
    expect(result.assets).toBe(6000);
    expect(result.liabilities).toBe(150000);
    expect(result.byType).toContainEqual({ type: 'depository', total: 6000 });
  });

  it('adds life insurance surrender value as its own asset type', () => {
    const result = computeNetWorth([{ type: 'loan', currentBalance: 1000 }], [], [30000, 7500]);
    expect(result.assets).toBe(37500);
    expect(result.netWorth).toBe(36500);
    expect(result.byType).toContainEqual({ type: 'insurance', total: 37500 });
  });

  it('treats missing balances as zero and omits manual when there are none', () => {
    const result = computeNetWorth([{ type: 'depository', currentBalance: null }], []);
    expect(result).toEqual({
      assets: 0,
      liabilities: 0,
      netWorth: 0,
      byType: [{ type: 'depository', total: 0 }],
    });
  });
});

describe('currentValue', () => {
  const car = { value: 20000, valueAsOf: '2024-01-01', depreciationPercent: 15 };

  it('compounds yearly depreciation from the valuation date', () => {
    expect(currentValue(car, new Date(2024, 0, 1))).toBe(20000);
    // Two years (731 days, one a leap year) at 15%: 20,000 × 0.85^2.0014 ≈ 14,445.
    expect(currentValue(car, new Date(2026, 0, 1))).toBeCloseTo(14445, -1);
    expect(ownedValue({ ...car, ownershipPercent: 50 }, new Date(2026, 0, 1))).toBeCloseTo(7222, -1);
  });

  it('holds the value without a rate or date, and never before the valuation date', () => {
    expect(currentValue({ value: 20000, valueAsOf: '2020-01-01' }, new Date(2026, 0, 1))).toBe(20000);
    expect(currentValue({ value: 20000, depreciationPercent: 15 }, new Date(2026, 0, 1))).toBe(20000);
    expect(currentValue(car, new Date(2023, 0, 1))).toBe(20000);
  });
});
