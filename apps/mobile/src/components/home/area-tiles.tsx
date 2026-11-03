import {
  insuranceTotals,
  type BudgetStatus,
  type CashPlan,
  type CategorySpend,
  type EstateSummary,
  type InsurancePolicy,
  type RetirementProjection,
  type TaxPlan,
} from '@meld/shared';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';
import { AREAS, type Area } from '@/lib/home';

type Status = 'good' | 'attention' | 'setup';
const STATUS: Record<Status, { label: string; color: 'positive' | 'warning' | 'textSecondary' }> = {
  good: { label: 'On track', color: 'positive' },
  attention: { label: 'Needs attention', color: 'warning' },
  setup: { label: 'Set up', color: 'textSecondary' },
};

type Tile = {
  area: Area;
  title: string;
  value: string;
  caption: string;
  status: Status | null;
  /** 0–1, drawn as a bar under the value; null for none. */
  progress: number | null;
  href: Href;
};

export type AreaSources = {
  today: string;
  cash: CashPlan | undefined;
  spending: CategorySpend[] | undefined;
  budgets: BudgetStatus[] | undefined;
  retirement: { projection: RetirementProjection | null; missing: string[] } | undefined;
  tax: TaxPlan | undefined;
  estate: EstateSummary | undefined;
  policies: InsurancePolicy[] | undefined;
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const months = (n: number) => `${n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, '')} mo`;

/** One tile per part of the plan, in the order you'd check them; a tile waits for its data. */
function buildTiles(s: AreaSources): Tile[] {
  const tiles: Tile[] = [];

  if (s.cash) {
    const e = s.cash.emergency;
    tiles.push(
      e.runwayMonths === null
        ? { area: 'cash', title: 'Emergency fund', value: formatWholeCurrency(s.cash.totals.emergency), caption: 'Add your monthly spending to size it', status: 'setup', progress: null, href: '/accounts?tab=cash' }
        : {
            area: 'cash',
            title: 'Emergency fund',
            value: months(e.runwayMonths),
            caption: `of spending covered · target ${e.targetMonths} mo`,
            status: e.gap !== null && e.gap < 0 ? 'attention' : 'good',
            progress: e.targetMonths ? clamp(e.runwayMonths / e.targetMonths) : null,
            href: '/accounts?tab=cash',
          },
    );
  }

  if (s.spending) {
    const spent = s.spending.reduce((sum, c) => sum + c.amount, 0);
    const over = (s.budgets ?? []).filter((b) => b.spent > b.monthlyTarget).length;
    const budgeted = (s.budgets ?? []).length;
    const typical = s.cash?.spending.average ?? null;
    const [y, m, d] = s.today.split('-').map(Number) as [number, number, number];
    const monthShare = d / new Date(y, m, 0).getDate();
    tiles.push({
      area: 'spending',
      title: 'Spending this month',
      value: formatWholeCurrency(spent),
      caption: [
        typical ? `of a typical ${formatWholeCurrency(typical)}` : null,
        budgeted ? (over ? `${over} of ${budgeted} budgets over` : `all ${budgeted} budgets on track`) : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'So far this month',
      // Ahead of pace when this share of a typical month is already gone with more of the month to go.
      status: over || (typical && spent > typical * Math.max(monthShare, 0.5) * 1.1) ? 'attention' : typical || budgeted ? 'good' : null,
      progress: typical ? clamp(spent / typical) : null,
      href: '/spending',
    });
  }

  if (s.retirement) {
    const { projection: p, missing } = s.retirement;
    tiles.push(
      missing.length || !p
        ? { area: 'retirement', title: 'Retirement', value: '—', caption: `Add your ${missing.join(' and ') || 'plan'} to project it`, status: 'setup', progress: null, href: '/plan?tab=retirement' }
        : p.gap <= 0
          ? {
              area: 'retirement',
              title: 'Retirement',
              value: formatCompactCurrency(p.atRetirement),
              caption: `projected at retirement · ${formatCompactCurrency(-p.gap)} to spare`,
              status: 'good',
              progress: 1,
              href: '/plan?tab=retirement',
            }
          : {
              area: 'retirement',
              title: 'Retirement',
              value: `${Math.round(clamp(p.atRetirement / p.needed) * 100)}%`,
              caption: `of what you'll need · short ${formatCompactCurrency(p.gap)}`,
              status: 'attention',
              progress: clamp(p.atRetirement / p.needed),
              href: '/plan?tab=retirement',
            },
    );
  }

  if (s.tax) {
    const t = s.tax;
    const open = t.checklist.filter((c) => !c.done).length;
    const total = t.checklist.length;
    const due = t.balanceDue;
    tiles.push({
      area: 'tax',
      title: `${t.year} taxes`,
      value:
        due !== null
          ? due > 0
            ? `Owe ~${formatWholeCurrency(due)}`
            : `Refund ~${formatWholeCurrency(-due)}`
          : t.totalTax !== null
            ? formatWholeCurrency(t.totalTax)
            : '—',
      caption: [
        due === null && t.totalTax !== null ? 'estimated tax' : null,
        total ? `${total - open} of ${total} moves done` : null,
        t.missing.length ? 'profile details missing' : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'No deadlines left this year',
      status: t.missing.length ? 'setup' : open || (due !== null && due > 0) ? 'attention' : 'good',
      progress: total ? (total - open) / total : null,
      href: '/plan?tab=tax',
    });
  }

  if (s.estate) {
    const r = s.estate.readiness;
    tiles.push({
      area: 'estate',
      title: 'Estate',
      value: r.total ? `${Math.round((r.done / r.total) * 100)}%` : '—',
      caption: `${r.done} of ${r.total} steps · ${r.documents.done} of ${r.documents.total} documents`,
      status: r.done >= r.total ? 'good' : r.done === 0 ? 'setup' : 'attention',
      progress: r.total ? r.done / r.total : null,
      href: '/plan?tab=estate',
    });
  }

  if (s.policies) {
    const totals = insuranceTotals(s.policies, s.today);
    const disability = totals.longTermDisabilityMonthly || totals.shortTermDisabilityMonthly;
    tiles.push({
      area: 'insurance',
      title: 'Insurance',
      value: totals.lifeCoverage ? formatCompactCurrency(totals.lifeCoverage) : disability ? `${formatWholeCurrency(disability)}/mo` : '—',
      caption: s.policies.length
        ? [totals.lifeCoverage ? 'life coverage' : disability ? 'disability benefit' : null, disability && totals.lifeCoverage ? `${formatWholeCurrency(disability)}/mo disability` : null, `${s.policies.length} ${s.policies.length === 1 ? 'policy' : 'policies'}`]
            .filter(Boolean)
            .join(' · ')
        : 'Add life and disability policies',
      status: s.policies.length ? null : 'setup',
      progress: null,
      href: '/plan?tab=insurance',
    });
  }

  return tiles;
}

/** How each part of your financial life is doing, one tile each, linking to its page. */
export function AreaTiles(props: AreaSources) {
  return (
    <View style={styles.grid}>
      {buildTiles(props).map((t) => (
        <AreaTile key={t.area} tile={t} />
      ))}
    </View>
  );
}

function AreaTile({ tile: t }: { tile: Tile }) {
  const theme = useTheme();
  const viz = useVizColors();
  const area = AREAS[t.area];
  const accent = useAccents()[area.accent];
  const status = t.status && STATUS[t.status];
  const fill = t.status === 'attention' ? viz.warning : t.status === 'good' ? viz.good : viz.series1;

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(t.href)}
      style={({ hovered, pressed }) => [
        styles.tile,
        { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
        pressed && styles.pressed,
      ]}>
      <View style={styles.top}>
        <View style={[styles.badge, { backgroundColor: accent.bg }]}>
          <Icon name={area.icon} size={18} color={accent.fg} />
        </View>
        <ThemedText type="small" numberOfLines={1} style={styles.title}>
          {t.title}
        </ThemedText>
        {status && (
          <ThemedText type="smallBold" themeColor={status.color} style={styles.status} numberOfLines={1}>
            {status.label}
          </ThemedText>
        )}
      </View>
      <ThemedText style={styles.value} numberOfLines={1}>
        {t.value}
      </ThemedText>
      {t.progress !== null && (
        <View
          style={[styles.track, { backgroundColor: theme.backgroundSelected }]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(t.progress * 100) }}>
          <View style={[styles.fill, { width: `${t.progress * 100}%`, backgroundColor: fill }]} />
        </View>
      )}
      <ThemedText type="small" themeColor="textSecondary" style={styles.caption} numberOfLines={2}>
        {t.caption}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 200,
    padding: Spacing.three,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    gap: Spacing.two,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { width: 32, height: 32, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 0 },
  status: { fontSize: 12 },
  value: { fontSize: 22, lineHeight: 28, fontWeight: 700, letterSpacing: -0.3 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  caption: { fontSize: 13 },
  pressed: { opacity: 0.75 },
});
