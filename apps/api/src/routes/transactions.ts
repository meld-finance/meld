import { CategoryRuleCreate, TransactionQuery, TransactionUpdate } from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transactions } from '../db/schema';
import { HttpError, IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';
import { deleteRule, listRules, saveRule } from '../services/category-rules';
import { listCategories, listSubcategories, queryTransactions } from '../services/transactions';

export async function registerTransactionRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/transactions', (req) => queryTransactions(db, parse(TransactionQuery, req.query)));

  app.get('/transactions/categories', () => listCategories(db));

  app.get('/transactions/subcategories', (req) => {
    const { category } = parse(z.object({ category: z.string().min(1) }), req.query);
    return listSubcategories(db, category);
  });

  app.patch('/transactions/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const update = parse(TransactionUpdate, req.body);
    const recategorized = update.category !== undefined || update.subcategory !== undefined;
    const [row] = await db
      .update(transactions)
      .set({
        ...update,
        // A new category drops the old subcategory unless one is given; a hand edit outranks any rule.
        ...(update.category !== undefined && { subcategory: update.subcategory ?? null }),
        ...(recategorized && { categoryRuleId: null }),
      })
      .where(eq(transactions.id, id))
      .returning({ id: transactions.id });
    if (!row) throw new HttpError(404, 'Transaction not found');
    return { ok: true };
  });

  app.get('/category-rules', () => listRules(db));

  app.post('/category-rules', (req) => saveRule(db, parse(CategoryRuleCreate, req.body)));

  app.delete('/category-rules/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    if (!(await deleteRule(db, id))) throw new HttpError(404, 'Rule not found');
    return { ok: true };
  });
}
