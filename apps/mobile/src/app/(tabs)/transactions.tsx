import type { Transaction } from '@meld/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { CategoryEditor } from '@/components/category-editor';
import { Chip } from '@/components/chip';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { formatCategory, formatCurrency, formatDate } from '@/lib/format';
import { useAccounts, useCategories, useTransactions } from '@/lib/queries';

export default function TransactionsScreen() {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());

  const accounts = useAccounts();
  const categories = useCategories();
  const query = useTransactions({ search: debouncedSearch || undefined, accountId, category });

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.transactions) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;

  return (
    <Screen title="Transactions" scroll={false}>
      <TextInput
        style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        placeholder="Search merchant or description"
        placeholderTextColor={theme.textSecondary}
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
      />

      <FilterRow>
        <Chip label="All accounts" selected={!accountId} onPress={() => setAccountId(undefined)} />
        {(accounts.data ?? []).map((a) => (
          <Chip
            key={a.id}
            label={a.mask ? `${a.name} ••${a.mask}` : a.name}
            selected={accountId === a.id}
            onPress={() => setAccountId(accountId === a.id ? undefined : a.id)}
          />
        ))}
      </FilterRow>
      <FilterRow>
        <Chip label="All categories" selected={!category} onPress={() => setCategory(undefined)} />
        {(categories.data ?? []).map((c) => (
          <Chip
            key={c}
            label={formatCategory(c)}
            selected={category === c}
            onPress={() => setCategory(category === c ? undefined : c)}
          />
        ))}
      </FilterRow>

      {query.isPending ? (
        <ActivityIndicator style={styles.loading} />
      ) : query.isError ? (
        <ThemedText themeColor="negative">Couldn’t load transactions: {query.error.message}</ThemedText>
      ) : (
        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => <TransactionRow transaction={item} onPress={() => setEditing(item)} />}
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && void query.fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.count}>
              {total.toLocaleString()} transactions
            </ThemedText>
          }
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary">
              {debouncedSearch || accountId || category ? 'No matching transactions.' : 'No transactions yet.'}
            </ThemedText>
          }
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.loading} /> : undefined}
        />
      )}

      <CategoryEditor transaction={editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}

function FilterRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.filterScroll}
      contentContainerStyle={styles.filterRow}>
      {children}
    </ScrollView>
  );
}

function TransactionRow({ transaction: t, onPress }: { transaction: Transaction; onPress: () => void }) {
  // Plaid: positive = money out. Show inflows as positive green amounts.
  const inflow = t.amount < 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.shrink}>
        <ThemedText numberOfLines={1}>{t.merchantName ?? t.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatDate(t.date)} · {formatCategory(t.category)}
          {t.categoryOverridden ? ' ✎' : ''} · {t.accountName}
          {t.pending ? ' · Pending' : ''}
        </ThemedText>
      </View>
      <ThemedText themeColor={inflow ? 'positive' : 'text'}>
        {inflow ? '+' : '−'}
        {formatCurrency(Math.abs(t.amount), t.currency)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  // Without flexGrow: 0 a horizontal ScrollView stretches to fill the column.
  filterScroll: { flexGrow: 0 },
  filterRow: { gap: Spacing.two, alignItems: 'center' },
  list: { flex: 1 },
  count: { marginBottom: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
  separator: { height: StyleSheet.hairlineWidth },
  loading: { marginVertical: Spacing.four },
});
