import { z } from 'zod';

/** Months of spending an emergency fund covers when the user hasn't picked a number. */
export const DEFAULT_EMERGENCY_MONTHS = 6;

/** Cash-like ETFs (T-bills, floating-rate Treasuries, box spreads), counted as cash wherever they're held. */
export const CASH_ETFS = new Set(['SGOV', 'BIL', 'BILS', 'SHV', 'USFR', 'TFLO', 'TBIL', 'XBIL', 'GBIL', 'CLIP', 'BOXX', 'ICSH']);

/** Bank account subtypes you can draw on any day; CDs and HSAs aren't. */
export const LIQUID_BANK_SUBTYPES = new Set(['checking', 'savings', 'money market', 'cash management', 'paypal']);

/** Settings for the cash page. Rates are entered in percent. */
export const CashSettings = z.object({
  /** How many months of spending the emergency fund should cover; null means DEFAULT_EMERGENCY_MONTHS. */
  emergencyMonths: z.number().min(0).max(60).nullable(),
  /** Monthly spending to plan around, in place of the average from history. */
  monthlySpending: z.number().nonnegative().nullable(),
  /** What a high-yield account pays now, in percent, in place of the 3-month Treasury yield. */
  benchmarkApyPercent: z.number().min(0).max(20).nullable(),
  /** Rates you entered, in percent, by position key. */
  apyPercent: z.record(z.string(), z.number().min(0).max(20)),
  /** Positions set aside for something else (a down payment, taxes), left out of the emergency fund. */
  earmarked: z.array(z.string()),
});
export type CashSettings = z.infer<typeof CashSettings>;

export const EMPTY_CASH_SETTINGS: CashSettings = {
  emergencyMonths: null,
  monthlySpending: null,
  benchmarkApyPercent: null,
  apyPercent: {},
  earmarked: [],
};

/**
 * Where a rate came from: 'entered' by you; 'interest' paid into a bank account lately;
 * 'distributions' of a fund over the last year; 'assumed' for a money market fund with no
 * data, taken to pay about the Treasury rate.
 */
export const ApySource = z.enum(['entered', 'interest', 'distributions', 'assumed']);
export type ApySource = z.infer<typeof ApySource>;

export const CashPosition = z.object({
  /** An account id for a bank account; `<accountId>:<securityId>` for a holding. */
  key: z.string(),
  /** 'bank': checking, savings…; 'fund': a money market fund or cash ETF; 'sweep': a brokerage's uninvested cash. */
  kind: z.enum(['bank', 'fund', 'sweep']),
  accountId: z.string().uuid(),
  accountName: z.string(),
  institutionName: z.string().nullable(),
  accountSubtype: z.string().nullable(),
  ticker: z.string().nullable(),
  name: z.string().nullable(),
  /** Your ownership share. */
  value: z.number(),
  /** Yearly rate as a fraction (0.04 is 4%); null when unknown. */
  apy: z.number().nullable(),
  apySource: ApySource.nullable(),
  /** Held in a retirement, HSA or education account, so not there for emergencies. */
  taxAdvantaged: z.boolean(),
  earmarked: z.boolean(),
});
export type CashPosition = z.infer<typeof CashPosition>;

export const CashSuggestion = z.object({
  id: z.string(),
  /** 'earn': move to a better rate; 'invest': more than needed; 'warning': short of the target; 'info': something missing. */
  kind: z.enum(['earn', 'invest', 'warning', 'info']),
  title: z.string(),
  detail: z.string(),
  /** Extra interest a year, when the suggestion has one. */
  impact: z.number().nullable(),
  /** What to ask Ask Meld to go further. */
  question: z.string(),
});
export type CashSuggestion = z.infer<typeof CashSuggestion>;

export const CashPlan = z.object({
  asOf: z.iso.date(),
  settings: CashSettings,
  /** Largest first. */
  positions: z.array(CashPosition),
  totals: z.object({
    /** Cash you could use in an emergency: not tax-advantaged, not earmarked. */
    emergency: z.number(),
    earmarked: z.number(),
    taxAdvantaged: z.number(),
    /** Value-weighted rate across emergency and earmarked cash with a known rate. */
    apy: z.number().nullable(),
    /** Interest a year at today's rates, on cash with a known rate. */
    yearlyInterest: z.number(),
    /** Extra a year from moving low-earning cash to the benchmark rate. */
    missedInterest: z.number(),
  }),
  benchmark: z.object({
    /** What high-yield savings and money market funds pay now, as a fraction; null when unknown. */
    apy: z.number().nullable(),
    source: z.enum(['entered', 'treasury']).nullable(),
  }),
  spending: z.object({
    /** What the plan uses: entered, else the average; null without either. */
    monthly: z.number().nullable(),
    source: z.enum(['entered', 'history']).nullable(),
    /** Average over complete months with spending, up to the last 12. */
    average: z.number().nullable(),
    months: z.number(),
  }),
  emergency: z.object({
    targetMonths: z.number(),
    target: z.number().nullable(),
    /** Months of spending your emergency cash covers. */
    runwayMonths: z.number().nullable(),
    /** Emergency cash minus the target: positive is extra, negative is short. */
    gap: z.number().nullable(),
  }),
  suggestions: z.array(CashSuggestion),
});
export type CashPlan = z.infer<typeof CashPlan>;
