import type { LiabilitiesObject } from 'plaid';
import { describe, expect, it } from 'vitest';
import { mapAccountType, toLiabilityRows } from './mappers';

describe('toLiabilityRows', () => {
  it('normalizes each liability kind and prefers the purchase APR on cards', () => {
    const rows = toLiabilityRows({
      credit: [
        {
          account_id: 'card',
          aprs: [
            { apr_type: 'cash_apr', apr_percentage: 29.99 },
            { apr_type: 'purchase_apr', apr_percentage: 21.5 },
          ],
          minimum_payment_amount: 35,
          next_payment_due_date: '2026-11-10',
        },
        { account_id: null, aprs: [] }, // no account → skipped
      ],
      mortgage: [
        {
          account_id: 'home',
          interest_rate: { percentage: 6.25, type: 'fixed' },
          next_monthly_payment: 2400,
          next_payment_due_date: '2026-11-01',
          origination_date: '2021-06-01',
          origination_principal_amount: 400000,
          maturity_date: '2051-06-01',
          escrow_balance: 3200,
        },
      ],
      loan: [{ account_id: 'auto', interest_rate: null, next_payment_amount: 450 }],
      student: null,
    } as unknown as LiabilitiesObject);

    expect(rows.map((r) => [r.plaidAccountId, r.row.kind, r.row.interestRatePct, r.row.minimumPayment])).toEqual([
      ['card', 'credit', 21.5, 35],
      ['home', 'mortgage', 6.25, 2400],
      ['auto', 'loan', null, 450],
    ]);
    expect(rows[1]!.row).toMatchObject({ escrowBalance: 3200, maturityDate: '2051-06-01' });
  });

  it('never keeps full account numbers in the stored payload', () => {
    const [row] = toLiabilityRows({
      mortgage: [
        { account_id: 'home', account_number: '3120194154', interest_rate: { percentage: 3, type: 'fixed' } },
      ],
      student: [{ account_id: 'edu', account_number: '4277075694', payment_reference_number: '4277075694', interest_rate_percentage: 5 }],
    } as unknown as LiabilitiesObject).map((r) => r.row);
    expect(JSON.stringify(row!.details)).not.toContain('3120194154');
    expect(JSON.stringify(toLiabilityRows({
      student: [{ account_id: 'edu', account_number: '4277075694', payment_reference_number: '4277075694', interest_rate_percentage: 5 }],
    } as unknown as LiabilitiesObject))).not.toContain('4277075694');
  });
});

describe('mapAccountType', () => {
  it.each([
    ['loan', 'mortgage', 'mortgage'],
    ['loan', 'student', 'loan'],
    ['brokerage', null, 'investment'],
    ['investment', '401k', 'investment'],
    ['depository', 'checking', 'depository'],
    ['credit', 'credit card', 'credit'],
    ['payroll', null, 'other'],
  ])('%s/%s → %s', (type, subtype, expected) => {
    expect(mapAccountType(type, subtype)).toBe(expected);
  });
});
