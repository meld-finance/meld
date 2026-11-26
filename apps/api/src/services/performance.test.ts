import { describe, expect, it } from 'vitest';
import { computePerformance, type PerformanceInput, type PerfSecurity, type PerfTransaction } from './performance';

const TODAY = '2026-03-31';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const FUND: PerfSecurity = { id: 'fund', ticker: 'VTI', name: 'Total Market', type: 'etf' };
const MMF: PerfSecurity = { id: 'mmf', ticker: 'SPAXX', name: 'Money Market', type: 'cash' };
const POOL: PerfSecurity = { id: 'pool', ticker: null, name: 'Growth Pool', type: 'mutual fund' };

function txn(t: Partial<PerfTransaction> & Pick<PerfTransaction, 'date' | 'type'>): PerfTransaction {
  return { accountId: A, securityId: null, name: '', subtype: t.type, quantity: 0, price: 0, amount: 0, ...t };
}

function input(over: Partial<PerformanceInput>): PerformanceInput {
  return {
    today: TODAY,
    accounts: [{ id: A, name: 'Brokerage', share: 1, balance: 1100 }],
    securities: new Map([FUND, MMF, POOL].map((s) => [s.id, s])),
    holdings: [{ accountId: A, securityId: 'fund', quantity: 10, price: 100, value: 1000 }],
    transactions: [],
    // $90 through February, $100 from March.
    closes: new Map([['VTI', { '2025-12-01': 90, '2026-03-02': 100 }]]),
    snapshots: [],
    ...over,
  };
}

describe('computePerformance', () => {
  it('separates a deposit from what the market earned on it', () => {
    const p = computePerformance(
      input({
        transactions: [
          txn({ date: '2026-01-05', type: 'cash', subtype: 'deposit', amount: -1000 }),
          txn({ date: '2026-01-06', type: 'buy', securityId: 'fund', quantity: 10, price: 90, amount: 900 }),
        ],
      }),
    );
    const all = p.periods.find((x) => x.key === 'all')!;
    expect(all).toMatchObject({ start: '2026-01-04', startValue: 0, endValue: 1100, contributions: 1000, withdrawals: 0, gain: 100 });
    expect(all.return).toBeCloseTo(0.1);
    // Before the price moved, nothing was earned.
    expect(p.points.find((x) => x.date === '2026-02-27')).toMatchObject({ value: 1000, index: 1 });
    expect(p.points.find((x) => x.date === '2026-01-05')!.flow).toBe(1000);
    expect(p.estimatedBefore).toBeNull();
  });

  it('measures growth rate apart from the size and timing of deposits', () => {
    // $1,000 grows 10%, then $10,000 more arrives: the return stays 10%, not 1%.
    const p = computePerformance(
      input({
        accounts: [{ id: A, name: 'Brokerage', share: 1, balance: 11000 }],
        holdings: [{ accountId: A, securityId: 'fund', quantity: 10, price: 100, value: 1000 }],
        transactions: [
          txn({ date: '2026-01-05', type: 'cash', subtype: 'deposit', amount: -900 }),
          txn({ date: '2026-01-06', type: 'buy', securityId: 'fund', quantity: 10, price: 90, amount: 900 }),
          txn({ date: '2026-03-20', type: 'cash', subtype: 'deposit', amount: -10000 }),
        ],
      }),
    );
    const all = p.periods.find((x) => x.key === 'all')!;
    expect(all).toMatchObject({ contributions: 10900, gain: 100 });
    expect(all.return).toBeCloseTo(100 / 900);
  });

  it('ignores sweeps, offsetting transfers and earnings reported as deposits, and counts shares moved in', () => {
    const p = computePerformance(
      input({
        accounts: [{ id: A, name: 'Brokerage', share: 1, balance: 1050 }],
        transactions: [
          // 10 shares transferred in at $90 are a contribution of $900.
          txn({ date: '2026-01-05', type: 'transfer', securityId: 'fund', quantity: 10, amount: 900, name: 'TRANSFERRED FROM VS 123' }),
          txn({ date: '2026-02-02', type: 'cash', subtype: 'deposit', amount: -50, name: 'FUND - LONG-TERM CAP GAIN' }),
          txn({ date: '2026-02-02', type: 'cash', subtype: 'withdrawal', securityId: 'mmf', amount: 50, name: 'Sweep in' }),
          txn({ date: '2026-02-10', type: 'transfer', securityId: 'mmf', amount: 30, quantity: 30, name: 'TRANSFERRED TO SPAXX' }),
          txn({ date: '2026-02-10', type: 'transfer', securityId: 'mmf', amount: -30, quantity: -30, name: 'TRANSFERRED FROM FCASH' }),
        ],
      }),
    );
    const all = p.periods.find((x) => x.key === 'all')!;
    expect(all).toMatchObject({ startValue: 0, endValue: 1050, contributions: 900, withdrawals: 0, gain: 150 });
  });

  it('values 401(k) contributions and dividends paid in shares, priced from their own transactions', () => {
    const p = computePerformance(
      input({
        accounts: [{ id: A, name: '401(k)', share: 1, balance: 240 }],
        holdings: [{ accountId: A, securityId: 'pool', quantity: 20, price: 12, value: 240 }],
        transactions: [
          txn({ date: '2026-01-02', type: 'cash', subtype: 'contribution', securityId: 'pool', quantity: 10, amount: -100 }),
          txn({ date: '2026-02-02', type: 'cash', subtype: 'contribution', securityId: 'pool', quantity: 9.09, amount: -100 }),
          txn({ date: '2026-03-02', type: 'cash', subtype: 'dividend', securityId: 'pool', quantity: 0.91, amount: -10.92 }),
        ],
      }),
    );
    const all = p.periods.find((x) => x.key === 'all')!;
    expect(all).toMatchObject({ startValue: 0, endValue: 240, contributions: 200, gain: 40 });
    expect(p.approximated).toEqual(['Growth Pool']);
  });

  it('switches to recorded balances, counts your share of joint accounts, and flags short histories', () => {
    const p = computePerformance(
      input({
        accounts: [
          { id: A, name: 'Brokerage', share: 1, balance: 1000 },
          { id: B, name: 'Joint', share: 0.5, balance: 2000 },
        ],
        holdings: [
          { accountId: A, securityId: 'fund', quantity: 10, price: 100, value: 1000 },
          { accountId: B, securityId: 'fund', quantity: 20, price: 100, value: 2000 },
        ],
        transactions: [txn({ date: '2025-10-01', type: 'cash', subtype: 'interest', amount: 0 })],
        snapshots: [{ date: '2026-03-30', balances: { [A]: 1010, [B]: 1005 } }],
      }),
    );
    expect(p.estimatedBefore).toBe('2026-03-30');
    expect(p.points.find((x) => x.date === '2026-03-30')!.value).toBe(2015);
    const ytd = p.periods.find((x) => x.key === 'ytd')!;
    expect(ytd).toMatchObject({ start: '2025-12-31', startValue: 1800, endValue: 2000, gain: 200, contributions: 0 });
    expect(ytd.byAccount.map((a) => [a.accountName, a.startValue])).toEqual([
      ['Brokerage', 900],
      ['Joint', 900],
    ]);
    expect(p.limitedHistory).toEqual([{ accountName: 'Joint', since: null }]);
    expect(p.periods.map((x) => x.key)).toEqual(['1m', '3m', 'ytd', 'all', '2025']);
  });

  it('treats $0-cash share arrivals (RSU vests) as inflows rather than market gains, without affecting splits or dividends', () => {
    const p = computePerformance(
      input({
        accounts: [{ id: A, name: 'Stock Plan', share: 1, balance: 2100 }],
        holdings: [{ accountId: A, securityId: 'fund', quantity: 21, price: 100, value: 2100 }],
        transactions: [
          txn({ date: '2026-01-05', type: 'cash', subtype: 'deposit', amount: -900 }),
          txn({ date: '2026-01-06', type: 'buy', securityId: 'fund', quantity: 10, price: 90, amount: 900 }),
          // $0-cash RSU vest arriving on Feb 2 at $90/share = $900 inflow, 0% fake return on vest day.
          txn({ date: '2026-02-02', type: 'buy', subtype: 'buy', securityId: 'fund', quantity: 10, price: 90, amount: 0, name: 'RSU VEST' }),
          // Split of 1 share should not be treated as an inflow.
          txn({ date: '2026-02-10', type: 'buy', subtype: 'stock split', securityId: 'fund', quantity: 1, price: 0, amount: 0, name: 'SPLIT' }),
        ],
      }),
    );
    const all = p.periods.find((x) => x.key === 'all')!;
    expect(all.contributions).toBe(1800);
    // $900 initial + $900 RSU vest; shares went from 10->20->21 and price 90->100.
    expect(p.points.find((x) => x.date === '2026-02-02')!.flow).toBe(900);
    expect(p.points.find((x) => x.date === '2026-02-10')!.flow).toBe(0);
  });
});
