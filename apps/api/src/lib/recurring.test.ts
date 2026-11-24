import { describe, expect, it } from 'vitest';
import {
  addMonths,
  autopayHealth,
  detectRecurring,
  fitCadence,
  merchantKey,
  nextPayment,
  occurrencesThrough,
  type PayeeInput,
  type RecurringTxn,
} from './recurring';

const TODAY = '2026-11-02';
let seq = 0;
const txn = (date: string, amount: number, name: string, extra: Partial<RecurringTxn> = {}): RecurringTxn => ({
  id: `t${seq++}`,
  accountId: '00000000-0000-4000-8000-000000000001',
  accountName: 'Card',
  date,
  amount,
  name,
  merchantName: null,
  category: 'ENTERTAINMENT',
  plaidCategory: null,
  detailed: null,
  ...extra,
});
const monthly = (from: string, n: number, amount: number | ((i: number) => number), name: string, extra?: Partial<RecurringTxn>) =>
  Array.from({ length: n }, (_, i) => txn(addMonths(from, i), typeof amount === 'number' ? amount : amount(i), name, extra));

describe('dates', () => {
  it('keeps the day of the month, clamping to shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(occurrencesThrough('2026-01-31', 'monthly', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

describe('merchantKey', () => {
  it('drops numbers, punctuation and payment noise from descriptions', () => {
    expect(merchantKey({ name: 'POS DEBIT NETFLIX.COM 866-579-7172', merchantName: null })).toBe('netflix');
    expect(merchantKey({ name: 'anything', merchantName: 'Spotify' })).toBe('spotify');
    expect(merchantKey({ name: 'PG&E WEB ONLINE PAYMENT 102526', merchantName: null })).toBe('pg');
  });
});

describe('fitCadence', () => {
  it('reads monthly charges that drift a few days, and a skipped month', () => {
    expect(fitCadence(['2026-06-01', '2026-07-03', '2026-08-01', '2026-10-02', '2026-11-01'])).toBe('monthly');
  });
  it('tells weekly from biweekly', () => {
    expect(fitCadence(['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16'])).toBe('biweekly');
    expect(fitCadence(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'])).toBe('weekly');
  });
  it('rejects irregular gaps', () => {
    expect(fitCadence(['2026-08-01', '2026-08-05', '2026-09-20', '2026-10-02', '2026-10-30'])).toBeNull();
  });
});

describe('detectRecurring', () => {
  it('finds a subscription and its price increase', () => {
    const [s] = detectRecurring(monthly('2026-03-15', 8, (i) => (i < 7 ? 15.49 : 17.99), 'NETFLIX.COM', { merchantName: 'Netflix' }), TODAY);
    expect(s).toMatchObject({
      name: 'Netflix',
      kind: 'subscription',
      cadence: 'monthly',
      amount: 17.99,
      amountVaries: false,
      status: 'active',
      nextDate: '2026-11-15',
      priceChange: { from: 15.49, to: 17.99, date: '2026-10-15' },
    });
  });

  it('splits one merchant into its separate subscriptions', () => {
    const series = detectRecurring(
      [
        ...monthly('2026-05-03', 6, 0.99, 'APPLE.COM/BILL'),
        ...monthly('2026-05-19', 6, 9.99, 'APPLE.COM/BILL'),
        txn('2026-07-07', 54.12, 'APPLE.COM/BILL'),
      ],
      TODAY,
    );
    expect(series.map((s) => [s.amount, s.cadence])).toEqual([
      [9.99, 'monthly'],
      [0.99, 'monthly'],
    ]);
    expect(new Set(series.map((s) => s.key)).size).toBe(2);
  });

  it('keeps a utility bill whose amount varies, as a bill', () => {
    const amounts = [88, 142, 120, 97, 76, 131];
    const [s] = detectRecurring(monthly('2026-05-22', 6, (i) => amounts[i]!, 'PG&E WEB ONLINE', { category: 'RENT_AND_UTILITIES' }), TODAY);
    expect(s).toMatchObject({ kind: 'bill', amountVaries: true, amount: 97, priceChange: null });
  });

  it('keeps a utility bill whose amount drifts by a little each month, as varying', () => {
    const amounts = [41.74, 41.11, 41.63, 43.11, 43.44];
    const [s] = detectRecurring(monthly('2026-06-04', 5, (i) => amounts[i]!, 'PGANDE'), TODAY);
    expect(s).toMatchObject({ kind: 'bill', amountVaries: true });
  });

  it('keeps a subscription after a price rise it has held for months', () => {
    const [s] = detectRecurring(monthly('2025-11-10', 13, (i) => (i < 4 ? 16.99 : 18.99), 'Spotify'), TODAY);
    expect(s).toMatchObject({ kind: 'subscription', amountVaries: false, amount: 18.99, priceChange: null });
  });

  it('keeps a subscription with a one-off extra charge in between', () => {
    const txns = [...monthly('2026-04-22', 7, 20, 'ANTHROPIC'), txn('2026-08-23', 35, 'ANTHROPIC')];
    const [s] = detectRecurring(txns, TODAY);
    expect(s).toMatchObject({ kind: 'subscription', amountVaries: false, amount: 20 });
  });

  it('keeps a subscription charged in another currency, which moves by cents', () => {
    const amounts = [10.87, 10.91, 10.79, 10.84, 10.93, 10.81];
    const [s] = detectRecurring(monthly('2026-05-03', 6, (i) => amounts[i]!, 'OBSIDIAN'), TODAY);
    expect(s).toMatchObject({ kind: 'subscription', amountVaries: false });
  });

  it('calls insurance a bill under your own category name, or by what Plaid says it is', () => {
    const [yours] = detectRecurring(monthly('2026-04-04', 7, 1582.38, 'KAISER PAY', { category: 'Insurance' }), TODAY);
    expect(yours!.kind).toBe('bill');
    const [plaids] = detectRecurring(monthly('2026-04-04', 7, 1582.38, 'KAISER PAY', { category: 'Health', plaidCategory: 'MEDICAL' }), TODAY);
    expect(plaids!.kind).toBe('bill');
  });

  it('ignores everyday spending at varying amounts and dates', () => {
    const groceries = ['2026-08-02', '2026-08-09', '2026-08-15', '2026-08-23', '2026-08-30', '2026-09-06', '2026-09-12', '2026-09-21'].map(
      (d, i) => txn(d, [64, 112, 38, 151, 87, 23, 140, 76][i]!, 'TRADER JOES', { category: 'FOOD_AND_DRINK' }),
    );
    expect(detectRecurring(groceries, TODAY)).toEqual([]);
  });

  it('accepts a yearly charge seen twice at the same price, but not two restaurant meals a year apart', () => {
    const series = detectRecurring(
      [
        txn('2025-03-10', 139, 'AMAZON PRIME', { category: 'GENERAL_SERVICES' }),
        txn('2026-03-10', 139, 'AMAZON PRIME', { category: 'GENERAL_SERVICES' }),
        txn('2025-06-01', 42, 'NOPA', { category: 'FOOD_AND_DRINK' }),
        txn('2026-06-02', 42, 'NOPA', { category: 'FOOD_AND_DRINK' }),
      ],
      TODAY,
    );
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ cadence: 'annual', nextDate: '2027-03-10', monthlyAmount: 11.58 });
  });

  it('marks a series that stopped charging, and applies your corrections', () => {
    const txns = monthly('2026-01-05', 5, 12, 'HULU');
    const [stopped] = detectRecurring(txns, TODAY);
    expect(stopped!.status).toBe('stopped');
    const [fixed] = detectRecurring(txns, TODAY, new Map([[stopped!.key, { ignored: true, kind: 'bill', name: 'Hulu + Live' }]]));
    expect(fixed).toMatchObject({ status: 'ignored', kind: 'bill', detectedKind: 'subscription', name: 'Hulu + Live' });
  });

  it('calls repeating deposits income', () => {
    const pay = ['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30'].map((d) => txn(d, -3200, 'ACME PAYROLL', { category: 'INCOME' }));
    expect(detectRecurring(pay, TODAY)[0]).toMatchObject({ kind: 'income', cadence: 'biweekly', amount: 3200, nextDate: '2026-11-13' });
  });
});

const card = (over: Partial<PayeeInput> & { details?: object; due?: string | null; minimum?: number | null } = {}): PayeeInput => ({
  type: 'credit',
  currentBalance: over.currentBalance ?? 2_400,
  paymentsSinceStatement: over.paymentsSinceStatement ?? 0,
  liability: {
    kind: 'credit',
    minimumPayment: over.minimum === undefined ? 40 : over.minimum,
    nextPaymentDueDate: over.due === undefined ? '2026-11-18' : over.due,
    details: { last_statement_balance: 1_850, last_statement_issue_date: '2026-10-22', ...over.details },
  },
});

describe('nextPayment', () => {
  it('pays the statement balance less what was paid since', () => {
    expect(nextPayment(card(), 'statement_balance', null, TODAY)).toMatchObject({
      dueDate: '2026-11-18',
      amount: 1_850,
      amountSource: 'statement',
      paid: false,
    });
    expect(nextPayment(card({ paymentsSinceStatement: 600 }), 'statement_balance', null, TODAY)).toMatchObject({ amount: 1_250 });
  });

  it('treats a paid statement as done and estimates the next one from the balance', () => {
    const p = nextPayment(
      card({ details: { last_payment_date: '2026-10-30', last_payment_amount: 1_850 } }),
      'statement_balance',
      null,
      TODAY,
    );
    expect(p).toMatchObject({ paid: true, dueDate: '2026-12-18', amount: 2_400, amountSource: 'estimate' });
  });

  it('rolls a past due date forward and estimates', () => {
    expect(nextPayment(card({ due: '2026-10-18' }), 'statement_balance', null, TODAY)).toMatchObject({
      dueDate: '2026-11-18',
      amount: 2_400,
      amountSource: 'estimate',
    });
  });

  it('handles minimum, fixed and current-balance rules', () => {
    expect(nextPayment(card(), 'minimum', null, TODAY)).toMatchObject({ amount: 40, amountSource: 'minimum' });
    expect(nextPayment(card(), 'fixed', 500, TODAY)).toMatchObject({ amount: 500, amountSource: 'fixed' });
    expect(nextPayment(card({ paymentsSinceStatement: 500 }), 'fixed', 500, TODAY)).toMatchObject({ paid: true });
    expect(nextPayment(card(), 'current_balance', null, TODAY)).toMatchObject({ amount: 2_400, amountSource: 'balance' });
  });

  it('uses a loan’s scheduled payment', () => {
    const loan: PayeeInput = {
      type: 'mortgage',
      currentBalance: 412_000,
      paymentsSinceStatement: 0,
      liability: { kind: 'mortgage', minimumPayment: 3_120, nextPaymentDueDate: '2026-11-01', details: null },
    };
    expect(nextPayment(loan, 'statement_balance', null, TODAY)).toMatchObject({ dueDate: '2026-12-01', amount: 3_120, amountSource: 'scheduled' });
  });
});

describe('autopayHealth', () => {
  const payment = nextPayment(card(), 'statement_balance', null, TODAY);
  const base = { payment, payeeName: 'Sapphire', fundingName: 'Checking', cushion: 0 };

  it('is short when the account can’t cover the payment and the bills before it', () => {
    const h = autopayHealth({ ...base, fundingBalance: 1_900, before: [{ name: 'Comcast', date: '2026-11-10', amount: 90, source: 'recurring' }] });
    expect(h).toMatchObject({ health: 'short', projectedAfter: -40 });
    expect(h.summary).toBe('Checking has $1,900, $40 short of the $1,850 due Nov 18, counting $90 in other payments before then.');
  });

  it('counts a paycheck that lands first', () => {
    const h = autopayHealth({ ...base, fundingBalance: 1_000, before: [{ name: 'Payroll', date: '2026-11-13', amount: 3_200, source: 'income' }] });
    expect(h).toMatchObject({ health: 'covered', projectedAfter: 2_350 });
  });

  it('is tight inside the cushion', () => {
    expect(autopayHealth({ ...base, cushion: 500, fundingBalance: 2_000, before: [] }).health).toBe('tight');
  });
});
