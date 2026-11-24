import type { NetWorthPoint, NetWorthSummary } from '@meld/shared';
import { Link } from 'expo-router';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { Segmented } from '@/components/cashflow/segmented';
import { NetWorthTrend } from '@/components/charts/net-worth-trend';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatDate, formatWholeCurrency } from '@/lib/format';

export type NetWorthRange = '1M' | '3M' | '6M' | '1Y';

export const NET_WORTH_RANGE_DAYS: Record<NetWorthRange, number> = {
  '1M': 30,
  '3M': 91,
  '6M': 183,
  '1Y': 365,
};

const RANGE_LABELS: Record<NetWorthRange, string> = {
  '1M': 'vs. 1 mo',
  '3M': 'vs. 3 mo',
  '6M': 'vs. 6 mo',
  '1Y': 'vs. 1 yr',
};

const RANGE_OPTIONS: { value: NetWorthRange; label: string }[] = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
];

type Props = {
  summary: NetWorthSummary;
  points: NetWorthPoint[] | undefined;
  range: NetWorthRange;
  onRangeChange: (range: NetWorthRange) => void;
  style?: ViewStyle;
};

/** Hero Net Worth card with timeframe selector, area trend chart, and Assets vs. Debt strip. */
export function NetWorthHero({ summary, points, range, onRangeChange, style }: Props) {
  const theme = useTheme();
  const accents = useAccents();
  const viz = useVizColors();
  const dark = useColorScheme() === 'dark';

  const assets = Math.max(summary.assets, 0);
  const liabilities = Math.max(summary.liabilities, 0);
  const compositionTotal = assets + liabilities;
  const assetPct = compositionTotal > 0 ? (assets / compositionTotal) * 100 : 100;

  let deltaNode = null;
  if (points && points.length >= 2) {
    const first = points[0]!;
    const last = points.at(-1)!;
    const delta = last.netWorth - first.netWorth;
    const pct = first.netWorth !== 0 ? (delta / Math.abs(first.netWorth)) * 100 : null;
    const up = delta >= 0;
    const absDelta = Math.abs(delta);
    const deltaStr = absDelta >= 1000 ? formatCompactCurrency(absDelta) : formatWholeCurrency(absDelta);
    const pctStr = pct !== null && Number.isFinite(pct) ? `${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%` : null;
    const spanDays = (Date.parse(last.date) - Date.parse(first.date)) / 86_400_000;
    const since = spanDays >= NET_WORTH_RANGE_DAYS[range] - 10 ? RANGE_LABELS[range] : `since ${formatDate(first.date)}`;
    const negBg = dark ? 'rgba(242, 139, 130, 0.16)' : 'rgba(197, 34, 31, 0.10)';

    deltaNode = (
      <View style={styles.deltaRow}>
        <View style={[styles.deltaPill, { backgroundColor: up ? accents.green.bg : negBg }]}>
          <Icon name={up ? 'arrowUp' : 'arrowDown'} size={13} themeColor={up ? 'positive' : 'negative'} strokeWidth={2.4} />
          <ThemedText type="smallBold" themeColor={up ? 'positive' : 'negative'} style={styles.deltaText}>
            {[pctStr, `${up ? '+' : '-'}${deltaStr}`].filter(Boolean).join(' · ')}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.sinceText}>
          {since}
        </ThemedText>
      </View>
    );
  }

  return (
    <Card style={style}>
      <View style={styles.header}>
        <View style={styles.headline}>
          <ThemedText type="small" themeColor="textSecondary">
            Net worth
          </ThemedText>
          <View style={styles.valueWrap}>
            <ThemedText style={styles.value} numberOfLines={1}>
              {formatWholeCurrency(summary.netWorth)}
            </ThemedText>
            {deltaNode}
          </View>
        </View>
        <Segmented size="small" value={range} onChange={onRangeChange} options={RANGE_OPTIONS} />
      </View>

      <View style={styles.chartWrap}>
        {points ? (
          <NetWorthTrend points={points} height={175} />
        ) : (
          <View style={styles.chartPlaceholder}>
            <ThemedText type="small" themeColor="textSecondary">
              Loading chart…
            </ThemedText>
          </View>
        )}
      </View>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.barFill, { width: `${assetPct}%`, backgroundColor: viz.trend }]} />
          {liabilities > 0 && <View style={[styles.barFill, { width: `${100 - assetPct}%`, backgroundColor: viz.series2 }]} />}
        </View>
        <View style={styles.legendRow}>
          <View style={styles.legendItems}>
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: viz.trend }]} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>
                Assets <ThemedText type="smallBold" style={styles.legendText}>{formatCompactCurrency(summary.assets)}</ThemedText>
              </ThemedText>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: viz.series2 }]} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>
                Debt <ThemedText type="smallBold" style={styles.legendText}>{formatCompactCurrency(summary.liabilities)}</ThemedText>
              </ThemedText>
            </View>
          </View>
          <Link href="/accounts">
            <ThemedText type="small" themeColor="tint" style={styles.accountsLink}>
              Accounts →
            </ThemedText>
          </Link>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  headline: { gap: Spacing.half, flexShrink: 1, minWidth: 0 },
  valueWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three, rowGap: Spacing.one },
  value: { fontSize: 32, lineHeight: 38, fontWeight: 700, letterSpacing: -0.6 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: 999,
  },
  deltaText: { fontSize: 12, lineHeight: 16 },
  sinceText: { fontSize: 13 },
  chartWrap: { minWidth: 0 },
  chartPlaceholder: { height: 203, justifyContent: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.two },
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row' },
  barFill: { height: 6 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  legendItems: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 13, lineHeight: 18 },
  accountsLink: { fontSize: 13, fontWeight: 600 },
});
