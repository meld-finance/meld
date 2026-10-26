import type { Account } from '@meld/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accounts, institutions } from '../db/schema';
import type { AppDeps } from '../server';

export async function registerAccountRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/accounts', async (): Promise<Account[]> => {
    const rows = await db
      .select({
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
        updatedAt: accounts.updatedAt,
      })
      .from(accounts)
      .leftJoin(institutions, eq(institutions.id, accounts.institutionId))
      .where(eq(accounts.hidden, false))
      .orderBy(asc(accounts.type), asc(institutions.name), asc(accounts.name));
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  });
}
