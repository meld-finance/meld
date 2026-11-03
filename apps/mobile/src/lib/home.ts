import type {
  Alert,
  AlertType,
  AutopayStatus,
  BudgetStatus,
  CashPlan,
  EstateSummary,
  InsurancePolicy,
  LiabilitySummary,
  RetirementProjection,
  TaxPlan,
  UpcomingItem,
} from '@meld/shared';

import type { IconName } from '@/components/icon';
import type { Accent } from '@/constants/theme';
import { formatCategory, formatWholeCurrency } from '@/lib/format';
import { upcomingPayments } from '@/lib/upcoming';

/** The parts of your financial life the home page reports on, each with its own page. */
export type Area = 'bills' | 'cash' | 'spending' | 'tax' | 'retirement' | 'estate' | 'insurance' | 'accounts';

export const AREAS: Record<Area, { label: string; icon: IconName; accent: Accent }> = {
  bills: { label: 'Bills', icon: 'calendar', accent: 'orange' },
  cash: { label: 'Cash', icon: 'bank', accent: 'blue' },
  spending: { label: 'Spending', icon: 'barChart', accent: 'green' },
  tax: { label: 'Tax', icon: 'receipt', accent: 'purple' },
  retirement: { label: 'Retirement', icon: 'flag', accent: 'teal' },
  estate: { label: 'Estate', icon: 'lock', accent: 'purple' },
  insurance: { label: 'Insurance', icon: 'shield', accent: 'teal' },
  accounts: { label: 'Accounts', icon: 'link', accent: 'blue' },
};

/** now: act today; soon: within a few weeks or already slipping; later: worth doing, no clock on it. */
export type Urgency = 'now' | 'soon' | 'later';
const URGENCY_ORDER: Record<Urgency, number> = { now: 0, soon: 1, later: 2 };

export type Task = {
  key: string;
  area: Area;
  urgency: Urgency;
  title: string;
  detail: string;
  /** YYYY-MM-DD, when there's a deadline. */
  due: string | null;
  dueLabel: string | null;
  /** Dollars a year (or this tax year) it's worth, when known. */
  impact: number | null;
  href: string;
  /** What to ask Meld about it. */
  question: string | null;
  /** A tax checklist item, which can be ticked off from the home page. */
  checklist: { year: number; id: string } | null;
  /** The alert it came from, which can be dismissed from the home page. */
  alertId: string | null;
};

/** A dated tax move counts as soon this many days out. */
const SOON_DAYS = 30;
/** Past this many missing-beneficiary rows, the estate shows as one task instead of one each. */
const ESTATE_GROUP_AFTER = 2;

const ALERT_AREAS: Record<AlertType, Area> = {
  autopay_short: 'bills',
  low_balance: 'cash',
  large_transaction: 'spending',
  price_increase: 'spending',
  new_recurring: 'spending',
  connection: 'accounts',
  estate: 'estate',
};

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const task = (t: Omit<Task, 'due' | 'dueLabel' | 'impact' | 'question' | 'checklist' | 'alertId'> & Partial<Task>): Task => ({
  due: null,
  dueLabel: null,
  impact: null,
  question: null,
  checklist: null,
  alertId: null,
  ...t,
});

export type TaskSources = {
  today: string;
  alerts: Alert[] | undefined;
  tax: TaxPlan | undefined;
  cash: CashPlan | undefined;
  estate: EstateSummary | undefined;
  budgets: BudgetStatus[] | undefined;
  retirement: { projection: RetirementProjection | null; missing: string[] } | undefined;
  policies: InsurancePolicy[] | undefined;
};

/**
 * Everything across Meld that wants something from you, most pressing first: open warnings, dated
 * tax moves, a short emergency fund, budgets already blown, beneficiaries to name, a retirement gap.
 * Sources still loading are left out rather than holding the list back.
 */
export function buildTasks(s: TaskSources): Task[] {
  const tasks: Task[] = [];

  // Warnings and critical alerts. Estate alerts restate the estate issues below, so they're skipped.
  for (const a of s.alerts ?? []) {
    if (a.dismissedAt || a.resolvedAt || a.severity === 'info' || a.type === 'estate') continue;
    tasks.push(
      task({
        key: `alert:${a.id}`,
        area: ALERT_AREAS[a.type],
        urgency: a.severity === 'critical' ? 'now' : 'soon',
        title: a.title,
        detail: a.body,
        href: a.href ?? '/alerts',
        alertId: a.id,
      }),
    );
  }

  if (s.tax) {
    const tax = s.tax;
    const href = '/plan?tab=tax';
    for (const c of tax.checklist) {
      if (c.done) continue;
      const days = daysBetween(s.today, c.due);
      tasks.push(
        task({
          key: `tax:${c.id}`,
          area: 'tax',
          urgency: days <= SOON_DAYS ? 'soon' : 'later',
          title: c.title,
          detail: c.detail,
          due: c.due,
          dueLabel: c.dueLabel,
          impact: c.impact,
          href,
          question: c.question,
          checklist: { year: tax.year, id: c.id },
        }),
      );
    }
    // Undated savings the checklist doesn't already put a date on.
    const dated = new Set(tax.checklist.map((c) => c.suggestionId));
    for (const t of tax.suggestions) {
      if (t.kind !== 'save' || dated.has(t.id)) continue;
      tasks.push(task({ key: `tax:${t.id}`, area: 'tax', urgency: 'later', title: t.title, detail: t.detail, impact: t.impact, href, question: t.question }));
    }
    if (tax.missing.length) {
      tasks.push(
        task({
          key: 'tax:missing',
          area: 'tax',
          urgency: 'later',
          title: `Add your ${tax.missing.map((m) => (m === 'filingStatus' ? 'filing status' : 'household income')).join(' and ')}`,
          detail: `Meld needs ${tax.missing.length === 1 ? 'it' : 'them'} to estimate your ${tax.year} taxes and price each tax move.`,
          href: '/plan?tab=profile',
        }),
      );
    }
  }

  if (s.cash) {
    for (const c of s.cash.suggestions) {
      if (c.kind === 'info') continue;
      tasks.push(
        task({
          key: `cash:${c.id}`,
          area: 'cash',
          urgency: c.kind === 'warning' ? 'soon' : 'later',
          title: c.title,
          detail: c.detail,
          impact: c.impact,
          href: '/accounts?tab=cash',
          question: c.question,
        }),
      );
    }
  }

  for (const b of s.budgets ?? []) {
    if (b.spent <= b.monthlyTarget) continue;
    tasks.push(
      task({
        key: `budget:${b.category}`,
        area: 'spending',
        urgency: 'soon',
        title: `${formatCategory(b.category)} is ${formatWholeCurrency(b.spent - b.monthlyTarget)} over budget`,
        detail: `${formatWholeCurrency(b.spent)} spent this month against a ${formatWholeCurrency(b.monthlyTarget)} target.`,
        href: '/spending?tab=budgets',
        question: `I'm over my ${formatCategory(b.category)} budget this month. Where did it go, and how can I rein it in?`,
      }),
    );
  }

  if (s.estate) {
    const warnings = s.estate.issues.filter((i) => i.severity === 'warning');
    const missing = warnings.filter((i) => i.id.startsWith('missing:'));
    const rest = warnings.filter((i) => !i.id.startsWith('missing:'));
    if (missing.length > ESTATE_GROUP_AFTER) {
      tasks.push(
        task({
          key: 'estate:missing',
          area: 'estate',
          urgency: 'later',
          title: `Name beneficiaries on ${missing.length} accounts and policies`,
          detail: 'Without one they pass through your estate and probate. Name them with each institution, then record them in Meld.',
          href: '/plan?tab=estate',
        }),
      );
    }
    for (const i of [...(missing.length > ESTATE_GROUP_AFTER ? [] : missing), ...rest]) {
      tasks.push(task({ key: `estate:${i.id}`, area: 'estate', urgency: 'later', title: i.title, detail: i.body, href: i.href ?? '/plan?tab=estate' }));
    }
  }

  if (s.retirement) {
    const { projection: p, missing } = s.retirement;
    if (missing.length) {
      tasks.push(
        task({
          key: 'retirement:missing',
          area: 'retirement',
          urgency: 'later',
          title: 'Set up your retirement plan',
          detail: `Add your ${missing.join(' and ')} to see whether your savings will last.`,
          href: missing.includes('birth year') ? '/plan?tab=profile' : '/plan?tab=retirement',
        }),
      );
    } else if (p && p.gap > 0) {
      tasks.push(
        task({
          key: 'retirement:gap',
          area: 'retirement',
          urgency: 'later',
          title: `Close a ${formatWholeCurrency(p.gap)} retirement gap`,
          detail:
            p.extraMonthly !== null
              ? `Saving about ${formatWholeCurrency(p.extraMonthly)} more a month would get you there${p.depletionAge !== null ? `; as planned, savings run out at ${p.depletionAge}` : ''}.`
              : p.depletionAge !== null
                ? `As planned, savings run out at ${p.depletionAge}.`
                : 'Your projected savings fall short of what your plan needs.',
          href: '/plan?tab=retirement',
          question: 'Look at my retirement plan. What are the most effective ways to close my retirement gap?',
        }),
      );
    }
  }

  if (s.policies && s.policies.length === 0) {
    tasks.push(
      task({
        key: 'insurance:none',
        area: 'insurance',
        urgency: 'later',
        title: 'Add your insurance policies',
        detail: 'Record life and disability coverage, including what comes through work, to check it against what your family would need.',
        href: '/insurance/new',
        question: 'How much life and disability insurance should someone in my situation have?',
      }),
    );
  }

  return tasks.sort(
    (a, b) =>
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
      (b.impact ?? 0) - (a.impact ?? 0),
  );
}

export type Upcoming = {
  key: string;
  date: string;
  name: string;
  /** Account or carrier. */
  detail: string;
  /** Positive is money out, negative money in; null when the amount isn't known. */
  amount: number | null;
  approximate: boolean;
  icon: IconName;
  href: string;
};

/**
 * Money moving in the next `days`: recurring bills, subscriptions and paychecks, autopay, loan and
 * card due dates, and insurance premiums. A loan with autopay set up shows once, as the autopay.
 */
export function buildUpcoming(
  today: string,
  days: number,
  recurring: { upcoming: UpcomingItem[]; autopay: AutopayStatus[] } | undefined,
  liabilities: LiabilitySummary[] | undefined,
  policies: InsurancePolicy[] | undefined,
): Upcoming[] {
  const until = addDays(today, days);
  const autopaid = new Set(recurring?.autopay.map((a) => a.payeeAccountId));
  const items: Upcoming[] = (recurring?.upcoming ?? []).map((u) => ({
    key: `${u.ref}:${u.date}`,
    date: u.date,
    name: u.name,
    detail: u.accountName,
    amount: u.amount,
    approximate: u.approximate,
    icon: u.kind === 'autopay' ? 'card' : u.kind === 'income' ? 'arrowDownRight' : 'repeat',
    href: '/spending?tab=recurring',
  }));
  for (const p of upcomingPayments(liabilities ?? [], policies ?? [], today)) {
    if (p.key.startsWith('loan-') && autopaid.has(p.key.slice('loan-'.length))) continue;
    items.push({
      key: p.key,
      date: p.dueDate,
      name: p.label,
      detail: p.detail,
      amount: p.amount,
      approximate: false,
      icon: p.icon,
      href: p.href,
    });
  }
  return items.filter((i) => i.date >= today && i.date <= until).sort((a, b) => a.date.localeCompare(b.date));
}
