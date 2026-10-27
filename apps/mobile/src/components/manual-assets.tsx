import { ownedValue, type ManualAsset, type ManualAssetKind, type ValuationSource } from '@meld/shared';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { formatCurrency, formatWholeCurrency } from '@/lib/format';
import { useDeleteManualAsset, useEstimatePropertyValue, useManualAssets, useSaveManualAsset } from '@/lib/queries';

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
      subtitle="Your home, car and the like. Enter a home's address to look up its value. Counted in net worth."
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
                {a.ownershipPercent != null && a.ownershipPercent < 100
                  ? ` · ${a.ownershipPercent}% of ${formatWholeCurrency(a.value)}`
                  : ''}
                {a.valueAsOf ? ` · as of ${a.valueAsOf}` : ''}
              </ThemedText>
            </View>
            <ThemedText>{formatCurrency(ownedValue(a))}</ThemedText>
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

const parseAmount = (s: string) => Number(s.replace(/[$,%\s]/g, ''));
/** "123 Main St, Springfield, IL" → "123 Main St". */
const streetOf = (address: string) => address.split(',')[0]!.trim();

function AssetForm({ asset, onDone }: { asset?: ManualAsset; onDone: () => void }) {
  const theme = useTheme();
  const save = useSaveManualAsset();
  const remove = useDeleteManualAsset();
  const estimate = useEstimatePropertyValue();
  const [kind, setKind] = useState<ManualAssetKind>(asset?.kind ?? 'home');
  const [address, setAddress] = useState(asset?.address ?? '');
  const [name, setName] = useState(asset?.name ?? '');
  const [value, setValue] = useState(asset ? String(asset.value) : '');
  const [share, setShare] = useState(asset?.ownershipPercent != null ? String(asset.ownershipPercent) : '');
  const [sources, setSources] = useState<ValuationSource[] | null>(asset?.valuationSources ?? null);

  const home = kind === 'home';
  const trimmedAddress = home ? address.trim() : '';
  const amount = parseAmount(value);
  const sharePercent = share.trim() === '' ? null : parseAmount(share);
  const shareValid = sharePercent === null || (Number.isFinite(sharePercent) && sharePercent > 0 && sharePercent <= 100);
  const valueValid = value.trim() !== '' && Number.isFinite(amount) && amount >= 0;
  // A home with an address can be saved without a value; it's looked up first.
  const lookUpOnSave = home && trimmedAddress.length >= 5 && value.trim() === '';
  const nameValid = name.trim().length > 0 || trimmedAddress.length > 0;
  const valid = nameValid && shareValid && (valueValid || lookUpOnSave);
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background }];

  // mutate (not mutateAsync): failures surface via isError below instead of throwing.
  function lookUp(then?: (value: number, sources: ValuationSource[], matched: string) => void) {
    estimate.mutate(trimmedAddress, {
      onSuccess: (result) => {
        setValue(String(result.value));
        setSources(result.sources);
        then?.(result.value, result.sources, result.address);
      },
    });
  }

  function submit() {
    if (!valid) return;
    const persist = (v: number, valuationSources: ValuationSource[] | null, matched?: string) =>
      save.mutate(
        {
          id: asset?.id,
          kind,
          name: name.trim() || streetOf(matched ?? trimmedAddress),
          value: v,
          valueAsOf: new Date().toLocaleDateString('en-CA'),
          address: trimmedAddress || null,
          ownershipPercent: sharePercent === 100 ? null : sharePercent,
          valuationSources: home ? valuationSources : null,
        },
        { onSuccess: onDone },
      );
    if (lookUpOnSave) lookUp((v, s, matched) => persist(v, s, matched));
    else persist(amount, sources);
  }

  async function del() {
    if (!asset || !(await confirm(`Remove ${asset.name}?`, 'It will no longer count toward net worth.', 'Remove'))) return;
    remove.mutate(asset.id, { onSuccess: onDone });
  }

  const error = save.error ?? remove.error ?? estimate.error;

  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} />
        ))}
      </View>
      {home && (
        <TextInput
          style={inputStyle}
          placeholder="Address (e.g. 123 Main St, Springfield, IL 62701)"
          placeholderTextColor={theme.textSecondary}
          value={address}
          onChangeText={setAddress}
          autoComplete="street-address"
          autoFocus={!asset}
        />
      )}
      <TextInput
        style={inputStyle}
        placeholder={home ? 'Name (optional, defaults to the street)' : 'Name (e.g. Car)'}
        placeholderTextColor={theme.textSecondary}
        value={name}
        onChangeText={setName}
        autoFocus={!asset && !home}
      />
      <View style={styles.inline}>
        <TextInput
          style={[inputStyle, styles.grow]}
          placeholder={home ? 'Value (blank to look it up)' : 'Estimated value'}
          placeholderTextColor={theme.textSecondary}
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setSources(null);
          }}
          keyboardType="decimal-pad"
          inputMode="decimal"
          onSubmitEditing={submit}
        />
        {home && (
          <Button
            label={value.trim() ? 'Refresh value' : 'Look up value'}
            variant="secondary"
            size="small"
            disabled={trimmedAddress.length < 5 || estimate.isPending}
            onPress={() => lookUp()}
          />
        )}
      </View>
      <TextInput
        style={inputStyle}
        placeholder="Your ownership % (optional, default 100)"
        placeholderTextColor={theme.textSecondary}
        value={share}
        onChangeText={setShare}
        keyboardType="decimal-pad"
        inputMode="decimal"
        onSubmitEditing={submit}
      />
      {!shareValid && (
        <ThemedText type="small" themeColor="negative">
          Ownership must be between 0 and 100%.
        </ThemedText>
      )}
      {estimate.isPending && (
        <ThemedText type="small" themeColor="textSecondary">
          Checking Zillow, Redfin and other sites. This can take a minute or two…
        </ThemedText>
      )}
      {home && sources && sources.length > 0 && (
        <View style={styles.sources}>
          {sources.map((s) => (
            <Pressable
              key={s.name}
              style={styles.row}
              disabled={!s.url}
              onPress={() => s.url && Linking.openURL(s.url)}
              accessibilityRole={s.url ? 'link' : undefined}>
              <ThemedText type="small" themeColor={s.url ? 'tint' : 'textSecondary'}>
                {s.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatWholeCurrency(s.value)}
              </ThemedText>
            </Pressable>
          ))}
          {sources.length > 1 && (
            <ThemedText type="small" themeColor="textSecondary">
              {estimate.data?.basis === 'comparables'
                ? 'Value is the median of these units, each scaled to your square footage.'
                : 'Value is the median of these estimates.'}
            </ThemedText>
          )}
        </View>
      )}
      {estimate.data?.warnings.map((w) => (
        <ThemedText key={w} type="small" themeColor="warning">
          {w}
        </ThemedText>
      ))}
      {sharePercent !== null && shareValid && valueValid && sharePercent < 100 && (
        <ThemedText type="small" themeColor="textSecondary">
          Counts {formatWholeCurrency(ownedValue({ value: amount, ownershipPercent: sharePercent }))} toward net worth.
        </ThemedText>
      )}
      {error && (
        <ThemedText type="small" themeColor="negative">
          {error.message}
        </ThemedText>
      )}
      <View style={styles.buttons}>
        <Button
          label={lookUpOnSave ? 'Look up & save' : 'Save'}
          size="small"
          disabled={!valid || estimate.isPending}
          loading={save.isPending || (lookUpOnSave && estimate.isPending)}
          onPress={submit}
        />
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
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  sources: { gap: Spacing.one },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  spacer: { flex: 1 },
});
