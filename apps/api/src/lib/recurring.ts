import {
  CADENCE_DAYS,
  type AutopayAmount,
  type AutopayHealth,
  type AutopayObligation,
  type AutopayStatus,
  type Cadence,
  type RecurringKind,
  type RecurringSeries,
} from '@meld/shared';

// --- Dates --------------------------------------------------------------------

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Same day of the month, `months` later; the 31st becomes the last day of a shorter month. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

const MONTHS_PER: Partial<Record<Cadence, number>> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/** The charge after one on `date`. */
export function nextOccurrence(date: string, cadence: Cadence): string {
  const months = MONTHS_PER[cadence];
  return months ? addMonths(date, months) : addDays(date, CADENCE_DAYS[cadence]);
}

/** Expected charge dates from `first` through `to`. */
export function occurrencesThrough(first: string, cadence: Cadence, to: string): string[] {
  const out: string[] = [];
  // Step from the anchor each time so the 31st doesn't drift to the 28th after February.
  const months = MONTHS_PER[cadence];
  for (let i = 0, d = first; d <= to && i < 60; i++) {
    out.push(d);
    d = months ? addMonths(first, months * (i + 1)) : addDays(first, CADENCE_DAYS[cadence] * (i + 1));
  }
  return out;
}

// --- Detection ----------------------------------------------------------------

/** A transaction that counts toward cash flow (no transfers or card payments), as detection reads it. */
export type RecurringTxn = {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  /** Plaid convention: positive is money out. */
  amount: number;
  name: string;
  merchantName: string | null;
  /** Effective primary category. */
  category: string | null;
  /** Plaid's detailed category. */
  detailed: string | null;
};

export type SeriesOverride = { ignored: boolean; kind: RecurringKind | null; name: string | null };

type CadenceRule = { cadence: Cadence; tolerance: number; minCount: number; allowSkip: boolean };

// Monthly charges move a few days with month lengths and weekends; a skipped month still counts.
const CADENCE_RULES: CadenceRule[] = [
  { cadence: 'weekly', tolerance: 1.5, minCount: 4, allowSkip: true },
  { cadence: 'biweekly', tolerance: 2.5, minCount: 3, allowSkip: true },
  { cadence: 'monthly', tolerance: 5, minCount: 3, allowSkip: true },
  { cadence: 'quarterly', tolerance: 10, minCount: 3, allowSkip: false },
  { cadence: 'semiannual', tolerance: 15, minCount: 2, allowSkip: false },
  { cadence: 'annual', tolerance: 20, minCount: 2, allowSkip: false },
];
const TOLERANCE = Object.fromEntries(CADENCE_RULES.map((r) => [r.cadence, r.tolerance])) as Record<Cadence, number>;

/** Words in bank descriptions that say how a charge was made, not who it was to. */
const NOISE = new Set(
  'pos ach debit credit card purchase recurring checkcard chkcard preauthorized pre authorized withdrawal electronic web online id ppd ccd des indn co inc llc ltd com www the of payment pmt pymt bill autopay auto pay visa mc ext trn xfer'.split(
    ' ',
  ),
);

/** A loose merchant identity: the merchant name, else the description without numbers, punctuation or noise words. */
export function merchantKey(t: Pick<RecurringTxn, 'name' | 'merchantName'>): string {
  const words = (t.merchantName || t.name)
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !NOISE.has(w));
  return words.slice(0, 3).join(' ') || (t.merchantName || t.name).toLowerCase().trim();
}

/** Categories whose amounts naturally move from month to month. */
const BILL_CATEGORIES = new Set(['RENT_AND_UTILITIES', 'LOAN_PAYMENTS', 'GOVERNMENT_AND_NON_PROFIT', 'MEDICAL']);
const BILL_DETAILED = /^(LOAN_PAYMENTS|RENT_AND_UTILITIES|GENERAL_SERVICES_(INSURANCE|CHILDCARE|EDUCATION))/;
/** One-off spending that can repeat at the same price by chance; two such charges a year apart aren't a subscription. */
const CHANCE_CATEGORIES = new Set(['FOOD_AND_DRINK', 'TRAVEL', 'TRANSPORTATION', 'GENERAL_MERCHANDISE', 'ENTERTAINMENT']);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Amounts within 2% of their median (and 50¢): a steady price. */
function steady(amounts: number[]): boolean {
  if (!amounts.length) return false;
  const m = median(amounts);
  return amounts.every((a) => Math.abs(a - m) <= Math.max(0.5, m * 0.02));
}

function coefficientOfVariation(xs: number[]): number {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  if (!mean) return Infinity;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
}

/** The cadence charges on these dates (sorted, unique) follow, if any. */
export function fitCadence(dates: string[]): Cadence | null {
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
  let best: { cadence: Cadence; fit: number } | null = null;
  for (const rule of CADENCE_RULES) {
    if (dates.length < rule.minCount) continue;
    const period = CADENCE_DAYS[rule.cadence];
    const exact = gaps.filter((g) => Math.abs(g - period) <= rule.tolerance).length;
    const skipped = rule.allowSkip ? gaps.filter((g) => Math.abs(g - 2 * period) <= rule.tolerance * 1.5).length : 0;
    const fit = (exact + skipped) / gaps.length;
    // Most gaps on the cadence, and at least half of them a single period.
    if (fit >= 0.75 && exact >= gaps.length / 2 && (!best || fit > best.fit)) best = { cadence: rule.cadence, fit };
  }
  return best?.cadence ?? null;
}

/** Groups amounts within 8% (and $1) of each cluster's smallest. */
function amountClusters(txns: RecurringTxn[]): RecurringTxn[][] {
  const sorted = [...txns].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
  const clusters: RecurringTxn[][] = [];
  for (const t of sorted) {
    const current = clusters.at(-1);
    const base = current ? Math.abs(current[0]!.amount) : 0;
    if (current && Math.abs(t.amount) - base <= Math.max(1, base * 0.08)) current.push(t);
    else clusters.push([t]);
  }
  return clusters;
}

/** One charge per day: two on the same day (a retry, a second item) would read as a zero-day gap. */
function onePerDay(txns: RecurringTxn[]): RecurringTxn[] {
  const byDate = new Map<string, RecurringTxn>();
  for (const t of [...txns].sort((a, b) => a.date.localeCompare(b.date))) if (!byDate.has(t.date)) byDate.set(t.date, t);
  return [...byDate.values()];
}

function detectKind(last: RecurringTxn, amountVaries: boolean): RecurringKind {
  if (last.amount < 0) return 'income';
  if ((last.category && BILL_CATEGORIES.has(last.category)) || (last.detailed && BILL_DETAILED.test(last.detailed))) return 'bill';
  return amountVaries ? 'bill' : 'subscription';
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function buildSeries(key: string, txns: RecurringTxn[], cadence: Cadence, today: string): RecurringSeries {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1)!;
  const amounts = sorted.map((t) => Math.abs(t.amount));
  const lastAmount = amounts.at(-1)!;
  const earlier = amounts.slice(0, -1);
  const steadyBefore = earlier.length >= 2 && steady(earlier);
  const amountVaries = !steadyBefore && !steady(amounts);
  const previous = earlier.at(-1);
  const priceChange =
    steadyBefore && previous !== undefined && Math.abs(lastAmount - previous) > Math.max(0.5, previous * 0.02)
      ? { from: previous, to: lastAmount, date: last.date }
      : null;
  // A steady series charges what it charged last; a varying one, about its recent median.
  const amount = round2(amountVaries ? median(amounts.slice(-3)) : lastAmount);
  const period = CADENCE_DAYS[cadence];
  const stopped = daysBetween(last.date, today) > period * 1.5 + TOLERANCE[cadence];
  const kind = detectKind(last, amountVaries);
  return {
    key,
    name: last.merchantName || titleCase(last.name.replace(/\s{2,}.*$/, '').replace(/[#*]?\d{4,}.*$/, '').trim() || last.name),
    kind,
    detectedKind: kind,
    cadence,
    amount,
    amountVaries,
    monthlyAmount: round2((amount * CADENCE_DAYS.monthly) / period),
    accountId: last.accountId,
    accountName: last.accountName,
    category: last.category,
    firstDate: sorted[0]!.date,
    lastDate: last.date,
    nextDate: nextOccurrence(last.date, cadence),
    occurrences: sorted.length,
    status: stopped ? 'stopped' : 'active',
    priceChange,
    search: last.merchantName || last.name,
    recent: sorted
      .slice(-6)
      .reverse()
      .map((t) => ({ date: t.date, amount: Math.abs(t.amount) })),
  };
}

/** Whether a merchant's whole history is one series, before trying to split it by amount. */
function acceptsWhole(txns: RecurringTxn[]): boolean {
  const last = txns.at(-1)!;
  const billLike = last.amount < 0 || detectKind(last, false) === 'bill';
  return billLike || coefficientOfVariation(txns.map((t) => Math.abs(t.amount))) <= 0.35;
}

/**
 * Finds charges (and deposits) that repeat on a schedule: same merchant, regular gaps. A merchant
 * whose history isn't one steady series (an app store with two subscriptions, a shop with a
 * membership among other purchases) is split by amount and each group tested on its own.
 */
export function detectRecurring(txns: RecurringTxn[], today: string, overrides = new Map<string, SeriesOverride>()): RecurringSeries[] {
  const groups = new Map<string, RecurringTxn[]>();
  for (const t of txns) {
    if (!t.amount) continue;
    const key = `${t.amount > 0 ? 'out' : 'in'}:${merchantKey(t)}`;
    groups.get(key)?.push(t) ?? groups.set(key, [t]);
  }

  const found: RecurringSeries[] = [];
  for (const [key, group] of groups) {
    const whole = onePerDay(group);
    const wholeCadence = fitCadence(whole.map((t) => t.date));
    if (wholeCadence && acceptsWhole(whole) && plausible(whole, wholeCadence)) {
      found.push(buildSeries(key, whole, wholeCadence, today));
      continue;
    }
    for (const cluster of amountClusters(group)) {
      const charges = onePerDay(cluster);
      const cadence = fitCadence(charges.map((t) => t.date));
      if (!cadence || !plausible(charges, cadence)) continue;
      found.push(buildSeries(`${key}:${Math.round(median(charges.map((t) => Math.abs(t.amount))))}`, charges, cadence, today));
    }
  }

  return found
    .map((s) => {
      const o = overrides.get(s.key);
      if (!o) return s;
      return { ...s, kind: o.kind ?? s.kind, name: o.name ?? s.name, status: o.ignored ? ('ignored' as const) : s.status };
    })
    .sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}

/** Two charges a long way apart are a series only at a steady price, and not for everyday spending that can repeat by chance. */
function plausible(charges: RecurringTxn[], cadence: Cadence): boolean {
  if (charges.length >= 3) return true;
  const last = charges.at(-1)!;
  if (last.category && CHANCE_CATEGORIES.has(last.category)) return false;
  return steady(charges.map((t) => Math.abs(t.amount))) && cadence !== 'weekly' && cadence !== 'biweekly';
}

// --- Autopay ------------------------------------------------------------------

/** What Plaid reports for a card, from `liabilities.details`. */
export type CardStatement = {
  last_statement_balance?: number | null;
  last_statement_issue_date?: string | null;
  last_payment_amount?: number | null;
  last_payment_date?: string | null;
};

export type PayeeInput = {
  type: string;
  /** What's owed now (positive). */
  currentBalance: number | null;
  liability: {
    kind: string;
    minimumPayment: number | null;
    nextPaymentDueDate: string | null;
    details: CardStatement | null;
  } | null;
  /** Payments the card or loan received after its last statement, from its transactions. */
  paymentsSinceStatement: number;
};

export type NextPayment = Pick<
  AutopayStatus,
  'dueDate' | 'amount' | 'amountSource' | 'paidSinceStatement' | 'statementBalance' | 'statementDate'
> & { paid: boolean };

/** The first monthly due date on or after today, rolling a past one forward. */
function rollForward(due: string, today: string): string {
  let d = due;
  for (let i = 1; d < today && i < 240; i++) d = addMonths(due, i);
  return d;
}

/**
 * The next autopay payment for a card or loan. For a card on the statement balance: the last
 * statement less what's been paid since, due on the statement's due date. Once that's paid, or
 * the due date has passed, the next statement isn't out yet, so the current balance stands in.
 */
export function nextPayment(payee: PayeeInput, rule: AutopayAmount, fixed: number | null, today: string): NextPayment {
  const l = payee.liability;
  const statement = l?.details ?? {};
  const statementBalance = statement.last_statement_balance ?? null;
  const statementDate = statement.last_statement_issue_date ?? null;
  const balance = Math.max(0, payee.currentBalance ?? 0);
  const isCard = payee.type === 'credit' || l?.kind === 'credit' || l?.kind === 'line_of_credit';

  // Plaid's last payment fills in when the card's own transactions don't show it.
  let paid = payee.paymentsSinceStatement;
  if (statementDate && statement.last_payment_date && statement.last_payment_date > statementDate) {
    paid = Math.max(paid, statement.last_payment_amount ?? 0);
  }
  paid = round2(paid);

  const due = l?.nextPaymentDueDate ?? null;
  const base = { paidSinceStatement: paid, statementBalance, statementDate };
  const amountFor = (cycleOpen: boolean): Pick<NextPayment, 'amount' | 'amountSource'> => {
    if (rule === 'fixed') return { amount: fixed, amountSource: 'fixed' };
    if (!isCard) return { amount: l?.minimumPayment ?? null, amountSource: l?.minimumPayment != null ? 'scheduled' : null };
    if (rule === 'current_balance') return { amount: balance, amountSource: 'balance' };
    if (!cycleOpen) {
      // The next statement isn't out: what's on the card now is the best guess at it.
      if (rule === 'minimum') return { amount: l?.minimumPayment ?? null, amountSource: l?.minimumPayment != null ? 'estimate' : null };
      return { amount: balance, amountSource: 'estimate' };
    }
    if (rule === 'minimum') return { amount: l?.minimumPayment ?? null, amountSource: l?.minimumPayment != null ? 'minimum' : null };
    if (statementBalance === null) return { amount: balance, amountSource: 'estimate' };
    return { amount: statementBalance, amountSource: 'statement' };
  };

  if (!due) return { ...base, dueDate: null, ...amountFor(false), paid: false };

  if (isCard && due >= today) {
    const { amount, amountSource } = amountFor(true);
    // Payments since the statement count against what this cycle's autopay will take. The
    // current balance already has them taken off; a fixed autopay is skipped once you've paid that much.
    let owed: number | null = amount;
    if (amount !== null && amountSource !== 'balance' && amountSource !== 'estimate') {
      owed = rule === 'fixed' ? (paid >= amount ? 0 : amount) : round2(Math.max(0, amount - paid));
    }
    if (owed !== null && owed <= 0.005) {
      // Paid for this statement; the next one is due about a month later.
      return { ...base, dueDate: addMonths(due, 1), ...amountFor(false), paid: true };
    }
    return { ...base, dueDate: due, amount: owed, amountSource, paid: false };
  }

  const dueDate = rollForward(due, today);
  return { ...base, dueDate, ...amountFor(false), paid: false };
}

const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export type HealthInput = {
  payment: NextPayment;
  payeeName: string;
  fundingName: string;
  fundingBalance: number | null;
  /** Other money out of (and, if counted, into) the funding account before the due date. */
  before: AutopayObligation[];
  cushion: number;
};

/** Whether the funding account covers the payment, and a sentence saying so. */
export function autopayHealth({
  payment,
  payeeName,
  fundingName,
  fundingBalance,
  before,
  cushion,
}: HealthInput): Pick<AutopayStatus, 'health' | 'projectedAfter' | 'summary'> {
  const { amount, dueDate } = payment;
  if (payment.paid) {
    return {
      health: 'paid',
      projectedAfter: null,
      summary: `This statement is paid.${dueDate ? ` The next payment is due around ${shortDate(dueDate)}.` : ''}`,
    };
  }
  if (amount === null || !dueDate) {
    return { health: 'unknown', projectedAfter: null, summary: `${payeeName} hasn’t reported its next payment yet.` };
  }
  if (fundingBalance === null) {
    return { health: 'unknown', projectedAfter: null, summary: `${fundingName} hasn’t reported a balance.` };
  }
  const out = before.filter((o) => o.source !== 'income').reduce((s, o) => s + o.amount, 0);
  const income = before.filter((o) => o.source === 'income').reduce((s, o) => s + o.amount, 0);
  const projectedAfter = round2(fundingBalance + income - out - amount);
  const health: AutopayHealth = projectedAfter < 0 ? 'short' : projectedAfter < cushion ? 'tight' : 'covered';

  const extras = [
    out > 0 ? `${dollars(out)} in other payments` : null,
    income > 0 ? `${dollars(income)} expected in` : null,
  ].filter(Boolean);
  const context = extras.length ? `, counting ${extras.join(' and ')} before then` : '';
  const due = `${dollars(amount)} due ${shortDate(dueDate)}`;
  const summary =
    health === 'short'
      ? `${fundingName} has ${dollars(fundingBalance)}, ${dollars(-projectedAfter)} short of the ${due}${context}.`
      : health === 'tight'
        ? `${fundingName} covers the ${due}${context}, but only ${dollars(projectedAfter)} would be left.`
        : `${fundingName} covers the ${due}${context}, leaving about ${dollars(projectedAfter)}.`;
  return { health, projectedAfter, summary };
}
