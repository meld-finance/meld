import type { AssetClass, BondType, Exposure, Holding, IncomeTotals, Region, Sector } from '@meld/shared';

import { currentMonth, formatDate, shiftMonth } from '@/lib/format';

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  us_stocks: 'US stocks',
  intl_stocks: 'International stocks',
  bonds: 'Bonds',
  cash: 'Cash & money market',
  other: 'Other',
};

export const SECTOR_LABELS: Record<Sector, string> = {
  technology: 'Technology',
  financials: 'Financials',
  healthcare: 'Healthcare',
  consumer_discretionary: 'Consumer discretionary',
  industrials: 'Industrials',
  communication_services: 'Communication services',
  consumer_staples: 'Consumer staples',
  energy: 'Energy',
  utilities: 'Utilities',
  real_estate: 'Real estate',
  materials: 'Materials',
};

export const REGION_LABELS: Record<Region, string> = {
  united_states: 'United States',
  canada: 'Canada',
  europe: 'Europe',
  japan: 'Japan',
  asia_pacific: 'Asia Pacific ex-Japan',
  emerging_markets: 'Emerging markets',
  other: 'Other regions',
};

export const BOND_TYPE_LABELS: Record<BondType, string> = {
  treasury: 'US Treasury',
  government_related: 'Government-related',
  mortgage_backed: 'Mortgage-backed',
  corporate: 'Corporate',
  municipal: 'Municipal',
  international: 'International',
  other: 'Other bonds',
};

/** Fixed slots in the categorical palette, so a class keeps its color everywhere. */
export const ASSET_CLASS_SLOTS: Record<AssetClass, number> = { us_stocks: 0, intl_stocks: 6, bonds: 1, cash: 3, other: 2 };

/** Not yet looked up; drawn in the palette's "other" gray. */
export const UNCLASSIFIED = '__unclassified';

export type ExposureRow = { key: string; label: string; amount: number };

/** Rows largest first; anything under `known` of `base` becomes a trailing "Unknown" row. */
export function exposureRows<K extends string>(
  weights: Partial<Record<K, number>>,
  labels: Record<K, string>,
  base?: { total: number; known: number; label: string },
): ExposureRow[] {
  const rows: ExposureRow[] = (Object.entries(weights) as [K, number][])
    .filter(([, amount]) => amount >= 0.5)
    .map(([key, amount]) => ({ key, label: labels[key], amount }))
    .sort((a, b) => b.amount - a.amount);
  const unknown = base ? base.total - base.known : 0;
  if (base && unknown >= 0.5) rows.push({ key: UNCLASSIFIED, label: base.label, amount: unknown });
  return rows;
}

export function assetClassRows(e: Exposure): ExposureRow[] {
  const order: AssetClass[] = ['us_stocks', 'intl_stocks', 'bonds', 'cash', 'other'];
  const rows: ExposureRow[] = order
    .filter((k) => (e.assetClasses[k] ?? 0) >= 0.5)
    .map((k) => ({ key: k, label: ASSET_CLASS_LABELS[k], amount: e.assetClasses[k]! }));
  if (e.unclassified >= 0.5) rows.push({ key: UNCLASSIFIED, label: 'Not yet looked up', amount: e.unclassified });
  return rows;
}

/** "26%" with one decimal under 10%, e.g. "4.8%". */
export function formatShare(part: number, whole: number): string {
  if (!whole) return '—';
  const pct = (part / whole) * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct < 10 ? pct.toFixed(1).replace(/\.0$/, '') : Math.round(pct)}%`;
}

/** What a holding is, for the holdings table. */
export function holdingCategory(h: Holding): string {
  return h.profile?.category ?? (h.securityType === 'cash' ? 'Cash' : '—');
}

export function gainPercent(h: Pick<Holding, 'value' | 'costBasis' | 'securityType'>): number | null {
  if (h.securityType === 'cash' || h.value === null || h.costBasis === null || h.costBasis <= 0) return null;
  return ((h.value - h.costBasis) / h.costBasis) * 100;
}

/** "6 months ago" when the comparison snapshot is that old, else its date. */
export function changeAgainst(since: string): string {
  return since.slice(0, 7) <= shiftMonth(currentMonth(), -6) ? '6 months ago' : formatDate(since);
}

export const incomeOf = (t: IncomeTotals) => t.dividends + t.interest;
/** Income that wasn't reinvested: left as cash or paid out. */
export const paidOutOf = (t: IncomeTotals) => Math.max(incomeOf(t) - t.reinvested, 0);

export type InvestmentInsight = { title: string; body: string; question: string };

/** One headline about diversification and the largest concentration. */
export function overviewInsight(e: Exposure): InvestmentInsight | null {
  const known = e.total - e.unclassified;
  if (known <= 0) return null;
  const classes = Object.values(e.assetClasses).filter((v) => v! / known >= 0.05).length;
  const intl = (e.assetClasses.intl_stocks ?? 0) / Math.max(e.stocks, 1);
  const [topSector, topAmount] = (Object.entries(e.sectors) as [Sector, number][]).sort((a, b) => b[1] - a[1])[0] ?? [];
  const title =
    classes >= 3 && intl >= 0.1
      ? 'Your portfolio is diversified across asset classes and regions.'
      : classes >= 3
        ? 'Your portfolio spans several asset classes, but little is outside the US.'
        : 'Your portfolio is concentrated in a few asset classes.';
  if (!topSector || !e.sectorsKnown) {
    return { title, body: 'Would you like to explore how it’s balanced?', question: 'How diversified is my investment portfolio?' };
  }
  const share = formatShare(topAmount!, e.sectorsKnown);
  const label = SECTOR_LABELS[topSector].toLowerCase();
  return {
    title,
    body: `Your biggest concentration is ${label} (${share} of your stock exposure). Would you like to explore this further?`,
    question: `My portfolio has ${share} of its stock exposure in ${label}. Is that too concentrated, and what could I do about it?`,
  };
}
