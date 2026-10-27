import type { NetWorthPoint } from '@meld/shared';
import { Link } from 'expo-router';
import { Platform, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Card } from '@/components/card';
import { BudgetMeter } from '@/components/charts/budget-meter';
import { CashflowChart } from '@/components/charts/cashflow-chart';
import { CategoryBars } from '@/components/charts/category-bars';
import { NetWorthTrend } from '@/components/charts/net-worth-trend';
import { AskMeldPanel } from '@/components/home/ask-meld-panel';
import { SummaryTiles } from '@/components/home/summary-tiles';
import { UpcomingCard } from '@/components/home/upcoming-card';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { currentMonth, formatCategory, formatCurrency, formatDate, formatMonth } from '@/lib/format';
import {
  useAccounts,
  useBudgets,
  useCashflow,
  useInsurancePolicies,
  useLiabilities,
  useNetWorth,
  useNetWorthHistory,
  useProfile,
  useSpending,
} from '@/lib/queries';
import { upcomingPayments } from '@/lib/upcoming';

/** Days of net-worth history the home chart covers ("vs. last 6 months"). */
const HISTORY_DAYS = 183;
/** Window width at which Ask Meld moves beside the dashboard instead of below it. */
const SIDE_PANEL_MIN_WIDTH = 1280;

function greeting(hour = new Date().getHours()) {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export default function HomeScreen() {
  const { logout } = useAuth();
  const { width } = useWindowDimensions();
  const month = currentMonth();
  const profile = useProfile();
  const netWorth = useNetWorth();
  const accounts = useAccounts();
  const history = useNetWorthHistory(HISTORY_DAYS);
  const liabilities = useLiabilities();
  const policies = useInsurancePolicies();
  const cashflow = useCashflow(6);
  const spending = useSpending(month);
  const budgets = useBudgets(month);

  const queries = [profile, netWorth, accounts, history, liabilities, policies, cashflow, spending, budgets];
  const refreshing = queries.some((q) => q.isRefetching);
  const onRefresh = () => void Promise.all(queries.map((q) => q.refetch()));

  const summary = netWorth.data;
  const empty = summary && summary.byType.length === 0;
  const firstName = profile.data?.displayName?.trim().split(/\s+/)[0];
  const sidePanel = width >= SIDE_PANEL_MIN_WIDTH;

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <ThemedText type="subtitle">{firstName ? `${greeting()}, ${firstName}` : greeting()}</ThemedText>
        <ThemedText themeColor="textSecondary">
          Here’s your complete financial picture — and a few insights to consider.
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
        Link your bank, card, brokerage and loan accounts to see your net worth, cash flow and budgets here.
      </ThemedText>
      <Link href="/accounts">
        <ThemedText type="linkPrimary">Link your first account →</ThemedText>
      </Link>
    </Card>
  ) : (
    <>
      <SummaryTiles summary={summary!} accounts={accounts.data ?? []} policies={policies.data} />

      <View style={styles.columns}>
        <Card style={styles.netWorthColumn}>
          <View style={styles.netWorthHeader}>
            <ThemedText type="cardTitle">Net Worth</ThemedText>
            <View style={styles.netWorthValueRow}>
              <ThemedText style={styles.netWorthValue}>{formatCurrency(summary!.netWorth)}</ThemedText>
              {history.data && <NetWorthChange points={history.data} />}
            </View>
          </View>
          {history.data && <NetWorthTrend points={history.data} />}
        </Card>

        <UpcomingCard
          style={styles.upcomingColumn}
          payments={upcomingPayments(liabilities.data ?? [], policies.data ?? [])}
        />
      </View>

      <Card
        title="Cash flow"
        subtitle="Last 6 months · excludes transfers and card payments"
        action={
          <Link href="/cashflow">
            <ThemedText type="small" themeColor="tint">
              Details →
            </ThemedText>
          </Link>
        }>
        {cashflow.isError ? (
          <ThemedText themeColor="negative">{cashflow.error.message}</ThemedText>
        ) : (
          cashflow.data && <CashflowChart months={cashflow.data} />
        )}
      </Card>

      <View style={styles.columns}>
        <Card
          title={`Spending in ${formatMonth(month)}`}
          style={styles.column}
          action={
            <Link href="/transactions">
              <ThemedText type="small" themeColor="tint">
                Transactions →
              </ThemedText>
            </Link>
          }>
          {spending.data?.length ? (
            <CategoryBars spending={spending.data} />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              No spending yet this month.
            </ThemedText>
          )}
        </Card>

        <Card
          title="Budgets"
          style={styles.column}
          action={
            <Link href="/budget">
              <ThemedText type="small" themeColor="tint">
                Manage →
              </ThemedText>
            </Link>
          }>
          {budgets.data?.length ? (
            [...budgets.data]
              .sort((a, b) => b.spent / b.monthlyTarget - a.spent / a.monthlyTarget)
              .slice(0, 4)
              .map((b) => (
                <BudgetMeter
                  key={b.category}
                  label={formatCategory(b.category)}
                  spent={b.spent}
                  target={b.monthlyTarget}
                />
              ))
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              No budgets yet. Set monthly targets on the Budget tab.
            </ThemedText>
          )}
        </Card>
      </View>
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
          <AskMeldPanel style={styles.sidePanel} />
        </View>
      ) : (
        <>
          {header}
          <AskMeldPanel />
          {dashboard}
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
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  column: { flexGrow: 1, flexBasis: 320 },
  netWorthColumn: { flexGrow: 3, flexBasis: 420 },
  upcomingColumn: { flexGrow: 2, flexBasis: 300 },
  netWorthHeader: { gap: Spacing.one },
  netWorthValueRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Spacing.four, rowGap: Spacing.one },
  netWorthValue: { fontSize: 32, lineHeight: 40, fontWeight: 700, letterSpacing: -0.5 },
  change: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  since: { marginLeft: Spacing.three },
});
