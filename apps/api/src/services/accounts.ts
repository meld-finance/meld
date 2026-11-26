import { CASH_PROFILE, taxTreatment, type Account, type Holding, type LiabilityDetails, type LiabilityKind, type LiabilitySummary } from '@meld/shared';
import { and, asc, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, holdings, institutions, liabilities, securities } from '../db/schema';

const accountColumns = {
  id: accounts.id,
  source: accounts.source,
  itemId: accounts.plaidItemId,
  institutionName: institutions.name,
  name: accounts.name,
  officialName: accounts.officialName,
  mask: accounts.mask,
  type: accounts.type,
  subtype: accounts.subtype,
  currentBalance: accounts.currentBalance,
  availableBalance: accounts.availableBalance,
  creditLimit: accounts.creditLimit,
  currency: accounts.currency,
  hidden: accounts.hidden,
  ownershipPercent: accounts.ownershipPercent,
  updatedAt: accounts.updatedAt,
};

export async function listAccounts(db: Db, where?: SQL): Promise<Account[]> {
  const rows = await db
    .select(accountColumns)
    .from(accounts)
    .leftJoin(institutions, eq(institutions.id, accounts.institutionId))
    .where(where)
    .orderBy(asc(accounts.type), asc(institutions.name), asc(accounts.name));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function listHoldings(db: Db, where: SQL): Promise<Holding[]> {
  const rows = await db
    .select({
      id: holdings.id,
      accountId: holdings.accountId,
      securityId: holdings.securityId,
      accountName: accounts.name,
      accountSubtype: accounts.subtype,
      ticker: securities.tickerSymbol,
      name: securities.name,
      securityType: securities.type,
      quantity: holdings.quantity,
      price: sql<number | null>`coalesce(${holdings.institutionPrice}, ${securities.closePrice})`.mapWith(Number),
      value: holdings.institutionValue,
      costBasis: holdings.costBasis,
      vestedQuantity: holdings.vestedQuantity,
      vestedValue: holdings.vestedValue,
      profile: securities.profile,
      fixedIncome: securities.fixedIncome,
    })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .innerJoin(securities, eq(securities.id, holdings.securityId))
    .where(where)
    .orderBy(desc(holdings.institutionValue));
  return rows.map((r) => ({
    ...r,
    taxTreatment: taxTreatment(r.accountSubtype),
    profile: r.securityType === 'cash' ? CASH_PROFILE : r.profile,
  }));
}

/**
 * Some stock-plan brokers include unvested RSUs inside Plaid's holding quantity/value while
 * reporting only the vested portion in `vested_quantity`/`vested_value`. Returns the unvested
 * dollar excess to exclude from Net Worth and portfolio totals.
 */
export function unvestedHoldingAmount(h: {
  value: number | null;
  quantity: number;
  vestedValue: number | null;
  vestedQuantity: number | null;
  accountSubtype: string | null;
}): number {
  if (
    h.value === null ||
    h.vestedValue === null ||
    h.vestedQuantity === null ||
    h.vestedValue >= h.value ||
    (h.vestedValue <= 0 && h.accountSubtype?.toLowerCase() !== 'stock plan')
  ) {
    return 0;
  }
  return Math.max(0, h.value - h.vestedValue);
}

/** Total Plaid-reported unvested dollar excess per visible investment account. */
export async function unvestedAmountsByAccount(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({
      accountId: holdings.accountId,
      accountSubtype: accounts.subtype,
      quantity: holdings.quantity,
      value: holdings.institutionValue,
      vestedQuantity: holdings.vestedQuantity,
      vestedValue: holdings.vestedValue,
    })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(and(eq(accounts.hidden, false), eq(accounts.type, 'investment'), isNotNull(holdings.vestedValue)));
  const out = new Map<string, number>();
  for (const r of rows) {
    const excess = unvestedHoldingAmount(r);
    if (excess > 0) out.set(r.accountId, (out.get(r.accountId) ?? 0) + excess);
  }
  return out;
}

type LiabilityRow = typeof liabilities.$inferSelect;

function toLiabilityDetails(l: LiabilityRow): LiabilityDetails {
  return {
    kind: l.kind as LiabilityKind,
    interestRatePct: l.interestRatePct,
    minimumPayment: l.minimumPayment,
    nextPaymentDueDate: l.nextPaymentDueDate,
    originationDate: l.originationDate,
    originationPrincipal: l.originationPrincipal,
    maturityDate: l.maturityDate,
    escrowBalance: l.escrowBalance,
  };
}

export async function getLiability(db: Db, accountId: string): Promise<LiabilityDetails | null> {
  const row = await db.query.liabilities.findFirst({ where: eq(liabilities.accountId, accountId) });
  return row ? toLiabilityDetails(row) : null;
}

/** Loan and card terms for every visible account that has them. */
export async function listLiabilities(db: Db): Promise<LiabilitySummary[]> {
  const rows = await db
    .select({ liability: liabilities, accountId: accounts.id, accountName: accounts.name, balance: accounts.currentBalance })
    .from(liabilities)
    .innerJoin(accounts, eq(accounts.id, liabilities.accountId))
    .where(eq(accounts.hidden, false))
    .orderBy(asc(accounts.name));
  return rows.map((r) => ({
    accountId: r.accountId,
    accountName: r.accountName,
    balance: r.balance,
    ...toLiabilityDetails(r.liability),
  }));
}
