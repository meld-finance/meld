import {
  householdGrossIncome,
  type Alert,
  type AlertSettings,
  type AlertType,
  type AutopayHealth,
  type AutopayStatus,
  type BudgetStatus,
  type CashPlan,
  type EstateSummary,
  type InsurancePolicy,
  type LiabilitySummary,
  type ManualAsset,
  type RecurringSummary,
  type RetirementProjection,
  type TaxPlan,
  type UpcomingItem,
  type UserProfile,
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

export type TaskKind = 'alert' | 'move' | 'checklist';

export type Task = {
  key: string;
  area: Area;
  kind: TaskKind;
  urgency: Urgency;
  general: boolean;
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

const task = (
  t: Omit<Task, 'due' | 'dueLabel' | 'impact' | 'question' | 'checklist' | 'alertId' | 'general'> & Partial<Task>,
): Task => ({
  due: null,
  dueLabel: null,
  impact: null,
  question: null,
  checklist: null,
  alertId: null,
  general: false,
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
};

/**
 * Everything across Meld that wants something from you, most pressing first: open warnings, dated
 * tax moves, a short emergency fund, budgets already blown, beneficiaries to name, a retirement gap.
 * Pure setup/onboarding steps live in `buildSetupSteps` instead.
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
        kind: 'alert',
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
          kind: 'checklist',
          urgency: days <= SOON_DAYS ? 'soon' : 'later',
          general: c.general,
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
      tasks.push(
        task({
          key: `tax:${t.id}`,
          area: 'tax',
          kind: 'move',
          urgency: 'later',
          title: t.title,
          detail: t.detail,
          impact: t.impact,
          href,
          question: t.question,
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
          kind: c.kind === 'warning' ? 'alert' : 'move',
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
        kind: 'alert',
        urgency: 'soon',
        title: `${formatCategory(b.category)} is ${formatWholeCurrency(b.spent - b.monthlyTarget)} over budget`,
        detail: `${formatWholeCurrency(b.spent)} spent this month against a ${formatWholeCurrency(b.monthlyTarget)} target.`,
        href: '/spending?tab=budgets',
        question: `I'm over my ${formatCategory(b.category)} budget this month. Where did it go, and how can I rein it in?`,
      }),
    );
  }

  if (s.estate && s.estate.readiness.done > 0) {
    const warnings = s.estate.issues.filter((i) => i.severity === 'warning');
    const missing = warnings.filter((i) => i.id.startsWith('missing:'));
    const rest = warnings.filter((i) => !i.id.startsWith('missing:'));
    if (missing.length > ESTATE_GROUP_AFTER) {
      tasks.push(
        task({
          key: 'estate:missing',
          area: 'estate',
          kind: 'move',
          urgency: 'later',
          title: `Name beneficiaries on ${missing.length} accounts and policies`,
          detail: 'Without one they pass through your estate and probate. Name them with each institution, then record them in Meld.',
          href: '/plan?tab=estate',
        }),
      );
    }
    for (const i of [...(missing.length > ESTATE_GROUP_AFTER ? [] : missing), ...rest]) {
      tasks.push(
        task({
          key: `estate:${i.id}`,
          area: 'estate',
          kind: 'move',
          urgency: 'later',
          title: i.title,
          detail: i.body,
          href: i.href ?? '/plan?tab=estate',
        }),
      );
    }
  }

  if (s.retirement) {
    const { projection: p, missing } = s.retirement;
    if (!missing.length && p && p.gap > 0) {
      tasks.push(
        task({
          key: 'retirement:gap',
          area: 'retirement',
          kind: 'move',
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

  return tasks.sort((a, b) => {
    const urgencyDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;
    const generalDiff = Number(a.general) - Number(b.general);
    if (generalDiff !== 0) return generalDiff;
    if (a.urgency === 'later') {
      return (b.impact ?? 0) - (a.impact ?? 0) || (a.due ?? '9999').localeCompare(b.due ?? '9999');
    }
    return (a.due ?? '9999').localeCompare(b.due ?? '9999') || (b.impact ?? 0) - (a.impact ?? 0);
  });
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
  autopayHealth: AutopayHealth | null;
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
  const autopayById = new Map((recurring?.autopay ?? []).map((a) => [a.id, a]));
  const autopaid = new Set(recurring?.autopay.map((a) => a.payeeAccountId));
  const items: Upcoming[] = (recurring?.upcoming ?? []).map((u) => ({
    key: `${u.ref}:${u.date}`,
    date: u.date,
    name: u.name,
    detail: u.accountName,
    amount: u.amount,
    approximate: u.approximate,
    autopayHealth: u.source === 'autopay' ? (autopayById.get(u.ref)?.health ?? null) : null,
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
      autopayHealth: null,
      icon: p.icon,
      href: p.href,
    });
  }
  return items.filter((i) => i.date >= today && i.date <= until).sort((a, b) => a.date.localeCompare(b.date));
}

export type SetupStep = {
  id: string;
  area: Area;
  icon: IconName;
  title: string;
  reason: string;
  cta: string;
  href: string;
  done: boolean;
  badge: string | null;
};

export type SetupSources = {
  profile: UserProfile | undefined;
  manualAssets: ManualAsset[] | undefined;
  liabilities: LiabilitySummary[] | undefined;
  recurring: RecurringSummary | undefined;
  tax: TaxPlan | undefined;
  budgets: BudgetStatus[] | undefined;
  policies: InsurancePolicy[] | undefined;
  estate: EstateSummary | undefined;
  alertSettings: AlertSettings | undefined;
};

export type SetupProgress = {
  steps: SetupStep[];
  completed: number;
  total: number;
  remaining: SetupStep[];
};

/**
 * Guides the user toward underutilized features based on what's already synced or configured.
 * Steps appear in priority order once their backing query resolves.
 */
export function buildSetupSteps(s: SetupSources): SetupProgress {
  const steps: SetupStep[] = [];

  if (s.profile) {
    const p = s.profile;
    const missingFields: string[] = [];
    if (!householdGrossIncome(p)) missingFields.push('income');
    if (!p.filingStatus) missingFields.push('filing status');
    if (!p.state) missingFields.push('state');
    if (!p.birthYear) missingFields.push('birth year');
    steps.push({
      id: 'profile',
      area: 'accounts',
      icon: 'user',
      title: 'Complete your profile',
      reason:
        missingFields.length > 0
          ? `Add your ${missingFields.join(', ')} to unlock tax estimates, Social Security, and Ask Meld.`
          : 'Income, filing status, state, and birth year power your taxes, retirement, and Ask Meld.',
      cta: 'Complete profile',
      href: '/plan?tab=profile',
      done: missingFields.length === 0,
      badge: '1 min',
    });
  }

  if (s.liabilities && s.manualAssets && s.liabilities.some((l) => l.kind === 'mortgage')) {
    steps.push({
      id: 'home-asset',
      area: 'accounts',
      icon: 'home',
      title: 'Add your home value',
      reason: 'You linked a mortgage — adding your home keeps your net worth accurate.',
      cta: 'Add home',
      href: '/accounts',
      done: s.manualAssets.some((a) => a.kind === 'home'),
      badge: '2 min',
    });
  }

  if (
    s.recurring &&
    s.liabilities &&
    (s.liabilities.length > 0 || s.recurring.suggestions.length > 0 || s.recurring.autopay.length > 0)
  ) {
    const suggestions = s.recurring.suggestions.length;
    steps.push({
      id: 'autopay',
      area: 'bills',
      icon: 'repeat',
      title: suggestions > 0 ? `Confirm ${suggestions} detected autopay${suggestions === 1 ? '' : 's'}` : 'Track card & loan autopay',
      reason: 'Check bank balances before autopays draft so you never fall short.',
      cta: suggestions > 0 ? 'Review autopay' : 'Set up autopay',
      href: '/spending?tab=recurring',
      done: s.recurring.autopay.length > 0 && suggestions === 0,
      badge: suggestions > 0 ? `${suggestions} spotted` : '2 min',
    });
  }

  if (s.tax && s.tax.missing.length === 0) {
    steps.push({
      id: 'tax-withholding',
      area: 'tax',
      icon: 'receipt',
      title: 'Enter tax withholding',
      reason: 'Add YTD withholding from a pay stub to see if you’ll owe or get a refund.',
      cta: 'Add withholding',
      href: '/plan?tab=tax',
      done: s.tax.balanceDue !== null,
      badge: '2 min',
    });
  }

  if (s.budgets) {
    steps.push({
      id: 'budgets',
      area: 'spending',
      icon: 'barChart',
      title: 'Set monthly budgets',
      reason: 'Pick targets for your top categories to track pace and catch overspending.',
      cta: 'Create budgets',
      href: '/spending?tab=budgets',
      done: s.budgets.length > 0,
      badge: '2 min',
    });
  }

  if (s.policies) {
    steps.push({
      id: 'insurance',
      area: 'insurance',
      icon: 'shield',
      title: 'Add insurance policies',
      reason: 'Upload a PDF or log employer life and disability coverage to spot gaps.',
      cta: 'Add policy',
      href: '/insurance/new',
      done: s.policies.length > 0,
      badge: '2 min',
    });
  }

  if (s.estate && s.estate.readiness.total > 0) {
    const r = s.estate.readiness;
    const started = r.done > 0;
    steps.push({
      id: 'estate',
      area: 'estate',
      icon: 'lock',
      title: started ? 'Finish your estate packet' : 'Start your estate plan',
      reason: started
        ? `${r.done} of ${r.total} steps done — complete beneficiaries, documents, and export your family packet.`
        : 'Record beneficiaries, store key documents, and export an encrypted family packet.',
      cta: started ? 'Continue estate' : 'Start estate plan',
      href: '/plan?tab=estate',
      done: r.done >= r.total && !s.estate.packet.stale,
      badge: null,
    });
  }

  if (s.alertSettings) {
    const a = s.alertSettings;
    steps.push({
      id: 'alerts',
      area: 'bills',
      icon: 'bell',
      title: 'Set up smart alerts',
      reason: 'Get alerted on large charges, low balances, or push alerts to your phone.',
      cta: 'Configure alerts',
      href: '/alerts',
      done: Boolean(a.ntfyUrl || a.largeTransaction !== null || Object.keys(a.lowBalance).length > 0 || a.autopayCushion > 0),
      badge: '1 min',
    });
  }

  const remaining = steps.filter((step) => !step.done);
  return {
    steps,
    completed: steps.length - remaining.length,
    total: steps.length,
    remaining,
  };
}
