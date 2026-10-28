import { router, useLocalSearchParams } from 'expo-router';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { InsuranceTab } from '@/components/plan/insurance-tab';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UnderlineTabs } from '@/components/underline-tabs';
import { Spacing } from '@/constants/theme';
import { useInsurancePolicies } from '@/lib/queries';

// Retirement and other planning tools join Insurance here as they arrive.
const TABS = [{ value: 'insurance', label: 'Insurance' }] as const;
type Tab = (typeof TABS)[number]['value'];

export default function PlanScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = TABS.some((t) => t.value === params.tab) ? (params.tab as Tab) : 'insurance';
  const setTab = (next: Tab) => router.setParams({ tab: next === 'insurance' ? undefined : next });

  const policies = useInsurancePolicies();

  return (
    <Screen refreshControl={<RefreshControl refreshing={policies.isRefetching} onRefresh={() => void policies.refetch()} />}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle">Plan</ThemedText>
          {tab === 'insurance' && (
            <Button label="Add policy" size="small" onPress={() => router.push('/insurance/new')} />
          )}
        </View>
        <ThemedText themeColor="textSecondary">Make sure you and your family are covered, today and later.</ThemedText>
      </View>
      <UnderlineTabs options={[...TABS]} value={tab} onChange={setTab} />
      {tab === 'insurance' && <InsuranceTab policies={policies} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
});
