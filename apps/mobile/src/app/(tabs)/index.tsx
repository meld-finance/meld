import { projectRetirement, resolvePlan, withPlan, type NetWorthPoint } from '@meld/shared';
import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { NetWorthTrend } from '@/components/charts/net-worth-trend';
import { AreaTiles } from '@/components/home/area-tiles';
import { AskMeldPanel } from '@/components/home/ask-meld-panel';
import { TaskList } from '@/components/home/task-list';
import { UpcomingCard } from '@/components/home/upcoming-card';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useContentWidth } from '@/lib/chat-panel';
import { currentMonth, formatCurrency, formatDate, formatWholeCurrency } from '@/lib/format';
import { buildTasks, buildUpcoming } from '@/lib/home';
import {
  useAlerts,
  useBudgets,
  useCashPlan,
  useEstate,
  useInsurancePolicies,
  useLiabilities,
  useNetWorth,
  useNetWorthHistory,
  useProfile,
  useRecurring,
  useRetirement,
  useSpending,
  useTaxPlan,
} from '@/lib/queries';

/** Days of net-worth history the home chart covers ("vs. last 6 months"). */
const HISTORY_DAYS = 183;
/** How far ahead Coming up looks. */
const UPCOMING_DAYS = 14;
/** Window width at which Ask Meld moves beside the dashboard instead of below it. */
const SIDE_PANEL_MIN_WIDTH = 1280;
/** Ask Meld's starters when there are no to-dos to ask about. */
const DEFAULT_QUESTIONS = [
  'Am I on track for retirement?',
  'Should I pay extra on my mortgage?',
  'Any tax strategies I should consider?',
  'How does my insurance coverage look?',
];

function greeting(hour = new Date().getHours()) {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export default function HomeScreen() {
  const { logout } = useAuth();
  const width = useContentWidth();
  const today = new Date().toLocaleDateString('en-CA');
  const month = currentMonth();
  const profile = useProfile();
  const netWorth = useNetWorth();
  const history = useNetWorthHistory(HISTORY_DAYS);
  const alerts = useAlerts();
  const liabilities = useLiabilities();
  const policies = useInsurancePolicies();
  const recurring = useRecurring();
  const spending = useSpending(month);
  const budgets = useBudgets(month);
  const cash = useCashPlan();
  const tax = useTaxPlan(Number(today.slice(0, 4)));
  const estate = useEstate();
  const retirementSummary = useRetirement();

  const queries = [profile, netWorth, history, alerts, liabilities, policies, recurring, spending, budgets, cash, tax, estate, retirementSummary];
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
    policies: policies.data,
  });
  const upcoming = buildUpcoming(today, UPCOMING_DAYS, recurring.data, liabilities.data, policies.data);
  const tasksLoading = [alerts, tax, cash, estate, budgets, retirementSummary, policies].some((q) => q.isPending);

  const summary = netWorth.data;
  const empty = summary && summary.byType.length === 0;
  const firstName = profile.data?.displayName?.trim().split(/\s+/)[0];
  const sidePanel = width >= SIDE_PANEL_MIN_WIDTH;
  const pressing = tasks.filter((t) => t.urgency !== 'later').length;
  const goingOut = upcoming.reduce((s, u) => s + Math.max(u.amount ?? 0, 0), 0);
  const questions = [...new Set(tasks.flatMap((t) => (t.question ? [t.question] : [])))].slice(0, 4);

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <ThemedText type="subtitle">{firstName ? `${greeting()}, ${firstName}` : greeting()}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {empty || tasksLoading
            ? 'Here’s what needs your attention across your accounts, bills and plans.'
            : [
                pressing ? `${pressing} ${pressing === 1 ? 'thing needs' : 'things need'} your attention soon` : tasks.length ? 'Nothing urgent' : 'You’re all caught up',
                goingOut ? `${formatWholeCurrency(goingOut)} going out in the next ${UPCOMING_DAYS} days` : null,
              ]
                .filter(Boolean)
                .join(' · ') + '.'}
        </ThemedText>
      </View>
      {Platform.OS !== 'web' && (
        <Pressable onPress={logout}>
          <ThemedText type="linkPrimary">Lock</ThemedText>
        </Pressable>
      )}
    </View>
  );

  const dashboard = netWorth.isPending ? (
    <ThemedText themeColor="textSecondary">Loading…</ThemedText>
  ) : netWorth.isError ? (
    <ThemedText themeColor="negative">Couldn’t load your overview: {netWorth.error.message}</ThemedText>
  ) : empty ? (
    <Card title="Welcome to Meld">
      <ThemedText type="small" themeColor="textSecondary">
        Link your bank, card, brokerage and loan accounts to see what needs your attention, what’s coming up, and how your
        plans are doing.
      </ThemedText>
      <Link href="/accounts">
        <ThemedText type="linkPrimary">Link your first account →</ThemedText>
      </Link>
    </Card>
  ) : (
    <>
      <View style={styles.columns}>
        <TaskList tasks={tasks} today={today} loading={tasksLoading} style={styles.tasksColumn} />
        <UpcomingCard items={upcoming} today={today} days={UPCOMING_DAYS} style={styles.upcomingColumn} />
      </View>

      <View style={styles.section}>
        <ThemedText type="cardTitle">Where things stand</ThemedText>
        <AreaTiles
          today={today}
          cash={cash.data}
          spending={spending.data}
          budgets={budgets.data}
          retirement={retirement}
          tax={tax.data}
          estate={estate.data}
          policies={policies.data}
        />
      </View>

      <Card
        action={
          <Link href="/accounts">
            <ThemedText type="small" themeColor="tint">
              Accounts →
            </ThemedText>
          </Link>
        }
        title="Net worth">
        <View style={styles.netWorthValueRow}>
          <ThemedText style={styles.netWorthValue}>{formatCurrency(summary!.netWorth)}</ThemedText>
          {history.data && <NetWorthChange points={history.data} />}
        </View>
        {history.data && <NetWorthTrend points={history.data} height={140} />}
      </Card>
    </>
  );

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {sidePanel ? (
        <View style={styles.split}>
          <View style={styles.main}>
            {header}
            {dashboard}
          </View>
          <AskMeldPanel style={styles.sidePanel} suggestions={questions.length ? questions : DEFAULT_QUESTIONS} />
        </View>
      ) : (
        <>
          {header}
          {dashboard}
          <AskMeldPanel suggestions={questions.length ? questions : DEFAULT_QUESTIONS} />
        </>
      )}
    </Screen>
  );
}

/** Change from the first point in the window to the latest, labeled with the window. */
function NetWorthChange({ points }: { points: NetWorthPoint[] }) {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points.at(-1)!;
  const delta = last.netWorth - first.netWorth;
  const pct = first.netWorth > 0 ? (delta / first.netWorth) * 100 : null;
  const up = delta >= 0;
  const spanDays = (Date.parse(last.date) - Date.parse(first.date)) / 86_400_000;
  const since = spanDays >= HISTORY_DAYS - 14 ? 'vs. last 6 months' : `since ${formatDate(first.date)}`;
  const amount = pct === null ? formatCurrency(Math.abs(delta)) : `${Math.abs(pct).toFixed(pct && Math.abs(pct) < 10 ? 1 : 0)}%`;

  return (
    <View style={styles.change}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={16} themeColor={up ? 'positive' : 'negative'} strokeWidth={2.25} />
      <ThemedText type="smallBold" themeColor={up ? 'positive' : 'negative'}>
        {amount}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.since}>
        {since}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  main: { flex: 1, minWidth: 0, gap: Spacing.three + Spacing.one },
  sidePanel: { width: 360, marginTop: Spacing.six + Spacing.four },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three, marginBottom: Spacing.two },
  headerText: { flexShrink: 1, gap: Spacing.one },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, alignItems: 'flex-start' },
  tasksColumn: { flexGrow: 3, flexBasis: 420 },
  upcomingColumn: { flexGrow: 2, flexBasis: 300 },
  section: { gap: Spacing.three, marginTop: Spacing.two },
  netWorthValueRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Spacing.four, rowGap: Spacing.one },
  netWorthValue: { fontSize: 32, lineHeight: 40, fontWeight: 700, letterSpacing: -0.5 },
  change: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  since: { marginLeft: Spacing.three },
});
