import type { ManualAsset, ManualAssetKind } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { formatCurrency } from '@/lib/format';
import { useDeleteManualAsset, useManualAssets, useSaveManualAsset } from '@/lib/queries';

const KINDS: { kind: ManualAssetKind; label: string }[] = [
  { kind: 'home', label: 'Home' },
  { kind: 'vehicle', label: 'Vehicle' },
  { kind: 'other', label: 'Other' },
];

/** Assets Plaid can't see (home value, vehicles), counted toward net worth. */
export function ManualAssets() {
  const assets = useManualAssets();
  const [editing, setEditing] = useState<ManualAsset | 'new' | null>(null);

  return (
    <Card
      title="Property & other assets"
      subtitle="Values you enter yourself, like your home or car. Counted in net worth."
      action={editing === null && <Button label="Add" variant="secondary" size="small" onPress={() => setEditing('new')} />}>
      {assets.isError && <ThemedText themeColor="negative">{assets.error.message}</ThemedText>}
      {assets.data?.map((a) =>
        editing !== 'new' && editing?.id === a.id ? (
          <AssetForm key={a.id} asset={a} onDone={() => setEditing(null)} />
        ) : (
          <Pressable key={a.id} style={styles.row} onPress={() => setEditing(a)} accessibilityHint="Edit asset">
            <View style={styles.shrink}>
              <ThemedText numberOfLines={1}>{a.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {KINDS.find((k) => k.kind === a.kind)?.label}
                {a.valueAsOf ? ` · as of ${a.valueAsOf}` : ''}
              </ThemedText>
            </View>
            <ThemedText>{formatCurrency(a.value)}</ThemedText>
          </Pressable>
        ),
      )}
      {editing === 'new' && <AssetForm onDone={() => setEditing(null)} />}
      {assets.data?.length === 0 && editing === null && (
        <ThemedText type="small" themeColor="textSecondary">
          None yet.
        </ThemedText>
      )}
    </Card>
  );
}

function AssetForm({ asset, onDone }: { asset?: ManualAsset; onDone: () => void }) {
  const theme = useTheme();
  const save = useSaveManualAsset();
  const remove = useDeleteManualAsset();
  const [kind, setKind] = useState<ManualAssetKind>(asset?.kind ?? 'home');
  const [name, setName] = useState(asset?.name ?? '');
  const [value, setValue] = useState(asset ? String(asset.value) : '');
  const amount = Number(value.replace(/[$,]/g, ''));
  const valid = name.trim().length > 0 && value.trim() !== '' && Number.isFinite(amount) && amount >= 0;
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background }];

  // mutate (not mutateAsync): failures surface via isError below instead of throwing.
  function submit() {
    if (!valid) return;
    save.mutate(
      { id: asset?.id, kind, name: name.trim(), value: amount, valueAsOf: new Date().toLocaleDateString('en-CA') },
      { onSuccess: onDone },
    );
  }

  async function del() {
    if (!asset || !(await confirm(`Remove ${asset.name}?`, 'It will no longer count toward net worth.', 'Remove'))) return;
    remove.mutate(asset.id, { onSuccess: onDone });
  }

  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} />
        ))}
      </View>
      <TextInput
        style={inputStyle}
        placeholder="Name (e.g. Primary home)"
        placeholderTextColor={theme.textSecondary}
        value={name}
        onChangeText={setName}
        autoFocus={!asset}
      />
      <TextInput
        style={inputStyle}
        placeholder="Estimated value"
        placeholderTextColor={theme.textSecondary}
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        inputMode="decimal"
        onSubmitEditing={submit}
      />
      {(save.isError || remove.isError) && (
        <ThemedText type="small" themeColor="negative">
          {(save.error ?? remove.error)?.message}
        </ThemedText>
      )}
      <View style={styles.buttons}>
        <Button label="Save" size="small" disabled={!valid} loading={save.isPending} onPress={submit} />
        <Button label="Cancel" variant="secondary" size="small" onPress={onDone} />
        <View style={styles.spacer} />
        {asset && <Button label="Remove" variant="danger" size="small" loading={remove.isPending} onPress={del} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  shrink: { flexShrink: 1 },
  form: { gap: Spacing.two },
  chips: { flexDirection: 'row', gap: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  spacer: { flex: 1 },
});
