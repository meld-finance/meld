import { AccountUpdate, type AccountDetail } from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accounts, holdings } from '../db/schema';
import { HttpError, IdParams, parse } from '../lib/http';
import { getInvestmentsSummary, getLiability, listAccounts, listLiabilities, listHoldings } from '../services/accounts';
import { recordSnapshot } from '../services/overview';
import type { AppDeps } from '../server';

export async function registerAccountRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/accounts', (req) => {
    const { includeHidden } = parse(z.object({ includeHidden: z.stringbool().default(false) }), req.query);
    return listAccounts(db, includeHidden ? undefined : eq(accounts.hidden, false));
  });

  app.get('/accounts/:id', async (req): Promise<AccountDetail> => {
    const { id } = parse(IdParams, req.params);
    const [account] = await listAccounts(db, eq(accounts.id, id));
    if (!account) throw new HttpError(404, 'Account not found');
    return {
      account,
      liability: await getLiability(db, id),
      holdings: await listHoldings(db, eq(holdings.accountId, id)),
    };
  });
  app.patch('/accounts/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const update = parse(AccountUpdate, req.body);
    const [row] = await db.update(accounts).set(update).where(eq(accounts.id, id)).returning({ id: accounts.id });
    if (!row) throw new HttpError(404, 'Account not found');
    // Hiding or changing your share changes net worth today.
    if (update.hidden !== undefined || update.ownershipPercent !== undefined) await recordSnapshot(db);
    return { ok: true };
  });

  app.get('/investments', () => getInvestmentsSummary(db));

  app.get('/liabilities', () => listLiabilities(db));
}
