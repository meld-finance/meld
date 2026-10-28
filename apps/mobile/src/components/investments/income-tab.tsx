import type { InvestmentIncome, InvestmentsSummary } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Segmented } from '@/components/cashflow/segmented';
import { InsightCallout, StatTile, TabHeading, TileRow } from '@/components/investments/common';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatCurrency, formatMonth, formatWholeCurrency } from '@/lib/format';
import { formatShare, incomeOf, paidOutOf } from '@/lib/investments';

type Range = '12m' | 'ytd' | '24m';

const PLOT_HEIGHT = 200;
const BAR_MAX = 28;
const GAP = 2;

/** A step of 1, 2, 2.5 or 5 × 10ⁿ so the half-way gridline lands on a round number. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].find((s) => s * mag >= max)! * mag;
}

export function IncomeTab({ income, summary }: { income: InvestmentIncome; summary: InvestmentsSummary }) {
  const { ytd, previousYtd, trailing12 } = income;
  const year = income.asOf.slice(0, 4);
  const ytdIncome = incomeOf(ytd);
  const reinvestedShare = ytdIncome > 0 ? formatShare(ytd.reinvested, ytdIncome) : null;
  const trailingIncome = incomeOf(trailing12);

  // Yield on cost needs the cost of everything that earns; cash's cost is its value.
  const missingCost = summary.holdings.some((h) => h.securityType !== 'cash' && h.costBasis === null && (h.value ?? 0) > 0);
  const cost = summary.holdings.reduce((s, h) => s + (h.securityType === 'cash' ? (h.value ?? 0) : (h.costBasis ?? 0)), 0);

  return (
    <>
      <TabHeading
        title="Investment income"
        subtitle="What your portfolio earns, how much of it is reinvested, and which accounts it comes from."
      />
      <TileRow>
        <StatTile label="Dividends received (YTD)" value={ytd.dividends} change={{ previous: previousYtd.dividends, against: 'last year' }} />
        <StatTile label="Interest earned (YTD)" value={ytd.interest} change={{ previous: previousYtd.interest, against: 'last year' }} />
        <StatTile label="Reinvested (YTD)" value={ytd.reinvested} change={{ previous: previousYtd.reinvested, against: 'last year' }} />
        <StatTile label="Paid out as cash (YTD)" value={paidOutOf(ytd)} change={{ previous: paidOutOf(previousYtd), against: 'last year' }} />
      </TileRow>

      <View style={styles.columns}>
        <IncomeOverTime income={income} style={styles.wide} />
        <View style={styles.narrow}>
          <Card title="Yield" subtitle="Trailing 12 months of dividends and interest">
            <View style={styles.yields}>
              <YieldBox label="Current portfolio yield" value={summary.totalValue > 0 ? (trailingIncome / summary.totalValue) * 100 : null} />
              <YieldBox
                label="Yield on cost"
                value={!missingCost && cost > 0 ? (trailingIncome / cost) * 100 : null}
                missing={missingCost ? 'Needs cost basis for every holding' : undefined}
              />
            </View>
          </Card>
          <IncomeByAccount income={income} />
        </View>
      </View>

      {ytdIncome > 0 && (
        <InsightCallout
          icon="info"
          body={`Your investments generated ${formatWholeCurrency(ytdIncome)} in income so far in ${year}${
            reinvestedShare ? `, with ${reinvestedShare} reinvested` : ''
          }. That’s ${formatShare(ytdIncome, summary.totalValue)} of your current portfolio value.`}
          question={`My investments generated ${formatWholeCurrency(ytdIncome)} in dividends and interest so far this year. How are these taxed, and should I be reinvesting more or less?`}
        />
      )}
    </>
  );
}

function YieldBox({ label, value, missing }: { label: string; value: number | null; missing?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.yieldBox, { borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText style={styles.yieldValue}>{value === null ? '—' : `${value.toFixed(1)}%`}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
        {missing ?? '(annualized)'}
      </ThemedText>
    </View>
  );
}

function IncomeByAccount({ income }: { income: InvestmentIncome }) {
  const theme = useTheme();
  return (
    <Card title="Income by account" subtitle="Year to date">
      {income.byAccount.length ? (
        <View>
          <View style={styles.tableRow}>
            <View style={styles.tableName} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.tableNum}>
              Dividends
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.tableNum}>
              Interest
            </ThemedText>
          </View>
          {income.byAccount.map((a) => (
            <View key={a.accountId} style={[styles.tableRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
              <ThemedText type="small" style={styles.tableName} numberOfLines={1}>
                {a.accountName}
              </ThemedText>
              <ThemedText type="small" style={styles.tableNum}>
                {formatWholeCurrency(a.dividends)}
              </ThemedText>
              <ThemedText type="small" style={styles.tableNum}>
                {formatWholeCurrency(a.interest)}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          No dividends or interest yet this year.
        </ThemedText>
      )}
    </Card>
  );
}

/** Monthly income stacked as reinvested and paid out; hover a month to read it. */
function IncomeOverTime({ income, style }: { income: InvestmentIncome; style?: object }) {
  const viz = useVizColors();
  const [range, setRange] = useState<Range>('12m');
  const [active, setActive] = useState<number | null>(null);
  const year = income.asOf.slice(0, 4);
  const months =
    range === '24m' ? income.months : range === 'ytd' ? income.months.filter((m) => m.month.startsWith(year)) : income.months.slice(-12);
  // Some institutions report a reinvestment without the dividend behind it, so reinvested isn't capped at income.
  const bars = months.map((m) => {
    const paidOut = paidOutOf(m);
    return { month: m.month, reinvested: m.reinvested, paidOut, total: m.reinvested + paidOut };
  });
  const scale = niceMax(Math.max(...bars.map((b) => b.total), 0));
  const shown = bars[active ?? bars.length - 1];
  const colors = { reinvested: viz.series1, paidOut: viz.categorical[2]! };
  const total = bars.reduce((s, b) => s + b.total, 0);

  return (
    <Card
      title="Income over time"
      subtitle={`${formatWholeCurrency(total)} reinvested or paid out`}
      style={style}
      action={
        <Segmented
          size="small"
          value={range}
          onChange={(r) => {
            setRange(r);
            setActive(null);
          }}
          options={[
            { value: '12m', label: '12M' },
            { value: 'ytd', label: 'YTD' },
            { value: '24m', label: '2Y' },
          ]}
        />
      }>
      <View style={styles.legend}>
        <LegendItem color={colors.reinvested} label="Reinvested" value={shown?.reinvested} />
        <LegendItem color={colors.paidOut} label="Paid out as cash" value={shown?.paidOut} />
        {shown && (
          <ThemedText type="small" themeColor="textSecondary">
            {formatMonth(shown.month, true)}
          </ThemedText>
        )}
      </View>

      <View style={styles.plotRow}>
        <View style={[styles.yAxis, { height: PLOT_HEIGHT }]}>
          {[scale, scale / 2, 0].map((t) => (
            <ThemedText key={t} type="small" style={{ color: viz.muted }}>
              {t ? formatCompactCurrency(t) : '$0'}
            </ThemedText>
          ))}
        </View>
        <View style={[styles.plot, { height: PLOT_HEIGHT }]}>
          <View style={[styles.grid, { top: 0, backgroundColor: viz.grid }]} />
          <View style={[styles.grid, { top: PLOT_HEIGHT / 2, backgroundColor: viz.grid }]} />
          <View style={styles.columnsPlot}>
            {bars.map((b, i) => (
              <Pressable
                key={b.month}
                style={styles.column}
                onHoverIn={() => setActive(i)}
                onHoverOut={() => setActive(null)}
                onPressIn={() => setActive(i)}
                accessibilityLabel={`${formatMonth(b.month, true)}: ${formatCurrency(b.total)}, ${formatCurrency(b.reinvested)} reinvested`}>
                <View style={[styles.stack, active !== null && active !== i && styles.dimmed]}>
                  {b.paidOut > 0 && (
                    <View
                      style={[styles.top, { height: Math.max((b.paidOut / scale) * PLOT_HEIGHT - GAP, 1), backgroundColor: colors.paidOut }]}
                    />
                  )}
                  {b.reinvested > 0 && (
                    <View
                      style={[
                        b.paidOut > 0 ? undefined : styles.top,
                        { height: Math.max((b.reinvested / scale) * PLOT_HEIGHT - GAP, 1), backgroundColor: colors.reinvested },
                      ]}
                    />
                  )}
                </View>
              </Pressable>
            ))}
          </View>
          <View style={[styles.baseline, { backgroundColor: viz.axis }]} />
        </View>
      </View>
      <View style={styles.plotRow}>
        <View style={styles.yAxis} />
        <View style={styles.xLabels}>
          {bars.map((b, i) => (
            <View key={b.month} style={styles.xLabel}>
              {/* Every other label when there are too many to fit. */}
              {(bars.length <= 12 || i % 2 === bars.length % 2) && (
                <ThemedText type="small" style={[styles.xText, { color: viz.muted }]}>
                  {formatMonth(b.month)}
                </ThemedText>
              )}
            </View>
          ))}
        </View>
      </View>
      {total === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No dividends or interest in this period. Income appears when your institution reports investment transactions.
        </ThemedText>
      )}
    </Card>
  );
}

function LegendItem({ color, label, value }: { color: string; label: string; value?: number }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {value !== undefined && (
        <ThemedText type="small" style={styles.numeric}>
          {formatWholeCurrency(value)}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  wide: { flexGrow: 3, flexBasis: 480 },
  narrow: { flexGrow: 2, flexBasis: 320, gap: Spacing.three },
  yields: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  yieldBox: { flexGrow: 1, flexBasis: 130, borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.half },
  yieldValue: { fontSize: 24, lineHeight: 32, fontWeight: 700 },
  caption: { fontSize: 12, lineHeight: 16 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  tableName: { flex: 1 },
  tableNum: { width: 84, textAlign: 'right', fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  numeric: { fontVariant: ['tabular-nums'] },
  plotRow: { flexDirection: 'row', gap: Spacing.two },
  yAxis: { width: 44, justifyContent: 'space-between', alignItems: 'flex-end' },
  plot: { flex: 1, justifyContent: 'flex-end' },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  baseline: { height: 1 },
  columnsPlot: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  stack: { width: '100%', maxWidth: BAR_MAX + Spacing.one * 2, paddingHorizontal: Spacing.one, gap: GAP },
  dimmed: { opacity: 0.4 },
  top: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  xLabels: { flex: 1, flexDirection: 'row' },
  xLabel: { flex: 1, alignItems: 'center' },
  xText: { fontSize: 12, lineHeight: 16 },
});
