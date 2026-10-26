import {
  AccountUpdate,
  taxTreatment,
  type Account,
  type AccountDetail,
  type Holding,
  type InvestmentsSummary,
  type LiabilityKind,
} from '@meld/shared';
import { asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { accounts, holdings, institutions, liabilities, securities } from '../db/schema';
import { HttpError, IdParams, parse } from '../lib/http';
import { recordSnapshot } from '../services/overview';
import type { AppDeps } from '../server';

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
  updatedAt: accounts.updatedAt,
};

async function listAccounts(db: Db, where?: SQL): Promise<Account[]> {
  const rows = await db
    .select(accountColumns)
    .from(accounts)
    .leftJoin(institutions, eq(institutions.id, accounts.institutionId))
    .where(where)
    .orderBy(asc(accounts.type), asc(institutions.name), asc(accounts.name));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

async function listHoldings(db: Db, where: SQL): Promise<Holding[]> {
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

export async function registerAccountRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/accounts', (req) => {
    const { includeHidden } = parse(z.object({ includeHidden: z.stringbool().default(false) }), req.query);
    return listAccounts(db, includeHidden ? undefined : eq(accounts.hidden, false));
  });

  app.get('/accounts/:id', async (req): Promise<AccountDetail> => {
    const { id } = parse(IdParams, req.params);
    const [account] = await listAccounts(db, eq(accounts.id, id));
    if (!account) throw new HttpError(404, 'Account not found');
    const liability = await db.query.liabilities.findFirst({ where: eq(liabilities.accountId, id) });
    return {
      account,
      liability: liability
        ? {
            kind: liability.kind as LiabilityKind,
            interestRatePct: liability.interestRatePct,
            minimumPayment: liability.minimumPayment,
            nextPaymentDueDate: liability.nextPaymentDueDate,
            originationDate: liability.originationDate,
            originationPrincipal: liability.originationPrincipal,
            maturityDate: liability.maturityDate,
            escrowBalance: liability.escrowBalance,
          }
        : null,
      holdings: await listHoldings(db, eq(holdings.accountId, id)),
    };
  });

  app.patch('/accounts/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const update = parse(AccountUpdate, req.body);
    const [row] = await db.update(accounts).set(update).where(eq(accounts.id, id)).returning({ id: accounts.id });
    if (!row) throw new HttpError(404, 'Account not found');
    // Hiding changes net worth today.
    if (update.hidden !== undefined) await recordSnapshot(db);
    return { ok: true };
  });

  app.get('/investments', async (): Promise<InvestmentsSummary> => {
    const list = await listHoldings(db, eq(accounts.hidden, false));
    return {
      totalValue: Math.round(list.reduce((sum, h) => sum + (h.value ?? 0), 0) * 100) / 100,
      holdings: list,
    };
  });
}
