import type { CategoryChange } from '@meld/shared';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatPercent, moverNote, percentChange } from '@/lib/cashflow';
import { formatCategory, formatWholeCurrency } from '@/lib/format';

/** Categories whose spending changed most against the comparison period. */
export function TopMovers({
  movers,
  slots,
  periodLabel,
  comparison,
  showNotes,
  style,
}: {
  movers: CategoryChange[];
  slots: Map<string, number>;
  periodLabel: string;
  comparison: string;
  /** The notes column needs room; narrow layouts drop it. */
  showNotes: boolean;
  style?: object;
}) {
  const theme = useTheme();
  const viz = useVizColors();
  const color = (category: string) => viz.categorical[slots.get(category) ?? -1] ?? viz.other;

  return (
    <Card title="Top Movers" subtitle={`Biggest changes in spending vs. ${comparison} (${periodLabel})`} style={style}>
      {movers.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No spending to compare with {comparison} yet.
        </ThemedText>
      ) : (
        <View>
          <View style={[styles.row, styles.header, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.category}>
              Category
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.amount}>
              Amount
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.change}>
              vs. prior
            </ThemedText>
            {showNotes && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.notes}>
                Notes
              </ThemedText>
            )}
          </View>
          {movers.map((m) => {
            const pct = percentChange(m.amount, m.previous);
            const up = m.amount > m.previous;
            return (
              <View key={m.category} style={[styles.row, styles.body, { borderColor: theme.border }]}>
                <View style={[styles.category, styles.categoryCell]}>
                  <View style={[styles.dot, { backgroundColor: color(m.category) }]} />
                  <ThemedText type="small" numberOfLines={1} style={styles.shrink}>
                    {formatCategory(m.category)}
                  </ThemedText>
                </View>
                <ThemedText type="small" style={styles.amount}>
                  {formatWholeCurrency(m.amount)}
                </ThemedText>
                <View style={[styles.change, styles.changeCell]}>
                  {/* Spending up is the unfavorable direction. */}
                  <Icon name={up ? 'arrowUp' : 'arrowDown'} size={14} themeColor={up ? 'negative' : 'positive'} strokeWidth={2.25} />
                  <ThemedText type="smallBold" themeColor={up ? 'negative' : 'positive'}>
                    {pct === null ? 'New' : formatPercent(pct)}
                  </ThemedText>
                </View>
                {showNotes && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.notes} numberOfLines={2}>
                    {moverNote(m)}
                  </ThemedText>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  header: { paddingBottom: Spacing.two, borderBottomWidth: 1 },
  body: { paddingVertical: Spacing.two + Spacing.half, borderBottomWidth: StyleSheet.hairlineWidth },
  category: { flex: 4, minWidth: 0 },
  categoryCell: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  shrink: { flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  amount: { flex: 2, textAlign: 'right', fontVariant: ['tabular-nums'] },
  change: { flex: 2, justifyContent: 'flex-end', textAlign: 'right' },
  changeCell: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  notes: { flex: 4, paddingLeft: Spacing.three },
});
