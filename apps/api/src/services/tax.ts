import {
  bracketAt,
  bracketTax,
  californiaTables,
  EMPTY_TAX_SETTINGS,
  federalTables,
  NO_INCOME_TAX_STATES,
  tableStatus,
  taxTreatment,
  TaxSettings,
  type BracketSlice,
  type FederalTax,
  type FilingStatus,
  type HarvestCandidate,
  type SecurityProfile,
  type StateTax,
  type TaxIncome,
  type TaxPlan,
  type TaxSuggestion,
} from '@meld/shared';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, holdings, investmentTransactions, securities, taxSettings, transactions } from '../db/schema';
import { localDate } from '../lib/networth';
import { shiftYears } from './overview';
import { daysBetween, EARNINGS, isCash } from './performance';
import { getProfile } from './profile';

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
  const { state, year } = inputs;
  if (!state) return null;
  const status = tableStatus(inputs.filingStatus);
  if (state === 'CA') {
    const t = californiaTables(year);
    // California taxes HSA money and has its own (smaller) standard deduction, with no SALT cap to apply.
    const agi = federalAgi + inputs.hsa;
    const deduction = Math.max(t.standardDeduction[status], inputs.propertyTax + inputs.otherItemized);
    const taxable = Math.max(0, agi - deduction);
    const surcharge = 0.01 * Math.max(0, taxable - t.surchargeFrom);
    const steps = Math.ceil(Math.max(0, federalAgi - t.creditPhaseOutFrom[status]) / (status === 'married_separate' ? 1_250 : 2_500));
    const people = status === 'married_joint' ? 2 : 1;
    const credits =
      Math.max(0, t.personalCredit[status] - 6 * steps * people) + inputs.dependents * Math.max(0, t.dependentCredit - 6 * steps);
    return {
      state,
      method: 'tables',
      tablesYear: t.year === year ? null : t.year,
      taxableIncome: round2(taxable),
      total: round2(Math.max(0, bracketTax(t.brackets[status], taxable) + surcharge - credits)),
      bracketRate: bracketAt(t.brackets[status], taxable).rate + (taxable > t.surchargeFrom ? 0.01 : 0),
    };
  }
  if (NO_INCOME_TAX_STATES.has(state)) {
    return { state, method: 'none', tablesYear: null, taxableIncome: 0, total: 0, bracketRate: 0 };
  }
  if (inputs.stateFlatRate === null) return null;
  const rate = inputs.stateFlatRate / 100;
  const taxable = Math.max(0, federalAgi);
  return { state, method: 'flat', tablesYear: null, taxableIncome: round2(taxable), total: round2(taxable * rate), bracketRate: rate };
}

/** Federal and state income tax for a full year. */
export function estimateTax(inputs: TaxInputs): TaxEstimate {
  const t = federalTables(inputs.year);
  const status = tableStatus(inputs.filingStatus);
  const wages = Math.max(0, inputs.grossIncome - inputs.selfEmployment - inputs.pretax401k);

  // Self-employment tax on 92.35% of profit; half of it comes off income.
  const seEarnings = inputs.selfEmployment * 0.9235;
  const selfEmploymentTax = seEarnings >= 400 ? 0.124 * Math.min(seEarnings, t.socialSecurityWageBase) + 0.029 * seEarnings : 0;

  const capital = netCapital(inputs.shortTermGains, inputs.longTermGains, status === 'married_separate' ? 1_500 : 3_000);
  const agi =
    wages +
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
  const medicareWages = Math.max(0, inputs.grossIncome - inputs.selfEmployment);
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
    inputs.grossIncome +
    inputs.interest +
    inputs.ordinaryDividends +
    inputs.qualifiedDividends +
    Math.max(0, capital.st + capital.lt) +
    inputs.otherIncome;
  return { income, federal, state, total: round2(grandTotal), effectiveRate: gross > 0 ? grandTotal / gross : 0 };
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
  balanceDue: number | null;
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

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

  const losses = ctx.harvest.filter((h) => h.gain < 0);
  if (losses.length) {
    const clean = losses.filter((h) => !h.recentPurchase);
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
    out.push({
      id: 'harvest-losses',
      kind: 'save',
      title: `Harvest ${money(-total)} of losses`,
      detail: `${pool.length} taxable holding${pool.length === 1 ? ' is' : 's are'} worth less than you paid, led by ${top}. Selling locks in the loss to offset this year's gains and up to $3,000 of other income, with the rest carried forward. Buy something similar but not substantially identical to stay invested, and don't rebuy the same fund within 30 days in any account, IRAs included.${
        washed ? ` ${washed} more ${washed === 1 ? 'was' : 'were'} bought in the last 30 days, so selling now would be a wash sale.` : ''
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

  // Pre-tax 401(k): one limit per person with a plan.
  const k401People = Math.max(1, Math.min(joint ? 2 : 1, detected.k401Accounts));
  const catchUp = age === null ? 0 : age >= 60 && age <= 63 ? t.limits.k401CatchUp60to63 : age >= 50 ? t.limits.k401CatchUp : 0;
  const k401Limit = t.limits.k401 * k401People + catchUp;
  const k401Room = Math.max(0, k401Limit - inputs.pretax401k);
  if ((detected.k401Accounts > 0 || settings.coveredByWorkplacePlan) && k401Room > 500) {
    out.push({
      id: '401k',
      kind: 'save',
      title: `${money(k401Room)} of 401(k) room left`,
      detail: `You're on pace for ${money(inputs.pretax401k)} of pre-tax deferrals against a ${money(k401Limit)} limit${
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

  if (settings.hsaCoverage) {
    const limit = (settings.hsaCoverage === 'family' ? t.limits.hsaFamily : t.limits.hsaSelf) + (age !== null && age >= 55 ? t.limits.hsaCatchUp : 0);
    const room = Math.max(0, limit - inputs.hsa);
    if (room > 100) {
      out.push({
        id: 'hsa',
        kind: 'save',
        title: `${money(room)} of HSA room left`,
        detail: `HSA contributions are deductible federally${inputs.state === 'CA' ? ' (California taxes them)' : ''}, grow tax-free and come out tax-free for medical costs. Through payroll they also skip Social Security and Medicare tax. You have until the filing deadline to contribute for ${inputs.year}.`,
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

export async function saveTaxSettings(db: Db, year: number, settings: TaxSettings): Promise<TaxSettings> {
  await db
    .insert(taxSettings)
    .values({ year, settings })
    .onConflictDoUpdate({ target: taxSettings.year, set: { settings, updatedAt: new Date() } });
  return getTaxSettings(db, year);
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

  const [profile, settings, accountRows] = await Promise.all([
    getProfile(db),
    getTaxSettings(db, year),
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

  const [txnRows, holdingRows, bankRows] = await Promise.all([
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
  const lotsByKey = new Map(replays.map((r) => [`${r.accountId}|${r.securityId}`, r.lots]));
  const yearAgo = shiftYears(today, -1);
  const harvest: HarvestCandidate[] = taxableHoldings
    .filter((h) => h.value !== null && h.costBasis !== null && h.costBasis > 0)
    .map((h) => {
      const s = securityById.get(h.securityId);
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
    notes: [],
  };
  if (!profile.filingStatus || profile.annualGrossIncome === null) return plan;

  const ageAtYearEnd = profile.birthYear ? year - profile.birthYear : null;
  const k401Projected = Math.min(
    elapsed > 0 ? k401Contributions / elapsed : 0,
    fed.limits.k401 * Math.max(1, detected.k401Accounts) + fed.limits.k401CatchUp60to63,
  );
  const inputs: TaxInputs = {
    year,
    filingStatus: profile.filingStatus,
    state: profile.state,
    childrenUnder17: profile.children.filter((c) => year - c.birthYear < 17).length,
    dependents: profile.dependents ?? profile.children.length,
    grossIncome: profile.annualGrossIncome,
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

  // Withholding so far, carried to year-end at the same pace; estimated payments as entered.
  const withheld = settings.federalWithheld === null && settings.stateWithheld === null
    ? null
    : ((settings.federalWithheld ?? 0) + (settings.stateWithheld ?? 0)) / Math.max(elapsed, 0.01);
  const balanceDue =
    withheld === null ? null : round2(base.total - withheld - (settings.federalEstimatedPayments ?? 0) - (settings.stateEstimatedPayments ?? 0));

  const notes: string[] = [];
  if (fed.year !== year) notes.push(`Federal figures use ${fed.year} brackets and limits; Meld doesn't have ${year}'s yet.`);
  if (base.state?.tablesYear) notes.push(`${base.state.state} figures use ${base.state.tablesYear} brackets; ${year}'s haven't been published.`);
  if (!profile.state) notes.push('Add your state to your profile to include state tax.');
  else if (!base.state) notes.push(`Meld has no tables for ${profile.state}; enter an effective state rate in Tax inputs to include it.`);
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

  return {
    ...plan,
    income: base.income,
    federal: base.federal,
    state: base.state,
    totalTax: base.total,
    effectiveRate: round2(base.effectiveRate * 10_000) / 10_000,
    marginalRate: round2(marginal * 10_000) / 10_000,
    balanceDue,
    suggestions: buildSuggestions({
      inputs,
      base,
      marginal,
      settings,
      detected,
      harvest: plan.harvest,
      age: ageAtYearEnd,
      balanceDue,
    }),
    notes,
  };
}

