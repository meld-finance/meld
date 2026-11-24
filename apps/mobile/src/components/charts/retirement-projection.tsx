import type { RetirementCashFlowYear, RetirementProjection as Projection } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import {
  CHART_GEOMETRY,
  ChartAgeAxis,
  ChartTooltipBox,
  KIND_ACCENT,
  TooltipActiveEvents,
  cashFlowIncomeTotal,
  isEventActiveAtAge,
  spanRectX,
  type HighlightedSpan,
  type ProjectionEventMarker,
} from '@/components/charts/retirement-chart-shared';
import { zeroBasedScale } from '@/components/charts/scale';
import { ThemedText } from '@/components/themed-text';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';

export type { ProjectionEventMarker, HighlightedSpan };

const { height: HEIGHT, padTop: PAD_TOP, endPadX: END_PAD_X, yAxisWidth: Y_AXIS_WIDTH, ticks: TICKS } = CHART_GEOMETRY;

/** Projected balance by age: savings grow to the dashed retirement line, then are drawn down. */
export function RetirementProjection({
  points,
  retirementAge,
  socialSecurityAge = null,
  sales = [],
  events = [],
  cashFlow,
  activeAge: controlledActiveAge,
  onActiveAgeChange,
  highlightedSpan = null,
}: {
  points: Projection['points'];
  retirementAge: number;
  /** Shown as a subtle marker when Social Security starts at a different age than retirement. */
  socialSecurityAge?: number | null;
  /** Property sales, marked on the line where the balance steps up. */
  sales?: Projection['sales'];
  /** Life events, marked along the bottom by kind and listed in tooltips when active. */
  events?: ProjectionEventMarker[];
  /** Optional cash-flow breakdown per age to enrich the hover/tap tooltip. */
  cashFlow?: RetirementCashFlowYear[];
  /** Controlled active age for synchronization with the timeline below. */
  activeAge?: number | null;
  onActiveAgeChange?: (age: number | null) => void;
  highlightedSpan?: HighlightedSpan | null;
}) {
  const theme = useTheme();
  const viz = useVizColors();
  const accents = useAccents();
  const [width, setWidth] = useState(0);
  const [internalAge, setInternalAge] = useState<number | null>(null);

  if (points.length < 2) return null;

  const minAge = points[0]!.age;
  const maxAge = points[points.length - 1]!.age;
  const activeAge = controlledActiveAge !== undefined ? controlledActiveAge : internalAge;
  const setActiveAge = (age: number | null) => {
    if (controlledActiveAge === undefined) setInternalAge(age);
    onActiveAgeChange?.(age);
  };

  const { min, max, ticks } = zeroBasedScale(
    points.map((p) => p.balance),
    TICKS,
  );
  const plotW = Math.max(width - END_PAD_X * 2, 1);
  const x = (i: number) => END_PAD_X + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (HEIGHT - PAD_TOP);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(min)} L${x(0).toFixed(1)},${y(min)} Z`;

  const retireIndex = points.findIndex((p) => p.age === retirementAge);
  const ssIndex = socialSecurityAge !== null && socialSecurityAge !== retirementAge ? points.findIndex((p) => p.age === socialSecurityAge) : -1;
  const showSsLabel = ssIndex > 0 && (retireIndex <= 0 || Math.abs(x(ssIndex) - x(retireIndex)) > 78);

  const every = points.length > 40 ? 10 : 5;
  const labeled = points.map((p, i) => (p.age % every === 0 ? i : -1)).filter((i) => i >= 0);

  const activeIdx = activeAge !== null ? points.findIndex((p) => p.age === activeAge) : -1;
  const hasActive = activeIdx >= 0;
  const shown = hasActive ? activeIdx : retireIndex >= 0 ? retireIndex : points.length - 1;
  const point = points[shown]!;
  const year = new Date().getFullYear() + (point.age - minAge);
  const salesShown = sales.filter((s) => s.age === point.age);
  const activeEvents = events.filter((e) => isEventActiveAtAge(e, point.age));
  const cashRow = cashFlow?.find((c) => c.age === point.age);
  const saleIndex = (age: number) => points.findIndex((p) => p.age === age);

  // Group events by start age so multiple events starting the same year show distinct colored dots.
  const eventsByStart = new Map<number, ProjectionEventMarker[]>();
  for (const e of events) {
    if (e.startAge < minAge || e.startAge > maxAge) continue;
    eventsByStart.set(e.startAge, [...(eventsByStart.get(e.startAge) ?? []), e]);
  }
  const spanBand = highlightedSpan ? spanRectX(highlightedSpan, minAge, maxAge, plotW, END_PAD_X) : null;

  return (
    <View>
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
                <Defs>
                  <LinearGradient id="ret-fill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={viz.trend} stopOpacity={0.22} />
                    <Stop offset="1" stopColor={viz.trend} stopOpacity={0.02} />
                  </LinearGradient>
                </Defs>
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
                <Path d={area} fill="url(#ret-fill)" />
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
                {ssIndex > 0 && (
                  <Line
                    x1={x(ssIndex)}
                    x2={x(ssIndex)}
                    y1={PAD_TOP - 4}
                    y2={HEIGHT}
                    stroke={viz.trend}
                    strokeOpacity={0.55}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                  />
                )}
                <Path d={line} stroke={viz.trend} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                {hasActive && <Line x1={x(shown)} x2={x(shown)} y1={0} y2={HEIGHT} stroke={viz.axis} strokeWidth={1} />}
                {sales.map((s) => {
                  const i = saleIndex(s.age);
                  return i < 0 ? null : (
                    <Circle
                      key={`${s.name}-${s.age}`}
                      cx={x(i)}
                      cy={y(points[i]!.balance)}
                      r={4}
                      fill={theme.backgroundElement}
                      stroke={accents.teal.fg}
                      strokeWidth={2}
                    />
                  );
                })}
                {[...eventsByStart.entries()].map(([age, list]) => {
                  const i = saleIndex(age);
                  if (i < 0) return null;
                  const baseX = x(i);
                  return list.slice(0, 3).map((ev, k) => {
                    const dx = (k - (Math.min(list.length, 3) - 1) / 2) * 5;
                    const cx = baseX + dx;
                    const cy = HEIGHT - 5;
                    const color = accents[KIND_ACCENT[ev.kind]].fg;
                    return (
                      <Path
                        key={`event-${age}-${k}`}
                        d={`M${cx.toFixed(1)},${cy - 4} l4,4 l-4,4 l-4,-4 Z`}
                        fill={color}
                        stroke={theme.backgroundElement}
                        strokeWidth={1}
                      />
                    );
                  });
                })}
                <Circle cx={x(shown)} cy={y(point.balance)} r={5} fill={viz.trend} stroke={theme.backgroundElement} strokeWidth={2} />
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
            {showSsLabel && width > 0 && (
              <ThemedText
                type="small"
                pointerEvents="none"
                style={[
                  styles.ssMarker,
                  { color: viz.trend, left: Math.min(Math.max(x(ssIndex) - 36, 0), width - 72) },
                ]}>
                SS at {socialSecurityAge}
              </ThemedText>
            )}
            {hasActive && width > 0 && (
              <ChartTooltipBox anchorX={x(shown)} plotWidth={width}>
                <ThemedText type="small" themeColor="textSecondary">
                  Age {point.age} · {year}
                </ThemedText>
                <ThemedText type="smallBold">{formatWholeCurrency(point.balance)}</ThemedText>
                {cashRow && !cashRow.retired && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Saving {formatWholeCurrency(cashRow.saving)}/yr
                  </ThemedText>
                )}
                {cashRow && cashRow.retired && (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      Spend {formatCompactCurrency(cashRow.spending)} · Income{' '}
                      {formatCompactCurrency(cashFlowIncomeTotal(cashRow))}
                    </ThemedText>
                    <ThemedText type="small" themeColor={cashRow.withdrawal < 0 ? 'positive' : 'textSecondary'}>
                      {cashRow.withdrawal > 0
                        ? `Draw ${formatCompactCurrency(cashRow.withdrawal)} from savings`
                        : cashRow.withdrawal < 0
                          ? `Surplus +${formatCompactCurrency(-cashRow.withdrawal)} saved`
                          : 'Covered by income'}
                    </ThemedText>
                  </>
                )}
                {salesShown.map((s) => (
                  <ThemedText key={s.name} type="small" style={{ color: accents.teal.fg }}>
                    Sell {s.name}: +{formatCompactCurrency(s.proceeds)}
                  </ThemedText>
                ))}
                <TooltipActiveEvents events={activeEvents} />
              </ChartTooltipBox>
            )}
            {/* Hit targets: one slice per year, wider than the mark itself. */}
            <View style={StyleSheet.absoluteFill}>
              <View style={styles.slices}>
                {points.map((p) => (
                  <Pressable
                    key={p.age}
                    style={styles.slice}
                    onHoverIn={() => setActiveAge(p.age)}
                    onHoverOut={() => setActiveAge(null)}
                    onPressIn={() => setActiveAge(p.age)}
                    onPressOut={() => setActiveAge(null)}
                    accessibilityLabel={[
                      `Age ${p.age}: ${formatWholeCurrency(p.balance)}`,
                      ...sales.filter((s) => s.age === p.age).map((s) => `sells ${s.name} for ${formatWholeCurrency(s.proceeds)}`),
                      ...events.filter((e) => isEventActiveAtAge(e, p.age)).map((e) => e.label),
                    ].join(', ')}
                  />
                ))}
              </View>
            </View>
          </View>
        </View>
      </View>
      <ChartAgeAxis ages={points.map((p) => p.age)} labeledIndices={labeled} width={width} xAtIndex={x} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  yAxis: { width: Y_AXIS_WIDTH },
  yLabel: { position: 'absolute', left: 0, fontSize: 12 },
  plot: { flex: 1 },
  slices: { flex: 1, flexDirection: 'row' },
  slice: { flex: 1 },
  marker: { position: 'absolute', top: 0, width: 120, textAlign: 'center', fontSize: 12 },
  ssMarker: { position: 'absolute', top: 0, width: 72, textAlign: 'center', fontSize: 11 },
});
