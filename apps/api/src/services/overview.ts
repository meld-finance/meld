import {
  netCashValue,
  ownedBalance,
  ownedValue,
  type BalanceSnapshot,
  type BudgetStatus,
  type CashflowMonth,
  type CashflowPeriod,
  type CategoryChange,
  type CategoryDetail,
  type CategoryMonth,
  type CategorySpend,
  type NetWorthSummary,
} from '@meld/shared';
import { and, asc, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, balanceSnapshots, budgets, insurancePolicies, manualAssets, transactions } from '../db/schema';
import { computeNetWorth, localDate } from '../lib/networth';
import { categoryKey, countsTowardCashflow, effectiveSubcategory, ownedAmount } from './transactions';

const INCOME = 'INCOME';

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

/** Everything that counts toward net worth, with ids so snapshots can track each one. */
async function loadBalances(db: Db) {
  const [accountRows, manualRows, policyRows] = await Promise.all([
    db
      .select({
        id: accounts.id,
        type: accounts.type,
        currentBalance: accounts.currentBalance,
        ownershipPercent: accounts.ownershipPercent,
      })
      .from(accounts)
      .where(eq(accounts.hidden, false)),
    db
      .select({
        id: manualAssets.id,
        value: manualAssets.value,
        valueAsOf: manualAssets.valueAsOf,
        depreciationPercent: manualAssets.depreciationPercent,
        ownershipPercent: manualAssets.ownershipPercent,
      })
      .from(manualAssets),
    db
      .select({
        id: insurancePolicies.id,
        type: insurancePolicies.type,
        cashValue: insurancePolicies.cashValue,
        cashSurrenderValue: insurancePolicies.cashSurrenderValue,
        loanBalance: insurancePolicies.loanBalance,
      })
      .from(insurancePolicies),
  ]);
  const cashValues = policyRows.flatMap((p) => {
    const value = netCashValue(p);
    return value === null ? [] : [{ id: p.id, value }];
  });
  const balances: Record<string, number> = Object.fromEntries([
    ...accountRows.map((a) => [a.id, ownedBalance(a)]),
    ...manualRows.map((m) => [m.id, ownedValue(m)]),
    ...cashValues.map((c) => [c.id, c.value]),
  ]);
  return {
    summary: computeNetWorth(accountRows, manualRows, cashValues.map((c) => c.value)),
    balances,
  };
}

export async function getNetWorth(db: Db): Promise<NetWorthSummary> {
  return (await loadBalances(db)).summary;
}

/** Upserts today's net-worth snapshot; history accrues one point per day. */
export async function recordSnapshot(db: Db, today = localDate()) {
  const { summary, balances } = await loadBalances(db);
  const row = {
    date: today,
    totalAssets: summary.assets,
    totalLiabilities: summary.liabilities,
    netWorth: summary.netWorth,
    breakdown: summary.byType,
    balances,
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

/**
 * The latest snapshot on or before `date`, to compare today's balances against. Null when history
 * doesn't reach back that far, so callers show no change rather than one over a shorter span.
 */
export async function getSnapshotAsOf(db: Db, date: string): Promise<BalanceSnapshot | null> {
  const [row] = await db
    .select({
      date: balanceSnapshots.date,
      netWorth: balanceSnapshots.netWorth,
      breakdown: balanceSnapshots.breakdown,
      balances: balanceSnapshots.balances,
    })
    .from(balanceSnapshots)
    .where(lte(balanceSnapshots.date, date))
    .orderBy(desc(balanceSnapshots.date))
    .limit(1);
  if (!row) return null;
  return {
    date: row.date,
    netWorth: row.netWorth,
    byType: (row.breakdown as NetWorthSummary['byType'] | null) ?? [],
    // Snapshots from before per-item tracking have none.
    balances: row.balances ?? null,
  };
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
      income: sql<number>`coalesce(-sum(${ownedAmount}) filter (where ${categoryKey} = ${INCOME}), 0)::float8`,
      spending: sql<number>`coalesce(sum(${ownedAmount}) filter (where ${categoryKey} <> ${INCOME}), 0)::float8`,
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
  const amount = sql<number>`sum(${ownedAmount})::float8`;
  const rows = await db
    .select({ category: categoryKey, amount })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        countsTowardCashflow,
        sql`${categoryKey} <> ${INCOME}`,
        gte(transactions.date, from),
        lt(transactions.date, to),
      ),
    )
    .groupBy(categoryKey)
    .having(sql`sum(${ownedAmount}) > 0`)
    .orderBy(desc(amount));
  return rows.map((r) => ({ category: r.category, amount: round2(r.amount) }));
}

/** Spending by category for each of the `count` months ending with `endMonth`, oldest first. */
export async function getSpendingByMonth(db: Db, count: number, endMonth: string): Promise<CategoryMonth[]> {
  const range = recentMonths(count, `${endMonth}-01`);
  const from = monthRange(range[0]!)[0];
  const to = monthRange(range.at(-1)!)[1];
  const month = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const amount = sql<number>`sum(${ownedAmount})::float8`;
  const rows = await db
    .select({ month, category: categoryKey, amount })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        countsTowardCashflow,
        sql`${categoryKey} <> ${INCOME}`,
        gte(transactions.date, from),
        lt(transactions.date, to),
      ),
    )
    .groupBy(month, categoryKey)
    .having(sql`sum(${ownedAmount}) > 0`)
    .orderBy(desc(amount));

  return range.map((m) => ({
    month: m,
    categories: rows.filter((r) => r.month === m).map((r) => ({ category: r.category, amount: round2(r.amount) })),
  }));
}

/** The same calendar date `years` later (negative: earlier); Feb 29 falls back to Feb 28. */
export function shiftYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const year = y + years;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** Income, spending and per-category spending for [from, to] (inclusive) and the same dates a year earlier. */
export async function getCashflowPeriod(db: Db, from: string, to: string): Promise<CashflowPeriod> {
  const previousFrom = shiftYears(from, -1);
  const previousTo = shiftYears(to, -1);
  const inCurrent = and(gte(transactions.date, from), lte(transactions.date, to));
  const inPrevious = and(gte(transactions.date, previousFrom), lte(transactions.date, previousTo));
  const merchant = sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`;

  const rows = await db
    .select({
      category: categoryKey,
      merchant,
      // Plaid: positive = money out.
      amount: sql<number>`coalesce(sum(${ownedAmount}) filter (where ${inCurrent}), 0)::float8`,
      previous: sql<number>`coalesce(sum(${ownedAmount}) filter (where ${inPrevious}), 0)::float8`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(countsTowardCashflow, or(inCurrent, inPrevious)))
    .groupBy(categoryKey, merchant);

  let income = 0;
  let previousIncome = 0;
  let spending = 0;
  let previousSpending = 0;
  const byCategory = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.category === INCOME) {
      income -= r.amount;
      previousIncome -= r.previous;
      continue;
    }
    spending += r.amount;
    previousSpending += r.previous;
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  }

  const categories: CategoryChange[] = [];
  for (const [category, merchants] of byCategory) {
    const amount = round2(merchants.reduce((s, r) => s + r.amount, 0));
    const previous = round2(merchants.reduce((s, r) => s + r.previous, 0));
    // Net refunds can leave a category at or below zero; it isn't spending then.
    if (amount <= 0 && previous <= 0) continue;
    const delta = (r: (typeof rows)[number]) => Math.abs(r.amount - r.previous);
    const top = merchants.reduce((best, r) => (delta(r) > delta(best) ? r : best));
    categories.push({
      category,
      amount: Math.max(amount, 0),
      previous: Math.max(previous, 0),
      driver: round2(delta(top)) > 0 ? { merchant: top.merchant, amount: round2(top.amount), previous: round2(top.previous) } : null,
    });
  }
  categories.sort((a, b) => b.amount - a.amount || b.previous - a.previous);

  return {
    from,
    to,
    previousFrom,
    previousTo,
    income: round2(income),
    spending: round2(spending),
    previousIncome: round2(previousIncome),
    previousSpending: round2(previousSpending),
    categories,
  };
}

/** One category's spending by subcategory and merchant over [from, to] and the same dates a year earlier. */
export async function getCategoryDetail(db: Db, category: string, from: string, to: string): Promise<CategoryDetail> {
  const previousFrom = shiftYears(from, -1);
  const previousTo = shiftYears(to, -1);
  const inCurrent = and(gte(transactions.date, from), lte(transactions.date, to));
  const inPrevious = and(gte(transactions.date, previousFrom), lte(transactions.date, previousTo));
  const merchant = sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`;

  const rows = await db
    .select({
      subcategory: effectiveSubcategory,
      merchant,
      // Plaid: positive = money out.
      amount: sql<number>`coalesce(sum(${ownedAmount}) filter (where ${inCurrent}), 0)::float8`,
      previous: sql<number>`coalesce(sum(${ownedAmount}) filter (where ${inPrevious}), 0)::float8`,
      count: sql<number>`(count(*) filter (where ${inCurrent}))::int`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(countsTowardCashflow, eq(categoryKey, category), or(inCurrent, inPrevious)))
    .groupBy(effectiveSubcategory, merchant);

  const totals = <K extends 'subcategory' | 'merchant'>(key: K) => {
    const byKey = new Map<(typeof rows)[number][K], { amount: number; previous: number; count: number }>();
    for (const r of rows) {
      const t = byKey.get(r[key]) ?? { amount: 0, previous: 0, count: 0 };
      byKey.set(r[key], { amount: t.amount + r.amount, previous: t.previous + r.previous, count: t.count + r.count });
    }
    return [...byKey]
      .map(([k, t]) => ({ key: k, amount: round2(t.amount), previous: round2(t.previous), count: t.count }))
      .filter((t) => t.amount > 0 || t.previous > 0)
      .sort((a, b) => b.amount - a.amount || b.previous - a.previous);
  };

  return {
    category,
    from,
    to,
    previousFrom,
    previousTo,
    amount: round2(Math.max(rows.reduce((s, r) => s + r.amount, 0), 0)),
    previous: round2(Math.max(rows.reduce((s, r) => s + r.previous, 0), 0)),
    subcategories: totals('subcategory').map((t) => ({ subcategory: t.key, amount: t.amount, previous: t.previous })),
    merchants: totals('merchant').map((t) => ({ merchant: t.key, count: t.count, amount: t.amount, previous: t.previous })),
  };
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
