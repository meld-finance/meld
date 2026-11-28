/**
 * Pure tax calculations, lot replay, tax-saving suggestions, and year-end checklist builders.
 *
 * Sections:
 *   - Estimating the tax (`estimateTax`, `marginalRate`)
 *   - Realized gains (`replayPositions`)
 *   - Investment income (`qualifiedShare`, `projectYear`)
 *   - Suggestions (`buildSuggestions`)
 *   - Year-end checklist (`buildChecklist`, `checklistWithoutEstimate`, `paychecksLeft`)
 */
import {
  bracketAt,
  bracketTax,
  calculateRmd,
  calculateStateTax,
  federalTables,
  NO_INCOME_TAX_STATES,
  rmdStartAge,
  stateName,
  stateTables,
  tableStatus,
  type BracketSlice,
  type ChecklistItem,
  type FederalTax,
  type FilingStatus,
  type HarvestCandidate,
  type SecurityProfile,
  type StateTax,
  type TaxIncome,
  type TaxPlan,
  type TaxSettings,
  type TaxSuggestion,
} from '@meld/shared';
import { daysBetween } from '../services/performance';

const round2 = (n: number) => Math.round(n * 100) / 100;
const round = (n: number) => Math.round(n);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const EPS = 1e-6;

// --- Estimating the tax ------------------------------------------------------------

/** Everything the estimate runs on, for the full year. */
export type TaxInputs = {
  year: number;
  filingStatus: FilingStatus;
  /** Two-letter code, or null when unknown. */
  state: string | null;
  childrenUnder17: number;
  dependents: number;
  /** Household gross income, self-employment included. */
  grossIncome: number;
  /** Ordinary W-2 income from RSU vests (vested YTD + remaining scheduled). */
  rsuVesting?: number;
  /** True when `grossIncome` already includes `rsuVesting`. */
  profileIncludesRsus?: boolean;
  selfEmployment: number;
  otherIncome: number;
  pretax401k: number;
  hsa: number;
  /** Deductible traditional IRA contributions. */
  iraDeduction: number;
  /** Self-employed retirement contributions (SEP IRA, solo 401(k) employer part). */
  selfEmployedRetirement: number;
  interest: number;
  ordinaryDividends: number;
  qualifiedDividends: number;
  /** Realized gains plus capital gain distributions, before netting. */
  shortTermGains: number;
  longTermGains: number;
  propertyTax: number;
  otherItemized: number;
  /** Percent, for states without tables. */
  stateFlatRate: number | null;
};

export type TaxEstimate = {
  income: TaxIncome;
  federal: FederalTax;
  state: StateTax | null;
  total: number;
  effectiveRate: number;
  /** Federal itemized deductions as Meld sees them (SALT after the cap), against the standard deduction. */
  deductions: { itemized: number; standard: number };
};

/** Nets short- against long-term, and caps a net loss at what can offset ordinary income. */
function netCapital(st: number, lt: number, lossLimit: number) {
  if (st < 0 && lt > 0) {
    const m = Math.min(-st, lt);
    st += m;
    lt -= m;
  } else if (lt < 0 && st > 0) {
    const m = Math.min(-lt, st);
    lt += m;
    st -= m;
  }
  const loss = Math.min(0, st) + Math.min(0, lt);
  return { st, lt, preferential: Math.max(0, lt), ordinary: Math.max(0, st) + Math.max(loss, -lossLimit) };
}

function stateTax(inputs: TaxInputs, federalAgi: number): StateTax | null {
  if (!inputs.state) return null;
  const state = inputs.state.trim().toUpperCase();
  const { year } = inputs;
  const status = tableStatus(inputs.filingStatus);
  if (inputs.stateFlatRate !== null) {
    const rate = inputs.stateFlatRate / 100;
    const taxable = Math.max(0, federalAgi);
    return { state, method: 'flat', tablesYear: null, taxableIncome: round2(taxable), total: round2(taxable * rate), bracketRate: rate };
  }
  if (NO_INCOME_TAX_STATES.has(state)) {
    return { state, method: 'none', tablesYear: null, taxableIncome: 0, total: 0, bracketRate: 0 };
  }
  const t = stateTables(state, year);
  if (!t) return null;
  const res = calculateStateTax({
    table: t,
    year,
    status,
    federalAgi,
    hsa: inputs.hsa,
    itemizedNonSalt: inputs.propertyTax + inputs.otherItemized,
    dependents: inputs.dependents,
  });
  return {
    state,
    method: 'tables',
    tablesYear: t.year === year ? null : t.year,
    taxableIncome: round2(res.taxableIncome),
    total: round2(res.total),
    bracketRate: res.bracketRate,
  };
}

/** Federal and state income tax for a full year. */
export function estimateTax(inputs: TaxInputs): TaxEstimate {
  const t = federalTables(inputs.year);
  const status = tableStatus(inputs.filingStatus);
  const rsuVesting = inputs.rsuVesting ?? 0;
  const profileIncludesRsus = inputs.profileIncludesRsus ?? false;
  const totalGross = profileIncludesRsus ? inputs.grossIncome : inputs.grossIncome + rsuVesting;
  const cashGross = profileIncludesRsus ? Math.max(0, inputs.grossIncome - rsuVesting) : inputs.grossIncome;
  const wages = Math.max(0, cashGross - inputs.selfEmployment - inputs.pretax401k);

  // Self-employment tax on 92.35% of profit; half of it comes off income.
  const seEarnings = inputs.selfEmployment * 0.9235;
  const selfEmploymentTax = seEarnings >= 400 ? 0.124 * Math.min(seEarnings, t.socialSecurityWageBase) + 0.029 * seEarnings : 0;

  const capital = netCapital(inputs.shortTermGains, inputs.longTermGains, status === 'married_separate' ? 1_500 : 3_000);
  const agi =
    wages +
    rsuVesting +
    inputs.selfEmployment -
    selfEmploymentTax / 2 -
    inputs.selfEmployedRetirement +
    inputs.interest +
    inputs.ordinaryDividends +
    inputs.qualifiedDividends +
    capital.ordinary +
    capital.preferential +
    inputs.otherIncome -
    inputs.hsa -
    inputs.iraDeduction;

  const state = stateTax(inputs, agi);
  const salt = t.salt[status];
  const saltCap = Math.max(salt.floor, salt.cap - 0.3 * Math.max(0, agi - salt.phaseDownFrom));
  const itemized = Math.min(saltCap, (state?.total ?? 0) + inputs.propertyTax) + inputs.otherItemized;
  const standard = t.standardDeduction[status];
  const deduction = Math.max(standard, itemized);
  const taxableIncome = Math.max(0, agi - deduction);

  // Long-term gains and qualified dividends stack on top of ordinary income at 0/15/20%.
  const preferential = Math.min(taxableIncome, capital.preferential + inputs.qualifiedDividends);
  const ordinaryIncome = taxableIncome - preferential;
  const ordinaryTax = bracketTax(t.brackets[status], ordinaryIncome);
  const cg = t.capitalGains[status];
  const atZero = Math.min(preferential, Math.max(0, cg.zeroUpTo - ordinaryIncome));
  const atFifteen = Math.min(preferential - atZero, Math.max(0, cg.fifteenUpTo - Math.max(ordinaryIncome, cg.zeroUpTo)));
  const capitalGainsTax = 0.15 * atFifteen + 0.2 * (preferential - atZero - atFifteen);

  const investmentIncome =
    inputs.interest + inputs.ordinaryDividends + inputs.qualifiedDividends + Math.max(0, capital.st + capital.lt);
  const netInvestmentIncomeTax = 0.038 * Math.min(investmentIncome, Math.max(0, agi - t.niitThreshold[status]));
  const medicareWages = Math.max(0, totalGross - inputs.selfEmployment);
  const additionalMedicareTax = 0.009 * Math.max(0, medicareWages + seEarnings - t.additionalMedicareThreshold[status]);

  const ctc = t.childTaxCredit;
  const ctcPhaseOut = Math.ceil(Math.max(0, agi - ctc.phaseOutFrom[status]) / 1_000) * 50;
  const childTaxCredit = Math.min(ordinaryTax + capitalGainsTax, Math.max(0, inputs.childrenUnder17 * ctc.perChild - ctcPhaseOut));

  const total = ordinaryTax + capitalGainsTax - childTaxCredit + netInvestmentIncomeTax + additionalMedicareTax + selfEmploymentTax;
  const bracket = bracketAt(t.brackets[status], ordinaryIncome);
  let from = 0;
  const brackets: BracketSlice[] = t.brackets[status].map(({ rate, upTo }) => {
    const slice = { rate, from, upTo, taxed: round2(Math.max(0, Math.min(ordinaryIncome, upTo ?? Infinity) - from)) };
    from = upTo ?? Infinity;
    return slice;
  });

  const federal: FederalTax = {
    agi: round2(agi),
    deduction: round2(deduction),
    itemized: itemized > standard,
    taxableIncome: round2(taxableIncome),
    ordinaryIncome: round2(ordinaryIncome),
    ordinaryTax: round2(ordinaryTax),
    capitalGainsTax: round2(capitalGainsTax),
    netInvestmentIncomeTax: round2(netInvestmentIncomeTax),
    additionalMedicareTax: round2(additionalMedicareTax),
    selfEmploymentTax: round2(selfEmploymentTax),
    childTaxCredit: round2(childTaxCredit),
    total: round2(total),
    bracketRate: bracket.rate,
    bracketRoom: bracket.upTo === null ? null : round2(bracket.upTo - ordinaryIncome),
    brackets,
    zeroRateGainRoom: round2(Math.max(0, cg.zeroUpTo - taxableIncome)),
  };
  const income: TaxIncome = {
    wages: round2(wages),
    rsuVesting: round2(rsuVesting),
    selfEmployment: round2(inputs.selfEmployment),
    interest: round2(inputs.interest),
    ordinaryDividends: round2(inputs.ordinaryDividends),
    qualifiedDividends: round2(inputs.qualifiedDividends),
    shortTermGains: round2(capital.st),
    longTermGains: round2(capital.lt),
    other: round2(inputs.otherIncome),
    pretax401k: round2(inputs.pretax401k),
    hsa: round2(inputs.hsa),
  };
  const grandTotal = total + (state?.total ?? 0);
  const gross =
    totalGross +
    inputs.interest +
    inputs.ordinaryDividends +
    inputs.qualifiedDividends +
    Math.max(0, capital.st + capital.lt) +
    inputs.otherIncome;
  return {
    income,
    federal,
    state,
    total: round2(grandTotal),
    effectiveRate: gross > 0 ? grandTotal / gross : 0,
    deductions: { itemized: round2(itemized), standard },
  };
}

/** Federal and state tax on the next $1,000 of ordinary income. */
export function marginalRate(inputs: TaxInputs, base = estimateTax(inputs)): number {
  return (estimateTax({ ...inputs, otherIncome: inputs.otherIncome + 1_000 }).total - base.total) / 1_000;
}

// --- Realized gains ----------------------------------------------------------------

export type LotTransaction = {
  accountId: string;
  securityId: string;
  date: string;
  /** buy, sell or transfer; anything else doesn't move shares. */
  type: string;
  /** Signed: positive adds shares. */
  quantity: number;
  price: number;
  /** Plaid's sign: positive is cash out (a buy), negative cash in (a sale). */
  amount: number;
};
export type LotHolding = { accountId: string; securityId: string; quantity: number; costBasis: number | null; price: number | null };

/** Shares bought on `date`; null for shares already held when the history starts. */
type Lot = { date: string | null; qty: number };
export type Sale = { accountId: string; securityId: string; date: string; proceeds: number; cost: number; shortTerm: number; longTerm: number };
export type PositionReplay = {
  accountId: string;
  securityId: string;
  sales: Sale[];
  /** What's still held, oldest first. */
  lots: Lot[];
  /** The transactions didn't add up to today's holding, or the starting cost had to be guessed. */
  rough: boolean;
};

const SHARE_MOVES = new Set(['buy', 'sell', 'transfer']);
const isLongTerm = (bought: string | null, sold: string) => bought === null || daysBetween(bought, sold) > 365;

/** Average-cost replay of one position from `startQty` shares costing `startCost` in all. */
function runPosition(txns: LotTransaction[], startQty: number, startCost: number, priceOn: (date: string) => number) {
  let qty = startQty;
  let cost = startCost;
  let rough = false;
  const lots: Lot[] = startQty > EPS ? [{ date: null, qty: startQty }] : [];
  const sales: Omit<Sale, 'accountId' | 'securityId'>[] = [];
  for (const t of txns) {
    if (t.quantity > 0) {
      const added = t.quantity;
      // Shares that arrive without a price (vesting, transfers in) cost what they were worth that day.
      cost += Math.abs(t.amount) || added * (t.price || priceOn(t.date));
      qty += added;
      lots.push({ date: t.date, qty: added });
      continue;
    }
    const wanted = -t.quantity;
    if (wanted > qty + EPS) rough = true;
    const removed = Math.min(wanted, qty);
    if (removed <= EPS) continue;
    const removedCost = (cost * removed) / qty;
    let shortQty = 0;
    for (let left = removed; left > EPS && lots.length; ) {
      const lot = lots[0]!;
      const take = Math.min(lot.qty, left);
      if (!isLongTerm(lot.date, t.date)) shortQty += take;
      lot.qty -= take;
      left -= take;
      if (lot.qty <= EPS) lots.shift();
    }
    if (t.type === 'sell') {
      const proceeds = (Math.abs(t.amount) || wanted * t.price) * (removed / wanted);
      const gain = proceeds - removedCost;
      const shortTerm = (gain * shortQty) / removed;
      sales.push({ date: t.date, proceeds, cost: removedCost, shortTerm, longTerm: gain - shortTerm });
    }
    qty -= removed;
    cost -= removedCost;
  }
  return { sales, lots, finalCost: cost, rough };
}

/**
 * Rebuilds realized gains with average cost, since Plaid reports one cost basis per holding and no
 * lots. Working back from today's quantity gives the shares held when the history starts; their cost
 * is whatever makes the replay end at today's reported cost basis. Holding periods follow the shares
 * in order bought.
 */
export function replayPositions(txns: LotTransaction[], positions: LotHolding[]): PositionReplay[] {
  const byPosition = new Map<string, LotTransaction[]>();
  const key = (accountId: string, securityId: string) => `${accountId}|${securityId}`;
  for (const t of txns) {
    if (!SHARE_MOVES.has(t.type) || !t.quantity) continue;
    const k = key(t.accountId, t.securityId);
    byPosition.set(k, [...(byPosition.get(k) ?? []), t]);
  }
  const holdingByKey = new Map(positions.map((h) => [key(h.accountId, h.securityId), h]));
  const keys = new Set([...byPosition.keys(), ...holdingByKey.keys()]);

  // Any day's price for a security, from its nearest trade in any account.
  const pricesBySecurity = new Map<string, [string, number][]>();
  for (const t of txns) {
    const price = t.price > 0 ? t.price : t.quantity && t.amount ? Math.abs(t.amount / t.quantity) : 0;
    if (price) pricesBySecurity.set(t.securityId, [...(pricesBySecurity.get(t.securityId) ?? []), [t.date, price]]);
  }

  return [...keys].map((k) => {
    const [accountId, securityId] = k.split('|') as [string, string];
    const list = (byPosition.get(k) ?? []).sort((a, b) => a.date.localeCompare(b.date) || b.quantity - a.quantity);
    const holding = holdingByKey.get(k);
    const known = pricesBySecurity.get(securityId) ?? [];
    const priceOn = (date: string) => {
      let best: [string, number] | undefined;
      for (const p of known) if (!best || Math.abs(daysBetween(p[0], date)) < Math.abs(daysBetween(best[0], date))) best = p;
      return best?.[1] ?? holding?.price ?? 0;
    };

    const qtyNow = holding?.quantity ?? 0;
    let startQty = qtyNow - list.reduce((sum, t) => sum + t.quantity, 0);
    let rough = false;
    if (startQty < -EPS) rough = true;
    startQty = Math.max(0, startQty);

    let startCost = 0;
    if (startQty > EPS) {
      const costNow = holding ? holding.costBasis : 0;
      // The replay is linear in the starting cost: run it at 0 and 1 to solve for today's cost basis.
      const atZero = runPosition(list, startQty, 0, priceOn).finalCost;
      const slope = runPosition(list, startQty, 1, priceOn).finalCost - atZero;
      if (costNow !== null && slope > EPS && costNow >= atZero) {
        startCost = (costNow - atZero) / slope;
      } else {
        // Every starting share was sold, or there's no cost basis: price them at the first known price.
        startCost = startQty * priceOn(list[0]?.date ?? '9999-12-31');
        rough ||= list.some((t) => t.type === 'sell');
      }
    }
    const run = runPosition(list, startQty, startCost, priceOn);
    return {
      accountId,
      securityId,
      sales: run.sales.map((s) => ({ accountId, securityId, ...s })),
      lots: run.lots,
      rough: rough || run.rough,
    };
  });
}

// --- Investment income -------------------------------------------------------------

/** Share of a security's dividends that are qualified: what it holds in stocks, apart from REITs. */
export function qualifiedShare(type: string | null, profile: SecurityProfile | null): number {
  if (profile && Object.keys(profile.assetClasses).length) {
    const stocks = (profile.assetClasses.us_stocks ?? 0) + (profile.assetClasses.intl_stocks ?? 0);
    return clamp01(stocks * (1 - (profile.sectors.real_estate ?? 0)));
  }
  if (type === 'fixed income' || type === 'cash') return 0;
  if (type === 'equity') return 1;
  return 0.9;
}

/**
 * A full-year figure from the year so far: what's in, plus what came in over the rest of last year
 * (so December fund distributions count), or straight-line when there's no last year to go by.
 */
export function projectYear(ytd: number, lastYearToDate: number, lastYearTotal: number, elapsed: number, hasLastYear: boolean): number {
  if (elapsed >= 1) return ytd;
  if (hasLastYear) return ytd + Math.max(0, lastYearTotal - lastYearToDate);
  return elapsed > 0 ? ytd / elapsed : ytd;
}

// --- Suggestions -------------------------------------------------------------------

export type SuggestionContext = {
  inputs: TaxInputs;
  base: TaxEstimate;
  marginal: number;
  settings: TaxSettings;
  detected: TaxPlan['detected'];
  harvest: HarvestCandidate[];
  /** Age at the end of the tax year, when known. */
  age: number | null;
  /** Owner's birth year, for SECURE 2.0 RMD starting age (73 vs 75). */
  birthYear?: number | null;
  balanceDue: number | null;
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** Employee 401(k)/403(b)/TSP room left this year (pre-tax + Roth share one cap per person, plus catch-up). */
function k401Headroom({ inputs, detected, age }: SuggestionContext) {
  const t = federalTables(inputs.year);
  const joint = tableStatus(inputs.filingStatus) === 'married_joint';
  const people = Math.max(1, Math.min(joint ? 2 : 1, detected.k401Accounts));
  const catchUp = age === null ? 0 : age >= 60 && age <= 63 ? t.limits.k401CatchUp60to63 : age >= 50 ? t.limits.k401CatchUp : 0;
  const limit = t.limits.k401 * people + catchUp;
  const used = inputs.pretax401k + (detected.roth401kContributions ?? 0);
  return { people, catchUp, limit, used, room: Math.max(0, limit - used) };
}

/** Governmental 457(b) room left this year: separate deferral cap that stacks on top of 401(k)/403(b). */
function k457bHeadroom({ inputs, detected, age }: SuggestionContext) {
  const t = federalTables(inputs.year);
  const joint = tableStatus(inputs.filingStatus) === 'married_joint';
  const people = Math.max(1, Math.min(joint ? 2 : 1, detected.k457bAccounts ?? 0));
  const catchUp = age === null ? 0 : age >= 60 && age <= 63 ? t.limits.k401CatchUp60to63 : age >= 50 ? t.limits.k401CatchUp : 0;
  const limit = t.limits.k401 * people + catchUp;
  const used = detected.k457bContributions ?? 0;
  return { people, catchUp, limit, used, room: Math.max(0, limit - used) };
}

export function buildSuggestions(ctx: SuggestionContext): TaxSuggestion[] {
  const { inputs, base, settings, detected, age } = ctx;
  const t = federalTables(inputs.year);
  const status = tableStatus(inputs.filingStatus);
  const joint = status === 'married_joint';
  const saved = (change: Partial<TaxInputs>) => round(base.total - estimateTax({ ...inputs, ...change }).total);
  const out: TaxSuggestion[] = [];

  if (ctx.balanceDue !== null && ctx.balanceDue > 1_000) {
    out.push({
      id: 'underpayment',
      kind: 'warning',
      title: `On track to owe about ${money(ctx.balanceDue)}`,
      detail: `Projected tax is more than your withholding and estimated payments will cover. Owing $1,000 or more can bring an underpayment penalty unless you've paid at least 100% of last year's tax (110% if last year's AGI was over $150,000). A bigger withholding from a late-year paycheck counts as if it were paid evenly through the year.`,
      impact: null,
      question: `I'm projected to owe about ${money(ctx.balanceDue)} for ${inputs.year}. How do I avoid an underpayment penalty?`,
    });
  }

  if (detected.rsuWithholdingGap > 500) {
    const rsuIncome = detected.rsuVestedYtd + detected.rsuScheduledRemaining;
    const rsuWithheld = detected.rsuWithheldYtd + detected.rsuProjectedWithholdingRemaining;
    out.push({
      id: 'rsu-withholding-gap',
      kind: 'warning',
      title: `RSU withholding gap: about ${money(detected.rsuWithholdingGap)}`,
      detail: `Your ${inputs.year} RSU vests add about ${money(rsuIncome)} of W-2 income, while supplemental withholding covers only about ${money(rsuWithheld)} of the ${money(rsuWithheld + detected.rsuWithholdingGap)} tax they add at your marginal rate. Raise your RSU withholding election if your plan allows it, add extra W-4 paycheck withholding, or plan an estimated payment.`,
      impact: null,
      question: `My ${inputs.year} RSU vests leave an estimated ${money(detected.rsuWithholdingGap)} tax withholding gap. How should I cover it?`,
    });
  }

  if (detected.rsuZeroBasisTickers.length > 0) {
    const tickers = detected.rsuZeroBasisTickers.join(', ');
    out.push({
      id: 'rsu-cost-basis',
      kind: 'info',
      title: `Check RSU cost basis on ${tickers}`,
      detail: `Your taxable ${tickers} holding shows $0 or missing cost basis. Brokers often report $0 basis on RSU shares until adjusted from vest-date fair market value on Form 8949 — selling without checking can tax your vest income twice.`,
      impact: null,
      question: `My taxable ${tickers} holding shows $0 or missing cost basis. How do I avoid double-taxation on RSU sales?`,
    });
  }

  const losses = ctx.harvest.filter((h) => h.gain < 0);
  if (losses.length) {
    const isWashed = (h: HarvestCandidate) => Boolean(h.recentPurchase || h.recentVest || h.upcomingVest);
    const clean = losses.filter((h) => !isWashed(h));
    const pool = clean.length ? clean : losses;
    const shortLoss = pool.reduce((s, h) => s + h.gain * h.shortTermShare, 0);
    const longLoss = pool.reduce((s, h) => s + h.gain * (1 - h.shortTermShare), 0);
    const total = shortLoss + longLoss;
    const impact = saved({ shortTermGains: inputs.shortTermGains + shortLoss, longTermGains: inputs.longTermGains + longLoss });
    const top = pool
      .slice(0, 3)
      .map((h) => `${h.ticker ?? h.name ?? 'a holding'} (${money(-h.gain)})`)
      .join(', ');
    const washed = losses.length - clean.length;
    const rsuWashed = losses.filter((h) => !h.recentPurchase && (h.recentVest || h.upcomingVest)).length;
    out.push({
      id: 'harvest-losses',
      kind: 'save',
      title: `Harvest ${money(-total)} of losses`,
      detail: `${pool.length} taxable holding${pool.length === 1 ? ' is' : 's are'} worth less than you paid, led by ${top}. Selling locks in the loss to offset this year's gains and up to $3,000 of other income, with the rest carried forward. Buy something similar but not substantially identical to stay invested, and don't rebuy the same fund within 30 days in any account, IRAs included.${
        washed
          ? ` ${washed} more ${washed === 1 ? 'was' : 'were'} bought or vested within 30 days${rsuWashed ? ' (including an RSU vest)' : ''}, so selling now would be a wash sale.`
          : ''
      }`,
      impact,
      question: `Which of my taxable holdings with losses should I sell to harvest losses this year, and what could I replace them with?`,
    });
  }

  if (base.federal.zeroRateGainRoom > 1_000) {
    const room = base.federal.zeroRateGainRoom;
    const caCost = base.state ? room * base.state.bracketRate : 0;
    out.push({
      id: 'harvest-gains',
      kind: 'save',
      title: `Up to ${money(room)} of gains would be taxed at 0%`,
      detail: `Your taxable income is under the 0% long-term capital gains ceiling. Selling long-held winners in a taxable account and buying them back (no wash-sale rule for gains) resets their cost basis higher, so future sales owe less.${
        base.state && base.state.total > 0 ? ` ${base.state.state} still taxes the gain, about ${money(caCost)}.` : ''
      }`,
      impact: null,
      question: `My taxable income is under the 0% long-term capital gains bracket. How much should I harvest in gains this year?`,
    });
  }

  const { people: k401People, catchUp, limit: k401Limit, used: k401Used, room: k401Room } = k401Headroom(ctx);
  if ((detected.k401Accounts > 0 || settings.coveredByWorkplacePlan) && k401Room > 500) {
    const rothPart = detected.roth401kContributions ?? 0;
    out.push({
      id: '401k',
      kind: 'save',
      title: `${money(k401Room)} of 401(k) room left`,
      detail: `You're on pace for ${money(k401Used)} of ${rothPart > 0 ? 'pre-tax and Roth ' : 'pre-tax '}deferrals against a ${money(k401Limit)} limit${
        k401People > 1 ? ' for the two of you' : ''
      }${catchUp ? `, catch-up included` : ''}. Raising your deferral for the rest of the year lowers this year's tax at your ${pct(
        ctx.marginal,
      )} marginal rate. Deferrals must come out of pay by your last paycheck in December.${
        settings.pretax401k === null ? ' Meld counted every contribution its 401(k) accounts reported, which can include employer money; enter your own in Tax inputs if that’s off.' : ''
      }`,
      impact: saved({ pretax401k: inputs.pretax401k + k401Room }),
      question: `I have ${money(k401Room)} of 401(k) room left this year. Should I max it out pre-tax or use Roth 401(k)?`,
    });
  }

  if ((detected.k457bAccounts ?? 0) > 0) {
    const { people: k457People, catchUp: c457, limit: k457Limit, used: k457Used, room: k457Room } = k457bHeadroom(ctx);
    if (k457Room > 500) {
      out.push({
        id: '457b',
        kind: 'save',
        title: `${money(k457Room)} of 457(b) room left`,
        detail: `A governmental 457(b) has its own ${money(k457Limit)} employee limit${k457People > 1 ? ' for the two of you' : ''}${
          c457 ? ', catch-up included' : ''
        } that stacks on top of a 401(k) or 403(b) (${money(k457Used)} contributed so far). Pre-tax 457(b) deferrals lower this year's tax at your ${pct(
          ctx.marginal,
        )} marginal rate—and unlike a 401(k), governmental 457(b) withdrawals have no 10% early penalty once you leave the employer.`,
        impact: saved({ pretax401k: inputs.pretax401k + k457Room }),
        question: `I have ${money(k457Room)} of 457(b) contribution room left this year. How does it stack with my other workplace plan?`,
      });
    }
  }

  if (settings.hsaCoverage) {
    const limit = (settings.hsaCoverage === 'family' ? t.limits.hsaFamily : t.limits.hsaSelf) + (age !== null && age >= 55 ? t.limits.hsaCatchUp : 0);
    const room = Math.max(0, limit - inputs.hsa);
    if (room > 100) {
      const hsaTaxedByState = Boolean(stateTables(inputs.state, inputs.year)?.hsaTaxable);
      out.push({
        id: 'hsa',
        kind: 'save',
        title: `${money(room)} of HSA room left`,
        detail: `HSA contributions are deductible federally${hsaTaxedByState ? ` (${stateName(inputs.state) ?? inputs.state} taxes them)` : ''}, grow tax-free and come out tax-free for medical costs. Through payroll they also skip Social Security and Medicare tax. You have until the filing deadline to contribute for ${inputs.year}.`,
        impact: saved({ hsa: inputs.hsa + room }),
        question: `Should I max out my HSA for ${inputs.year}, and should I invest it rather than spend from it?`,
      });
    }
  } else if (detected.hsaAccount) {
    out.push({
      id: 'hsa-coverage',
      kind: 'info',
      title: 'Set your HSA coverage',
      detail: 'You have an HSA. Choose self-only or family coverage in Tax inputs to see how much room is left this year.',
      impact: null,
      question: 'How much can I put in my HSA this year?',
    });
  }

  // IRAs: a Roth directly when income allows, otherwise the backdoor.
  const iraPeople = joint ? 2 : 1;
  const iraLimit = (t.limits.ira + (age !== null && age >= 50 ? t.limits.iraCatchUp : 0)) * iraPeople;
  const iraRoom = Math.max(0, iraLimit - detected.iraContributions - detected.rothContributions);
  const magi = base.federal.agi;
  const [rothLow, rothHigh] = t.rothPhaseOut[status];
  if (iraRoom > 100) {
    if (magi < rothHigh) {
      const allowed = magi <= rothLow ? 1 : (rothHigh - magi) / (rothHigh - rothLow);
      out.push({
        id: 'roth-ira',
        kind: 'save',
        title: `Contribute up to ${money(iraRoom * allowed)} to a Roth IRA`,
        detail: `Your income${allowed < 1 ? ' is in the phase-out range, so only part of the limit is allowed. It' : ''} qualifies for direct Roth IRA contributions${
          joint ? ', one for each of you' : ''
        }. There's no deduction now, but growth and withdrawals in retirement are tax-free. Contributions for ${inputs.year} are allowed until the filing deadline.`,
        impact: null,
        question: `Should I contribute to a Roth IRA or a traditional IRA for ${inputs.year}?`,
      });
    } else {
      const proRata = detected.traditionalIraBalance > 0;
      const taxableShare = proRata ? detected.traditionalIraBalance / (detected.traditionalIraBalance + iraRoom) : 0;
      out.push({
        id: 'backdoor-roth',
        kind: proRata ? 'warning' : 'save',
        title: proRata ? 'Backdoor Roth: watch the pro-rata rule' : `Backdoor Roth: ${money(iraRoom)} of room`,
        detail: `Your MAGI of ${money(magi)} is over the ${money(rothHigh)} Roth IRA limit, so contributions go in as a non-deductible traditional IRA and are converted to Roth.${
          proRata
            ? ` You have ${money(detected.traditionalIraBalance)} in pre-tax IRAs, so about ${pct(taxableShare)} of any conversion would be taxable. Rolling those IRAs into a workplace 401(k) first, if the plan allows it, clears the way. The balance that counts is the one on December 31.`
            : ' With no pre-tax IRA balances, the conversion should be close to tax-free.'
        }`,
        impact: null,
        question: proRata
          ? `I have ${money(detected.traditionalIraBalance)} in traditional IRAs. How do I do a backdoor Roth without the pro-rata rule making it taxable?`
          : 'Walk me through doing a backdoor Roth IRA this year.',
      });
    }

    // A traditional IRA deduction, when no one has a workplace plan or income is low enough. Unknown coverage says nothing.
    const covered = settings.coveredByWorkplacePlan ?? (detected.k401Accounts > 0 ? true : null);
    if (covered !== null) {
      const [dLow, dHigh] = covered ? t.iraDeductionPhaseOut[status] : [Infinity, Infinity];
      const deductible = magi <= dLow ? 1 : magi >= dHigh ? 0 : (dHigh - magi) / (dHigh - dLow);
      if (deductible > 0) {
        const amount = iraRoom * deductible;
        out.push({
          id: 'traditional-ira',
          kind: 'save',
          title: `Deduct up to ${money(amount)} with a traditional IRA`,
          detail: `${
            covered ? 'Your income is low enough' : 'With no workplace plan, you can'
          } to deduct a traditional IRA contribution, which lowers this year's tax at your marginal rate in exchange for taxable withdrawals later.${
            covered && joint ? ' This assumes the one contributing is the one covered by a workplace plan.' : ''
          }`,
          impact: saved({ iraDeduction: inputs.iraDeduction + amount }),
          question: `Is a deductible traditional IRA or a Roth IRA better for me in ${inputs.year}?`,
        });
      }
    }
  }

  if (inputs.selfEmployment > 0) {
    // An employer contribution of about 20% of net self-employment earnings (25% of pay after the deduction).
    const net = inputs.selfEmployment - base.federal.selfEmploymentTax / 2;
    const room = Math.max(0, Math.min(net * 0.2, t.limits.totalDefinedContribution) - inputs.selfEmployedRetirement);
    if (room > 500) {
      out.push({
        id: 'self-employed-retirement',
        kind: 'save',
        title: `Shelter up to ${money(room)} of self-employment income`,
        detail: `A SEP IRA or solo 401(k) lets you contribute about 20% of net self-employment earnings as the employer, on top of any 401(k) deferrals at a job (within one combined limit per plan). A SEP IRA can be opened and funded up to the filing deadline. Note that a SEP IRA balance counts against a backdoor Roth; a solo 401(k) doesn't.`,
        impact: saved({ selfEmployedRetirement: inputs.selfEmployedRetirement + room }),
        question: `I have ${money(inputs.selfEmployment)} of self-employment income. Should I open a SEP IRA or a solo 401(k)?`,
      });
    }
  }

  if (base.federal.bracketRate <= 0.24 && base.federal.bracketRoom !== null && base.federal.bracketRoom > 1_000 && detected.traditionalIraBalance > 0) {
    const room = Math.min(base.federal.bracketRoom, detected.traditionalIraBalance);
    out.push({
      id: 'roth-conversion',
      kind: 'info',
      title: `Room to convert ${money(room)} to Roth in the ${pct(base.federal.bracketRate)} bracket`,
      detail: `Converting pre-tax IRA money to Roth up to the top of your current bracket costs tax now (about ${money(
        -saved({ otherIncome: inputs.otherIncome + room }),
      )}) but makes future growth tax-free. It pays off when you expect a higher rate in retirement or want to shrink required distributions.`,
      impact: null,
      question: `Should I do a Roth conversion this year, and how much?`,
    });
  }

  if (inputs.state === 'CA' && detected.has529) {
    out.push({
      id: '529-ca',
      kind: 'info',
      title: 'No California deduction for 529 contributions',
      detail: `California doesn't deduct 529 contributions, so there's no state tax reason to fund it before year-end. The federal benefit is tax-free growth for education; up to $10,000 a year can go to K–12 tuition.`,
      impact: null,
      question: 'How much should I be putting into 529 plans for my kids?',
    });
  }

  const order = { warning: 0, save: 1, info: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || (b.impact ?? 0) - (a.impact ?? 0));
}

// --- Year-end checklist ------------------------------------------------------------

export type ChecklistContext = SuggestionContext & {
  suggestions: TaxSuggestion[];
  today: string;
  /** Ids ticked off for this year. */
  done: ReadonlySet<string>;
  /** The profile's free-form employer benefits, to tell whether there's an FSA. */
  employerBenefits: string | null;
};

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
/** A deadline on a weekend moves to the next Monday (payments) or back to Friday (trades). */
export function businessDay(date: string, direction: 'forward' | 'back'): string {
  let d = date;
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, direction === 'forward' ? 1 : -1);
  return d;
}
const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

/** Payroll needs about two weeks to pick up a new election. */
const PAYROLL_LEAD_DAYS = 14;

/** Semi-monthly paydays (the 15th and month-end) left in the year once payroll can act on a change. */
export function paychecksLeft(year: number, today: string): number {
  const from = addDays(today, PAYROLL_LEAD_DAYS);
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    for (const d of [`${year}-${mm}-15`, `${year}-${mm}-${last}`]) if (d >= from) n++;
  }
  return n;
}

/**
 * The year's tax moves that have a deadline, with the date: the suggestions that expire on December 31
 * or the filing deadline, plus ones Meld can't price (FSA, Q4 estimate, charity). Only what's still ahead.
 */
export function buildChecklist(ctx: ChecklistContext): ChecklistItem[] {
  const { inputs, base, settings, detected, age, today, suggestions } = ctx;
  const year = inputs.year;
  const joint = tableStatus(inputs.filingStatus) === 'married_joint';
  const lastTradingDay = businessDay(`${year}-12-31`, 'back');
  const yearEnd = `${year}-12-31`;
  const q4 = businessDay(`${year + 1}-01-15`, 'forward');
  const filing = businessDay(`${year + 1}-04-15`, 'forward');
  const saved = (change: Partial<TaxInputs>) => round(base.total - estimateTax({ ...inputs, ...change }).total);
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const out: Omit<ChecklistItem, 'done'>[] = [];
  const fromSuggestion = (
    id: string,
    due: string,
    dueLabel: string,
    detail: (s: TaxSuggestion) => string,
    title?: (s: TaxSuggestion) => string,
  ) => {
    const s = byId.get(id);
    if (!s) return;
    out.push({ id, due, dueLabel, title: title?.(s) ?? s.title, detail: detail(s), impact: s.impact, suggestionId: id, general: false, question: s.question });
  };

  // By the last trading day: sales count in the year of the trade date, not settlement.
  fromSuggestion(
    'harvest-losses',
    lastTradingDay,
    'Last trading day',
    () =>
      `Sales count for ${year} by trade date, so place them by ${shortDate(lastTradingDay)}. Buying the same fund back within 30 days, in any account, cancels the loss: buy something similar right away, or wait until ${shortDate(
        addDays(lastTradingDay, 31),
      )}. A December dividend reinvested in the same fund counts as a purchase, so turn off reinvestment first.`,
  );
  fromSuggestion(
    'harvest-gains',
    lastTradingDay,
    'Last trading day',
    () =>
      `Sell and buy back by ${shortDate(lastTradingDay)} for the gain to land in ${year}'s 0% bracket. Leave some cushion: a December fund distribution or bonus can use up the room.`,
  );

  fromSuggestion(
    '401k',
    yearEnd,
    'Last paycheck',
    () => {
      const left = paychecksLeft(year, today);
      const { room, people } = k401Headroom(ctx);
      return left > 0
        ? `Deferrals only count when they come out of pay, and payroll usually needs a cycle or two to make a change. Change your election now: on about ${left} semi-monthly paycheck${
            left === 1 ? '' : 's'
          } left, that's roughly ${money(room / left)} each${people > 1 ? ', split between the two of you' : ''}. Many plans cap deferrals at a share of each paycheck, so a bonus check can help.`
        : `Deferrals only count when they come out of pay, and there may not be time for payroll to pick up a change. Ask payroll whether a final paycheck or bonus can still take a bigger deferral; otherwise an IRA or HSA can be funded until the filing deadline.`;
    },
  );

  fromSuggestion(
    '457b',
    yearEnd,
    'Last paycheck',
    () => {
      const left = paychecksLeft(year, today);
      const { room, people } = k457bHeadroom(ctx);
      return left > 0
        ? `457(b) deferrals come out of pay and usually take a payroll cycle to change. On about ${left} semi-monthly paycheck${
            left === 1 ? '' : 's'
          } left, that's roughly ${money(room / left)} each${people > 1 ? ', split between the two of you' : ''}.`
        : `457(b) deferrals must come out of pay before year-end; check with payroll whether a final paycheck can still take a higher election.`;
    },
  );

  fromSuggestion('roth-conversion', yearEnd, 'Year ends', () => `A conversion counts in the year the money moves, so finish it by ${shortDate(yearEnd)}. Brokers get busy in late December; start a week or two early.`);

  const backdoor = byId.get('backdoor-roth');
  if (backdoor?.kind === 'warning') {
    fromSuggestion(
      'backdoor-roth',
      yearEnd,
      'Balance counted',
      () =>
        `The pro-rata rule looks at your pre-tax IRA balance on December 31. Roll ${money(detected.traditionalIraBalance)} of pre-tax IRAs into a workplace 401(k) by then, if the plan takes roll-ins, and a backdoor Roth converted this year stays close to tax-free.`,
      () => 'Clear pre-tax IRAs before a backdoor Roth',
    );
  } else {
    fromSuggestion('backdoor-roth', filing, 'Filing deadline', () => `${year} contributions are allowed until ${shortDate(filing)}, ${year + 1}. Convert soon after contributing so little growth is taxed.`);
  }
  fromSuggestion('roth-ira', filing, 'Filing deadline', () => `Contributions for ${year} are allowed until ${shortDate(filing)}, ${year + 1}. Tell the broker which year it's for.`);
  fromSuggestion('traditional-ira', filing, 'Filing deadline', () => `Contributions for ${year} are allowed until ${shortDate(filing)}, ${year + 1}, so you can wait to see your final income first.`);
  fromSuggestion('hsa', filing, 'Filing deadline', () => `Direct contributions for ${year} are allowed until ${shortDate(filing)}, ${year + 1}. Through payroll before year-end also skips Social Security and Medicare tax.`);
  fromSuggestion(
    'self-employed-retirement',
    filing,
    'Filing deadline',
    () =>
      `A SEP IRA can be opened and funded until the filing deadline (${shortDate(filing)}, ${year + 1}, or October with an extension). A solo 401(k) set up by the deadline can take employer contributions for ${year} too.`,
  );

  // Q4 estimated payment, or the withholding check that tells you whether you need one.
  const estimates = (settings.federalEstimatedPayments ?? 0) + (settings.stateEstimatedPayments ?? 0);
  const owe = ctx.balanceDue;
  if ((owe !== null && owe > 1_000) || inputs.selfEmployment > 0 || estimates > 0) {
    const covered = owe !== null && owe <= 0;
    out.push({
      id: 'q4-estimate',
      due: q4,
      dueLabel: 'Payment due',
      title: owe !== null && owe > 1_000 ? `Cover about ${money(owe)} by the Q4 estimate` : covered ? 'Q4 estimate: on track to be covered' : 'Make the Q4 estimated payment',
      detail: `The fourth estimated payment for ${year} is due ${shortDate(q4)}, ${year + 1}${base.state && base.state.method !== 'none' ? ', and most states with an income tax use the same date' : ''}. ${
        covered
          ? 'Withholding and payments so far look like enough, so you may be able to skip it; check again once December pay is in.'
          : 'Paying at least 100% of last year’s tax (110% if last year’s AGI was over $150,000) through the year avoids a penalty. Extra withholding from a December paycheck counts as paid evenly through the year, so it also covers short earlier quarters; a Q4 payment only covers Q4.'
      }`,
      impact: null,
      suggestionId: byId.has('underpayment') ? 'underpayment' : null,
      general: owe === null,
      question: `How much should my Q4 estimated tax payment for ${year} be, and should I raise my withholding instead?`,
    });
  } else if (owe === null && base.federal.total > 0) {
    out.push({
      id: 'withholding-check',
      due: yearEnd,
      dueLabel: 'Last paycheck',
      title: 'Check withholding while there’s time to fix it',
      detail: `Enter federal and state withheld so far from your latest pay stub in Tax inputs to see whether you're on track. If you're short, a new W-4 for the last paychecks of ${year} fixes it, and withholding counts as paid evenly through the year.`,
      impact: null,
      suggestionId: null,
      general: true,
      question: `Is my ${year} withholding enough, or should I change my W-4 before year-end?`,
    });
  }

  // Charity: gifts count the day they're made. Bunching two years into one clears the standard deduction.
  const { itemized, standard } = base.deductions;
  const perThousand = saved({ otherItemized: inputs.otherItemized + 1_000 });
  const qcd = age !== null && age >= 71 && detected.traditionalIraBalance > 0;
  const qcdNote = qcd
    ? ' Past 70½, a qualified charitable distribution straight from your IRA (up to about $108,000) leaves AGI entirely and counts toward a required distribution, which beats deducting a gift.'
    : '';
  const stockNote = ' Gifting long-held appreciated shares deducts their full value with no gain to pay; transfers take days, so start by mid-December.';
  const nonItemizer = year >= 2026 ? ` From 2026, ${joint ? 'up to $2,000' : 'up to $1,000'} of cash gifts to charities (not donor-advised funds) is deductible without itemizing.` : '';
  if (itemized > standard) {
    out.push({
      id: 'charity',
      due: yearEnd,
      dueLabel: 'Gifts count when made',
      title: perThousand > 0 ? `Give by Dec 31: each $1,000 saves about ${money(perThousand)}` : 'Give by Dec 31 to deduct it this year',
      detail: `You're itemizing, so a gift made by ${shortDate(yearEnd)} (mailed, charged or transferred) comes off ${year}'s income.${
        year >= 2026 ? ' From 2026 only giving above 0.5% of AGI counts, so a bigger gift every other year deducts more.' : ''
      }${stockNote}${qcdNote}`,
      impact: null,
      suggestionId: null,
      general: true,
      question: `How much should I give to charity before the end of ${year}, and should I use a donor-advised fund or appreciated stock?`,
    });
  } else if (itemized >= standard * 0.5) {
    const gap = standard - itemized;
    out.push({
      id: 'charity',
      due: yearEnd,
      dueLabel: 'Gifts count when made',
      title: `Bunch gifts: ${money(gap)} short of itemizing`,
      detail: `Your itemized deductions come to about ${money(itemized)} against a ${money(standard)} standard deduction, so gifts don't lower your tax today. Giving two or more years' worth by ${shortDate(
        yearEnd,
      )} (a donor-advised fund lets you grant it out later) clears the standard deduction, and every dollar past ${money(gap)} saves at your marginal rate; take the standard deduction next year.${stockNote}${qcdNote}${nonItemizer}`,
      impact: null,
      suggestionId: null,
      general: true,
      question: `Would bunching charitable gifts into ${year} with a donor-advised fund save me tax?`,
    });
  } else if (nonItemizer || qcd) {
    out.push({
      id: 'charity',
      due: yearEnd,
      dueLabel: 'Gifts count when made',
      title: year >= 2026 ? `Up to ${joint ? '$2,000' : '$1,000'} of gifts deductible without itemizing` : 'Give from your IRA instead of your checking account',
      detail: `${nonItemizer.trim()}${qcdNote}${nonItemizer ? ' Gifts count when made, so give by Dec 31.' : ''}`.trim(),
      impact: null,
      suggestionId: null,
      general: true,
      question: `What's the most tax-efficient way for me to give to charity before the end of ${year}?`,
    });
  }

  const rmdBalance = detected.pretaxRetirementBalance || detected.traditionalIraBalance;
  const rmd = rmdItem(year, age, rmdBalance, ctx.birthYear ?? null);
  if (rmd) out.push(rmd);
  out.push(fsaItem(year, ctx.employerBenefits));

  return finishChecklist(out, today, ctx.done);
}

/**
 * The checklist before there's an estimate (no filing status or income yet): only the deadlines that
 * don't rest on one. The card says what to fill in for the rest.
 */
export function checklistWithoutEstimate(
  year: number,
  today: string,
  age: number | null,
  pretaxBalance: number,
  employerBenefits: string | null,
  done: ReadonlySet<string>,
  birthYear: number | null = null,
): ChecklistItem[] {
  const rmd = rmdItem(year, age, pretaxBalance, birthYear);
  return finishChecklist([...(rmd ? [rmd] : []), fsaItem(year, employerBenefits)], today, done);
}

function finishChecklist(items: Omit<ChecklistItem, 'done'>[], today: string, done: ReadonlySet<string>): ChecklistItem[] {
  return items
    .filter((i) => i.due >= today)
    .map((i) => ({ ...i, done: done.has(i.id) }))
    .sort((a, b) => a.due.localeCompare(b.due) || Number(a.general) - Number(b.general) || (b.impact ?? 0) - (a.impact ?? 0));
}

/** Required minimum distributions, from the SECURE 2.0 starting age (73 for 1951–1959, 75 for 1960+). */
function rmdItem(year: number, age: number | null, pretaxBalance: number, birthYear: number | null = null): Omit<ChecklistItem, 'done'> | null {
  if (age === null || pretaxBalance <= 0) return null;
  const effectiveBirthYear = birthYear ?? year - age;
  const startAge = rmdStartAge(effectiveBirthYear);
  if (age < startAge) return null;
  const est = Math.round(calculateRmd(pretaxBalance, age, effectiveBirthYear));
  const yearEnd = `${year}-12-31`;
  return {
    id: 'rmd',
    due: yearEnd,
    dueLabel: 'Distribution deadline',
    title: est > 0 ? `Take your ~${money(est)} required minimum distribution` : 'Take your required minimum distribution',
    detail: `Pre-tax retirement accounts (${money(pretaxBalance)}) need a minimum withdrawal by ${shortDate(yearEnd)}${
      age === startAge ? `; your first one (at age ${startAge}) can wait until April 1, ${year + 1}, but then two land in ${year + 1}` : ''
    }. Missing it costs up to 25% of the shortfall. It's last year's December 31 balance divided by an IRS life-expectancy factor (Roth IRAs and Roth workplace plans have no lifetime RMDs).`,
    impact: null,
    suggestionId: null,
    general: false,
    question: `How much is my required minimum distribution for ${year}, and should I give part of it to charity?`,
  };
}

/** FSAs: Meld can't see them, so this rests on the profile's benefits, or is offered as a reminder. */
function fsaItem(year: number, employerBenefits: string | null): Omit<ChecklistItem, 'done'> {
  const yearEnd = `${year}-12-31`;
  const fsa = /\bFSA\b|flexible spending/i.test(employerBenefits ?? '');
  return {
    id: 'fsa',
    due: yearEnd,
    dueLabel: 'Plan year ends',
    title: fsa ? 'Use up your FSA' : 'If you have an FSA, use it up',
    detail: `FSA money left at the plan's deadline is forfeited. Most plans run with the calendar year; some allow a grace period to mid-March or carry over a few hundred dollars instead. Check the balance and book eye exams, glasses, dental work or eligible supplies before ${shortDate(
      yearEnd,
    )}. Open enrollment is also when to set next year's election, health and dependent care.`,
    impact: null,
    suggestionId: null,
    general: !fsa,
    question: 'What can I spend my FSA balance on before it expires, and how much should I elect for next year?',
  };
}
