import { z } from 'zod';
import { Account as AccountSchema } from './accounts';
import { LiabilityDetails as LiabilityDetailsSchema } from './liabilities';
import { Month } from './overview';

export const TaxTreatment = z.enum(['taxable', 'tax_deferred', 'tax_free', 'unknown']);
export type TaxTreatment = z.infer<typeof TaxTreatment>;

// Plaid investment account subtypes, grouped by how withdrawals are taxed.
const TAX_DEFERRED = new Set([
  '401a', '401k', '403b', '457b', 'ira', 'keogh', 'lif', 'lira', 'lrif', 'lrsp', 'pension',
  'prif', 'profit sharing plan', 'qshr', 'rdsp', 'resp', 'retirement', 'rlif', 'rrif', 'rrsp',
  'sarsep', 'sep ira', 'simple ira', 'sipp', 'thrift savings plan',
]);
const TAX_FREE = new Set(['roth', 'roth 401k', 'hsa', '529', 'tfsa', 'isa', 'education savings account']);
const TAXABLE = new Set([
  'brokerage', 'cash isa', 'crypto exchange', 'fixed annuity', 'gic', 'health reimbursement arrangement',
  'mutual fund', 'non-custodial wallet', 'non-taxable brokerage account', 'other annuity', 'other insurance',
  'stock plan', 'trust', 'ugma', 'utma', 'variable annuity',
]);

export function taxTreatment(subtype: string | null): TaxTreatment {
  const s = subtype?.toLowerCase();
  if (!s) return 'unknown';
  if (TAX_DEFERRED.has(s)) return 'tax_deferred';
  if (TAX_FREE.has(s)) return 'tax_free';
  if (TAXABLE.has(s)) return 'taxable';
  return 'unknown';
}

// --- What's inside a security ------------------------------------------------

export const AssetClass = z.enum(['us_stocks', 'intl_stocks', 'bonds', 'cash', 'other']);
export type AssetClass = z.infer<typeof AssetClass>;

/** GICS sectors. */
export const Sector = z.enum([
  'technology',
  'financials',
  'healthcare',
  'consumer_discretionary',
  'industrials',
  'communication_services',
  'consumer_staples',
  'energy',
  'utilities',
  'real_estate',
  'materials',
]);
export type Sector = z.infer<typeof Sector>;

export const Region = z.enum(['united_states', 'canada', 'europe', 'japan', 'asia_pacific', 'emerging_markets', 'other']);
export type Region = z.infer<typeof Region>;

export const BondType = z.enum(['treasury', 'government_related', 'mortgage_backed', 'corporate', 'municipal', 'international', 'other']);
export type BondType = z.infer<typeof BondType>;

/**
 * Approximate make-up of one security, looking through funds to what they hold. Every group is a
 * set of fractions summing to 1: asset classes of the whole security, sectors and regions of its
 * stock portion, bond types of its bond portion. A group is empty when it doesn't apply or is unknown.
 */
export const SecurityProfile = z.object({
  /** A short label, e.g. "US total market", "Technology", "Target date 2050". */
  category: z.string(),
  assetClasses: z.partialRecord(AssetClass, z.number()),
  sectors: z.partialRecord(Sector, z.number()),
  regions: z.partialRecord(Region, z.number()),
  bondTypes: z.partialRecord(BondType, z.number()),
});
export type SecurityProfile = z.infer<typeof SecurityProfile>;

/** Cash needs no lookup. */
export const CASH_PROFILE: SecurityProfile = {
  category: 'Cash',
  assetClasses: { cash: 1 },
  sectors: {},
  regions: {},
  bondTypes: {},
};

// --- Holdings -------------------------------------------------------------------

export const Holding = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  securityId: z.string().uuid(),
  accountName: z.string(),
  accountSubtype: z.string().nullable(),
  taxTreatment: TaxTreatment,
  ticker: z.string().nullable(),
  name: z.string().nullable(),
  /** Plaid security type: equity, etf, mutual fund, fixed income, cash, derivative, cryptocurrency, other. */
  securityType: z.string().nullable(),
  quantity: z.number(),
  price: z.number().nullable(),
  value: z.number().nullable(),
  costBasis: z.number().nullable(),
  /** What the security holds; null until it's been looked up, or when it couldn't be. */
  profile: SecurityProfile.nullable(),
});
export type Holding = z.infer<typeof Holding>;

export const AccountDetail = z.object({
  account: AccountSchema,
  liability: LiabilityDetailsSchema.nullable(),
  holdings: z.array(Holding),
});

export type AccountDetail = z.infer<typeof AccountDetail>;

export const InvestmentAccount = z.object({
  id: z.string().uuid(),
  name: z.string(),
  institutionName: z.string().nullable(),
  subtype: z.string().nullable(),
  taxTreatment: TaxTreatment,
  /** Sum of the account's holdings (your share). */
  value: z.number(),
});
export type InvestmentAccount = z.infer<typeof InvestmentAccount>;

/** Holdings and accounts count only your ownership share of a joint account. */
export const InvestmentsSummary = z.object({
  totalValue: z.number(),
  holdings: z.array(Holding),
  /** Accounts with holdings, largest first. */
  accounts: z.array(InvestmentAccount),
  /** Investment account balances now vs. the snapshot nearest six months ago; null without history. */
  change: z.object({ since: z.string(), previous: z.number(), current: z.number() }).nullable(),
  /** Securities still waiting for a look inside. */
  unprofiled: z.number(),
  /** Whether an AI provider is configured to do that lookup. */
  canProfile: z.boolean(),
});
export type InvestmentsSummary = z.infer<typeof InvestmentsSummary>;

export const ProfileResult = z.object({ profiled: z.number(), unrecognized: z.number() });
export type ProfileResult = z.infer<typeof ProfileResult>;

// --- Look-through exposure ------------------------------------------------------

type Weights<K extends string> = Partial<Record<K, number>>;

/** Drops negative or non-finite weights and scales the rest to sum to 1; empty if nothing is left. */
export function normalizeWeights<K extends string>(weights: Weights<K>): Weights<K> {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => Number.isFinite(w) && w > 0);
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  return sum > 0 ? (Object.fromEntries(entries.map(([k, w]) => [k, w / sum])) as Weights<K>) : {};
}

function addWeighted<K extends string>(into: Weights<K>, weights: Weights<K>, amount: number): number {
  let added = 0;
  for (const [k, w] of Object.entries(normalizeWeights(weights)) as [K, number][]) {
    into[k] = (into[k] ?? 0) + amount * w;
    added += amount * w;
  }
  return added;
}

/** Dollar exposure across holdings, looking through funds. */
export type Exposure = {
  total: number;
  assetClasses: Weights<AssetClass>;
  /** Value of holdings that haven't been looked up. */
  unclassified: number;
  /** Dollars in stocks, and how much of that has known sectors and regions. */
  stocks: number;
  sectors: Weights<Sector>;
  sectorsKnown: number;
  regions: Weights<Region>;
  regionsKnown: number;
  bonds: number;
  bondTypes: Weights<BondType>;
  bondTypesKnown: number;
};

export function lookThrough(holdings: Pick<Holding, 'value' | 'profile'>[]): Exposure {
  const e: Exposure = {
    total: 0,
    assetClasses: {},
    unclassified: 0,
    stocks: 0,
    sectors: {},
    sectorsKnown: 0,
    regions: {},
    regionsKnown: 0,
    bonds: 0,
    bondTypes: {},
    bondTypesKnown: 0,
  };
  for (const h of holdings) {
    const value = h.value ?? 0;
    e.total += value;
    const classes = h.profile ? normalizeWeights(h.profile.assetClasses) : {};
    if (!h.profile || !Object.keys(classes).length) {
      e.unclassified += value;
      continue;
    }
    addWeighted(e.assetClasses, classes, value);
    const stocks = value * ((classes.us_stocks ?? 0) + (classes.intl_stocks ?? 0));
    const bonds = value * (classes.bonds ?? 0);
    e.stocks += stocks;
    e.bonds += bonds;
    e.sectorsKnown += addWeighted(e.sectors, h.profile.sectors, stocks);
    e.regionsKnown += addWeighted(e.regions, h.profile.regions, stocks);
    e.bondTypesKnown += addWeighted(e.bondTypes, h.profile.bondTypes, bonds);
  }
  return e;
}

/** Positions grouped by security across accounts, largest first. */
export function positionsBySecurity(holdings: Holding[]): { securityId: string; holdings: Holding[]; value: number }[] {
  const groups = new Map<string, Holding[]>();
  for (const h of holdings) groups.set(h.securityId, [...(groups.get(h.securityId) ?? []), h]);
  return [...groups]
    .map(([securityId, list]) => ({ securityId, holdings: list, value: list.reduce((s, h) => s + (h.value ?? 0), 0) }))
    .sort((a, b) => b.value - a.value);
}

// --- Income ---------------------------------------------------------------------

export const IncomeTotals = z.object({
  /** Dividends and fund capital gain distributions. */
  dividends: z.number(),
  interest: z.number(),
  /** The part of dividends and interest bought back into securities. */
  reinvested: z.number(),
});
export type IncomeTotals = z.infer<typeof IncomeTotals>;

/** Income from investment transactions in visible accounts, at your ownership share. */
export const InvestmentIncome = z.object({
  asOf: z.string(),
  ytd: IncomeTotals,
  /** The same stretch of last year, Jan 1 to today's date. */
  previousYtd: IncomeTotals,
  trailing12: IncomeTotals,
  /** The last 24 months including this one, oldest first. */
  months: z.array(IncomeTotals.extend({ month: Month })),
  /** Year to date, largest first. */
  byAccount: z.array(IncomeTotals.extend({ accountId: z.string().uuid(), accountName: z.string() })),
});
export type InvestmentIncome = z.infer<typeof InvestmentIncome>;

// --- Performance ----------------------------------------------------------------

/** What came from markets vs. what you put in or took out, over one stretch of time. */
export const PerformanceTotals = z.object({
  startValue: z.number(),
  endValue: z.number(),
  /** Money added: deposits, contributions and shares transferred in. */
  contributions: z.number(),
  /** Money taken out, as a positive number. */
  withdrawals: z.number(),
  /** endValue − startValue − (contributions − withdrawals): what markets, dividends and interest earned. */
  gain: z.number(),
  /** Time-weighted return as a fraction (0.1 = 10%): growth with the timing and size of deposits taken out. */
  return: z.number().nullable(),
});
export type PerformanceTotals = z.infer<typeof PerformanceTotals>;

export const PerformancePeriod = PerformanceTotals.extend({
  /** 1m, 3m, ytd, 1y, all, or a calendar year like 2025. */
  key: z.string(),
  label: z.string(),
  start: z.string(),
  end: z.string(),
  /** The return as a yearly rate; null for stretches under a year. */
  annualized: z.number().nullable(),
  byAccount: z.array(PerformanceTotals.extend({ accountId: z.string().uuid(), accountName: z.string() })),
});
export type PerformancePeriod = z.infer<typeof PerformancePeriod>;

export const PerformancePoint = z.object({
  date: z.string(),
  value: z.number(),
  /** Net money in (+) or out (−) that day. */
  flow: z.number(),
  /** Growth of $1 invested at the start, from time-weighted returns. */
  index: z.number(),
});
export type PerformancePoint = z.infer<typeof PerformancePoint>;

/** Investment growth separated from deposits and withdrawals, at your ownership share. */
export const InvestmentPerformance = z.object({
  asOf: z.string(),
  /** Daily, oldest first. */
  points: z.array(PerformancePoint),
  periods: z.array(PerformancePeriod),
  /** Values before this date are estimated from transactions and market prices; from it on they're recorded balances. */
  estimatedBefore: z.string().nullable(),
  /** Holdings with no market price history, valued from prices in their own transactions instead. */
  approximated: z.array(z.string()),
  /** Accounts whose transactions start well after the rest (or never do); earlier values assume no trades or deposits. */
  limitedHistory: z.array(z.object({ accountName: z.string(), since: z.string().nullable() })),
});
export type InvestmentPerformance = z.infer<typeof InvestmentPerformance>;
