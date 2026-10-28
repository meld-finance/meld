import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Donut } from '@/components/charts/donut';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { categoryLabel, OTHER } from '@/lib/cashflow';
import { formatWholeCurrency } from '@/lib/format';

/** Share of the period's spending by category: a donut with the total inside, plus a value legend. */
export function SpendingBreakdown({
  parts,
  total,
  slots,
  periodLabel,
  onSelect,
  style,
}: {
  parts: { category: string; amount: number }[];
  total: number;
  slots: Map<string, number>;
  periodLabel: string;
  /** Opens a category's details; "Other" isn't one category, so it doesn't open. */
  onSelect: (category: string) => void;
  style?: object;
}) {
  const theme = useTheme();
  const viz = useVizColors();
  const color = (category: string) => (category === OTHER ? viz.other : viz.categorical[slots.get(category)!]!);
  const sum = parts.reduce((s, p) => s + p.amount, 0) || 1;

  return (
    <Card title="Spending Breakdown" subtitle={periodLabel} style={style}>
      <View style={styles.donutWrap}>
        <Donut parts={parts.map((p) => ({ key: p.category, amount: p.amount, color: color(p.category) }))}>
          <ThemedText style={styles.total}>{formatWholeCurrency(total)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
            Total Spending
          </ThemedText>
        </Donut>
      </View>

      <View style={styles.legend}>
        {parts.map((p) => (
          <Pressable
            key={p.category}
            disabled={p.category === OTHER}
            onPress={() => onSelect(p.category)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole={p.category === OTHER ? undefined : 'button'}
            accessibilityLabel={`${categoryLabel(p.category)}: ${formatWholeCurrency(p.amount)}`}>
            <View style={[styles.dot, { backgroundColor: color(p.category) }]} />
            <ThemedText type="small" style={styles.label} numberOfLines={1}>
              {categoryLabel(p.category)}
            </ThemedText>
            <ThemedText type="small" style={[styles.pct, { color: theme.textSecondary }]}>
              {Math.round((p.amount / sum) * 100)}%
            </ThemedText>
            <ThemedText type="smallBold" style={styles.amount}>
              {formatWholeCurrency(p.amount)}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  donutWrap: { alignSelf: 'center' },
  total: { fontSize: 20, lineHeight: 26, fontWeight: 700 },
  caption: { fontSize: 12, lineHeight: 16 },
  legend: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { flex: 1 },
  pct: { width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.6 },
  amount: { minWidth: 76, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
