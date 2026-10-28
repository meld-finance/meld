import type { RetirementProjection as Projection } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { zeroBasedScale } from '@/components/charts/scale';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';

const HEIGHT = 220;
const PAD_TOP = 22; // room for the retirement label
const END_PAD_X = 6;
const Y_AXIS_WIDTH = 52;
const TICKS = 5;
const TOOLTIP_WIDTH = 150;

/** Projected balance by age: savings grow to the dashed retirement line, then are drawn down. */
export function RetirementProjection({
  points,
  retirementAge,
  sales = [],
}: {
  points: Projection['points'];
  retirementAge: number;
  /** Property sales, marked on the line where the balance steps up. */
  sales?: Projection['sales'];
}) {
  const theme = useTheme();
  const viz = useVizColors();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  if (points.length < 2) return null;

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
  // Ages every 5 or 10 years, depending on the span.
  const every = points.length > 40 ? 10 : 5;
  const labeled = points.map((p, i) => (p.age % every === 0 ? i : -1)).filter((i) => i >= 0);

  const shown = active ?? (retireIndex >= 0 ? retireIndex : points.length - 1);
  const point = points[shown]!;
  const year = new Date().getFullYear() + (point.age - points[0]!.age);
  const salesShown = sales.filter((s) => s.age === point.age);
  const saleIndex = (age: number) => points.findIndex((p) => p.age === age);

  return (
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
              <Path d={line} stroke={viz.trend} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {active !== null && <Line x1={x(shown)} x2={x(shown)} y1={0} y2={HEIGHT} stroke={viz.axis} strokeWidth={1} />}
              {sales.map((s) => {
                const i = saleIndex(s.age);
                return i < 0 ? null : (
                  <Circle
                    key={`${s.name}-${s.age}`}
                    cx={x(i)}
                    cy={y(points[i]!.balance)}
                    r={4}
                    fill={theme.backgroundElement}
                    stroke={viz.trend}
                    strokeWidth={2}
                  />
                );
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
          {active !== null && width > 0 && (
            <ThemedView
              type="backgroundElement"
              pointerEvents="none"
              style={[
                styles.tooltip,
                { borderColor: theme.border, left: Math.min(Math.max(x(shown) - TOOLTIP_WIDTH / 2, 0), width - TOOLTIP_WIDTH) },
              ]}>
              <ThemedText type="small" themeColor="textSecondary">
                Age {point.age} · {year}
              </ThemedText>
              <ThemedText type="smallBold">{formatWholeCurrency(point.balance)}</ThemedText>
              {salesShown.map((s) => (
                <ThemedText key={s.name} type="small" themeColor="textSecondary">
                  Sell {s.name}: +{formatCompactCurrency(s.proceeds)}
                </ThemedText>
              ))}
            </ThemedView>
          )}
          {/* Hit targets: one slice per year, wider than the mark itself. */}
          <View style={StyleSheet.absoluteFill}>
            <View style={styles.slices}>
              {points.map((p, i) => (
                <Pressable
                  key={p.age}
                  style={styles.slice}
                  onHoverIn={() => setActive(i)}
                  onHoverOut={() => setActive(null)}
                  onPressIn={() => setActive(i)}
                  onPressOut={() => setActive(null)}
                  accessibilityLabel={[
                    `Age ${p.age}: ${formatWholeCurrency(p.balance)}`,
                    ...sales.filter((s) => s.age === p.age).map((s) => `sells ${s.name} for ${formatWholeCurrency(s.proceeds)}`),
                  ].join(', ')}
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
                {points[i]!.age}
              </ThemedText>
            ))}
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
  marker: { position: 'absolute', top: 0, width: 120, textAlign: 'center', fontSize: 12 },
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
