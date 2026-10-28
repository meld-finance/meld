import type { Account } from '@meld/shared';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { InstitutionAvatar } from '@/components/accounts/institution-avatar';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatDate } from '@/lib/format';
import { useRecentTransactions } from '@/lib/queries';

const SHOWN = 4;

/** The latest transactions across every account. */
export function RecentActivity({ accounts, style }: { accounts: Account[]; style?: object }) {
  const theme = useTheme();
  const recent = useRecentTransactions(SHOWN);
  const institution = (id: string) => accounts.find((a) => a.id === id)?.institutionName ?? null;

  return (
    <Card
      title="Recent activity"
      style={style}
      action={
        <Link href={{ pathname: '/spending', params: { tab: 'transactions' } }}>
          <ThemedText type="small" themeColor="tint">
            View all
          </ThemedText>
        </Link>
      }>
      {recent.isError ? (
        <ThemedText type="small" themeColor="negative">
          {recent.error.message}
        </ThemedText>
      ) : recent.data?.transactions.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No transactions yet.
        </ThemedText>
      ) : (
        <View>
          {recent.data?.transactions.map((t, i) => {
            // Plaid convention: negative amounts are money in.
            const inflow = t.amount < 0;
            return (
              <View key={t.id} style={[styles.row, i > 0 && [styles.divider, { borderTopColor: theme.border }]]}>
                <InstitutionAvatar name={institution(t.accountId)} />
                <View style={styles.label}>
                  <ThemedText numberOfLines={1}>{t.accountName}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {t.merchantName ?? t.name}
                  </ThemedText>
                </View>
                <View style={styles.amount}>
                  <ThemedText type="smallBold" themeColor={inflow ? 'positive' : 'text'}>
                    {inflow ? '+' : '−'}
                    {formatCurrency(Math.abs(t.amount), t.currency)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.pending ? 'Pending' : formatDate(t.date)}
                  </ThemedText>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  divider: { borderTopWidth: 1 },
  label: { flex: 1, minWidth: 0 },
  amount: { alignItems: 'flex-end' },
});
