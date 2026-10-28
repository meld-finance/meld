import type { TransactionPage } from '@meld/shared';
import { TransactionQuery, UNCATEGORIZED } from '@meld/shared';
import type { z } from 'zod';
import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, transactions } from '../db/schema';

export const effectiveCategory = sql<string | null>`coalesce(${transactions.category}, ${transactions.plaidCategoryPrimary})`;
/**
 * `effectiveCategory` with uncategorized transactions grouped under UNCATEGORIZED, for totals.
 * The literal is inlined, not a bind parameter, so the expression can appear in GROUP BY.
 */
export const categoryKey = sql<string>`coalesce(${transactions.category}, ${transactions.plaidCategoryPrimary}, ${sql.raw(`'${UNCATEGORIZED}'`)})`;
/** The user's subcategory, else Plaid's detailed category as long as the category is still Plaid's. */
export const effectiveSubcategory = sql<string | null>`coalesce(${transactions.subcategory}, case when ${transactions.category} is null or ${transactions.category} = ${transactions.plaidCategoryPrimary} then ${transactions.plaidCategoryDetailed} end)`;
/** Your share of a transaction on a jointly held account; needs `accounts` joined. */
export const ownedAmount = sql`${transactions.amount} * coalesce(${accounts.ownershipPercent}, 100) / 100`;

const TRANSFERS = ['TRANSFER_IN', 'TRANSFER_OUT'];
/** Paying a card moves money between your own accounts; the card purchases are the spending. */
const CARD_PAYMENT_DETAILED = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';

/**
 * Transactions that count toward cash flow: everyday (cash + card) accounts,
 * excluding transfers and card payments. A user override wins over Plaid's
 * classification, so recategorizing a transfer brings it back in. Needs `accounts` joined.
 */
export const countsTowardCashflow = and(
  inArray(accounts.type, ['depository', 'credit']),
  eq(accounts.hidden, false),
  sql`${categoryKey} not in (${sql.join(TRANSFERS.map((t) => sql`${t}`), sql`, `)})`,
  sql`not (${transactions.category} is null and ${transactions.plaidCategoryDetailed} is not distinct from ${CARD_PAYMENT_DETAILED})`,
)!;

export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type TransactionFilters = Partial<
  Pick<z.output<typeof TransactionQuery>, 'accountId' | 'from' | 'to' | 'category' | 'subcategory' | 'cashflow' | 'verified' | 'search'>
>;

/** Filters shared by listing and aggregation; hidden accounts are always excluded. */
function transactionFilters(q: TransactionFilters) {
  return and(
    eq(accounts.hidden, false),
    q.accountId ? eq(transactions.accountId, q.accountId) : undefined,
    q.from ? gte(transactions.date, q.from) : undefined,
    q.to ? lte(transactions.date, q.to) : undefined,
    q.category ? eq(categoryKey, q.category) : undefined,
    q.subcategory ? eq(effectiveSubcategory, q.subcategory) : undefined,
    q.cashflow ? countsTowardCashflow : undefined,
    q.verified !== undefined ? eq(transactions.categoryVerified, q.verified) : undefined,
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
        subcategory: effectiveSubcategory,
        categoryRuleId: transactions.categoryRuleId,
        categoryVerified: transactions.categoryVerified,
        pending: transactions.pending,
        notes: transactions.notes,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(where)
      .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ total: count() }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.accountId)).where(where),
  ]);
  return { transactions: rows, total: totalRow?.total ?? 0 };
}

/**
 * Totals by merchant (Plaid sign: positive = money out), largest outflows first.
 * Transactions on shared accounts count at your ownership share.
 */
export async function totalsByMerchant(db: Db, q: TransactionFilters, limit = 25) {
  const merchant = sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`;
  const total = sql<number>`round(sum(${ownedAmount}), 2)`.mapWith(Number);
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

/** Distinct subcategories in use under `category`, for picking one. */
export async function listSubcategories(db: Db, category: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ subcategory: effectiveSubcategory })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(accounts.hidden, false), eq(categoryKey, category), sql`${effectiveSubcategory} is not null`))
    .orderBy(effectiveSubcategory);
  return rows.map((r) => r.subcategory!);
}
