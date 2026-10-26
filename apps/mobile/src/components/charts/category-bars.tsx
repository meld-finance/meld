import type { CategorySpend } from '@meld/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCategory, formatCurrency } from '@/lib/format';

const MAX_ROWS = 6;

/** Ranked horizontal bars, one hue (magnitude), value at each bar's tip. */
export function CategoryBars({ spending }: { spending: CategorySpend[] }) {
  const viz = useVizColors();
  const top = spending.slice(0, MAX_ROWS);
  const rest = spending.slice(MAX_ROWS).reduce((sum, s) => sum + s.amount, 0);
  const rows = rest > 0 ? [...top, { category: 'Other', amount: rest }] : top;
  const max = Math.max(...rows.map((r) => r.amount), 1);

  return (
    <View style={styles.list}>
      {rows.map((r) => (
        <View key={r.category} style={styles.row}>
          <ThemedText type="small" style={styles.label} numberOfLines={1}>
            {r.category === 'Other' ? 'Other' : formatCategory(r.category)}
          </ThemedText>
          <View style={styles.barArea}>
            <View style={[styles.bar, { width: `${(r.amount / max) * 100}%`, backgroundColor: viz.series1 }]} />
          </View>
          <ThemedText type="small" style={styles.value}>
            {formatCurrency(r.amount)}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { width: 130 },
  barArea: { flex: 1 },
  // Square at the baseline (left), 4px rounded at the data end.
  bar: { height: 12, minWidth: 2, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  value: { width: 90, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
