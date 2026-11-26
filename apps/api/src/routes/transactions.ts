import { CategoryRuleCreate, TransactionQuery, TransactionUpdate } from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transactions } from '../db/schema';
import { HttpError, IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';
import { deleteRule, listRules, saveRule, updateRule } from '../services/category-rules';
import { listCategories, listSubcategories, queryTransactions } from '../services/transactions';

export async function registerTransactionRoutes(app: FastifyInstance, { db: initialDb, runtime }: AppDeps) {
  const getDb = () => runtime?.getDb() ?? initialDb;

  app.get('/transactions', (req) => queryTransactions(getDb(), parse(TransactionQuery, req.query)));

  app.get('/transactions/categories', () => listCategories(getDb()));

  app.get('/transactions/subcategories', (req) => {
    const { category } = parse(z.object({ category: z.string().min(1) }), req.query);
    return listSubcategories(getDb(), category);
  });

  app.patch('/transactions/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const update = parse(TransactionUpdate, req.body);
    const recategorized = update.category !== undefined || update.subcategory !== undefined;
    const [row] = await getDb()
      .update(transactions)
      .set({
        ...update,
        // A new category drops the old subcategory unless one is given; a hand edit outranks any rule
        // and counts as verified, while resetting to Plaid's category leaves it for review again.
        ...(update.category !== undefined && { subcategory: update.subcategory ?? null }),
        ...(recategorized && { categoryRuleId: null, categoryVerified: update.category !== null }),
        // Accepting a rule's choice keeps the category but takes it out of the rule's hands.
        ...(update.categoryVerified && { categoryRuleId: null }),
      })
      .where(eq(transactions.id, id))
      .returning({ id: transactions.id });
    if (!row) throw new HttpError(404, 'Transaction not found');
    return { ok: true };
  });

  app.get('/category-rules', () => listRules(getDb()));

  app.post('/category-rules', (req) => saveRule(getDb(), parse(CategoryRuleCreate, req.body)));

  app.patch('/category-rules/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const result = await updateRule(getDb(), id, parse(CategoryRuleCreate, req.body));
    if (result === 'not-found') throw new HttpError(404, 'Rule not found');
    if (result === 'conflict') throw new HttpError(409, 'Another rule already uses that text');
    return result;
  });

  app.delete('/category-rules/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    if (!(await deleteRule(getDb(), id))) throw new HttpError(404, 'Rule not found');
    return { ok: true };
  });
}
