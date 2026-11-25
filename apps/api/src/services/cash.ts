import {
  CASH_ETFS,
  CashSettings,
  DEFAULT_EMERGENCY_MONTHS,
  EMPTY_CASH_SETTINGS,
  LIQUID_BANK_SUBTYPES,
  ownedBalance,
  type ApySource,
  type CashPlan,
  type CashPosition,
  type CashSuggestion,
  type Holding,
} from '@meld/shared';
import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, cashSettings, investmentTransactions, transactions } from '../db/schema';
import { localDate } from '../lib/networth';
import { fetchTreasuryYield, fetchYahooTrailingYield, type FetchYield } from '../lib/prices';
import { listAccounts, listHoldings } from './accounts';
import { getCashflow, recentMonths } from './overview';
import { addDays, daysBetween } from './performance';

/** Where today's market rates come from; tests pass their own. */
export type MarketRates = {
  /** Trailing yield of a fund, as a fraction. */
  fundYield: FetchYield;
  /** What cash earns at a high-yield account now, as a fraction. */
  benchmark: () => Promise<number | null>;
};

/** Rates move slowly; ask the market data source at most this often. */
const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Complete months of history a rate is worked out from. */
const RATE_MONTHS = 3;
/** Less history than this says nothing about a rate. */
const MIN_RATE_DAYS = 28;
/** Interest postings further apart than this have one missing between them. */
const MAX_POSTING_GAP_DAYS = 45;
/** Detected rates above this are bonuses or misread transactions, not a rate to plan around. */
const MAX_PLAUSIBLE_APY = 0.15;
/** Complete months of spending averaged. */
const SPENDING_MONTHS = 12;
/** What a checking account keeps for bills when spending is unknown. */
const DEFAULT_CHECKING_BUFFER = 2_500;
/** A rate this far under the benchmark is worth moving away from… */
const LOW_YIELD_GAP = 0.01;
/** …when it adds at least this much a year. */
const MIN_YEARLY_GAIN = 25;
/** Smaller amounts aren't worth a suggestion. */
const MIN_AMOUNT = 1_000;

const INTEREST = 'INCOME_INTEREST_EARNED';
const FUND_INCOME = ['dividend', 'interest', 'qualified dividend', 'non-qualified dividend'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString('en-US', { minimumFractionDigits: n < 0.1 ? 1 : 0 })}%`;
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function cached<T>(fn: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const memo = new Map<string, { at: number; value: Promise<T> }>();
  return (key) => {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < RATES_MAX_AGE_MS) return hit.value;
    const value = fn(key);
    memo.set(key, { at: Date.now(), value });
    // Failures are retried on the next request.
    value.catch(() => memo.delete(key));
    return value;
  };
}

const yahooYield = cached(fetchYahooTrailingYield);
const treasury = cached(() => fetchTreasuryYield());
export const yahooRates: MarketRates = { fundYield: yahooYield, benchmark: () => treasury('^IRX') };

async function orNull<T>(what: string, p: Promise<T | null>, timeoutMs?: number): Promise<T | null> {
  const safe = p.catch((err) => {
    console.warn(`[cash] ${what}: ${(err as Error).message}`);
    return null;
  });
  if (!timeoutMs || timeoutMs <= 0) return safe;
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    safe,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

// --- Settings -----------------------------------------------------------------------

export async function getCashSettings(db: Db): Promise<CashSettings> {
  const row = await db.query.cashSettings.findFirst({ where: eq(cashSettings.id, 1) });
  return CashSettings.parse({ ...EMPTY_CASH_SETTINGS, ...(row?.settings ?? {}) });
}

export async function saveCashSettings(db: Db, settings: CashSettings): Promise<CashSettings> {
  await db
    .insert(cashSettings)
    .values({ id: 1, settings })
    .onConflictDoUpdate({ target: cashSettings.id, set: { settings, updatedAt: new Date() } });
  return getCashSettings(db);
}

// --- Classifying holdings ---------------------------------------------------------------

/** A brokerage's own cash position, as opposed to a fund. */
function isSweep(h: Pick<Holding, 'ticker' | 'securityType'>): boolean {
  // Fidelity's core cash position is FCASH, typed as an equity.
  return h.ticker?.startsWith('CUR:') || h.ticker === 'FCASH' || (!h.ticker && h.securityType === 'cash');
}

/** Mutual fund tickers are five letters ending in X; money market funds among them pay about the T-bill rate. */
const isMoneyMarketFund = (h: Pick<Holding, 'ticker' | 'securityType' | 'name'>) =>
  !!h.ticker && /^[A-Z]{4}X$/i.test(h.ticker) && (h.securityType === 'cash' || /money market/i.test(h.name ?? ''));

const CASH_NAME = /money market|\bcash\b|sweep|treasury|government|liquidity|deposit|reserves?\b/i;

/**
 * Money market funds, cash ETFs and plain cash. Plaid types some 401(k) stock funds as cash, so a
 * 'cash' security also needs a money market ticker or a cash-sounding name.
 */
export function isCashHolding(h: Pick<Holding, 'ticker' | 'securityType' | 'name' | 'profile'>): boolean {
  if (isSweep(h) || isMoneyMarketFund(h)) return true;
  if (h.securityType === 'cash') return CASH_NAME.test(h.name ?? '');
  if (h.ticker && CASH_ETFS.has(h.ticker.toUpperCase())) return true;
  return (h.profile?.assetClasses.cash ?? 0) >= 0.95;
}

// --- The plan --------------------------------------------------------------------------

/** A position with whatever rate the data shows, before your settings apply. */
export type DetectedPosition = Omit<CashPosition, 'earmarked' | 'apy' | 'apySource'> & {
  apy: number | null;
  apySource: ApySource | null;
};

export type CashInputs = {
  today: string;
  settings: CashSettings;
  positions: DetectedPosition[];
  /** The 3-month Treasury yield, as a fraction. */
  treasuryApy: number | null;
  /** Spending in each complete month with any, most recent last. */
  spendingMonths: number[];
  /** You carry a credit card balance, which should go before investing spare cash. */
  cardDebt: number;
};

export function buildCashPlan(input: CashInputs): CashPlan {
  const { settings } = input;
  const earmarked = new Set(settings.earmarked);

  const positions: CashPosition[] = input.positions
    .map((p) => {
      const entered = settings.apyPercent[p.key];
      return {
        ...p,
        value: round2(p.value),
        apy: entered !== undefined ? entered / 100 : p.apy,
        apySource: entered !== undefined ? ('entered' as const) : p.apySource,
        earmarked: earmarked.has(p.key),
      };
    })
    .sort((a, b) => b.value - a.value);

  const benchmarkApy = settings.benchmarkApyPercent !== null ? settings.benchmarkApyPercent / 100 : input.treasuryApy;
  const benchmark: CashPlan['benchmark'] = {
    apy: benchmarkApy,
    source: settings.benchmarkApyPercent !== null ? 'entered' : input.treasuryApy !== null ? 'treasury' : null,
  };

  const recent = input.spendingMonths.slice(-SPENDING_MONTHS);
  const average = recent.length ? round2(recent.reduce((s, m) => s + m, 0) / recent.length) : null;
  const monthly = settings.monthlySpending ?? average;
  const spending: CashPlan['spending'] = {
    monthly,
    source: settings.monthlySpending !== null ? 'entered' : average !== null ? 'history' : null,
    average,
    months: recent.length,
  };

  const sum = (list: CashPosition[]) => round2(list.reduce((s, p) => s + p.value, 0));
  const spendable = positions.filter((p) => !p.taxAdvantaged);
  const emergencyCash = sum(spendable.filter((p) => !p.earmarked));
  const rated = spendable.filter((p) => p.apy !== null);
  const ratedTotal = rated.reduce((s, p) => s + p.value, 0);
  const yearlyInterest = rated.reduce((s, p) => s + p.value * p.apy!, 0);

  const targetMonths = settings.emergencyMonths ?? DEFAULT_EMERGENCY_MONTHS;
  const target = monthly !== null ? round2(monthly * targetMonths) : null;
  const emergency: CashPlan['emergency'] = {
    targetMonths,
    target,
    runwayMonths: monthly ? Math.round((emergencyCash / monthly) * 10) / 10 : null,
    gap: target !== null ? round2(emergencyCash - target) : null,
  };

  const suggestions: CashSuggestion[] = [];
  const checkingBuffer = monthly ?? DEFAULT_CHECKING_BUFFER;

  // Cash earning well under what it could, moved to a high-yield account or money market fund.
  const lowYield: CashSuggestion[] = [];
  if (benchmarkApy !== null) {
    for (const p of spendable) {
      if (p.apy === null || benchmarkApy - p.apy < LOW_YIELD_GAP) continue;
      const movable = p.accountSubtype === 'checking' ? p.value - checkingBuffer : p.value;
      const gain = movable * (benchmarkApy - p.apy);
      if (movable < MIN_AMOUNT || gain < MIN_YEARLY_GAIN) continue;
      const where = p.kind === 'bank' ? p.accountName : `${p.ticker ?? p.name ?? 'Cash'} in ${p.accountName}`;
      lowYield.push({
        id: `low-yield:${p.key}`,
        kind: 'earn',
        title: `Move ${dollars(movable)} from ${where} to earn more`,
        detail:
          `It earns about ${pct(p.apy)}; high-yield savings and money market funds pay around ${pct(benchmarkApy)} now.` +
          (p.accountSubtype === 'checking' ? ` That leaves ${dollars(checkingBuffer)}, about a month of spending, in checking for bills.` : ''),
        impact: round2(gain),
        question: `I have ${dollars(p.value)} in ${where} earning about ${pct(p.apy)}. Where could I get a better rate while keeping it safe and easy to reach?`,
      });
    }
  }
  lowYield.sort((a, b) => b.impact! - a.impact!);
  const missedInterest = round2(lowYield.reduce((s, x) => s + x.impact!, 0));

  // Short of the target, or holding more than it calls for.
  if (emergency.gap !== null && monthly) {
    if (emergency.gap < 0) {
      suggestions.push({
        id: 'emergency-short',
        kind: 'warning',
        title: `${dollars(-emergency.gap)} short of a ${targetMonths}-month emergency fund`,
        detail: `Your cash covers about ${emergency.runwayMonths} months of your ${dollars(monthly)} monthly spending. Setting aside ${dollars(-emergency.gap / 12)} a month would close the gap in a year.`,
        impact: null,
        question: `My emergency fund covers about ${emergency.runwayMonths} months of spending and I'd like ${targetMonths}. How should I build it up?`,
      });
    } else if (emergency.gap >= Math.max(MIN_AMOUNT, monthly / 4)) {
      suggestions.push({
        id: 'emergency-extra',
        kind: 'invest',
        title: `${dollars(emergency.gap)} more cash than your ${targetMonths}-month emergency fund needs`,
        detail:
          (input.cardDebt > 0
            ? `If any of the ${dollars(input.cardDebt)} on your credit cards is carried month to month, paying it off comes first. After that, `
            : '') +
          'cash beyond your cushion tends to lose ground to inflation over time. Consider investing it, starting with any tax-advantaged room (401(k), IRA, HSA) you haven’t used, or keep it if a big expense is coming.',
        impact: null,
        question: `I have about ${dollars(emergency.gap)} more cash than my ${targetMonths}-month emergency fund needs. What should I do with it?`,
      });
    }
  }
  suggestions.push(...lowYield);

  // Uninvested cash in retirement accounts, usually left over from a contribution or rollover.
  const idle = new Map<string, { name: string; value: number }>();
  for (const p of positions) {
    if (!p.taxAdvantaged || (p.kind === 'fund' && p.ticker && CASH_ETFS.has(p.ticker.toUpperCase()))) continue;
    const a = idle.get(p.accountId) ?? { name: p.accountName, value: 0 };
    a.value += p.value;
    idle.set(p.accountId, a);
  }
  for (const [accountId, a] of idle) {
    if (a.value < MIN_AMOUNT) continue;
    suggestions.push({
      id: `idle:${accountId}`,
      kind: 'invest',
      title: `${dollars(a.value)} sitting in cash in ${a.name}`,
      detail:
        'Cash in a retirement or HSA account can’t cover emergencies without taxes and penalties, and it misses the growth the account is for. Unless you’re holding it on purpose, invest it in line with your plan.',
      impact: null,
      question: `I have ${dollars(a.value)} in cash in my ${a.name}. Should I invest it, and in what?`,
    });
  }

  // What Meld couldn't work out.
  const unknown = spendable.filter((p) => p.apy === null && p.value >= MIN_AMOUNT);
  if (unknown.length) {
    const names = unknown.map((p) => (p.kind === 'bank' ? p.accountName : `${p.ticker ?? 'cash'} in ${p.accountName}`));
    suggestions.push({
      id: 'unknown-rate',
      kind: 'info',
      title: `Enter the rate for ${unknown.length === 1 ? names[0] : `${unknown.length} cash positions`}`,
      detail: `Meld couldn’t tell what ${names.join(', ')} ${unknown.length === 1 ? 'earns' : 'earn'}${unknown.some((p) => p.kind === 'sweep') ? '. Brokerage sweep cash often earns far less than a money market fund' : ''}. Add the rate below to compare.`,
      impact: null,
      question: 'How do I find out what interest rate my cash accounts pay?',
    });
  }
  if (monthly === null) {
    suggestions.push({
      id: 'no-spending',
      kind: 'info',
      title: 'Add your monthly spending',
      detail: 'Without card and checking transactions to average, Meld can’t size an emergency fund. Enter what you spend in a month below.',
      impact: null,
      question: 'How much should I keep in an emergency fund?',
    });
  }

  return {
    asOf: input.today,
    settings,
    positions,
    totals: {
      emergency: emergencyCash,
      earmarked: sum(spendable.filter((p) => p.earmarked)),
      taxAdvantaged: sum(positions.filter((p) => p.taxAdvantaged)),
      apy: ratedTotal > 0 ? yearlyInterest / ratedTotal : null,
      yearlyInterest: round2(yearlyInterest),
      missedInterest,
    },
    benchmark,
    spending,
    emergency,
    suggestions,
  };
}

// --- Gathering it from the database ---------------------------------------------------------

/** Interest over the window, annualized, over the average balance. */
function annualRate(interest: number, days: number, balance: number): number | null {
  if (days < MIN_RATE_DAYS || balance <= 0) return null;
  const rate = (interest * 365) / days / balance;
  return rate >= 0 && rate <= MAX_PLAUSIBLE_APY ? rate : null;
}

/** A bank transaction, as Plaid signs it: deposits negative. */
export type BankTransaction = { date: string; amount: number; interest: boolean };

/** One interest posting and the average daily balance that earned it, since the posting before. */
export type InterestPeriod = { interest: number; days: number; balance: number };

/**
 * The interest periods ending on or after `from`. Banks post on their own schedule (Ally on the
 * 10th, others at month end), so each posting is compared with the balance since the one before,
 * worked back day by day from today's balance through the transactions in between.
 */
export function interestPeriods(currentBalance: number, transactions: BankTransaction[], from: string): InterestPeriod[] {
  const sorted = [...transactions].sort((x, y) => x.date.localeCompare(y.date));
  // The balance at the end of a day: today's, less everything that came in after it.
  const balanceAfter = (date: string) => sorted.reduce((b, t) => (t.date > date ? b + t.amount : b), currentBalance);
  const postings = new Map<string, number>();
  for (const t of sorted) if (t.interest) postings.set(t.date, (postings.get(t.date) ?? 0) - t.amount);
  const dates = [...postings.keys()];

  const periods: InterestPeriod[] = [];
  for (let i = 1; i < dates.length; i++) {
    const [start, end] = [dates[i - 1]!, dates[i]!];
    const days = daysBetween(start, end);
    if (end < from || days > MAX_POSTING_GAP_DAYS) continue;
    const interest = postings.get(end)!;
    let total = 0;
    // The days after the last posting through this one, before its interest lands.
    for (let d = addDays(start, 1); d <= end; d = addDays(d, 1)) total += balanceAfter(d) - (d === end ? interest : 0);
    periods.push({ interest, days, balance: total / days });
  }
  return periods;
}

/**
 * APY from interest periods: each period's rate compounded monthly the way banks quote it, and the
 * median of those, so one period whose transactions don't add up (a transfer reversed by a sweep
 * entry, say) can't skew it.
 */
export function bankApy(periods: InterestPeriod[]): number | null {
  const rates = periods
    .filter((p) => p.balance > 0)
    .map((p) => (1 + ((p.interest / p.balance / p.days) * 365) / 12) ** 12 - 1)
    .sort((x, y) => x - y);
  if (!rates.length) return null;
  const mid = rates.length / 2;
  const apy = rates.length % 2 ? rates[Math.floor(mid)]! : (rates[mid - 1]! + rates[mid]!) / 2;
  return apy >= 0 && apy <= MAX_PLAUSIBLE_APY ? apy : null;
}

export type CashPlanOptions = {
  /** Max wait for uncached market yield lookups; timed-out fetches still populate the in-memory cache. */
  rateTimeoutMs?: number;
};

export async function getCashPlan(
  db: Db,
  rates: MarketRates = yahooRates,
  today = localDate(),
  options: CashPlanOptions = {},
): Promise<CashPlan> {
  // The last RATE_MONTHS complete months.
  const months = recentMonths(RATE_MONTHS + 1, today);
  const from = `${months[0]}-01`;
  const to = `${months.at(-1)}-01`;

  const [settings, accountList, holdingList, cashflow] = await Promise.all([
    getCashSettings(db),
    listAccounts(db, eq(accounts.hidden, false)),
    listHoldings(db, eq(accounts.hidden, false)),
    getCashflow(db, SPENDING_MONTHS + 1, today),
  ]);
  const byId = new Map(accountList.map((a) => [a.id, a]));
  const share = (accountId: string) => (byId.get(accountId)?.ownershipPercent ?? 100) / 100;

  const banks = accountList.filter(
    (a) => a.type === 'depository' && (!a.subtype || LIQUID_BANK_SUBTYPES.has(a.subtype)) && ownedBalance(a) >= 1,
  );
  const cashHoldings = holdingList.filter((h) => (h.value ?? 0) * share(h.accountId) >= 1 && isCashHolding(h));
  const bankIds = banks.map((a) => a.id);
  const brokerageIds = [...new Set(cashHoldings.map((h) => h.accountId))];

  const [bankTransactions, history, fundIncome, treasuryApy] = await Promise.all([
    bankIds.length
      ? db
          .select({
            accountId: transactions.accountId,
            date: sql<string>`${transactions.date}::text`,
            amount: transactions.amount,
            // Plaid's interest category, unless you've recategorized it; or a deposit named for interest.
            interest: sql<boolean>`${and(
              lt(transactions.amount, 0),
              or(
                and(eq(transactions.plaidCategoryDetailed, INTEREST), or(isNull(transactions.category), eq(transactions.category, 'INCOME'))),
                sql`${transactions.name} ~* '\\minterest\\M'`,
              ),
            )}`,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.accountId, bankIds),
              gte(transactions.date, addDays(from, -MAX_POSTING_GAP_DAYS)),
              // Today's balance leaves out what's still pending.
              eq(transactions.pending, false),
            ),
          )
      : [],
    bankIds.length
      ? db
          .select({ accountId: transactions.accountId, first: sql<string>`min(${transactions.date})::text` })
          .from(transactions)
          .where(inArray(transactions.accountId, bankIds))
          .groupBy(transactions.accountId)
      : [],
    brokerageIds.length
      ? db
          .select({
            accountId: investmentTransactions.accountId,
            securityId: investmentTransactions.securityId,
            total: sql<number>`(-sum(${investmentTransactions.amount}))::float8`,
          })
          .from(investmentTransactions)
          .where(
            and(
              inArray(investmentTransactions.accountId, brokerageIds),
              inArray(investmentTransactions.subtype, FUND_INCOME),
              gte(investmentTransactions.date, from),
              lt(investmentTransactions.date, to),
            ),
          )
          .groupBy(investmentTransactions.accountId, investmentTransactions.securityId)
      : [],
    orNull('Treasury yield', rates.benchmark(), options.rateTimeoutMs),
  ]);

  const firstOf = new Map(history.map((r) => [r.accountId, r.first]));
  const incomeOf = new Map(fundIncome.map((r) => [`${r.accountId}:${r.securityId}`, r.total]));
  const windowDays = daysBetween(from, to);

  const positions: DetectedPosition[] = [];

  for (const a of banks) {
    const first = firstOf.get(a.id);
    const periods = interestPeriods(
      a.currentBalance ?? 0,
      bankTransactions.filter((t) => t.accountId === a.id),
      from,
    );
    // No interest at all over a window the account's history covers reads as 0%.
    const apy = periods.length ? bankApy(periods) : first && first <= from ? 0 : null;
    positions.push({
      key: a.id,
      kind: 'bank',
      accountId: a.id,
      accountName: a.name,
      institutionName: a.institutionName,
      accountSubtype: a.subtype,
      ticker: null,
      name: null,
      value: ownedBalance(a),
      apy,
      apySource: apy === null ? null : 'interest',
      taxAdvantaged: false,
    });
  }

  const fundYields = new Map(
    await Promise.all(
      [...new Set(cashHoldings.filter((h) => !isSweep(h)).map((h) => h.ticker!))].map(
        async (t) => [t, await orNull(`yield for ${t}`, rates.fundYield(t), options.rateTimeoutMs)] as const,
      ),
    ),
  );

  for (const h of cashHoldings) {
    const account = byId.get(h.accountId);
    const sweep = isSweep(h);
    const key = `${h.accountId}:${h.securityId}`;
    let apy: number | null = null;
    let apySource: ApySource | null = null;
    const market = sweep ? null : (fundYields.get(h.ticker!) ?? null);
    const own = annualRate(incomeOf.get(key) ?? 0, windowDays, h.value!);
    // A money market fund's own recent payouts mislead when its balance changed in the window;
    // its rate tracks T-bills closely.
    if (market !== null && market <= MAX_PLAUSIBLE_APY) {
      [apy, apySource] = [market, 'distributions'];
    } else if (isMoneyMarketFund(h) && treasuryApy !== null) {
      [apy, apySource] = [treasuryApy, 'assumed'];
    } else if (own !== null && own > 0) {
      [apy, apySource] = [own, 'distributions'];
    }
    positions.push({
      key,
      kind: sweep ? 'sweep' : 'fund',
      accountId: h.accountId,
      accountName: h.accountName,
      institutionName: account?.institutionName ?? null,
      accountSubtype: h.accountSubtype,
      ticker: sweep ? null : h.ticker,
      name: h.name,
      value: h.value! * share(h.accountId),
      apy,
      apySource,
      taxAdvantaged: h.taxTreatment === 'tax_deferred' || h.taxTreatment === 'tax_free',
    });
  }

  // Complete months only, from the first one with any spending.
  const complete = cashflow.slice(0, -1);
  const start = complete.findIndex((m) => m.spending > 0);
  const spendingMonths = start === -1 ? [] : complete.slice(start).map((m) => m.spending);

  const cardDebt = accountList
    .filter((a) => a.type === 'credit')
    .reduce((s, a) => s + Math.max(0, ownedBalance(a)), 0);

  return buildCashPlan({ today, settings, positions, treasuryApy, spendingMonths, cardDebt: round2(cardDebt) });
}
