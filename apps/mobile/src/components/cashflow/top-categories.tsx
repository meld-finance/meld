import type { CategoryChange } from '@meld/shared';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCategory, formatWholeCurrency } from '@/lib/format';

/** The period's largest categories as share-of-total meters. */
export function TopCategories({
  categories,
  total,
  slots,
  periodLabel,
  style,
}: {
  categories: CategoryChange[];
  total: number;
  slots: Map<string, number>;
  periodLabel: string;
  style?: object;
}) {
  const viz = useVizColors();
  const top = categories.filter((c) => c.amount > 0).slice(0, 5);

  return (
    <Card title="Where You Spend the Most" subtitle={`Top ${top.length} categories by amount (${periodLabel})`} style={style}>
      {top.map((c) => {
        const share = total > 0 ? c.amount / total : 0;
        return (
          <View key={c.category} style={styles.item}>
            <View style={styles.labels}>
              <ThemedText type="small" style={styles.name} numberOfLines={1}>
                {formatCategory(c.category)}
              </ThemedText>
              <ThemedText type="smallBold" style={styles.numeric}>
                {formatWholeCurrency(c.amount)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={[styles.numeric, styles.pct]}>
                {Math.round(share * 100)}%
              </ThemedText>
            </View>
            <View style={[styles.track, { backgroundColor: viz.grid }]}>
              <View
                style={[
                  styles.fill,
                  { width: `${share * 100}%`, backgroundColor: viz.categorical[slots.get(c.category) ?? -1] ?? viz.other },
                ]}
              />
            </View>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  item: { gap: Spacing.two },
  labels: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  name: { flex: 1 },
  numeric: { fontVariant: ['tabular-nums'], textAlign: 'right' },
  pct: { width: 40 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, minWidth: 2, borderRadius: 4 },
});
