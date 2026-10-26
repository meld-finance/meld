import type { CashflowMonth } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatCurrency, formatMonth } from '@/lib/format';

const PLOT_HEIGHT = 140;
const BAR_MAX = 24;

/** Income vs spending per month: two series, one axis, legend + readout + table. */
export function CashflowChart({ months }: { months: CashflowMonth[] }) {
  const viz = useVizColors();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const max = Math.max(...months.flatMap((m) => [m.income, m.spending]), 1);
  const shown = months[active ?? months.length - 1];
  const series = [
    { key: 'income' as const, label: 'Income', color: viz.series1 },
    { key: 'spending' as const, label: 'Spending', color: viz.series2 },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View style={styles.legend}>
          {series.map((s) => (
            <View key={s.key} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              <ThemedText type="small" themeColor="textSecondary">
                {s.label}
              </ThemedText>
            </View>
          ))}
        </View>
        <Pressable onPress={() => setShowTable((v) => !v)} accessibilityRole="button">
          <ThemedText type="small" themeColor="tint">
            {showTable ? 'Show chart' : 'Show table'}
          </ThemedText>
        </Pressable>
      </View>

      {showTable ? (
        <View>
          <TableRow cells={['Month', 'Income', 'Spending', 'Net']} header />
          {months.map((m) => (
            <TableRow
              key={m.month}
              cells={[
                formatMonth(m.month, true),
                formatCurrency(m.income),
                formatCurrency(m.spending),
                formatCurrency(m.income - m.spending),
              ]}
            />
          ))}
        </View>
      ) : (
        <>
          {shown && (
            <ThemedText type="small" themeColor="textSecondary">
              {formatMonth(shown.month, true)} · Income {formatCurrency(shown.income)} · Spending{' '}
              {formatCurrency(shown.spending)} · Net {formatCurrency(shown.income - shown.spending)}
            </ThemedText>
          )}
          <View style={styles.plotRow}>
            <View style={[styles.plot, { height: PLOT_HEIGHT }]}>
              {/* Recessive gridlines at the top and midpoint; the baseline is the bottom border. */}
              <View style={[styles.grid, { top: 0, backgroundColor: viz.grid }]} />
              <View style={[styles.grid, { top: PLOT_HEIGHT / 2, backgroundColor: viz.grid }]} />
              <View style={styles.columns}>
                {months.map((m, i) => (
                  <Pressable
                    key={m.month}
                    style={styles.column}
                    onHoverIn={() => setActive(i)}
                    onHoverOut={() => setActive(null)}
                    onPressIn={() => setActive(i)}
                    accessibilityLabel={`${formatMonth(m.month, true)}: income ${formatCurrency(m.income)}, spending ${formatCurrency(m.spending)}`}>
                    <View style={[styles.pair, active !== null && active !== i && styles.dimmed]}>
                      {series.map((s) => (
                        <View
                          key={s.key}
                          style={[
                            styles.bar,
                            { height: (m[s.key] / max) * PLOT_HEIGHT, backgroundColor: s.color },
                          ]}
                        />
                      ))}
                    </View>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.baseline, { backgroundColor: viz.axis }]} />
            </View>
            <View style={[styles.yAxis, { height: PLOT_HEIGHT }]}>
              <ThemedText type="small" style={{ color: viz.muted }}>
                {formatCompactCurrency(max)}
              </ThemedText>
              <ThemedText type="small" style={{ color: viz.muted }}>
                {formatCompactCurrency(max / 2)}
              </ThemedText>
              <ThemedText type="small" style={{ color: viz.muted }}>
                $0
              </ThemedText>
            </View>
          </View>
          <View style={styles.plotRow}>
            <View style={styles.xLabels}>
              {months.map((m) => (
                <ThemedText key={m.month} type="small" style={[styles.xLabel, { color: viz.muted }]}>
                  {formatMonth(m.month)}
                </ThemedText>
              ))}
            </View>
            <View style={styles.yAxisSpacer} />
          </View>
        </>
      )}
    </View>
  );
}

function TableRow({ cells, header }: { cells: string[]; header?: boolean }) {
  return (
    <View style={styles.tableRow}>
      {cells.map((c, i) => (
        <ThemedText
          key={i}
          type={header ? 'smallBold' : 'small'}
          themeColor={header ? 'textSecondary' : 'text'}
          style={[styles.tableCell, i > 0 && styles.numeric]}>
          {c}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  legend: { flexDirection: 'row', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  plotRow: { flexDirection: 'row', gap: Spacing.two },
  plot: { flex: 1, justifyContent: 'flex-end' },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  baseline: { height: 1 },
  columns: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  // Bars shrink to fit narrow screens but never exceed BAR_MAX; 2px surface gap between them.
  pair: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
    width: '100%',
    paddingHorizontal: Spacing.one,
  },
  dimmed: { opacity: 0.4 },
  bar: { flex: 1, maxWidth: BAR_MAX, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  yAxis: { width: 44, justifyContent: 'space-between', alignItems: 'flex-end' },
  xLabels: { flex: 1, flexDirection: 'row' },
  xLabel: { flex: 1, textAlign: 'center' },
  yAxisSpacer: { width: 44 },
  tableRow: { flexDirection: 'row', paddingVertical: Spacing.one },
  tableCell: { flex: 1 },
  numeric: { textAlign: 'right', fontVariant: ['tabular-nums'] },
});
