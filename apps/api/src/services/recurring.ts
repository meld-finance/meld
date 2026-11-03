import type {
  Account,
  AlertSettings,
  AutopayAmount,
  AutopayLinkInput,
  AutopayObligation,
  AutopayStatus,
  AutopaySuggestion,
  RecurringKind,
  RecurringOverride,
  RecurringSeries,
  RecurringSummary,
  UpcomingItem,
} from '@meld/shared';
import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, autopayLinks, liabilities, recurringOverrides, transactions } from '../db/schema';
import { HttpError } from '../lib/http';
import { localDate } from '../lib/networth';
import {
  addDays,
  autopayHealth,
  daysBetween,
  detectRecurring,
  nextPayment,
  occurrencesThrough,
  type CardStatement,
  type NextPayment,
  type RecurringTxn,
  type SeriesOverride,
} from '../lib/recurring';
import { getAlertSettings } from './alert-settings';
import { listAccounts } from './accounts';
import { categoryKey, countsTowardCashflow } from './transactions';

/** Two years: enough to see a yearly charge twice. */
const HISTORY_DAYS = 760;
const UPCOMING_DAYS = 30;
/** A charge this many days late is still shown as coming. */
const LATE_DAYS = 7;
/** How far back to look for card and loan payments when suggesting autopay links. */
const SUGGESTION_DAYS = 120;

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function loadRecurringTxns(db: Db, today: string): Promise<RecurringTxn[]> {
  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountName: accounts.name,
      date: transactions.date,
      amount: transactions.amount,
      name: transactions.name,
      merchantName: transactions.merchantName,
      category: categoryKey,
      detailed: transactions.plaidCategoryDetailed,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(countsTowardCashflow, eq(transactions.pending, false), gte(transactions.date, addDays(today, -HISTORY_DAYS))));
  return rows;
}

async function loadOverrides(db: Db): Promise<Map<string, SeriesOverride>> {
  const rows = await db.select().from(recurringOverrides);
  return new Map(rows.map((r) => [r.key, { ignored: r.ignored, kind: r.kind as RecurringKind | null, name: r.name }]));
}

export async function getRecurringSeries(db: Db, today = localDate()): Promise<RecurringSeries[]> {
  const [txns, overrides] = await Promise.all([loadRecurringTxns(db, today), loadOverrides(db)]);
  return detectRecurring(txns, today, overrides);
}

export async function saveRecurringOverride(db: Db, key: string, o: RecurringOverride) {
  const existing = await db.query.recurringOverrides.findFirst({ where: eq(recurringOverrides.key, key) });
  const next = {
    ignored: o.ignored ?? existing?.ignored ?? false,
    kind: o.kind === undefined ? (existing?.kind ?? null) : o.kind,
    name: o.name === undefined ? (existing?.name ?? null) : o.name?.trim() || null,
  };
  if (!next.ignored && !next.kind && !next.name) {
    await db.delete(recurringOverrides).where(eq(recurringOverrides.key, key));
  } else {
    await db.insert(recurringOverrides).values({ key, ...next }).onConflictDoUpdate({ target: recurringOverrides.key, set: next });
  }
}

// --- Autopay ------------------------------------------------------------------

const PAYEE_TYPES = new Set(['credit', 'loan', 'mortgage']);

async function checkLinkAccounts(db: Db, input: AutopayLinkInput) {
  const rows = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(inArray(accounts.id, [input.payeeAccountId, input.fundingAccountId]));
  const byId = new Map(rows.map((r) => [r.id, r.type]));
  if (!PAYEE_TYPES.has(byId.get(input.payeeAccountId) ?? '')) throw new HttpError(400, 'Autopay pays a credit card or loan');
  if (byId.get(input.fundingAccountId) !== 'depository') throw new HttpError(400, 'Autopay comes out of a bank account');
}

export async function createAutopayLink(db: Db, input: AutopayLinkInput) {
  await checkLinkAccounts(db, input);
  const values = { ...input, fixedAmount: input.amountRule === 'fixed' ? input.fixedAmount : null };
  const [row] = await db
    .insert(autopayLinks)
    .values(values)
    .onConflictDoUpdate({ target: autopayLinks.payeeAccountId, set: values })
    .returning({ id: autopayLinks.id });
  return row!;
}

export async function updateAutopayLink(db: Db, id: string, input: AutopayLinkInput) {
  await checkLinkAccounts(db, input);
  const [row] = await db
    .update(autopayLinks)
    .set({ ...input, fixedAmount: input.amountRule === 'fixed' ? input.fixedAmount : null })
    .where(eq(autopayLinks.id, id))
    .returning({ id: autopayLinks.id });
  if (!row) throw new HttpError(404, 'Autopay not found');
  return row;
}

export async function deleteAutopayLink(db: Db, id: string) {
  await db.delete(autopayLinks).where(eq(autopayLinks.id, id));
}

/** A card or loan being paid, as opposed to a refund or a purchase reversal. */
const paymentReceived = or(
  sql`${transactions.plaidCategoryDetailed} like 'LOAN_PAYMENTS%'`,
  inArray(categoryKey, ['TRANSFER_IN', 'LOAN_PAYMENTS']),
  sql`${transactions.name} ~* '(payment|autopay|thank you)'`,
);

/** Payments each card or loan received after its statement date. */
async function paymentsSince(db: Db, since: Map<string, string>): Promise<Map<string, number>> {
  if (!since.size) return new Map();
  const earliest = [...since.values()].sort()[0]!;
  const rows = await db
    .select({ accountId: transactions.accountId, date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(
      and(inArray(transactions.accountId, [...since.keys()]), lt(transactions.amount, 0), gte(transactions.date, earliest), paymentReceived),
    );
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.date > since.get(r.accountId)!) out.set(r.accountId, (out.get(r.accountId) ?? 0) - r.amount);
  }
  return out;
}

type Link = typeof autopayLinks.$inferSelect;

/** Recurring charges and paychecks on an account, from today through `to`. */
function seriesOccurrences(series: RecurringSeries[], accountId: string, today: string, to: string) {
  return series
    .filter((s) => s.status === 'active' && s.accountId === accountId)
    .flatMap((s) =>
      occurrencesThrough(s.nextDate, s.cadence, to)
        .filter((d) => d >= today)
        .map((date) => ({ series: s, date })),
    );
}

/** A recurring loan payment out of the bank account is the autopay itself, not another bill. */
function sameAsAutopay(date: string, amount: number, payments: { dueDate: string | null; amount: number | null }[]) {
  return payments.some(
    (p) =>
      p.dueDate && p.amount && Math.abs(daysBetween(date, p.dueDate)) <= 5 && Math.abs(amount - p.amount) <= Math.max(1, p.amount * 0.05),
  );
}

export async function getAutopayStatuses(
  db: Db,
  series: RecurringSeries[],
  settings: AlertSettings,
  today = localDate(),
): Promise<{ statuses: AutopayStatus[]; payments: Map<string, NextPayment> }> {
  const links = await db.select().from(autopayLinks);
  if (!links.length) return { statuses: [], payments: new Map() };
  const accountIds = [...new Set(links.flatMap((l) => [l.payeeAccountId, l.fundingAccountId]))];
  const [accountRows, liabilityRows] = await Promise.all([
    listAccounts(db, inArray(accounts.id, accountIds)),
    db.select().from(liabilities).where(inArray(liabilities.accountId, accountIds)),
  ]);
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const liabilityById = new Map(liabilityRows.map((l) => [l.accountId, l]));
  const statementDates = new Map(
    links.flatMap((l) => {
      const date = (liabilityById.get(l.payeeAccountId)?.details as CardStatement | null)?.last_statement_issue_date;
      return date ? [[l.payeeAccountId, date] as const] : [];
    }),
  );
  const paid = await paymentsSince(db, statementDates);

  const payments = new Map<string, NextPayment>();
  for (const link of links) {
    const payee = accountById.get(link.payeeAccountId);
    const liability = liabilityById.get(link.payeeAccountId);
    payments.set(
      link.id,
      nextPayment(
        {
          type: payee?.type ?? 'credit',
          currentBalance: payee?.currentBalance ?? null,
          liability: liability
            ? {
                kind: liability.kind,
                minimumPayment: liability.minimumPayment,
                nextPaymentDueDate: liability.nextPaymentDueDate,
                details: liability.details as CardStatement | null,
              }
            : null,
          paymentsSinceStatement: paid.get(link.payeeAccountId) ?? 0,
        },
        link.amountRule as AutopayAmount,
        link.fixedAmount,
        today,
      ),
    );
  }

  const statuses = links.map((link) => {
    const payment = payments.get(link.id)!;
    const payee = accountById.get(link.payeeAccountId);
    const funding = accountById.get(link.fundingAccountId);
    const before = obligationsBefore(link, links, payments, series, accountById, settings, today);
    const payeeName = payee?.name ?? 'This account';
    const fundingName = funding?.name ?? 'The bank account';
    const fundingBalance = funding ? (funding.availableBalance ?? funding.currentBalance) : null;
    return {
      id: link.id,
      payeeAccountId: link.payeeAccountId,
      payeeName,
      payeeType: payee?.type ?? 'credit',
      fundingAccountId: link.fundingAccountId,
      fundingName,
      amountRule: link.amountRule as AutopayAmount,
      fixedAmount: link.fixedAmount,
      dueDate: payment.dueDate,
      amount: payment.amount,
      amountSource: payment.amountSource,
      paidSinceStatement: payment.paidSinceStatement,
      statementBalance: payment.statementBalance,
      statementDate: payment.statementDate,
      fundingBalance,
      before,
      ...autopayHealth({ payment, payeeName, fundingName, fundingBalance, before, cushion: settings.autopayCushion }),
    } satisfies AutopayStatus;
  });
  statuses.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  return { statuses, payments };
}

/** Everything else moving through the funding account between now and this payment's due date. */
function obligationsBefore(
  link: Link,
  links: Link[],
  payments: Map<string, NextPayment>,
  series: RecurringSeries[],
  accountById: Map<string, Account>,
  settings: AlertSettings,
  today: string,
): AutopayObligation[] {
  const payment = payments.get(link.id)!;
  if (!payment.dueDate || payment.paid || payment.dueDate < today) return [];
  const due = payment.dueDate;
  const sameFunding = links.filter((l) => l.fundingAccountId === link.fundingAccountId);
  const out: AutopayObligation[] = [];

  // Other autopays from the same account due first (or the same day: both come out).
  for (const other of sameFunding) {
    if (other.id === link.id) continue;
    const p = payments.get(other.id)!;
    if (p.paid || !p.dueDate || !p.amount || p.dueDate > due || p.dueDate < today) continue;
    // Same-day payments: count each against the other only one way, so the earlier-created one goes first.
    if (p.dueDate === due && other.createdAt > link.createdAt) continue;
    out.push({ name: accountById.get(other.payeeAccountId)?.name ?? 'Another autopay', date: p.dueDate, amount: p.amount, source: 'autopay' });
  }

  const autopayPayments = sameFunding.map((l) => payments.get(l.id)!);
  for (const { series: s, date } of seriesOccurrences(series, link.fundingAccountId, today, due)) {
    if (s.kind === 'income') {
      // A paycheck counts only if it lands at least a day before the payment comes out.
      if (settings.autopayCountIncome && date < due) out.push({ name: s.name, date, amount: s.amount, source: 'income' });
    } else if (date <= due && !sameAsAutopay(date, s.amount, autopayPayments)) {
      out.push({ name: s.name, date, amount: s.amount, source: 'recurring' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Cards and loans that a bank account seems to pay each month: a payment out of the bank
 * account and the same amount arriving on the card within a few days.
 */
export async function suggestAutopayLinks(db: Db, linkedPayees: Set<string>, today = localDate()): Promise<AutopaySuggestion[]> {
  const since = addDays(today, -SUGGESTION_DAYS);
  const rows = await db
    .select({
      accountId: transactions.accountId,
      accountName: accounts.name,
      type: accounts.type,
      date: transactions.date,
      amount: transactions.amount,
      detailed: transactions.plaidCategoryDetailed,
      name: transactions.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(accounts.hidden, false),
        gte(transactions.date, since),
        or(
          and(inArray(accounts.type, ['credit', 'loan', 'mortgage']), lt(transactions.amount, 0), paymentReceived),
          and(
            eq(accounts.type, 'depository'),
            sql`${transactions.amount} > 0`,
            or(
              sql`${transactions.plaidCategoryDetailed} like 'LOAN_PAYMENTS%'`,
              inArray(categoryKey, ['TRANSFER_OUT', 'LOAN_PAYMENTS']),
              sql`${transactions.name} ~* '(payment|autopay|epay)'`,
            ),
          ),
        ),
      ),
    );
  const received = rows.filter((r) => r.type !== 'depository' && !linkedPayees.has(r.accountId));
  const sent = rows.filter((r) => r.type === 'depository');

  const pairs = new Map<string, AutopaySuggestion & { amounts: number[] }>();
  for (const r of received) {
    const match = sent.find((s) => Math.abs(s.amount + r.amount) < 0.01 && Math.abs(daysBetween(s.date, r.date)) <= 5);
    if (!match) continue;
    const key = `${r.accountId}|${match.accountId}`;
    const entry = pairs.get(key) ?? {
      payeeAccountId: r.accountId,
      payeeName: r.accountName,
      fundingAccountId: match.accountId,
      fundingName: match.accountName,
      payments: 0,
      lastDate: r.date,
      lastAmount: -r.amount,
      likelyRule: 'statement_balance' as AutopayAmount,
      amounts: [],
    };
    entry.payments += 1;
    entry.amounts.push(-r.amount);
    if (r.date >= entry.lastDate) Object.assign(entry, { lastDate: r.date, lastAmount: -r.amount });
    pairs.set(key, entry);
  }

  // One suggestion per card or loan: the bank account that paid it most.
  const best = new Map<string, AutopaySuggestion & { amounts: number[] }>();
  for (const p of pairs.values()) {
    const current = best.get(p.payeeAccountId);
    if (!current || p.payments > current.payments) best.set(p.payeeAccountId, p);
  }
  return [...best.values()].map(({ amounts, ...s }) => ({
    ...s,
    // The same amount every time is a fixed payment (a loan's scheduled one, or a set amount).
    likelyRule: amounts.length >= 2 && amounts.every((a) => Math.abs(a - amounts[0]!) < 0.01) ? 'fixed' : s.likelyRule,
  }));
}

// --- Summary -----------------------------------------------------------------

export async function getRecurringSummary(db: Db, today = localDate()): Promise<RecurringSummary> {
  const [series, settings, linkRows] = await Promise.all([
    getRecurringSeries(db, today),
    getAlertSettings(db),
    db.select({ payeeAccountId: autopayLinks.payeeAccountId }).from(autopayLinks),
  ]);
  const [{ statuses, payments }, suggestions] = await Promise.all([
    getAutopayStatuses(db, series, settings, today),
    suggestAutopayLinks(db, new Set(linkRows.map((l) => l.payeeAccountId)), today),
  ]);

  const horizon = addDays(today, UPCOMING_DAYS);
  const autopayByFunding = new Map<string, NextPayment[]>();
  for (const s of statuses) {
    const list = autopayByFunding.get(s.fundingAccountId) ?? [];
    list.push(payments.get(s.id)!);
    autopayByFunding.set(s.fundingAccountId, list);
  }

  const upcoming: UpcomingItem[] = [];
  for (const s of series) {
    if (s.status !== 'active') continue;
    for (const date of occurrencesThrough(s.nextDate, s.cadence, horizon)) {
      if (date < addDays(today, -LATE_DAYS)) continue;
      if (s.kind !== 'income' && sameAsAutopay(date, s.amount, autopayByFunding.get(s.accountId) ?? [])) continue;
      upcoming.push({
        date,
        name: s.name,
        amount: s.kind === 'income' ? -s.amount : s.amount,
        approximate: s.amountVaries,
        accountName: s.accountName,
        source: 'recurring',
        kind: s.kind,
        ref: s.key,
      });
    }
  }
  for (const a of statuses) {
    if (a.health === 'paid' || !a.dueDate || a.amount === null || a.dueDate > horizon) continue;
    upcoming.push({
      date: a.dueDate,
      name: `${a.payeeName} autopay`,
      amount: a.amount,
      approximate: a.amountSource === 'estimate' || a.amountSource === 'balance',
      accountName: a.fundingName,
      source: 'autopay',
      kind: 'autopay',
      ref: a.id,
    });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  const active = series.filter((s) => s.status === 'active');
  const sum = (kind: RecurringKind) => round2(active.filter((s) => s.kind === kind).reduce((t, s) => t + s.monthlyAmount, 0));
  return {
    series,
    autopay: statuses,
    suggestions,
    upcoming,
    totals: {
      subscriptionsMonthly: sum('subscription'),
      billsMonthly: sum('bill'),
      incomeMonthly: sum('income'),
      dueNext30: round2(upcoming.filter((u) => u.amount > 0 && u.date >= today).reduce((t, u) => t + u.amount, 0)),
    },
  };
}
