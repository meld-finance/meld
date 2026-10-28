import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { niceStep } from '@/components/charts/scale';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatDate, formatWholeCurrency } from '@/lib/format';

const HEIGHT = 220;
const PAD_TOP = 8;
const END_PAD_X = 6;
const Y_AXIS_WIDTH = 56;
const TICKS = 5;
const TOOLTIP_WIDTH = 190;

export type GrowthPoint = {
  date: string;
  value: number;
  /** The starting value plus every deposit since, less withdrawals. */
  contributed: number;
};

/** A y-scale hugging the data (not from zero): the gap between the lines is the story, not their size. */
function fittedScale(values: number[]) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const step = niceStep(hi - lo || Math.abs(hi) || 1, TICKS - 1);
  const min = Math.floor(lo / step) * step;
  const max = Math.max(Math.ceil(hi / step) * step, min + step);
  return { min, max, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step) };
}

/** Index of the first point in each month (or each quarter, over long ranges), for x-axis labels. */
function labelStarts(points: GrowthPoint[]) {
  const quarterly = points.length > 1 && Date.parse(points.at(-1)!.date) - Date.parse(points[0]!.date) > 400 * 86_400_000;
  const starts: number[] = [];
  points.forEach((p, i) => {
    const month = Number(p.date.slice(5, 7));
    if (i > 0 && p.date.slice(0, 7) !== points[i - 1]!.date.slice(0, 7) && (!quarterly || month % 3 === 1)) starts.push(i);
  });
  return starts;
}

/** Portfolio value against the money put in; the gap between them is what markets earned. */
export function GrowthTrend({ points }: { points: GrowthPoint[] }) {
  const theme = useTheme();
  const viz = useVizColors();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Not enough history for this period yet.
      </ThemedText>
    );
  }

  const colors = { value: viz.series1, contributed: viz.series2 };
  const { min, max, ticks } = fittedScale(points.flatMap((p) => [p.value, p.contributed]));
  const plotW = Math.max(width - END_PAD_X * 2, 1);
  const x = (i: number) => END_PAD_X + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (HEIGHT - PAD_TOP);
  const path = (key: 'value' | 'contributed') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const valueLine = path('value');
  const contributedLine = path('contributed');
  // Shade between the lines: the gain (or loss) at each point.
  const between = `${valueLine} ${[...points]
    .map((p, k) => {
      const i = points.length - 1 - k;
      return `L${x(i).toFixed(1)},${y(points[i]!.contributed).toFixed(1)}`;
    })
    .join(' ')} Z`;

  const multiYear = points[0]!.date.slice(0, 4) !== points.at(-1)!.date.slice(0, 4);
  const monthLabel = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: multiYear ? '2-digit' : undefined });

  const shown = active ?? points.length - 1;
  const point = points[shown]!;
  const gain = point.value - point.contributed;

  return (
    <View style={styles.wrap}>
      <View style={styles.legend}>
        <LegendItem color={colors.value} label="Portfolio value" value={point.value} />
        <LegendItem color={colors.contributed} label="Money put in" value={point.contributed} dashed />
        <ThemedText type="small" themeColor="textSecondary">
          Gain{' '}
          <ThemedText type="smallBold" themeColor={gain >= 0 ? 'positive' : 'negative'}>
            {gain >= 0 ? '+' : '−'}
            {formatWholeCurrency(Math.abs(gain))}
          </ThemedText>
          {active === null ? '' : ` · ${formatDate(point.date)}`}
        </ThemedText>
      </View>
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
                <Path d={between} fill={viz.seriesWash} />
                <Path
                  d={contributedLine}
                  stroke={colors.contributed}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  fill="none"
                  strokeLinejoin="round"
                />
                <Path d={valueLine} stroke={colors.value} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                {active !== null && <Line x1={x(shown)} x2={x(shown)} y1={0} y2={HEIGHT} stroke={viz.axis} strokeWidth={1} />}
                <Circle cx={x(shown)} cy={y(point.contributed)} r={4} fill={colors.contributed} stroke={theme.backgroundElement} strokeWidth={2} />
                <Circle cx={x(shown)} cy={y(point.value)} r={5} fill={colors.value} stroke={theme.backgroundElement} strokeWidth={2} />
              </Svg>
            )}
            {active !== null && width > 0 && (
              <ThemedView
                type="backgroundElement"
                pointerEvents="none"
                style={[
                  styles.tooltip,
                  { borderColor: theme.border, left: Math.min(Math.max(x(shown) - TOOLTIP_WIDTH / 2, 0), width - TOOLTIP_WIDTH) },
                ]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDate(point.date)}
                </ThemedText>
                <ThemedText type="small">
                  Value <ThemedText type="smallBold">{formatWholeCurrency(point.value)}</ThemedText>
                </ThemedText>
                <ThemedText type="small">
                  Put in <ThemedText type="smallBold">{formatWholeCurrency(point.contributed)}</ThemedText>
                </ThemedText>
              </ThemedView>
            )}
            <View style={StyleSheet.absoluteFill}>
              <View style={styles.slices}>
                {points.map((p, i) => (
                  <Pressable
                    key={p.date}
                    style={styles.slice}
                    onHoverIn={() => setActive(i)}
                    onHoverOut={() => setActive(null)}
                    onPressIn={() => setActive(i)}
                    onPressOut={() => setActive(null)}
                    accessibilityLabel={`${formatDate(p.date)}: value ${formatWholeCurrency(p.value)}, put in ${formatWholeCurrency(p.contributed)}`}
                  />
                ))}
              </View>
            </View>
          </View>
          <View style={styles.xAxis}>
            {width > 0 &&
              labelStarts(points).map((i) => (
                <ThemedText
                  key={i}
                  type="small"
                  themeColor="textSecondary"
                  style={[styles.xLabel, { left: Math.min(Math.max(x(i) - 28, 0), width - 56) }]}>
                  {monthLabel(points[i]!.date)}
                </ThemedText>
              ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function LegendItem({ color, label, value, dashed }: { color: string; label: string; value: number; dashed?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, dashed ? { borderColor: color, borderTopWidth: 2, borderStyle: 'dashed' } : { backgroundColor: color }]} />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={styles.numeric}>
        {formatWholeCurrency(value)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  swatch: { width: 14, height: 2, borderRadius: 1 },
  numeric: { fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row' },
  yAxis: { width: Y_AXIS_WIDTH },
  yLabel: { position: 'absolute', left: 0, fontSize: 12 },
  plot: { flex: 1 },
  slices: { flex: 1, flexDirection: 'row' },
  slice: { flex: 1 },
  xAxis: { height: 20, marginTop: Spacing.two },
  xLabel: { position: 'absolute', width: 56, textAlign: 'center', fontSize: 12 },
  tooltip: {
    position: 'absolute',
    top: 0,
    width: TOOLTIP_WIDTH,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
});
