import { defaultSupplementalStateRate, generateVestSchedule, type VestSchedulePreset } from '@meld/shared';
import { describe, expect, it } from 'vitest';

describe('generateVestSchedule', () => {
  const presets: VestSchedulePreset[] = [
    '4yr_1yr_cliff_quarterly',
    '4yr_quarterly',
    '4yr_1yr_cliff_monthly',
    '4yr_annual',
    'backloaded_5_15_40_40',
    'frontloaded_38_32_20_10',
  ];

  it.each(presets)('sums exactly to integer totalShares for %s', (preset) => {
    const vests = generateVestSchedule({ grantDate: '2026-01-15', totalShares: 1000, preset });
    expect(vests.length).toBeGreaterThan(0);
    expect(vests.every((v) => Number.isInteger(v.shares) && v.shares > 0)).toBe(true);
    expect(vests.reduce((s, v) => s + v.shares, 0)).toBe(1000);
  });

  it('produces exact curve proportions on 1-year cliff quarterly and Amazon backloaded', () => {
    const cliffQ = generateVestSchedule({ grantDate: '2026-03-01', totalShares: 400, preset: '4yr_1yr_cliff_quarterly' });
    expect(cliffQ).toHaveLength(13);
    expect(cliffQ[0]).toEqual({ vestDate: '2027-03-01', shares: 100 });
    expect(cliffQ.slice(1).every((v) => v.shares === 25)).toBe(true);

    const amzn = generateVestSchedule({ grantDate: '2026-02-15', totalShares: 1000, preset: 'backloaded_5_15_40_40' });
    expect(amzn.map((v) => [v.vestDate, v.shares])).toEqual([
      ['2027-02-15', 50],
      ['2028-02-15', 150],
      ['2028-08-15', 200],
      ['2029-02-15', 200],
      ['2029-08-15', 200],
      ['2030-02-15', 200],
    ]);
  });

  it('clamps end-of-month grant dates into shorter months and leap years', () => {
    const vests = generateVestSchedule({ grantDate: '2025-01-31', totalShares: 480, preset: '4yr_1yr_cliff_monthly' });
    // +13 months from 2025-01-31 lands on Feb 28, 2026; +37 months lands on Feb 29, 2028 (leap year).
    expect(vests[0]!.vestDate).toBe('2026-01-31');
    expect(vests[1]!.vestDate).toBe('2026-02-28');
    expect(vests.find((v) => v.vestDate.startsWith('2028-02'))!.vestDate).toBe('2028-02-29');
  });

  it('handles small or fractional share totals without zero-share tranches', () => {
    const small = generateVestSchedule({ grantDate: '2026-01-15', totalShares: 10, preset: '4yr_1yr_cliff_monthly' });
    expect(small.every((v) => v.shares > 0)).toBe(true);
    expect(small.reduce((s, v) => s + v.shares, 0)).toBe(10);

    const fractional = generateVestSchedule({ grantDate: '2026-01-15', totalShares: 12.5, preset: '4yr_annual' });
    expect(fractional.reduce((s, v) => s + v.shares, 0)).toBeCloseTo(12.5, 4);
  });
});

describe('defaultSupplementalStateRate', () => {
  it('uses state supplemental rates, 0% for no-tax states, and 5% fallback', () => {
    expect(defaultSupplementalStateRate('CA')).toBe(10.23);
    expect(defaultSupplementalStateRate('wa')).toBe(0);
    expect(defaultSupplementalStateRate('TX')).toBe(0);
    expect(defaultSupplementalStateRate('NY')).toBe(11.7);
    expect(defaultSupplementalStateRate('IL')).toBe(4.95);
    expect(defaultSupplementalStateRate(null)).toBe(0);
  });
});
