import { z } from 'zod';

export const Cadence = z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual']);
export type Cadence = z.infer<typeof Cadence>;

/** Average days between charges, for converting to a monthly cost. */
export const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.44,
  quarterly: 91.31,
  semiannual: 182.62,
  annual: 365.25,
};

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  semiannual: 'Every 6 months',
  annual: 'Yearly',
};

/** 'subscription': a service you could cancel; 'bill': utilities, insurance, loans, rent; 'income': money coming in. */
export const RecurringKind = z.enum(['subscription', 'bill', 'income']);
export type RecurringKind = z.infer<typeof RecurringKind>;

export const RecurringSeries = z.object({
  /** Stable id for the series, built from the merchant (and amount, when a merchant has several). */
  key: z.string(),
  name: z.string(),
  kind: RecurringKind,
  /** The kind Meld guessed, before any change you made. */
  detectedKind: RecurringKind,
  cadence: Cadence,
  /** The latest charge, positive for both money out and money in. */
  amount: z.number(),
  /** Amounts vary from charge to charge (a utility bill), so `amount` is a typical one. */
  amountVaries: z.boolean(),
  /** About what this costs (or brings in) per month. */
  monthlyAmount: z.number(),
  accountId: z.uuid(),
  accountName: z.string(),
  category: z.string().nullable(),
  firstDate: z.string(),
  lastDate: z.string(),
  /** When the next charge is expected. */
  nextDate: z.string(),
  occurrences: z.number().int(),
  /** 'active': still charging; 'stopped': it's missed enough charges that it may have been canceled; 'ignored': you said it isn't recurring. */
  status: z.enum(['active', 'stopped', 'ignored']),
  /** The last charge differs from the one before it, on a series whose amount was otherwise steady. */
  priceChange: z.object({ from: z.number(), to: z.number(), date: z.string() }).nullable(),
  /** Text to search transactions for to see the charges. */
  search: z.string(),
  /** The last few charges, newest first. */
  recent: z.array(z.object({ date: z.string(), amount: z.number() })),
});
export type RecurringSeries = z.infer<typeof RecurringSeries>;

/** Your corrections to a detected series. */
export const RecurringOverride = z.object({
  ignored: z.boolean().optional(),
  kind: RecurringKind.nullable().optional(),
  name: z.string().trim().max(80).nullable().optional(),
});
export type RecurringOverride = z.infer<typeof RecurringOverride>;

// --- Autopay ----------------------------------------------------------------

/** How much the autopay takes each cycle. */
export const AutopayAmount = z.enum(['statement_balance', 'minimum', 'current_balance', 'fixed']);
export type AutopayAmount = z.infer<typeof AutopayAmount>;

export const AUTOPAY_AMOUNT_LABELS: Record<AutopayAmount, string> = {
  statement_balance: 'Statement balance',
  minimum: 'Minimum payment',
  current_balance: 'Current balance',
  fixed: 'Fixed amount',
};

export const AutopayLinkInput = z
  .object({
    /** The card or loan being paid. */
    payeeAccountId: z.uuid(),
    /** The bank account the payment comes out of. */
    fundingAccountId: z.uuid(),
    amountRule: AutopayAmount,
    fixedAmount: z.number().positive().nullable(),
  })
  .refine((l) => l.amountRule !== 'fixed' || l.fixedAmount !== null, { message: 'Enter the fixed amount', path: ['fixedAmount'] })
  .refine((l) => l.payeeAccountId !== l.fundingAccountId, { message: 'Pick two different accounts', path: ['fundingAccountId'] });
export type AutopayLinkInput = z.infer<typeof AutopayLinkInput>;

/**
 * 'covered': the funding account holds enough; 'tight': it does, but leaves less than your cushion;
 * 'short': it won't cover the payment; 'paid': nothing more is due this cycle; 'unknown': the amount isn't known.
 */
export const AutopayHealth = z.enum(['covered', 'tight', 'short', 'paid', 'unknown']);
export type AutopayHealth = z.infer<typeof AutopayHealth>;

/** Another payment due from the same account before this one. */
export const AutopayObligation = z.object({
  name: z.string(),
  date: z.string(),
  amount: z.number(),
  /** 'autopay': another card or loan; 'recurring': a bill or subscription charged to the account; 'income': a paycheck expected in. */
  source: z.enum(['autopay', 'recurring', 'income']),
});
export type AutopayObligation = z.infer<typeof AutopayObligation>;

export const AutopayStatus = z.object({
  id: z.uuid(),
  payeeAccountId: z.uuid(),
  payeeName: z.string(),
  payeeType: z.string(),
  fundingAccountId: z.uuid(),
  fundingName: z.string(),
  amountRule: AutopayAmount,
  fixedAmount: z.number().nullable(),
  /** The next payment: when, how much, and whether the amount is from an issued statement or an estimate. */
  dueDate: z.string().nullable(),
  amount: z.number().nullable(),
  amountSource: z.enum(['statement', 'minimum', 'balance', 'fixed', 'scheduled', 'estimate']).nullable(),
  /** Payments made since the statement, already taken off `amount`. */
  paidSinceStatement: z.number(),
  statementBalance: z.number().nullable(),
  statementDate: z.string().nullable(),
  /** The funding account's available (or current) balance now. */
  fundingBalance: z.number().nullable(),
  /** Other money in and out of the funding account before the due date. */
  before: z.array(AutopayObligation),
  /** What the funding account should hold right after this payment. */
  projectedAfter: z.number().nullable(),
  health: AutopayHealth,
  /** One plain sentence about the state, for the UI and alerts. */
  summary: z.string(),
});
export type AutopayStatus = z.infer<typeof AutopayStatus>;

/** A card or loan that looks like it's paid from a bank account each month, with no autopay set up in Meld yet. */
export const AutopaySuggestion = z.object({
  payeeAccountId: z.uuid(),
  payeeName: z.string(),
  fundingAccountId: z.uuid(),
  fundingName: z.string(),
  payments: z.number().int(),
  lastDate: z.string(),
  lastAmount: z.number(),
  /** The payments matched the statement balance, so that's the likely rule. */
  likelyRule: AutopayAmount,
});
export type AutopaySuggestion = z.infer<typeof AutopaySuggestion>;

/** Something due in the coming weeks: a recurring charge, a paycheck, or an autopay payment. */
export const UpcomingItem = z.object({
  date: z.string(),
  name: z.string(),
  /** Positive is money out, negative money in. */
  amount: z.number(),
  approximate: z.boolean(),
  accountName: z.string(),
  source: z.enum(['recurring', 'autopay']),
  kind: z.union([RecurringKind, z.literal('autopay')]),
  /** The series key or autopay link id. */
  ref: z.string(),
});
export type UpcomingItem = z.infer<typeof UpcomingItem>;

export const RecurringSummary = z.object({
  series: z.array(RecurringSeries),
  autopay: z.array(AutopayStatus),
  suggestions: z.array(AutopaySuggestion),
  upcoming: z.array(UpcomingItem),
  totals: z.object({
    /** Active subscriptions and bills, per month. */
    subscriptionsMonthly: z.number(),
    billsMonthly: z.number(),
    incomeMonthly: z.number(),
    /** Money out over the next 30 days, autopay included. */
    dueNext30: z.number(),
  }),
});
export type RecurringSummary = z.infer<typeof RecurringSummary>;
