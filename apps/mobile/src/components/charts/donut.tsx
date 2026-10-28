import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

/** Surface gap between neighboring slices, in px along the ring. */
const GAP = 2;

/** A ring of slices sized by amount, starting at 12 o'clock; `children` sit in the middle. */
export function Donut({
  parts,
  size = 184,
  stroke = 26,
  children,
}: {
  parts: { key: string; amount: number; color: string }[];
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const sum = parts.reduce((s, p) => s + p.amount, 0) || 1;
  const lengths = parts.map((p) => (p.amount / sum) * circumference);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {parts.map((p, i) => (
          <Circle
            key={p.key}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={p.color}
            strokeWidth={stroke}
            strokeDasharray={`${Math.max(lengths[i]! - (parts.length > 1 ? GAP : 0), 0.5)} ${circumference}`}
            strokeDashoffset={-lengths.slice(0, i).reduce((s, l) => s + l, 0)}
            // Start at 12 o'clock and run clockwise.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ))}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
