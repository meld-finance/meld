import type { AccountType } from '@meld/shared';
import type { AccountBase, Transaction as PlaidTransaction } from 'plaid';
import type { accounts, transactions } from '../db/schema';

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
