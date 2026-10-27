import { netCashValue, type BudgetStatus, type CashflowMonth, type CategorySpend, type NetWorthSummary } from '@meld/shared';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, balanceSnapshots, budgets, insurancePolicies, manualAssets, transactions } from '../db/schema';
import { computeNetWorth, localDate } from '../lib/networth';

const INCOME = 'INCOME';
const TRANSFERS = ['TRANSFER_IN', 'TRANSFER_OUT'];
/** Paying a card moves money between your own accounts; the card purchases are the spending. */
const CARD_PAYMENT_DETAILED = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';

const effectiveCategory = sql<string>`coalesce(${transactions.category}, ${transactions.plaidCategoryPrimary}, 'UNCATEGORIZED')`;

/**
 * Transactions that count toward cash flow: everyday (cash + card) accounts,
 * excluding transfers and card payments. A user override wins over Plaid's
 * classification, so recategorizing a transfer brings it back in.
 */
const countsTowardCashflow = and(
  inArray(accounts.type, ['depository', 'credit']),
  eq(accounts.hidden, false),
  sql`${effectiveCategory} not in (${sql.join(TRANSFERS.map((t) => sql`${t}`), sql`, `)})`,
  sql`not (${transactions.category} is null and ${transactions.plaidCategoryDetailed} is not distinct from ${CARD_PAYMENT_DETAILED})`,
);

/** [first day of month, first day of next month) as YYYY-MM-DD. */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [`${month}-01`, `${next}-01`];
}

/** The `count` months ending with the month containing `today`, oldest first. */
export function recentMonths(count: number, today: string): string[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(y, m - 1 - (count - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

export async function getNetWorth(db: Db): Promise<NetWorthSummary> {
  const [accountRows, manualRows, policyRows] = await Promise.all([
    db
      .select({ type: accounts.type, currentBalance: accounts.currentBalance })
      .from(accounts)
      .where(eq(accounts.hidden, false)),
    db.select({ value: manualAssets.value, ownershipPercent: manualAssets.ownershipPercent }).from(manualAssets),
    db
      .select({
        type: insurancePolicies.type,
        cashValue: insurancePolicies.cashValue,
        cashSurrenderValue: insurancePolicies.cashSurrenderValue,
        loanBalance: insurancePolicies.loanBalance,
      })
      .from(insurancePolicies),
  ]);
  const cashValues = policyRows.map(netCashValue).filter((v): v is number => v !== null);
  return computeNetWorth(accountRows, manualRows, cashValues);
}

/** Upserts today's net-worth snapshot; history accrues one point per day. */
export async function recordSnapshot(db: Db, today = localDate()) {
  const summary = await getNetWorth(db);
  const row = {
    date: today,
    totalAssets: summary.assets,
    totalLiabilities: summary.liabilities,
    netWorth: summary.netWorth,
    breakdown: summary.byType,
  };
  await db
    .insert(balanceSnapshots)
    .values(row)
    .onConflictDoUpdate({ target: balanceSnapshots.date, set: { ...row, updatedAt: new Date() } });
}

export async function getNetWorthHistory(db: Db, sinceDate: string) {
  return db
    .select({
      date: balanceSnapshots.date,
      assets: balanceSnapshots.totalAssets,
      liabilities: balanceSnapshots.totalLiabilities,
      netWorth: balanceSnapshots.netWorth,
    })
    .from(balanceSnapshots)
    .where(gte(balanceSnapshots.date, sinceDate))
    .orderBy(asc(balanceSnapshots.date));
}

export async function getCashflow(db: Db, months: number, today = localDate()): Promise<CashflowMonth[]> {
  const range = recentMonths(months, today);
  const from = monthRange(range[0]!)[0];
  const to = monthRange(range.at(-1)!)[1];
  const month = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;

  const rows = await db
    .select({
      month,
      // Plaid: positive = money out. Income is reported as a positive number.
      income: sql<number>`coalesce(-sum(${transactions.amount}) filter (where ${effectiveCategory} = ${INCOME}), 0)::float8`,
      spending: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${effectiveCategory} <> ${INCOME}), 0)::float8`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(countsTowardCashflow, gte(transactions.date, from), lt(transactions.date, to)))
    .groupBy(month);

  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return range.map((m) => ({
    month: m,
    income: round2(byMonth.get(m)?.income ?? 0),
    spending: round2(byMonth.get(m)?.spending ?? 0),
  }));
}

export async function getSpendingByCategory(db: Db, month: string): Promise<CategorySpend[]> {
  const [from, to] = monthRange(month);
  const amount = sql<number>`sum(${transactions.amount})::float8`;
  const rows = await db
    .select({ category: effectiveCategory, amount })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        countsTowardCashflow,
        sql`${effectiveCategory} <> ${INCOME}`,
        gte(transactions.date, from),
        lt(transactions.date, to),
      ),
    )
    .groupBy(effectiveCategory)
    .having(sql`sum(${transactions.amount}) > 0`)
    .orderBy(desc(amount));
  return rows.map((r) => ({ category: r.category, amount: round2(r.amount) }));
}

export async function getBudgetStatus(db: Db, month: string): Promise<BudgetStatus[]> {
  const [targets, spending] = await Promise.all([
    db.select().from(budgets).orderBy(asc(budgets.category)),
    getSpendingByCategory(db, month),
  ]);
  const spent = new Map(spending.map((s) => [s.category, s.amount]));
  return targets.map((b) => ({
    category: b.category,
    monthlyTarget: b.monthlyTarget,
    spent: spent.get(b.category) ?? 0,
  }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
