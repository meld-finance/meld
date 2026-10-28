import type { InvestmentsSummary } from '@meld/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Segmented } from '@/components/cashflow/segmented';
import { Icon } from '@/components/icon';
import { ExposureTab } from '@/components/investments/exposure-tab';
import { HoldingsTab } from '@/components/investments/holdings-tab';
import { IncomeTab } from '@/components/investments/income-tab';
import { OverviewTab } from '@/components/investments/overview-tab';
import { PerformanceTab } from '@/components/investments/performance-tab';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTabParam } from '@/hooks/use-tab-param';
import { useTheme } from '@/hooks/use-theme';
import { useInvestmentIncome, useInvestmentPerformance, useInvestments, useProfileSecurities } from '@/lib/queries';

const VIEWS = [
  { value: 'overview', label: 'Overview' },
  { value: 'performance', label: 'Performance' },
  { value: 'exposure', label: 'Exposure' },
  { value: 'income', label: 'Income' },
  { value: 'holdings', label: 'Holdings' },
] as const;

/** The portfolio across investment accounts, in five views. */
export function InvestmentsTab({ header }: { header: ReactNode }) {
  const [view, setView] = useTabParam(VIEWS, 'view');

  const investments = useInvestments();
  const income = useInvestmentIncome();
  const performance = useInvestmentPerformance(view === 'performance');
  const data = investments.data;
  const refreshing = investments.isRefetching || income.isRefetching || performance.isRefetching;
  const onRefresh = () => void Promise.all([investments.refetch(), income.refetch(), ...(view === 'performance' ? [performance.refetch()] : [])]);

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
      {view === 'overview' && <OverviewTab data={data!} onShowExposure={() => setView('exposure')} />}
      {view === 'performance' &&
        (performance.isPending ? (
          <ThemedText themeColor="textSecondary">Loading… (the first visit fetches price history)</ThemedText>
        ) : performance.isError ? (
          <ThemedText themeColor="negative">Couldn’t load performance: {performance.error.message}</ThemedText>
        ) : (
          <PerformanceTab data={performance.data} />
        ))}
      {view === 'exposure' && <ExposureTab data={data!} />}
      {view === 'income' &&
        (income.isPending ? (
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        ) : income.isError ? (
          <ThemedText themeColor="negative">Couldn’t load income: {income.error.message}</ThemedText>
        ) : (
          <IncomeTab income={income.data} summary={data!} />
        ))}
      {view === 'holdings' && <HoldingsTab data={data!} />}
    </>
  );

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {header}
      <View style={styles.views}>
        <Segmented options={[...VIEWS]} value={view} onChange={setView} />
      </View>
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
  views: { flexDirection: 'row' },
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
