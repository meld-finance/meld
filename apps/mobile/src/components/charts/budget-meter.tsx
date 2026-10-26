import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCurrency } from '@/lib/format';

const WARN_AT = 0.85;

export type BudgetState = 'ok' | 'near' | 'over';

export function budgetState(spent: number, target: number): BudgetState {
  if (spent > target) return 'over';
  return spent >= target * WARN_AT ? 'near' : 'ok';
}

/**
 * Meter: the fill carries severity (accent → warning → critical) and the status
 * is always spelled out in text, so it never relies on color alone.
 */
export function BudgetMeter({ label, spent, target }: { label: string; spent: number; target: number }) {
  const viz = useVizColors();
  const state = budgetState(spent, target);
  const fill = state === 'over' ? viz.critical : state === 'near' ? viz.warning : viz.series1;
  const ratio = Math.min(spent / target, 1);
  const remaining = target - spent;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <ThemedText type="small" numberOfLines={1} style={styles.label}>
          {label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatCurrency(spent)} of {formatCurrency(target)}
        </ThemedText>
      </View>
      <View
        style={[styles.track, { backgroundColor: viz.track }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: target, now: spent }}>
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: fill }]} />
      </View>
      <ThemedText type="small" themeColor={state === 'over' ? 'negative' : 'textSecondary'}>
        {state === 'over'
          ? `⚠ ${formatCurrency(-remaining)} over`
          : state === 'near'
            ? `⚠ ${formatCurrency(remaining)} left`
            : `${formatCurrency(remaining)} left`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  label: { flexShrink: 1 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});
