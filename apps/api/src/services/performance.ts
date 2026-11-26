import type { InvestmentPerformance, PerformancePeriod, PerformancePoint, PerformanceTotals } from '@meld/shared';
import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, balanceSnapshots, holdings, investmentTransactions, priceHistory, securities } from '../db/schema';
import { localDate } from '../lib/networth';
import { fetchYahooCloses, type FetchCloses } from '../lib/prices';
import { shiftYears } from './overview';

/** Plaid keeps about two years of investment transactions. */
const HISTORY_YEARS = 2;
/** Look up closes again after this long. */
const PRICES_MAX_AGE_HOURS = 12;
/** And ask again about a ticker the source didn't know after this long. */
const UNKNOWN_TICKER_MAX_AGE_DAYS = 30;
/** Price lookups in flight at once. */
const PRICE_CONCURRENCY = 4;
/** An account whose transactions start this long after the others' gets a note. */
const LATE_HISTORY_DAYS = 60;
/** Below this, a day's starting balance is too small for a meaningful return (leftover pennies in an emptied account). */
const MIN_BASE = 100;

const round2 = (n: number) => Math.round(n * 100) / 100;
const CASH = 'cash';

export type PerfSecurity = { id: string; ticker: string | null; name: string | null; type: string | null };
export type PerfAccount = {
  id: string;
  name: string;
  /** Your ownership share, 0–1. */
  share: number;
  /** The institution's balance today (whole account), or null. */
  balance: number | null;
};
export type PerfHolding = { accountId: string; securityId: string; quantity: number; price: number | null; value: number | null };
export type PerfTransaction = {
  accountId: string;
  securityId: string | null;
  date: string;
  name: string;
  type: string;
  subtype: string | null;
  quantity: number;
  price: number;
  amount: number;
};

export type PerformanceInput = {
  today: string;
  accounts: PerfAccount[];
  securities: Map<string, PerfSecurity>;
  holdings: PerfHolding[];
  transactions: PerfTransaction[];
  /** Market closes by ticker. */
  closes: Map<string, Record<string, number>>;
  /** Recorded balances (your share) by account id. */
  snapshots: { date: string; balances: Record<string, number> }[];
};

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.toISOString().slice(0, 7)}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** Money market funds and currency are cash: worth their quantity, and moving between them isn't a flow. */
export function isCash(s: PerfSecurity | undefined): boolean {
  // Fidelity's core cash position is FCASH, typed as an equity.
  return !s || s.type === 'cash' || !!s.ticker?.startsWith('CUR:') || s.ticker === 'FCASH';
}

const SWEEP = /\bsweep\b/i;
/** Fund distributions some institutions report as deposits; they're earnings, not money you added. */
export const EARNINGS = /dividend|interest|cap(ital)? gain|reinvest/i;

/**
 * Same-day transfers within an account that cancel out (cash moving between core positions, share
 * class exchanges) aren't money in or out.
 */
function internalTransfers(txns: PerfTransaction[]): Set<PerfTransaction> {
  const internal = new Set<PerfTransaction>();
  const groups = new Map<string, PerfTransaction[]>();
  for (const t of txns) {
    if (t.type !== 'transfer' || !t.amount) continue;
    const key = `${t.accountId}|${t.date}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const group of groups.values()) {
    for (const t of group) {
      if (internal.has(t)) continue;
      const match = group.find((o) => o !== t && !internal.has(o) && Math.abs(o.amount + t.amount) < 0.005);
      if (match) internal.add(t).add(match);
    }
  }
  return internal;
}

/** +1 into the account, −1 out. Institutions disagree on signs; quantity is the most reliable. */
function transferDirection(t: PerfTransaction): number {
  if (t.quantity) return Math.sign(t.quantity);
  // Plaid's convention: a negative amount is money into the account.
  return -Math.sign(t.amount);
}

/**
 * Daily prices for one security across `days`: market closes carried forward when there are any,
 * otherwise straight lines through the prices in its own transactions and today's holding price.
 */
function priceSeries(
  days: string[],
  closes: Record<string, number> | undefined,
  known: [string, number][],
): { prices: Float64Array; market: boolean } {
  const prices = new Float64Array(days.length);
  if (closes) {
    const sorted = Object.entries(closes).sort(([a], [b]) => a.localeCompare(b));
    let k = 0;
    let last = sorted[0]![1];
    days.forEach((d, i) => {
      while (k < sorted.length && sorted[k]![0] <= d) last = sorted[k++]![1];
      prices[i] = last;
    });
    return { prices, market: true };
  }
  const points = [...new Map(known.filter(([, p]) => p > 0).sort(([a], [b]) => a.localeCompare(b))).entries()];
  if (!points.length) return { prices, market: false };
  let k = 0;
  days.forEach((d, i) => {
    while (k < points.length - 1 && points[k + 1]![0] <= d) k++;
    const [d0, p0] = points[k]!;
    const next = points[k + 1];
    if (d <= d0 || !next) prices[i] = p0;
    else prices[i] = p0 + ((next[1] - p0) * daysBetween(d0, d)) / daysBetween(d0, next[0]);
  });
  return { prices, market: false };
}

type Series = { value: Float64Array; inflow: Float64Array; outflow: Float64Array };

/** Daily time-weighted growth of $1, treating inflows as arriving at the start of the day and outflows at its end. */
function growthIndex(s: Series): Float64Array {
  const index = new Float64Array(s.value.length);
  index[0] = 1;
  for (let i = 1; i < index.length; i++) {
    const base = s.value[i - 1]! + s.inflow[i]!;
    const r = base > MIN_BASE ? (s.value[i]! - s.value[i - 1]! - s.inflow[i]! + s.outflow[i]!) / base : 0;
    index[i] = index[i - 1]! * (1 + r);
  }
  return index;
}

function totals(s: Series, index: Float64Array, from: number, to: number): PerformanceTotals {
  let contributions = 0;
  let withdrawals = 0;
  let peak = s.value[from]!;
  for (let i = from + 1; i <= to; i++) {
    contributions += s.inflow[i]!;
    withdrawals += s.outflow[i]!;
    peak = Math.max(peak, s.value[i]!);
  }
  const startValue = s.value[from]!;
  const endValue = s.value[to]!;
  return {
    startValue: round2(startValue),
    endValue: round2(endValue),
    contributions: round2(contributions),
    withdrawals: round2(withdrawals),
    gain: round2(endValue - startValue - contributions + withdrawals),
    return: peak > MIN_BASE && index[from]! > 0 ? index[to]! / index[from]! - 1 : null,
  };
}

/**
 * Replays each account's transactions backward from today's holdings, valuing positions at daily
 * prices, then swaps in recorded balances where Meld has them. Money in and out is kept apart from
 * what markets did, so returns are time-weighted.
 */
export function computePerformance(input: PerformanceInput): InvestmentPerformance {
  const { today } = input;
  const earliest = input.transactions.reduce((min, t) => (t.date < min ? t.date : min), today);
  const firstSnapshot = input.snapshots.find((s) => Object.keys(s.balances).length)?.date ?? null;
  const floor = shiftYears(today, -HISTORY_YEARS);
  const start = [earliest, firstSnapshot ?? today].reduce((a, b) => (a < b ? a : b));
  const from = start < floor ? floor : addDays(start, -1);
  const days: string[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) days.push(d);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const n = days.length;

  const txns = input.transactions.filter((t) => t.date > from && t.date <= today);
  const internal = internalTransfers(txns);

  // Prices for every non-cash security that's held or traded.
  const known = new Map<string, [string, number][]>();
  for (const h of input.holdings) {
    const price = h.price ?? (h.value !== null && h.quantity ? h.value / h.quantity : null);
    if (price) known.set(h.securityId, [...(known.get(h.securityId) ?? []), [today, price]]);
  }
  for (const t of txns) {
    if (!t.securityId) continue;
    const price = t.price > 0 ? t.price : t.quantity && t.amount ? Math.abs(t.amount / t.quantity) : 0;
    if (price) known.set(t.securityId, [...(known.get(t.securityId) ?? []), [t.date, price]]);
  }
  const prices = new Map<string, Float64Array>();
  const approximated = new Set<string>();
  const priceOf = (securityId: string) => {
    let p = prices.get(securityId);
    if (!p) {
      const s = input.securities.get(securityId);
      const series = priceSeries(days, s?.ticker ? input.closes.get(s.ticker) : undefined, known.get(securityId) ?? []);
      if (!series.market) approximated.add(s?.name ?? s?.ticker ?? 'Unknown security');
      prices.set(securityId, (p = series.prices));
    }
    return p;
  };

  const byAccount = new Map<string, PerfTransaction[]>();
  for (const t of txns) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);

  const accountSeries = input.accounts.map((account) => {
    const series: Series = { value: new Float64Array(n), inflow: new Float64Array(n), outflow: new Float64Array(n) };
    // Positions at the end of the day being valued: shares by security, and dollars of cash.
    const positions = new Map<string, number>();
    let securitiesValue = 0;
    let cashHoldings = 0;
    for (const h of input.holdings.filter((h) => h.accountId === account.id)) {
      if (isCash(input.securities.get(h.securityId))) {
        cashHoldings += h.value ?? h.quantity;
      } else {
        positions.set(h.securityId, (positions.get(h.securityId) ?? 0) + h.quantity);
        securitiesValue += h.value ?? 0;
      }
    }
    // Some institutions leave the core cash position out of holdings; the balance has it.
    positions.set(CASH, account.balance !== null ? account.balance - securitiesValue : cashHoldings);
    const move = (key: string, delta: number) => positions.set(key, (positions.get(key) ?? 0) + delta);

    const txByDay = new Map<number, PerfTransaction[]>();
    for (const t of byAccount.get(account.id) ?? []) {
      const i = dayIndex.get(t.date)!;
      txByDay.set(i, [...(txByDay.get(i) ?? []), t]);
    }

    for (let i = n - 1; i >= 0; i--) {
      let value = 0;
      for (const [key, qty] of positions) value += key === CASH ? qty : qty * priceOf(key)[i]!;
      series.value[i] = value * account.share;

      // Undo the day's transactions to get the positions at the end of the day before.
      for (const t of txByDay.get(i) ?? []) {
        if (internal.has(t) || SWEEP.test(t.name)) continue;
        const security = t.securityId ? input.securities.get(t.securityId) : undefined;
        const shares = !!t.securityId && !isCash(security) && t.quantity !== 0;
        let flow = 0;
        const isZeroCashShareArrival =
          shares &&
          t.quantity > 0 &&
          Math.abs(t.amount) < 0.01 &&
          !EARNINGS.test(t.name) &&
          !(t.subtype && (EARNINGS.test(t.subtype) || /split/i.test(t.subtype)));

        if (t.type === 'transfer') {
          const dir = transferDirection(t);
          flow = dir * (Math.abs(t.amount) || (shares ? Math.abs(t.quantity) * priceOf(t.securityId!)[i]! : 0));
          if (shares) move(t.securityId!, -dir * Math.abs(t.quantity));
          else move(CASH, -flow);
        } else if (t.type === 'buy' || t.type === 'sell') {
          if (isZeroCashShareArrival) {
            move(t.securityId!, -t.quantity);
            flow = t.quantity * priceOf(t.securityId!)[i]!;
          } else if (shares) {
            // Buying into a money market fund is cash moving to cash.
            move(t.securityId!, -t.quantity);
            move(CASH, t.amount);
          }
        } else {
          // Contributions and dividends that arrive as shares (common in 401(k)s) never touch cash.
          if ((shares && t.type === 'cash') || isZeroCashShareArrival) move(t.securityId!, -t.quantity);
          else move(CASH, t.amount);
          const external =
            t.type === 'cash' &&
            (t.subtype === 'contribution' ||
              ((t.subtype === 'deposit' || t.subtype === 'withdrawal' || t.subtype === 'tax withheld') && !EARNINGS.test(t.name)));
          if (external) flow = -t.amount;
          else if (isZeroCashShareArrival) flow = t.quantity * priceOf(t.securityId!)[i]!;
        }
        if (flow > 0) series.inflow[i]! += flow * account.share;
        else series.outflow[i]! -= flow * account.share;
      }
    }

    // Recorded balances replace estimates from the first snapshot on.
    for (const snap of input.snapshots) {
      const i = dayIndex.get(snap.date);
      const balance = snap.balances[account.id];
      if (i !== undefined && balance !== undefined) series.value[i] = balance;
    }
    return { account, series, index: growthIndex(series) };
  });

  const total: Series = { value: new Float64Array(n), inflow: new Float64Array(n), outflow: new Float64Array(n) };
  for (const { series } of accountSeries) {
    for (let i = 0; i < n; i++) {
      total.value[i]! += series.value[i]!;
      total.inflow[i]! += series.inflow[i]!;
      total.outflow[i]! += series.outflow[i]!;
    }
  }
  const totalIndex = growthIndex(total);

  const period = (key: string, label: string, startDate: string, endDate = today): PerformancePeriod | null => {
    const s = dayIndex.get(startDate < from ? from : startDate);
    const e = dayIndex.get(endDate);
    if (s === undefined || e === undefined || s >= e || startDate < from) return null;
    const t = totals(total, totalIndex, s, e);
    const span = daysBetween(days[s]!, days[e]!);
    return {
      key,
      label,
      start: days[s]!,
      end: days[e]!,
      ...t,
      annualized: t.return !== null && span >= 365 ? (1 + t.return) ** (365 / span) - 1 : null,
      byAccount: accountSeries
        .map(({ account, series, index }) => ({ accountId: account.id, accountName: account.name, ...totals(series, index, s, e) }))
        .filter((a) => a.startValue || a.endValue || a.contributions || a.withdrawals)
        .sort((a, b) => b.endValue - a.endValue),
    };
  };
  const year = Number(today.slice(0, 4));
  const periods = [
    period('1m', '1 month', shiftMonths(today, -1)),
    period('3m', '3 months', shiftMonths(today, -3)),
    period('ytd', 'Year to date', `${year - 1}-12-31`),
    period('1y', '1 year', shiftYears(today, -1)),
    period('all', 'All', from),
  ];
  for (let y = year - 1; `${y}-12-31` > from; y--) {
    const start = `${y - 1}-12-31`;
    // A partial first year still counts, from where the history starts.
    periods.push(period(String(y), String(y), start < from ? from : start, `${y}-12-31`));
  }

  const firstTxn = new Map<string, string>();
  for (const t of input.transactions) {
    if (!firstTxn.has(t.accountId) || t.date < firstTxn.get(t.accountId)!) firstTxn.set(t.accountId, t.date);
  }
  const points: PerformancePoint[] = days.map((date, i) => ({
    date,
    value: round2(total.value[i]!),
    flow: round2(total.inflow[i]! - total.outflow[i]!),
    index: Math.round(totalIndex[i]! * 1e6) / 1e6,
  }));

  return {
    asOf: today,
    points,
    periods: periods.filter((p): p is PerformancePeriod => p !== null),
    estimatedBefore: firstSnapshot && firstSnapshot > from ? firstSnapshot : null,
    approximated: [...approximated].sort(),
    limitedHistory: accountSeries
      .filter(({ account, series }) => {
        const since = firstTxn.get(account.id);
        return series.value.some((v) => v > MIN_BASE) && (!since || daysBetween(from, since) > LATE_HISTORY_DAYS);
      })
      .map(({ account }) => ({ accountName: account.name, since: firstTxn.get(account.id) ?? null })),
  };
}

// --- Loading ----------------------------------------------------------------------

// One refresh at a time; a second caller shares the one in flight.
let refreshing: Promise<void> | null = null;

/** Fetches closes for tickers that have none yet or whose closes are stale. */
export function refreshPrices(db: Db, tickers: string[], from: string, to: string, fetchCloses: FetchCloses): Promise<void> {
  refreshing ??= runRefresh(db, tickers, from, to, fetchCloses).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function runRefresh(db: Db, tickers: string[], from: string, to: string, fetchCloses: FetchCloses) {
  if (!tickers.length) return;
  const fresh = await db
    .select({ ticker: priceHistory.ticker })
    .from(priceHistory)
    .where(
      and(
        inArray(priceHistory.ticker, tickers),
        or(
          gte(priceHistory.fetchedAt, sql`now() - make_interval(hours => ${PRICES_MAX_AGE_HOURS})`),
          and(sql`${priceHistory.closes} is null`, gte(priceHistory.fetchedAt, sql`now() - make_interval(days => ${UNKNOWN_TICKER_MAX_AGE_DAYS})`)),
        ),
      ),
    );
  const skip = new Set(fresh.map((r) => r.ticker));
  const pending = tickers.filter((t) => !skip.has(t));
  const work = async (ticker: string) => {
    let closes: Record<string, number> | null;
    try {
      closes = await fetchCloses(ticker, addDays(from, -7), to);
    } catch (err) {
      // Keep whatever closes we had; try again next time.
      console.warn(`[prices] ${ticker}: ${(err as Error).message}`);
      return;
    }
    await db
      .insert(priceHistory)
      .values({ ticker, closes, fetchedAt: new Date() })
      .onConflictDoUpdate({ target: priceHistory.ticker, set: { closes, fetchedAt: new Date() } });
  };
  for (let i = 0; i < pending.length; i += PRICE_CONCURRENCY) {
    await Promise.all(pending.slice(i, i + PRICE_CONCURRENCY).map(work));
  }
}

export type PerformanceOptions = {
  /** 'blocking' awaits Yahoo closes; 'background' uses cached closes and refreshes asynchronously; 'none' skips fetching. */
  refresh?: 'blocking' | 'background' | 'none';
};

export async function getInvestmentPerformance(
  db: Db,
  fetchCloses: FetchCloses = fetchYahooCloses,
  today = localDate(),
  options: PerformanceOptions = {},
): Promise<InvestmentPerformance> {
  const from = shiftYears(today, -HISTORY_YEARS);
  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      ownershipPercent: accounts.ownershipPercent,
      balance: accounts.currentBalance,
    })
    .from(accounts)
    .where(and(eq(accounts.hidden, false), eq(accounts.type, 'investment')));
  const ids = accountRows.map((a) => a.id);
  if (!ids.length) {
    return { asOf: today, points: [], periods: [], estimatedBefore: null, approximated: [], limitedHistory: [] };
  }

  const [holdingRows, txnRows, snapshotRows] = await Promise.all([
    db
      .select({
        accountId: holdings.accountId,
        securityId: holdings.securityId,
        quantity: holdings.quantity,
        price: holdings.institutionPrice,
        value: holdings.institutionValue,
      })
      .from(holdings)
      .where(inArray(holdings.accountId, ids)),
    db
      .select({
        accountId: investmentTransactions.accountId,
        securityId: investmentTransactions.securityId,
        date: investmentTransactions.date,
        name: investmentTransactions.name,
        type: investmentTransactions.type,
        subtype: investmentTransactions.subtype,
        quantity: sql<number>`coalesce(${investmentTransactions.quantity}, 0)::float8`,
        price: sql<number>`coalesce(${investmentTransactions.price}, 0)::float8`,
        amount: sql<number>`coalesce(${investmentTransactions.amount}, 0)::float8`,
      })
      .from(investmentTransactions)
      .where(and(inArray(investmentTransactions.accountId, ids), gte(investmentTransactions.date, from))),
    db
      .select({ date: balanceSnapshots.date, balances: balanceSnapshots.balances })
      .from(balanceSnapshots)
      .where(and(gte(balanceSnapshots.date, from), lt(balanceSnapshots.date, addDays(today, 1))))
      .orderBy(asc(balanceSnapshots.date)),
  ]);

  const securityIds = [...new Set([...holdingRows.map((h) => h.securityId), ...txnRows.flatMap((t) => (t.securityId ? [t.securityId] : []))])];
  const securityRows = securityIds.length
    ? await db
        .select({ id: securities.id, ticker: securities.tickerSymbol, name: securities.name, type: securities.type })
        .from(securities)
        .where(inArray(securities.id, securityIds))
    : [];
  const tickers = [...new Set(securityRows.filter((s) => !isCash(s) && s.ticker).map((s) => s.ticker!))];
  const refreshMode = options.refresh ?? 'blocking';
  if (refreshMode === 'blocking') {
    await refreshPrices(db, tickers, from, today, fetchCloses);
  } else if (refreshMode === 'background' && tickers.length) {
    void refreshPrices(db, tickers, from, today, fetchCloses).catch(() => {});
  }
  const priceRows = tickers.length
    ? await db.select().from(priceHistory).where(inArray(priceHistory.ticker, tickers))
    : [];

  return computePerformance({
    today,
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name, share: (a.ownershipPercent ?? 100) / 100, balance: a.balance })),
    securities: new Map(securityRows.map((s) => [s.id, s])),
    holdings: holdingRows,
    transactions: txnRows,
    closes: new Map(priceRows.flatMap((p) => (p.closes ? [[p.ticker, p.closes] as const] : []))),
    snapshots: snapshotRows.map((s) => ({ date: s.date, balances: s.balances ?? {} })),
  });
}
