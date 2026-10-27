import type { CategoryRule } from '@meld/shared';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { formatCategory, formatSubcategory } from '@/lib/format';
import { useCategoryRules, useDeleteCategoryRule } from '@/lib/queries';

export default function RulesScreen() {
  const theme = useTheme();
  const rules = useCategoryRules();
  const remove = useDeleteCategoryRule();

  async function onDelete(rule: CategoryRule) {
    const ok = await confirm(
      'Delete rule?',
      `Transactions matching “${rule.pattern}” will no longer be categorized automatically. The ${rule.transactionCount} it categorized go back to their original category.`,
      'Delete',
    );
    if (ok) remove.mutate(rule.id);
  }

  const back = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/transactions'))}>
      <ThemedText type="linkPrimary">‹ Back</ThemedText>
    </Pressable>
  );

  return (
    <Screen title="Category rules" actions={back}>
      <ThemedText themeColor="textSecondary">
        Rules categorize new transactions as they sync, by matching text in the merchant name or description. The longest
        matching pattern wins, and changing a transaction by hand always overrides a rule. To add one, open a transaction
        and turn on “Always categorize matching transactions this way”.
      </ThemedText>
      {remove.isError && <ThemedText themeColor="negative">{remove.error.message}</ThemedText>}
      <Card>
        {rules.isPending ? (
          <ActivityIndicator />
        ) : rules.isError ? (
          <ThemedText themeColor="negative">Couldn’t load rules: {rules.error.message}</ThemedText>
        ) : rules.data.length === 0 ? (
          <ThemedText themeColor="textSecondary">No rules yet.</ThemedText>
        ) : (
          rules.data.map((r, i) => (
            <View
              key={r.id}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }]}>
              <View style={styles.text}>
                <ThemedText numberOfLines={1}>Contains “{r.pattern}”</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  → {formatCategory(r.category)}
                  {r.subcategory ? ` › ${formatSubcategory(r.subcategory, r.category)}` : ''} ·{' '}
                  {r.transactionCount === 1 ? '1 transaction' : `${r.transactionCount} transactions`}
                </ThemedText>
              </View>
              <Button
                label="Delete"
                variant="danger"
                size="small"
                disabled={remove.isPending && remove.variables === r.id}
                onPress={() => void onDelete(r)}
              />
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  text: { flex: 1, minWidth: 0, gap: Spacing.half },
});
