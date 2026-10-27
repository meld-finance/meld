import type { CategoryRule } from '@meld/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { RuleEditor } from '@/components/rule-editor';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCategory, formatSubcategory } from '@/lib/format';
import { useCategoryRules } from '@/lib/queries';

export default function RulesScreen() {
  const theme = useTheme();
  const rules = useCategoryRules();
  const [editing, setEditing] = useState<CategoryRule | null>(null);

  const back = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/transactions'))}>
      <ThemedText type="linkPrimary">‹ Back</ThemedText>
    </Pressable>
  );

  return (
    <Screen title="Category rules" actions={back}>
      <ThemedText themeColor="textSecondary">
        Rules categorize new transactions as they sync, by matching text in the merchant name or description, and mark
        them verified. The longest matching pattern wins, and categorizing or verifying a transaction by hand always
        overrides a rule. To add one,
        open a transaction and turn on “Always categorize matching transactions this way”. Tap a rule to change or delete
        it.
      </ThemedText>
      <Card>
        {rules.isPending ? (
          <ActivityIndicator />
        ) : rules.isError ? (
          <ThemedText themeColor="negative">Couldn’t load rules: {rules.error.message}</ThemedText>
        ) : rules.data.length === 0 ? (
          <ThemedText themeColor="textSecondary">No rules yet.</ThemedText>
        ) : (
          rules.data.map((r, i) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              onPress={() => setEditing(r)}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
                pressed && styles.pressed,
              ]}>
              <View style={styles.text}>
                <ThemedText numberOfLines={1}>Contains “{r.pattern}”</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  → {formatCategory(r.category)}
                  {r.subcategory ? ` › ${formatSubcategory(r.subcategory, r.category)}` : ''} ·{' '}
                  {r.transactionCount === 1 ? '1 transaction' : `${r.transactionCount} transactions`}
                </ThemedText>
              </View>
              <ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable>
          ))
        )}
      </Card>
      <RuleEditor rule={editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  text: { flex: 1, minWidth: 0, gap: Spacing.half },
  pressed: { opacity: 0.6 },
});
