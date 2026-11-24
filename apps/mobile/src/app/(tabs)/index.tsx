import { projectRetirement, resolvePlan, withPlan } from '@meld/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { AreaTiles } from '@/components/home/area-tiles';
import { AskMeldBar } from '@/components/home/ask-meld-bar';
import { NET_WORTH_RANGE_DAYS, NetWorthHero, type NetWorthRange } from '@/components/home/net-worth-hero';
import { SetupGuide } from '@/components/home/setup-guide';
import { TaskList } from '@/components/home/task-list';
import { UpcomingCard } from '@/components/home/upcoming-card';
import { VitalsGrid } from '@/components/home/vitals-grid';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth';
import { useContentWidth } from '@/lib/chat-panel';
import { currentMonth, formatWholeCurrency } from '@/lib/format';
import { buildSetupSteps, buildTasks, buildUpcoming } from '@/lib/home';
import {
  useAlertSettings,
  useAlerts,
  useBalanceComparison,
  useBudgets,
  useCashPlan,
  useEstate,
  useInsurancePolicies,
  useLiabilities,
  useManualAssets,
  useNetWorth,
  useNetWorthHistory,
  useProfile,
  useRecurring,
  useRetirement,
  useSpending,
  useTaxPlan,
} from '@/lib/queries';

/** How far ahead Coming up looks. */
const UPCOMING_DAYS = 14;
/** Ask Meld's starters when there are no to-dos to ask about. */
const DEFAULT_QUESTIONS = [
  'Am I on track for retirement?',
  'Should I pay extra on my mortgage?',
  'Any tax strategies I should consider?',
];

function greeting(hour = new Date().getHours()) {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export default function HomeScreen() {
  const { logout, canLock } = useAuth();
  const accents = useAccents();
  const dark = useColorScheme() === 'dark';
  const width = useContentWidth();
  const [range, setRange] = useState<NetWorthRange>('6M');
  const today = new Date().toLocaleDateString('en-CA');
  const month = currentMonth();

  const profile = useProfile();
  const netWorth = useNetWorth();
  const history = useNetWorthHistory(NET_WORTH_RANGE_DAYS[range]);
  const comparison = useBalanceComparison(30);
  const manualAssets = useManualAssets();
  const alerts = useAlerts();
  const alertSettings = useAlertSettings();
  const liabilities = useLiabilities();
  const policies = useInsurancePolicies();
  const recurring = useRecurring();
  const spending = useSpending(month);
  const budgets = useBudgets(month);
  const cash = useCashPlan();
  const tax = useTaxPlan(Number(today.slice(0, 4)));
  const estate = useEstate();
  const retirementSummary = useRetirement();

  const queries = [
    profile,
    netWorth,
    history,
    comparison,
    manualAssets,
    alerts,
    alertSettings,
    liabilities,
    policies,
    recurring,
    spending,
    budgets,
    cash,
    tax,
    estate,
    retirementSummary,
  ];
  const refreshing = queries.some((q) => q.isRefetching);
  const onRefresh = () => void Promise.all(queries.map((q) => q.refetch()));

  const retirement = useMemo(() => {
    const s = retirementSummary.data;
    if (!s) return undefined;
    const { inputs, missing } = resolvePlan(s.plan, withPlan(s, s.plan));
    return { projection: inputs && projectRetirement(inputs), missing };
  }, [retirementSummary.data]);

  const tasks = buildTasks({
    today,
    alerts: alerts.data?.alerts,
    tax: tax.data,
    cash: cash.data,
    estate: estate.data,
    budgets: budgets.data,
    retirement,
  });
  const upcoming = buildUpcoming(today, UPCOMING_DAYS, recurring.data, liabilities.data, policies.data);
  const setup = buildSetupSteps({
    profile: profile.data,
    manualAssets: manualAssets.data,
    liabilities: liabilities.data,
    recurring: recurring.data,
    tax: tax.data,
    budgets: budgets.data,
    policies: policies.data,
    estate: estate.data,
    alertSettings: alertSettings.data,
  });

  const tasksLoading = [alerts, tax, cash, estate, budgets, retirementSummary].some((q) => q.isPending);
  const summary = netWorth.data;
  const empty = summary && summary.byType.length === 0;
  const firstName = profile.data?.displayName?.trim().split(/\s+/)[0];

  const heroSideBySide = width >= 960;
  const actionSideBySide = width >= 900;
  const planColumns: 1 | 2 | 4 = width >= 960 ? 4 : width >= 540 ? 2 : 1;
  const compact = width < 540;

  const urgentNow = tasks.filter((t) => t.urgency === 'now').length;
  const pressing = tasks.filter((t) => t.urgency !== 'later').length;
  const goingOut = upcoming.reduce((s, u) => s + Math.max(u.amount ?? 0, 0), 0);
  const questions = [...new Set(tasks.flatMap((t) => (t.question ? [t.question] : [])))].slice(0, 3);
  const negPillBg = dark ? 'rgba(242, 139, 130, 0.16)' : 'rgba(197, 34, 31, 0.10)';

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <ThemedText type="subtitle">{firstName ? `${greeting()}, ${firstName}` : greeting()}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {empty || tasksLoading
            ? 'Here’s what needs your attention across your accounts, bills and plans.'
            : [
                pressing
                  ? `${pressing} ${pressing === 1 ? 'thing needs' : 'things need'} your attention soon`
                  : tasks.length
                    ? 'Nothing urgent'
                    : 'You’re all caught up',
                goingOut ? `${formatWholeCurrency(goingOut)} going out in the next ${UPCOMING_DAYS} days` : null,
              ]
                .filter(Boolean)
                .join(' · ') + '.'}
        </ThemedText>
      </View>
      <View style={styles.headerRight}>
        {!empty && !tasksLoading && pressing > 0 && (
          <View style={[styles.urgentPill, { backgroundColor: urgentNow > 0 ? negPillBg : accents.orange.bg }]}>
            <ThemedText type="smallBold" themeColor={urgentNow > 0 ? 'negative' : 'warning'} style={styles.urgentPillText}>
              {urgentNow > 0 ? `${urgentNow} urgent` : `${pressing} needs attention`}
            </ThemedText>
          </View>
        )}
        {Platform.OS !== 'web' && canLock && (
          <Pressable onPress={logout}>
            <ThemedText type="linkPrimary">Lock</ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );

  const dashboard = netWorth.isPending ? (
    <ThemedText themeColor="textSecondary">Loading…</ThemedText>
  ) : netWorth.isError ? (
    <ThemedText themeColor="negative">Couldn’t load your overview: {netWorth.error.message}</ThemedText>
  ) : empty ? (
    <>
      <Card
        title="Welcome to Meld"
        subtitle="Link your bank, card, brokerage and loan accounts to see your full financial picture in one place.">
        <View style={styles.welcomeSteps}>
          <ThemedText type="small" themeColor="textSecondary">
            1. Link your checking, credit card, investment, and loan accounts.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            2. Add your profile details for tailored tax, Social Security, and retirement estimates.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            3. Track upcoming bills, cash yields, and estate readiness—or ask Meld anytime.
          </ThemedText>
        </View>
        <View style={styles.welcomeCta}>
          <Button label="Link your first account" onPress={() => router.push('/accounts')} />
        </View>
      </Card>
      <AskMeldBar suggestions={DEFAULT_QUESTIONS} compact={compact} />
    </>
  ) : (
    <>
      <AskMeldBar suggestions={questions.length ? questions : DEFAULT_QUESTIONS} compact={compact} />

      <View style={heroSideBySide ? styles.heroRow : styles.stack}>
        <NetWorthHero
          summary={summary!}
          points={history.data}
          range={range}
          onRangeChange={setRange}
          style={heroSideBySide ? styles.mainCol : undefined}
        />
        <VitalsGrid
          today={today}
          summary={summary!}
          comparison={comparison.data}
          cash={cash.data}
          spending={spending.data}
          budgets={budgets.data}
          upcomingOut={goingOut}
          upcomingCount={upcoming.length}
          nextUpcoming={upcoming[0]}
          style={heroSideBySide ? styles.sideCol : undefined}
        />
      </View>

      <SetupGuide progress={setup} wide={heroSideBySide} />

      <View style={actionSideBySide ? styles.actionRow : styles.stack}>
        <TaskList
          tasks={tasks}
          today={today}
          loading={tasksLoading}
          style={actionSideBySide ? styles.mainCol : undefined}
        />
        <UpcomingCard
          items={upcoming}
          today={today}
          days={UPCOMING_DAYS}
          style={actionSideBySide ? styles.sideCol : undefined}
        />
      </View>

      <View style={styles.section}>
        <ThemedText type="cardTitle">Your plan at a glance</ThemedText>
        <AreaTiles
          columns={planColumns}
          today={today}
          retirement={retirement}
          tax={tax.data}
          estate={estate.data}
          policies={policies.data}
        />
      </View>
    </>
  );

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {header}
      {dashboard}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  headerText: { flex: 1, minWidth: 220, gap: Spacing.one },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  urgentPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  urgentPillText: { fontSize: 12, lineHeight: 16 },
  heroRow: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.three },
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  stack: { gap: Spacing.three },
  mainCol: { flex: 7, minWidth: 0 },
  sideCol: { flex: 5, minWidth: 0 },
  section: { gap: Spacing.three, marginTop: Spacing.one },
  welcomeSteps: { gap: Spacing.two },
  welcomeCta: { alignSelf: 'flex-start' },
});
