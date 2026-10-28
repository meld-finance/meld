import { netCashValue } from '@meld/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatCurrency, formatDate } from '@/lib/format';
import { POLICY_TYPE_LABELS } from '@/lib/insurance';
import { useInsurancePolicies } from '@/lib/queries';

/**
 * Permanent life policies' surrender value, which counts toward net worth. Policies themselves
 * are managed on Plan → Insurance; this just shows where that part of net worth comes from.
 */
export function InsuranceCashValue() {
  const policies = useInsurancePolicies();
  const rows = (policies.data ?? []).flatMap((p) => {
    const value = netCashValue(p);
    return value === null ? [] : [{ policy: p, value }];
  });

  return (
    <Card
      title="Insurance cash value"
      subtitle="What whole and universal life policies would pay if cancelled. Counted in net worth."
      action={<Button label="Add policy" variant="secondary" size="small" onPress={() => router.push('/insurance/new')} />}>
      {policies.isError && <ThemedText themeColor="negative">{policies.error.message}</ThemedText>}
      {rows.map(({ policy: p, value }) => (
        <Pressable
          key={p.id}
          onPress={() => router.push({ pathname: '/insurance/[id]', params: { id: p.id } })}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="link"
          accessibilityHint="Show policy details">
          <View style={styles.shrink}>
            <ThemedText numberOfLines={1}>{p.carrier}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {[POLICY_TYPE_LABELS[p.type], p.valuesAsOf && `as of ${formatDate(p.valuesAsOf)}`].filter(Boolean).join(' · ')}
            </ThemedText>
          </View>
          <ThemedText>{formatCurrency(value)} ›</ThemedText>
        </Pressable>
      ))}
      {policies.isSuccess && rows.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          None yet. Term and disability policies don’t build cash value; see them under Plan.
        </ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
});
