import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCurrency } from '@/lib/format';

export type RankedRow = { key: string; label: string; amount: number };

type Props = {
  rows: RankedRow[];
  /** Rows beyond this fold into "Other". */
  maxRows?: number;
  /** Show each row's share of the total next to its value. */
  showShare?: boolean;
};

/** Ranked horizontal bars, one hue (magnitude), value at each bar's tip. */
export function RankedBars({ rows, maxRows = 6, showShare }: Props) {
  const viz = useVizColors();
  const sorted = [...rows].sort((a, b) => b.amount - a.amount);
  // Folding a single leftover row into "Other" would just hide its label.
  const limit = sorted.length === maxRows + 1 ? sorted.length : maxRows;
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((sum, r) => sum + r.amount, 0);
  const shown = rest > 0 ? [...top, { key: '__other', label: 'Other', amount: rest }] : top;
  const max = Math.max(...shown.map((r) => r.amount), 1);
  const total = shown.reduce((sum, r) => sum + r.amount, 0) || 1;

  return (
    <View style={styles.list}>
      {shown.map((r) => (
        <View key={r.key} style={styles.row}>
          <ThemedText type="small" style={styles.label} numberOfLines={1}>
            {r.label}
          </ThemedText>
          <View style={styles.barArea}>
            <View style={[styles.bar, { width: `${(r.amount / max) * 100}%`, backgroundColor: viz.series1 }]} />
          </View>
          <ThemedText type="small" style={styles.value}>
            {formatCurrency(r.amount)}
            {showShare ? ` · ${Math.round((r.amount / total) * 100)}%` : ''}
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
  value: { minWidth: 90, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
