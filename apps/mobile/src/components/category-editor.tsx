import type { Transaction } from '@meld/shared';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCategory, formatCurrency, formatDate } from '@/lib/format';
import { useCategories, useUpdateTransaction } from '@/lib/queries';

type Props = { transaction: Transaction | null; onClose: () => void };

export function CategoryEditor({ transaction, onClose }: Props) {
  return (
    <Modal visible={transaction !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Inner Pressable swallows taps so they don't close the sheet. */}
        <Pressable style={styles.sheetWrap} onPress={() => {}}>
          {transaction && <EditorBody key={transaction.id} transaction={transaction} onClose={onClose} />}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function EditorBody({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const theme = useTheme();
  const categories = useCategories();
  const update = useUpdateTransaction();
  const [custom, setCustom] = useState('');

  // mutate (not mutateAsync): failures surface via isError below instead of throwing.
  function save(category: string | null) {
    update.mutate({ id: transaction.id, category }, { onSuccess: onClose });
  }

  return (
    <ThemedView style={[styles.sheet, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">{transaction.merchantName ?? transaction.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDate(transaction.date)} · {formatCurrency(Math.abs(transaction.amount), transaction.currency)} ·{' '}
        {transaction.accountName}
      </ThemedText>

      <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
        Category
      </ThemedText>
      <ScrollView style={styles.chipScroll} contentContainerStyle={styles.chips}>
        {(categories.data ?? []).map((c) => (
          <Chip
            key={c}
            label={formatCategory(c)}
            selected={c === transaction.category}
            onPress={() => void save(c)}
          />
        ))}
      </ScrollView>

      <View style={styles.customRow}>
        <TextInput
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          placeholder="New category…"
          placeholderTextColor={theme.textSecondary}
          value={custom}
          onChangeText={setCustom}
          onSubmitEditing={() => custom.trim() && void save(custom.trim())}
        />
        <Button label="Save" size="small" disabled={!custom.trim()} onPress={() => void save(custom.trim())} />
      </View>

      {update.isError && <ThemedText themeColor="negative">{update.error.message}</ThemedText>}

      <View style={styles.footer}>
        {transaction.categoryOverridden && (
          <Button label="Reset to Plaid category" variant="secondary" size="small" onPress={() => void save(null)} />
        )}
        <Button label="Close" variant="secondary" size="small" onPress={onClose} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: Spacing.three },
  sheetWrap: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  sheet: { borderRadius: Spacing.three, borderWidth: 1, padding: Spacing.four, gap: Spacing.two },
  label: { marginTop: Spacing.two },
  chipScroll: { maxHeight: 220 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  customRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: { flex: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two, marginTop: Spacing.two },
});
