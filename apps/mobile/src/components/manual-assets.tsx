import {
  currentValue,
  DEFAULT_VEHICLE_DEPRECIATION_PERCENT,
  ownedValue,
  VehicleDetails,
  vehicleLabel,
  type ManualAsset,
  type ManualAssetKind,
  type ValuationSource,
} from '@meld/shared';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AISetupHint } from '@/components/ai-setup-hint';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { formatWholeCurrency } from '@/lib/format';
import {
  useDeleteManualAsset,
  useEstimatePropertyValue,
  useEstimateVehicleValue,
  useFeatures,
  useSaveManualAsset,
} from '@/lib/queries';

const KINDS: { kind: ManualAssetKind; label: string }[] = [
  { kind: 'home', label: 'Home' },
  { kind: 'vehicle', label: 'Vehicle' },
  { kind: 'other', label: 'Other' },
];

/** "Home · 50% of $800,000 · as of 2026-10-01" */
export function manualAssetDetail(a: ManualAsset): string {
  return [
    KINDS.find((k) => k.kind === a.kind)?.label,
    a.ownershipPercent != null && a.ownershipPercent < 100 && `${a.ownershipPercent}% of ${formatWholeCurrency(currentValue(a))}`,
    a.depreciationPercent
      ? `${formatWholeCurrency(a.value)} on ${a.valueAsOf}, −${a.depreciationPercent}%/yr`
      : a.valueAsOf && `as of ${a.valueAsOf}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Where to look up a value by hand when AI lookups aren't set up. */
function homeValueLinks(address: string) {
  const q = encodeURIComponent(address);
  return [
    { label: 'Zillow', url: address ? `https://www.zillow.com/homes/${q}_rb/` : 'https://www.zillow.com/how-much-is-my-home-worth/' },
    { label: 'Redfin', url: 'https://www.redfin.com/what-is-my-home-worth' },
  ];
}
const VEHICLE_VALUE_LINKS = [
  { label: 'Kelley Blue Book', url: 'https://www.kbb.com/whats-my-car-worth/' },
  { label: 'Edmunds', url: 'https://www.edmunds.com/appraisal/' },
];

const parseAmount = (s: string) => Number(s.replace(/[$,%\s]/g, ''));
/** "123 Main St, Springfield, IL" → "123 Main St". */
const streetOf = (address: string) => address.split(',')[0]!.trim();

/** Adds or edits an asset Plaid can't see (home value, vehicles), counted toward net worth. */
export function AssetForm({ asset, onDone }: { asset?: ManualAsset; onDone: () => void }) {
  const theme = useTheme();
  const save = useSaveManualAsset();
  const remove = useDeleteManualAsset();
  const estimate = useEstimatePropertyValue();
  const vehicleEstimate = useEstimateVehicleValue();
  const features = useFeatures();
  // Lookups need cloud AI; until we know, offer neither the button nor the hint.
  const canUseAI = features.data?.cloudAI === true;
  const showAIHint = features.data?.cloudAI === false;
  const [kind, setKind] = useState<ManualAssetKind>(asset?.kind ?? 'home');
  const [address, setAddress] = useState(asset?.address ?? '');
  const [year, setYear] = useState(asset?.vehicle ? String(asset.vehicle.year) : '');
  const [make, setMake] = useState(asset?.vehicle?.make ?? '');
  const [model, setModel] = useState(asset?.vehicle?.model ?? '');
  const [trim, setTrim] = useState(asset?.vehicle?.trim ?? '');
  const [mileage, setMileage] = useState(asset?.vehicle?.mileage != null ? String(asset.vehicle.mileage) : '');
  const [zip, setZip] = useState(asset?.vehicle?.zip ?? '');
  const [name, setName] = useState(asset?.name ?? '');
  // Saving restarts depreciation from today, so an existing asset starts from what it's worth now.
  const [value, setValue] = useState(asset ? String(currentValue(asset)) : '');
  const [depreciation, setDepreciation] = useState(
    asset?.depreciationPercent != null ? String(asset.depreciationPercent) : '',
  );
  const [share, setShare] = useState(asset?.ownershipPercent != null ? String(asset.ownershipPercent) : '');
  const [sources, setSources] = useState<ValuationSource[] | null>(asset?.valuationSources ?? null);

  const home = kind === 'home';
  const isVehicle = kind === 'vehicle';
  const trimmedAddress = home ? address.trim() : '';
  const parsedVehicle = VehicleDetails.safeParse({
    year: Number(year.trim()),
    make,
    model,
    trim: trim.trim() || null,
    mileage: mileage.trim() ? parseAmount(mileage) : null,
    zip: zip.trim() || null,
  });
  const vehicle = isVehicle && parsedVehicle.success ? parsedVehicle.data : null;
  const vehicleStarted = isVehicle && [year, make, model, trim, mileage, zip].some((f) => f.trim() !== '');
  const amount = parseAmount(value);
  const depreciationPercent = home || depreciation.trim() === '' ? null : parseAmount(depreciation);
  const depreciationValid =
    depreciationPercent === null || (Number.isFinite(depreciationPercent) && depreciationPercent >= 0 && depreciationPercent < 100);
  const sharePercent = share.trim() === '' ? null : parseAmount(share);
  const shareValid = sharePercent === null || (Number.isFinite(sharePercent) && sharePercent > 0 && sharePercent <= 100);
  const valueValid = value.trim() !== '' && Number.isFinite(amount) && amount >= 0;
  const canLookUp = canUseAI && (home ? trimmedAddress.length >= 5 : vehicle !== null);
  // A home with an address or a vehicle with its details can be saved without a value; it's looked up first.
  const lookUpOnSave = canLookUp && value.trim() === '';
  const nameValid = name.trim().length > 0 || trimmedAddress.length > 0 || vehicle !== null;
  const valid = nameValid && shareValid && depreciationValid && (valueValid || lookUpOnSave);
  const looking = estimate.isPending || vehicleEstimate.isPending;
  const lookupResult = home ? estimate.data : isVehicle ? vehicleEstimate.data : undefined;
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background }];

  // mutate (not mutateAsync): failures surface via isError below instead of throwing.
  // `defaultName` names the asset when the name is left blank.
  function lookUp(then?: (value: number, sources: ValuationSource[], defaultName: string) => void) {
    const apply = (v: number, s: ValuationSource[], defaultName: string) => {
      setValue(String(v));
      setSources(s);
      then?.(v, s, defaultName);
    };
    if (home) estimate.mutate(trimmedAddress, { onSuccess: (r) => apply(r.value, r.sources, streetOf(r.address)) });
    else if (vehicle) vehicleEstimate.mutate(vehicle, { onSuccess: (r) => apply(r.value, r.sources, vehicleLabel(vehicle)) });
  }

  function chooseKind(k: ManualAssetKind) {
    setKind(k);
    // Vehicles lose value over time; start new ones at a typical rate.
    if (!asset && depreciation.trim() === '') {
      if (k === 'vehicle') setDepreciation(String(DEFAULT_VEHICLE_DEPRECIATION_PERCENT));
    } else if (!asset && k !== 'vehicle' && depreciation === String(DEFAULT_VEHICLE_DEPRECIATION_PERCENT)) {
      setDepreciation('');
    }
  }

  function submit() {
    if (!valid) return;
    const persist = (v: number, valuationSources: ValuationSource[] | null, defaultName?: string) =>
      save.mutate(
        {
          id: asset?.id,
          kind,
          name: name.trim() || defaultName || (vehicle ? vehicleLabel(vehicle) : streetOf(trimmedAddress)),
          value: v,
          valueAsOf: new Date().toLocaleDateString('en-CA'),
          address: trimmedAddress || null,
          ownershipPercent: sharePercent === 100 ? null : sharePercent,
          valuationSources: home || isVehicle ? valuationSources : null,
          vehicle,
          depreciationPercent: depreciationPercent || null,
        },
        { onSuccess: onDone },
      );
    if (lookUpOnSave) lookUp((v, s, defaultName) => persist(v, s, defaultName));
    else persist(amount, sources);
  }

  async function del() {
    if (!asset || !(await confirm(`Remove ${asset.name}?`, 'It will no longer count toward net worth.', 'Remove'))) return;
    remove.mutate(asset.id, { onSuccess: onDone });
  }

  const error = save.error ?? remove.error ?? (home ? estimate.error : isVehicle ? vehicleEstimate.error : null);

  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => chooseKind(k.kind)} />
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
      {isVehicle && (
        <>
          <View style={styles.inline}>
            <TextInput
              style={[inputStyle, styles.year]}
              placeholder="Year"
              placeholderTextColor={theme.textSecondary}
              value={year}
              onChangeText={setYear}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={4}
              autoFocus={!asset}
            />
            <TextInput
              style={[inputStyle, styles.grow]}
              placeholder="Make (e.g. Toyota)"
              placeholderTextColor={theme.textSecondary}
              value={make}
              onChangeText={setMake}
            />
            <TextInput
              style={[inputStyle, styles.grow]}
              placeholder="Model (e.g. RAV4)"
              placeholderTextColor={theme.textSecondary}
              value={model}
              onChangeText={setModel}
            />
          </View>
          <View style={styles.inline}>
            <TextInput
              style={[inputStyle, styles.grow]}
              placeholder="Trim (optional)"
              placeholderTextColor={theme.textSecondary}
              value={trim}
              onChangeText={setTrim}
            />
            <TextInput
              style={[inputStyle, styles.grow]}
              placeholder="Mileage"
              placeholderTextColor={theme.textSecondary}
              value={mileage}
              onChangeText={setMileage}
              keyboardType="number-pad"
              inputMode="numeric"
            />
            <TextInput
              style={[inputStyle, styles.zip]}
              placeholder="ZIP"
              placeholderTextColor={theme.textSecondary}
              value={zip}
              onChangeText={setZip}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={5}
              autoComplete="postal-code"
            />
          </View>
          {vehicleStarted && !vehicle && (
            <ThemedText type="small" themeColor="textSecondary">
              Enter the year, make and model to look up its value. Mileage and ZIP make it more accurate.
            </ThemedText>
          )}
        </>
      )}
      <TextInput
        style={inputStyle}
        placeholder={
          home
            ? 'Name (optional, defaults to the street)'
            : isVehicle
              ? 'Name (optional, defaults to the vehicle)'
              : 'Name (e.g. Boat)'
        }
        placeholderTextColor={theme.textSecondary}
        value={name}
        onChangeText={setName}
        autoFocus={!asset && kind === 'other'}
      />
      <View style={styles.inline}>
        <TextInput
          style={[inputStyle, styles.grow]}
          placeholder={(home || isVehicle) && canUseAI ? 'Value (blank to look it up)' : 'Estimated value'}
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
        {(home || isVehicle) && canUseAI && (
          <Button
            label={value.trim() ? 'Refresh value' : 'Look up value'}
            variant="secondary"
            size="small"
            disabled={!canLookUp || looking}
            onPress={() => lookUp()}
          />
        )}
      </View>
      {home && showAIHint && (
        <AISetupHint
          manual="Look up what it’s worth and enter it above:"
          links={homeValueLinks(trimmedAddress)}
          aiDoes="estimate it from Zillow, Redfin and recent sales"
        />
      )}
      {isVehicle && showAIHint && (
        <AISetupHint
          manual="Look up what it’s worth and enter it above:"
          links={VEHICLE_VALUE_LINKS}
          aiDoes="estimate it from Kelley Blue Book, Edmunds and other sites"
        />
      )}
      {!home && (
        <TextInput
          style={inputStyle}
          placeholder="Depreciation % per year (optional)"
          placeholderTextColor={theme.textSecondary}
          value={depreciation}
          onChangeText={setDepreciation}
          keyboardType="decimal-pad"
          inputMode="decimal"
          onSubmitEditing={submit}
        />
      )}
      {!depreciationValid && (
        <ThemedText type="small" themeColor="negative">
          Depreciation must be between 0 and 100% a year.
        </ThemedText>
      )}
      {depreciationValid && !!depreciationPercent && valueValid && amount > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Loses {depreciationPercent}% a year from today: about{' '}
          {formatWholeCurrency(amount * (1 - depreciationPercent / 100))} in a year,{' '}
          {formatWholeCurrency(amount * (1 - depreciationPercent / 100) ** 3)} in three.
        </ThemedText>
      )}
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
      {looking && (
        <ThemedText type="small" themeColor="textSecondary">
          {isVehicle ? 'Checking Kelley Blue Book, Edmunds' : 'Checking Zillow, Redfin'} and other sites. This can take a
          minute or two…
        </ThemedText>
      )}
      {(home || isVehicle) && sources && sources.length > 0 && (
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
              {home && estimate.data?.basis === 'comparables'
                ? 'Value is the median of these units, each scaled to your square footage.'
                : 'Value is the median of these estimates.'}
            </ThemedText>
          )}
        </View>
      )}
      {lookupResult?.warnings.map((w) => (
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
          disabled={!valid || looking}
          loading={save.isPending || (lookUpOnSave && looking)}
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
  year: { width: 72 },
  zip: { width: 80 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  sources: { gap: Spacing.one },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  spacer: { flex: 1 },
});
