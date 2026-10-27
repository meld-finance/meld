import type { CategoryMonth } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Segmented } from '@/components/cashflow/segmented';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { categoryLabel, foldCategories, OTHER } from '@/lib/cashflow';
import { formatCompactCurrency, formatCurrency, formatMonth, formatWholeCurrency } from '@/lib/format';

const PLOT_HEIGHT = 240;
const BAR_MAX = 36;
const GAP = 2;

type Mode = 'amount' | 'percent';

/** A step of 1, 2, 2.5 or 5 × 10ⁿ so the half-way gridline lands on a round number. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= max)!;
  return step * mag;
}

/** Monthly spending stacked by category; hover a month to read its values in the legend. */
export function SpendingOverTime({
  months,
  slots,
  style,
}: {
  months: CategoryMonth[];
  slots: Map<string, number>;
  style?: object;
}) {
  const viz = useVizColors();
  const [mode, setMode] = useState<Mode>('amount');
  const [active, setActive] = useState<number | null>(null);

  const color = (category: string) => (category === OTHER ? viz.other : viz.categorical[slots.get(category)!]!);
  const stacks = months.map((m) => {
    const parts = foldCategories(m.categories, slots);
    return { month: m.month, parts, total: parts.reduce((s, p) => s + p.amount, 0) };
  });
  const scale = mode === 'percent' ? 100 : niceMax(Math.max(...stacks.map((s) => s.total), 0));
  const shown = stacks[active ?? stacks.length - 1];
  const legend = shown ? shown.parts.filter((p) => p.amount > 0) : [];
  const ticks = mode === 'percent' ? ['100%', '50%', '0%'] : [scale, scale / 2, 0].map((t) => (t ? formatCompactCurrency(t) : '$0'));

  return (
    <Card
      title="Spending Over Time"
      subtitle={`Monthly spending (last ${months.length} months)`}
      style={style}
      action={
        <Segmented
          size="small"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'amount', label: 'Amount' },
            { value: 'percent', label: '%' },
          ]}
        />
      }>
      {shown && (
        <ThemedText type="small" themeColor="textSecondary">
          {formatMonth(shown.month, true)} · {formatWholeCurrency(shown.total)} total
        </ThemedText>
      )}

      <View style={styles.plotRow}>
        <View style={[styles.yAxis, { height: PLOT_HEIGHT }]}>
          {ticks.map((t) => (
            <ThemedText key={t} type="small" style={{ color: viz.muted }}>
              {t}
            </ThemedText>
          ))}
        </View>
        <View style={[styles.plot, { height: PLOT_HEIGHT }]}>
          <View style={[styles.grid, { top: 0, backgroundColor: viz.grid }]} />
          <View style={[styles.grid, { top: PLOT_HEIGHT / 2, backgroundColor: viz.grid }]} />
          <View style={styles.columns}>
            {stacks.map((s, i) => {
              // Percent mode fills every bar to 100%.
              const denom = mode === 'percent' ? s.total || 1 : scale;
              const visible = s.parts.filter((p) => p.amount > 0);
              return (
                <Pressable
                  key={s.month}
                  style={styles.column}
                  onHoverIn={() => setActive(i)}
                  onHoverOut={() => setActive(null)}
                  onPressIn={() => setActive(i)}
                  accessibilityLabel={`${formatMonth(s.month, true)}: ${formatCurrency(s.total)}; ${visible
                    .map((p) => `${categoryLabel(p.category)} ${formatCurrency(p.amount)}`)
                    .join(', ')}`}>
                  <View style={[styles.stack, active !== null && active !== i && styles.dimmed]}>
                    {/* First child renders on top, so the largest category sits on the baseline. */}
                    {[...visible].reverse().map((p, j) => (
                      <View
                        key={p.category}
                        style={[
                          styles.segment,
                          j === 0 && styles.top,
                          {
                            height: Math.max((p.amount / denom) * PLOT_HEIGHT - GAP, 1),
                            backgroundColor: color(p.category),
                          },
                        ]}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.baseline, { backgroundColor: viz.axis }]} />
        </View>
      </View>
      <View style={styles.plotRow}>
        <View style={styles.yAxis} />
        <View style={styles.xLabels}>
          {stacks.map((s) => (
            <View key={s.month} style={styles.xLabel}>
              <ThemedText type="small" style={[styles.xText, { color: viz.muted }]}>
                {formatMonth(s.month)}
              </ThemedText>
              <ThemedText type="small" style={[styles.xText, { color: viz.muted }]}>
                {s.month.slice(0, 4)}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.legend}>
        {legend.map((p) => (
          <View key={p.category} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: color(p.category) }]} />
            <ThemedText type="small" themeColor="textSecondary">
              {categoryLabel(p.category)}
            </ThemedText>
            <ThemedText type="small" style={styles.numeric}>
              {mode === 'percent' && shown!.total
                ? `${Math.round((p.amount / shown!.total) * 100)}%`
                : formatWholeCurrency(p.amount)}
            </ThemedText>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  plotRow: { flexDirection: 'row', gap: Spacing.two },
  yAxis: { width: 44, justifyContent: 'space-between', alignItems: 'flex-end' },
  plot: { flex: 1, justifyContent: 'flex-end' },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  baseline: { height: 1 },
  columns: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  stack: { width: '100%', maxWidth: BAR_MAX + Spacing.two * 2, paddingHorizontal: Spacing.two, gap: GAP },
  dimmed: { opacity: 0.4 },
  segment: { width: '100%' },
  top: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  xLabels: { flex: 1, flexDirection: 'row' },
  xLabel: { flex: 1, alignItems: 'center' },
  xText: { fontSize: 12, lineHeight: 16 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  numeric: { fontVariant: ['tabular-nums'] },
});
