import {
  BOND_FUND_SHARE,
  ownedBalance,
  taxTreatment,
  type Holding,
  type IncomeTotals,
  type InvestmentAccount,
  type InvestmentIncome,
  type InvestmentsSummary,
  type NetWorthSummary,
  type ProfileResult,
} from '@meld/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { AIProvider } from '../ai/provider';
import type { Db } from '../db/client';
import { accounts, balanceSnapshots, holdings, investmentTransactions, securities } from '../db/schema';
import { localDate } from '../lib/networth';
import { listAccounts, listHoldings, unvestedAmountsByAccount, unvestedHoldingAmount } from './accounts';
import { recentMonths, shiftYears } from './overview';

/** Fund make-up drifts slowly; look again after this long. */
const PROFILE_MAX_AGE_DAYS = 90;
/** Securities per AI call. */
const PROFILE_BATCH = 20;
/** AI calls in flight at once. */
const PROFILE_CONCURRENCY = 3;
/** Without a snapshot this old, there's no meaningful change to show. */
const MIN_CHANGE_DAYS = 30;

const round2 = (n: number) => Math.round(n * 100) / 100;

function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.toISOString().slice(0, 7)}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Visible, non-cash securities that need a (fresh) look inside. */
function needsProfile() {
  const stale = sql`now() - make_interval(days => ${PROFILE_MAX_AGE_DAYS})`;
  // Bond funds profiled before yield and duration were asked for.
  const missingBondStats = sql`(${securities.profile}->'assetClasses'->>'bonds')::float8 >= ${BOND_FUND_SHARE} and ${securities.profile}->'bondStats' is null`;
  return and(
    eq(accounts.hidden, false),
    or(isNull(securities.type), ne(securities.type, 'cash')),
    or(isNull(securities.profiledAt), lt(securities.profiledAt, stale), missingBondStats),
  );
}

async function unprofiledSecurities(db: Db) {
  return db
    .selectDistinct({
      id: securities.id,
      ticker: securities.tickerSymbol,
      name: securities.name,
      type: securities.type,
      subtype: securities.subtype,
      sector: securities.sector,
      industry: securities.industry,
    })
    .from(securities)
    .innerJoin(holdings, eq(holdings.securityId, securities.id))
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(needsProfile());
}

/** Investment balances now vs. the snapshot nearest six months ago (or the oldest, if it's at least a month old). */
async function investmentChange(db: Db, current: number, today: string): Promise<InvestmentsSummary['change']> {
  const target = shiftMonths(today, -6);
  const columns = { date: balanceSnapshots.date, breakdown: balanceSnapshots.breakdown };
  const [before] = await db
    .select(columns)
    .from(balanceSnapshots)
    .where(lte(balanceSnapshots.date, target))
    .orderBy(desc(balanceSnapshots.date))
    .limit(1);
  const snapshot =
    before ??
    (
      await db
        .select(columns)
        .from(balanceSnapshots)
        .where(lte(balanceSnapshots.date, shiftDays(today, -MIN_CHANGE_DAYS)))
        .orderBy(asc(balanceSnapshots.date))
        .limit(1)
    )[0];
  if (!snapshot) return null;
  const byType = (snapshot.breakdown ?? []) as NetWorthSummary['byType'];
  const previous = byType.find((b) => b.type === 'investment')?.total;
  if (previous === undefined) return null;
  return { since: snapshot.date, previous, current: round2(current) };
}

/** Holdings count only your share of a joint account. */
function ownedHolding(h: Holding, share: number): Holding {
  if (share === 1) return h;
  const scale = (n: number | null) => (n === null ? null : round2(n * share));
  return {
    ...h,
    quantity: h.quantity * share,
    value: scale(h.value),
    costBasis: scale(h.costBasis),
    vestedQuantity: h.vestedQuantity === null ? null : h.vestedQuantity * share,
    vestedValue: scale(h.vestedValue),
  };
}

export async function getInvestmentsSummary(db: Db, ai: AIProvider | null, today = localDate()): Promise<InvestmentsSummary> {
  const [accountList, holdingList, unprofiled, unvestedByAccount] = await Promise.all([
    listAccounts(db, and(eq(accounts.hidden, false), eq(accounts.type, 'investment'))),
    listHoldings(db, eq(accounts.hidden, false)),
    unprofiledSecurities(db),
    unvestedAmountsByAccount(db),
  ]);
  const accountById = new Map(accountList.map((a) => [a.id, a]));
  const owned = holdingList.map((h) => {
    const scaled = ownedHolding(h, (accountById.get(h.accountId)?.ownershipPercent ?? 100) / 100);
    if (unvestedHoldingAmount(scaled) > 0) {
      return { ...scaled, quantity: scaled.vestedQuantity!, value: scaled.vestedValue! };
    }
    return scaled;
  });

  const valueByAccount = new Map<string, number>();
  for (const h of owned) valueByAccount.set(h.accountId, (valueByAccount.get(h.accountId) ?? 0) + (h.value ?? 0));
  const investmentAccounts: InvestmentAccount[] = [...valueByAccount]
    .map(([id, value]) => {
      // Holdings in a non-investment account (rare) still list, under their own account name.
      const a = accountById.get(id);
      const subtype = a ? a.subtype : owned.find((h) => h.accountId === id)!.accountSubtype;
      return {
        id,
        name: a?.name ?? owned.find((h) => h.accountId === id)!.accountName,
        institutionName: a?.institutionName ?? null,
        subtype,
        taxTreatment: taxTreatment(subtype),
        value: round2(value),
      };
    })
    .sort((a, b) => b.value - a.value);

  const currentBalance = accountList.reduce((sum, a) => {
    const excess = unvestedByAccount.get(a.id) ?? 0;
    const adjusted = a.currentBalance === null ? null : Math.max(0, a.currentBalance - excess);
    return sum + ownedBalance({ ...a, currentBalance: adjusted });
  }, 0);
  return {
    totalValue: round2(owned.reduce((sum, h) => sum + (h.value ?? 0), 0)),
    holdings: owned,
    accounts: investmentAccounts,
    change: await investmentChange(db, currentBalance, today),
    unprofiled: unprofiled.length,
    canProfile: ai !== null,
  };
}

// One lookup at a time; a second caller shares the run in flight.
let profiling: Promise<ProfileResult> | null = null;

/** Asks the AI what's inside each held security that hasn't been looked at recently. */
export function profileSecurities(db: Db, ai: AIProvider): Promise<ProfileResult> {
  profiling ??= runProfiling(db, ai).finally(() => {
    profiling = null;
  });
  return profiling;
}

async function runProfiling(db: Db, ai: AIProvider): Promise<ProfileResult> {
  const pending = await unprofiledSecurities(db);
  const batches = Array.from({ length: Math.ceil(pending.length / PROFILE_BATCH) }, (_, i) =>
    pending.slice(i * PROFILE_BATCH, (i + 1) * PROFILE_BATCH),
  );
  let profiled = 0;
  let unrecognized = 0;
  const work = async (batch: typeof pending) => {
    const profiles = await ai.profileSecurities(batch);
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const [n, s] of batch.entries()) {
        const profile = profiles[n] ?? null;
        if (profile) profiled++;
        else unrecognized++;
        // A security the AI didn't recognize is marked too, so it isn't asked about again until it's stale.
        await tx.update(securities).set({ profile, profiledAt: now }).where(eq(securities.id, s.id));
      }
    });
  };
  for (let i = 0; i < batches.length; i += PROFILE_CONCURRENCY) {
    await Promise.all(batches.slice(i, i + PROFILE_CONCURRENCY).map(work));
  }
  return { profiled, unrecognized };
}

// --- Income -----------------------------------------------------------------------

/** Plaid investment transaction subtypes that are income, and those that put it back to work. */
const DIVIDEND_SUBTYPES = ['dividend', 'qualified dividend', 'non-qualified dividend', 'long-term capital gain', 'short-term capital gain'];
const INTEREST_SUBTYPES = ['interest'];
const REINVEST_SUBTYPES = [
  'dividend reinvestment',
  'interest reinvestment',
  'long-term capital gain reinvestment',
  'short-term capital gain reinvestment',
];

/** Less history than this is too little to scale up to a year. */
const MIN_ANNUALIZE_DAYS = 28;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

const zero = (): IncomeTotals => ({ dividends: 0, interest: 0, reinvested: 0 });

function roundTotals<T extends IncomeTotals>(t: T): T {
  return { ...t, dividends: round2(t.dividends), interest: round2(t.interest), reinvested: round2(t.reinvested) };
}

export async function getInvestmentIncome(db: Db, today = localDate()): Promise<InvestmentIncome> {
  const months = recentMonths(24, today);
  const from = `${months[0]}-01`;
  const share = sql<number>`coalesce(${accounts.ownershipPercent}, 100) / 100`;
  const [rows, historyStarts] = await Promise.all([
    db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        securityId: investmentTransactions.securityId,
        date: investmentTransactions.date,
        subtype: investmentTransactions.subtype,
        amount: sql<number>`(${investmentTransactions.amount} * ${share})::float8`,
      })
      .from(investmentTransactions)
      .innerJoin(accounts, eq(accounts.id, investmentTransactions.accountId))
      .where(
        and(
          eq(accounts.hidden, false),
          gte(investmentTransactions.date, from),
          lte(investmentTransactions.date, today),
          inArray(investmentTransactions.subtype, [...DIVIDEND_SUBTYPES, ...INTEREST_SUBTYPES, ...REINVEST_SUBTYPES]),
        ),
      ),
    db
      .select({ accountId: investmentTransactions.accountId, first: sql<string>`min(${investmentTransactions.date})` })
      .from(investmentTransactions)
      .groupBy(investmentTransactions.accountId),
  ]);

  const year = today.slice(0, 4);
  const lastYearToday = shiftYears(today, -1);
  const lastYearStart = `${Number(year) - 1}-01-01`;
  const ytd = zero();
  const previousYtd = zero();
  const trailing12 = zero();
  const byMonth = new Map(months.map((m) => [m, zero()]));
  const byAccount = new Map<string, IncomeTotals & { accountId: string; accountName: string }>();
  const byHolding = new Map<string, { accountId: string; securityId: string; income: number }>();

  for (const r of rows) {
    // Plaid: negative amounts are money into the account (income); reinvestment buys are positive.
    const key: keyof IncomeTotals = REINVEST_SUBTYPES.includes(r.subtype!)
      ? 'reinvested'
      : INTEREST_SUBTYPES.includes(r.subtype!)
        ? 'interest'
        : 'dividends';
    const amount = key === 'reinvested' ? r.amount : -r.amount;
    const add = (t: IncomeTotals) => (t[key] += amount);

    add(byMonth.get(r.date.slice(0, 7))!);
    if (r.date > lastYearToday) {
      add(trailing12);
      if (key !== 'reinvested' && r.securityId) {
        const k = `${r.accountId}:${r.securityId}`;
        const h = byHolding.get(k) ?? { accountId: r.accountId, securityId: r.securityId, income: 0 };
        h.income += amount;
        byHolding.set(k, h);
      }
    }
    if (r.date.startsWith(year)) {
      add(ytd);
      let account = byAccount.get(r.accountId);
      if (!account) byAccount.set(r.accountId, (account = { accountId: r.accountId, accountName: r.accountName, ...zero() }));
      add(account);
    } else if (r.date >= lastYearStart && r.date <= lastYearToday) {
      add(previousYtd);
    }
  }

  const firstByAccount = new Map(historyStarts.map((r) => [r.accountId, r.first]));
  const annualized = [...byHolding.values()].flatMap(({ accountId, securityId, income }) => {
    const first = firstByAccount.get(accountId)!;
    const days = first > lastYearToday ? daysBetween(first, today) : 365;
    if (days < MIN_ANNUALIZE_DAYS || income <= 0) return [];
    return [{ accountId, securityId, annualIncome: round2((income * 365) / days), days }];
  });

  return {
    asOf: today,
    ytd: roundTotals(ytd),
    previousYtd: roundTotals(previousYtd),
    trailing12: roundTotals(trailing12),
    months: months.map((month) => roundTotals({ month, ...byMonth.get(month)! })),
    byAccount: [...byAccount.values()]
      .map(roundTotals)
      .sort((a, b) => b.dividends + b.interest - (a.dividends + a.interest)),
    byHolding: annualized,
  };
}
