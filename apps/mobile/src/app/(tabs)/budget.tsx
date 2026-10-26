import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { BudgetMeter } from '@/components/charts/budget-meter';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { currentMonth, formatCategory, formatCurrency, formatMonth, shiftMonth } from '@/lib/format';
import { useBudgets, useDeleteBudget, useSpending, useUpsertBudget } from '@/lib/queries';

export default function BudgetScreen() {
  const [month, setMonth] = useState(currentMonth);
  const [editing, setEditing] = useState<string | null>(null);
  const budgets = useBudgets(month);
  const spending = useSpending(month);
  const isCurrent = month === currentMonth();

  const budgeted = new Set(budgets.data?.map((b) => b.category));
  const unbudgeted = (spending.data ?? []).filter((s) => !budgeted.has(s.category));
  const totalTarget = budgets.data?.reduce((s, b) => s + b.monthlyTarget, 0) ?? 0;
  const totalSpent = budgets.data?.reduce((s, b) => s + b.spent, 0) ?? 0;

  return (
    <Screen
      title="Budget"
      actions={
        <View style={styles.monthNav}>
          <Button label="‹" variant="secondary" size="small" onPress={() => setMonth(shiftMonth(month, -1))} />
          <ThemedText type="smallBold" style={styles.monthLabel}>
            {formatMonth(month, true)}
          </ThemedText>
          <Button
            label="›"
            variant="secondary"
            size="small"
            disabled={isCurrent}
            onPress={() => setMonth(shiftMonth(month, 1))}
          />
        </View>
      }>
      {budgets.isPending || spending.isPending ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : budgets.isError || spending.isError ? (
        <ThemedText themeColor="negative">{(budgets.error ?? spending.error)?.message}</ThemedText>
      ) : (
        <>
          <Card
            title="Monthly budgets"
            subtitle={
              budgets.data.length
                ? `${formatCurrency(totalSpent)} spent of ${formatCurrency(totalTarget)} budgeted`
                : 'Set a monthly target for any spending category below.'
            }>
            {budgets.data.map((b) =>
              editing === b.category ? (
                <TargetEditor
                  key={b.category}
                  category={b.category}
                  initial={b.monthlyTarget}
                  existing
                  onDone={() => setEditing(null)}
                />
              ) : (
                <Pressable key={b.category} onPress={() => setEditing(b.category)} accessibilityHint="Edit budget">
                  <BudgetMeter label={formatCategory(b.category)} spent={b.spent} target={b.monthlyTarget} />
                </Pressable>
              ),
            )}
          </Card>

          <Card
            title="Spending without a budget"
            subtitle={`${formatMonth(month, true)} · tap a category to set a target`}>
            {unbudgeted.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Everything you spent on this month has a budget.
              </ThemedText>
            ) : (
              unbudgeted.map((s) =>
                editing === s.category ? (
                  <TargetEditor
                    key={s.category}
                    category={s.category}
                    initial={Math.ceil(s.amount / 50) * 50}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <Pressable key={s.category} onPress={() => setEditing(s.category)} style={styles.row}>
                    <ThemedText type="small">{formatCategory(s.category)}</ThemedText>
                    <View style={styles.rowRight}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatCurrency(s.amount)}
                      </ThemedText>
                      <ThemedText type="small" themeColor="tint">
                        Set budget
                      </ThemedText>
                    </View>
                  </Pressable>
                ),
              )
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}

type EditorProps = { category: string; initial: number; existing?: boolean; onDone: () => void };

function TargetEditor({ category, initial, existing, onDone }: EditorProps) {
  const theme = useTheme();
  const upsert = useUpsertBudget();
  const remove = useDeleteBudget();
  const [value, setValue] = useState(String(initial));
  const amount = Number(value);
  const valid = Number.isFinite(amount) && amount > 0;

  // mutate (not mutateAsync): failures surface via isError below instead of throwing.
  function save() {
    if (valid) upsert.mutate({ category, monthlyTarget: amount }, { onSuccess: onDone });
  }

  async function del() {
    if (!(await confirm('Remove budget?', `Stop budgeting ${formatCategory(category)}?`, 'Remove'))) return;
    remove.mutate(category, { onSuccess: onDone });
  }

  return (
    <View style={styles.editor}>
      <ThemedText type="smallBold">{formatCategory(category)}</ThemedText>
      <View style={styles.editorRow}>
        <ThemedText themeColor="textSecondary">$</ThemedText>
        <TextInput
          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          inputMode="decimal"
          autoFocus
          selectTextOnFocus
          onSubmitEditing={save}
          accessibilityLabel={`Monthly budget for ${formatCategory(category)}`}
        />
        <ThemedText type="small" themeColor="textSecondary">
          / month
        </ThemedText>
      </View>
      {(upsert.isError || remove.isError) && (
        <ThemedText type="small" themeColor="negative">
          {(upsert.error ?? remove.error)?.message}
        </ThemedText>
      )}
      <View style={styles.editorRow}>
        <Button label="Save" size="small" disabled={!valid} loading={upsert.isPending} onPress={save} />
        <Button label="Cancel" variant="secondary" size="small" onPress={onDone} />
        <View style={styles.spacer} />
        {existing && <Button label="Remove" variant="danger" size="small" loading={remove.isPending} onPress={del} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  monthLabel: { minWidth: 72, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.one },
  rowRight: { flexDirection: 'row', gap: Spacing.three },
  editor: { gap: Spacing.two },
  editorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { width: 120, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  spacer: { flex: 1 },
});
