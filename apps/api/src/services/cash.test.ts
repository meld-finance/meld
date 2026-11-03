import { EMPTY_CASH_SETTINGS, type CashSettings } from '@meld/shared';
import { describe, expect, it } from 'vitest';
import { bankApy, buildCashPlan, isCashHolding, type CashInputs, type DetectedPosition } from './cash';

const ID = '00000000-0000-4000-8000-00000000000';

function position(n: number, p: Partial<DetectedPosition>): DetectedPosition {
  return {
    key: `${ID}${n}`,
    kind: 'bank',
    accountId: `${ID}${n}`,
    accountName: `Account ${n}`,
    institutionName: null,
    accountSubtype: 'savings',
    ticker: null,
    name: null,
    value: 0,
    apy: null,
    apySource: null,
    taxAdvantaged: false,
    ...p,
  };
}

function plan(input: Partial<Omit<CashInputs, 'settings'>> & { settings?: Partial<CashSettings> }) {
  return buildCashPlan({
    today: '2026-11-02',
    positions: [],
    treasuryApy: 0.04,
    spendingMonths: [5_000, 5_000, 5_000],
    cardDebt: 0,
    ...input,
    settings: { ...EMPTY_CASH_SETTINGS, ...input.settings },
  });
}

describe('buildCashPlan', () => {
  it('sizes the emergency fund from average spending', () => {
    const p = plan({
      positions: [
        position(1, { accountSubtype: 'checking', value: 8_000, apy: 0.0001, apySource: 'interest' }),
        position(2, { value: 12_000, apy: 0.04, apySource: 'interest' }),
      ],
      spendingMonths: [4_000, 6_000],
    });
    expect(p.spending).toEqual({ monthly: 5_000, source: 'history', average: 5_000, months: 2 });
    expect(p.emergency).toEqual({ targetMonths: 6, target: 30_000, runwayMonths: 4, gap: -10_000 });
    expect(p.suggestions.map((s) => s.id)).toContain('emergency-short');
  });

  it('nudges low-earning cash to the benchmark, keeping a month in checking', () => {
    const p = plan({
      positions: [position(1, { accountSubtype: 'checking', value: 20_000, apy: 0.0001, apySource: 'interest' })],
    });
    const s = p.suggestions.find((x) => x.kind === 'earn')!;
    expect(s.title).toBe('Move $15,000 from Account 1 to earn more');
    expect(s.impact).toBeCloseTo(15_000 * (0.04 - 0.0001), 2);
    expect(p.totals.missedInterest).toBe(s.impact);
  });

  it('suggests investing cash beyond the target, card debt first', () => {
    const p = plan({
      positions: [position(1, { value: 50_000, apy: 0.04, apySource: 'interest' })],
      settings: { emergencyMonths: 3 },
      cardDebt: 1_200,
    });
    expect(p.emergency.gap).toBe(35_000);
    const s = p.suggestions.find((x) => x.id === 'emergency-extra')!;
    expect(s.detail).toMatch(/\$1,200 on your credit cards is carried/);
    expect(p.suggestions.some((x) => x.kind === 'earn')).toBe(false);
  });

  it('applies entered rates, spending and earmarks', () => {
    const p = plan({
      positions: [
        position(1, { value: 10_000 }),
        position(2, { value: 30_000, apy: 0.04, apySource: 'interest' }),
        position(3, { kind: 'sweep', value: 4_000, taxAdvantaged: true, accountName: 'Rollover IRA' }),
      ],
      settings: { apyPercent: { [`${ID}1`]: 3.5 }, earmarked: [`${ID}2`], monthlySpending: 2_000, benchmarkApyPercent: 4.5 },
    });
    expect(p.positions.find((x) => x.key === `${ID}1`)).toMatchObject({ apy: 0.035, apySource: 'entered' });
    expect(p.totals).toMatchObject({ emergency: 10_000, earmarked: 30_000, taxAdvantaged: 4_000 });
    expect(p.totals.apy).toBeCloseTo((10_000 * 0.035 + 30_000 * 0.04) / 40_000);
    expect(p.benchmark).toEqual({ apy: 0.045, source: 'entered' });
    expect(p.emergency).toMatchObject({ target: 12_000, runwayMonths: 5, gap: -2_000 });
    expect(p.suggestions.map((s) => s.id)).toContain(`idle:${ID}3`);
  });

  it('asks for what it can’t work out', () => {
    const p = plan({ positions: [position(1, { value: 5_000 })], spendingMonths: [], treasuryApy: null });
    expect(p.benchmark).toEqual({ apy: null, source: null });
    expect(p.emergency).toMatchObject({ target: null, runwayMonths: null, gap: null });
    expect(p.suggestions.map((s) => s.id)).toEqual(['unknown-rate', 'no-spending']);
  });
});

describe('isCashHolding', () => {
  const h = (ticker: string | null, securityType: string | null, cash?: number, name: string | null = null) => ({
    ticker,
    securityType,
    name,
    profile: cash === undefined ? null : { category: '', assetClasses: { cash, bonds: 1 - cash }, sectors: {}, regions: {}, bondTypes: {} },
  });
  it('counts money market funds, sweep cash and T-bill ETFs, not bond or stock funds', () => {
    expect(isCashHolding(h('SPAXX', 'cash'))).toBe(true);
    expect(isCashHolding(h('CUR:USD', 'cash'))).toBe(true);
    expect(isCashHolding(h('FCASH', 'equity'))).toBe(true);
    expect(isCashHolding(h('SGOV', 'etf'))).toBe(true);
    expect(isCashHolding(h('VUSXX', 'mutual fund', undefined, 'Vanguard Treasury Money Market Fund'))).toBe(true);
    expect(isCashHolding(h('XYZ', 'etf', 1))).toBe(true);
    expect(isCashHolding(h('BND', 'etf', 0.02))).toBe(false);
    expect(isCashHolding(h('VTI', 'etf'))).toBe(false);
    expect(isCashHolding(h(null, 'cash', undefined, 'Cash'))).toBe(true);
    expect(isCashHolding(h('FDRXX.CORE', 'cash', undefined, 'Fidelity Government Cash Reserves'))).toBe(true);
    // A 529 portfolio without a ticker, and a 401(k) stock fund Plaid typed as cash.
    expect(isCashHolding(h(null, 'mutual fund', 0.01, 'Vanguard 500 Index Portfolio'))).toBe(false);
    expect(isCashHolding(h('INTL.GROWTH.ACCOUNT', 'cash', 1, 'Intl Growth Account'))).toBe(false);
  });
});

describe('bankApy', () => {
  it('compounds monthly interest over that month’s balance', () => {
    expect(bankApy([{ interest: 33.03, balance: 11_034.18 }])).toBeCloseTo(0.0365, 4);
  });

  it('skips months without a known balance', () => {
    expect(bankApy([{ interest: 77.1, balance: null }, { interest: 30, balance: 12_000 }])).toBeCloseTo(1.0025 ** 12 - 1, 8);
    expect(bankApy([{ interest: 77.1, balance: null }])).toBeNull();
  });

  it('reads no interest as 0% and implausible rates as unknown', () => {
    expect(bankApy([{ interest: 0, balance: 9_000 }])).toBe(0);
    expect(bankApy([{ interest: 500, balance: 1_000 }])).toBeNull();
  });
});
