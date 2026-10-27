const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatCurrency(amount: number | null, currency = 'USD'): string {
  if (amount === null) return '—';
  let fmt = currencyFormatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    currencyFormatters.set(currency, fmt);
  }
  return fmt.format(amount);
}

const wholeCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** $1,500,000 — for large round figures like coverage amounts. */
export function formatWholeCurrency(amount: number | null): string {
  return amount === null ? '—' : wholeCurrency.format(amount);
}

const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** $1.2K, $4.5M — for axis ticks and tight spaces. */
export function formatCompactCurrency(amount: number): string {
  return compactCurrency.format(amount);
}

/** "2026-10" → "Oct" (or "Oct 2025" with `withYear`). */
export function formatMonth(month: string, withYear = false): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: withYear ? 'numeric' : undefined,
  });
}

/** "2026-10" ± n months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(): string {
  return new Date().toLocaleDateString('en-CA').slice(0, 7);
}

/** "FOOD_AND_DRINK" → "Food and drink"; user-entered categories pass through. */
export function formatCategory(category: string | null): string {
  if (!category) return 'Uncategorized';
  if (!/^[A-Z0-9_]+$/.test(category)) return category;
  const words = category.toLowerCase().split('_');
  return words.map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
}

/** "FOOD_AND_DRINK_GROCERIES" under "FOOD_AND_DRINK" → "Groceries"; null → "Other". */
export function formatSubcategory(subcategory: string | null, category: string | null): string {
  if (!subcategory) return 'Other';
  const prefix = category ? `${category}_` : '';
  return formatCategory(prefix && subcategory.startsWith(prefix) ? subcategory.slice(prefix.length) : subcategory);
}

/** "2026-10-24" → "Oct 24" (this year) or "Oct 24, 2025". Dates are local calendar dates. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
