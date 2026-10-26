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

/** "FOOD_AND_DRINK" → "Food and drink"; user-entered categories pass through. */
export function formatCategory(category: string | null): string {
  if (!category) return 'Uncategorized';
  if (!/^[A-Z0-9_]+$/.test(category)) return category;
  const words = category.toLowerCase().split('_');
  return words.map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
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
