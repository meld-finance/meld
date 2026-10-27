import {
  isDisabilityPolicy,
  isLapsed,
  isLifePolicy,
  PAYMENTS_PER_YEAR,
  type InsurancePolicy,
  type LiabilityKind,
  type LiabilitySummary,
} from '@meld/shared';

import type { Accent } from '@/constants/theme';
import type { IconName } from '@/components/icon';

export type UpcomingPayment = {
  key: string;
  label: string;
  /** Account name or carrier. */
  detail: string;
  amount: number | null;
  /** YYYY-MM-DD */
  dueDate: string;
  icon: IconName;
  accent: Accent;
  href: `/account/${string}` | `/insurance/${string}`;
};

const LIABILITY_LABELS: Record<LiabilityKind, string> = {
  mortgage: 'Mortgage',
  credit: 'Credit card',
  student: 'Student loan',
  loan: 'Loan',
  line_of_credit: 'Line of credit',
};

const iso = (d: Date) => d.toLocaleDateString('en-CA');

/** A due date this far in the past is stale data (e.g. a closed loan), not an overdue bill. */
const STALE_AFTER_DAYS = 31;

/** `start` + n×`months`, clamping the day to the target month's length (Jan 31 + 1 → Feb 28). */
function addMonths(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(y, m - 1 + months + 1, 0).getDate();
  return iso(new Date(y, m - 1 + months, Math.min(d, lastDay)));
}

/** The first premium date on or after `today`, stepping from the policy's effective date. */
export function nextPremiumDate(effectiveDate: string, paymentsPerYear: number, today: string): string {
  const step = 12 / paymentsPerYear;
  const [ey, em] = effectiveDate.split('-').map(Number) as [number, number];
  const [ty, tm] = today.split('-').map(Number) as [number, number];
  // Jump close to today, then walk forward; never before the effective date.
  let n = Math.max(0, Math.floor(((ty - ey) * 12 + (tm - em)) / step) - 1);
  let date = addMonths(effectiveDate, n * step);
  while (date < today) date = addMonths(effectiveDate, ++n * step);
  return date;
}

/**
 * Scheduled loan/card payments and self-paid insurance premiums, soonest first.
 * Employer-provided policies are skipped: those premiums come out of payroll.
 */
export function upcomingPayments(
  liabilities: LiabilitySummary[],
  policies: InsurancePolicy[],
  today = iso(new Date()),
): UpcomingPayment[] {
  const staleBefore = new Date(`${today}T00:00:00`);
  staleBefore.setDate(staleBefore.getDate() - STALE_AFTER_DAYS);
  const loans = liabilities
    .filter((l) => l.nextPaymentDueDate && l.nextPaymentDueDate >= iso(staleBefore))
    .map(
      (l): UpcomingPayment => ({
        key: `loan-${l.accountId}`,
        label: LIABILITY_LABELS[l.kind],
        detail: l.accountName,
        amount: l.minimumPayment,
        dueDate: l.nextPaymentDueDate!,
        icon: l.kind === 'mortgage' ? 'home' : l.kind === 'credit' ? 'card' : 'bank',
        accent: l.kind === 'mortgage' ? 'orange' : l.kind === 'credit' ? 'green' : 'blue',
        href: `/account/${l.accountId}`,
      }),
    );
  const premiums = policies
    .filter((p) => p.premiumAmount && p.premiumFrequency && p.effectiveDate && !p.employerProvided && !isLapsed(p, today))
    .map(
      (p): UpcomingPayment => ({
        key: `policy-${p.id}`,
        label: isLifePolicy(p.type) ? 'Life insurance' : isDisabilityPolicy(p.type) ? 'Disability insurance' : 'Insurance',
        detail: p.carrier,
        amount: p.premiumAmount,
        dueDate: nextPremiumDate(p.effectiveDate!, PAYMENTS_PER_YEAR[p.premiumFrequency!], today),
        icon: 'shield',
        accent: 'teal',
        href: `/insurance/${p.id}`,
      }),
    );
  return [...loans, ...premiums].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
