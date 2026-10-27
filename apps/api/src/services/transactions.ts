import type { TransactionPage } from '@meld/shared';
import { TransactionQuery } from '@meld/shared';
import type { z } from 'zod';
import { and, count, desc, eq, gte, ilike, lte, or, sql, sum, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, transactions } from '../db/schema';

export const effectiveCategory = sql<string | null>`coalesce(${transactions.category}, ${transactions.plaidCategoryPrimary})`;

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type TransactionFilters = Partial<Pick<TransactionQuery, 'accountId' | 'from' | 'to' | 'category' | 'search'>>;

/** Filters shared by listing and aggregation; hidden accounts are always excluded. */
function transactionFilters(q: TransactionFilters) {
  return and(
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
  ) as SQL;
}

/** Expects parsed input (limit and offset defaulted). */
export async function queryTransactions(db: Db, q: z.output<typeof TransactionQuery>): Promise<TransactionPage> {
  const where = transactionFilters(q);
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
    db.select({ total: count() }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.accountId)).where(where),
  ]);
  return { transactions: rows, total: totalRow?.total ?? 0 };
}

/** Totals by merchant (Plaid sign: positive = money out), largest outflows first. */
export async function totalsByMerchant(db: Db, q: TransactionFilters, limit = 25) {
  const merchant = sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`;
  const total = sum(transactions.amount).mapWith(Number);
  return db
    .select({ merchant, total, count: count() })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(transactionFilters(q))
    .groupBy(merchant)
    .orderBy(desc(total))
    .limit(limit);
}

export async function listCategories(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: effectiveCategory })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(accounts.hidden, false), sql`${effectiveCategory} is not null`))
    .orderBy(effectiveCategory);
  return rows.map((r) => r.category!);
}
