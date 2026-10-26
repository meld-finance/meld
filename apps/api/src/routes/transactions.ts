import { TransactionQuery, TransactionUpdate, type TransactionPage } from '@meld/shared';
import { and, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accounts, transactions } from '../db/schema';
import { HttpError, IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';

const effectiveCategory = sql<string | null>`coalesce(${transactions.category}, ${transactions.plaidCategoryPrimary})`;

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function registerTransactionRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/transactions', async (req): Promise<TransactionPage> => {
    const q = parse(TransactionQuery, req.query);
    const filters: (SQL | undefined)[] = [
      eq(accounts.hidden, false),
      q.accountId ? eq(transactions.accountId, q.accountId) : undefined,
      q.from ? gte(transactions.date, q.from) : undefined,
      q.to ? lte(transactions.date, q.to) : undefined,
      q.category ? eq(effectiveCategory, q.category) : undefined,
      q.search
        ? or(
            ilike(transactions.name, `%${escapeLike(q.search)}%`),
            ilike(transactions.merchantName, `%${escapeLike(q.search)}%`),
          )
        : undefined,
    ];
    const where = and(...filters);

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          id: transactions.id,
          accountId: transactions.accountId,
          accountName: accounts.name,
          amount: transactions.amount,
          currency: transactions.currency,
          date: transactions.date,
          name: transactions.name,
          merchantName: transactions.merchantName,
          category: effectiveCategory,
          categoryOverridden: sql<boolean>`${transactions.category} is not null`,
          pending: transactions.pending,
          notes: transactions.notes,
        })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(where)
        .orderBy(desc(transactions.date), desc(transactions.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ total: count() })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(where),
    ]);
    return { transactions: rows, total: totalRow?.total ?? 0 };
  });

  app.get('/transactions/categories', async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ category: effectiveCategory })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(and(eq(accounts.hidden, false), sql`${effectiveCategory} is not null`))
      .orderBy(effectiveCategory);
    return rows.map((r) => r.category!);
  });

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
