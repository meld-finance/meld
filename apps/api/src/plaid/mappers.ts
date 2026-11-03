import type { AccountType, LiabilityKind } from '@meld/shared';
import type {
  AccountBase,
  APR,
  Holding as PlaidHolding,
  InvestmentTransaction as PlaidInvestmentTransaction,
  LiabilitiesObject,
  Transaction as PlaidTransaction,
  Security as PlaidSecurity,
} from 'plaid';
import type { accounts, holdings, investmentTransactions, liabilities, securities, transactions } from '../db/schema';

export function mapAccountType(type: string, subtype: string | null): AccountType {
  if (type === 'loan' && subtype === 'mortgage') return 'mortgage';
  if (type === 'brokerage') return 'investment';
  if (type === 'depository' || type === 'credit' || type === 'investment' || type === 'loan') return type;
  return 'other';
}

export function toAccountRow(
  a: AccountBase,
  ids: { plaidItemId: string; institutionId: string | null },
): typeof accounts.$inferInsert {
  return {
    source: 'plaid',
    plaidItemId: ids.plaidItemId,
    institutionId: ids.institutionId,
    plaidAccountId: a.account_id,
    name: a.name,
    officialName: a.official_name,
    mask: a.mask,
    type: mapAccountType(a.type, a.subtype),
    subtype: a.subtype,
    currentBalance: a.balances.current,
    availableBalance: a.balances.available,
    creditLimit: a.balances.limit,
    currency: a.balances.iso_currency_code ?? a.balances.unofficial_currency_code ?? 'USD',
  };
}

export function toTransactionRow(t: PlaidTransaction, accountId: string): typeof transactions.$inferInsert {
  return {
    accountId,
    plaidTransactionId: t.transaction_id,
    amount: t.amount,
    currency: t.iso_currency_code ?? t.unofficial_currency_code ?? 'USD',
    date: t.date,
    authorizedDate: t.authorized_date,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    plaidCategoryPrimary: t.personal_finance_category?.primary ?? null,
    plaidCategoryDetailed: t.personal_finance_category?.detailed ?? null,
    pending: t.pending,
  };
}

export function toSecurityRow(s: PlaidSecurity): typeof securities.$inferInsert {
  return {
    plaidSecurityId: s.security_id,
    tickerSymbol: s.ticker_symbol,
    name: s.name,
    // Plaid's type wins: it flags some non-cash assets (e.g. BTC) as cash equivalents.
    type: s.type ?? (s.is_cash_equivalent ? 'cash' : null),
    subtype: s.subtype ?? null,
    sector: s.sector,
    industry: s.industry,
    closePrice: s.close_price,
    closePriceAsOf: s.close_price_as_of,
    fixedIncome: s.fixed_income
      ? {
          yieldPercent: s.fixed_income.yield_rate?.percentage ?? null,
          yieldType: s.fixed_income.yield_rate?.type ?? null,
          maturityDate: s.fixed_income.maturity_date ?? null,
          issueDate: s.fixed_income.issue_date ?? null,
          faceValue: s.fixed_income.face_value ?? null,
        }
      : null,
  };
}

export function toHoldingRow(h: PlaidHolding, accountId: string, securityId: string): typeof holdings.$inferInsert {
  return {
    accountId,
    securityId,
    quantity: h.quantity,
    institutionPrice: h.institution_price,
    institutionValue: h.institution_value,
    costBasis: h.cost_basis,
  };
}

export function toInvestmentTransactionRow(
  t: PlaidInvestmentTransaction,
  accountId: string,
  securityId: string | null,
): typeof investmentTransactions.$inferInsert {
  return {
    accountId,
    securityId,
    plaidInvestmentTransactionId: t.investment_transaction_id,
    date: t.date,
    name: t.name,
    type: t.type,
    subtype: t.subtype,
    quantity: t.quantity,
    price: t.price,
    amount: t.amount,
    fees: t.fees,
  };
}

type LiabilityRow = Omit<typeof liabilities.$inferInsert, 'accountId'> & { kind: LiabilityKind };

const SENSITIVE_KEYS = new Set(['account_number', 'payment_reference_number']);

/** Full account numbers aren't needed for anything Meld does, so they're never stored. */
export function stripSensitive<T extends object>(payload: T): Partial<T> {
  return Object.fromEntries(Object.entries(payload).filter(([k]) => !SENSITIVE_KEYS.has(k))) as Partial<T>;
}

/** Purchase APR is the one that applies to a carried card balance. */
function purchaseApr(aprs: APR[]): number | null {
  return (aprs.find((a) => a.apr_type === 'purchase_apr') ?? aprs[0])?.apr_percentage ?? null;
}

/** Normalizes Plaid's per-kind liability shapes, keyed by Plaid account id. */
export function toLiabilityRows(l: LiabilitiesObject): { plaidAccountId: string; row: LiabilityRow }[] {
  const out: { plaidAccountId: string; row: LiabilityRow }[] = [];
  const base = { originationDate: null, originationPrincipal: null, maturityDate: null, escrowBalance: null };

  for (const c of l.credit ?? []) {
    if (!c.account_id) continue;
    out.push({
      plaidAccountId: c.account_id,
      row: {
        ...base,
        kind: 'credit',
        interestRatePct: purchaseApr(c.aprs),
        minimumPayment: c.minimum_payment_amount,
        nextPaymentDueDate: c.next_payment_due_date,
        details: stripSensitive(c),
      },
    });
  }
  for (const m of l.mortgage ?? []) {
    out.push({
      plaidAccountId: m.account_id,
      row: {
        kind: 'mortgage',
        interestRatePct: m.interest_rate.percentage,
        minimumPayment: m.next_monthly_payment,
        nextPaymentDueDate: m.next_payment_due_date,
        originationDate: m.origination_date,
        originationPrincipal: m.origination_principal_amount,
        maturityDate: m.maturity_date,
        escrowBalance: m.escrow_balance,
        details: stripSensitive(m),
      },
    });
  }
  for (const s of l.student ?? []) {
    if (!s.account_id) continue;
    out.push({
      plaidAccountId: s.account_id,
      row: {
        ...base,
        kind: 'student',
        interestRatePct: s.interest_rate_percentage,
        minimumPayment: s.minimum_payment_amount,
        nextPaymentDueDate: s.next_payment_due_date,
        originationDate: s.origination_date,
        originationPrincipal: s.origination_principal_amount,
        maturityDate: s.expected_payoff_date,
        details: stripSensitive(s),
      },
    });
  }
  for (const loan of l.loan ?? []) {
    out.push({
      plaidAccountId: loan.account_id,
      row: {
        ...base,
        kind: 'loan',
        interestRatePct: loan.interest_rate?.percentage ?? null,
        minimumPayment: loan.next_payment_amount,
        nextPaymentDueDate: loan.next_payment_due_date,
        originationDate: loan.origination_date,
        originationPrincipal: loan.origination_principal_amount,
        maturityDate: loan.maturity_date,
        details: stripSensitive(loan),
      },
    });
  }
  for (const loc of l.line_of_credit ?? []) {
    out.push({
      plaidAccountId: loc.account_id,
      row: {
        ...base,
        kind: 'line_of_credit',
        interestRatePct: loc.interest_rate?.percentage ?? purchaseApr(loc.aprs),
        minimumPayment: loc.minimum_payment_amount ?? loc.next_payment_amount,
        nextPaymentDueDate: loc.next_payment_due_date,
        details: stripSensitive(loc),
      },
    });
  }
  return out;
}
