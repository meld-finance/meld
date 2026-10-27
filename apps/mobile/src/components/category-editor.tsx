import type { Transaction } from '@meld/shared';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCategory, formatCurrency, formatDate, formatSubcategory } from '@/lib/format';
import { useCategories, useSaveCategoryRule, useSubcategories, useUpdateTransaction } from '@/lib/queries';

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
  const saveRule = useSaveCategoryRule();
  const [category, setCategory] = useState(transaction.category);
  const [subcategory, setSubcategory] = useState(transaction.subcategory);
  const subcategories = useSubcategories(category);
  const [customCategory, setCustomCategory] = useState('');
  const [customSubcategory, setCustomSubcategory] = useState('');
  const [makeRule, setMakeRule] = useState(false);
  const [pattern, setPattern] = useState(transaction.merchantName ?? transaction.name);
  const [applyToExisting, setApplyToExisting] = useState(true);

  const categoryOptions = withCurrent(categories.data ?? [], category);
  const subcategoryOptions = withCurrent(subcategories.data ?? [], subcategory);
  const changed = category !== transaction.category || subcategory !== transaction.subcategory;
  const canSave = !!category && (changed || makeRule) && (!makeRule || pattern.trim().length >= 2);
  const saving = update.isPending || saveRule.isPending;
  const error = update.error ?? saveRule.error;

  function pickCategory(c: string) {
    if (c !== category) setSubcategory(null);
    setCategory(c);
  }

  // mutate (not mutateAsync): failures surface via `error` below instead of throwing.
  function save() {
    if (!category) return;
    const createRule = () =>
      saveRule.mutate(
        { pattern: pattern.trim(), category, subcategory, applyToExisting },
        { onSuccess: onClose },
      );
    if (!changed) return createRule();
    update.mutate(
      { id: transaction.id, category, subcategory },
      { onSuccess: () => (makeRule ? createRule() : onClose()) },
    );
  }

  return (
    <ThemedView style={[styles.sheet, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">{transaction.merchantName ?? transaction.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDate(transaction.date)} · {formatCurrency(Math.abs(transaction.amount), transaction.currency)} ·{' '}
        {transaction.accountName}
      </ThemedText>
      {transaction.categoryRuleId && (
        <ThemedText type="small" themeColor="textSecondary">
          Categorized by a rule.{' '}
          <Link href="/rules" onPress={onClose}>
            <ThemedText type="small" themeColor="tint">
              Manage rules
            </ThemedText>
          </Link>
        </ThemedText>
      )}

      <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
        Category
      </ThemedText>
      <ScrollView style={styles.chipScroll} contentContainerStyle={styles.chips}>
        {categoryOptions.map((c) => (
          <Chip key={c} label={formatCategory(c)} selected={c === category} onPress={() => pickCategory(c)} />
        ))}
      </ScrollView>
      <AddRow
        placeholder="New category…"
        value={customCategory}
        onChangeText={setCustomCategory}
        onAdd={(c) => {
          pickCategory(c);
          setCustomCategory('');
        }}
      />

      {category && (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            Subcategory
          </ThemedText>
          <ScrollView style={styles.subchipScroll} contentContainerStyle={styles.chips}>
            <Chip label="None" selected={!subcategory} onPress={() => setSubcategory(null)} />
            {subcategoryOptions.map((s) => (
              <Chip
                key={s}
                label={formatSubcategory(s, category)}
                selected={s === subcategory}
                onPress={() => setSubcategory(s)}
              />
            ))}
          </ScrollView>
          <AddRow
            placeholder="New subcategory…"
            value={customSubcategory}
            onChangeText={setCustomSubcategory}
            onAdd={(s) => {
              setSubcategory(s);
              setCustomSubcategory('');
            }}
          />
        </>
      )}

      <View style={[styles.rule, { borderColor: theme.border }]}>
        <Toggle label="Always categorize matching transactions this way" value={makeRule} onChange={setMakeRule} />
        {makeRule && (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Applies to new transactions whose merchant or description contains:
            </ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              value={pattern}
              onChangeText={setPattern}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Toggle
              label="Also update past matches I haven’t changed by hand"
              value={applyToExisting}
              onChange={setApplyToExisting}
            />
          </>
        )}
      </View>

      {error && <ThemedText themeColor="negative">{error.message}</ThemedText>}

      <View style={styles.footer}>
        {transaction.categoryOverridden && (
          <Button
            label="Reset to Plaid category"
            variant="secondary"
            size="small"
            disabled={saving}
            onPress={() => update.mutate({ id: transaction.id, category: null, subcategory: null }, { onSuccess: onClose })}
          />
        )}
        <Button label="Cancel" variant="secondary" size="small" onPress={onClose} />
        <Button label="Save" size="small" disabled={!canSave} loading={saving} onPress={save} />
      </View>
    </ThemedView>
  );
}

/** Keeps a chosen value that isn't in the list yet (e.g. one just typed) selectable. */
function withCurrent(options: string[], current: string | null): string[] {
  return current && !options.includes(current) ? [current, ...options] : options;
}

function AddRow({
  placeholder,
  value,
  onChangeText,
  onAdd,
}: {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  onAdd: (value: string) => void;
}) {
  const theme = useTheme();
  const trimmed = value.trim();
  return (
    <View style={styles.customRow}>
      <TextInput
        style={[styles.input, styles.grow, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={() => trimmed && onAdd(trimmed)}
      />
      <Button label="Add" variant="secondary" size="small" disabled={!trimmed} onPress={() => onAdd(trimmed)} />
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <ThemedText type="small" style={styles.grow}>
        {label}
      </ThemedText>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: Spacing.three },
  sheetWrap: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  sheet: { borderRadius: Spacing.three, borderWidth: 1, padding: Spacing.four, gap: Spacing.two },
  label: { marginTop: Spacing.two },
  chipScroll: { maxHeight: 180 },
  subchipScroll: { maxHeight: 96 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  customRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  grow: { flex: 1 },
  rule: { marginTop: Spacing.two, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two, marginTop: Spacing.two },
});
