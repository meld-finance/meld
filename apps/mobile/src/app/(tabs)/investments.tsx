import type { InvestmentsSummary } from '@meld/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ExposureTab } from '@/components/investments/exposure-tab';
import { HoldingsTab } from '@/components/investments/holdings-tab';
import { IncomeTab } from '@/components/investments/income-tab';
import { OverviewTab } from '@/components/investments/overview-tab';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UnderlineTabs } from '@/components/underline-tabs';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useInvestmentIncome, useInvestments, useProfileSecurities } from '@/lib/queries';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'exposure', label: 'Exposure' },
  { value: 'income', label: 'Income' },
  { value: 'holdings', label: 'Holdings' },
] as const;
type Tab = (typeof TABS)[number]['value'];

export default function InvestmentsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = TABS.some((t) => t.value === params.tab) ? (params.tab as Tab) : 'overview';
  const setTab = (next: Tab) => router.setParams({ tab: next === 'overview' ? undefined : next });

  const investments = useInvestments();
  const income = useInvestmentIncome();
  const data = investments.data;
  const refreshing = investments.isRefetching || income.isRefetching;
  const onRefresh = () => void Promise.all([investments.refetch(), income.refetch()]);

  const content = investments.isPending ? (
    <ThemedText themeColor="textSecondary">Loading…</ThemedText>
  ) : investments.isError ? (
    <ThemedText themeColor="negative">Couldn’t load investments: {investments.error.message}</ThemedText>
  ) : !data!.holdings.length ? (
    <Card title="No holdings yet">
      <ThemedText type="small" themeColor="textSecondary">
        Link a brokerage or retirement account to see holdings here. Accounts linked before investments were enabled may
        need to be removed and linked again.
      </ThemedText>
    </Card>
  ) : (
    <>
      <LookupStatus data={data!} />
      {tab === 'overview' && <OverviewTab data={data!} onShowExposure={() => setTab('exposure')} />}
      {tab === 'exposure' && <ExposureTab data={data!} />}
      {tab === 'income' &&
        (income.isPending ? (
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        ) : income.isError ? (
          <ThemedText themeColor="negative">Couldn’t load income: {income.error.message}</ThemedText>
        ) : (
          <IncomeTab income={income.data} summary={data!} />
        ))}
      {tab === 'holdings' && <HoldingsTab data={data!} />}
    </>
  );

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Investments</ThemedText>
        <ThemedText themeColor="textSecondary">A complete view of your portfolio, with insights for today and your tomorrow.</ThemedText>
      </View>
      <UnderlineTabs options={[...TABS]} value={tab} onChange={setTab} />
      {content}
    </Screen>
  );
}

/**
 * Looks inside funds that haven't been looked at yet, once per visit, and says so while it runs.
 * Without AI set up, explains why some of the portfolio isn't broken down.
 */
function LookupStatus({ data }: { data: InvestmentsSummary }) {
  const theme = useTheme();
  const accent = useAccents().blue;
  const profile = useProfileSecurities();
  const attempted = useRef(false);
  const { unprofiled, canProfile } = data;

  useEffect(() => {
    if (unprofiled > 0 && canProfile && !attempted.current) {
      attempted.current = true;
      profile.mutate();
    }
  }, [unprofiled, canProfile, profile]);

  if (profile.isPending) {
    return (
      <View style={[styles.status, { backgroundColor: accent.bg, borderColor: theme.border }]}>
        <ActivityIndicator size="small" color={accent.fg} />
        <ThemedText type="small">Looking inside your funds to see what they hold…</ThemedText>
      </View>
    );
  }
  if (!unprofiled) return null;
  return (
    <View style={[styles.status, { backgroundColor: accent.bg, borderColor: theme.border }]}>
      <Icon name="info" size={18} color={accent.fg} />
      <ThemedText type="small" style={styles.statusText}>
        {canProfile
          ? `${unprofiled} ${unprofiled === 1 ? 'holding hasn’t' : 'holdings haven’t'} been broken down yet${profile.error ? `: ${profile.error.message}` : '.'}`
          : 'Breaking funds down by sector and region uses the AI assistant. Add ANTHROPIC_API_KEY to .env and restart the API.'}
      </ThemedText>
      {canProfile && (
        <Pressable accessibilityRole="button" onPress={() => profile.mutate()} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" style={{ color: accent.fg }}>
            Try again
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
  statusText: { flex: 1 },
  pressed: { opacity: 0.7 },
});
