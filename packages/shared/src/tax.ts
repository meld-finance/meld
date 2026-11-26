import { z } from 'zod';
import { FilingStatus } from './profile';

const amount = z.number().nonnegative().nullable();

/**
 * What a tax estimate needs that Meld can't see in synced accounts, for one tax year. Every field is
 * optional; null means "use what Meld detected" where there's something to detect, else nothing.
 */
export const TaxSettings = z.object({
  /** The part of the profile's household gross income that is self-employment (1099) profit. */
  selfEmploymentIncome: amount,
  /** Taxable income not in gross pay or synced accounts: IRA distributions, Roth conversions, rental profit. */
  otherIncome: amount,
  /** Pre-tax 401(k)/403(b) deferrals for the whole year, both spouses. */
  pretax401k: amount,
  /** HSA contributions for the whole year, payroll and direct. */
  hsaContributions: amount,
  hsaCoverage: z.enum(['self', 'family']).nullable(),
  /** Whether you (or, filing jointly, either of you) can contribute to a workplace retirement plan. */
  coveredByWorkplacePlan: z.boolean().nullable(),
  /** Withheld so far this year, from pay stubs. */
  federalWithheld: amount,
  stateWithheld: amount,
  /** Estimated tax payments made for the year. */
  federalEstimatedPayments: amount,
  stateEstimatedPayments: amount,
  propertyTax: amount,
  /** Mortgage interest, charity and other itemized deductions, apart from state and local taxes. */
  otherItemized: amount,
  /** Effective state rate, in percent, for states Meld has no tables for. */
  stateFlatRate: z.number().min(0).max(20).nullable(),
  /** Realized gains from your broker's statements, in place of Meld's estimate. */
  realizedGainsOverride: z.object({ shortTerm: z.number(), longTerm: z.number() }).nullable(),
  /** True when the user's Profile gross income already includes RSU vests for the year. */
  profileIncludesRsus: z.boolean().default(false),
});
export type TaxSettings = z.infer<typeof TaxSettings>;

export const EMPTY_TAX_SETTINGS: TaxSettings = {
  selfEmploymentIncome: null,
  otherIncome: null,
  pretax401k: null,
  hsaContributions: null,
  hsaCoverage: null,
  coveredByWorkplacePlan: null,
  federalWithheld: null,
  stateWithheld: null,
  federalEstimatedPayments: null,
  stateEstimatedPayments: null,
  propertyTax: null,
  otherItemized: null,
  stateFlatRate: null,
  realizedGainsOverride: null,
  profileIncludesRsus: false,
};

/** Income for the full year, as projected. */
export const TaxIncome = z.object({
  wages: z.number(),
  /** W-2 ordinary income from RSU vests (vested YTD + remaining scheduled this year). */
  rsuVesting: z.number(),
  selfEmployment: z.number(),
  interest: z.number(),
  ordinaryDividends: z.number(),
  qualifiedDividends: z.number(),
  /** Net short- and long-term capital gains, after netting; a net loss shows as negative. */
  shortTermGains: z.number(),
  longTermGains: z.number(),
  other: z.number(),
  /** Pre-tax retirement and HSA money that never shows up in taxable income. */
  pretax401k: z.number(),
  hsa: z.number(),
});
export type TaxIncome = z.infer<typeof TaxIncome>;

export const BracketSlice = z.object({ rate: z.number(), from: z.number(), upTo: z.number().nullable(), taxed: z.number() });
export type BracketSlice = z.infer<typeof BracketSlice>;

export const FederalTax = z.object({
  agi: z.number(),
  deduction: z.number(),
  itemized: z.boolean(),
  taxableIncome: z.number(),
  /** Taxable income at ordinary rates; the rest is long-term gains and qualified dividends. */
  ordinaryIncome: z.number(),
  ordinaryTax: z.number(),
  capitalGainsTax: z.number(),
  netInvestmentIncomeTax: z.number(),
  additionalMedicareTax: z.number(),
  selfEmploymentTax: z.number(),
  childTaxCredit: z.number(),
  total: z.number(),
  /** The ordinary bracket the next dollar of income lands in. */
  bracketRate: z.number(),
  /** Ordinary income that still fits in the current bracket; null in the top one. */
  bracketRoom: z.number().nullable(),
  brackets: z.array(BracketSlice),
  /** Long-term gains that would still be taxed at 0%. */
  zeroRateGainRoom: z.number(),
});
export type FederalTax = z.infer<typeof FederalTax>;

export const StateTax = z.object({
  state: z.string(),
  /** 'tables': Meld's bracket tables; 'flat': your effective rate; 'none': the state has no income tax. */
  method: z.enum(['tables', 'flat', 'none']),
  /** The year of the tables used, when they're not the tax year's. */
  tablesYear: z.number().nullable(),
  taxableIncome: z.number(),
  total: z.number(),
  bracketRate: z.number(),
});
export type StateTax = z.infer<typeof StateTax>;

export const HarvestCandidate = z.object({
  accountName: z.string(),
  ticker: z.string().nullable(),
  name: z.string().nullable(),
  value: z.number(),
  costBasis: z.number(),
  /** Negative: the unrealized loss. */
  gain: z.number(),
  /** Share of the position bought within the last year (short-term), 0–1. */
  shortTermShare: z.number(),
  /** The latest purchase in any account within 30 days, which would make selling at a loss a wash sale. */
  recentPurchase: z.iso.date().nullable(),
  /** An RSU vest in the last 30 days for the same ticker (acquisition for wash-sale rules). */
  recentVest: z.iso.date().nullable().default(null),
  /** A scheduled RSU vest in the next 30 days for the same ticker (acquisition for wash-sale rules). */
  upcomingVest: z.iso.date().nullable().default(null),
});
export type HarvestCandidate = z.infer<typeof HarvestCandidate>;

export const TaxSuggestion = z.object({
  id: z.string(),
  kind: z.enum(['save', 'warning', 'info']),
  title: z.string(),
  detail: z.string(),
  /** Estimated tax saved this year (negative: a cost now), or null when it isn't a this-year saving. */
  impact: z.number().nullable(),
  /** What to ask Ask Meld to go further. */
  question: z.string(),
});
export type TaxSuggestion = z.infer<typeof TaxSuggestion>;

/** A move with a date on it: what to do, by when, and what it's worth. */
export const ChecklistItem = z.object({
  /** Stable within a year, so a tick sticks. */
  id: z.string(),
  due: z.iso.date(),
  /** What happens on the due date: "Last trading day", "Last paycheck", "Payment due", "Filing deadline". */
  dueLabel: z.string(),
  title: z.string(),
  detail: z.string(),
  /** Estimated tax saved this year, when there is one. */
  impact: z.number().nullable(),
  /** The suggestion this puts a date on, if any. */
  suggestionId: z.string().nullable(),
  /** Rests on something Meld can't see (an FSA, payroll timing), so it may not apply. */
  general: z.boolean(),
  /** Ticked off. */
  done: z.boolean(),
  question: z.string(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const ChecklistDone = z.object({ id: z.string().min(1).max(60), done: z.boolean() });
export type ChecklistDone = z.infer<typeof ChecklistDone>;

export const TaxPlan = z.object({
  year: z.number(),
  asOf: z.iso.date(),
  /** Share of the year gone, 0–1; past years are 1. */
  elapsed: z.number(),
  /** The year of the federal tables used, when they're not the tax year's. */
  federalTablesYear: z.number().nullable(),
  filingStatus: FilingStatus.nullable(),
  /** What's needed before there's an estimate: 'filingStatus', 'income'. */
  missing: z.array(z.enum(['filingStatus', 'income'])),
  settings: TaxSettings,
  /** What Meld found in synced accounts so far this year (your ownership share). */
  detected: z.object({
    paychecks: z.number(),
    contractorDeposits: z.number(),
    interest: z.number(),
    ordinaryDividends: z.number(),
    qualifiedDividends: z.number(),
    capitalGainDistributions: z.number(),
    realizedShortTerm: z.number(),
    realizedLongTerm: z.number(),
    /** The realized gains rest on transactions that didn't add up, so treat them as rough. */
    realizedRough: z.boolean(),
    sales: z.number(),
    k401Contributions: z.number(),
    k401Accounts: z.number(),
    hsaContributions: z.number(),
    hsaAccount: z.boolean(),
    iraContributions: z.number(),
    rothContributions: z.number(),
    /** Pre-tax IRA balances, which make a backdoor Roth partly taxable. */
    traditionalIraBalance: z.number(),
    has529: z.boolean(),
    rsuVestedYtd: z.number(),
    rsuScheduledRemaining: z.number(),
    rsuWithheldYtd: z.number(),
    rsuProjectedWithholdingRemaining: z.number(),
    rsuWithholdingGap: z.number(),
    rsuZeroBasisTickers: z.array(z.string()),
  }),
  income: TaxIncome.nullable(),
  federal: FederalTax.nullable(),
  state: StateTax.nullable(),
  totalTax: z.number().nullable(),
  /** Total tax over gross income. */
  effectiveRate: z.number().nullable(),
  /** Federal and state tax on the next $1,000 of ordinary income. */
  marginalRate: z.number().nullable(),
  /** Projected tax minus projected withholding and estimated payments; null without withholding entered. */
  balanceDue: z.number().nullable(),
  harvest: z.array(HarvestCandidate),
  suggestions: z.array(TaxSuggestion),
  /** Dated moves still ahead for this tax year, soonest first; empty once every deadline has passed. */
  checklist: z.array(ChecklistItem),
  /** Where the numbers rest on assumptions. */
  notes: z.array(z.string()),
});
export type TaxPlan = z.infer<typeof TaxPlan>;
