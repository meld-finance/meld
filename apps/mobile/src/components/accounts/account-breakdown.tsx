import type { NetWorthSummary } from '@meld/shared';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Donut } from '@/components/charts/donut';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency } from '@/lib/format';

type ByType = NetWorthSummary['byType'][number]['type'];

/** What you own, in fixed slot order so each kind keeps its color. */
const SLICES: { label: string; types: ByType[] }[] = [
  { label: 'Investments', types: ['investment'] },
  { label: 'Banking', types: ['depository'] },
  { label: 'Insurance', types: ['insurance'] },
  { label: 'Property & other', types: ['manual', 'other'] },
];

/** Where your assets sit, with what you owe listed under the ring. */
export function AccountBreakdown({ summary, style }: { summary: NetWorthSummary; style?: object }) {
  const viz = useVizColors();
  const sum = (types: ByType[]) =>
    summary.byType.filter((t) => types.includes(t.type)).reduce((s, t) => s + t.total, 0);
  const parts = SLICES.map((s, i) => ({ key: s.label, amount: sum(s.types), color: viz.categorical[i]! })).filter(
    (p) => p.amount > 0,
  );
  const owed = [
    { label: 'Credit cards', amount: sum(['credit']) },
    { label: 'Loans & mortgages', amount: sum(['loan', 'mortgage']) },
  ].filter((o) => o.amount > 0);

  return (
    <Card title="Account breakdown" subtitle="What you own across all accounts" style={style}>
      <View style={styles.body}>
        <Donut parts={parts} size={156} stroke={22}>
          <ThemedText style={styles.total}>{formatCompactCurrency(summary.assets)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
            Assets
          </ThemedText>
        </Donut>
        <View style={styles.legend}>
          {parts.map((p) => (
            <View key={p.key} style={styles.row} accessibilityLabel={`${p.key}: ${formatCompactCurrency(p.amount)}`}>
              <View style={[styles.dot, { backgroundColor: p.color }]} />
              <ThemedText type="small" style={styles.label} numberOfLines={1}>
                {p.key}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.pct}>
                {formatShare(p.amount / (summary.assets || 1))}
              </ThemedText>
              <ThemedText type="small" style={styles.amount}>
                {formatCompactCurrency(p.amount)}
              </ThemedText>
            </View>
          ))}
          {owed.map((o) => (
            <View key={o.label} style={styles.row}>
              <View style={[styles.dot, styles.owedDot, { borderColor: viz.other }]} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.label} numberOfLines={1}>
                {o.label} owed
              </ThemedText>
              <ThemedText type="small" themeColor="negative" style={styles.amount}>
                −{formatCompactCurrency(o.amount)}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

/** 0.88 → "88%", 0.001 → "0.1%". */
function formatShare(share: number) {
  const pct = share * 100;
  return pct > 0 && pct < 1 ? `${Math.max(pct, 0.1).toFixed(1)}%` : `${Math.round(pct)}%`;
}

const styles = StyleSheet.create({
  body: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  total: { fontSize: 18, lineHeight: 24, fontWeight: 700 },
  caption: { fontSize: 12, lineHeight: 16 },
  // Wide enough that labels stay readable; wraps under the ring in a narrow column.
  legend: { flexGrow: 1, flexBasis: 220, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5 },
  owedDot: { borderWidth: 2 },
  label: { flex: 1 },
  pct: { width: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },
  amount: { minWidth: 56, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
