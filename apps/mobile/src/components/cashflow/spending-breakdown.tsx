import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { categoryLabel, OTHER } from '@/lib/cashflow';
import { formatWholeCurrency } from '@/lib/format';

const SIZE = 184;
const STROKE = 26;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Surface gap between neighboring slices, in px along the ring. */
const GAP = 2;

/** Share of the period's spending by category: a donut with the total inside, plus a value legend. */
export function SpendingBreakdown({
  parts,
  total,
  slots,
  periodLabel,
  onSelect,
  style,
}: {
  parts: { category: string; amount: number }[];
  total: number;
  slots: Map<string, number>;
  periodLabel: string;
  /** Opens a category's details; "Other" isn't one category, so it doesn't open. */
  onSelect: (category: string) => void;
  style?: object;
}) {
  const theme = useTheme();
  const viz = useVizColors();
  const color = (category: string) => (category === OTHER ? viz.other : viz.categorical[slots.get(category)!]!);
  const sum = parts.reduce((s, p) => s + p.amount, 0) || 1;

  const lengths = parts.map((p) => (p.amount / sum) * CIRCUMFERENCE);
  const arcs = parts.map((p, i) => ({
    ...p,
    start: lengths.slice(0, i).reduce((s, l) => s + l, 0),
    length: lengths[i]!,
  }));

  return (
    <Card title="Spending Breakdown" subtitle={periodLabel} style={style}>
      <View style={styles.donutWrap}>
        <Svg width={SIZE} height={SIZE}>
          {arcs.map((a) => (
            <Circle
              key={a.category}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={color(a.category)}
              strokeWidth={STROKE}
              strokeDasharray={`${Math.max(a.length - (arcs.length > 1 ? GAP : 0), 0.5)} ${CIRCUMFERENCE}`}
              strokeDashoffset={-a.start}
              // Start at 12 o'clock and run clockwise.
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          ))}
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <ThemedText style={styles.total}>{formatWholeCurrency(total)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
            Total Spending
          </ThemedText>
        </View>
      </View>

      <View style={styles.legend}>
        {parts.map((p) => (
          <Pressable
            key={p.category}
            disabled={p.category === OTHER}
            onPress={() => onSelect(p.category)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole={p.category === OTHER ? undefined : 'button'}
            accessibilityLabel={`${categoryLabel(p.category)}: ${formatWholeCurrency(p.amount)}`}>
            <View style={[styles.dot, { backgroundColor: color(p.category) }]} />
            <ThemedText type="small" style={styles.label} numberOfLines={1}>
              {categoryLabel(p.category)}
            </ThemedText>
            <ThemedText type="small" style={[styles.pct, { color: theme.textSecondary }]}>
              {Math.round((p.amount / sum) * 100)}%
            </ThemedText>
            <ThemedText type="smallBold" style={styles.amount}>
              {formatWholeCurrency(p.amount)}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  donutWrap: { alignSelf: 'center', width: SIZE, height: SIZE },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  total: { fontSize: 20, lineHeight: 26, fontWeight: 700 },
  caption: { fontSize: 12, lineHeight: 16 },
  legend: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { flex: 1 },
  pct: { width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.6 },
  amount: { minWidth: 76, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
