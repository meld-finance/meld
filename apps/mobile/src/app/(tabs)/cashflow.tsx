import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Card } from '@/components/card';
import { InsightsPanel, QuickQuestions } from '@/components/cashflow/insights-panel';
import { KpiTiles } from '@/components/cashflow/kpi-tiles';
import { Segmented } from '@/components/cashflow/segmented';
import { SpendingBreakdown } from '@/components/cashflow/spending-breakdown';
import { SpendingOverTime } from '@/components/cashflow/spending-over-time';
import { TopCategories } from '@/components/cashflow/top-categories';
import { TopMovers } from '@/components/cashflow/top-movers';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  cashflowInsights,
  categorySlots,
  foldCategories,
  openCategory,
  formatLongDate,
  periodFor,
  today,
  topMovers,
  type PeriodMode,
} from '@/lib/cashflow';
import { currentMonth, shiftMonth } from '@/lib/format';
import { useCashflowPeriod, useSpendingByMonth } from '@/lib/queries';

/** Months of history in the stacked chart. */
const HISTORY_MONTHS = 12;
/** Window width at which insights move beside the dashboard instead of below the header. */
const SIDE_PANEL_MIN_WIDTH = 1280;
/** Below this the Top Movers notes column is dropped. */
const NOTES_MIN_WIDTH = 900;

export default function CashflowScreen() {
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<PeriodMode>('ytd');
  const [month, setMonth] = useState(currentMonth);
  const p = periodFor(mode, month);
  const year = Number(today().slice(0, 4));

  const period = useCashflowPeriod(p.from, p.to);
  const history = useSpendingByMonth(HISTORY_MONTHS, p.to.slice(0, 7));
  const refreshing = period.isRefetching || history.isRefetching;
  const onRefresh = () => void Promise.all([period.refetch(), history.refetch()]);
  const sidePanel = width >= SIDE_PANEL_MIN_WIDTH;

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.eyebrow}>
          CASH FLOW
        </ThemedText>
        <ThemedText type="subtitle">Your spending, at a glance</ThemedText>
        <ThemedText themeColor="textSecondary">
          See where your money goes, how it changes over time, and what’s driving the biggest shifts.
        </ThemedText>
      </View>
      <View style={styles.controls}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'lastYear', label: String(year - 1) },
            { value: 'ytd', label: `YTD ${year}` },
          ]}
        />
        <DateRange
          from={p.from}
          to={p.to}
          onPrev={mode === 'month' ? () => setMonth(shiftMonth(month, -1)) : undefined}
          onNext={mode === 'month' && month < currentMonth() ? () => setMonth(shiftMonth(month, 1)) : undefined}
        />
      </View>
    </View>
  );

  const data = period.data;
  const slots = categorySlots(data?.categories ?? []);
  const insights = data ? cashflowInsights(data, p) : [];
  const side = (
    <View style={[styles.side, sidePanel && styles.sideWide]}>
      <InsightsPanel insights={insights} />
      <QuickQuestions />
    </View>
  );

  const dashboard = period.isPending ? (
    <ThemedText themeColor="textSecondary">Loading…</ThemedText>
  ) : period.isError ? (
    <ThemedText themeColor="negative">Couldn’t load cash flow: {period.error.message}</ThemedText>
  ) : (
    <>
      <KpiTiles period={data!} p={p} />

      <View style={styles.columns}>
        {history.isError ? (
          <Card title="Spending Over Time" style={styles.wideColumn}>
            <ThemedText themeColor="negative">{history.error.message}</ThemedText>
          </Card>
        ) : (
          history.data && <SpendingOverTime months={history.data} slots={slots} style={styles.wideColumn} />
        )}
        {data!.spending > 0 ? (
          <SpendingBreakdown
            parts={foldCategories(
              data!.categories.filter((c) => c.amount > 0),
              slots,
            )}
            total={data!.spending}
            slots={slots}
            periodLabel={p.label}
            onSelect={(c) => openCategory(c, p)}
            style={styles.narrowColumn}
          />
        ) : (
          <Card title="Spending Breakdown" subtitle={p.label} style={styles.narrowColumn}>
            <ThemedText type="small" themeColor="textSecondary">
              No spending in this period.
            </ThemedText>
            <Link href="/transactions">
              <ThemedText type="small" themeColor="tint">
                Transactions →
              </ThemedText>
            </Link>
          </Card>
        )}
      </View>

      <View style={styles.columns}>
        <TopMovers
          movers={topMovers(data!)}
          slots={slots}
          periodLabel={p.label}
          comparison={p.comparison}
          showNotes={width >= NOTES_MIN_WIDTH}
          onSelect={(c) => openCategory(c, p)}
          style={styles.wideColumn}
        />
        {data!.spending > 0 && (
          <TopCategories
            categories={data!.categories}
            total={data!.spending}
            slots={slots}
            periodLabel={p.label}
            onSelect={(c) => openCategory(c, p)}
            style={styles.narrowColumn}
          />
        )}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        Cash and credit card accounts only; transfers and card payments are excluded.
      </ThemedText>
    </>
  );

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {header}
      {sidePanel ? (
        <View style={styles.split}>
          <View style={styles.main}>{dashboard}</View>
          {side}
        </View>
      ) : (
        <>
          {dashboard}
          {side}
        </>
      )}
    </Screen>
  );
}

/** The period's dates; in monthly mode, arrows step between months. */
function DateRange({ from, to, onPrev, onNext }: { from: string; to: string; onPrev?: () => void; onNext?: () => void }) {
  const theme = useTheme();
  const monthly = onPrev !== undefined;
  return (
    <View style={[styles.range, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {monthly && <Arrow icon="chevronLeft" label="Previous month" onPress={onPrev} />}
      <Icon name="calendar" size={18} themeColor="textSecondary" />
      <ThemedText type="small">
        {formatLongDate(from)} – {formatLongDate(to)}
      </ThemedText>
      {monthly && <Arrow icon="chevronRight" label="Next month" onPress={onNext} />}
    </View>
  );
}

function Arrow({ icon, label, onPress }: { icon: 'chevronLeft' | 'chevronRight'; label: string; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.arrow, !onPress && styles.disabled, pressed && styles.pressed]}>
      <Icon name={icon} size={16} themeColor="textSecondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  headerText: { flexShrink: 1, flexBasis: 420, flexGrow: 1, gap: Spacing.one },
  eyebrow: { letterSpacing: 1 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three },
  range: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  arrow: { padding: Spacing.one },
  disabled: { opacity: 0.3 },
  pressed: { opacity: 0.7 },
  split: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  main: { flex: 1, minWidth: 0, gap: Spacing.three },
  side: { gap: Spacing.three },
  sideWide: { width: 380 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  wideColumn: { flexGrow: 3, flexBasis: 460 },
  narrowColumn: { flexGrow: 2, flexBasis: 300 },
});
