import {
  EMPTY_TAX_SETTINGS,
  federalTables,
  taxTreatment,
  TaxSettings,
  type HarvestCandidate,
  type TaxPlan,
} from '@meld/shared';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, holdings, investmentTransactions, securities, taxSettings, transactions } from '../db/schema';
import { localDate } from '../lib/networth';
import {
  buildChecklist,
  buildSuggestions,
  checklistWithoutEstimate,
  estimateTax,
  marginalRate,
  projectYear,
  qualifiedShare,
  replayPositions,
  type LotTransaction,
  type SuggestionContext,
  type TaxInputs,
} from '../lib/tax';
import { getRsuVestEventsForWashSale, getTaxYearEquity } from './equity';
import { shiftYears } from './overview';
import { daysBetween, EARNINGS, isCash } from './performance';
import { getProfile } from './profile';

export * from '../lib/tax';

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const EPS = 1e-6;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
// --- Loading -----------------------------------------------------------------------

const K401_SUBTYPES = new Set(['401k', '401a', '403b', '457b', 'thrift savings plan']);
const IRA_SUBTYPES = new Set(['ira', 'sep ira', 'simple ira', 'sarsep', 'keogh']);
const INVESTMENT_INCOME = ['dividend', 'qualified dividend', 'non-qualified dividend', 'short-term capital gain', 'long-term capital gain', 'interest'];
const PAYCHECK = ['INCOME_WAGES', 'INCOME_SALARY'];
const CONTRACTOR = ['INCOME_CONTRACTOR'];
const INTEREST = 'INCOME_INTEREST_EARNED';
/** A deposit bigger than a year's IRA limit is a rollover or transfer, not a contribution. */
const ROLLOVER_OVER = 10_000;

export async function getTaxSettings(db: Db, year: number): Promise<TaxSettings> {
  const row = await db.query.taxSettings.findFirst({ where: eq(taxSettings.year, year) });
  return TaxSettings.parse({ ...EMPTY_TAX_SETTINGS, ...(row?.settings ?? {}) });
}

/** Checklist ticks live beside the settings in the same row, apart from the TaxSettings schema. */
type StoredSettings = TaxSettings & { checklistDone?: string[] };

async function storedSettings(db: Db, year: number): Promise<StoredSettings | null> {
  const row = await db.query.taxSettings.findFirst({ where: eq(taxSettings.year, year) });
  return (row?.settings as StoredSettings | undefined) ?? null;
}

async function writeSettings(db: Db, year: number, settings: StoredSettings) {
  await db
    .insert(taxSettings)
    .values({ year, settings })
    .onConflictDoUpdate({ target: taxSettings.year, set: { settings, updatedAt: new Date() } });
}

export async function saveTaxSettings(db: Db, year: number, settings: TaxSettings): Promise<TaxSettings> {
  const existing = await storedSettings(db, year);
  await writeSettings(db, year, { ...settings, ...(existing?.checklistDone ? { checklistDone: existing.checklistDone } : {}) });
  return getTaxSettings(db, year);
}

export async function getChecklistDone(db: Db, year: number): Promise<string[]> {
  const done = (await storedSettings(db, year))?.checklistDone;
  return Array.isArray(done) ? done.filter((d) => typeof d === 'string') : [];
}

/** Ticks or unticks a checklist item for the year. */
export async function setChecklistDone(db: Db, year: number, id: string, done: boolean): Promise<string[]> {
  const existing = await storedSettings(db, year);
  const ids = new Set(Array.isArray(existing?.checklistDone) ? existing.checklistDone : []);
  if (done) ids.add(id);
  else ids.delete(id);
  const checklistDone = [...ids].sort();
  await writeSettings(db, year, { ...EMPTY_TAX_SETTINGS, ...(existing ?? {}), checklistDone });
  return checklistDone;
}

function elapsedShare(year: number, today: string): number {
  const now = Number(today.slice(0, 4));
  if (year < now) return 1;
  if (year > now) return 0;
  return clamp01((daysBetween(`${year - 1}-12-31`, today)) / daysBetween(`${year - 1}-12-31`, `${year}-12-31`));
}

export async function getTaxPlan(db: Db, year: number, today = localDate()): Promise<TaxPlan> {
  const elapsed = elapsedShare(year, today);
  const end = `${year}-12-31` < today ? `${year}-12-31` : today;
  const lastYearToDate = shiftYears(end, -1);
  const lastYearStart = `${year - 1}-01-01`;

  const [profile, settings, checklistDone, accountRows] = await Promise.all([
    getProfile(db),
    getTaxSettings(db, year),
    getChecklistDone(db, year),
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        subtype: accounts.subtype,
        balance: accounts.currentBalance,
        share: sql<number>`coalesce(${accounts.ownershipPercent}, 100)::float8 / 100`,
      })
      .from(accounts)
      .where(eq(accounts.hidden, false)),
  ]);
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const investmentIds = accountRows.filter((a) => a.type === 'investment').map((a) => a.id);
  const isTaxable = (id: string) => taxTreatment(accountById.get(id)?.subtype ?? null) === 'taxable';

  const [txnRows, holdingRows, bankRows, equity, rsuWashEvents] = await Promise.all([
    investmentIds.length
      ? db
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
          .where(and(inArray(investmentTransactions.accountId, investmentIds), lte(investmentTransactions.date, today)))
      : [],
    investmentIds.length
      ? db
          .select({
            accountId: holdings.accountId,
            securityId: holdings.securityId,
            quantity: holdings.quantity,
            price: holdings.institutionPrice,
            value: holdings.institutionValue,
            costBasis: holdings.costBasis,
            vestedValue: holdings.vestedValue,
          })
          .from(holdings)
          .where(inArray(holdings.accountId, investmentIds))
      : [],
    db
      .select({
        accountId: transactions.accountId,
        date: transactions.date,
        detailed: transactions.plaidCategoryDetailed,
        amount: transactions.amount,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          eq(accounts.hidden, false),
          eq(accounts.type, 'depository'),
          eq(transactions.pending, false),
          gte(transactions.date, lastYearStart),
          lte(transactions.date, end),
          inArray(transactions.plaidCategoryDetailed, [...PAYCHECK, ...CONTRACTOR, INTEREST]),
          // A transaction the user moved out of income doesn't count.
          or(isNull(transactions.category), eq(transactions.category, 'INCOME')),
        ),
      ),
    getTaxYearEquity(db, year, today, profile.state),
    getRsuVestEventsForWashSale(db, today),
  ]);

  const securityIds = [...new Set([...holdingRows.map((h) => h.securityId), ...txnRows.flatMap((t) => (t.securityId ? [t.securityId] : []))])];
  const securityRows = securityIds.length
    ? await db
        .select({ id: securities.id, ticker: securities.tickerSymbol, name: securities.name, type: securities.type, profile: securities.profile })
        .from(securities)
        .where(inArray(securities.id, securityIds))
    : [];
  const securityById = new Map(securityRows.map((s) => [s.id, s]));
  const share = (accountId: string) => accountById.get(accountId)?.share ?? 1;
  const inYear = (d: string) => d.startsWith(String(year)) && d <= end;
  const lastYear = (d: string) => d >= lastYearStart && d < `${year}-01-01`;
  const lastYearSoFar = (d: string) => d >= lastYearStart && d <= lastYearToDate;

  // Income in taxable accounts and bank interest: this year so far, last year to the same day, last year in all.
  const buckets = { interest: [0, 0, 0], ordinary: [0, 0, 0], qualified: [0, 0, 0], longTerm: [0, 0, 0] };
  const add = (bucket: number[], date: string, amount: number) => {
    if (inYear(date)) bucket[0]! += amount;
    if (lastYearSoFar(date)) bucket[1]! += amount;
    if (lastYear(date)) bucket[2]! += amount;
  };
  let hasLastYear = false;
  for (const t of txnRows) {
    if (lastYear(t.date)) hasLastYear = true;
    if (!isTaxable(t.accountId) || !INVESTMENT_INCOME.includes(t.subtype ?? '')) continue;
    const amount = -t.amount * share(t.accountId);
    const s = t.securityId ? securityById.get(t.securityId) : undefined;
    if (t.subtype === 'interest') add(buckets.interest, t.date, amount);
    else if (t.subtype === 'long-term capital gain') add(buckets.longTerm, t.date, amount);
    else if (t.subtype === 'qualified dividend') add(buckets.qualified, t.date, amount);
    else if (t.subtype === 'dividend') {
      const q = qualifiedShare(s?.type ?? null, s?.profile ?? null);
      add(buckets.qualified, t.date, amount * q);
      add(buckets.ordinary, t.date, amount * (1 - q));
    } else add(buckets.ordinary, t.date, amount);
  }
  let paychecks = 0;
  let contractorDeposits = 0;
  for (const r of bankRows) {
    const amount = -r.amount * share(r.accountId);
    if (r.detailed === INTEREST) {
      add(buckets.interest, r.date, amount);
      if (lastYear(r.date)) hasLastYear = true;
    } else if (inYear(r.date)) {
      if (PAYCHECK.includes(r.detailed ?? '')) paychecks += amount;
      else contractorDeposits += amount;
    }
  }
  const project = ([ytd, soFar, total]: number[]) => projectYear(ytd!, soFar!, total!, elapsed, hasLastYear);

  // Realized gains in taxable accounts, by average cost.
  const taxableTxns: LotTransaction[] = txnRows.flatMap((t) => {
    const s = t.securityId ? securityById.get(t.securityId) : undefined;
    return isTaxable(t.accountId) && s && !isCash(s) ? [{ ...t, securityId: s.id }] : [];
  });
  const taxableHoldings = holdingRows.filter((h) => isTaxable(h.accountId) && !isCash(securityById.get(h.securityId)));
  const replays = replayPositions(taxableTxns, taxableHoldings);
  let realizedShort = 0;
  let realizedLong = 0;
  let sales = 0;
  let realizedRough = false;
  for (const r of replays) {
    const yearSales = r.sales.filter((s) => inYear(s.date));
    if (!yearSales.length) continue;
    // A fund that only ever trades at $1 has no gains to speak of.
    if (yearSales.every((s) => Math.abs(s.proceeds - s.cost) < 0.01)) continue;
    sales += yearSales.length;
    realizedRough ||= r.rough;
    for (const s of yearSales) {
      realizedShort += s.shortTerm * share(r.accountId);
      realizedLong += s.longTerm * share(r.accountId);
    }
  }

  // Contributions so far this year, by kind of account.
  let k401Contributions = 0;
  let hsaContributions = 0;
  let iraContributions = 0;
  let rothContributions = 0;
  for (const t of txnRows) {
    if (!inYear(t.date) || t.type !== 'cash' || t.amount >= 0) continue;
    const contribution = t.subtype === 'contribution' || (t.subtype === 'deposit' && !EARNINGS.test(t.name));
    if (!contribution) continue;
    const amount = -t.amount * share(t.accountId);
    const subtype = accountById.get(t.accountId)?.subtype?.toLowerCase() ?? '';
    if (K401_SUBTYPES.has(subtype)) k401Contributions += amount;
    else if (subtype === 'hsa') hsaContributions += amount;
    else if (amount <= ROLLOVER_OVER && IRA_SUBTYPES.has(subtype)) iraContributions += amount;
    else if (amount <= ROLLOVER_OVER && subtype === 'roth') rothContributions += amount;
  }
  const subtypes = accountRows.map((a) => ({ ...a, subtype: a.subtype?.toLowerCase() ?? '' }));
  const traditionalIraBalance = subtypes
    .filter((a) => a.subtype === 'ira' || a.subtype === 'sep ira' || a.subtype === 'simple ira')
    .reduce((s, a) => s + (a.balance ?? 0) * a.share, 0);

  // Taxable holdings worth less than they cost.
  const recentBuys = new Map<string, string>();
  for (const t of txnRows) {
    if (t.type !== 'buy' || !t.securityId || daysBetween(t.date, today) > 30) continue;
    const latest = recentBuys.get(t.securityId);
    if (!latest || t.date > latest) recentBuys.set(t.securityId, t.date);
  }
  const rsuRecentVestByTicker = new Map<string, string>();
  const rsuUpcomingVestByTicker = new Map<string, string>();
  for (const ev of rsuWashEvents) {
    if (ev.kind === 'rsu_past') {
      const prev = rsuRecentVestByTicker.get(ev.ticker);
      if (!prev || ev.date > prev) rsuRecentVestByTicker.set(ev.ticker, ev.date);
    } else {
      const prev = rsuUpcomingVestByTicker.get(ev.ticker);
      if (!prev || ev.date < prev) rsuUpcomingVestByTicker.set(ev.ticker, ev.date);
    }
  }
  const rsuZeroBasisTickers = [
    ...new Set(
      taxableHoldings.flatMap((h) => {
        const s = securityById.get(h.securityId);
        const ticker = s?.ticker?.trim().toUpperCase();
        if (!ticker || !equity.tickers.has(ticker)) return [];
        const acctSubtype = accountById.get(h.accountId)?.subtype?.toLowerCase();
        if (h.vestedValue === 0 && acctSubtype === 'stock plan') return [];
        const val = h.vestedValue ?? h.value ?? 0;
        return val > 0 && (h.costBasis === null || h.costBasis <= 0) ? [ticker] : [];
      }),
    ),
  ].sort();

  const lotsByKey = new Map(replays.map((r) => [`${r.accountId}|${r.securityId}`, r.lots]));
  const yearAgo = shiftYears(today, -1);
  const harvest: HarvestCandidate[] = taxableHoldings
    .filter((h) => h.value !== null && h.costBasis !== null && h.costBasis > 0)
    .map((h) => {
      const s = securityById.get(h.securityId);
      const tickerUpper = s?.ticker?.trim().toUpperCase() ?? null;
      const lots = lotsByKey.get(`${h.accountId}|${h.securityId}`) ?? [];
      const held = lots.reduce((sum, l) => sum + l.qty, 0);
      const recent = lots.filter((l) => l.date !== null && l.date > yearAgo).reduce((sum, l) => sum + l.qty, 0);
      const k = share(h.accountId);
      return {
        accountName: accountById.get(h.accountId)?.name ?? 'Account',
        ticker: s?.ticker ?? null,
        name: s?.name ?? null,
        value: round2(h.value! * k),
        costBasis: round2(h.costBasis! * k),
        gain: round2((h.value! - h.costBasis!) * k),
        shortTermShare: held > EPS ? round2(recent / held) : 0,
        recentPurchase: recentBuys.get(h.securityId) ?? null,
        recentVest: tickerUpper ? (rsuRecentVestByTicker.get(tickerUpper) ?? null) : null,
        upcomingVest: tickerUpper ? (rsuUpcomingVestByTicker.get(tickerUpper) ?? null) : null,
      };
    })
    .sort((a, b) => a.gain - b.gain);

  const detected: TaxPlan['detected'] = {
    paychecks: round2(paychecks),
    contractorDeposits: round2(contractorDeposits),
    interest: round2(buckets.interest[0]!),
    ordinaryDividends: round2(buckets.ordinary[0]!),
    qualifiedDividends: round2(buckets.qualified[0]!),
    capitalGainDistributions: round2(buckets.longTerm[0]!),
    realizedShortTerm: round2(realizedShort),
    realizedLongTerm: round2(realizedLong),
    realizedRough,
    sales,
    k401Contributions: round2(k401Contributions),
    k401Accounts: subtypes.filter((a) => K401_SUBTYPES.has(a.subtype)).length,
    hsaContributions: round2(hsaContributions),
    hsaAccount: subtypes.some((a) => a.subtype === 'hsa'),
    iraContributions: round2(iraContributions),
    rothContributions: round2(rothContributions),
    traditionalIraBalance: round2(traditionalIraBalance),
    has529: subtypes.some((a) => a.subtype === '529'),
    rsuVestedYtd: equity.vestedYtd,
    rsuScheduledRemaining: equity.scheduledRemaining,
    rsuWithheldYtd: equity.withheldIncomeTaxYtd,
    rsuProjectedWithholdingRemaining: equity.projectedIncomeTaxWithholdingRemaining,
    rsuWithholdingGap: 0,
    rsuZeroBasisTickers,
  };

  const missing: TaxPlan['missing'] = [];
  if (!profile.filingStatus) missing.push('filingStatus');
  if (profile.annualGrossIncome === null) missing.push('income');
  const fed = federalTables(year);
  const plan: TaxPlan = {
    year,
    asOf: today,
    elapsed: round2(elapsed),
    federalTablesYear: fed.year === year ? null : fed.year,
    filingStatus: profile.filingStatus,
    missing,
    settings,
    detected,
    income: null,
    federal: null,
    state: null,
    totalTax: null,
    effectiveRate: null,
    marginalRate: null,
    balanceDue: null,
    harvest: harvest.filter((h) => h.gain < 0),
    suggestions: [],
    checklist: [],
    notes: [],
  };
  const ageAtYearEnd = profile.birthYear ? year - profile.birthYear : null;
  if (!profile.filingStatus || profile.annualGrossIncome === null) {
    return {
      ...plan,
      checklist: checklistWithoutEstimate(year, today, ageAtYearEnd, detected.traditionalIraBalance, profile.employerBenefits, new Set(checklistDone)),
    };
  }

  const k401Projected = Math.min(
    elapsed > 0 ? k401Contributions / elapsed : 0,
    fed.limits.k401 * Math.max(1, detected.k401Accounts) + fed.limits.k401CatchUp60to63,
  );
  const rsuTotal = round2(equity.vestedYtd + equity.scheduledRemaining);
  const inputs: TaxInputs = {
    year,
    filingStatus: profile.filingStatus,
    state: profile.state,
    childrenUnder17: profile.children.filter((c) => year - c.birthYear < 17).length,
    dependents: profile.dependents ?? profile.children.length,
    grossIncome: profile.annualGrossIncome,
    rsuVesting: rsuTotal,
    profileIncludesRsus: settings.profileIncludesRsus,
    selfEmployment: settings.selfEmploymentIncome ?? 0,
    otherIncome: settings.otherIncome ?? 0,
    pretax401k: settings.pretax401k ?? k401Projected,
    hsa: settings.hsaContributions ?? hsaContributions,
    iraDeduction: 0,
    selfEmployedRetirement: 0,
    interest: project(buckets.interest),
    ordinaryDividends: project(buckets.ordinary),
    qualifiedDividends: project(buckets.qualified),
    shortTermGains: (settings.realizedGainsOverride?.shortTerm ?? realizedShort),
    longTermGains: (settings.realizedGainsOverride?.longTerm ?? realizedLong) + project(buckets.longTerm),
    propertyTax: settings.propertyTax ?? 0,
    otherItemized: settings.otherItemized ?? 0,
    stateFlatRate: settings.stateFlatRate,
  };
  const base = estimateTax(inputs);
  const marginal = marginalRate(inputs, base);

  if (rsuTotal > 0) {
    const taxWithoutRsus = estimateTax({
      ...inputs,
      grossIncome: settings.profileIncludesRsus ? Math.max(0, inputs.grossIncome - rsuTotal) : inputs.grossIncome,
      rsuVesting: 0,
      profileIncludesRsus: false,
    }).total;
    const rsuTaxOwed = Math.max(0, base.total - taxWithoutRsus);
    const rsuWithheldTotal = equity.withheldIncomeTaxYtd + equity.projectedIncomeTaxWithholdingRemaining;
    detected.rsuWithholdingGap = round2(Math.max(0, rsuTaxOwed - rsuWithheldTotal));
  }

  // Withholding so far, carried to year-end at the same pace (adjusting for lumpy RSU vests); estimated payments as entered.
  const withheld = settings.federalWithheld === null && settings.stateWithheld === null
    ? null
    : rsuTotal > 0 && elapsed < 1
      ? (() => {
          const enteredYtd = (settings.federalWithheld ?? 0) + (settings.stateWithheld ?? 0);
          const steadyYtd = Math.max(0, enteredYtd - equity.withheldIncomeTaxYtd);
          return steadyYtd / Math.max(elapsed, 0.01) + equity.withheldIncomeTaxYtd + equity.projectedIncomeTaxWithholdingRemaining;
        })()
      : ((settings.federalWithheld ?? 0) + (settings.stateWithheld ?? 0)) / Math.max(elapsed, 0.01);
  const balanceDue =
    withheld === null ? null : round2(base.total - withheld - (settings.federalEstimatedPayments ?? 0) - (settings.stateEstimatedPayments ?? 0));

  const notes: string[] = [];
  if (fed.year !== year) notes.push(`Federal figures use ${fed.year} brackets and limits; Meld doesn't have ${year}'s yet.`);
  if (base.state?.tablesYear) notes.push(`${base.state.state} figures use ${base.state.tablesYear} brackets; ${year}'s haven't been published.`);
  if (!profile.state) notes.push('Add your state to your profile to include state tax.');
  else if (!base.state) notes.push(`Meld has no tables for ${profile.state}; enter an effective state rate in Tax inputs to include it.`);
  if (rsuTotal > 0) {
    notes.push(
      settings.profileIncludesRsus
        ? `RSU vesting (${money(rsuTotal)}) is carved out of your Profile gross income rather than added on top.`
        : `RSU vesting (${money(rsuTotal)}) is added on top of your Profile gross income. If your Profile figure already includes RSUs, toggle that in Tax inputs.`,
    );
  }
  if (elapsed < 1) notes.push('Dividends, interest and fund distributions are this year so far plus what came in over the rest of last year.');
  if (!settings.realizedGainsOverride && sales) {
    notes.push(
      `Realized gains are rebuilt from ${sales} sale${sales === 1 ? '' : 's'} using average cost${
        realizedRough ? ', and some transactions didn’t add up, so treat them as rough' : ''
      }. Your broker may use specific lots; enter their figures in Tax inputs to replace Meld's.`,
    );
  }
  if (settings.pretax401k === null && k401Contributions > 0) {
    notes.push('401(k) deferrals are projected from contributions reported so far, which may include employer money.');
  }
  if (inputs.selfEmployment > 0) notes.push('Self-employment tax assumes the earner has no other wages above the Social Security limit.');

  const suggestionContext: SuggestionContext = {
    inputs,
    base,
    marginal,
    settings,
    detected,
    harvest: plan.harvest,
    age: ageAtYearEnd,
    balanceDue,
  };
  const suggestions = buildSuggestions(suggestionContext);
  return {
    ...plan,
    income: base.income,
    federal: base.federal,
    state: base.state,
    totalTax: base.total,
    effectiveRate: round2(base.effectiveRate * 10_000) / 10_000,
    marginalRate: round2(marginal * 10_000) / 10_000,
    balanceDue,
    suggestions,
    checklist: buildChecklist({
      ...suggestionContext,
      suggestions,
      today,
      done: new Set(checklistDone),
      employerBenefits: profile.employerBenefits,
    }),
    notes,
  };
}

