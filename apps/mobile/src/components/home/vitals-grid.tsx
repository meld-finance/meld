import type { BalanceSnapshot, BudgetStatus, CashPlan, CategorySpend, NetWorthSummary } from '@meld/shared';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Change, percentChange } from '@/components/accounts/change';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent, type ThemeColor } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatDate, formatWholeCurrency } from '@/lib/format';
import type { Upcoming } from '@/lib/home';

type ByType = NetWorthSummary['byType'][number]['type'];

const sumTypes = (byType: NetWorthSummary['byType'], types: ByType[]) =>
  byType.filter((t) => types.includes(t.type)).reduce((sum, t) => sum + t.total, 0);

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const formatMonths = (n: number) => `${n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, '')} mo`;

type Props = {
  today: string;
  summary: NetWorthSummary;
  comparison: BalanceSnapshot | null | undefined;
  cash: CashPlan | undefined;
  spending: CategorySpend[] | undefined;
  budgets: BudgetStatus[] | undefined;
  upcomingOut: number;
  upcomingCount: number;
  nextUpcoming: Upcoming | undefined;
  style?: ViewStyle;
};

type VitalCard = {
  key: string;
  label: string;
  value: string;
  icon: IconName;
  accent: Accent;
  href: Href;
  progress?: { ratio: number; color: string } | null;
  caption?: string;
  captionColor?: ThemeColor;
  changePct?: number | null;
};

/** 2×2 vital KPI grid paired beside the Net Worth chart on desktop and stacked on mobile. */
export function VitalsGrid({
  today,
  summary,
  comparison,
  cash,
  spending,
  budgets,
  upcomingOut,
  upcomingCount,
  nextUpcoming,
  style,
}: Props) {
  const viz = useVizColors();

  // 1. Liquid cash & emergency runway
  const depositoryTotal = sumTypes(summary.byType, ['depository']);
  const cashValue = cash ? cash.totals.emergency : depositoryTotal;
  const runway = cash?.emergency.runwayMonths ?? null;
  const targetMonths = cash?.emergency.targetMonths ?? null;
  const cashGap = cash?.emergency.gap ?? null;
  const cashShort = cashGap !== null && cashGap < 0;

  const cashTile: VitalCard = {
    key: 'cash',
    label: 'Liquid cash',
    value: formatWholeCurrency(cashValue),
    icon: 'bank',
    accent: 'blue',
    href: '/accounts?tab=cash',
    progress:
      runway !== null && targetMonths
        ? { ratio: clamp(runway / targetMonths), color: cashShort ? viz.warning : viz.good }
        : null,
    caption: cash
      ? runway !== null
        ? `${formatMonths(runway)} runway${cashShort && targetMonths ? ` · ${targetMonths} mo goal` : ''}`
        : 'Size emergency fund'
      : 'Checking & savings',
    captionColor: runway !== null ? (cashShort ? 'warning' : 'positive') : 'textSecondary',
  };

  // 2. Investments & 30d change
  const investmentsTotal = sumTypes(summary.byType, ['investment']);
  const prevInvestments = comparison ? sumTypes(comparison.byType, ['investment']) : null;
  const investmentsPct = percentChange(investmentsTotal, prevInvestments);

  const investmentsTile: VitalCard = {
    key: 'investments',
    label: 'Investments',
    value: formatWholeCurrency(investmentsTotal),
    icon: 'chart',
    accent: 'purple',
    href: '/accounts?tab=investments',
    changePct: investmentsPct,
    caption: investmentsPct !== null ? 'vs. 30d' : investmentsTotal === 0 ? 'Link investments →' : 'All portfolios',
    captionColor: investmentsPct === null && investmentsTotal === 0 ? 'tint' : 'textSecondary',
  };

  // 3. Spending this month & pace
  const spent = spending ? spending.reduce((sum, c) => sum + c.amount, 0) : null;
  const typical = cash?.spending.average ?? null;
  const budgeted = (budgets ?? []).length;
  const over = (budgets ?? []).filter((b) => b.spent > b.monthlyTarget).length;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const monthShare = d / new Date(y, m, 0).getDate();
  const ahead = Boolean(over > 0 || (spent !== null && typical && spent > typical * Math.max(monthShare, 0.5) * 1.1));

  const spendingTile: VitalCard = {
    key: 'spending',
    label: 'Spent this month',
    value: formatWholeCurrency(spent),
    icon: 'barChart',
    accent: 'green',
    href: '/spending',
    progress: spent !== null && typical ? { ratio: clamp(spent / typical), color: ahead ? viz.warning : viz.good } : null,
    caption:
      over > 0
        ? `${over} of ${budgeted} budgets over`
        : typical
          ? `of ~${formatWholeCurrency(typical)} typical`
          : budgeted
            ? `all ${budgeted} budgets on track`
            : 'So far this month',
    captionColor: over > 0 ? 'warning' : 'textSecondary',
  };

  // 4. Coming up in next 14 days
  const upcomingTile: VitalCard = {
    key: 'upcoming',
    label: 'Coming up (14d)',
    value: formatWholeCurrency(upcomingOut),
    icon: 'calendar',
    accent: 'orange',
    href: '/spending?tab=recurring',
    caption:
      upcomingCount > 0 && nextUpcoming
        ? `${upcomingCount} due · Next ${formatDate(nextUpcoming.date)}`
        : 'Nothing due soon',
    captionColor: 'textSecondary',
  };

  return (
    <View style={[styles.grid, style]}>
      <View style={styles.row}>
        <VitalTile tile={cashTile} />
        <VitalTile tile={investmentsTile} />
      </View>
      <View style={styles.row}>
        <VitalTile tile={spendingTile} />
        <VitalTile tile={upcomingTile} />
      </View>
    </View>
  );
}

function VitalTile({ tile }: { tile: VitalCard }) {
  const theme = useTheme();
  const accent = useAccents()[tile.accent];

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(tile.href)}
      style={({ hovered, pressed }) => [
        styles.tile,
        { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
        pressed && styles.pressed,
      ]}>
      <View style={styles.topRow}>
        <View style={[styles.badge, { backgroundColor: accent.bg }]}>
          <Icon name={tile.icon} size={18} color={accent.fg} />
        </View>
        <Icon name="chevronRight" size={15} themeColor="textSecondary" />
      </View>

      <View style={styles.middle}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.label}>
          {tile.label}
        </ThemedText>
        <ThemedText style={styles.value} numberOfLines={1}>
          {tile.value}
        </ThemedText>
      </View>

      <View style={styles.bottom}>
        {tile.progress && (
          <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
            <View style={[styles.fill, { width: `${tile.progress.ratio * 100}%`, backgroundColor: tile.progress.color }]} />
          </View>
        )}
        {tile.changePct != null ? (
          <View style={styles.changeRow}>
            <Change percent={tile.changePct} style={styles.change} />
            {tile.caption && (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.caption}>
                {tile.caption}
              </ThemedText>
            )}
          </View>
        ) : (
          tile.caption && (
            <ThemedText type="small" themeColor={tile.captionColor ?? 'textSecondary'} numberOfLines={1} style={styles.caption}>
              {tile.caption}
            </ThemedText>
          )
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { gap: Spacing.three },
  row: { flex: 1, flexDirection: 'row', gap: Spacing.three },
  tile: {
    flex: 1,
    minWidth: 0,
    padding: Spacing.three,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  middle: { gap: 2 },
  label: { fontSize: 13, lineHeight: 18 },
  value: { fontSize: 22, lineHeight: 28, fontWeight: 700, letterSpacing: -0.4 },
  bottom: { gap: 6 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  change: { justifyContent: 'flex-start' },
  caption: { fontSize: 12, lineHeight: 16 },
  pressed: { opacity: 0.75 },
});
