import type { NetWorthSummary } from '@meld/shared';
import { Link } from 'expo-router';
import { Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { BudgetMeter } from '@/components/charts/budget-meter';
import { CashflowChart } from '@/components/charts/cashflow-chart';
import { CategoryBars } from '@/components/charts/category-bars';
import { NetWorthTrend } from '@/components/charts/net-worth-trend';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { currentMonth, formatCategory, formatCurrency, formatMonth } from '@/lib/format';
import { useBudgets, useCashflow, useNetWorth, useNetWorthHistory, useSpending } from '@/lib/queries';

const TYPE_LABELS: Record<NetWorthSummary['byType'][number]['type'], string> = {
  depository: 'Cash',
  investment: 'Investments',
  manual: 'Property & other assets',
  other: 'Other',
  credit: 'Credit cards',
  loan: 'Loans',
  mortgage: 'Mortgages',
};
const LIABILITY_TYPES = new Set(['credit', 'loan', 'mortgage']);

export default function DashboardScreen() {
  const { logout } = useAuth();
  const month = currentMonth();
  const netWorth = useNetWorth();
  const history = useNetWorthHistory(365);
  const cashflow = useCashflow(6);
  const spending = useSpending(month);
  const budgets = useBudgets(month);

  const queries = [netWorth, history, cashflow, spending, budgets];
  const refreshing = queries.some((q) => q.isRefetching);
  const onRefresh = () => void Promise.all(queries.map((q) => q.refetch()));

  const summary = netWorth.data;
  const empty = summary && summary.byType.length === 0;

  return (
    <Screen
      title="Overview"
      actions={
        Platform.OS !== 'web' && (
          <Pressable onPress={logout}>
            <ThemedText type="linkPrimary">Lock</ThemedText>
          </Pressable>
        )
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {netWorth.isPending ? (
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
          <Card>
            <View style={styles.hero}>
              <ThemedText type="small" themeColor="textSecondary">
                Net worth
              </ThemedText>
              <ThemedText type="title">{formatCurrency(summary!.netWorth)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatCurrency(summary!.assets)} assets · {formatCurrency(summary!.liabilities)} liabilities
              </ThemedText>
            </View>
            {history.data && <NetWorthTrend points={history.data} />}
          </Card>

          <Card title="Cash flow" subtitle="Last 6 months · excludes transfers and card payments">
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

          <Card title="Breakdown">
            {summary!.byType
              .slice()
              .sort((a, b) => Number(LIABILITY_TYPES.has(a.type)) - Number(LIABILITY_TYPES.has(b.type)))
              .map((t) => (
                <View key={t.type} style={styles.breakdownRow}>
                  <ThemedText type="small">{TYPE_LABELS[t.type]}</ThemedText>
                  <ThemedText type="small" themeColor={LIABILITY_TYPES.has(t.type) ? 'negative' : 'text'}>
                    {LIABILITY_TYPES.has(t.type) ? `−${formatCurrency(t.total)}` : formatCurrency(t.total)}
                  </ThemedText>
                </View>
              ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: Spacing.one },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  column: { flexGrow: 1, flexBasis: 320 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
