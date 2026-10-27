import type { CategoryDetail, Transaction } from '@meld/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { CategoryEditor } from '@/components/category-editor';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatLongDate, formatPercent, percentChange } from '@/lib/cashflow';
import { formatCategory, formatCurrency, formatDate, formatSubcategory, formatWholeCurrency } from '@/lib/format';
import { useCategoryDetail, useTransactions } from '@/lib/queries';

/** Merchants listed before the rest are left to the transaction list. */
const TOP_MERCHANTS = 10;

/** One cash-flow category over a period: where it went by subcategory and merchant, and the transactions behind it. */
export default function CategoryScreen() {
  const params = useLocalSearchParams<{ category: string; from: string; to: string; label?: string; comparison?: string }>();
  const { category, from, to } = params;
  const label = params.label ?? `${formatLongDate(from)} – ${formatLongDate(to)}`;
  const comparison = params.comparison ?? 'a year earlier';
  const [subcategory, setSubcategory] = useState<string | undefined>();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const detail = useCategoryDetail(category, from, to);
  const name = formatCategory(category);

  const back = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/cashflow'))}>
      <ThemedText type="linkPrimary">‹ Cash Flow</ThemedText>
    </Pressable>
  );

  return (
    <Screen title={name} actions={back}>
      <ThemedText themeColor="textSecondary">
        {label} · compared with {comparison}
      </ThemedText>
      {detail.isPending ? (
        <ActivityIndicator style={styles.loading} />
      ) : detail.isError ? (
        <ThemedText themeColor="negative">Couldn’t load {name.toLowerCase()}: {detail.error.message}</ThemedText>
      ) : (
        <>
          <Summary detail={detail.data} comparison={comparison} />
          {detail.data.subcategories.length > 0 && (
            <Subcategories
              detail={detail.data}
              selected={subcategory}
              onSelect={(s) => setSubcategory(s === subcategory ? undefined : s)}
            />
          )}
          {detail.data.merchants.length > 0 && <Merchants detail={detail.data} />}
        </>
      )}
      <Transactions
        category={category}
        subcategory={subcategory}
        from={from}
        to={to}
        onClearSubcategory={() => setSubcategory(undefined)}
        onEdit={setEditing}
      />
      <CategoryEditor transaction={editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}

function Change({ amount, previous }: { amount: number; previous: number }) {
  if (amount === previous) return null;
  const pct = percentChange(amount, previous);
  const up = amount > previous;
  // Spending up is the unfavorable direction.
  return (
    <View style={styles.change}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} themeColor={up ? 'negative' : 'positive'} strokeWidth={2.25} />
      <ThemedText type="small" themeColor={up ? 'negative' : 'positive'}>
        {pct === null ? 'New' : formatPercent(pct)}
      </ThemedText>
    </View>
  );
}

function Summary({ detail, comparison }: { detail: CategoryDetail; comparison: string }) {
  const diff = detail.amount - detail.previous;
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        Spent
      </ThemedText>
      <View style={styles.summaryRow}>
        <ThemedText type="title">{formatWholeCurrency(detail.amount)}</ThemedText>
        <Change amount={detail.amount} previous={detail.previous} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {formatWholeCurrency(detail.previous)} in {comparison}
        {diff !== 0 ? ` (${diff > 0 ? '+' : '−'}${formatWholeCurrency(Math.abs(diff))})` : ''}
      </ThemedText>
    </Card>
  );
}

function Subcategories({
  detail,
  selected,
  onSelect,
}: {
  detail: CategoryDetail;
  selected?: string;
  onSelect: (subcategory: string) => void;
}) {
  const theme = useTheme();
  const viz = useVizColors();
  const max = Math.max(...detail.subcategories.map((s) => s.amount), 1);
  return (
    <Card title="By Subcategory" subtitle="Tap one to filter the transactions below">
      {detail.subcategories.map((s) => {
        const key = s.subcategory;
        const active = key !== null && key === selected;
        const row = (
          <View style={styles.subRow}>
            <View style={styles.labels}>
              <ThemedText type={active ? 'smallBold' : 'small'} style={styles.grow} numberOfLines={1}>
                {formatSubcategory(key, detail.category)}
              </ThemedText>
              <Change amount={s.amount} previous={s.previous} />
              <ThemedText type="smallBold" style={styles.numeric}>
                {formatWholeCurrency(s.amount)}
              </ThemedText>
            </View>
            <View style={[styles.track, { backgroundColor: viz.grid }]}>
              <View
                style={[
                  styles.fill,
                  { width: `${(Math.max(s.amount, 0) / max) * 100}%`, backgroundColor: active ? theme.tint : viz.series1 },
                ]}
              />
            </View>
          </View>
        );
        // Transactions without a subcategory can't be filtered on.
        return key === null ? (
          <View key="none">{row}</View>
        ) : (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(key)}
            style={({ pressed }) => pressed && styles.pressed}>
            {row}
          </Pressable>
        );
      })}
    </Card>
  );
}

function Merchants({ detail }: { detail: CategoryDetail }) {
  const theme = useTheme();
  const top = detail.merchants.slice(0, TOP_MERCHANTS);
  return (
    <Card title="Top Merchants" subtitle={`${top.length} of ${detail.merchants.length} by amount`}>
      <View>
        {top.map((m) => (
          <View key={m.merchant} style={[styles.merchantRow, { borderColor: theme.border }]}>
            <View style={styles.grow}>
              <ThemedText type="small" numberOfLines={1}>
                {m.merchant}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {m.count === 1 ? '1 transaction' : `${m.count} transactions`} · {formatWholeCurrency(m.previous)} before
              </ThemedText>
            </View>
            <Change amount={m.amount} previous={m.previous} />
            <ThemedText type="smallBold" style={styles.numeric}>
              {formatWholeCurrency(m.amount)}
            </ThemedText>
          </View>
        ))}
      </View>
    </Card>
  );
}

function Transactions({
  category,
  subcategory,
  from,
  to,
  onClearSubcategory,
  onEdit,
}: {
  category: string;
  subcategory?: string;
  from: string;
  to: string;
  onClearSubcategory: () => void;
  onEdit: (t: Transaction) => void;
}) {
  const theme = useTheme();
  const query = useTransactions({ category, subcategory, from, to, cashflow: 'true' });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.transactions) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;

  return (
    <Card
      title="Transactions"
      subtitle={`${subcategory ? `${formatSubcategory(subcategory, category)} · ` : ''}${total.toLocaleString()} · tap one to recategorize`}
      action={subcategory && <Button label="Show all" variant="secondary" size="small" onPress={onClearSubcategory} />}>
      {query.isPending ? (
        <ActivityIndicator />
      ) : query.isError ? (
        <ThemedText themeColor="negative">{query.error.message}</ThemedText>
      ) : rows.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No transactions in this period.
        </ThemedText>
      ) : (
        <View>
          {rows.map((t) => {
            const inflow = t.amount < 0;
            return (
              <Pressable
                key={t.id}
                onPress={() => onEdit(t)}
                style={({ pressed }) => [styles.txRow, { borderColor: theme.border }, pressed && styles.pressed]}>
                <View style={styles.grow}>
                  <ThemedText type="small" numberOfLines={1}>
                    {t.merchantName ?? t.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {formatDate(t.date)} · {formatSubcategory(t.subcategory, t.category)}
                    {t.categoryOverridden ? ' ✎' : ''} · {t.accountName}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor={inflow ? 'positive' : 'text'} style={styles.numeric}>
                  {inflow ? '+' : '−'}
                  {formatCurrency(Math.abs(t.amount), t.currency)}
                </ThemedText>
              </Pressable>
            );
          })}
          {query.hasNextPage && (
            <Button
              label="Load more"
              variant="secondary"
              size="small"
              loading={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage()}
              style={styles.more}
            />
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: Spacing.four },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  change: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  subRow: { gap: Spacing.two },
  labels: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1, minWidth: 0 },
  numeric: { minWidth: 72, textAlign: 'right', fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, minWidth: 2, borderRadius: 4 },
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.6 },
  more: { alignSelf: 'center', marginTop: Spacing.three },
});
