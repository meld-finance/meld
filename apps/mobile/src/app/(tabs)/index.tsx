import { isLiabilityType } from '@meld/shared';
import { Link } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { formatCurrency } from '@/lib/format';
import { useAccounts } from '@/lib/queries';

// Placeholder until the full dashboard lands in Phase 3.
export default function HomeScreen() {
  const { logout } = useAuth();
  const accounts = useAccounts();

  const list = accounts.data ?? [];
  const assets = list.filter((a) => !isLiabilityType(a.type)).reduce((s, a) => s + (a.currentBalance ?? 0), 0);
  const liabilities = list.filter((a) => isLiabilityType(a.type)).reduce((s, a) => s + (a.currentBalance ?? 0), 0);

  return (
    <Screen
      title="Home"
      actions={
        Platform.OS !== 'web' && (
          <Pressable onPress={logout}>
            <ThemedText type="linkPrimary">Lock</ThemedText>
          </Pressable>
        )
      }>
      {accounts.isPending ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : accounts.isError ? (
        <ThemedText themeColor="negative">Couldn’t load accounts: {accounts.error.message}</ThemedText>
      ) : list.length === 0 ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">No accounts yet</ThemedText>
          <Link href="/accounts">
            <ThemedText type="linkPrimary">Link your first account →</ThemedText>
          </Link>
        </ThemedView>
      ) : (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            Net worth
          </ThemedText>
          <ThemedText type="subtitle">{formatCurrency(assets - liabilities)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatCurrency(assets)} assets · {formatCurrency(liabilities)} liabilities · {list.length} accounts
          </ThemedText>
        </ThemedView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.four, borderRadius: Spacing.three, gap: Spacing.one },
});
