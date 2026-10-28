import { inArray } from 'drizzle-orm';
import type { InvestmentTransaction, PlaidApi, Security } from 'plaid';
import type { Db } from '../db/client';
import { holdings, investmentTransactions, liabilities, securities } from '../db/schema';
import { chunk, excluded } from '../db/upsert';
import { localDate } from '../lib/networth';
import { getPlaidError } from './client';
import { toHoldingRow, toInvestmentTransactionRow, toLiabilityRows, toSecurityRow } from './mappers';

/**
 * Investments and liabilities are optional products: an institution may not
 * support them, or the item was linked without consent. These codes mean
 * "nothing to sync here" rather than a broken connection.
 */
const PRODUCT_UNAVAILABLE = new Set([
  'PRODUCTS_NOT_SUPPORTED',
  'PRODUCT_NOT_ENABLED',
  'PRODUCT_NOT_READY',
  'ADDITIONAL_CONSENT_REQUIRED',
  'INVALID_PRODUCT',
  'NO_INVESTMENT_ACCOUNTS',
  'NO_INVESTMENT_AUTH_ACCOUNTS',
  'NO_LIABILITY_ACCOUNTS',
]);

async function optionalProduct<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const code = getPlaidError(err)?.error_code;
    if (code && PRODUCT_UNAVAILABLE.has(code)) return null;
    throw err;
  }
}

type Ctx = { db: Db; plaid: PlaidApi; accessToken: string; accountIdByPlaidId: Map<string, string> };

const INVESTMENT_HISTORY_DAYS = 730;

export async function syncInvestments({ db, plaid, accessToken, accountIdByPlaidId }: Ctx) {
  const holdingsRes = await optionalProduct(() => plaid.investmentsHoldingsGet({ access_token: accessToken }));
  if (!holdingsRes) return { holdings: 0, investmentTransactions: 0 };
  const { data } = holdingsRes;

  const end = localDate();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - INVESTMENT_HISTORY_DAYS);
  const txns: InvestmentTransaction[] = [];
  const txnSecurities: Security[] = [];
  for (let offset = 0; ; ) {
    const page = await optionalProduct(() =>
      plaid.investmentsTransactionsGet({
        access_token: accessToken,
        start_date: localDate(startDate),
        end_date: end,
        options: { count: 500, offset },
      }),
    );
    if (!page) break;
    txns.push(...page.data.investment_transactions);
    txnSecurities.push(...page.data.securities);
    offset += page.data.investment_transactions.length;
    if (offset >= page.data.total_investment_transactions || page.data.investment_transactions.length === 0) break;
  }

  return db.transaction(async (tx) => {
    const allSecurities = new Map([...data.securities, ...txnSecurities].map((s) => [s.security_id, s]));
    const securityRows = [...allSecurities.values()].map(toSecurityRow);
    const securityIdByPlaidId = new Map<string, string>();
    for (const batch of chunk(securityRows, 500)) {
      const rows = await tx
        .insert(securities)
        .values(batch)
        .onConflictDoUpdate({
          target: securities.plaidSecurityId,
          set: excluded(securities, ['tickerSymbol', 'name', 'type', 'subtype', 'sector', 'industry', 'closePrice', 'closePriceAsOf']),
        })
        .returning({ id: securities.id, plaidSecurityId: securities.plaidSecurityId });
      for (const r of rows) securityIdByPlaidId.set(r.plaidSecurityId!, r.id);
    }

    // Holdings are a point-in-time snapshot: replace them for this item's accounts.
    const investmentAccountIds = data.accounts
      .map((a) => accountIdByPlaidId.get(a.account_id))
      .filter((id): id is string => !!id);
    if (investmentAccountIds.length) {
      await tx.delete(holdings).where(inArray(holdings.accountId, investmentAccountIds));
    }
    const holdingRows = data.holdings.flatMap((h) => {
      const accountId = accountIdByPlaidId.get(h.account_id);
      const securityId = securityIdByPlaidId.get(h.security_id);
      return accountId && securityId ? [toHoldingRow(h, accountId, securityId)] : [];
    });
    for (const batch of chunk(holdingRows, 500)) await tx.insert(holdings).values(batch);

    const txnRows = txns.flatMap((t) => {
      const accountId = accountIdByPlaidId.get(t.account_id);
      if (!accountId) return [];
      const securityId = t.security_id ? (securityIdByPlaidId.get(t.security_id) ?? null) : null;
      return [toInvestmentTransactionRow(t, accountId, securityId)];
    });
    for (const batch of chunk(txnRows, 500)) {
      await tx
        .insert(investmentTransactions)
        .values(batch)
        .onConflictDoUpdate({
          target: investmentTransactions.plaidInvestmentTransactionId,
          set: excluded(investmentTransactions, ['date', 'name', 'type', 'subtype', 'quantity', 'price', 'amount', 'fees', 'securityId']),
        });
    }
    return { holdings: holdingRows.length, investmentTransactions: txnRows.length };
  });
}

export async function syncLiabilities({ db, plaid, accessToken, accountIdByPlaidId }: Ctx) {
  const res = await optionalProduct(() => plaid.liabilitiesGet({ access_token: accessToken }));
  if (!res) return 0;
  const rows = toLiabilityRows(res.data.liabilities).flatMap(({ plaidAccountId, row }) => {
    const accountId = accountIdByPlaidId.get(plaidAccountId);
    return accountId ? [{ ...row, accountId }] : [];
  });
  if (!rows.length) return 0;
  await db
    .insert(liabilities)
    .values(rows)
    .onConflictDoUpdate({
      target: liabilities.accountId,
      set: excluded(liabilities, [
        'kind',
        'interestRatePct',
        'minimumPayment',
        'nextPaymentDueDate',
        'originationDate',
        'originationPrincipal',
        'maturityDate',
        'escrowBalance',
        'details',
      ]),
    });
  return rows.length;
}
