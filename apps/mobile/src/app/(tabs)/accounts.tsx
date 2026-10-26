import { isLiabilityType, type Account, type AccountType, type PlaidItemSummary } from '@meld/shared';
import { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ManualAssets } from '@/components/manual-assets';
import { PlaidLinkButton } from '@/components/plaid-link-button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { formatCurrency, formatRelativeTime } from '@/lib/format';
import { useAccounts, useItems, useRemoveItem, useSyncItem } from '@/lib/queries';

const GROUPS: { type: AccountType; label: string }[] = [
  { type: 'depository', label: 'Cash' },
  { type: 'investment', label: 'Investments' },
  { type: 'credit', label: 'Credit cards' },
  { type: 'mortgage', label: 'Mortgages' },
  { type: 'loan', label: 'Loans' },
  { type: 'other', label: 'Other' },
];

export default function AccountsScreen() {
  const accounts = useAccounts();
  const items = useItems();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const refreshing = accounts.isRefetching || items.isRefetching;
  const onRefresh = () => void Promise.all([accounts.refetch(), items.refetch()]);

  return (
    <Screen
      title="Accounts"
      actions={
        <PlaidLinkButton
          onLinked={() => setMessage({ text: 'Account linked. Transaction history may take a minute to arrive.' })}
          onError={(text) => setMessage({ text, error: true })}
        />
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {message && (
        <ThemedText type="small" themeColor={message.error ? 'negative' : 'textSecondary'}>
          {message.text}
        </ThemedText>
      )}

      {accounts.isPending || items.isPending ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : accounts.isError || items.isError ? (
        <ThemedText themeColor="negative">
          Couldn’t load accounts: {(accounts.error ?? items.error)?.message}
        </ThemedText>
      ) : items.data.length === 0 ? (
        <>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Link your first account</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Connect banks, credit cards, brokerages and loans through Plaid. Meld only reads balances and
              transactions; it can’t move money.
            </ThemedText>
          </ThemedView>
          <ManualAssets />
        </>
      ) : (
        <>
          {GROUPS.map(({ type, label }) => {
            const group = accounts.data.filter((a) => a.type === type);
            return group.length ? <AccountGroup key={type} label={label} accounts={group} /> : null;
          })}

          <ManualAssets />

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Connections
          </ThemedText>
          {items.data.map((item) => (
            <ConnectionRow key={item.id} item={item} onMessage={setMessage} />
          ))}
        </>
      )}
    </Screen>
  );
}

function AccountGroup({ label, accounts }: { label: string; accounts: Account[] }) {
  const total = accounts.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0);
  const liability = isLiabilityType(accounts[0]!.type);
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.row}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {/* Plaid reports liabilities as positive amounts owed. */}
        <ThemedText type="smallBold" themeColor={liability ? 'negative' : 'text'}>
          {formatCurrency(total)}
          {liability ? ' owed' : ''}
        </ThemedText>
      </View>
      {accounts.map((a) => (
        <View key={a.id} style={styles.row}>
          <View style={styles.shrink}>
            <ThemedText numberOfLines={1}>
              {a.name}
              {a.mask ? ` ••${a.mask}` : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {[a.institutionName, a.subtype].filter(Boolean).join(' · ')}
            </ThemedText>
          </View>
          <ThemedText>{formatCurrency(a.currentBalance, a.currency)}</ThemedText>
        </View>
      ))}
    </ThemedView>
  );
}

function ConnectionRow({
  item,
  onMessage,
}: {
  item: PlaidItemSummary;
  onMessage: (m: { text: string; error?: boolean }) => void;
}) {
  const theme = useTheme();
  const sync = useSyncItem();
  const remove = useRemoveItem();
  const name = item.institutionName ?? 'Unknown institution';
  const needsLogin = item.status === 'login_required';

  async function refresh() {
    try {
      const r = await sync.mutateAsync(item.id);
      onMessage({
        text: `${name} refreshed: ${r.added} new, ${r.modified} updated, ${r.removed} removed transactions.`,
      });
    } catch (e) {
      onMessage({ text: (e as Error).message, error: true });
    }
  }

  async function removeItem() {
    const ok = await confirm(
      `Remove ${name}?`,
      `This disconnects ${name} and deletes its ${item.accountCount} accounts and their transactions from Meld.`,
      'Remove',
    );
    if (!ok) return;
    try {
      await remove.mutateAsync(item.id);
      onMessage({ text: `${name} removed.` });
    } catch (e) {
      onMessage({ text: (e as Error).message, error: true });
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.row}>
        <View style={styles.shrink}>
          <ThemedText type="smallBold">{name}</ThemedText>
          <ThemedText
            type="small"
            style={{ color: needsLogin || item.status === 'error' ? theme.warning : theme.textSecondary }}>
            {needsLogin
              ? 'Sign-in needed to keep syncing'
              : item.status === 'error'
                ? `Sync error: ${item.lastError ?? 'unknown'}`
                : `${item.accountCount} accounts · synced ${formatRelativeTime(item.lastSyncedAt)}`}
          </ThemedText>
        </View>
        <View style={styles.buttons}>
          {needsLogin ? (
            <PlaidLinkButton
              itemId={item.id}
              size="small"
              onLinked={() => onMessage({ text: `${name} reconnected.` })}
              onError={(text) => onMessage({ text, error: true })}
            />
          ) : (
            <Button label="Refresh" variant="secondary" size="small" loading={sync.isPending} onPress={refresh} />
          )}
          <Button label="Remove" variant="danger" size="small" loading={remove.isPending} onPress={removeItem} />
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  shrink: { flexShrink: 1 },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  sectionTitle: { marginTop: Spacing.two },
});
