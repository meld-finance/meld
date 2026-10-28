import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** Percent change from `then` to `now`; null without a starting balance to compare against. */
export function percentChange(now: number, then: number | null | undefined): number | null {
  if (then == null || then === 0) return null;
  return ((now - then) / Math.abs(then)) * 100;
}

/**
 * "↑ 6%" in green or "↓ 2%" in red. Pass `liability` for amounts owed, where a rise is bad news.
 * Renders an empty slot when there's nothing to compare, so columns stay aligned.
 */
export function Change({ percent, liability, style }: { percent: number | null; liability?: boolean; style?: object }) {
  if (percent === null || !Number.isFinite(percent)) return <View style={style} />;
  const rounded = Math.abs(percent) < 10 ? Math.round(Math.abs(percent) * 10) / 10 : Math.round(Math.abs(percent));
  if (rounded === 0) {
    return (
      <View style={[styles.row, style]}>
        <ThemedText type="small" themeColor="textSecondary">
          0%
        </ThemedText>
      </View>
    );
  }
  const up = percent > 0;
  const good = up !== !!liability;
  return (
    <View style={[styles.row, style]} accessibilityLabel={`${up ? 'Up' : 'Down'} ${rounded}%`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={14} themeColor={good ? 'positive' : 'negative'} strokeWidth={2.25} />
      <ThemedText type="smallBold" themeColor={good ? 'positive' : 'negative'}>
        {rounded}%
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.half },
});
