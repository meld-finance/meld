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
