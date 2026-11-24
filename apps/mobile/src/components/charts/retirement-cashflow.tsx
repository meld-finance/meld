import type { RetirementCashFlowYear, RetirementProjection as Projection } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import {
  CHART_GEOMETRY,
  ChartAgeAxis,
  ChartTooltipBox,
  TooltipActiveEvents,
  cashFlowIncomeTotal,
  isEventActiveAtAge,
  spanRectX,
  type HighlightedSpan,
  type ProjectionEventMarker,
} from '@/components/charts/retirement-chart-shared';
import { zeroBasedScale } from '@/components/charts/scale';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';

const { height: HEIGHT, padTop: PAD_TOP, endPadX: END_PAD_X, yAxisWidth: Y_AXIS_WIDTH, ticks: TICKS } = CHART_GEOMETRY;

/** Annual cash flow by age: saving before retirement, and how retirement spending is covered (SS, other income, savings drawdown). */
export function RetirementCashFlow({
  rows,
  retirementAge,
  sales = [],
  events = [],
  activeAge: controlledActiveAge,
  onActiveAgeChange,
  highlightedSpan = null,
}: {
  rows: RetirementCashFlowYear[];
  retirementAge: number;
  sales?: Projection['sales'];
  events?: ProjectionEventMarker[];
  activeAge?: number | null;
  onActiveAgeChange?: (age: number | null) => void;
  highlightedSpan?: HighlightedSpan | null;
}) {
  const theme = useTheme();
  const viz = useVizColors();
  const accents = useAccents();
  const [width, setWidth] = useState(0);
  const [internalAge, setInternalAge] = useState<number | null>(null);

  if (rows.length < 2) return null;

  const minAge = rows[0]!.age;
  const maxAge = rows[rows.length - 1]!.age;
  const activeAge = controlledActiveAge !== undefined ? controlledActiveAge : internalAge;
  const setActiveAge = (age: number | null) => {
    if (controlledActiveAge === undefined) setInternalAge(age);
    onActiveAgeChange?.(age);
  };

  const { min, max, ticks } = zeroBasedScale(
    rows.map((r) => (r.retired ? Math.max(r.spending, cashFlowIncomeTotal(r)) : Math.max(0, r.saving))),
    TICKS,
  );
  const plotW = Math.max(width - END_PAD_X * 2, 1);
  const x = (i: number) => END_PAD_X + (i / (rows.length - 1)) * plotW;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (HEIGHT - PAD_TOP);
  const baseLineY = y(0);
  const barW = Math.max(2, plotW / rows.length - 1.5);

  const retireIndex = rows.findIndex((r) => r.age === retirementAge);
  const every = rows.length > 40 ? 10 : 5;
  const labeled = rows.map((r, i) => (r.age % every === 0 ? i : -1)).filter((i) => i >= 0);

  // Crisp spending curve across retired years.
  const retiredSegments = rows
    .map((r, i) => (r.retired ? `${i === retireIndex || !rows[i - 1]?.retired ? 'M' : 'L'}${x(i).toFixed(1)},${y(r.spending).toFixed(1)}` : null))
    .filter(Boolean)
    .join(' ');

  const activeIdx = activeAge !== null ? rows.findIndex((r) => r.age === activeAge) : -1;
  const hasActive = activeIdx >= 0;
  const activeRow = hasActive ? rows[activeIdx]! : null;
  const spanBand = highlightedSpan ? spanRectX(highlightedSpan, minAge, maxAge, plotW, END_PAD_X) : null;

  const activeOtherIncome = activeRow
    ? activeRow.pension + Math.max(0, activeRow.rent) + Math.max(0, activeRow.eventIncome)
    : 0;
  const activeSales = activeRow ? sales.filter((s) => s.age === activeRow.age) : [];
  const activeEvents = activeRow ? events.filter((e) => isEventActiveAtAge(e, activeRow.age)) : [];

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.yAxis, { height: HEIGHT }]}>
          {ticks.map((t) => (
            <ThemedText key={t} type="small" themeColor="textSecondary" style={[styles.yLabel, { top: y(t) - 10 }]}>
              {formatCompactCurrency(t)}
            </ThemedText>
          ))}
        </View>
        <View style={styles.plot} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <View style={{ height: HEIGHT }}>
            {width > 0 && (
              <Svg width={width} height={HEIGHT}>
                {ticks.map((t) => (
                  <Line key={t} x1={0} x2={width} y1={y(t)} y2={y(t)} stroke={viz.grid} strokeWidth={1} />
                ))}
                {spanBand && (
                  <Rect
                    x={spanBand.x}
                    y={PAD_TOP}
                    width={spanBand.width}
                    height={HEIGHT - PAD_TOP}
                    fill={highlightedSpan!.color}
                    fillOpacity={0.12}
                  />
                )}
                {rows.map((r, i) => {
                  const bx = x(i) - barW / 2;
                  const dimmed = hasActive && activeIdx !== i;
                  const opacity = dimmed ? 0.45 : 0.85;
                  if (!r.retired) {
                    if (r.saving <= 0) return null;
                    const top = y(r.saving);
                    return (
                      <Rect
                        key={r.age}
                        x={bx}
                        y={top}
                        width={barW}
                        height={Math.max(1, baseLineY - top)}
                        rx={1}
                        fill={viz.series1}
                        fillOpacity={opacity * 0.8}
                      />
                    );
                  }
                  const ss = Math.max(0, r.socialSecurity);
                  const other = Math.max(0, r.pension + Math.max(0, r.rent) + Math.max(0, r.eventIncome));
                  const draw = Math.max(0, r.withdrawal);
                  let cum = 0;
                  const segs: { val: number; color: string }[] = [
                    { val: ss, color: viz.trend },
                    { val: other, color: viz.series1 },
                    { val: draw, color: viz.series2 },
                  ];
                  return segs.map((s, idx) => {
                    if (s.val <= 0) return null;
                    const botY = y(cum);
                    cum += s.val;
                    const topY = y(cum);
                    return (
                      <Rect
                        key={`${r.age}-${idx}`}
                        x={bx}
                        y={topY}
                        width={barW}
                        height={Math.max(1, botY - topY)}
                        fill={s.color}
                        fillOpacity={opacity}
                      />
                    );
                  });
                })}
                {retiredSegments.length > 0 && (
                  <Path
                    d={retiredSegments}
                    stroke={theme.text}
                    strokeOpacity={0.6}
                    strokeWidth={1.75}
                    fill="none"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {retireIndex > 0 && (
                  <Line
                    x1={x(retireIndex)}
                    x2={x(retireIndex)}
                    y1={PAD_TOP - 4}
                    y2={HEIGHT}
                    stroke={viz.muted}
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                )}
                {hasActive && <Line x1={x(activeIdx)} x2={x(activeIdx)} y1={0} y2={HEIGHT} stroke={viz.axis} strokeWidth={1} />}
              </Svg>
            )}
            {retireIndex > 0 && width > 0 && (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                pointerEvents="none"
                style={[styles.marker, { left: Math.min(Math.max(x(retireIndex) - 60, 0), width - 120) }]}>
                Retire at {retirementAge}
              </ThemedText>
            )}
            {activeRow && width > 0 && (
              <ChartTooltipBox anchorX={x(activeIdx)} plotWidth={width}>
                <ThemedText type="small" themeColor="textSecondary">
                  Age {activeRow.age} · {new Date().getFullYear() + (activeRow.age - minAge)}
                </ThemedText>
                {!activeRow.retired ? (
                  <ThemedText type="smallBold" style={{ color: viz.series1 }}>
                    Saving: {formatWholeCurrency(activeRow.saving)}/yr
                  </ThemedText>
                ) : (
                  <>
                    <ThemedText type="smallBold">Spending: {formatWholeCurrency(activeRow.spending)}/yr</ThemedText>
                    {activeRow.socialSecurity > 0 && (
                      <ThemedText type="small" style={{ color: viz.trend }}>
                        Social Security: {formatWholeCurrency(activeRow.socialSecurity)}
                      </ThemedText>
                    )}
                    {activeOtherIncome > 0 && (
                      <ThemedText type="small" style={{ color: viz.series1 }}>
                        Other income: {formatWholeCurrency(activeOtherIncome)}
                      </ThemedText>
                    )}
                    <ThemedText
                      type="small"
                      style={{ color: activeRow.withdrawal > 0 ? viz.series2 : theme.positive }}>
                      {activeRow.withdrawal > 0
                        ? `From savings: ${formatWholeCurrency(activeRow.withdrawal)}`
                        : activeRow.withdrawal < 0
                          ? `Surplus saved: +${formatWholeCurrency(-activeRow.withdrawal)}`
                          : 'Covered by income'}
                    </ThemedText>
                  </>
                )}
                {activeRow.lump !== 0 && (
                  <ThemedText type="small" style={{ color: accents.purple.fg }}>
                    {activeRow.lump > 0 ? 'One-time / sale in' : 'One-time out'}:{' '}
                    {activeRow.lump > 0 ? '+' : '−'}
                    {formatCompactCurrency(Math.abs(activeRow.lump))}
                  </ThemedText>
                )}
                {activeSales.map((s) => (
                  <ThemedText key={s.name} type="small" style={{ color: accents.teal.fg }}>
                    Sell {s.name}: +{formatCompactCurrency(s.proceeds)}
                  </ThemedText>
                ))}
                <TooltipActiveEvents events={activeEvents} />
              </ChartTooltipBox>
            )}
            <View style={StyleSheet.absoluteFill}>
              <View style={styles.slices}>
                {rows.map((r) => (
                  <Pressable
                    key={r.age}
                    style={styles.slice}
                    onHoverIn={() => setActiveAge(r.age)}
                    onHoverOut={() => setActiveAge(null)}
                    onPressIn={() => setActiveAge(r.age)}
                    onPressOut={() => setActiveAge(null)}
                    accessibilityLabel={
                      r.retired
                        ? `Age ${r.age}: spending ${formatWholeCurrency(r.spending)}, from savings ${formatWholeCurrency(Math.max(0, r.withdrawal))}`
                        : `Age ${r.age}: saving ${formatWholeCurrency(r.saving)}`
                    }
                  />
                ))}
              </View>
            </View>
          </View>
        </View>
      </View>
      <ChartAgeAxis ages={rows.map((r) => r.age)} labeledIndices={labeled} width={width} xAtIndex={x} />
      <View style={styles.legend}>
        <LegendItem color={viz.series1} label="Saving / other income" />
        <LegendItem color={viz.trend} label="Social Security" />
        <LegendItem color={viz.series2} label="From savings" />
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: theme.text }]} />
          <ThemedText type="small" themeColor="textSecondary">
            Spending
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  row: { flexDirection: 'row' },
  yAxis: { width: Y_AXIS_WIDTH },
  yLabel: { position: 'absolute', left: 0, fontSize: 12 },
  plot: { flex: 1 },
  slices: { flex: 1, flexDirection: 'row' },
  slice: { flex: 1 },
  marker: { position: 'absolute', top: 0, width: 120, textAlign: 'center', fontSize: 12 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, paddingLeft: Y_AXIS_WIDTH },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + Spacing.half },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendLine: { width: 14, height: 2, borderRadius: 1, opacity: 0.65 },
});
