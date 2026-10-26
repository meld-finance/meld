import type { NetWorthPoint } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatCurrency, formatDate } from '@/lib/format';

const HEIGHT = 120;
const PAD_Y = 8;
const END_PAD_X = 6; // room for the end dot

/** Single-series net worth line. One color, no legend; the card title names it. */
export function NetWorthTrend({ points }: { points: NetWorthPoint[] }) {
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
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const plotW = Math.max(width - END_PAD_X * 2, 1);
  const x = (i: number) => END_PAD_X + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD_Y + (1 - (v - min) / span) * (HEIGHT - PAD_Y * 2);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${HEIGHT} L${x(0).toFixed(1)},${HEIGHT} Z`;
  const shown = active ?? points.length - 1;
  const point = points[shown]!;

  return (
    <View style={styles.wrap}>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDate(point.date)} · {formatCurrency(point.netWorth)}
      </ThemedText>
      <View style={{ height: HEIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            <Line x1={0} x2={width} y1={y(max)} y2={y(max)} stroke={viz.grid} strokeWidth={1} />
            <Line x1={0} x2={width} y1={y(min)} y2={y(min)} stroke={viz.grid} strokeWidth={1} />
            <Path d={area} fill={viz.seriesWash} />
            <Path d={line} stroke={viz.series1} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {active !== null && (
              <Line x1={x(shown)} x2={x(shown)} y1={0} y2={HEIGHT} stroke={viz.axis} strokeWidth={1} />
            )}
            <Circle
              cx={x(shown)}
              cy={y(point.netWorth)}
              r={4}
              fill={viz.series1}
              stroke={theme.backgroundElement}
              strokeWidth={2}
            />
          </Svg>
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
                accessibilityLabel={`${formatDate(p.date)}: ${formatCurrency(p.netWorth)}`}
              />
            ))}
          </View>
        </View>
      </View>
      <View style={styles.axis}>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDate(points[0]!.date)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatCompactCurrency(min)} – {formatCompactCurrency(max)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  slices: { flex: 1, flexDirection: 'row' },
  slice: { flex: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
