import { taxTreatment, type Account, type Holding, type InvestmentsSummary, type LiabilityDetails, type LiabilityKind, type LiabilitySummary } from '@meld/shared';
import { asc, desc, eq, sql, type SQL } from 'drizzle-orm';
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
      accountName: accounts.name,
      accountSubtype: accounts.subtype,
      ticker: securities.tickerSymbol,
      name: securities.name,
      securityType: securities.type,
      quantity: holdings.quantity,
      price: sql<number | null>`coalesce(${holdings.institutionPrice}, ${securities.closePrice})`.mapWith(Number),
      value: holdings.institutionValue,
      costBasis: holdings.costBasis,
    })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .innerJoin(securities, eq(securities.id, holdings.securityId))
    .where(where)
    .orderBy(desc(holdings.institutionValue));
  return rows.map((r) => ({ ...r, taxTreatment: taxTreatment(r.accountSubtype) }));
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

export async function getInvestmentsSummary(db: Db): Promise<InvestmentsSummary> {
  const list = await listHoldings(db, eq(accounts.hidden, false));
  return {
    totalValue: Math.round(list.reduce((sum, h) => sum + (h.value ?? 0), 0) * 100) / 100,
    holdings: list,
  };
}
