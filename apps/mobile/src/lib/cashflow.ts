import type { CashflowPeriod, CategoryChange } from '@meld/shared';

import type { IconName } from '@/components/icon';
import type { Accent } from '@/constants/theme';
import { formatCategory, formatMonth, formatWholeCurrency } from '@/lib/format';

export type PeriodMode = 'month' | 'lastYear' | 'ytd';

export type Period = {
  from: string;
  to: string;
  /** Short name for the period, e.g. "YTD 2026". */
  label: string;
  /** What the period is compared with, e.g. "the same period in 2025". */
  comparison: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

export function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** The date range a mode covers; `month` (YYYY-MM) applies to the monthly mode. Never runs past today. */
export function periodFor(mode: PeriodMode, month: string, now = today()): Period {
  const year = Number(now.slice(0, 4));
  if (mode === 'ytd') {
    return { from: `${year}-01-01`, to: now, label: `YTD ${year}`, comparison: `the same period in ${year - 1}` };
  }
  if (mode === 'lastYear') {
    return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label: String(year - 1), comparison: String(year - 2) };
  }
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = `${month}-${pad(new Date(y, m, 0).getDate())}`;
  return {
    from: `${month}-01`,
    to: last < now ? last : now,
    label: formatMonth(month, true),
    comparison: formatMonth(`${y - 1}-${pad(m)}`, true),
  };
}

/** "2026-01-01" → "Jan 1, 2026". */
export function formatLongDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Percent change from `previous`, or null when there's nothing meaningful to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatPercent(pct: number): string {
  const abs = Math.abs(pct);
  if (abs >= 1000) return '>999%';
  return `${abs < 10 && abs > 0 ? abs.toFixed(1).replace(/\.0$/, '') : Math.round(abs)}%`;
}

/** Categories that get their own color; the rest fold into "Other". */
const MAX_NAMED = 7;
export const OTHER = '__other';

/**
 * Colors follow the category, not its rank in any one chart: the period's largest
 * categories take the categorical slots in order, and every chart on the page reuses that map.
 */
export function categorySlots(categories: CategoryChange[]): Map<string, number> {
  const named = categories.filter((c) => c.amount > 0).slice(0, MAX_NAMED);
  return new Map(named.map((c, i) => [c.category, i]));
}

export function categoryLabel(category: string): string {
  return category === OTHER ? 'Other' : formatCategory(category);
}

/** Folds amounts into the named categories plus "Other", in slot order. */
export function foldCategories(
  rows: { category: string; amount: number }[],
  slots: Map<string, number>,
): { category: string; amount: number }[] {
  const named = new Map<string, number>();
  let other = 0;
  for (const r of rows) {
    if (slots.has(r.category)) named.set(r.category, (named.get(r.category) ?? 0) + r.amount);
    else other += r.amount;
  }
  const folded = [...slots.keys()].map((category) => ({ category, amount: named.get(category) ?? 0 }));
  if (other > 0) folded.push({ category: OTHER, amount: other });
  return folded;
}

/** Categories that changed the most in dollars, either direction. */
export function topMovers(period: CashflowPeriod, count = 6): CategoryChange[] {
  return [...period.categories]
    .filter((c) => c.amount !== c.previous)
    .sort((a, b) => Math.abs(b.amount - b.previous) - Math.abs(a.amount - a.previous))
    .slice(0, count);
}

/** One line explaining a category's change, from the merchant that moved most. */
export function moverNote(change: CategoryChange): string {
  if (change.previous === 0) return 'New this period';
  if (change.amount === 0) return 'Nothing this period';
  const d = change.driver;
  if (!d) return '';
  const delta = d.amount - d.previous;
  const sign = delta > 0 ? '+' : '−';
  if (d.previous === 0) return `New: ${d.merchant} (${sign}${formatWholeCurrency(Math.abs(delta))})`;
  if (d.amount === 0) return `No ${d.merchant} this period (${sign}${formatWholeCurrency(Math.abs(delta))})`;
  return `Mostly ${d.merchant} (${sign}${formatWholeCurrency(Math.abs(delta))})`;
}

/** Everyday spending that's easiest to trim. */
const DISCRETIONARY = ['FOOD_AND_DRINK', 'ENTERTAINMENT', 'GENERAL_MERCHANDISE', 'PERSONAL_CARE', 'TRAVEL'];

export type Insight = {
  key: string;
  icon: IconName;
  accent: Accent;
  title: string;
  body: string;
  /** Opens the assistant with this question. */
  question: string;
};

/** Plain-arithmetic takeaways from the period's numbers; the assistant goes deeper on each. */
export function cashflowInsights(period: CashflowPeriod, p: Period): Insight[] {
  const insights: Insight[] = [];
  const vs = `vs. ${p.comparison}`;

  const totalPct = percentChange(period.spending, period.previousSpending);
  if (totalPct !== null && Math.abs(totalPct) >= 1) {
    const down = totalPct < 0;
    const diff = formatWholeCurrency(Math.abs(period.spending - period.previousSpending));
    insights.push({
      key: 'total',
      icon: down ? 'arrowDownRight' : 'arrowUpRight',
      accent: down ? 'green' : 'orange',
      title: `Your total spending is ${down ? 'down' : 'up'} ${formatPercent(totalPct)}`,
      body: `You’re spending ${diff} ${down ? 'less' : 'more'} than ${p.comparison}.${down ? ' Great progress!' : ''}`,
      question: `Why is my spending ${down ? 'down' : 'up'} ${formatPercent(totalPct)} for ${p.label} compared with ${p.comparison}?`,
    });
  }

  const largest = period.categories[0];
  if (largest && largest.amount > 0 && period.spending > 0) {
    const name = formatCategory(largest.category);
    const share = Math.round((largest.amount / period.spending) * 100);
    const pct = percentChange(largest.amount, largest.previous);
    const trend = pct === null || Math.abs(pct) < 1 ? '' : `, ${pct > 0 ? 'up' : 'down'} ${formatPercent(pct)} ${vs}`;
    insights.push({
      key: 'largest',
      icon: 'pie',
      accent: 'blue',
      title: `${name} is your largest expense`,
      body: `At ${share}% of total spending${trend}.`,
      question: `How could I lower my ${name.toLowerCase()} spending?`,
    });
  }

  const rising = [...period.categories]
    .filter((c) => c.previous > 0 && c.amount > c.previous && c.category !== largest?.category)
    .sort((a, b) => b.amount - b.previous - (a.amount - a.previous))[0];
  if (rising) {
    const name = formatCategory(rising.category);
    const pct = percentChange(rising.amount, rising.previous)!;
    const driver = rising.driver && rising.driver.amount > rising.driver.previous ? `, mostly ${rising.driver.merchant}` : '';
    insights.push({
      key: 'rising',
      icon: 'arrowUpRight',
      accent: 'purple',
      title: `${name} costs increased`,
      body: `Up ${formatPercent(pct)} (${formatWholeCurrency(rising.amount - rising.previous)}) ${vs}${driver}.`,
      question: `What’s causing my ${name.toLowerCase()} spending to go up?`,
    });
  }

  const discretionary = period.categories.filter((c) => DISCRETIONARY.includes(c.category) && c.amount > 0);
  const months = Math.max((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 + 1, 1) / 30.44;
  const monthlyTrim = (discretionary.reduce((s, c) => s + c.amount, 0) * 0.1) / months;
  if (monthlyTrim >= 10) {
    const amount = formatWholeCurrency(Math.round(monthlyTrim / 10) * 10);
    const names = discretionary.map((c) => formatCategory(c.category).toLowerCase()).join(', ');
    insights.push({
      key: 'save',
      icon: 'wallet',
      accent: 'green',
      title: `You could save ~${amount}/month`,
      body: `Trimming discretionary spending (${names}) by 10% would free up about ${amount} a month.`,
      question: 'Where can I cut back on discretionary spending without changing my lifestyle much?',
    });
  }

  return insights;
}
