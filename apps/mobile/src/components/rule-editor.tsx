import type { CategoryRule } from '@meld/shared';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { CategoryPicker, Sheet, Toggle } from '@/components/category-editor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { useDeleteCategoryRule, useTransactions, useUpdateCategoryRule } from '@/lib/queries';

type Props = { rule: CategoryRule | null; onClose: () => void };

export function RuleEditor({ rule, onClose }: Props) {
  return (
    <Sheet visible={rule !== null} onClose={onClose}>
      {rule && <RuleEditorBody key={rule.id} rule={rule} onClose={onClose} />}
    </Sheet>
  );
}

const PREVIEW = 5;

function RuleEditorBody({ rule, onClose }: { rule: CategoryRule; onClose: () => void }) {
  const theme = useTheme();
  const update = useUpdateCategoryRule();
  const remove = useDeleteCategoryRule();
  const [pattern, setPattern] = useState(rule.pattern);
  const [category, setCategory] = useState<string | null>(rule.category);
  const [subcategory, setSubcategory] = useState(rule.subcategory);
  const [applyToExisting, setApplyToExisting] = useState(true);

  const trimmed = pattern.trim();
  const debounced = useDebouncedValue(trimmed);
  // Transaction search matches merchant or description the same way a rule does.
  const matches = useTransactions({ search: debounced.length >= 2 ? debounced : undefined });
  const preview = debounced.length >= 2 ? matches.data?.pages[0] : undefined;

  const changed = trimmed !== rule.pattern || category !== rule.category || subcategory !== rule.subcategory;
  const canSave = !!category && trimmed.length >= 2 && (changed || applyToExisting);
  const error = update.error ?? remove.error;

  function save() {
    if (!category) return;
    update.mutate(
      { id: rule.id, pattern: trimmed, category, subcategory, applyToExisting },
      { onSuccess: onClose },
    );
  }

  async function onDelete() {
    const ok = await confirm(
      'Delete rule?',
      `Transactions matching “${rule.pattern}” will no longer be categorized automatically. The ${rule.transactionCount} it categorized go back to their original category.`,
      'Delete',
    );
    if (ok) remove.mutate(rule.id, { onSuccess: onClose });
  }

  return (
    <ThemedView style={[styles.sheet, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">Edit rule</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Categorizes transactions whose merchant or description contains:
      </ThemedText>
      <TextInput
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        value={pattern}
        onChangeText={setPattern}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <View style={styles.preview}>
        {debounced.length < 2 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Enter at least 2 characters.
          </ThemedText>
        ) : !preview ? (
          <ActivityIndicator />
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {preview.total === 1 ? '1 transaction contains' : `${preview.total.toLocaleString()} transactions contain`}{' '}
              this text{preview.total ? ', e.g.' : '.'}
            </ThemedText>
            {[...new Set(preview.transactions.map((t) => t.merchantName ?? t.name))].slice(0, PREVIEW).map((name) => (
              <ThemedText key={name} type="small" numberOfLines={1}>
                · {name}
              </ThemedText>
            ))}
          </>
        )}
      </View>

      <CategoryPicker
        category={category}
        subcategory={subcategory}
        onChange={(c, sub) => {
          setCategory(c);
          setSubcategory(sub);
        }}
      />

      <View style={[styles.divider, { borderColor: theme.border }]}>
        <Toggle
          label="Also update past matches I haven’t categorized or verified by hand"
          value={applyToExisting}
          onChange={setApplyToExisting}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Transactions this rule categorized that no longer match go back to their original category.
        </ThemedText>
      </View>

      {error && <ThemedText themeColor="negative">{error.message}</ThemedText>}

      <View style={styles.footer}>
        <Button
          label="Delete"
          variant="danger"
          size="small"
          disabled={update.isPending}
          loading={remove.isPending}
          onPress={() => void onDelete()}
        />
        <View style={styles.grow} />
        <Button label="Cancel" variant="secondary" size="small" onPress={onClose} />
        <Button label="Save" size="small" disabled={!canSave || remove.isPending} loading={update.isPending} onPress={save} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  sheet: { borderRadius: Spacing.three, borderWidth: 1, padding: Spacing.four, gap: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  preview: { gap: Spacing.half, minHeight: 20 },
  divider: { marginTop: Spacing.two, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  grow: { flex: 1 },
});
