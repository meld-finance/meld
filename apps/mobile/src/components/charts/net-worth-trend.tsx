import type { NetWorthPoint } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { zeroBasedScale } from '@/components/charts/scale';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatCurrency, formatDate } from '@/lib/format';

const DEFAULT_HEIGHT = 200;
const PAD_TOP = 8;
const END_PAD_X = 6; // room for the end dot
const Y_AXIS_WIDTH = 52;
const TICKS = 5;
const TOOLTIP_WIDTH = 150;

/** Index of the first point in each calendar month, for x-axis labels. */
function monthStarts(points: NetWorthPoint[]) {
  const starts: number[] = [];
  points.forEach((p, i) => {
    if (i === 0 || p.date.slice(0, 7) !== points[i - 1]!.date.slice(0, 7)) starts.push(i);
  });
  return starts;
}

/** Single-series net worth area chart. One color, no legend; the card title names it. */
export function NetWorthTrend({ points, height = DEFAULT_HEIGHT }: { points: NetWorthPoint[]; height?: number }) {
  const theme = useTheme();
  const viz = useVizColors();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Meld records your net worth once a day. The trend appears after the second day.
      </ThemedText>
    );
  }

  const values = points.map((p) => p.netWorth);
  // Anchor at zero (or below, if net worth dipped negative) so the area reads as magnitude.
  const { min, max, ticks } = zeroBasedScale(values, TICKS);

  const plotW = Math.max(width - END_PAD_X * 2, 1);
  const x = (i: number) => END_PAD_X + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (height - PAD_TOP);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(min)} L${x(0).toFixed(1)},${y(min)} Z`;

  const starts = monthStarts(points);
  // Skip the first month's label when it's only a sliver of the range.
  const labeled = starts.filter((i, k) => k > 0 || (starts[1] ?? points.length) - i > points.length / 20);
  const multiYear = points[0]!.date.slice(0, 4) !== points.at(-1)!.date.slice(0, 4);
  const monthLabel = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: multiYear ? '2-digit' : undefined });

  const shown = active ?? points.length - 1;
  const point = points[shown]!;

  return (
    <View>
      <View style={styles.row}>
        <View style={[styles.yAxis, { height }]}>
          {ticks.map((t) => (
            <ThemedText key={t} type="small" themeColor="textSecondary" style={[styles.yLabel, { top: y(t) - 10 }]}>
              {formatCompactCurrency(t)}
            </ThemedText>
          ))}
        </View>
        <View style={styles.plot} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <View style={{ height }}>
            {width > 0 && (
              <Svg width={width} height={height}>
                <Defs>
                  <LinearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={viz.trend} stopOpacity={0.22} />
                    <Stop offset="1" stopColor={viz.trend} stopOpacity={0.02} />
                  </LinearGradient>
                </Defs>
                {ticks.map((t) => (
                  <Line key={t} x1={0} x2={width} y1={y(t)} y2={y(t)} stroke={viz.grid} strokeWidth={1} />
                ))}
                <Path d={area} fill="url(#nw-fill)" />
                <Path d={line} stroke={viz.trend} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                {active !== null && (
                  <Line x1={x(shown)} x2={x(shown)} y1={0} y2={height} stroke={viz.axis} strokeWidth={1} />
                )}
                <Circle
                  cx={x(shown)}
                  cy={y(point.netWorth)}
                  r={5}
                  fill={viz.trend}
                  stroke={theme.backgroundElement}
                  strokeWidth={2}
                />
              </Svg>
            )}
            {active !== null && width > 0 && (
              <ThemedView
                type="backgroundElement"
                pointerEvents="none"
                style={[
                  styles.tooltip,
                  {
                    borderColor: theme.border,
                    left: Math.min(Math.max(x(shown) - TOOLTIP_WIDTH / 2, 0), width - TOOLTIP_WIDTH),
                  },
                ]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDate(point.date)}
                </ThemedText>
                <ThemedText type="smallBold">{formatCurrency(point.netWorth)}</ThemedText>
              </ThemedView>
            )}
            {/* Hit targets: one slice per point, wider than the mark itself. */}
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
                    accessibilityLabel={`${formatDate(p.date)}: ${formatCurrency(p.netWorth)}`}
                  />
                ))}
              </View>
            </View>
          </View>
          <View style={styles.xAxis}>
            {width > 0 &&
              labeled.map((i) => (
                <ThemedText
                  key={i}
                  type="small"
                  themeColor="textSecondary"
                  style={[styles.xLabel, { left: Math.min(Math.max(x(i) - 24, 0), width - 48) }]}>
                  {monthLabel(points[i]!.date)}
                </ThemedText>
              ))}
          </View>
        </View>
      </View>
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
  xAxis: { height: 20, marginTop: Spacing.two },
  xLabel: { position: 'absolute', width: 48, textAlign: 'center', fontSize: 12 },
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
