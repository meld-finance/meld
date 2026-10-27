import { TransactionQuery, TransactionUpdate } from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { transactions } from '../db/schema';
import { HttpError, IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';
import { listCategories, queryTransactions } from '../services/transactions';

export async function registerTransactionRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/transactions', (req) => queryTransactions(db, parse(TransactionQuery, req.query)));

  app.get('/transactions/categories', () => listCategories(db));

  app.patch('/transactions/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const update = parse(TransactionUpdate, req.body);
    const [row] = await db
      .update(transactions)
      .set(update)
      .where(eq(transactions.id, id))
      .returning({ id: transactions.id });
    if (!row) throw new HttpError(404, 'Transaction not found');
    return { ok: true };
  });
}
